# -----------------------------------------------------------------------------
# /*
#  * Copyright (C) 2025 CodeStory
#  *
#  * This program is free software; you can redistribute it and/or modify
#  * it under the terms of the GNU General Public License as published by
#  * the Free Software Foundation; Version 2.
#  *
#  * This program is distributed in the hope that it will be useful,
#  * but WITHOUT ANY WARRANTY; without even the implied warranty of
#  * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
#  * GNU General Public License for more details.
#  *
#  * You should have received a copy of the GNU General Public License
#  * along with this program; if not, you can contact us at support@codestory.build
#  */
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# codestory - Dual Licensed Software
# Copyright (c) 2025 Adem Can
# -----------------------------------------------------------------------------

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from loguru import logger
from tqdm import tqdm

from codestory.core.data.chunk import Chunk
from codestory.core.data.commit_group import CommitGroup
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.diff_generation.diff_generator import DiffGenerator
from codestory.core.diff_generation.semantic_diff_generator import SemanticDiffGenerator
from codestory.core.embeddings.clusterer import Clusterer
from codestory.core.embeddings.embedder import Embedder
from codestory.core.exceptions import LLMResponseError
from codestory.core.grouper.interface import LogicalGrouper
from codestory.core.llm import CodeStoryAdapter
from codestory.core.semantic_grouper.chunk_lableler import AnnotatedChunk, ChunkLabeler
from codestory.core.semantic_grouper.context_manager import ContextManager

# -----------------------------------------------------------------------------
# Prompts (Optimized for 1.5B LLMs)
# -----------------------------------------------------------------------------

INITIAL_SUMMARY_SYSTEM = """You are an expert developer writing Git commit messages. 

Given code changes with git patches and metadata (added/removed/modified symbols), write a concise commit message that describes what changed.

Rules:
- Single line, max 72 characters
- Imperative mood (Add, Update, Remove, Refactor)
- Describe the change, not the goal
- Output only the commit message"""

INITIAL_SUMMARY_USER = """Here is a code change:

{changes}

Commit message:"""


CLUSTER_SUMMARY_SYSTEM = """You are an expert developer writing Git commit messages.

Given multiple related commit messages, combine them into one cohesive commit message.

Rules:
- Single line, max 72 characters
- Imperative mood (Add, Update, Remove, Refactor)
- Capture all key changes
- Output only the commit message"""

CLUSTER_SUMMARY_USER = """Here are related commit messages:

{summaries}

Combined commit message:"""


BATCHED_CLUSTER_SUMMARY_SYSTEM = """You are an expert developer writing Git commit messages.

Given a JSON array where each element contains multiple related commit messages, combine each group into one cohesive commit message.

Rules:
- Output a JSON array of strings with one message per input group
- Each message: single line, max 72 characters, imperative mood
- Output ONLY the JSON array, no other text
- Match the input order exactly

Example:
Input: [["Add login", "Add logout"], ["Fix parser", "Update tests"]]
Output: ["Add authentication system", "Fix parser and update tests"]"""

BATCHED_CLUSTER_SUMMARY_USER = """Here are {count} groups of related commit messages:

{groups}

Provide {count} combined commit messages as a JSON array:"""


BATCHED_SUMMARY_SYSTEM = """You are an expert developer writing Git commit messages.

Given a JSON array of code changes, write a commit message for each one. Each change includes git patches and metadata about added/removed/modified symbols.

Rules:
- Output a JSON array of strings with one message per input change
- Each message: single line, max 72 characters, imperative mood
- Output ONLY the JSON array, no other text
- Match the input order exactly

Example:
Input: [{"git_patch": "..."}, {"git_patch": "..."}]
Output: ["Add user authentication", "Update config parser"]"""

BATCHED_SUMMARY_USER = """Here are {count} code changes:

{changes}

Provide {count} commit messages as a JSON array:"""


@dataclass
class Cluster:
    chunks: list[Chunk | ImmutableChunk]
    summaries: list[str]


@dataclass
class SummaryTask:
    prompt: str
    is_multiple: bool
    indices: list[int]
    original_patches: list[str]


@dataclass
class ClusterSummaryTask:
    prompt: str
    is_multiple: bool
    cluster_ids: list[int]
    summaries_groups: list[list[str]]


class EmbeddingGrouper(LogicalGrouper):
    def __init__(
        self,
        model: CodeStoryAdapter,
        batching_strategy: Literal["auto", "requests", "prompt"] = "auto",
        max_tokens: int = 4096,
        custom_embedding_model: str | None = None,
        cluster_strictness: float = 0.5,
    ):
        self.model = model
        self.batching_strategy = batching_strategy
        self.embedder = Embedder(custom_embedding_model)
        self.clusterer = Clusterer(cluster_strictness)
        self.patch_cutoff_chars = 1000
        self.max_tokens = max_tokens

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count based on 3 chars per token."""
        return len(text) // 3

    def _partition_items(
        self,
        items: list[Any],
        item_cost_fn: Callable[[Any], int],
        base_prompt_cost: int,
        strategy: str,
    ) -> list[list[Any]]:
        """
        Generic partitioner for batching items based on token cost.
        """
        partitions = []

        if strategy == "requests":
            for item in items:
                partitions.append([item])
            return partitions

        current_batch = []
        current_tokens = base_prompt_cost

        for item in items:
            cost = item_cost_fn(item)

            if current_batch and (current_tokens + cost > self.max_tokens):
                partitions.append(current_batch)
                current_batch = []
                current_tokens = base_prompt_cost

            current_batch.append(item)
            current_tokens += cost

        if current_batch:
            partitions.append(current_batch)

        return partitions

    def _parse_json_list_response(
        self, response: str, expected_count: int
    ) -> list[str]:
        """
        Parses a JSON list response from the LLM.
        """
        l_indx = response.find("[")
        r_indx = response.rfind("]")

        if l_indx == -1 or r_indx == -1:
            raise LLMResponseError("No JSON list found in response")

        clean_response = response[l_indx : r_indx + 1]
        try:
            batch_items = json.loads(clean_response)
        except json.JSONDecodeError as e:
            raise LLMResponseError("Failed to decode JSON from batch response") from e

        if not isinstance(batch_items, list):
            raise LLMResponseError("Response is not a list")

        batch_items = [str(s) for s in batch_items if s.strip()]

        if len(batch_items) != expected_count:
            raise LLMResponseError(
                f"Batch count mismatch: Expected {expected_count}, got {len(batch_items)}"
            )

        return [str(s).strip().strip('"').strip("'") for s in batch_items]

    def _partition_patches(
        self, annotated_chunk_patches: list[str], strategy: str
    ) -> list[list[tuple[int, str]]]:
        """
        Partitions patches into groups.
        If strategy is 'requests', every group has size 1.
        If strategy is 'prompt', groups are filled up to max_tokens.
        Returns: List of groups, where each group is a list of (original_index, patch_string)
        """
        base_prompt_cost = self._estimate_tokens(
            BATCHED_SUMMARY_SYSTEM
        ) + self._estimate_tokens(BATCHED_SUMMARY_USER)

        items = list(enumerate(annotated_chunk_patches))

        def cost_fn(item: tuple[int, str]) -> int:
            i, patch = item
            formatted_patch_overhead = f"--- Change {i + 1} ---\n\n\n"
            return self._estimate_tokens(patch) + self._estimate_tokens(
                formatted_patch_overhead
            )

        return self._partition_items(items, cost_fn, base_prompt_cost, strategy)

    def _create_summary_tasks(
        self, partitions: list[list[tuple[int, str]]]
    ) -> list[SummaryTask]:
        """
        Converts partitions of patches into actionable LLM Tasks.
        """
        tasks = []
        for group in partitions:
            indices = [item[0] for item in group]
            patches = [item[1] for item in group]

            if len(group) == 1:
                # Single Request Task
                changes_json = json.dumps(patches[0], indent=2)
                prompt = INITIAL_SUMMARY_USER.format(changes=changes_json)
                tasks.append(
                    SummaryTask(
                        prompt=prompt,
                        is_multiple=False,
                        indices=indices,
                        original_patches=patches,
                    )
                )
            else:
                # Batched Request Task - build a JSON array of changes
                changes_array = patches

                # Create a clean JSON array representation for the prompt
                changes_json = json.dumps(changes_array, indent=2)
                prompt = BATCHED_SUMMARY_USER.format(
                    count=len(patches), changes=changes_json
                )
                tasks.append(
                    SummaryTask(
                        prompt=prompt,
                        is_multiple=True,
                        indices=indices,
                        original_patches=patches,
                    )
                )
        return tasks

    def _partition_cluster_summaries(
        self, clusters_dict: dict[int, Cluster], strategy: str
    ) -> list[list[tuple[int, list[str]]]]:
        """Partition cluster summaries into groups for batching."""
        base_prompt_cost = self._estimate_tokens(
            BATCHED_CLUSTER_SUMMARY_SYSTEM
        ) + self._estimate_tokens(BATCHED_CLUSTER_SUMMARY_USER)

        cluster_items = [
            (cid, cluster.summaries) for cid, cluster in clusters_dict.items()
        ]

        def cost_fn(item: tuple[int, list[str]]) -> int:
            _, summaries = item
            summaries_text = "\n".join(f"- {s}" for s in summaries)
            return self._estimate_tokens(summaries_text)

        return self._partition_items(cluster_items, cost_fn, base_prompt_cost, strategy)

    def _create_cluster_summary_tasks(
        self, partitions: list[list[tuple[int, list[str]]]]
    ) -> list[ClusterSummaryTask]:
        """Convert partitions into cluster summary tasks."""
        tasks = []
        for group in partitions:
            cluster_ids = [item[0] for item in group]
            summaries_groups = [item[1] for item in group]

            if len(group) == 1:
                # Single cluster request
                summaries_text = "\n".join(f"- {s}" for s in summaries_groups[0])
                prompt = CLUSTER_SUMMARY_USER.format(summaries=summaries_text)
                tasks.append(
                    ClusterSummaryTask(
                        prompt=prompt,
                        is_multiple=False,
                        cluster_ids=cluster_ids,
                        summaries_groups=summaries_groups,
                    )
                )
            else:
                # Batched cluster request
                groups_json = json.dumps(summaries_groups, indent=2)
                prompt = BATCHED_CLUSTER_SUMMARY_USER.format(
                    count=len(group), groups=groups_json
                )
                tasks.append(
                    ClusterSummaryTask(
                        prompt=prompt,
                        is_multiple=True,
                        cluster_ids=cluster_ids,
                        summaries_groups=summaries_groups,
                    )
                )
        return tasks

    def generate_summaries(
        self, annotated_chunk_patches: list[list[dict]], pbar: tqdm | None = None
    ) -> list[str]:
        if not annotated_chunk_patches:
            return []

        strategy = self.batching_strategy
        if strategy == "auto":
            strategy = "requests" if self.model.is_local() else "prompt"

        # 1. Partition based on strategy and window size
        partitions = self._partition_patches(annotated_chunk_patches, strategy)

        # 2. Create Tasks
        tasks = self._create_summary_tasks(partitions)

        logger.debug(
            f"Generating summaries for {len(annotated_chunk_patches)} changes (Strategy: {strategy})."
        )

        # 3. Create callback for progress tracking
        update_callback = None
        if pbar is not None:
            request_count = {"sent": 0, "received": 0}

            def update_callback(status: Literal["sent", "received"]):
                request_count[status] += 1
                pbar.set_postfix(
                    {"requests": f"{request_count['received']}/{len(tasks)}"}
                )

        # 4. Invoke Batch
        messages_list = [
            [
                {
                    "role": "system",
                    "content": BATCHED_SUMMARY_SYSTEM
                    if t.is_multiple
                    else INITIAL_SUMMARY_SYSTEM,
                },
                {"role": "user", "content": t.prompt},
            ]
            for t in tasks
        ]
        responses = self.model.invoke_batch(
            messages_list, update_callback=update_callback
        )

        # 4. Process Results
        # We pre-allocate the result list to maintain order
        final_summaries = [""] * len(annotated_chunk_patches)

        for task, response in zip(tasks, responses, strict=True):
            if not task.is_multiple:
                # Single task: simple cleanup
                clean_res = response.strip().strip('"').strip("'")
                final_summaries[task.indices[0]] = clean_res
            else:
                batch_summaries = self._parse_json_list_response(
                    response, len(task.indices)
                )
                # Distribute results
                for idx, summary in zip(task.indices, batch_summaries, strict=True):
                    final_summaries[idx] = summary

        return final_summaries

    def generate_cluster_summaries(
        self, clusters: dict[int, Cluster], pbar: tqdm | None = None
    ) -> dict[int, str]:
        if not clusters:
            return {}

        strategy = self.batching_strategy
        if strategy == "auto":
            strategy = "requests" if self.model.is_local() else "prompt"

        # Partition clusters
        partitions = self._partition_cluster_summaries(clusters, strategy)

        # Create tasks
        cluster_tasks = self._create_cluster_summary_tasks(partitions)

        logger.debug(
            f"Generating cluster summaries for {len(clusters)} clusters (Strategy: {strategy})."
        )

        # Create callback
        cluster_callback = None
        if pbar is not None:
            cluster_count = {"sent": 0, "received": 0}

            def cluster_callback(status: Literal["sent", "received"]):
                cluster_count[status] += 1
                pbar.set_postfix(
                    {
                        "cluster_requests": f"{cluster_count['received']}/{len(cluster_tasks)}"
                    }
                )

        # Invoke batch
        messages_list = [
            [
                {
                    "role": "system",
                    "content": BATCHED_CLUSTER_SUMMARY_SYSTEM
                    if t.is_multiple
                    else CLUSTER_SUMMARY_SYSTEM,
                },
                {"role": "user", "content": t.prompt},
            ]
            for t in cluster_tasks
        ]
        responses = self.model.invoke_batch(
            messages_list, update_callback=cluster_callback
        )

        # Process results
        cluster_messages_map = {}
        for task, response in zip(cluster_tasks, responses, strict=True):
            if not task.is_multiple:
                # Single cluster
                clean_msg = response.strip().strip('"').strip("'")
                cluster_messages_map[task.cluster_ids[0]] = clean_msg
            else:
                batch_messages = self._parse_json_list_response(
                    response, len(task.cluster_ids)
                )
                # Map results
                for cluster_id, message in zip(
                    task.cluster_ids, batch_messages, strict=True
                ):
                    cluster_messages_map[cluster_id] = message

        return cluster_messages_map

    def generate_annotated_patches(
        self, annotated_chunks: list[AnnotatedChunk], diff_generator: DiffGenerator
    ) -> list[list[dict]]:
        patches = []
        for annotated_chunk in annotated_chunks:
            patch = self.generate_annotated_patch(annotated_chunk, diff_generator)
            patches.append(patch)
        return patches

    def generate_annotated_patch(
        self, annotated_chunk: AnnotatedChunk, diff_generator: DiffGenerator
    ) -> list[dict]:
        annotated_patch = []
        chunks = annotated_chunk.chunk.get_chunks()
        signatures = (
            annotated_chunk.signature.signatures
            if annotated_chunk.signature
            else [None] * len(chunks)
        )
        for chunk, signature in zip(
            chunks,
            signatures,
            strict=True,
        ):
            # we get diff generator [0] since we pass only one chunk, then we cut off to limit size
            patch = diff_generator.get_patch(chunk)[: self.patch_cutoff_chars]
            patch_json = {}

            patch_json["git_patch"] = patch

            # add only relevant info
            if signature is not None:
                # remove extra symbol info for cleaner output
                # eg "foo identifier_class python" -> "foo"
                new_symbols_cleaned = {
                    sym.partition(" ")[0] for sym in signature.def_new_symbols
                }
                old_symbols_cleaned = {
                    sym.partition(" ")[0] for sym in signature.def_old_symbols
                }

                modified_symbols = old_symbols_cleaned.intersection(new_symbols_cleaned)
                added_symbols = new_symbols_cleaned - modified_symbols
                removed_symbols = old_symbols_cleaned - modified_symbols

                if annotated_chunk.signature.total_signature.languages:
                    patch_json["languages"] = list(
                        annotated_chunk.signature.total_signature.languages
                    )
                if modified_symbols:
                    patch_json["modified_symbols"] = list(modified_symbols)
                if added_symbols:
                    patch_json["added_symbols"] = list(added_symbols)
                if removed_symbols:
                    patch_json["removed_symbols"] = list(removed_symbols)
                if signature.new_fqns or signature.old_fqns:
                    patch_json["affected_scopes"] = list(
                        signature.new_fqns | signature.old_fqns
                    )

            annotated_patch.append(patch_json)

        return annotated_patch

    def group_chunks(
        self,
        chunks: list[Chunk],
        immut_chunks: list[ImmutableChunk],
        context_manager: ContextManager,
        message: str,
        pbar: tqdm | None = None,
    ) -> list[CommitGroup]:
        """
        Main entry point.
        """
        if not (chunks or immut_chunks):
            return []

        annotated_chunks = ChunkLabeler.annotate_chunks(chunks, context_manager)
        diff_generator = SemanticDiffGenerator(
            chunks
        )  # immutable chunks wont be used for total patch calcs

        annotated_chunk_patches = self.generate_annotated_patches(
            annotated_chunks, diff_generator
        )
        # add in immutable chunks (they have no annotated chunk "capablities")
        immut_patches = [
            immut.file_patch[:200].decode("utf-8", errors="replace")
            for immut in immut_chunks
        ]

        all_patch_data = annotated_chunk_patches + immut_patches
        all_chunks_reference = chunks + immut_chunks

        summaries = self.generate_summaries(all_patch_data, pbar=pbar)

        if len(all_chunks_reference) == 1:
            # no clustering, just one commit group
            return [
                CommitGroup(
                    chunks=[all_chunks_reference[0]],
                    commit_message=summaries[0],
                )
            ]
        embeddings = self.embedder.embed(summaries)
        cluster_labels = self.clusterer.cluster(embeddings)

        groups = []
        clusters = {}

        # Build clusters: group chunks and their summaries by cluster label
        for any_chunk, summary, cluster_label in zip(
            all_chunks_reference, summaries, cluster_labels, strict=True
        ):
            if cluster_label == -1:
                # noise, assign as its own group. Reuse summary as group message
                group = CommitGroup(
                    chunks=[any_chunk],
                    commit_message=summary,
                )
                groups.append(group)
            else:
                if cluster_label not in clusters:
                    clusters[cluster_label] = Cluster(chunks=[], summaries=[])
                clusters[cluster_label].chunks.append(any_chunk)
                clusters[cluster_label].summaries.append(summary)

        # Generate final commit messages for each cluster using batching
        if clusters:
            cluster_messages_map = self.generate_cluster_summaries(clusters, pbar=pbar)

            # Create commit groups from clusters
            for cluster_id, cluster in clusters.items():
                commit_message = cluster_messages_map[cluster_id]
                group = CommitGroup(
                    chunks=cluster.chunks,
                    commit_message=commit_message,
                )
                groups.append(group)

        logger.debug(
            f"Organized {len(chunks) + len(immut_chunks)} changes into {len(groups)} logical groups."
        )

        return groups

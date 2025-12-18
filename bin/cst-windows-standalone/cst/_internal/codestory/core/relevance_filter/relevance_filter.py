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

import json
import re
from dataclasses import dataclass
from typing import Literal

from loguru import logger
from tqdm import tqdm

from codestory.core.data.chunk import Chunk
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.diff_generation.semantic_diff_generator import SemanticDiffGenerator
from codestory.core.exceptions import LLMResponseError
from codestory.core.llm import CodeStoryAdapter


@dataclass
class RelevanceFilterConfig:
    level: Literal["safe", "standard", "strict"] = "standard"
    extra_instructions: str = ""


# -----------------------------------------------------------------------------
# Language-Agnostic System Prompts
# -----------------------------------------------------------------------------

BASE_SYSTEM_PROMPT = """You are an intelligent Change Curator.
Your task is to review a set of text-based changes (diffs) and decide which ones should be INCLUDED in the final output based on the User's stated Intent.

You will be provided with:
1. The User's Intent (a description of what they wanted to change).
2. A list of numbered change chunks.

Output a VALID JSON object in this format:
{
    "rejected_chunk_ids": [0, 5, ...],
    "reasoning": "Brief explanation of why these chunks were rejected."
}
If all chunks match the intent, return "rejected_chunk_ids": [].

CORE PHILOSOPHY:
- Content is "Relevant" if it helps achieve the User's Intent.
- Content is "Irrelevant" (Junk) if it is accidental noise, system artifacts, or temporary scratchpad text that does not belong in the final version.
"""

AGGRESSION_RULES = {
    "safe": """
    MODE: SAFE (The Librarian)
    - GOAL: Zero False Positives. When in doubt, KEEP the change.
    - ONLY REJECT:
        1. Objectively useless machine artifacts (e.g., OS metadata files, huge binary blobs).
        2. Corrupted text or merge conflict markers.
    - KEEP: All human-authored text, even if it seems slightly unrelated to the intent.
    """,
    "standard": """
    MODE: STANDARD (The Editor)
    - GOAL: High Cohesion. Remove noise that distracts from the intent.
    - REJECT:
        1. "Work in progress" artifacts (e.g., temporary markers, diagnostic outputs, scratchpad notes) that were likely left behind by accident.
        2. System/IDE configuration files that are usually ignored.
    - KEEP: Any content change that plausibly relates to the intent, even indirectly.
    """,
    "strict": """
    MODE: STRICT (The Lawyer)
    - GOAL: Laser Precision.
    - CRITERIA: A change must be DIRECTLY required by the User's Intent.
    - REJECT:
        1. "While I'm here" edits (e.g., fixing a typo in an unrelated file).
        2. Scope creep (changes that add features not requested).
        3. ALL temporary artifacts, diagnostics, or unrelated metadata.
    - If the user says "Update Title", reject changes to the "Footer".
    """,
}

USER_PROMPT_TEMPLATE = """User Intent: "{intent}"

Review the following changes. Identify which chunks are irrelevant to this intent based on the current Mode.

CHANGES:
{changes_json}
"""


def build_system_message(level: str, extra_instructions: str = "") -> dict[str, str]:
    """Build the system message with mode-specific instructions."""
    mode_instruction = AGGRESSION_RULES.get(level, AGGRESSION_RULES["standard"])
    content = f"{BASE_SYSTEM_PROMPT}\n{mode_instruction}"

    if extra_instructions:
        content += f"\nAdditional Rules:\n{extra_instructions}"

    return {"role": "system", "content": content}


def build_user_message(intent: str, changes_json: str) -> dict[str, str]:
    """Build the user message with intent and changes."""
    content = USER_PROMPT_TEMPLATE.format(intent=intent, changes_json=changes_json)
    return {"role": "user", "content": content}


class RelevanceFilter:
    def __init__(self, model: CodeStoryAdapter, config: RelevanceFilterConfig):
        self.model = model
        self.config = config

    def _prepare_payload(
        self, chunks: list[Chunk], immut_chunks: list[ImmutableChunk]
    ) -> str:
        """Convert chunks to a simplified structure for LLM analysis."""
        changes = []
        diff_map = SemanticDiffGenerator(chunks).get_patches(chunks)

        # Process mutable chunks
        for i in range(len(chunks)):
            changes.append({"chunk_id": i, "change": diff_map.get(i, "(no diff)")})

        # Process immutable chunks
        idx = len(chunks)
        for immut_chunk in immut_chunks:
            patch_content = immut_chunk.file_patch.decode("utf-8", errors="replace")
            # Truncate large patches
            if len(patch_content) > 300:
                patch_content = patch_content[:285] + "... (truncated)"

            changes.append({"chunk_id": idx, "change": patch_content})
            idx += 1

        return json.dumps({"changes": changes}, indent=2)

    def _clean_response(self, text: str) -> dict:
        """Parses the LLM response, handling markdown fences."""
        cleaned = text.strip()
        # Remove ```json ... ``` wrappers
        if "```" in cleaned:
            match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
            if match:
                cleaned = match.group(1)
            else:
                # Fallback: look for first { and last }
                start = cleaned.find("{")
                end = cleaned.rfind("}")
                if start != -1 and end != -1:
                    cleaned = cleaned[start : end + 1]

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM JSON: {cleaned}")
            raise LLMResponseError("Model returned invalid JSON") from e

    def filter(
        self,
        chunks: list[Chunk],
        immut_chunks: list[ImmutableChunk],
        intent: str,
        pbar: tqdm | None = None,
    ) -> tuple[list[Chunk], list[ImmutableChunk], list[Chunk | ImmutableChunk]]:
        if not (chunks or immut_chunks):
            return [], [], []

        # 1. Build messages in the format models expect
        changes_json = self._prepare_payload(chunks, immut_chunks)

        messages = [
            build_system_message(self.config.level, self.config.extra_instructions),
            build_user_message(intent, changes_json),
        ]

        # 3. Create callback for progress tracking
        update_callback = None
        if pbar is not None:
            sent_count = 0
            received_count = 0

            def update_callback(status: Literal["sent", "received"]):
                nonlocal sent_count, received_count
                if status == "sent":
                    sent_count += 1
                elif status == "received":
                    received_count += 1

                pbar.set_postfix({"requests": f"{received_count}/{sent_count}"})

        # 2. Call LLM
        try:
            response_text = self.model.invoke(messages, update_callback=update_callback)
            response_data = self._clean_response(response_text)

            rejected_ids = set(response_data.get("rejected_chunk_ids", []))
            reasoning = response_data.get("reasoning", "No reason provided")

            if rejected_ids:
                logger.debug(f"Holistic Filter Reasoning: {reasoning}")

        except Exception as e:
            logger.warning(f"Holistic AI Filter failed: {e}. Defaulting to ACCEPT ALL.")
            return chunks, immut_chunks, []

        # 3. Partition
        accepted_chunks = []
        accepted_immut_chunks = []
        rejected = []

        # Process mutable chunks
        for idx in range(len(chunks)):
            if idx in rejected_ids:
                rejected.append(chunks[idx])
            else:
                accepted_chunks.append(chunks[idx])

        # Process immutable chunks
        idx = len(chunks)
        for immut_chunk in immut_chunks:
            if idx in rejected_ids:
                rejected.append(immut_chunk)
            else:
                accepted_immut_chunks.append(immut_chunk)
            idx += 1

        return accepted_chunks, accepted_immut_chunks, rejected

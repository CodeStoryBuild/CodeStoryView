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

from collections import defaultdict
from pathlib import Path
from typing import Literal

from loguru import logger

from codestory.core.data.chunk import Chunk
from codestory.core.data.composite_diff_chunk import CompositeDiffChunk
from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.semantic_grouper.chunk_lableler import AnnotatedChunk, ChunkLabeler
from codestory.core.semantic_grouper.context_manager import ContextManager
from codestory.core.semantic_grouper.union_find import UnionFind


class SemanticGrouper:
    """
    Groups chunks semantically based on overlapping symbol signatures.

    The grouper flattens composite chunks into individual DiffChunks, generates
    semantic signatures for each chunk, and groups chunks with overlapping signatures
    using a union-find algorithm. Chunks that cannot be analyzed are placed in
    fallback groups based on the configured strategy.
    """

    def __init__(
        self,
        fallback_grouping_strategy: Literal[
            "all_together",
            "by_file_path",
            "by_file_name",
            "by_file_extension",
            "all_alone",
        ] = "all_together",
    ):
        """
        Initialize the SemanticGrouper with a fallback grouping strategy.

        Args:
            fallback_grouping_strategy: Strategy for grouping chunks that fail annotation.
                - 'all_together': All fallback chunks in one group (default)
                - 'by_file_path': Group by complete file path
                - 'by_file_name': Group by file name only
                - 'by_file_extension': Group by file extension
        """
        self.fallback_grouping_strategy = fallback_grouping_strategy

    def group_chunks(
        self, chunks: list[Chunk], context_manager: ContextManager
    ) -> list[CompositeDiffChunk]:
        """
        Group chunks semantically based on overlapping symbol signatures.

        Args:
            chunks: List of chunks to group semantically

        Returns:
            List of semantic groups, with fallback group last if it exists

        Raises:
            ValueError: If chunks list is empty
        """
        if not chunks:
            return []

        # Generate signatures for each chunk
        annotated_chunks = ChunkLabeler.annotate_chunks(chunks, context_manager)

        # Separate chunks that can be analyzed from those that cannot
        analyzable_chunks = []
        fallback_chunks = []

        for annotated_chunk in annotated_chunks:
            if annotated_chunk.signature is not None:
                analyzable_chunks.append(annotated_chunk)
            else:
                # TODO smarter fallback logic, for example using file extensions
                fallback_chunks.append(annotated_chunk.chunk)

        # Group analyzable chunks using Union-Find based on overlapping signatures
        semantic_groups = []
        if analyzable_chunks:
            grouped_chunks = self._group_by_overlapping_signatures(analyzable_chunks)
            semantic_groups.extend(grouped_chunks)

        # Add fallback groups based on the configured strategy
        if fallback_chunks:
            fallback_groups = self._group_fallback_chunks(fallback_chunks)
            semantic_groups.extend(fallback_groups)

        return semantic_groups

    def _flatten_chunks(self, chunks: list[Chunk]) -> list[DiffChunk]:
        """
        Flatten all chunks into a list of DiffChunks.

        Args:
            chunks: List of chunks (may include composite chunks)

        Returns:
            Flattened list of DiffChunks
        """
        diff_chunks = []
        for chunk in chunks:
            diff_chunks.extend(chunk.get_chunks())
        return diff_chunks

    def _get_fallback_sig(self, path: bytes) -> str:
        """
        Get a signature for a file path based on the fallback grouping strategy.

        Args:
            path: The file path as bytes

        Returns:
            A string signature for grouping
        """
        path_str = path.decode("utf-8", errors="replace")

        if self.fallback_grouping_strategy == "all_together":
            return "all"
        elif self.fallback_grouping_strategy == "by_file_path":
            return path_str
        elif self.fallback_grouping_strategy == "by_file_name":
            return Path(path_str).name
        elif self.fallback_grouping_strategy == "by_file_extension":
            return Path(path_str).suffix or "(no extension)"
        else:
            logger.warning(
                f"Unknown fallback_grouping_strategy '{self.fallback_grouping_strategy}', using 'all_together'"
            )
            return "all"

    def _group_fallback_chunks(
        self, fallback_chunks: list[Chunk]
    ) -> list[CompositeDiffChunk]:
        """
        Group fallback chunks based on the configured strategy using union-find.

        Each chunk can contain multiple diff chunks with different paths.
        Chunks are grouped if they share any common signature based on the strategy.

        Args:
            fallback_chunks: Chunks that failed annotation

        Returns:
            List of composite chunks grouped according to the strategy
        """
        if not fallback_chunks:
            return []

        if self.fallback_grouping_strategy == "all_alone":
            # no fallback grouping, just leave each chunk as is
            return [CompositeDiffChunk(chunks=[chunk]) for chunk in fallback_chunks]

        # Build signature sets for each chunk
        chunk_signatures: list[set[str]] = []
        for chunk in fallback_chunks:
            # Get all canonical paths for this chunk (handles composite chunks)
            paths = chunk.canonical_paths()
            # Generate signatures for each path
            sigs = {self._get_fallback_sig(path) for path in paths}
            chunk_signatures.append(sigs)

        # Use union-find to group chunks with overlapping signatures
        chunk_ids = list(range(len(fallback_chunks)))
        uf = UnionFind(chunk_ids)

        # Create inverted index: signature -> list of chunk indices
        sig_to_chunks: dict[str, list[int]] = defaultdict(list)
        for i, sigs in enumerate(chunk_signatures):
            for sig in sigs:
                sig_to_chunks[sig].append(i)

        # Union chunks that share common signatures
        for _, chunk_indices in sig_to_chunks.items():
            if len(chunk_indices) > 1:
                first = chunk_indices[0]
                for i in range(1, len(chunk_indices)):
                    uf.union(first, chunk_indices[i])

        # Group chunks by their root in union-find
        groups: dict[int, list[Chunk]] = defaultdict(list)
        for i in range(len(fallback_chunks)):
            root = uf.find(i)
            groups[root].append(fallback_chunks[i])

        return [
            CompositeDiffChunk(chunks=group_chunks) for group_chunks in groups.values()
        ]

    def _group_by_overlapping_signatures(
        self,
        annotated_chunks: list[AnnotatedChunk],
    ) -> list[CompositeDiffChunk]:
        """
        Group chunks with overlapping signatures using an efficient
        inverted index and Union-Find algorithm.
        Also groups chunks that share the same scope (if scope is not None).
        """
        if not annotated_chunks:
            return []

        logger.debug(f"annotated chunks count={len(annotated_chunks)}")

        chunk_ids = [i for i in range(len(annotated_chunks))]
        signatures = [ac.signature for ac in annotated_chunks]
        if not chunk_ids:
            return []

        uf = UnionFind(chunk_ids)

        # Create an inverted index from symbol -> list of chunk_ids
        symbol_to_chunks: dict[str, list[int]] = defaultdict(list)
        scope_to_chunks: dict[str, list[int]] = defaultdict(list)
        for i, sig in enumerate(signatures):
            # TODO: Consider splitting into two merge classes - one for symbol-based
            # merging and another for scope-based merging to clarify behavior.
            for symbol in (
                sig.total_signature.def_new_symbols
                | sig.total_signature.def_old_symbols
            ):
                symbol_to_chunks[symbol].append(i)
            # TODO we are just plopping all scope info together here, consider if we could separate grouping
            # Convert named scope lists to sets for union operation
            for scope in (
                sig.total_signature.new_named_structural_scopes
                | sig.total_signature.old_named_structural_scopes
                | sig.total_signature.new_structural_scopes
                | sig.total_signature.old_structural_scopes
            ):
                scope_to_chunks[scope].append(i)

        # Union chunks that share common symbols
        for _, ids in symbol_to_chunks.items():
            if len(ids) > 1:
                first_chunk_id = ids[0]
                for i in range(1, len(ids)):
                    uf.union(first_chunk_id, ids[i])

        # Union chunks that share common scopes
        for _, ids in scope_to_chunks.items():
            if len(ids) > 1:
                first_chunk_id = ids[0]
                for i in range(1, len(ids)):
                    uf.union(first_chunk_id, ids[i])

        # Group chunks by their root in the Union-Find structure
        groups: dict[int, list[Chunk]] = defaultdict(list)
        for i in range(len(signatures)):
            root = uf.find(i)
            original_chunk = annotated_chunks[i].chunk
            groups[root].append(original_chunk)

        # Convert to SemanticGroup objects
        return [
            CompositeDiffChunk(chunks=group_chunks) for group_chunks in groups.values()
        ]

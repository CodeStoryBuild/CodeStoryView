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

from dataclasses import dataclass

from loguru import logger

from codestory.core.data.chunk import Chunk
from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.semantic_grouper.context_manager import (
    AnalysisContext,
    ContextManager,
)
from codestory.core.synthesizer.chunk_merger import merge_chunks


@dataclass(frozen=True)
class Signature:
    """Represents the semantic signature of a chunk."""

    languages: set[str]  # Programming languages/File types of the signature
    def_new_symbols: set[str]  # Symbols defined in the new version
    def_old_symbols: set[str]  # Symbols defined in the old version
    extern_new_symbols: set[
        str
    ]  # Symbols referenced but not defined in the new version
    extern_old_symbols: set[
        str
    ]  # Symbols referenced but not defined in the old version
    new_named_structural_scopes: set[str]
    old_named_structural_scopes: set[str]
    # scopes that can only really be used for structural links
    new_structural_scopes: set[str]
    old_structural_scopes: set[str]
    # FQNs constructed from named scopes, used for grouping
    new_fqns: set[str]
    old_fqns: set[str]

    @staticmethod
    def from_signatures(signatures: list["Signature"]) -> "Signature":
        # combine multiple signatures into one big one
        if len(signatures) == 0:
            return Signature(
                set(), set(), set(), set(), set(), set(), set(), set(), set(), set()
            )

        base_sig = next(sig for sig in signatures if sig is not None)
        base_languages = set(base_sig.languages)
        base_new_symbols = set(base_sig.def_new_symbols)
        base_old_symbols = set(base_sig.def_old_symbols)
        base_extern_new_symbols = set(base_sig.extern_new_symbols)
        base_extern_old_symbols = set(base_sig.extern_old_symbols)

        base_new_named_structural_scopes = set(base_sig.new_named_structural_scopes)
        base_old_named_structural_scopes = set(base_sig.old_named_structural_scopes)
        base_new_structural_scopes = set(base_sig.new_structural_scopes)
        base_old_structural_scopes = set(base_sig.old_structural_scopes)

        # Use sets for FQNs
        base_new_fqns = set(base_sig.new_fqns)
        base_old_fqns = set(base_sig.old_fqns)

        for s in signatures:
            if s is None:
                continue
            if s is base_sig:
                continue

            base_languages.update(s.languages)
            base_new_symbols.update(s.def_new_symbols)
            base_old_symbols.update(s.def_old_symbols)
            base_extern_new_symbols.update(s.extern_new_symbols)
            base_extern_old_symbols.update(s.extern_old_symbols)

            base_new_named_structural_scopes.update(s.new_named_structural_scopes)
            base_old_named_structural_scopes.update(s.old_named_structural_scopes)
            base_new_structural_scopes.update(s.new_structural_scopes)
            base_old_structural_scopes.update(s.old_structural_scopes)

            # Union FQN sets
            base_new_fqns.update(s.new_fqns)
            base_old_fqns.update(s.old_fqns)

        return Signature(
            languages=base_languages,
            def_new_symbols=base_new_symbols,
            def_old_symbols=base_old_symbols,
            extern_new_symbols=base_extern_new_symbols,
            extern_old_symbols=base_extern_old_symbols,
            new_named_structural_scopes=base_new_named_structural_scopes,
            old_named_structural_scopes=base_old_named_structural_scopes,
            new_structural_scopes=base_new_structural_scopes,
            old_structural_scopes=base_old_structural_scopes,
            new_fqns=base_new_fqns,
            old_fqns=base_old_fqns,
        )


@dataclass(frozen=True)
class ChunkSignature:
    total_signature: Signature
    # ith index is signature for the ith diffchunk inside chunk.get_chunks()
    signatures: list[Signature | None]


@dataclass(frozen=True)
class AnnotatedChunk:
    """Represents a chunk along with its semantic signature."""

    chunk: Chunk
    signature: ChunkSignature | None


class ChunkLabeler:
    @staticmethod
    def annotate_chunks(
        original_chunks: list[Chunk],
        context_manager: ContextManager,
    ) -> list[AnnotatedChunk]:
        """
        Generate semantic signatures for each original chunk.
        """
        merged_chunks = merge_chunks(original_chunks)
        # ensure these chunks are merged
        annotated_chunks = []

        for chunk in merged_chunks:
            # Get all DiffChunks that belong to this original chunk
            chunk_diff_chunks = chunk.get_chunks()

            # Generate signature for this chunk, which might fail (return None)
            signatures = ChunkLabeler._generate_signatures(
                chunk_diff_chunks, context_manager
            )

            if all(sig is None for sig in signatures):
                # Analysis failed for this chunk
                chunk_signature = None
            else:
                chunk_signature = ChunkSignature(
                    total_signature=Signature.from_signatures(signatures),
                    signatures=signatures,
                )

            annotated = AnnotatedChunk(
                chunk=chunk,
                signature=chunk_signature,
            )

            annotated_chunks.append(annotated)

        return annotated_chunks

    @staticmethod
    def _generate_signatures(
        diff_chunks: list[DiffChunk], context_manager: ContextManager
    ) -> list[Signature | None]:
        """
        Generate a semantic signature for a list of DiffChunks
        """
        if not diff_chunks:
            return []  # No diff chunks, return empty signature list

        signatures = []
        for diff_chunk in diff_chunks:
            if not ChunkLabeler._has_analysis_context(diff_chunk, context_manager):
                logger.debug(
                    f"No analysis for a diff chunk in {diff_chunk.canonical_path().decode('utf-8', errors='replace')}!"
                )
                signatures.append(None)
                continue

            signature = ChunkLabeler._get_signature_for_diff_chunk(
                diff_chunk, context_manager
            )
            signatures.append(signature)

            logger.debug(f"Generated signature for chunk with {signature=}")

        return signatures

    @staticmethod
    def _has_analysis_context(
        diff_chunk: DiffChunk, context_manager: ContextManager
    ) -> bool:
        """
        Check if we have the necessary analysis context for a DiffChunk.

        Args:
            diff_chunk: The DiffChunk to check
            context_manager: ContextManager with analysis contexts

        Returns:
            True if we have context, False otherwise
        """
        if diff_chunk.is_standard_modification:
            # Need both old and new contexts
            file_path = diff_chunk.canonical_path()
            return context_manager.has_context(
                file_path, True
            ) and context_manager.has_context(file_path, False)

        elif diff_chunk.is_file_addition:
            # Need new context only
            return context_manager.has_context(diff_chunk.new_file_path, False)

        elif diff_chunk.is_file_deletion:
            # Need old context only
            return context_manager.has_context(diff_chunk.old_file_path, True)

        elif diff_chunk.is_file_rename:
            # Need both old and new contexts with respective paths
            return context_manager.has_context(
                diff_chunk.old_file_path, True
            ) and context_manager.has_context(diff_chunk.new_file_path, False)

        return False

    @staticmethod
    def _get_signature_for_diff_chunk(
        diff_chunk: DiffChunk, context_manager: ContextManager
    ) -> Signature:
        """
        Generate signature and scope information for a single DiffChunk based on affected line ranges.

        Args:
            diff_chunk: The DiffChunk to analyze
            context_manager: ContextManager with analysis contexts

        Returns:
            Tuple of (symbols, scope) in the affected line ranges.
            Scope is determined by the LCA scope of the chunk's line ranges.
        """
        languages = set()
        def_old_symbols_acc = set()
        def_new_symbols_acc = set()
        extern_old_symbols_acc = set()
        extern_new_symbols_acc = set()

        new_named_structural_scopes_acc = set()
        old_named_structural_scopes_acc = set()
        new_structural_scopes_acc = set()
        old_structural_scopes_acc = set()

        new_fqns_acc = set()  # Use set for FQNs
        old_fqns_acc = set()  # Use set for FQNs

        if diff_chunk.is_standard_modification or diff_chunk.is_file_rename:
            # For modifications/renames, analyze both old and new line ranges

            # Old version signature
            old_name = diff_chunk.old_file_path.decode("utf-8", errors="replace")
            old_context = context_manager.get_context(diff_chunk.old_file_path, True)
            if old_context and diff_chunk.old_start is not None:
                old_end = diff_chunk.old_start + diff_chunk.old_len() - 1
                (
                    def_old_symbols,
                    extern_old_symbols,
                    old_named_structural_scopes,
                    old_structural_scopes,
                    old_fqns,
                ) = ChunkLabeler._get_signature_for_line_range(
                    diff_chunk.old_start, old_end, old_name, old_context
                )
                languages.add(old_context.parsed_file.detected_language)
                def_old_symbols_acc.update(def_old_symbols)
                extern_old_symbols_acc.update(extern_old_symbols)
                old_named_structural_scopes_acc.update(old_named_structural_scopes)
                old_structural_scopes_acc.update(old_structural_scopes)
                old_fqns_acc.update(old_fqns)

            # New version signature
            new_name = diff_chunk.new_file_path.decode("utf-8", errors="replace")
            new_context = context_manager.get_context(diff_chunk.new_file_path, False)
            abs_new_start = diff_chunk.get_abs_new_line_start()
            if new_context and abs_new_start is not None:
                abs_new_end = diff_chunk.get_abs_new_line_end() or abs_new_start
                (
                    def_new_symbols,
                    extern_new_symbols,
                    new_named_structural_scopes,
                    new_structural_scopes,
                    new_fqns,
                ) = ChunkLabeler._get_signature_for_line_range(
                    abs_new_start, abs_new_end, new_name, new_context
                )
                languages.add(new_context.parsed_file.detected_language)
                def_new_symbols_acc.update(def_new_symbols)
                extern_new_symbols_acc.update(extern_new_symbols)
                new_named_structural_scopes_acc.update(new_named_structural_scopes)
                new_structural_scopes_acc.update(new_structural_scopes)
                new_fqns_acc.update(new_fqns)

        elif diff_chunk.is_file_addition:
            # For additions, analyze new version only
            new_name = diff_chunk.new_file_path.decode("utf-8", errors="replace")
            new_context = context_manager.get_context(diff_chunk.new_file_path, False)
            abs_new_start = diff_chunk.get_abs_new_line_start()
            if new_context and abs_new_start is not None:
                abs_new_end = diff_chunk.get_abs_new_line_end() or abs_new_start
                (
                    def_new_symbols_acc,
                    extern_new_symbols_acc,
                    new_named_structural_scopes_acc,
                    new_structural_scopes_acc,
                    new_fqns_acc,
                ) = ChunkLabeler._get_signature_for_line_range(
                    abs_new_start, abs_new_end, new_name, new_context
                )
                languages.add(new_context.parsed_file.detected_language)

        elif diff_chunk.is_file_deletion:
            # For deletions, analyze old version only
            old_name = diff_chunk.old_file_path.decode("utf-8", errors="replace")
            old_context = context_manager.get_context(diff_chunk.old_file_path, True)
            if old_context and diff_chunk.old_start is not None:
                old_end = diff_chunk.old_start + diff_chunk.old_len() - 1
                (
                    def_old_symbols_acc,
                    extern_old_symbols_acc,
                    old_named_structural_scopes_acc,
                    old_structural_scopes_acc,
                    old_fqns_acc,
                ) = ChunkLabeler._get_signature_for_line_range(
                    diff_chunk.old_start, old_end, old_name, old_context
                )
                languages.add(old_context.parsed_file.detected_language)

        return Signature(
            languages=languages,
            def_new_symbols=def_new_symbols_acc,
            def_old_symbols=def_old_symbols_acc,
            extern_new_symbols=extern_new_symbols_acc,
            extern_old_symbols=extern_old_symbols_acc,
            new_named_structural_scopes=new_named_structural_scopes_acc,
            old_named_structural_scopes=old_named_structural_scopes_acc,
            new_structural_scopes=new_structural_scopes_acc,
            old_structural_scopes=old_structural_scopes_acc,
            new_fqns=new_fqns_acc,
            old_fqns=old_fqns_acc,
        )

    @staticmethod
    def _get_signature_for_line_range(
        start_line: int, end_line: int, file_name: str, context: AnalysisContext
    ) -> tuple[set[str], set[str], set[str], set[str], set[str]]:
        """
        Get signature and scope information for a specific line range using the analysis context.

        Args:
            start_line: Starting line number (1-indexed)
            end_line: Ending line number (1-indexed, inclusive)
            context: AnalysisContext containing symbol map and scope map

        Returns:
            Tuple of (defined symbols, external symbols, named scopes, structural scopes, fqns) for the specified line range.
            FQNs are constructed by tracking scope changes line-by-line to handle chunks spanning multiple scopes.
        """
        defined_range_symbols = set()
        extern_range_symbols = set()
        named_structural_scopes_range = set()
        structural_scopes_range = set()
        fqns = set()  # Set of fully qualified names

        if start_line < 1 or end_line < start_line:
            # Chunks that are pure deletions can fall into this
            return (
                defined_range_symbols,
                extern_range_symbols,
                named_structural_scopes_range,
                structural_scopes_range,
                fqns,
            )

        # convert to zero indexed
        start_index = start_line - 1
        end_index = end_line - 1

        # Track scope stack for FQN construction
        scope_stack = []
        prev_scopes_list = []
        scopes_added_since_last_save = False

        # Collect symbols from all lines in the range
        for line in range(start_index, end_index + 1):
            # Symbols explicitly defined on this line
            defined_line_symbols = context.symbol_map.modified_line_symbols.get(line)
            # Symbols referenced on this line but not defined in this file/version
            extern_line_symbols = context.symbol_map.extern_line_symbols.get(line)

            if defined_line_symbols:
                defined_range_symbols.update(defined_line_symbols)

            if extern_line_symbols:
                extern_range_symbols.update(extern_line_symbols)

            # Get named scopes for this line (already sorted)
            current_scopes_list = context.scope_map.semantic_named_scopes.get(line, [])

            # Detect scope changes by comparing lists
            # Find the common prefix length
            common_prefix_len = 0
            for i in range(min(len(prev_scopes_list), len(current_scopes_list))):
                if prev_scopes_list[i] == current_scopes_list[i]:
                    common_prefix_len += 1
                else:
                    break

            # If we lost scopes (current is shorter or diverges), save the current FQN
            if len(prev_scopes_list) > common_prefix_len and scope_stack:
                fqn = f"{file_name}:{'.'.join(scope_stack)}"
                if fqn:  # Only add non-empty FQNs
                    fqns.add(fqn)
                    scopes_added_since_last_save = False  # Reset after saving

            # Update the stack to match current scopes
            # Keep only the common prefix
            scope_stack = current_scopes_list[:common_prefix_len]

            # Add any new scopes from current
            if len(current_scopes_list) > common_prefix_len:
                scope_stack.extend(current_scopes_list[common_prefix_len:])
                scopes_added_since_last_save = True  # Mark that we added scopes

            prev_scopes_list = current_scopes_list

            # Collect structural scopes
            named_structural_scopes = (
                context.scope_map.structural_named_scope_lines.get(line)
            )
            if named_structural_scopes:
                named_structural_scopes_range.update(named_structural_scopes)

            structural_scopes = context.scope_map.structural_scope_lines.get(line)
            if structural_scopes:
                structural_scopes_range.update(structural_scopes)

        # At the end, only save if we have a stack AND we've added scopes since the last save
        if scope_stack and scopes_added_since_last_save:
            fqn = f"{file_name}:{'.'.join(scope_stack)}"
            if fqn:
                fqns.add(fqn)

        return (
            defined_range_symbols,
            extern_range_symbols,
            named_structural_scopes_range,
            structural_scopes_range,
            fqns,
        )

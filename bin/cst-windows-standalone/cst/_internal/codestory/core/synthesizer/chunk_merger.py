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

from itertools import groupby

from loguru import logger

from codestory.core.data.chunk import Chunk
from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.data.line_changes import Addition, Removal


def __is_contiguous(last_chunk: DiffChunk, current_chunk: DiffChunk) -> bool:
    """
    Determines if two DiffChunks are contiguous and can be merged.

    We check contiguity based STRICTLY on old file coordinates.
    """
    # Always use old_len to determine the end in the old file.
    # Pure additions have old_len=0, meaning they end where they start.
    last_old_end = (last_chunk.old_start or 0) + last_chunk.old_len()
    current_old_start = current_chunk.old_start or 0

    # 1. Strict Overlap: Always merge (handles standard modifications)
    if last_old_end > current_old_start:
        return True

    # 2. Touching: Merge only if types are compatible (Same Type)
    if last_old_end == current_old_start:
        # Pure Add + Pure Add (at same line) -> Merge
        return (last_chunk.pure_addition() and current_chunk.pure_addition()) or (
            last_chunk.pure_deletion() and current_chunk.pure_deletion()
        )

    # Disjoint
    return False


def __merge_diff_chunks(sorted_chunks: list[DiffChunk]) -> list[DiffChunk]:
    """
    Merges a list of sorted, atomic DiffChunks into the smallest possible
    list of larger, valid DiffChunks.

    This acts as the inverse of the `split_into_atomic_chunks` method. It
    first groups adjacent chunks and then merges each group into a single
    new chunk using the `from_parsed_content_slice` factory.

    Args:
        sorted_chunks: List of DiffChunks sorted by their sort key (old_start, then abs_new_line).
                      Should all be from the same file.

    Returns:
        List of merged DiffChunks with redundant splits removed.
    """
    if not sorted_chunks:
        return []

    if len(sorted_chunks) <= 1:
        return sorted_chunks

    # Group all contiguous chunks together.
    groups = []
    current_group = [sorted_chunks[0]]
    for i in range(1, len(sorted_chunks)):
        last_chunk = current_group[-1]
        current_chunk = sorted_chunks[i]

        if __is_contiguous(last_chunk, current_chunk):
            current_group.append(current_chunk)
        else:
            logger.debug(f"Current merge group: {current_group}")
            groups.append(current_group)
            current_group = [current_chunk]

    logger.debug(f"Current merge group: {current_group}")
    groups.append(current_group)

    # Merge each group into a single new DiffChunk.
    final_chunks = []
    for group in groups:
        if len(group) == 1:
            # No merging needed for groups of one.
            final_chunks.append(group[0])
            continue

        # Flatten the content from all chunks in the group.
        merged_parsed_content = []
        removals = []
        additions = []

        # Also combine the newline markers.
        contains_newline_fallback = False

        for chunk in group:
            removals.extend([c for c in chunk.parsed_content if isinstance(c, Removal)])
            additions.extend(
                [c for c in chunk.parsed_content if isinstance(c, Addition)]
            )
            contains_newline_fallback |= chunk.contains_newline_fallback

        merged_parsed_content.extend(removals)
        merged_parsed_content.extend(additions)

        # Let the factory method do the hard work of creating the new valid chunk.
        merged_chunk = DiffChunk.from_parsed_content_slice(
            old_file_path=group[0].old_file_path,
            new_file_path=group[0].new_file_path,
            file_mode=group[0].file_mode,
            contains_newline_fallback=contains_newline_fallback,
            parsed_slice=merged_parsed_content,
        )
        final_chunks.append(merged_chunk)

    return final_chunks


def merge_diff_chunks_by_file(diff_chunks: list[DiffChunk]) -> list[DiffChunk]:
    """
    Groups DiffChunks by file path, then merges chunks within each file.

    This is the core method that takes a list of DiffChunks (potentially from multiple files),
    groups them by their canonical path, sorts them within each file group, and merges
    contiguous chunks.

    Args:
        diff_chunks: List of DiffChunks potentially from multiple files.

    Returns:
        List of merged DiffChunks with redundant splits removed.
    """
    if not diff_chunks:
        return []

    if len(diff_chunks) <= 1:
        return diff_chunks

    merged_chunks = []

    # Group by file path
    sorted_by_file = sorted(diff_chunks, key=lambda c: c.canonical_path())

    for _, file_chunks_iter in groupby(
        sorted_by_file, key=lambda c: c.canonical_path()
    ):
        file_chunks = list(file_chunks_iter)

        # Sort chunks within the file by their sort key
        sorted_file_chunks = sorted(file_chunks, key=lambda c: c.get_sort_key())

        # Merge contiguous chunks within this file
        merged_file_chunks = __merge_diff_chunks(sorted_file_chunks)
        merged_chunks.extend(merged_file_chunks)

    return merged_chunks


def merge_chunk(chunk: Chunk) -> Chunk:
    """
    Convenience method to merge DiffChunks within a single Chunk.

    Takes a Chunk (which may be a composite containing multiple DiffChunks),
    extracts its DiffChunks, merges them, and returns a new Chunk.

    Args:
        chunk: A Chunk object containing DiffChunks to merge.

    Returns:
        A new Chunk with merged DiffChunks (CompositeDiffChunk).
    """
    from codestory.core.data.composite_diff_chunk import CompositeDiffChunk

    diff_chunks = chunk.get_chunks()

    if len(diff_chunks) <= 1:
        return chunk

    merged = merge_diff_chunks_by_file(diff_chunks)

    return CompositeDiffChunk(chunks=merged)


def merge_chunks(chunks: list[Chunk]) -> list[Chunk]:
    """
    Convenience method to merge DiffChunks within each Chunk in a list.

    Processes each Chunk individually, merging its internal DiffChunks,
    and returns a new list of cleaned Chunks.

    Args:
        chunks: List of Chunks to process.

    Returns:
        List of new Chunks with merged DiffChunks.
    """
    if not chunks:
        return []

    return [merge_chunk(chunk) for chunk in chunks]

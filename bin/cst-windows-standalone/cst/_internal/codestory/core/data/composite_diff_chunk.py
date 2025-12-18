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

from codestory.core.data.chunk import Chunk


@dataclass(frozen=True)
class CompositeDiffChunk:
    """
    Represents a composite diff chunk that contains multiple DiffChunk instances.

    This allows grouping multiple related chunks together while maintaining the ability
    to process them as a single logical unit.

    Attributes:
        chunks: List of DiffChunk objects that make up this composite chunk
    """

    chunks: list[Chunk]

    def __post_init__(self):
        if len(self.chunks) <= 0:
            raise RuntimeError("Chunks must be a nonempty list!")

    def canonical_paths(self):
        """
        Return the canonical paths for this composite chunk.
        """
        paths = []

        for chunk in self.chunks:
            paths.extend(chunk.canonical_paths())

        return list(set(paths))

    def hunk_ranges(self) -> dict[bytes, list[tuple[int, int, int, int]]]:
        """
        Aggregate hunk ranges from all child chunks.

        Returns a dict keyed by canonical path (bytes) with lists of tuples
        describing (old_start, old_len, new_start, new_len). If multiple
        child chunks reference the same path, their ranges are concatenated.
        """
        aggregated: dict[bytes, list[tuple[int, int, int, int]]] = {}
        for chunk in self.chunks:
            for path, path_ranges in chunk.hunk_ranges().items():
                aggregated.setdefault(path, []).extend(path_ranges)

        return aggregated

    def get_chunks(self) -> list:
        chunks = []
        for chunk in self.chunks:
            chunks.extend(chunk.get_chunks())

        return chunks

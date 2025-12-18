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

from abc import abstractmethod
from itertools import groupby

from codestory.core.data.chunk import Chunk
from codestory.core.data.commit_group import CommitGroup
from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.data.immutable_chunk import ImmutableChunk


class DiffGenerator:
    def __init__(self, all_chunks: list[Chunk | ImmutableChunk | CommitGroup]):
        diff_chunks = []
        # flattening all diff chunks
        for chunk in all_chunks:
            if isinstance(chunk, Chunk):
                diff_chunks.extend(chunk.get_chunks())
            elif isinstance(chunk, CommitGroup):
                for group_chunk in chunk.chunks:
                    if isinstance(group_chunk, Chunk):
                        diff_chunks.extend(group_chunk.get_chunks())
            # else skip Immutable Chunks, they dont use total chunks per file

        self.__validate_chunks_are_disjoint(diff_chunks)

        self.total_chunks_per_file = self.__get_total_chunks_per_file(diff_chunks)

    def __validate_chunks_are_disjoint(self, chunks: list[DiffChunk]) -> bool:
        """Validate that all chunks are pairwise disjoint in old file coordinates.

        This is a critical invariant: chunks must not overlap in the old file
        for them to be safely applied in any order.

        Returns True if all chunks are disjoint, raises RuntimeError otherwise.
        """
        from itertools import groupby

        # Group by file
        sorted_chunks = sorted(chunks, key=lambda c: c.canonical_path())
        for file_path, file_chunks_iter in groupby(
            sorted_chunks, key=lambda c: c.canonical_path()
        ):
            file_chunks = list(file_chunks_iter)

            # Sort by old_start within each file
            file_chunks.sort(key=lambda c: c.old_start or 0)

            # Check each adjacent pair for overlap
            for i in range(len(file_chunks) - 1):
                chunk_a = file_chunks[i]
                chunk_b = file_chunks[i + 1]

                if not chunk_a.is_disjoint_from(chunk_b):
                    raise RuntimeError(
                        f"INVARIANT VIOLATION: Chunks are not disjoint!\n"
                        f"File: {file_path}\n"
                        f"Chunk A: old_start={chunk_a.old_start}, old_len={chunk_a.old_len()}\n"
                        f"Chunk B: old_start={chunk_b.old_start}, old_len={chunk_b.old_len()}\n"
                        f"These chunks overlap in old file coordinates!"
                    )

        return True

    def __get_total_chunks_per_file(self, chunks: list[DiffChunk]):
        total_chunks_per_file = {}
        for file_path, file_chunks_iter in groupby(
            sorted(chunks, key=lambda c: c.canonical_path()),
            key=lambda c: c.canonical_path(),
        ):
            total_chunks_per_file[file_path] = len(list(file_chunks_iter))

        return total_chunks_per_file

    @abstractmethod
    def generate_diff(
        self,
        diff_chunks: list[DiffChunk],
        immutable_chunks: list[ImmutableChunk] | None = None,
    ) -> dict[bytes, bytes]:
        pass

    @staticmethod
    def sanitize_filename(filename: bytes) -> bytes:
        """
        Sanitize a filename for use in git patch headers.

        - Escapes spaces with backslashes.
        - Removes any trailing tabs.
        - Leaves other characters unchanged.
        """
        return filename.rstrip(b"\t").strip()  # remove trailing tabs

    def get_patch(
        self, chunk: list[Chunk | ImmutableChunk | CommitGroup], is_bytes: bool = False
    ) -> str | bytes:
        diff_chunks = []
        immutable_chunks = []

        if isinstance(chunk, CommitGroup):
            for group_chunk in chunk.chunks:
                if isinstance(group_chunk, ImmutableChunk):
                    immutable_chunks.append(group_chunk)
                else:
                    diff_chunks.extend(group_chunk.get_chunks())
        elif isinstance(chunk, ImmutableChunk):
            immutable_chunks.append(chunk)
        elif isinstance(chunk, Chunk):
            # kinda redundant check but for type checking
            diff_chunks.extend(chunk.get_chunks())

            diff_chunks = chunk.get_chunks()
        patches = self.generate_diff(diff_chunks, immutable_chunks)

        if patches:
            # sort by file name
            ordered_items = sorted(patches.items(), key=lambda kv: kv[0])
            combined_patch = b"".join(patch for _, patch in ordered_items)
        else:
            combined_patch = b""

        if is_bytes:
            return combined_patch
        else:
            return combined_patch.decode("utf-8", errors="replace")

    def get_patches(
        self, chunks: list[Chunk | ImmutableChunk | CommitGroup], is_bytes: bool = False
    ) -> dict[int, str | bytes]:
        patch_map = {}
        for i, chunk in enumerate(chunks):
            patch_map[i] = self.get_patch(chunk, is_bytes=is_bytes)

        return patch_map

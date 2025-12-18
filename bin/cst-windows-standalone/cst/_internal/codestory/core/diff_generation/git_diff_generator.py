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

from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.data.line_changes import Addition, Removal
from codestory.core.diff_generation.diff_generator import DiffGenerator
from codestory.core.git_commands.git_const import DEVNULLBYTES
from codestory.core.synthesizer.chunk_merger import merge_diff_chunks_by_file


class GitDiffGenerator(DiffGenerator):
    def generate_diff(
        self,
        diff_chunks: list[DiffChunk],
        immutable_chunks: list[ImmutableChunk] | None = None,
    ) -> dict[bytes, bytes]:
        """
        Generates a dictionary of valid, cumulative unified diffs (patches) for each file.
        This method is stateful and correctly recalculates hunk headers for subsets of chunks.

        Args:
            diff_chunks: List of DiffChunks to generate patches for.
            immutable_chunks: Optional list of ImmutableChunks with pre-computed patches.
        """
        if immutable_chunks is None:
            immutable_chunks = []

        patches: dict[bytes, bytes] = {}

        # process immutable chunks
        for immutable_chunk in immutable_chunks:
            # add newline delimiter to sepatate from other patches in the stream
            patches[immutable_chunk.canonical_path] = immutable_chunk.file_patch + b"\n"

        # Merge diff chunks by file to remove redundant splits
        merged_chunks = merge_diff_chunks_by_file(diff_chunks)

        # process regular chunks
        sorted_chunks = sorted(merged_chunks, key=lambda c: c.canonical_path())

        for file_path, file_chunks_iter in groupby(
            sorted_chunks, key=lambda c: c.canonical_path()
        ):
            file_chunks: list[DiffChunk] = list(file_chunks_iter)

            if not file_chunks:
                continue

            current_count = len(file_chunks)
            total_expected = self.total_chunks_per_file.get(file_path)

            patch_lines = []
            single_chunk = file_chunks[0]

            # we need all chunks to mark as deletion
            file_deletion = (
                all([file_chunk.is_file_deletion for file_chunk in file_chunks])
                and current_count >= total_expected
            )
            file_addition = all(
                [file_chunk.is_file_addition for file_chunk in file_chunks]
            )
            standard_modification = all(
                [file_chunk.is_standard_modification for file_chunk in file_chunks]
            ) or (
                all([file_chunk.is_file_deletion for file_chunk in file_chunks])
                and current_count < total_expected
            )
            file_rename = all([file_chunk.is_file_rename for file_chunk in file_chunks])

            # Determine file change type for hunk calculation
            if file_addition:
                file_change_type = "added"
            elif file_deletion:
                file_change_type = "deleted"
            elif file_rename:
                file_change_type = "renamed"
            else:
                file_change_type = "modified"

            old_file_path = (
                self.sanitize_filename(single_chunk.old_file_path)
                if single_chunk.old_file_path
                else None
            )
            new_file_path = (
                self.sanitize_filename(single_chunk.new_file_path)
                if single_chunk.new_file_path
                else None
            )

            if standard_modification:
                if single_chunk.is_file_deletion:
                    # use old file and "pretend its a modification as we dont have all deletion chunks yet"
                    patch_lines.append(
                        b"diff --git a/" + old_file_path + b" b/" + old_file_path
                    )
                else:
                    patch_lines.append(
                        b"diff --git a/" + new_file_path + b" b/" + new_file_path
                    )
            elif file_rename:
                patch_lines.append(
                    b"diff --git a/" + old_file_path + b" b/" + new_file_path
                )
                patch_lines.append(b"rename from " + old_file_path)
                patch_lines.append(b"rename to " + new_file_path)
            elif file_deletion:
                # Treat partial deletions as a modification for the header
                patch_lines.append(
                    b"diff --git a/" + old_file_path + b" b/" + old_file_path
                )
                patch_lines.append(
                    b"deleted file mode " + (single_chunk.file_mode or b"100644")
                )
            elif file_addition:
                patch_lines.append(
                    b"diff --git a/" + new_file_path + b" b/" + new_file_path
                )
                patch_lines.append(
                    b"new file mode " + (single_chunk.file_mode or b"100644")
                )

            old_file_header = b"a/" + old_file_path if old_file_path else DEVNULLBYTES
            new_file_header = b"b/" + new_file_path if new_file_path else DEVNULLBYTES
            if single_chunk.is_file_deletion and current_count < total_expected:
                new_file_header = old_file_header

            patch_lines.append(b"--- " + old_file_header)
            patch_lines.append(b"+++ " + new_file_header)

            if not any(c.has_content for c in file_chunks):
                patch_lines.append(b"@@ -0,0 +0,0 @@")
            else:
                # Sort chunks by their sort key (old_start, then abs_new_line)
                # This maintains correct ordering even for chunks at the same old_start
                sorted_file_chunks = sorted(file_chunks, key=lambda c: c.get_sort_key())

                # new_start is calculated here and only here!
                # We calculate it based on old_start + cumulative_offset.
                # - old_start tells us where the change occurs in the old file
                # - new_start = old_start + cumulative_offset (where it lands in new file)

                cumulative_offset = 0  # Net lines added so far (additions - deletions)

                for chunk in sorted_file_chunks:
                    if not chunk.has_content:
                        continue

                    old_len = chunk.old_len()
                    new_len = chunk.new_len()
                    is_pure_addition = old_len == 0

                    # Use the helper function to calculate hunk starts
                    hunk_old_start, hunk_new_start = self.__calculate_hunk_starts(
                        file_change_type=file_change_type,
                        old_start=chunk.old_start,
                        is_pure_addition=is_pure_addition,
                        cumulative_offset=cumulative_offset,
                    )

                    hunk_header = f"@@ -{hunk_old_start},{old_len} +{hunk_new_start},{new_len} @@".encode()
                    patch_lines.append(hunk_header)

                    for item in chunk.parsed_content:
                        if isinstance(item, Removal):
                            patch_lines.append(b"-" + item.content)
                        elif isinstance(item, Addition):
                            patch_lines.append(b"+" + item.content)
                        if item.newline_marker:
                            patch_lines.append(b"\\ No newline at end of file")

                    # Update cumulative offset for next chunk
                    cumulative_offset += new_len - old_len

                # Handle the no-newline marker fallback for the last chunk in the file
                # (added if a hunk has only this marker and thus no other changes to attach itself to)
                if (
                    sorted_file_chunks
                    and sorted_file_chunks[-1].contains_newline_fallback
                ):
                    patch_lines.append(b"\\ No newline at end of file")

            file_patch = b"\n".join(patch_lines) + b"\n"
            patches[file_path] = file_patch

        return patches

    def __calculate_hunk_starts(
        self,
        file_change_type: str,
        old_start: int,
        is_pure_addition: bool,
        cumulative_offset: int,
    ) -> tuple[int, int]:
        """
        Calculate the old_start and new_start for a hunk header based on file change type.

        Args:
            file_change_type: One of "added", "deleted", "modified", "renamed"
            old_start: The old_start from the chunk (in old file coordinates)
            is_pure_addition: Whether this is a pure addition (old_len == 0)
            cumulative_offset: Cumulative net lines added so far

        Returns:
            Tuple of (hunk_old_start, hunk_new_start) for the @@ header
        """
        if file_change_type == "added":
            # File addition: old side is always -0,0
            hunk_old_start = 0
            # new_start adjustment: +1 unless already at line 1
            hunk_new_start = old_start + cumulative_offset + 1
        elif file_change_type == "deleted":
            # File deletion: new side is always +0,0
            hunk_old_start = old_start
            hunk_new_start = 0
        elif is_pure_addition:
            # Pure addition (not a new file): @@ -N,0 +M,len @@
            hunk_old_start = old_start
            # new_start adjustment: +1 unless already at line 1
            hunk_new_start = old_start + cumulative_offset + 1
        else:
            # Deletion, modification, or rename: @@ -N,len +M,len @@
            hunk_old_start = old_start
            hunk_new_start = old_start + cumulative_offset

        return (hunk_old_start, hunk_new_start)

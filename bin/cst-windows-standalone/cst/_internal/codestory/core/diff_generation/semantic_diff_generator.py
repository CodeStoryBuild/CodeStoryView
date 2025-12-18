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
from codestory.core.synthesizer.chunk_merger import merge_diff_chunks_by_file


class SemanticDiffGenerator(DiffGenerator):
    """
    Generates a semantic, human-readable diff optimized for LLMs (1.5B+).
    It strictly follows the DiffGenerator architecture to ensure correct
    File Status detection (Renames, Partial Deletions, etc).

    Output Format:
    ### MODIFIED FILE: src/utils.py
    Line 20:
    - old_code()
    + new_code()
    """

    def generate_diff(
        self,
        diff_chunks: list[DiffChunk],
        immutable_chunks: list[ImmutableChunk] | None = None,
    ) -> dict[bytes, bytes]:
        """
        Generates a dictionary of semantic diff strings (encoded as bytes) for each file.
        """
        if immutable_chunks is None:
            immutable_chunks = []

        patches: dict[bytes, bytes] = {}

        # 1. Process Immutable Chunks
        for immutable_chunk in immutable_chunks:
            semantic_patch = (
                b"### BINARY FILE:"
                + immutable_chunk.canonical_path
                + b"\n"
                + immutable_chunk.file_patch
            )
            patches[immutable_chunk.canonical_path] = semantic_patch

        # 2. Merge diff chunks to reduce fragmentation
        merged_chunks = merge_diff_chunks_by_file(diff_chunks)

        # 3. Sort chunks
        sorted_chunks = sorted(merged_chunks, key=lambda c: c.canonical_path())

        # 4. Group by file
        for file_path, file_chunks_iter in groupby(
            sorted_chunks, key=lambda c: c.canonical_path()
        ):
            file_chunks: list[DiffChunk] = list(file_chunks_iter)

            if not file_chunks:
                continue

            # --- LOGIC MIRRORING GITDIFFGENERATOR STARTS HERE ---

            current_count = len(file_chunks)
            total_expected = self.total_chunks_per_file.get(file_path)

            single_chunk = file_chunks[0]

            # We need all chunks to mark as deletion
            file_deletion = (
                all([file_chunk.is_file_deletion for file_chunk in file_chunks])
                and current_count >= total_expected
            )
            file_addition = all(
                [file_chunk.is_file_addition for file_chunk in file_chunks]
            )
            # Standard modification OR a deletion where we don't have all chunks yet
            standard_modification = all(
                [file_chunk.is_standard_modification for file_chunk in file_chunks]
            ) or (
                all([file_chunk.is_file_deletion for file_chunk in file_chunks])
                and current_count < total_expected
            )
            file_rename = all([file_chunk.is_file_rename for file_chunk in file_chunks])

            # Prepare string buffers
            out_lines = []

            # Decode paths for LLM readability
            old_path_str = (
                single_chunk.old_file_path.decode("utf-8", errors="replace")
                if single_chunk.old_file_path
                else "dev/null"
            )
            new_path_str = (
                single_chunk.new_file_path.decode("utf-8", errors="replace")
                if single_chunk.new_file_path
                else "dev/null"
            )

            # --- HEADER GENERATION ---

            if standard_modification:
                # If partial deletion, we fallback to old_path (just like diff --git a/old b/old)
                if single_chunk.is_file_deletion:
                    out_lines.append(f"### MODIFIED FILE: {old_path_str}")
                else:
                    out_lines.append(f"### MODIFIED FILE: {new_path_str}")
            elif file_rename:
                out_lines.append(f"### RENAMED FILE: {old_path_str} -> {new_path_str}")
            elif file_deletion:
                out_lines.append(f"### DELETED FILE: {old_path_str}")
            elif file_addition:
                out_lines.append(f"### NEW FILE: {new_path_str}")
            else:
                # Fallback for mixed states
                out_lines.append(f"### MODIFIED FILE: {new_path_str}")

            # If it's a rename with no content changes, we are done
            has_content = any(c.has_content for c in file_chunks)
            if file_rename and not has_content:
                patches[file_path] = ("\n".join(out_lines) + "\n").encode("utf-8")
                continue

            # --- BODY GENERATION ---

            # Sort chunks by their sort key (old_start)
            sorted_file_chunks = sorted(file_chunks, key=lambda c: c.get_sort_key())

            for i, chunk in enumerate(sorted_file_chunks):
                if not chunk.has_content:
                    continue

                # Visual separator for disjoint chunks in the same file
                if i > 0:
                    out_lines.append("...")

                # Header for the chunk location.
                # We skip detailed range info (@@ -12,4 +12,5 @@) as it confuses small models.
                # New files (additions) effectively start at 0, so explicit lines are less relevant.
                if not file_addition:
                    start_line = chunk.old_start if chunk.old_start is not None else 0
                    out_lines.append(f"Line {start_line}:")

                # Process lines
                if chunk.parsed_content:
                    for item in chunk.parsed_content:
                        text = item.content.decode("utf-8", errors="replace").rstrip()
                        if isinstance(item, Removal):
                            out_lines.append(f"- {text}")
                        elif isinstance(item, Addition):
                            out_lines.append(f"+ {text}")

            # Join and encode to bytes
            final_output = "\n".join(out_lines) + "\n"
            patches[file_path] = final_output.encode("utf-8")

        return patches

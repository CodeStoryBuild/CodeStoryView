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

import re
from itertools import groupby

from codestory.core.data.chunk import Chunk
from codestory.core.data.composite_diff_chunk import CompositeDiffChunk
from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.data.hunk_wrapper import HunkWrapper
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.data.immutable_hunk_wrapper import ImmutableHunkWrapper
from codestory.core.git_commands.git_const import EMPTYTREEHASH
from codestory.core.git_interface.interface import GitInterface


class GitCommands:
    def __init__(self, git: GitInterface):
        self.git = git

    # Precompile diff regexes for performance
    _MODE_RE = re.compile(
        rb"^(?:new file mode|deleted file mode|old mode|new mode) (\d{6})$"
    )
    _INDEX_RE = re.compile(rb"^index [0-9a-f]{7,}\.\.[0-9a-f]{7,}(?: (\d{6}))?$")
    _RENAME_FROM_RE = re.compile(rb"^rename from (.+)$")
    _RENAME_TO_RE = re.compile(rb"^rename to (.+)$")
    _OLD_PATH_RE = re.compile(rb"^--- (?:(?:a/)?(.+)|/dev/null)$")
    _NEW_PATH_RE = re.compile(rb"^\+\+\+ (?:(?:b/)?(.+)|/dev/null)$")
    _A_B_PATHS_RE = re.compile(rb".*a/(.+?) b/(.+)")

    def get_full_working_diff(
        self,
        base_hash: str,
        new_hash: str,
        target: str | None = None,
        similarity: int = 50,
    ) -> list[HunkWrapper | ImmutableHunkWrapper]:
        """
        Generates a list of raw hunks, correctly parsing rename-and-modify diffs.
        This is the authoritative source of diff information.
        """
        path_args = ["--"] + ([target] if target else [])
        diff_output_bytes = self.git.run_git_binary_out(
            [
                "diff",
                base_hash,
                new_hash,
                "--binary",
                "--unified=0",
                f"-M{similarity}",
            ]
            + path_args
        )
        binary_files = self._get_binary_files(base_hash, new_hash)
        return self._parse_hunks_with_renames(diff_output_bytes, binary_files)

    def _get_binary_files(self, base: str, new: str) -> set[bytes]:
        """
        Generates a set of file paths that are identified as binary by
        `git diff --numstat`.
        """
        binary_files: set[bytes] = set()
        cmd = ["diff", "--numstat", base, new]
        numstat_output = self.git.run_git_binary_out(cmd)
        if numstat_output is None:
            return binary_files

        if not numstat_output:
            return binary_files

        for line in numstat_output.splitlines():
            parts = line.split(b"\t")
            if len(parts) == 3 and parts[0] == b"-" and parts[1] == b"-":
                path_part = parts[2]
                if b" => " in path_part:
                    # Handle rename syntax `old => new` or `prefix/{old=>new}/suffix`
                    # by extracting the new path.
                    pre, _, post = path_part.partition(b"{")
                    if post:
                        rename_part, _, suffix = post.partition(b"}")
                        _, _, new_name = rename_part.partition(b" => ")
                        binary_files.add(pre + new_name + suffix)
                    else:
                        _, _, new_path = path_part.partition(b" => ")
                        binary_files.add(new_path)
                else:
                    binary_files.add(path_part)
        return binary_files

    def _is_binary_or_unparsable(
        self,
        diff_lines: list[bytes],
        file_mode: bytes | None,
        file_path: bytes | None,
        binary_files_from_numstat: set[bytes],
    ) -> bool:
        """
        Detects if a diff block is for a binary file, submodule, symlink,
        or other format that cannot be represented by standard hunk chunks.
        """
        # 1. Check against the set of binary files from `git diff --numstat`.
        if file_path and file_path in binary_files_from_numstat:
            return True

        # 2. File modes for submodules (160000) and symlinks (120000) are unparsable.
        if file_mode in {b"160000", b"120000"}:
            return True

        # 3. Check for explicit statements in the diff output as a fallback.
        for line in diff_lines:
            if line.startswith(b"Binary files ") or b"Subproject commit" in line:
                return True
        return False

    def _parse_hunks_with_renames(
        self, diff_output: bytes | None, binary_files: set[bytes]
    ) -> list[HunkWrapper | ImmutableHunkWrapper]:
        """
        Parses a unified diff output, detects binary/unparsable files,
        and creates appropriate HunkWrapper or ImmutableHunkWrapper objects.
        """
        hunks: list[HunkWrapper | ImmutableHunkWrapper] = []
        if not diff_output:
            return hunks

        file_blocks = diff_output.split(b"\ndiff --git ")

        for block in file_blocks:
            if not block.strip():
                continue

            # the first block will still have a diff --git, otherwise we need to add one
            if not block.startswith(b"diff --git "):
                block = b"diff --git " + block

            lines = block.splitlines()
            if not lines:
                continue

            old_path, new_path, file_mode = self._parse_file_metadata(lines)

            if old_path is None and new_path is None:
                raise ValueError(
                    "Both old and new file paths are None! Invalid /dev/null parsing!"
                )
            elif not old_path and not new_path:
                raise ValueError("Could not parse file paths from diff block!")

            path_to_check = new_path if new_path is not None else old_path

            if self._is_binary_or_unparsable(
                lines, file_mode, path_to_check, binary_files
            ):
                # add back the "diff -git"
                hunks.append(
                    ImmutableHunkWrapper(canonical_path=path_to_check, file_patch=block)
                )
                continue

            hunk_start_indices = [
                i for i, line in enumerate(lines) if line.startswith(b"@@ ")
            ]

            if not hunk_start_indices:
                hunks.append(
                    HunkWrapper.create_empty_content(
                        new_file_path=new_path,
                        old_file_path=old_path,
                        file_mode=file_mode,
                    )
                )
            else:
                for i, start_idx in enumerate(hunk_start_indices):
                    end_idx = (
                        hunk_start_indices[i + 1]
                        if i + 1 < len(hunk_start_indices)
                        else len(lines)
                    )
                    hunk_header = lines[start_idx]
                    hunk_body_lines = lines[start_idx + 1 : end_idx]

                    old_start, old_len, new_start, new_len = self._parse_hunk_start(
                        hunk_header
                    )

                    hunks.append(
                        HunkWrapper(
                            new_file_path=new_path,
                            old_file_path=old_path,
                            file_mode=file_mode,
                            hunk_lines=hunk_body_lines,
                            old_start=old_start,
                            new_start=new_start,
                            old_len=old_len,
                            new_len=new_len,
                        )
                    )
        return hunks

    def _parse_file_metadata(self, lines: list[bytes]) -> tuple:
        """
        Extracts file operation metadata from a diff block by unifying the logic
        around the '---' and '+++' file path lines.

        Returns a dictionary with file paths, operation flags, and mode information.
        """
        old_path, new_path = b"", b""
        file_mode = None

        # 1. First pass: Extract primary data (paths and mode)
        for line in lines:
            # Check for file mode (new, deleted, old, new)
            mode_match = self._MODE_RE.match(line)
            if mode_match:
                # We only need one mode; Git diffs can show old and new.
                # The one on the 'new file mode' or 'deleted file mode' line is most relevant.
                if file_mode is None or b"file mode" in line:
                    file_mode = mode_match.group(1)
                continue

            old_path_match = self._OLD_PATH_RE.match(line)
            if old_path_match:
                if line.strip() == b"--- /dev/null":
                    old_path = None
                else:
                    old_path = old_path_match.group(1)
                continue

            new_path_match = self._NEW_PATH_RE.match(line)
            if new_path_match:
                if line.strip() == b"+++ /dev/null":
                    new_path = None
                else:
                    new_path = new_path_match.group(1)
                continue

        # fallback for cases like:
        # a/src/api/__init__.py b/src/api/__init__.py
        # new file mode 100644
        # index 0000000..e69de29
        # no --- or +++ lines
        if not old_path and not new_path:
            # Use regex to robustly extract a/ and b/ paths from the first line
            path_a, path_b = None, None
            m = self._A_B_PATHS_RE.match(lines[0])
            if not m:
                return (None, None, file_mode)  # Unrecognized format
            path_a = m.group(1)
            path_b = m.group(2)

            # Use other metadata clues from the block to determine the operation
            block_text = b"\n".join(lines)
            if b"new file mode" in block_text:
                # This is an empty file addition.
                return (None, path_b, file_mode)
            elif b"deleted file mode" in block_text:
                # This is an empty file deletion (less common, but possible).
                return (path_a, None, file_mode)
            elif b"rename from" in block_text:
                # This is a pure rename with no content change.
                return (path_a, path_b, file_mode)
            else:
                # Could be a pure mode change.
                return (path_a, path_b, file_mode)

        return (old_path, new_path, file_mode)

    def _create_no_content_hunk(self, file_metadata: dict) -> HunkWrapper:
        """
        Create a HunkWrapper for files with no content changes (pure operations).
        """
        if file_metadata["is_rename"]:
            # Pure rename (no content change)
            return HunkWrapper.create_empty_rename(
                new_file_path=file_metadata["canonical_path"],
                old_file_path=file_metadata["old_path"],
                file_mode=file_metadata["file_mode"],
            )
        elif file_metadata["is_file_addition"]:
            # Empty new file (no content)
            return HunkWrapper.create_empty_addition(
                new_file_path=file_metadata["canonical_path"],
                file_mode=file_metadata["file_mode"],
            )
        elif file_metadata["is_file_deletion"]:
            # File deletion (deleted file mode)
            return HunkWrapper.create_empty_deletion(
                old_file_path=file_metadata["canonical_path"],
                file_mode=file_metadata["file_mode"],
            )

        else:
            raise ValueError("Cannot create no-content hunk for unknown operation.")

    def _parse_hunk_start(self, header_line: bytes) -> tuple[int, int, int, int]:
        """
        Extract old_start, old_len, new_start, new_len from @@ -x,y +a,b @@ header
        Returns: (old_start, old_len, new_start, new_len)
        """
        import re

        match = re.search(rb"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", header_line)
        if match:
            old_start = int(match.group(1))
            old_len = int(match.group(2)) if match.group(2) else 1
            new_start = int(match.group(3))
            new_len = int(match.group(4)) if match.group(4) else 1
            return old_start, old_len, new_start, new_len
        return 0, 0, 0, 0

    def reset(self) -> None:
        """Reset staged changes (keeping working directory intact)"""
        self.git.run_git_text_out(["reset"])

    def track_untracked(self, target: str | None = None) -> None:
        """
        Make untracked files tracked without staging their content, using 'git add -N'.
        """
        if target:
            self.git.run_git_text_out(["add", "-N", target])
        else:
            # Track all untracked files
            untracked = self.git.run_git_text_out(
                ["ls-files", "--others", "--exclude-standard"]
            ).splitlines()
            if not untracked:
                return
            self.git.run_git_text_out(["add", "-N"] + untracked)

    def need_reset(self) -> bool:
        """Checks if there are staged changes that need to be reset"""
        # 'git diff --cached --quiet' exits with 1 if there are staged changes, 0 otherwise
        return self.git.run_git_text(["diff", "--cached", "--quiet"]) is None

    def need_track_untracked(self, target: str | None = None) -> bool:
        """Checks if there are any untracked files within a target that need to be tracked."""
        path_args = [target] if target else []
        untracked_files = self.git.run_git_text_out(
            ["ls-files", "--others", "--exclude-standard"] + path_args
        )
        return bool(untracked_files.strip())

    def is_git_repo(self) -> bool:
        """Return True if current cwd is inside a git work tree, else False."""
        result = self.git.run_git_text_out(["rev-parse", "--is-inside-work-tree"])
        # When not a repo, run_git_text returns None; treat as False
        return bool(result and result.strip() == "true")

    def get_processed_working_diff(
        self, base_hash: str, new_hash: str, target: str | None = None
    ) -> tuple[list[Chunk], list[ImmutableChunk]]:
        """
        Parses the git diff once and converts each hunk directly into an
        atomic DiffChunk object (DiffChunk).
        """
        # Parse ONCE to get a list of HunkWrapper objects.
        hunks = self.get_full_working_diff(base_hash, new_hash, target)
        return self.parse_and_merge_hunks(hunks)

    def parse_and_merge_hunks(
        self, hunks: list[HunkWrapper | ImmutableHunkWrapper]
    ) -> tuple[list[Chunk], list[ImmutableChunk]]:
        chunks: list[DiffChunk] = []
        immut_chunks: list[DiffChunk] = []
        for hunk in hunks:
            if isinstance(hunk, ImmutableHunkWrapper):
                immut_chunks.append(
                    ImmutableChunk(hunk.canonical_path, hunk.file_patch)
                )
            else:
                chunks.append(DiffChunk.from_hunk(hunk))

        # Merge overlapping or touching chunks into CompositeDiffChunks
        merged = self.merge_overlapping_chunks(chunks)
        return merged, immut_chunks

    def merge_overlapping_chunks(self, chunks: list[DiffChunk]) -> list[Chunk]:
        """
        Merge DiffChunks that are not disjoint (i.e., overlapping or touching)
        into CompositeDiffChunks, grouped per canonical path (file).

        A merge occurs if two chunks within the same file overlap or touch
        in either their old or new line ranges.

        Returns:
            A list of DiffChunk and CompositeDiffChunk objects, each representing
            a disjoint edit region.
        """
        if not chunks:
            return []

        merged_results = []

        # Sort once globally by canonical path, then by sort key (old_start, abs_new_line)
        chunks_sorted = sorted(
            chunks,
            key=lambda c: (
                c.canonical_path(),
                c.get_sort_key(),
            ),
        )

        # Helper for overlap/touch logic
        # Chunks are disjoint if they don't overlap in old file coordinates
        def overlaps_or_touches(a: DiffChunk, b: DiffChunk) -> bool:
            a_old_start = a.old_start or 0
            a_old_end = a_old_start + a.old_len()
            b_old_start = b.old_start or 0

            # Chunks overlap if a's end is >= b's start
            # This handles touching chunks (end == start) as overlapping for merging
            return a_old_end >= b_old_start

        # Group by canonical path (so merges only happen within same file)
        for _, group in groupby(chunks_sorted, key=lambda c: c.canonical_path()):
            file_chunks = list(group)
            if not file_chunks:
                continue

            current_group: list[DiffChunk] = [file_chunks[0]]

            for h in file_chunks[1:]:
                last = current_group[-1]
                if overlaps_or_touches(last, h):
                    current_group.append(h)
                else:
                    # finalize group
                    if len(current_group) == 1:
                        merged_results.append(current_group[0])
                    else:
                        merged_results.append(CompositeDiffChunk(current_group.copy()))
                    current_group = [h]

            # finalize last group (if present)
            if current_group:
                if len(current_group) == 1:
                    merged_results.append(current_group[0])
                else:
                    merged_results.append(CompositeDiffChunk(current_group))

        return merged_results

    def get_current_branch(self) -> str:
        """
        Returns the name of the currently checked out branch.
        """
        return self.git.run_git_text_out(["rev-parse", "--abbrev-ref", "HEAD"]).strip()

    def get_current_base_commit_hash(self) -> str:
        """
        Returns the commit hash of the current HEAD (base commit).
        """
        return self.git.run_git_text_out(["rev-parse", "HEAD"]).strip()

    def try_get_parent_hash(self, commit_hash: str, empty_on_fail: bool = False):
        parent_hash_result = self.git.run_git_text_out(
            ["rev-parse", "--verify", f"{commit_hash}^"]
        )
        if parent_hash_result is None:
            parent_hash = EMPTYTREEHASH if empty_on_fail else None
        else:
            parent_hash = parent_hash_result.strip()

        return parent_hash

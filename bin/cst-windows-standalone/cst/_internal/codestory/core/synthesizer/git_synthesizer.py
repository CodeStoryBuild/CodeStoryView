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

import os
import tempfile
from pathlib import Path

from loguru import logger

from codestory.core.data.commit_group import CommitGroup
from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.diff_generation.git_diff_generator import GitDiffGenerator
from codestory.core.exceptions import GitError, SynthesizerError
from codestory.core.git_interface.interface import GitInterface


class GitSynthesizer:
    """
    Builds a clean, linear Git history from a plan of commit groups
    by manipulating the Git Index directly, avoiding worktree/filesystem overhead.
    """

    def __init__(self, git: GitInterface):
        self.git = git

    def _run_git_binary(
        self,
        *args: str,
        cwd: str | Path | None = None,
        env: dict | None = None,
        stdin_content: str | bytes | None = None,
    ) -> bytes:
        """Helper to run Git commands via the binary interface."""
        input_data = None
        if isinstance(stdin_content, str):
            input_data = stdin_content.encode("utf-8")
        elif isinstance(stdin_content, bytes):
            input_data = stdin_content

        result = self.git.run_git_binary_out(
            args=list(args), input_bytes=input_data, env=env, cwd=cwd
        )

        if result is None:
            raise GitError(f"Git command failed: {' '.join(args)}")

        return result

    def _run_git_decoded(self, *args: str, **kwargs) -> str:
        """Helper to run Git and get a decoded string."""
        output_bytes = self._run_git_binary(*args, **kwargs)
        return output_bytes.decode("utf-8", errors="replace").strip()

    def _build_tree_index_only(
        self,
        base_commit_hash: str,
        diff_chunks: list[DiffChunk],
        immutable_chunks: list[ImmutableChunk],
        diff_generator: GitDiffGenerator,
    ) -> str:
        """
        Creates a new Git tree object by applying changes directly to a temporary Git Index.
        This avoids creating any files on the filesystem.
        """

        # 1. Create a temp file to serve as the isolated Git Index
        # We use delete=False and close it immediately so we can pass the path to Git
        # (Windows prevents opening a file twice if strictly locked, this avoids that)
        temp_index_fd, temp_index_path = tempfile.mkstemp(prefix="codestory_index_")
        os.close(temp_index_fd)

        # 2. Create an environment that forces Git to use this specific index file
        env = os.environ.copy()
        env["GIT_INDEX_FILE"] = temp_index_path

        try:
            # 3. Load the base commit into this temporary index
            # This effectively 'stages' the entire project state at that commit
            self._run_git_binary("read-tree", base_commit_hash, env=env)

            # 4. Generate the combined patch
            patches = diff_generator.generate_diff(diff_chunks, immutable_chunks)

            if patches:
                ordered_items = sorted(patches.items(), key=lambda kv: kv[0])
                combined_patch = b"".join(patch for _, patch in ordered_items)

                try:
                    # 5. Apply patch to the INDEX only (--cached)
                    # --cached: modifies the index, ignores working dir
                    # --unidiff-zero: allows patches with 0 context lines (common in AI diffs)
                    self._run_git_binary(
                        "apply",
                        "--cached",
                        "--recount",
                        "--whitespace=nowarn",
                        "--unidiff-zero",
                        "--verbose",
                        env=env,
                        stdin_content=combined_patch,
                    )
                except RuntimeError as e:
                    raise SynthesizerError(
                        "FATAL: Git apply failed for combined patch stream.\n"
                        f"--- ERROR DETAILS ---\n{e}\n"
                    ) from e

            # 6. Write the index state to a Tree Object in the Git database
            new_tree_hash = self._run_git_decoded("write-tree", env=env)

            return new_tree_hash

        finally:
            # Cleanup the temporary index file
            if os.path.exists(temp_index_path):
                os.unlink(temp_index_path)

    def _create_commit(self, tree_hash: str, parent_hash: str, message: str) -> str:
        return self._run_git_decoded(
            "commit-tree", tree_hash, "-p", parent_hash, "-m", message
        )

    def execute_plan(
        self,
        groups: list[CommitGroup],
        base_commit: str,
    ) -> str:
        """
        Executes the synthesis plan using pure Git plumbing.
        Returns the hash of the final commit.
        """
        diff_generator = GitDiffGenerator(groups)

        original_base_commit_hash = self._run_git_decoded("rev-parse", base_commit)

        # Track state
        last_synthetic_commit_hash = original_base_commit_hash
        cumulative_diff_chunks: list[DiffChunk] = []
        cumulative_immutable_chunks: list[ImmutableChunk] = []

        logger.debug(
            "Execute plan (Index-Only): groups={groups} base={base}",
            groups=len(groups),
            base=original_base_commit_hash,
        )

        total = len(groups)

        for i, group in enumerate(groups):
            try:
                # 1. Accumulate chunks (Cumulative Strategy)
                # We rebuild from the ORIGINAL base every time using ALL previous chunks + new chunks.
                # This provides maximum stability against context drift.
                for chunk in group.chunks:
                    if isinstance(chunk, ImmutableChunk):
                        cumulative_immutable_chunks.append(chunk)
                    else:
                        cumulative_diff_chunks.extend(chunk.get_chunks())

                # 2. Build the Tree (In Memory / Index)
                new_tree_hash = self._build_tree_index_only(
                    original_base_commit_hash,
                    cumulative_diff_chunks,
                    cumulative_immutable_chunks,
                    diff_generator,
                )

                # 3. Create the Commit
                full_message = group.commit_message
                if group.extended_message:
                    full_message += f"\n\n{group.extended_message}"

                new_commit_hash = self._create_commit(
                    new_tree_hash, last_synthetic_commit_hash, full_message
                )

                logger.success(
                    f"Commit created: {new_commit_hash[:8]} | Msg: {group.commit_message} | Progress: {i + 1}/{total}"
                )

                # 4. Update parent for next loop
                last_synthetic_commit_hash = new_commit_hash

            except Exception as e:
                raise SynthesizerError(
                    f"FATAL: Synthesis failed during group #{i + 1}. No changes applied."
                ) from e

        final_commit_hash = last_synthetic_commit_hash

        return final_commit_hash

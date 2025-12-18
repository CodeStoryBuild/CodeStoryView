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

from codestory.core.exceptions import DetachedHeadError, GitError
from codestory.core.git_interface.interface import GitInterface


class TempCommitCreator:
    """Save working directory changes into a dangling commit and restore them."""

    def __init__(self, git: GitInterface):
        self.git = git

    def _run(
        self,
        args: list[str],
        cwd: Path | None = None,
        input_text: str | None = None,
    ) -> str | None:
        """Run a git command via the GitInterface and return stdout as string."""
        return self.git.run_git_text_out(args, cwd=cwd, input_text=input_text)

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

    def _branch_exists(self, branch_name: str) -> bool:
        """Check if a branch exists using `git rev-parse --verify --quiet`."""
        result = self._run(["rev-parse", "--verify", "--quiet", branch_name])
        return result is not None and result.strip() != ""

    def create_reference_commit(self) -> tuple[str, str]:
        """
        Save the current working directory into a dangling commit using index manipulation.

        - Creates a tree object from the current working directory state.
        - Commits this tree as a dangling commit (not attached to any branch).
        - Returns the old commit hash (HEAD) and the new dangling commit hash.
        """
        logger.debug("Creating dangling commit for current state...")
        original_branch = (self._run(["branch", "--show-current"]) or "").strip()
        # check that not a detached branch
        if not original_branch:
            msg = "Cannot backup: currently on a detached HEAD."
            raise DetachedHeadError(msg)

        # TODO remove this logic from here into better place
        # check if branch is empty
        head_commit = (self._run(["rev-parse", "HEAD"]) or "").strip()
        if not head_commit:
            logger.debug(
                f"Branch '{original_branch}' is empty: creating initial empty commit"
            )
            # Unstage any files that were staged before creating the initial commit
            self._run(["reset"])
            self._run(["commit", "--allow-empty", "-m", "Initial commit"])

        old_commit_hash = (self._run(["rev-parse", "HEAD"]) or "").strip()

        logger.debug("Creating dangling commit from working directory state")

        # Create a temporary index file to build the backup commit
        temp_index_fd, temp_index_path = tempfile.mkstemp(prefix="codestory_backup_")
        os.close(temp_index_fd)

        env = os.environ.copy()
        env["GIT_INDEX_FILE"] = temp_index_path

        try:
            # Load the current HEAD into the temporary index
            self._run_git_binary("read-tree", "HEAD", env=env)

            # Add all working directory changes to the temporary index
            # This includes untracked files
            self._run_git_binary("add", "-A", env=env)

            # Write the index state to a tree object
            new_tree_hash = self._run_git_decoded("write-tree", env=env)

            # Create a commit from this tree
            commit_msg = f"Temporary backup of working state from {original_branch}"
            new_commit_hash = self._run_git_decoded(
                "commit-tree",
                new_tree_hash,
                "-p",
                old_commit_hash,
                "-m",
                commit_msg,
            )

            logger.debug(f"Dangling commit created: {new_commit_hash[:8]}")

        finally:
            # Cleanup the temporary index file
            if os.path.exists(temp_index_path):
                os.unlink(temp_index_path)

        return (
            old_commit_hash,
            new_commit_hash,
        )

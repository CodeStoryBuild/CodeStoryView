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

from codestory.core.git_interface.interface import GitInterface


class GitFileReader:
    def __init__(self, git: GitInterface, base_commit: str, patched_commit: str):
        self.git = git
        self.base_commit = base_commit
        self.patched_commit = patched_commit

    def read(self, path: str, old_content: bool = False) -> str | None:
        """
        Returns the file content from the specified commit using git cat-file.
        version: 'old' for base_commit, 'new' for patched_commit (HEAD by default)
        """
        commit = self.base_commit if old_content else self.patched_commit
        # Use git cat-file to get file content
        # rel_path should be in posix format for git
        rel_path_git = path.replace("\\", "/").strip()
        obj = f"{commit}:{rel_path_git}"
        return self.git.run_git_text_out(["cat-file", "-p", obj])

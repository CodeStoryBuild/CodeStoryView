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

from abc import ABC, abstractmethod
from pathlib import Path
from subprocess import CompletedProcess


class GitInterface(ABC):
    """
    Abstract interface for running git commands.
    This abstracts away the details of how git commands are executed.
    """

    @abstractmethod
    def run_git_text_out(
        self,
        args: list[str],
        input_text: str | None = None,
        env: dict | None = None,
        cwd: str | Path | None = None,
    ) -> str | None:
        """Run a git command with text input/output. Returns None on error."""

    @abstractmethod
    def run_git_binary_out(
        self,
        args: list[str],
        input_bytes: bytes | None = None,
        env: dict | None = None,
        cwd: str | Path | None = None,
    ) -> bytes | None:
        """Run a git command with binary input/output. Returns None on error."""

    @abstractmethod
    def run_git_text(
        self,
        args: list[str],
        input_text: str | None = None,
        env: dict | None = None,
        cwd: str | Path | None = None,
    ) -> CompletedProcess[str] | None:
        """Run a git command with text response output. Returns None on error."""

    @abstractmethod
    def run_git_binary(
        self,
        args: list[str],
        input_bytes: bytes | None = None,
        env: dict | None = None,
        cwd: str | Path | None = None,
    ) -> CompletedProcess[bytes] | None:
        """Run a git command with binary response output. Returns None on error."""

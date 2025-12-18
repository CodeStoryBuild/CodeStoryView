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


@dataclass
class HunkWrapper:
    # new_file_path is the primary path for modifications or additions.
    new_file_path: bytes | None
    old_file_path: bytes | None
    hunk_lines: list[bytes]
    old_start: int
    new_start: int
    old_len: int
    new_len: int
    file_mode: bytes | None = b"100644"  # default to regular file

    @property
    def file_path(self) -> bytes | None:
        # For backward compatibility or simple logic, provide a single file_path.
        return self.new_file_path

    @staticmethod
    def create_empty_content(
        new_file_path: bytes | None,
        old_file_path: bytes | None,
        file_mode: bytes | None = None,
    ) -> "HunkWrapper":
        return HunkWrapper(
            new_file_path=new_file_path,
            old_file_path=old_file_path,
            hunk_lines=[],
            old_start=0,
            new_start=0,
            old_len=0,
            new_len=0,
            file_mode=file_mode,
        )

    @staticmethod
    def create_empty_addition(
        new_file_path: bytes | None, file_mode: bytes | None = None
    ) -> "HunkWrapper":
        return HunkWrapper(
            new_file_path=new_file_path,
            old_file_path=None,
            hunk_lines=[],
            old_start=0,
            new_start=0,
            old_len=0,
            new_len=0,
            file_mode=file_mode,
        )

    @staticmethod
    def create_empty_deletion(
        old_file_path: bytes | None, file_mode: bytes | None = None
    ) -> "HunkWrapper":
        return HunkWrapper(
            new_file_path=None,
            old_file_path=old_file_path,
            hunk_lines=[],
            old_start=0,
            new_start=0,
            old_len=0,
            new_len=0,
            file_mode=file_mode,
        )

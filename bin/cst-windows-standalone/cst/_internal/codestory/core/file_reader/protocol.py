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

from typing import Protocol


class FileReader(Protocol):
    """An interface for reading file content."""

    def read(self, path: str, old_content: bool = False) -> str | None:
        """
        Reads the content of a file.

        Args:
            path: The canonical path to the file.
            old_content: If True, read the 'before' version of the file.
                         If False, read the 'after' version.

        Returns:
            The file content as a string, or None if it doesn't exist
            (e.g., reading the 'old' version of a newly added file).
        """
        ...

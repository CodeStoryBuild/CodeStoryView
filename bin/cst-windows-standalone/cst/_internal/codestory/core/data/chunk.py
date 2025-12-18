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

from typing import Protocol, runtime_checkable

from codestory.core.data.diff_chunk import DiffChunk


@runtime_checkable
class Chunk(Protocol):
    def canonical_paths(self) -> list[bytes]:
        """
        List of affected file paths that this chunk touches (as bytes).
        The canonical path is always the most relevant path for a chunk
        For file_additions/modifications/renames, it is the new file path
        For file_deletions it is the old file path
        """
        ...

    def get_chunks(self) -> list[DiffChunk]:
        """
        Get all diff chunks inside the chunk
        """
        ...

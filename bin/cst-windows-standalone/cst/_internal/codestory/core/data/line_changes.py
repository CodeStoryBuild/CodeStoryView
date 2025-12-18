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
class LineNumbered:
    """Base class for line-numbered changes."""

    old_line: int
    abs_new_line: int  # Only for semantic grouping!
    content: bytes
    newline_marker: bool = False


@dataclass
class Addition(LineNumbered):
    """Represents a single added line of code.

    old_line: Position in old file where this addition occurs (the line after which we insert)
    abs_new_line: Absolute position in new file (from original diff, for semantic grouping only)
    """

    ...


@dataclass
class Removal(LineNumbered):
    """Represents a single removed line of code.

    old_line: The line being removed from the old file
    abs_new_line: Position in new file where this removal "lands" (for semantic grouping only)
    """

    ...

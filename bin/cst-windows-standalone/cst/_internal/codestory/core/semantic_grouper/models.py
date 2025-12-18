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

from dataclasses import dataclass, field
from typing import Optional

from tree_sitter import Node

from codestory.core.data.chunk import Chunk


@dataclass
class Scope:
    """Represents a structural scope like a function or class."""

    id: str
    type: str
    name: str | None
    start_line: int
    end_line: int
    parent: Optional["Scope"] = None
    children: list["Scope"] = field(default_factory=list)


@dataclass
class Symbol:
    """Represents a defined symbol."""

    name: str
    type: str
    definition_scope_id: str


@dataclass
class AnalysedHunk:
    """An internal representation of a single, continuous hunk range.

    NOTE: Uses abs_new_line (absolute new file positions from original diff)
    for semantic analysis purposes only. These are NOT for patch generation!
    """

    parent_chunk: Chunk  # Reference to the original Chunk
    abs_new_start: int  # Absolute position in new file (from original diff)
    abs_new_end: int  # Absolute position in new file (from original diff)

    # Fields to be populated by semantic analysis
    structural_scope_id: str = ""
    used_definition_scope_ids: set[str] = field(default_factory=set)


@dataclass
class AnalysisContext:
    """Holds all necessary analysis artifacts for a single file."""

    # 'Before' state artifacts
    before_ast: Node | None = None
    before_scope_tree: Scope | None = None
    before_symbol_table: dict[str, Symbol] = field(default_factory=dict)
    before_all_scopes: dict[str, Scope] = field(default_factory=dict)

    # 'After' state artifacts
    after_ast: Node | None = None
    after_scope_tree: Scope | None = None
    after_symbol_table: dict[str, Symbol] = field(default_factory=dict)
    after_all_scopes: dict[str, Scope] = field(default_factory=dict)

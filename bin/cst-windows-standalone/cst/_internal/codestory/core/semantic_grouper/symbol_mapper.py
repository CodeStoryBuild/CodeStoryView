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

from tree_sitter import Node

from codestory.core.semantic_grouper.query_manager import QueryManager


@dataclass(frozen=True)
class SymbolMap:
    """Maps line number to a set of fully-qualified symbols on that line."""

    modified_line_symbols: dict[
        int, set[str]
    ]  # symbols explicitly defined in the code (we can say more about these, eg we know they are modified)
    extern_line_symbols: dict[
        int, set[str]
    ]  # symbols where we find usages, but cant say that the source has been modified


class SymbolMapper:
    """Handles symbol mapping for source files using Tree-sitter queries."""

    def __init__(self, query_manager: QueryManager):
        self.query_manager = query_manager

    def build_symbol_map(
        self,
        language_name: str,
        root_node: Node,
        defined_symbols: set[str],
        line_ranges: list[tuple[int, int]],
    ) -> SymbolMap:
        """
        PASS 2: Builds a map of line numbers to their fully-qualified symbols.

        Args:
            language_name: The programming language (e.g., "python", "javascript")
            root_node: The root node of the parsed AST
            scope_map: The scope map containing line-to-scope mappings
            line_ranges: list of tuples (start_line, end_line), to filter the tree sitter queries for a file

        Returns:
            SymbolMap containing the mapping of line numbers to qualified symbols
        """
        # Run symbol queries using the query manager
        symbol_captures = self.query_manager.run_query_captures(
            language_name,
            root_node,
            query_type="token_general",
            line_ranges=line_ranges,
        )

        modified_line_symbols_mut: dict[int, set[str]] = {}
        extern_line_symbols_mut: dict[int, set[str]] = {}

        # Process each captured symbol
        for match_class, nodes in symbol_captures.items():
            for node in nodes:
                text = node.text.decode("utf8", errors="replace")

                qualified_symbol = QueryManager.create_qualified_symbol(
                    match_class, text, language_name
                )

                if qualified_symbol in defined_symbols:
                    line_symbols = modified_line_symbols_mut
                else:
                    line_symbols = extern_line_symbols_mut

                start_line = node.start_point[0]
                end_line = node.end_point[0]

                for i in range(start_line, end_line + 1):
                    # we can group on this symbol

                    # Add the qualified symbol to the line's symbol set
                    line_symbols.setdefault(i, set()).add(qualified_symbol)

        return SymbolMap(
            modified_line_symbols=modified_line_symbols_mut,
            extern_line_symbols=extern_line_symbols_mut,
        )

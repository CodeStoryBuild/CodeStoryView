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

"""Comment mapping utilities.

Builds a map of which lines (0-indexed) in a source file are pure comment
lines – meaning the only non-whitespace characters on that line belong to
one or more comment captures returned by Tree‑sitter. Inline comments that
follow code on the same line are excluded. Multi-line comment nodes are
handled by splitting their covered span per line.
"""

import string
from dataclasses import dataclass

from tree_sitter import Node

from codestory.core.semantic_grouper.query_manager import QueryManager

# Pre-build a translation table for efficiently stripping all whitespace.
# This is much faster than list comprehensions or repeated .isspace() checks.
_WHITESPACE_TRANSLATION_TABLE = str.maketrans("", "", string.whitespace)


@dataclass(frozen=True)
class CommentMap:
    """Represents the set of pure comment lines (0-indexed)."""

    pure_comment_lines: set[int]


class CommentMapper:
    """Builds a `CommentMap` using Tree‑sitter comment captures."""

    def __init__(self, query_manager: QueryManager):
        self.query_manager = query_manager

    def build_comment_map(
        self,
        language_name: str,
        root_node: Node,
        content_bytes: bytes,
        line_ranges: list[tuple[int, int]],
    ) -> CommentMap:
        """Return a `CommentMap` for the provided file.

        Optimized Approach:
        1. Run configured comment queries to get comment nodes.
        2. For each comment node, calculate its length on each line it spans.
           Instead of storing intervals, we directly sum these lengths into a
           per-line counter.
        3. A line is marked pure-comment if the total length of its
           non-whitespace characters (found efficiently using str.translate)
           is equal to the summed length of comment captures on that line.
        """
        comment_captures = self.query_manager.run_query_captures(
            language_name,
            root_node,
            query_type="comment",
            line_ranges=line_ranges,
        )

        lines = content_bytes.decode("utf8", errors="replace").splitlines(
            keepends=False
        )
        num_lines = len(lines)

        # line_index -> total number of characters covered by comments.
        coverage_counts: dict[int, int] = {}

        for _, nodes in comment_captures.items():
            for node in nodes:
                start_line, start_col = node.start_point
                end_line, end_col = node.end_point

                if start_line >= num_lines:
                    continue

                if start_line == end_line:
                    # Single-line comment: just add its length.
                    length = end_col - start_col
                    coverage_counts[start_line] = (
                        coverage_counts.get(start_line, 0) + length
                    )
                else:
                    # Multi-line comment: calculate length for each line spanned.
                    # Start line: from start_col to the end of the line.
                    line_len = len(lines[start_line])
                    length = max(0, line_len - start_col)
                    coverage_counts[start_line] = (
                        coverage_counts.get(start_line, 0) + length
                    )

                    # Middle lines: the entire line is part of the comment.
                    for line_idx in range(start_line + 1, end_line):
                        if line_idx < num_lines:
                            coverage_counts[line_idx] = coverage_counts.get(
                                line_idx, 0
                            ) + len(lines[line_idx])

                    # End line: from column 0 to the end_col.
                    if end_line < num_lines:
                        coverage_counts[end_line] = (
                            coverage_counts.get(end_line, 0) + end_col
                        )

        pure_comment_lines: set[int] = set()
        for line_idx, comment_length in coverage_counts.items():
            # The line must have some comment coverage to be considered.
            if comment_length == 0:
                continue

            # Defensive check against out-of-bounds access
            if line_idx >= num_lines:
                continue

            line_text = lines[line_idx]

            # Efficiently strip all whitespace and get the length of what remains.
            non_whitespace_text = line_text.translate(_WHITESPACE_TRANSLATION_TABLE)

            # If there's no non-whitespace text, it's a blank line, not a comment line.
            if not non_whitespace_text:
                # Consider adding blank lines as comment lines
                continue

            # If the number of non-whitespace chars equals the number of chars
            # covered by comments, it's a pure comment line.
            if len(non_whitespace_text) <= comment_length:
                pure_comment_lines.add(line_idx)

        return CommentMap(pure_comment_lines=pure_comment_lines)

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

from loguru import logger
from tree_sitter import Node
from tree_sitter_language_pack import get_parser

from codestory.core.file_reader.language_mapper import detect_tree_sitter_language
from codestory.core.semantic_grouper.query_manager import QueryManager


@dataclass(frozen=True)
class ParsedFile:
    """Contains the parsed AST root and detected language for a file."""

    content_bytes: bytes
    root_node: Node
    detected_language: str
    line_ranges: list[tuple[int, int]]


class FileParser:
    """Parses files using Tree-sitter after detecting language."""

    @classmethod
    def parse_file(
        cls,
        file_name: str,
        file_content: str,
        line_ranges: list[tuple[int, int]],
    ) -> ParsedFile | None:
        """
        Parse a file by detecting its language and creating an AST.

        Args:
            file_name: Name of the file (used for language detection)
            file_content: Content of the file to parse
            line_ranges: Relevant ranges of the file we need

        Returns:
            ParsedFile containing the root node and detected language, or None if parsing failed
        """
        # TODO see if we can parse only the relevant ranges in line_ranges
        detected_language = cls._detect_language(file_name, file_content)
        if not detected_language:
            logger.debug(f"Failed to get detect language for {file_name}")
            return None

        # check that we support queries for this language
        if not QueryManager.get_instance().has_language(detected_language):
            logger.debug(
                f"No query configuration found for detected language {detected_language}"
            )
            return None

        # Get Tree-sitter parser for the detected language
        try:
            parser = get_parser(detected_language)
        except Exception as e:
            # If we can't get a parser for this language, return None
            logger.debug(f"Failed to get parser for {detected_language} error: {e}")
            return None

        # Parse the content
        try:
            content_bytes = file_content.encode("utf8")
            tree = parser.parse(content_bytes)
            root_node = tree.root_node

            return ParsedFile(
                content_bytes=content_bytes,
                root_node=root_node,
                detected_language=detected_language,
                line_ranges=line_ranges,
            )
        except Exception as e:
            # If parsing fails, return None
            logger.debug(f"Failed to parse file with {detected_language} error: {e}")
            return None

    @classmethod
    def _detect_language(cls, file_path: str, file_content: str) -> str | None:
        """
        Args:
            file_name: Name of the file (used for extension-based detection)
            file_content: Content of the file (used as fallback)

        Returns:
            Tree-sitter compatible language name, or None if detection failed
        """
        return detect_tree_sitter_language(file_path, file_content)

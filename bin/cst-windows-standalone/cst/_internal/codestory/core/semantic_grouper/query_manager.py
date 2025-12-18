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

import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal

from loguru import logger
from tree_sitter import Node, Query, QueryCursor
from tree_sitter_language_pack import get_language


@dataclass(frozen=True)
class SharedTokenQueries:
    general_queries: list[str]
    definition_queries: list[str]


@dataclass(frozen=True)
class ScopeQueries:
    named_scope: list[str]
    structural_scope: list[str]


@dataclass(frozen=True)
class LanguageConfig:
    language_name: str
    shared_token_queries: dict[str, SharedTokenQueries]
    scope_queries: ScopeQueries
    comment_queries: list[str]
    share_tokens_between_files: bool

    @classmethod
    def from_json_dict(cls, name: str, json_dict: dict) -> "LanguageConfig":
        shared_token_queries: dict[str, SharedTokenQueries] = {}
        for token_class, items in json_dict.get("shared_token_queries", {}).items():
            if isinstance(items, dict):
                general_queries = items.get("general_queries", [])
                definition_queries = items.get("definition_queries", [])
                query = SharedTokenQueries(general_queries, definition_queries)
            else:
                raise ValueError(
                    f"Invalid shared_token_queries entry for {token_class}"
                )
            shared_token_queries[token_class] = query

        scope_queries_dict = json_dict.get("scope_queries", {})
        named_scope = scope_queries_dict.get("named_scope", [])
        structural_scope = scope_queries_dict.get("structural_scope", [])
        scope_queries = ScopeQueries(named_scope, structural_scope)
        comment_queries = json_dict.get("comment_queries", [])
        share_tokens_between_files = json_dict.get("share_tokens_between_files", False)
        return cls(
            name,
            shared_token_queries,
            scope_queries,
            comment_queries,
            share_tokens_between_files,
        )

    def __get_source(self, queries: list[str], capture_class: str) -> str:
        lines = []
        for query in queries:
            if "@placeholder" not in query:
                logger.warning(
                    f"{query} in the language {self.language_name} {capture_class=} config, is missing a capture class @placeholder!"
                )
            else:
                # TODO consider if multiple @placeholders should be supported or warned against
                # .replace will replace all instances of it
                query_filled = query.replace("@placeholder", f"@{capture_class}")
                lines.append(query_filled)

        return lines

    def __get_shared_token_source(self, is_general_query: bool) -> str:
        """
        Build query source for all shared tokens, injecting #not-eq? predicates
        for each configured filter. Each predicate line uses the capture name so
        the predicate has access to the node text.
        """
        lines: list[str] = []
        for capture_class, capture_queries in self.shared_token_queries.items():
            queries = (
                capture_queries.general_queries
                if is_general_query
                else capture_queries.definition_queries
            )
            lines.extend(self.__get_source(queries, capture_class))

        return "\n".join(lines)

    def get_source(
        self,
        query_type: Literal[
            "scope",
            "named_scope",
            "structural_scope",
            "comment",
            "token_general",
            "token_definition",
        ],
    ):
        if query_type == "scope":
            named_lines = self.__get_source(
                self.scope_queries.named_scope, "named_scope"
            )
            structural_lines = self.__get_source(
                self.scope_queries.structural_scope, "structural_scope"
            )
            return "\n".join(named_lines + structural_lines)
        if query_type == "named_scope":
            return "\n".join(
                self.__get_source(self.scope_queries.named_scope, "named_scope")
            )
        if query_type == "structural_scope":
            return "\n".join(
                self.__get_source(
                    self.scope_queries.structural_scope, "structural_scope"
                )
            )
        if query_type == "comment":
            return "\n".join(
                self.__get_source(self.comment_queries, "STRUCTURALCOMMENTQUERY")
            )
        if query_type == "token_definition":
            return self.__get_shared_token_source(is_general_query=False)
        if query_type == "token_general":
            return self.__get_shared_token_source(is_general_query=True)


class QueryManager:
    """
    Manages language configs and runs queries using the newer QueryCursor(query)
    constructor and cursor.captures(node, predicates=...).

    This is a singleton class. Use QueryManager.get_instance() to access the instance.
    """

    _instance: "QueryManager | None" = None
    _override_config_path: str | None = None

    def __init__(self):
        if QueryManager._instance is not None:
            raise RuntimeError(
                "QueryManager is a singleton. Use QueryManager.get_instance() instead."
            )

        resource = files("codestory").joinpath("resources/language_config.json")
        content_text = resource.read_text(encoding="utf-8")
        self._language_configs: dict[str, LanguageConfig] = self._init_configs(
            content_text
        )

        # Apply overrides if set via set_override
        if QueryManager._override_config_path is not None:
            self._init_overrides(QueryManager._override_config_path)
        # cache per-language/per-query-type: key -> (Query, QueryCursor)
        self._cursor_cache: dict[str, tuple[Query, QueryCursor]] = {}

        # Log language configuration summary
        lang_summaries = {}
        for name, cfg in self._language_configs.items():
            shared_classes = len(cfg.shared_token_queries)
            named_scope_count = len(cfg.scope_queries.named_scope)
            structural_scope_count = len(cfg.scope_queries.structural_scope)
            comment_count = len(cfg.comment_queries)
            lang_summaries[name] = {
                "shared_classes": shared_classes,
                "named_scopes": named_scope_count,
                "structural_scopes": structural_scope_count,
                "comment_queries": comment_count,
                "share_tokens_between_files": cfg.share_tokens_between_files,
            }
        logger.debug(
            "Language config loaded: languages={n} details={details}",
            n=len(self._language_configs),
            details=lang_summaries,
        )

    @classmethod
    def get_instance(cls) -> "QueryManager":
        """
        Get or create the singleton instance of QueryManager.

        Returns:
            The singleton QueryManager instance.
        """
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @staticmethod
    def set_override(override_config_path: str | None) -> None:
        """
        Set the path to a custom language config file. Must be called before
        the first call to get_instance() to have any effect.

        Args:
            override_config_path: Path to custom language config JSON file,
                                 or None to clear any previously set override.
        """
        QueryManager._override_config_path = override_config_path

    def has_language(self, language_name: str) -> bool:
        return language_name in self._language_configs

    def _init_configs(self, config_content: str) -> dict[str, LanguageConfig]:
        try:
            config = json.loads(config_content)

            configs: dict[str, LanguageConfig] = {}
            # iterate .items() to get (name, config)
            for language_name, language_config in config.items():
                configs[language_name] = LanguageConfig.from_json_dict(
                    language_name, language_config
                )
            return configs

        except Exception as e:
            raise RuntimeError("Failed to parse language configs!") from e

    def _init_overrides(self, override_config_path: str) -> None:
        """
        Load custom language configs from the override path and merge them
        with the existing configs. If a language key exists in the override
        config, it replaces the built-in config for that language.

        Args:
            override_config_path: Path to the custom language config JSON file.
        """
        try:
            from pathlib import Path

            config_path = Path(override_config_path)
            if not config_path.exists():
                logger.warning(
                    f"Custom language config path does not exist: {override_config_path}"
                )
                return

            with open(config_path, encoding="utf-8") as f:
                override_content = f.read()

            override_config = json.loads(override_content)

            # Override configs for each language found in the custom config
            for language_name, language_config in override_config.items():
                try:
                    self._language_configs[language_name] = (
                        LanguageConfig.from_json_dict(language_name, language_config)
                    )
                    logger.debug(
                        f"Overridden language config for '{language_name}' from custom config"
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to parse override config for language '{language_name}': {e}"
                    )

        except Exception as e:
            logger.error(f"Failed to load custom language config: {e}")

    def run_query_captures(
        self,
        language_name: str,
        tree_root: Node,
        query_type: Literal[
            "scope",
            "named_scope",
            "structural_scope",
            "comment",
            "token_general",
            "token_definition",
        ],
        line_ranges: list[tuple[int, int]] | None = None,
    ):
        """
        Run either the scope or shared token query for the language on `tree_root`.
        If `line_ranges` is provided, only matches within those 0-indexed (start, end) line ranges are returned.
        Returns a dict: {capture_name: [Node, ...]}
        """
        key = f"{language_name}:{query_type}"

        language = get_language(language_name)
        if language is None:
            raise ValueError(f"Invalid language '{language_name}'")

        lang_config = self._language_configs.get(language_name)
        if lang_config is None:
            raise ValueError(f"Missing config for language '{language_name}'")

        # Build and cache Query + QueryCursor if not present
        if key not in self._cursor_cache:
            query_src = lang_config.get_source(query_type)

            if not query_src.strip():
                # Empty query -> no matches
                logger.debug(f"Empty query for {language_name} {query_type=}!")
                return {}

            query = Query(language, query_src)
            cursor = QueryCursor(query)
            self._cursor_cache[key] = (query, cursor)
        else:
            query, cursor = self._cursor_cache[key]

        # If no line_ranges provided, just run over the whole tree
        if line_ranges is None:
            # make sure the capture range is the whole file
            cursor.set_point_range(tree_root.start_point, tree_root.end_point)
            return cursor.captures(tree_root)

        # Otherwise, loop over line ranges
        # Prepare result dictionary
        results: dict[str, list[Node]] = {}
        for start_line, end_line in line_ranges:
            if end_line < start_line:
                # cases like empty hunks will head to invalid range
                continue
            start_point = (start_line, 0)
            end_point = (end_line + 1, 0)  # end is exclusive

            # Reset cursor and restrict to this range
            cursor.set_point_range(start_point, end_point)

            for capture_name, nodes in cursor.captures(tree_root).items():
                results.setdefault(capture_name, []).extend(nodes)

        return results

    def run_query_matches(
        self,
        language_name: str,
        tree_root: Node,
        query_type: Literal[
            "scope",
            "named_scope",
            "structural_scope",
            "comment",
            "token_general",
            "token_definition",
        ],
        line_ranges: list[tuple[int, int]] | None = None,
    ):
        """
        Run either the scope or shared token query for the language on `tree_root`.
        If `line_ranges` is provided, only matches within those 0-indexed (start, end) line ranges are returned.
        Returns a list of matches from the query.
        """
        key = f"{language_name}:{query_type}"

        language = get_language(language_name)
        if language is None:
            raise ValueError(f"Invalid language '{language_name}'")

        lang_config = self._language_configs.get(language_name)
        if lang_config is None:
            raise ValueError(f"Missing config for language '{language_name}'")

        # Build and cache Query + QueryCursor if not present
        if key not in self._cursor_cache:
            query_src = lang_config.get_source(query_type)

            if not query_src.strip():
                # Empty query -> no matches
                logger.debug(f"Empty query for {language_name} {query_type=}!")
                return []

            query = Query(language, query_src)
            cursor = QueryCursor(query)
            self._cursor_cache[key] = (query, cursor)
        else:
            query, cursor = self._cursor_cache[key]

        # If no line_ranges provided, just run over the whole tree
        if line_ranges is None:
            # make sure the match range is the whole file
            cursor.set_point_range(tree_root.start_point, tree_root.end_point)
            return cursor.matches(tree_root)

        # Otherwise, loop over line ranges and accumulate results
        results = []
        for start_line, end_line in line_ranges:
            if end_line < start_line:
                # cases like empty hunks will head to invalid range
                continue
            start_point = (start_line, 0)
            end_point = (end_line + 1, 0)  # end is exclusive

            # Reset cursor and restrict to this range
            cursor.set_point_range(start_point, end_point)

            # Accumulate matches from this range
            results.extend(cursor.matches(tree_root))

        return results

    def get_config(self, language_name: str) -> LanguageConfig:
        lang_config = self._language_configs.get(language_name)
        if lang_config is None:
            raise ValueError(f"Missing config for language '{language_name}'")
        return lang_config

    @staticmethod
    def create_qualified_symbol(
        capture_class: str, token_name: str, language: str
    ) -> str:
        # returns something like "foo identifier_class python"
        return f"{token_name} {capture_class} {language}"

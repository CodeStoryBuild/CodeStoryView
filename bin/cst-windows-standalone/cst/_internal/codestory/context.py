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

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from codestory.core.config.type_constraints import (
    BoolConstraint,
    LiteralTypeConstraint,
    RangeTypeConstraint,
    StringConstraint,
)
from codestory.core.git_commands.git_commands import GitCommands
from codestory.core.git_interface.interface import GitInterface
from codestory.core.git_interface.SubprocessGitInterface import (
    SubprocessGitInterface,
)
from codestory.core.llm import CodeStoryAdapter, ModelConfig


@dataclass
class GlobalConfig:
    model: str = "no-model"
    api_key: str | None = None
    api_base: str | None = None
    temperature: float = 0
    max_tokens: int | None = 4096
    relevance_filter_level: Literal["safe", "standard", "strict", "none"] = "none"
    secret_scanner_aggression: Literal["safe", "standard", "strict", "none"] = "safe"
    fallback_grouping_strategy: Literal[
        "all_together", "by_file_path", "by_file_name", "by_file_extension", "all_alone"
    ] = "all_together"
    split_hunks: bool = True
    verbose: bool = False
    auto_accept: bool = False
    silent: bool = False
    ask_for_commit_message: bool = False
    display_diff_type: Literal["semantic", "git"] = "semantic"
    custom_language_config: str | None = None
    batching_strategy: Literal["auto", "requests", "prompt"] = "auto"
    custom_embedding_model: str | None = None
    cluster_strictness: float = 0.5

    constraints = {
        "model": StringConstraint(),
        "api_key": StringConstraint(),
        "api_base": StringConstraint(),
        "temperature": RangeTypeConstraint(min_value=0.0, max_value=1.0),
        "max_tokens": RangeTypeConstraint(min_value=1),
        "relevance_filter_level": LiteralTypeConstraint(
            allowed=["safe", "standard", "strict", "none"]
        ),
        "secret_scanner_aggression": LiteralTypeConstraint(
            allowed=["safe", "standard", "strict", "none"]
        ),
        "fallback_grouping_strategy": LiteralTypeConstraint(
            allowed=(
                "all_together",
                "by_file_path",
                "by_file_name",
                "by_file_extension",
                "all_alone",
            )
        ),
        "split_hunks": BoolConstraint(),
        "verbose": BoolConstraint(),
        "auto_accept": BoolConstraint(),
        "silent": BoolConstraint(),
        "ask_for_commit_message": BoolConstraint(),
        "display_diff_type": LiteralTypeConstraint(allowed=["semantic", "git"]),
        "custom_language_config": StringConstraint(),
        "batching_strategy": LiteralTypeConstraint(
            allowed=["auto", "requests", "prompt"]
        ),
        "custom_embedding_model": StringConstraint(),
        "cluster_strictness": RangeTypeConstraint(min_value=0.0, max_value=1.0),
    }

    descriptions = {
        "model": "LLM model (format: provider:model, e.g., openai:gpt-4)",
        "api_key": "API key for the LLM provider",
        "api_base": "Custom API base URL for the LLM provider (optional)",
        "temperature": "Temperature for LLM responses (0.0-1.0)",
        "max_tokens": "Maximum tokens for LLM responses. Ie the selected models context length",
        "relevance_filter_level": "How much to filter irrelevant changes",
        "secret_scanner_aggression": "How aggresively to scan for secrets",
        "fallback_grouping_strategy": "Strategy for grouping chunks that fail annotation",
        "split_hunks": "Whether to split git hunks into smaller atomic chunks",
        "verbose": "Enable verbose logging output",
        "auto_accept": "Automatically accept all prompts without user confirmation",
        "silent": "Do not output any text to the console, except for prompting acceptance",
        "ask_for_commit_message": "Allow asking you to provide commit messages to optionally override the auto generated ones",
        "display_diff_type": "Type of diff to display when showing diffs (semantic or git)",
        "custom_language_config": "Path to custom language configuration JSON file to override built-in language configs",
        "batching_strategy": "Strategy for batching LLM requests (auto, requests, prompt)",
        "custom_embedding_model": "FastEmbed supported text embedding model (will download on first run if not cached)",
        "cluster_strictness": "Strictness of clustering logical groups together. Higher value = higher threshold of similarity required to group together.",
    }

    arg_options = {
        "model": ["--model"],
        "api_key": ["--api-key"],
        "api_base": ["--api-base"],
        "temperature": ["--temperature"],
        "max_tokens": ["--max-tokens"],
        "relevance_filter_level": ["--relevance-filter-level"],
        "secret_scanner_aggression": ["--secret-scanner-aggression"],
        "fallback_grouping_strategy": ["--fallback-grouping-strategy"],
        "split_hunks": ["--split-hunks"],
        "verbose": ["--verbose", "-v"],
        "auto_accept": ["--yes", "-y"],
        "silent": ["--silent", "-s"],
        "ask_for_commit_message": ["--ask-for-commit-message"],
        "display_diff_type": ["--display-diff-type"],
        "custom_language_config": ["--custom-language-config"],
        "batching_strategy": ["--batching-strategy"],
        "custom_embedding_model": ["--custom-embedding-model"],
        "cluster_strictness": ["--cluster-strictness"],
    }

    @classmethod
    def get_cli_params(cls):
        """
        Generate typer parameter specifications from GlobalConfig metadata.
        Returns a dict mapping field names to their typer.Option configuration.
        """
        from dataclasses import fields

        import typer

        params = {}
        for field in fields(cls):
            field_name = field.name

            # Get metadata for this field
            arg_names = cls.arg_options.get(
                field_name, [f"--{field_name.replace('_', '-')}"]
            )
            description = cls.descriptions.get(field_name, "")
            field_type = field.type

            # Build typer.Option kwargs - default is the first positional arg
            option_kwargs = {"help": description}

            # Handle typing to make fields optional (since they can be overridden)
            # All CLI args should be optional to allow config file/env var precedence
            if field_type is bool:
                # For bool fields, keep as bool | None for CLI
                params[field_name] = (
                    bool | None,
                    typer.Option(None, *arg_names, **option_kwargs),
                )
            elif field_type is float:
                params[field_name] = (
                    float | None,
                    typer.Option(None, *arg_names, **option_kwargs),
                )
            elif field_type is int:
                params[field_name] = (
                    int | None,
                    typer.Option(None, *arg_names, **option_kwargs),
                )
            elif hasattr(field_type, "__origin__") and field_type.__origin__ is Literal:
                # Literal types - make optional
                params[field_name] = (
                    field_type | None,
                    typer.Option(None, *arg_names, **option_kwargs),
                )
            else:
                # String or other types - make optional
                params[field_name] = (
                    str | None,
                    typer.Option(None, *arg_names, **option_kwargs),
                )

        return params


@dataclass
class GlobalContext:
    repo_path: Path
    git_interface: GitInterface
    git_commands: GitCommands
    config: GlobalConfig
    _model: CodeStoryAdapter | None = None

    def get_model(self) -> CodeStoryAdapter | None:
        """Lazy-loaded getter for the model instance."""
        if self.config.model == "no-model":
            return None

        if self._model is not None:
            return self._model
        else:
            self._model = CodeStoryAdapter(
                ModelConfig(
                    self.config.model,
                    self.config.api_key,
                    self.config.api_base,
                    self.config.temperature,
                    self.config.max_tokens,
                )
            )
        return self._model

    @classmethod
    def from_global_config(cls, config: GlobalConfig, repo_path: Path):
        git_interface = SubprocessGitInterface(repo_path)
        git_commands = GitCommands(git_interface)
        return GlobalContext(repo_path, git_interface, git_commands, config)


@dataclass(frozen=True)
class CommitContext:
    target: Path
    message: str | None = None
    relevance_filter_level: Literal["safe", "standard", "strict", "none"] = "none"
    secret_scanner_aggression: Literal["safe", "standard", "strict", "none"] = "none"
    relevance_filter_intent: str | None = None
    fail_on_syntax_errors: bool = False


@dataclass(frozen=True)
class FixContext:
    end_commit_hash: str
    start_commit_hash: str | None = None


@dataclass(frozen=True)
class CleanContext:
    ignore: Sequence[str] | None = None
    min_size: int | None = None
    start_from: str | None = None

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

from contextlib import contextmanager

import typer
from loguru import logger

"""
Custom exception hierarchy for the codestory CLI application.

This module defines a comprehensive exception hierarchy that provides
clear error messages and proper error categorization for better
error handling and user experience.
"""


class CodestoryError(Exception):
    """
    Base exception for all codestory-related errors.

    All codestory-specific exceptions should inherit from this class
    to enable consistent error handling throughout the application.
    """

    pass


class GitError(CodestoryError):
    """
    Errors related to git operations.

    Raised when git commands fail or when git repository
    state is invalid for the requested operation.
    """

    pass


class DetachedHeadError(GitError):
    """Raised when on a detached HEAD."""

    pass


class ValidationError(CodestoryError):
    """
    Input validation errors.

    Raised when user input fails validation checks,
    such as invalid file paths, malformed commit hashes, etc.
    """

    pass


class ConfigurationError(CodestoryError):
    """
    Configuration-related errors.

    Raised when configuration files are invalid, missing,
    or contain incompatible settings.
    """

    pass


class AIServiceError(CodestoryError):
    """
    AI service related errors.

    Raised when AI API calls fail, timeout, or return
    invalid responses.
    """

    pass


class EmbeddingModelError(CodestoryError):
    """
    Custom embedding model errors.

    Raised when custom embedding model fails to download,
    is invalid, or encounters errors during initialization.
    """

    pass


class FileSystemError(CodestoryError):
    """
    File system operation errors.

    Raised when file or directory operations fail,
    such as permission issues or missing files.
    """

    pass


class ChunkingError(CodestoryError):
    """
    Errors during diff chunking operations.

    Raised when the chunking process encounters
    invalid diffs or fails to parse changes.
    """

    pass


class SynthesizerError(CodestoryError):
    """
    Errors during commit synthesis.

    Raised when the commit synthesis process fails
    to create valid commits from chunks.
    """

    pass


class FixCommitError(CodestoryError):
    """
    Errors during fix command run
    """

    pass


class LLMResponseError(CodestoryError):
    """
    Errors when llm response failed or was invalid
    """

    pass


class LLMInitError(CodestoryError):
    """
    Errors during LLM initialization.

    Raised when LLM setup fails due to missing API keys,
    invalid model configurations, or connection issues.
    """

    pass


class LogicalGroupingError(CodestoryError):
    """
    Errors during logical grouping step
    """

    pass


class CleanCommandError(CodestoryError):
    """
    Errors specific to running the cst clean command
    """


class SyntaxErrorDetected(CodestoryError):
    """
    Raised when syntax errors are detected in code files.
    """

    pass


@contextmanager
def handle_codestory_exception(exit_on_fail: bool = False):
    """
    Function-based context manager to handle CodestoryError exceptions.

    Yields control to the 'with' block's content. The code after 'yield'
    acts as the '__exit__' method, running only if the 'with' block is done
    or raises an exception.
    """
    try:
        yield

    except CodestoryError as e:
        logger.exception(e)

        if exit_on_fail:
            raise typer.Exit(1)


# Convenience functions for creating common errors
def git_not_found() -> GitError:
    """Create a GitError for when git is not available."""
    return GitError(
        "Git is not installed or not in PATH",
        "Please install git and ensure it's available in your PATH environment variable",
    )


def not_git_repository(path: str = ".") -> GitError:
    """Create a GitError for when not in a git repository."""
    return GitError(
        f"Not a git repository: {path}",
        "Run 'git init' to initialize a git repository or navigate to an existing repository",
    )


def invalid_commit_hash(commit_hash: str) -> ValidationError:
    """Create a ValidationError for invalid commit hashes."""
    return ValidationError(
        f"Invalid commit hash: {commit_hash}",
        "Commit hashes must be 4-40 hexadecimal characters",
    )


def path_not_found(path: str) -> ValidationError:
    """Create a ValidationError for non-existent paths."""
    return ValidationError(
        f"Path not found: {path}",
        "Please check that the path exists and is accessible",
    )


def api_key_missing(service: str) -> ConfigurationError:
    """Create a ConfigurationError for missing API keys."""
    return ConfigurationError(
        f"Missing API key for {service}",
        "Set the API key using environment variable or run setup command",
    )


def ai_service_timeout(service: str, timeout: int) -> AIServiceError:
    """Create an AIServiceError for API timeouts."""
    return AIServiceError(
        f"AI service '{service}' timed out after {timeout} seconds",
        "Try again or increase the timeout setting in configuration",
    )

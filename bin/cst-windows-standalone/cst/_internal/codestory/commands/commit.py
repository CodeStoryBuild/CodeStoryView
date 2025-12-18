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

from typing import Literal

import typer
from colorama import Fore, Style
from loguru import logger

from codestory.context import CommitContext, GlobalContext
from codestory.core.exceptions import ValidationError, handle_codestory_exception
from codestory.core.git_commands.git_commands import GitCommands
from codestory.core.logging.utils import time_block
from codestory.core.temp_commiter.temp_commiter import TempCommitCreator
from codestory.core.validation import (
    sanitize_user_input,
    validate_message_length,
    validate_target_path,
)


def verify_repo_state(
    commands: GitCommands, target: str, auto_yes: bool = False
) -> bool:
    logger.debug(f"{Fore.GREEN} Checking repository status... {Style.RESET_ALL}")
    if commands.need_reset():
        if auto_yes:
            unstage = True
            logger.debug(
                f"{Fore.YELLOW}Auto-confirm:{Style.RESET_ALL} Unstaging all changes to proceed."
            )
        else:
            unstage = typer.confirm(
                "Staged changes detected. codestory requires a clean staging area. Unstage all changes?",
                default=False,
            )

        if unstage:
            commands.reset()
        else:
            logger.debug(
                f"{Fore.YELLOW}Unstage Operation Refused, exiting early.{Style.RESET_ALL}"
            )
            raise ValidationError("Cannot proceed without unstaging changes, exiting.")

    # always track all files that are not explicitly excluded using gitignore or target path selector
    # this is a very explicit design choice to simplify (remove) the concept of staged/unstaged changes
    if commands.need_track_untracked(target):
        logger.debug(
            f'Untracked files detected within "{target}", starting to track them.',
        )

        commands.track_untracked(target)


def run_commit(
    global_context: GlobalContext,
    target: str | None,
    message: str | None,
    secret_scanner_aggression: Literal["safe", "standard", "strict", "none"],
    relevance_filter_level: Literal["safe", "standard", "strict", "none"],
    intent: str | None,
    fail_on_syntax_errors: bool,
) -> None:
    # Validate inputs
    validated_target = validate_target_path(target)

    if message:
        validated_message = validate_message_length(message)
        validated_message = sanitize_user_input(validated_message)
    else:
        validated_message = None

    commit_context = CommitContext(
        target=validated_target,
        message=validated_message,
        relevance_filter_level=relevance_filter_level,
        relevance_filter_intent=intent,
        secret_scanner_aggression=secret_scanner_aggression,
        fail_on_syntax_errors=fail_on_syntax_errors,
    )

    # verify repo state specifically for commit command
    verify_repo_state(
        global_context.git_commands,
        str(commit_context.target),
        global_context.config.auto_accept,
    )
    # Create a dangling commit for the current working tree state.
    tempcommiter = TempCommitCreator(global_context.git_interface)

    base_commit_hash, new_commit_hash = tempcommiter.create_reference_commit()

    from codestory.pipelines.rewrite_init import create_rewrite_pipeline

    with time_block("Commit Command E2E"):
        runner = create_rewrite_pipeline(
            global_context,
            commit_context,
            base_commit_hash,
            new_commit_hash,
            source="commit",
        )

        new_commit_hash = runner.run()

    # now that we rewrote our changes into a clean link of commits, update the current branch to reference this
    if new_commit_hash is not None and new_commit_hash != base_commit_hash:
        current_branch = global_context.git_commands.get_current_branch()

        global_context.git_interface.run_git_binary_out(
            ["update-ref", f"refs/heads/{current_branch}", new_commit_hash]
        )

        logger.debug(
            "Branch updated: branch={branch} new_head={head}",
            branch=current_branch,
            head=new_commit_hash,
        )

        # Sync the Git Index (Staging Area) to the new HEAD.
        # This makes the files you just committed show up as "Clean".
        # Files you skipped (outside target) will show up as "Modified" (Unstaged).
        # We use 'read-tree' WITHOUT '-u' so it doesn't touch physical files.
        global_context.git_interface.run_git_binary_out(["read-tree", "HEAD"])

        logger.info(
            "Commit command completed successfully",
        )
    else:
        logger.info(f"{Fore.YELLOW}No commits were created{Style.RESET_ALL}")


def main(
    ctx: typer.Context,
    target: str | None = typer.Argument(
        None, help="Path to file or directory to commit."
    ),
    message: str | None = typer.Option(
        None,
        "-m",
        help="Context or instructions for the AI to generate the commit message",
    ),
    intent: str | None = typer.Option(
        None,
        "--intent",
        help="Intent or purpose for the commit, used for relevance filtering.",
    ),
    fail_on_syntax_errors: bool = typer.Option(
        False,
        "--fail-on-syntax-errors",
        help="Fail the commit if syntax errors are detected in the changes.",
    ),
) -> None:
    """
    Commit current changes into small logical commits.
    (If you wish to modify existing history, use codestory fix or codestory clean)

    Examples:
        # Commit all changes interactively
        cst commit

        # Commit specific directory with message
        cst commit src/  -m "Make 2 commits, one for refactor, one for feature A..."

        # Commit changes with an intent filter enabled
        cst commit --intent "refactor abc into a class"
    """
    global_context: GlobalContext = ctx.obj
    with handle_codestory_exception():
        if global_context.config.relevance_filter_level != "none" and intent is None:
            raise ValidationError(
                "--intent must be provided when relevance filter is active. Check cst config if you want to disable relevance filtering",
            )
        run_commit(
            ctx.obj,
            target,
            message,
            global_context.config.secret_scanner_aggression,
            global_context.config.relevance_filter_level,
            intent,
            fail_on_syntax_errors,
        )

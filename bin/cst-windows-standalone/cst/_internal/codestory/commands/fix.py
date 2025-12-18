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

import typer
from colorama import Fore, Style
from loguru import logger

from codestory.context import CommitContext, FixContext, GlobalContext
from codestory.core.exceptions import (
    DetachedHeadError,
    GitError,
    handle_codestory_exception,
)
from codestory.core.git_interface.interface import GitInterface
from codestory.core.logging.utils import time_block
from codestory.core.validation import (
    validate_commit_hash,
    validate_no_merge_commits_in_range,
)


def get_info(git_interface: GitInterface, fix_context: FixContext):
    # Resolve current branch and head
    current_branch = (
        git_interface.run_git_text_out(["rev-parse", "--abbrev-ref", "HEAD"]).strip()
        or ""
    )
    head_hash = git_interface.run_git_text_out(["rev-parse", "HEAD"]).strip() or ""

    if not current_branch:
        raise DetachedHeadError("Detached HEAD is not supported for codestory fix")

    # Verify end commit exists and is on current branch history
    end_resolved = (
        git_interface.run_git_text_out(["rev-parse", fix_context.end_commit_hash]) or ""
    ).strip()
    if not end_resolved:
        raise GitError(f"Commit not found: {fix_context.end_commit_hash}")

    is_ancestor = git_interface.run_git_text(
        ["merge-base", "--is-ancestor", end_resolved, head_hash]
    )
    if is_ancestor is None or is_ancestor.returncode != 0:
        raise GitError(
            "The end commit must be an ancestor of HEAD (linear history only)."
        )

    # Determine base commit (start)
    if fix_context.start_commit_hash:
        # User provided explicit start commit
        start_resolved = (
            git_interface.run_git_text_out(["rev-parse", fix_context.start_commit_hash])
            or ""
        ).strip()
        if not start_resolved:
            raise GitError(f"Start commit not found: {fix_context.start_commit_hash}")

        # Validate that start < end (start is ancestor of end)
        is_start_before_end = git_interface.run_git_text(
            ["merge-base", "--is-ancestor", start_resolved, end_resolved]
        )
        if is_start_before_end is None or is_start_before_end.returncode != 0:
            raise GitError(
                "Start commit must be an ancestor of end commit (start < end)."
            )

        # Ensure start != end
        if start_resolved == end_resolved:
            raise GitError("Start and end commits cannot be the same.")

        base_hash = start_resolved
    else:
        # Default: use end's parent as start (original behavior)
        base_hash = (
            git_interface.run_git_text_out(["rev-parse", f"{end_resolved}^"]) or ""
        ).strip()

        if not base_hash:
            raise GitError("Fixing the root commit is not supported yet!")

    # Validate that there are no merge commits in the range to be fixed
    validate_no_merge_commits_in_range(git_interface, base_hash, head_hash)

    return base_hash, end_resolved, current_branch


def run_fix(global_context: GlobalContext, commit_hash: str, start_commit: str | None):
    validated_end_hash = validate_commit_hash(commit_hash)
    validated_start_hash = validate_commit_hash(start_commit) if start_commit else None

    fix_context = FixContext(
        end_commit_hash=validated_end_hash, start_commit_hash=validated_start_hash
    )

    logger.debug("Fix command started", fix_context=fix_context)

    base_hash, new_hash, base_branch = get_info(
        global_context.git_interface, fix_context
    )

    commit_context = CommitContext(
        target=None,
        # TODO add custom fix message
        message=None,
        # no filters because we cannot selectively edit changes in a fix
        relevance_filter_level="none",
        relevance_filter_intent=None,
        secret_scanner_aggression="none",
        fail_on_syntax_errors=False,
    )

    from codestory.pipelines.fix_pipeline import FixPipeline
    from codestory.pipelines.rewrite_init import create_rewrite_pipeline

    rewrite_pipeline = create_rewrite_pipeline(
        global_context, commit_context, base_hash, new_hash, source="fix"
    )

    # Execute expansion
    with time_block("Fix Pipeline E2E"):
        service = FixPipeline(global_context, fix_context, rewrite_pipeline)
        final_head = service.run()

    if final_head is not None:
        final_head = final_head.strip()

        # Update the branch reference and sync the working directory
        logger.debug(
            "Finalizing update: {branch} -> {head}",
            branch=base_branch,
            head=final_head,
        )

        # Update the reference pointer
        global_context.git_interface.run_git_text_out(
            ["update-ref", f"refs/heads/{base_branch}", final_head]
        )

        # Sync the working directory to the new head
        global_context.git_interface.run_git_text_out(["read-tree", "HEAD"])

        logger.info("Fix command completed successfully")
    else:
        logger.error(f"{Fore.RED}Failed to fix commit{Style.RESET_ALL}")


def main(
    ctx: typer.Context,
    commit_hash: str = typer.Argument(
        None, help="Hash of the end commit to split or fix"
    ),
    start_commit: str = typer.Option(
        None,
        "--start",
        help="Hash of the start commit, non inclusive (optional). If not provided, uses end commit's parent.",
    ),
) -> None:
    """Turn a past commit or range of commits into small logical commits.

    Examples:
        # Fix a specific commit (--start will be parent of def456)
        cst fix def456

        # Fix a range of commits from start to end
        cst fix def456 --start abc123
    """
    with handle_codestory_exception():
        run_fix(ctx.obj, commit_hash, start_commit)

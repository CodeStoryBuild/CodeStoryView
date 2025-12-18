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
from loguru import logger

from codestory.commands.fix import run_fix
from codestory.context import CleanContext, GlobalContext
from codestory.core.exceptions import handle_codestory_exception
from codestory.core.logging.utils import time_block
from codestory.core.validation import (
    validate_commit_hash,
    validate_ignore_patterns,
    validate_min_size,
    validate_no_merge_commits_in_range,
)


def run_clean(
    global_context: GlobalContext,
    ignore: list[str] | None,
    min_size: int | None,
    start_from: str | None,
):
    def fix_command(commit_hash: str):
        run_fix(
            global_context=global_context, commit_hash=commit_hash, start_commit=None
        )

    validated_ignore = validate_ignore_patterns(ignore)
    validated_min_size = validate_min_size(min_size)
    validated_start_from = None

    if start_from:
        validated_start_from = validate_commit_hash(start_from)
        # Validate that there are no merge commits in the range to be cleaned
        validate_no_merge_commits_in_range(
            global_context.git_interface, validated_start_from, "HEAD"
        )

    clean_context = CleanContext(
        ignore=validated_ignore,
        min_size=validated_min_size,
        start_from=validated_start_from,
    )

    logger.debug(
        "Clean command started",
        ignore_patterns=validated_ignore,
        min_size=validated_min_size,
        start_from=validated_start_from,
    )

    # Execute cleaning
    from codestory.pipelines.clean_pipeline import CleanPipeline

    with time_block("Clean Runner E2E"):
        runner = CleanPipeline(global_context, clean_context, fix_command)
        success = runner.run()

    if success:
        logger.info("Clean command completed successfully")
    else:
        logger.error("Clean operation failed")


def main(
    ctx: typer.Context,
    ignore: list[str] | None = typer.Option(
        None,
        "--ignore",
        help="Commit hashes or prefixes to ignore.",
    ),
    min_size: int | None = typer.Option(
        None,
        "--min-size",
        help="Minimum change size (lines) to process.",
    ),
    start_from: str | None = typer.Argument(
        None,
        help="Starting commit hash or prefix (inclusive). Defaults to HEAD.",
    ),
) -> None:
    """Fix your entire repository starting from the latest commit.

    Note: This command will stop at the first merge commit encountered.
    Merge commits cannot be rewritten and will mark the boundary of the clean operation.

    Examples:
        # Clean starting from the latest commit
        cst clean

        # Clean starting from a specific commit with a minimum line count of 5
        cst clean abc123 --min-size 5

        # Clean while ignoring certain commits
        cst clean --ignore def456 --ignore ghi789
    """
    with handle_codestory_exception():
        run_clean(ctx.obj, ignore, min_size, start_from)

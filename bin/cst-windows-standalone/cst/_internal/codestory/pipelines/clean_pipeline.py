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

from __future__ import annotations

from collections.abc import Callable, Sequence

from loguru import logger

from codestory.context import CleanContext, GlobalContext
from codestory.core.exceptions import CleanCommandError


class CleanPipeline:
    """Iteratively fix commits from HEAD down to the second commit.

    The pipeline stops at the first merge commit encountered (merge commits are not processed).

    Filtering rules:
    - ignore: any commit whose hash starts with any ignore token will be skipped
    - min_size: if provided, skip commits whose (additions + deletions) < min_size
    """

    def __init__(
        self,
        global_context: GlobalContext,
        clean_context: CleanContext,
        fix_command: Callable[[str], str],
    ):
        self.global_context = global_context
        self.clean_context = clean_context
        self.fix_command = fix_command

    def run(self) -> bool:
        commits = self._get_first_parent_commits(self.clean_context.start_from)[
            :-1
        ]  # we skip root commit

        if not commits:
            logger.warning(
                "No candidate commits to clean, please note cleaning root commit is not supported!"
            )
            return False

        total = len(commits)

        logger.debug(
            "Starting codestory clean operation on {total} commits", total=total
        )

        fixed = 0
        skipped = 0

        for idx, commit in enumerate(commits):
            short = commit[:7]

            # Stop at the first merge commit
            if self._is_merge(commit):
                logger.debug(
                    "Stopping at merge commit {commit}. Cleaned {fixed} commits.",
                    commit=short,
                    fixed=fixed,
                )
                break

            # TODO use for more cool stuff:
            # parent = self.global_context.git_commands.try_get_parent_hash(
            #     commit, empty_on_fail=True
            # )
            # diff_chunks, immut_chunks = (
            #     self.global_context.git_commands.get_processed_working_diff(
            #         parent, commit
            #     )
            # )

            # context_manager = ContextManager(
            #     diff_chunks,
            #     GitFileReader(self.global_context.git_interface, parent, commit),
            #     fail_on_syntax_errors=False,
            # )
            # annotated_chunks = ChunkLabeler.annotate_chunks(
            #     diff_chunks, context_manager
            # )

            if self._is_ignored(commit, self.clean_context.ignore):
                logger.debug("Skipping ignored commit {commit}", commit=short)
                skipped += 1
                continue

            if self.clean_context.min_size is not None:
                changes = self._count_line_changes(commit)
                if changes is None:
                    logger.debug(
                        "Skipping {commit}: unable to count changes",
                        commit=short,
                    )
                    skipped += 1
                    continue
                if changes < self.clean_context.min_size:
                    logger.debug(
                        "Skipping {commit}: {changes} < min-size {min_size}",
                        commit=short,
                        changes=changes,
                        min_size=self.clean_context.min_size,
                    )
                    skipped += 1
                    continue

            logger.debug(
                "Fix commit {commit} ({idx}/{total})",
                commit=short,
                idx=idx,
                total=total,
            )
            self.fix_command(commit)
            fixed += 1

        logger.success(
            "Clean operation complete: fixed={fixed}, skipped={skipped}",
            fixed=fixed,
            skipped=skipped,
        )
        return True

    def _get_first_parent_commits(self, start_from: str | None = None) -> list[str]:
        start_ref = start_from or "HEAD"
        if start_from:
            # Resolve the commit hash first to ensure it exists
            resolved = self.global_context.git_interface.run_git_text_out(
                ["rev-parse", start_from]
            )
            if resolved is None:
                raise CleanCommandError(f"Could not resolve commit: {start_from}")
            start_ref = resolved.strip()

        out = (
            self.global_context.git_interface.run_git_text_out(
                ["rev-list", "--first-parent", start_ref]
            )
            or ""
        )
        return [line.strip() for line in out.splitlines() if line.strip()]

    def _is_merge(self, commit: str) -> bool:
        line = (
            self.global_context.git_interface.run_git_text_out(
                ["rev-list", "--parents", "-n", "1", commit]
            )
            or ""
        )
        parts = line.strip().split()
        # format: <commit> <p1> [<p2> ...]
        return len(parts) > 2

    def _is_ignored(self, commit: str, ignore: Sequence[str] | None) -> bool:
        if not ignore:
            return False
        return any(commit.startswith(token) for token in ignore)

    def _count_line_changes(self, commit: str) -> int | None:
        # Sum additions + deletions between parent and commit.
        # Use numstat for robust parsing; binary files show '-' which we treat as 0.
        out = self.global_context.git_interface.run_git_text_out(
            ["diff", "--numstat", f"{commit}^", commit]
        )
        if out is None:
            return None
        total = 0
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            a, d = parts[0], parts[1]
            try:
                add = int(a)
            except ValueError:
                add = 0
            try:
                dele = int(d)
            except ValueError:
                dele = 0
            total += add + dele
        return total

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

import contextlib
from typing import Literal

import typer
from colorama import Fore, Style
from loguru import logger
from tqdm import tqdm

from codestory.context import CommitContext, GlobalContext
from codestory.core.chunker.interface import MechanicalChunker
from codestory.core.data.chunk import Chunk
from codestory.core.data.commit_group import CommitGroup
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.diff_generation.git_diff_generator import GitDiffGenerator
from codestory.core.diff_generation.semantic_diff_generator import SemanticDiffGenerator
from codestory.core.file_reader.protocol import FileReader
from codestory.core.git_commands.git_commands import GitCommands
from codestory.core.git_interface.interface import GitInterface
from codestory.core.grouper.interface import LogicalGrouper
from codestory.core.logging.utils import log_chunks, time_block
from codestory.core.relevance_filter.relevance_filter import (
    RelevanceFilter,
    RelevanceFilterConfig,
)
from codestory.core.secret_scanner.secret_scanner import filter_hunks
from codestory.core.semantic_grouper.context_manager import ContextManager
from codestory.core.semantic_grouper.semantic_grouper import SemanticGrouper
from codestory.core.synthesizer.git_synthesizer import GitSynthesizer


@contextlib.contextmanager
def transient_step(description: str, silent: bool):
    """
    Creates an indeterminate progress bar that animates while processing
    and cleans itself up immediately upon exit.
    """
    if silent:
        yield None
    else:
        # total=None -> Indeterminate mode (scanner animation)
        # leave=False -> Clears the line when context exits
        with tqdm(desc=description, total=None, leave=False, unit="it") as pbar:
            yield pbar


def print_patch_cleanly(patch_content: str, max_length: int = 120):
    """
    Displays a patch/diff content cleanly using direct Colorama styling.
    """
    # Direct mapping to Colorama styles
    styles = {
        "diff_header": Fore.BLUE,
        "between_diff": Fore.WHITE + Style.BRIGHT,
        "header_removed": Fore.RED + Style.BRIGHT,
        "header_added": Fore.GREEN + Style.BRIGHT,
        "hunk": Fore.BLUE,
        "removed": Fore.RED,
        "added": Fore.GREEN,
        "context": Fore.WHITE + Style.DIM,
    }

    # Iterate through the patch content line by line
    between_diff_and_hunk = False

    for line in patch_content.splitlines()[:max_length]:
        style_key = "context"  # default

        # Check up to the first ten characters (optimizes for large lines)
        prefix = line[:10]

        if prefix.startswith("diff --git"):
            style_key = "diff_header"
            between_diff_and_hunk = True
        elif prefix.startswith("---"):
            style_key = "header_removed"
            between_diff_and_hunk = False
        elif prefix.startswith("+++"):
            style_key = "header_added"
            between_diff_and_hunk = False
        elif prefix.startswith("@@"):
            style_key = "hunk"
        elif prefix.startswith("-"):
            style_key = "removed"
        elif prefix.startswith("+"):
            style_key = "added"
        elif between_diff_and_hunk:
            # lines after diff header, before first hunk (e.g., file mode lines)
            style_key = "between_diff"

        # we print (not logger) because this is a required output, the user needs to know what changes to accept/reject

        # Apply style directly
        print(f"{styles[style_key]}{line}{Style.RESET_ALL}")

    if len(patch_content.splitlines()) > max_length:
        print(f"{Fore.YELLOW}(Diff truncated){Style.RESET_ALL}\n")


def describe_chunk(data: Chunk | ImmutableChunk | CommitGroup) -> str:
    if isinstance(data, CommitGroup):
        return "\n".join([describe_chunk(chunk) for chunk in data.chunks])

    if isinstance(data, Chunk):
        files: dict[str, int] = {}
        for diff_c in data.get_chunks():
            path = diff_c.canonical_path().decode("utf-8", errors="replace")
            files[path] = files.get(path, 0) + 1

        return "\n".join([f"{num} changes in {path}" for path, num in files.items()])
    else:
        return "A change for " + data.canonical_path.decode("utf-8", errors="replace")


class RewritePipeline:
    def __init__(
        self,
        global_context: GlobalContext,
        commit_context: CommitContext,
        git: GitInterface,
        commands: GitCommands,
        mechanical_chunker: MechanicalChunker,
        semantic_grouper: SemanticGrouper,
        logical_grouper: LogicalGrouper,
        synthesizer: GitSynthesizer,
        file_reader: FileReader,
        base_commit_hash: str,
        new_commit_hash: str,
        source: Literal["commit", "fix"],
    ):
        self.global_context = global_context
        self.commit_context = commit_context
        self.git = git
        self.commands = commands
        self.mechanical_chunker = mechanical_chunker
        self.semantic_grouper = semantic_grouper
        self.logical_grouper = logical_grouper
        self.synthesizer = synthesizer
        self.file_reader = file_reader
        self.base_commit_hash = base_commit_hash
        self.new_commit_hash = new_commit_hash
        self.source = source
        self.can_reject_changes = source == "commit"

    def run(self) -> str | None:
        # Initial invocation summary
        logger.debug(
            "Pipeline run started: commit_context={commit_context} base_commit={base} new_commit={new}",
            commit_context=self.commit_context,
            base=self.base_commit_hash,
            new=self.new_commit_hash,
        )

        # Diff between the base commit and the backup branch commit - all working directory changes
        with time_block("raw_diff_generation_ms"):
            raw_chunks, immutable_chunks = self.commands.get_processed_working_diff(
                self.base_commit_hash,
                self.new_commit_hash,
                str(self.commit_context.target) if self.commit_context.target else None,
            )

        log_chunks(
            "raw_diff_generation_ms (with immutable groups)",
            raw_chunks,
            immutable_chunks,
        )

        if not (raw_chunks or immutable_chunks):
            logger.info("No changes to process.")
            if self.source == "commit":
                logger.info(
                    f"{Fore.YELLOW}If you meant to modify existing git history, please use codestory fix or codestory clean commands{Style.RESET_ALL}"
                )
            return None

        # init context_manager
        context_manager = ContextManager(
            raw_chunks,
            self.file_reader,
            self.commit_context.fail_on_syntax_errors,
        )

        if raw_chunks:
            # create smallest mechanically valid chunks
            with (
                transient_step(
                    "Creating Mechanical Chunks", self.global_context.config.silent
                ),
                time_block("mechanical_chunking"),
            ):
                mechanical_chunks: list[Chunk] = self.mechanical_chunker.chunk(
                    raw_chunks, context_manager
                )

            log_chunks(
                "mechanical_chunks (without immutable groups)",
                mechanical_chunks,
                [],
            )

            with (
                transient_step(
                    "Creating Semantic Groups", self.global_context.config.silent
                ),
                time_block("semantic_grouping"),
            ):
                semantic_chunks = self.semantic_grouper.group_chunks(
                    mechanical_chunks, context_manager
                )

            log_chunks(
                "Semantic Chunks (without immutable groups)",
                semantic_chunks,
                [],
            )
        else:
            semantic_chunks = []

        # first optionally filter secrets
        if (
            self.commit_context.secret_scanner_aggression != "none"
            and self.can_reject_changes
        ):
            with (
                transient_step(
                    "Scanning for leaked secrets...",
                    self.global_context.config.silent,
                ),
                time_block("secret_scanning"),
            ):
                (
                    semantic_chunks,
                    immutable_chunks,
                    rejected_chunks,
                ) = filter_hunks(
                    semantic_chunks,
                    immutable_chunks,
                    config=None,
                )

            if rejected_chunks:
                logger.info(
                    f"Rejected {len(rejected_chunks)} chunks due to potental hardcoded secrets"
                )
                logger.info("---------- affected chunks ----------")
                for chunk in rejected_chunks:
                    logger.info(describe_chunk(chunk))
                logger.info("These groups will simply stay as uncommited changes\n")

        # then filter for relevance if configured
        if (
            self.can_reject_changes
            and self.commit_context.relevance_filter_level != "none"
            and self.global_context.get_model() is not None
        ):
            with (
                transient_step(
                    "Applying Relevance Filter...",
                    self.global_context.config.silent,
                ) as pbar,
                time_block("relevance_filtering"),
            ):
                relevance_filter = RelevanceFilter(
                    self.global_context.get_model(),
                    RelevanceFilterConfig(
                        level=self.commit_context.relevance_filter_level
                    ),
                )

                (
                    semantic_chunks,
                    immutable_chunks,
                    rejected_relevance,
                ) = relevance_filter.filter(
                    semantic_chunks,
                    immutable_chunks,
                    intent=self.commit_context.relevance_filter_intent,
                    pbar=pbar,
                )

            if rejected_relevance:
                logger.info(
                    f"Rejected {len(rejected_relevance)} chunks due to not being relevant for the commit"
                )
                logger.info("---------- affected chunks ----------")
                for chunk in rejected_relevance:
                    logger.info(describe_chunk(chunk))
                logger.info("These chunks will simply stay as uncommited changes\n")

        if self.commit_context.relevance_filter_level != "none" and (
            self.global_context.get_model() is None or not self.can_reject_changes
        ):
            logger.warning(
                "Relevance filter level is set to '{level}' but not currently able to reject changes",
                level=self.commit_context.relevance_filter_level,
            )

        # take these semantically valid, filtered chunks, and now group them into logical commits
        with (
            transient_step(
                "Using AI to create meaningful commits...",
                self.global_context.config.silent,
            ) as pbar,
            time_block("logical_grouping"),
        ):
            # Simple progress callback to keep the animation alive
            logical_groups: list[CommitGroup] = self.logical_grouper.group_chunks(
                semantic_chunks,
                immutable_chunks,
                context_manager,
                self.commit_context.message,
                pbar=pbar,
            )

        if not logical_groups:
            logger.warning("No proposed commits to apply")
            logger.info("No AI groups proposed; aborting pipeline")
            return None

        logger.info("Proposed commits preview")

        # Prepare pretty diffs for each proposed group
        all_affected_files = set()
        if self.global_context.config.display_diff_type == "git":
            display_patch_map = GitDiffGenerator(logical_groups).get_patches(
                logical_groups
            )
        else:
            display_patch_map = SemanticDiffGenerator(logical_groups).get_patches(
                logical_groups
            )

        accepted_groups = []
        user_rejected_groups = []

        for idx, group in enumerate(logical_groups):
            num = idx + 1
            logger.info(
                "\n------------- Proposed commit #{num}: {message} -------------",
                num=num,
                message=group.commit_message,
            )

            if group.extended_message:
                logger.info(
                    "Extended message: {message}",
                    message=group.extended_message,
                )

            affected_files = set()
            for chunk in group.chunks:
                if isinstance(chunk, ImmutableChunk):
                    affected_files.add(
                        chunk.canonical_path.decode("utf-8", errors="replace")
                    )
                else:
                    for diff_chunk in chunk.get_chunks():
                        if diff_chunk.is_file_rename:
                            old_path = (
                                diff_chunk.old_file_path.decode(
                                    "utf-8", errors="replace"
                                )
                                if isinstance(diff_chunk.old_file_path, bytes)
                                else diff_chunk.old_file_path
                            )
                            new_path = (
                                diff_chunk.new_file_path.decode(
                                    "utf-8", errors="replace"
                                )
                                if isinstance(diff_chunk.new_file_path, bytes)
                                else diff_chunk.new_file_path
                            )
                            affected_files.add(f"{old_path} -> {new_path}")
                        else:
                            path = diff_chunk.canonical_path()
                            affected_files.add(
                                path.decode("utf-8", errors="replace")
                                if isinstance(path, bytes)
                                else path
                            )

            all_affected_files.update(affected_files)

            files_preview = ", ".join(sorted(affected_files))
            if len(files_preview) > 120:
                files_preview = files_preview[:117] + "..."
            logger.info("Files: {files}\n", files=files_preview)

            # Log the diff for this group at debug level
            diff_text = display_patch_map.get(idx, "") or "(no diff)"

            if not (
                self.global_context.config.silent
                and self.global_context.config.auto_accept
            ):
                print(f"Diff for #{num}:")
                if diff_text != "(no diff)":
                    print_patch_cleanly(diff_text, max_length=120)
                else:
                    print(f"{Fore.YELLOW}(no diff){Style.RESET_ALL}")

            logger.debug(
                "Group preview: idx={idx} chunks={chunk_count} files={files}",
                idx=idx,
                chunk_count=len(group.chunks),
                files=len(affected_files),
            )

            # Acceptance/modification of groups:
            if not self.global_context.config.auto_accept:
                if self.global_context.config.ask_for_commit_message:
                    if self.can_reject_changes:
                        custom_message = typer.prompt(
                            "Would you like to optionally override this commit message with a custom message? (type N/n if you wish to reject this change)",
                            default="",
                            type=str,
                        ).strip()
                        # possible rejection of group
                        if custom_message.lower() == "n":
                            user_rejected_groups.append(group)
                            continue
                    else:
                        custom_message = typer.prompt(
                            "Would you like to optionally override this commit message with a custom message?",
                            default="",
                            type=str,
                        ).strip()

                    if custom_message:
                        # TODO how should we handle extended message
                        group = CommitGroup(group.chunks, commit_message=custom_message)

                    accepted_groups.append(group)
                else:
                    if self.can_reject_changes:
                        keep = typer.confirm(
                            "Do you want to commit this change?", default=True
                        )
                        if keep:
                            accepted_groups.append(group)
                        else:
                            user_rejected_groups.append(group)
                    else:
                        accepted_groups.append(group)
            else:
                accepted_groups.append(group)

        if user_rejected_groups:
            logger.info(
                f"Rejected {len(user_rejected_groups)} commits due to user input"
            )
            logger.info("---------- affected chunks ----------")
            for group in user_rejected_groups:
                logger.info(describe_chunk(group))
            logger.info("These chunks will simply stay as uncommited changes\n")

        num_acc = len(accepted_groups)
        if num_acc == 0:
            logger.info("No changes applied")
            logger.info("User did not accept any commits")
            return None

        if self.global_context.config.auto_accept:
            apply_final = True
            logger.info(f"Auto-confirm: Applying {num_acc} proposed commits")
        else:
            apply_final = typer.confirm(
                f"Apply {num_acc} proposed commits?",
                default=True,
            )

        if not apply_final:
            logger.info("No changes applied")
            logger.info("User declined applying commits")
            return None

        logger.debug(
            "Num accepted groups: {groups}",
            groups=num_acc,
        )

        with time_block("Executing Synthesizer Pipeline"):
            new_commit_hash = self.synthesizer.execute_plan(
                accepted_groups, self.base_commit_hash
            )

        # Final pipeline summary
        logger.debug(
            "Pipeline summary: input_chunks={raw} mechanical={mech} semantic_groups={sem} logical_groups={log} final_groups={acc} files_changed={files}",
            raw=len(raw_chunks) + len(immutable_chunks),
            mech=len(
                mechanical_chunks if raw_chunks else []
            ),  # if only immutable chunks, there are no mechanical chunks
            sem=len(
                semantic_chunks if raw_chunks else []
            ),  # if only immutable chunks, there are no semantic chunks
            log=len(logical_groups),
            acc=len(accepted_groups),
            files=len(all_affected_files),
        )

        return new_commit_hash

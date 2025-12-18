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

from loguru import logger

from codestory.context import CommitContext, GlobalContext
from codestory.core.chunker.atomic_chunker import AtomicChunker
from codestory.core.exceptions import GitError
from codestory.core.file_reader.git_file_reader import GitFileReader
from codestory.core.grouper.embedding_grouper import EmbeddingGrouper
from codestory.core.grouper.single_grouper import SingleGrouper
from codestory.core.semantic_grouper.semantic_grouper import SemanticGrouper
from codestory.core.synthesizer.git_synthesizer import GitSynthesizer
from codestory.pipelines.rewrite_pipeline import RewritePipeline


def create_rewrite_pipeline(
    global_ctx: GlobalContext,
    commit_ctx: CommitContext,
    base_commit_hash: str,
    new_commit_hash: str,
    source: Literal["commit", "fix"],
):
    logger.info("Loading Rewrite Pipeline...")
    chunker = AtomicChunker(global_ctx.config.split_hunks)

    if global_ctx.get_model() is not None:
        logger.info(f"Using model {global_ctx.config.model} for AI grouping.")
        logical_grouper = EmbeddingGrouper(
            global_ctx.get_model(),
            batching_strategy=global_ctx.config.batching_strategy,
            max_tokens=global_ctx.config.max_tokens,
            custom_embedding_model=global_ctx.config.custom_embedding_model,
            cluster_strictness=global_ctx.config.cluster_strictness,
        )
    else:
        logger.warning("Using no ai grouping as rewrite_pipeline recieved no model!")
        logical_grouper = SingleGrouper()

    if new_commit_hash is None:
        raise GitError("Failed to backup working state, exiting.")

    file_reader = GitFileReader(
        global_ctx.git_interface, base_commit_hash, new_commit_hash
    )

    semantic_grouper = SemanticGrouper(global_ctx.config.fallback_grouping_strategy)

    synthesizer = GitSynthesizer(global_ctx.git_interface)

    pipeline = RewritePipeline(
        global_ctx,
        commit_ctx,
        global_ctx.git_interface,
        global_ctx.git_commands,
        chunker,
        semantic_grouper,
        logical_grouper,
        synthesizer,
        file_reader,
        base_commit_hash,
        new_commit_hash,
        source,
    )

    return pipeline

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
from time import perf_counter

from loguru import logger

from codestory.core.data.chunk import Chunk
from codestory.core.data.immutable_chunk import ImmutableChunk


@contextlib.contextmanager
def time_block(block_name: str):
    """
    A context manager to time the execution of a code block and log the result.
    """

    logger.debug(f"Starting {block_name}")
    start_time = perf_counter()

    try:
        yield
    finally:
        end_time = perf_counter()
        duration_ms = int((end_time - start_time) * 1000)

        logger.debug(
            f"Finished {block_name}. Timing(ms)={duration_ms}",
        )


def log_chunks(
    process_step: str, chunks: list[Chunk], immut_chunks: list[ImmutableChunk]
):
    unique_files = {
        (path.decode("utf-8", errors="replace") if isinstance(path, bytes) else path)
        for c in chunks
        for path in c.canonical_paths()
    }

    for immut_chunk in immut_chunks:
        unique_files.add(immut_chunk.canonical_path)

    logger.debug(
        "{process_step}: chunks={count} files={files}",
        process_step=process_step,
        count=len(chunks) + len(immut_chunks),
        files=len(unique_files),
    )

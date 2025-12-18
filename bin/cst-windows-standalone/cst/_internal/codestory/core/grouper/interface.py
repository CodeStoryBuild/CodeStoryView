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

"""
GrouperInterface

This interface is responsible for grouping atomic diff chunks into semantically-related sets.

Responsibilities:
- Analyze chunks and produce groups (ChunkGroup)
- Grouping can be based on:
  - AI semantic analysis (feature, refactor, bug fix)
  - Keyword linking (variable/function references)
  - File or directory heuristics
  - User-provided rules

Notes:
- Each ChunkGroup is intended to become one commit
- Can include optional group descriptions for AI-generated commit messages
- Supports flexibility in commit granularity and logical separation
"""

from abc import ABC, abstractmethod

from tqdm import tqdm

from codestory.core.data.chunk import Chunk
from codestory.core.data.commit_group import CommitGroup
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.semantic_grouper.context_manager import ContextManager


class LogicalGrouper(ABC):
    @abstractmethod
    def group_chunks(
        self,
        chunks: list[Chunk],
        immut_chunks: list[ImmutableChunk],
        context_manager: ContextManager,
        message: str,
        pbar: tqdm | None = None,
    ) -> list[CommitGroup]:
        """Return a list of ChunkGroup"""

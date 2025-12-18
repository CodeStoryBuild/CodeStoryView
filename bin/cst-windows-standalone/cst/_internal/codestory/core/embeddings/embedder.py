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

from importlib.resources import files

from codestory.constants import CUSTOM_EMBEDDING_CACHE_DIR, DEFAULT_EMBEDDING_MODEL
from codestory.core.exceptions import EmbeddingModelError


class Embedder:
    def __init__(self, model_name: str | None = None):
        from fastembed import TextEmbedding

        # Use default model if None or if explicitly the default model
        if model_name is None or model_name == DEFAULT_EMBEDDING_MODEL:
            cache_dir = files("codestory").joinpath("resources/embedding_models")
            # Load already downloaded model from cache dir
            self.embedding_model = TextEmbedding(
                DEFAULT_EMBEDDING_MODEL, cache_dir=str(cache_dir), local_files_only=True
            )
        else:
            # Custom model: use custom cache dir and allow downloads
            try:
                self.embedding_model = TextEmbedding(
                    model_name,
                    cache_dir=str(CUSTOM_EMBEDDING_CACHE_DIR),
                    local_files_only=False,
                )
            except Exception as e:
                raise EmbeddingModelError(
                    f"Failed to load custom embedding model '{model_name}': {str(e)}. "
                ) from e

    def embed(self, documents: list[str]):
        return list(self.embedding_model.embed(documents))  # Generator

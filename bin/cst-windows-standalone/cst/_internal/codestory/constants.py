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

from pathlib import Path

from platformdirs import user_config_dir, user_log_path

APP_NAME = "codestory"
ENV_APP_PREFIX = APP_NAME.upper() + "_"
LOG_DIR = Path(user_log_path(appname=APP_NAME))

ONBOARDING_FLAG = Path(user_config_dir(APP_NAME)) / "onboarding_flag"

CONFIG_FILENAME = "codestoryconfig.toml"

GLOBAL_CONFIG_FILE = Path(user_config_dir(APP_NAME)) / CONFIG_FILENAME
LOCAL_CONFIG_FILE = Path(CONFIG_FILENAME)

SUPPORTED_LANGUAGES = [
    "python",
    "javascript",
    "typescript",
    "java",
    "cpp",
    "csharp",
    "go",
    "rust",
    "ruby",
    "php",
    "swift",
    "kotlin",
    "scala",
    "r",
    "lua",
    "dart",
    "elixir",
    "haskell",
    "ocaml",
    "erlang",
    "clojure",
    "solidity",
    "julia",
    "bash",
    "c",
    "toml",
    "json",
    "yaml",
    "markdown",
    "rst",
    "html",
]


LOCAL_PROVIDERS = {"ollama"}

UNSUPPORTED_PROVIDERS = {"deepgram"}


def get_cloud_providers() -> set[str]:
    """Get supported cloud providers. Lazy-loaded to avoid expensive imports at startup."""
    from aisuite.provider import ProviderFactory

    return {
        provider
        for provider in ProviderFactory.get_supported_providers()
        if provider not in LOCAL_PROVIDERS and provider not in UNSUPPORTED_PROVIDERS
    }


# Embedding model constants
DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
CUSTOM_EMBEDDING_CACHE_DIR = Path(user_config_dir(APP_NAME)) / "embeddings_cache"

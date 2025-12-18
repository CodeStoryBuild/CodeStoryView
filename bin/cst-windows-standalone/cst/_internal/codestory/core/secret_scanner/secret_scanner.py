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

import math
import re
from dataclasses import dataclass, field
from re import Pattern
from typing import Literal

# Assumed imports from your codebase
from codestory.core.data.chunk import Chunk
from codestory.core.data.diff_chunk import DiffChunk
from codestory.core.data.immutable_chunk import ImmutableChunk
from codestory.core.data.line_changes import Addition

# -----------------------------------------------------------------------------
# Configuration & Constants
# -----------------------------------------------------------------------------


@dataclass
class ScannerConfig:
    aggression: Literal["safe", "standard", "strict"] = "safe"

    # Entropy threshold (0-8). Standard random base64 keys usually sit > 4.5
    entropy_threshold: float = 4.5

    # Minimum string length to trigger entropy check (avoid checking short words)
    entropy_min_len: int = 16  # Lowered slightly to catch shorter test secrets

    # Custom regex strings to block
    custom_blocklist: list[str] = field(default_factory=list)

    # File glob patterns to reject (e.g. "*.key", ".env*")
    blocked_file_patterns: list[str] = field(
        default_factory=lambda: [
            r".*\.env.*",  # .env, .env.local, prod.env
            r".*\.pem$",  # Private keys
            r".*\.key$",  # Generic key files
            r"^id_rsa$",  # SSH keys
            r".*secrets.*\.json$",
            r".*credentials.*\.xml$",
        ]
    )

    # File extensions to ignore content scanning for (images, locks)
    ignored_extensions: list[str] = field(
        default_factory=lambda: [
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".svg",
            ".lock",
            ".pdf",
        ]
    )


# -----------------------------------------------------------------------------
# Regex Patterns
# -----------------------------------------------------------------------------

PATTERNS_SAFE = [
    r"-----BEGIN [A-Z]+ PRIVATE KEY-----",
    r"(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA)[A-Z0-9]{16}",
    r"ghp_[0-9a-zA-Z]{36}",
    r"xox[baprs]-([0-9a-zA-Z]{10,48})?",
    r"sk_live_[0-9a-zA-Z]{24}",
    r"AIza[0-9A-Za-z\\-_]{35}",
]

PATTERNS_BALANCED = [
    # Looks for specific sensitive variable names assigned to string literals
    r"(?i)(api_?key|auth_?token|client_?secret|db_?pass|private_?key|aws_?secret)\s*[:=]\s*['\"][^'\"]+['\"]",
    r"(postgres|mysql|mongodb|redis|amqp)://[a-zA-Z0-9_]+:[a-zA-Z0-9_]+@",
]

PATTERNS_STRICT = [r"(?i)secret"]

# -----------------------------------------------------------------------------
# Entropy Calculation
# -----------------------------------------------------------------------------


def shannon_entropy(data: str) -> float:
    if not data:
        return 0
    entropy = 0.0
    length = len(data)
    counts = {}
    for char in data:
        counts[char] = counts.get(char, 0) + 1
    for count in counts.values():
        p_x = count / length
        entropy -= p_x * math.log2(p_x)
    return entropy


# -----------------------------------------------------------------------------
# Scanner Logic
# -----------------------------------------------------------------------------


class SecretScanner:
    def __init__(self, config: ScannerConfig):
        self.config = config
        self.patterns = self._compile_content_patterns()
        self.file_blocklist_regex = self._compile_file_patterns()

    def _compile_content_patterns(self) -> list[Pattern]:
        regex_list = list(PATTERNS_SAFE)

        if self.config.aggression in ["balanced", "STRICT"]:
            regex_list.extend(PATTERNS_BALANCED)

        if self.config.aggression == "strict":
            regex_list.extend(PATTERNS_STRICT)

        for block_str in self.config.custom_blocklist:
            regex_list.append(re.escape(block_str))

        return [re.compile(p) for p in regex_list]

    def _compile_file_patterns(self) -> Pattern:
        if not self.config.blocked_file_patterns:
            return re.compile(r"(?!x)x")
        combined = "|".join(f"(?:{p})" for p in self.config.blocked_file_patterns)
        return re.compile(combined, re.IGNORECASE)

    def _decode_bytes(self, data: bytes) -> str:
        try:
            return data.decode("utf-8", errors="ignore")
        except Exception:
            return ""

    def is_filename_blocked(self, file_path: bytes | None) -> bool:
        if file_path is None:
            return False
        name_str = self._decode_bytes(file_path)
        return bool(self.file_blocklist_regex.match(name_str))

    def is_extension_ignored(self, file_path: bytes | None) -> bool:
        if file_path is None:
            return False
        name_str = self._decode_bytes(file_path)
        return any(name_str.endswith(ext) for ext in self.config.ignored_extensions)

    def contains_high_entropy(self, text: str) -> bool:
        # Split by typical code delimiters: space, quote, equals, colon, comma, parens
        tokens = re.split(r"[\s\"'=:;,\(\)\[\]\{\}]+", text)

        for token in tokens:
            if len(token) < self.config.entropy_min_len:
                continue

            # FIXED: Removed the check that skipped tokens with "/"
            # Base64 strings often contain "/" (e.g. "aB+7/z==")

            score = shannon_entropy(token)
            if score > self.config.entropy_threshold:
                return True
        return False

    def scan_text_content(self, text: str) -> bool:
        # 1. Regex check
        for pattern in self.patterns:
            if pattern.search(text):
                return True

        # 2. Entropy check (only if NOT safe mode)
        return self.config.aggression != "safe" and self.contains_high_entropy(text)

    def check_diff_chunk(self, chunk: DiffChunk) -> bool:
        canonical = chunk.canonical_path()
        if self.is_filename_blocked(canonical):
            return True

        if self.is_extension_ignored(canonical):
            return False

        if not chunk.parsed_content:
            return False

        for item in chunk.parsed_content:
            if isinstance(item, Addition):
                text = self._decode_bytes(item.content)
                if self.scan_text_content(text):
                    return True
        return False

    def check_immutable_chunk(self, chunk) -> bool:
        # Duck typing for ImmutableChunk to avoid circular imports if necessary
        canonical = getattr(chunk, "canonical_path", None)
        if self.is_filename_blocked(canonical):
            return True

        if self.is_extension_ignored(canonical):
            return False

        file_patch = getattr(chunk, "file_patch", b"")
        content = self._decode_bytes(file_patch)

        for line in content.splitlines():
            # Standard Diff: Added lines start with '+'
            # Ignore header '+++'
            if line.startswith("+") and not line.startswith("+++"):
                clean_content = line[1:]
                if self.scan_text_content(clean_content):
                    return True
        return False


# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------


def filter_hunks(
    chunks: list[Chunk],
    immut_chunks: list[ImmutableChunk],
    config: ScannerConfig | None = None,
) -> tuple[list[Chunk], list[ImmutableChunk], list[Chunk | ImmutableChunk]]:
    """
    Filters chunks and immutable chunks for hardcoded secrets.

    The primary filtering rule is:
    If a Chunk (wrapper) contains ANY sensitive DiffChunk, the entire Chunk is rejected.

    Args:
        chunks: List of mutable Chunk wrappers.
        immut_chunks: List of ImmutableChunk objects (binary/large files).
        config: Scanner configuration.

    Returns:
        (accepted_chunks, accepted_immut_chunks, rejected_all)
    """
    if config is None:
        config = ScannerConfig()

    scanner = SecretScanner(config)

    accepted_chunks: list[Chunk] = []
    accepted_immut_chunks: list[ImmutableChunk] = []
    rejected: list[Chunk | ImmutableChunk] = []

    # 1. Process Mutable Chunks (Chunk wrappers)
    for chunk in chunks:
        # Check all internal DiffChunk objects
        internal_diffs = chunk.get_chunks()

        is_sensitive = False
        for diff_chunk in internal_diffs:
            # We must use the DiffChunk check here
            if scanner.check_diff_chunk(diff_chunk):
                is_sensitive = True
                break  # Reject the entire Chunk wrapper immediately

        if is_sensitive:
            rejected.append(chunk)
        else:
            accepted_chunks.append(chunk)

    # 2. Process Immutable Chunks
    for immut_chunk in immut_chunks:
        # We use the specialized ImmutableChunk check
        if scanner.check_immutable_chunk(immut_chunk):
            rejected.append(immut_chunk)
        else:
            accepted_immut_chunks.append(immut_chunk)

    return accepted_chunks, accepted_immut_chunks, rejected

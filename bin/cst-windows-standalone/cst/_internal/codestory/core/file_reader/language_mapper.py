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
language_detector.py

A lightweight, drop-in language detector for tree-sitter-language-pack.
Detects language based on filename, extension, shebang, and content heuristics.
"""

import re
from pathlib import Path

# -----------------------------------------------------------------------------
# 1. Exhaustive Mappings (Derived from tree-sitter-language-pack)
# -----------------------------------------------------------------------------

# Map specific filenames to languages
FILENAME_MAP = {
    "dockerfile": "dockerfile",
    "makefile": "make",
    "cmakelists.txt": "cmake",
    "go.mod": "gomod",
    "go.sum": "gosum",
    "cargo.toml": "toml",
    "cargo.lock": "toml",
    "package.json": "json",
    "tsconfig.json": "json",
    "gemfile": "ruby",
    "rakefile": "ruby",
    "vagrantfile": "ruby",
    "jenkinsfile": "groovy",
    "podfile": "ruby",
    "requirements.txt": "requirements",
    "meson.build": "meson",
    "commit_editmsg": "gitcommit",
    ".gitattributes": "gitattributes",
    ".gitignore": "gitignore",
    ".eslintrc": "json",
    ".prettierrc": "json",
    "qmldir": "qmldir",
}

# Map extensions to languages
# Note: Ambiguous extensions (keys mapping to multiple languages) are handled separately.
EXTENSION_MAP = {
    # Common
    ".py": "python",
    ".pyw": "python",
    ".js": "javascript",
    ".cjs": "javascript",
    ".mjs": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".c": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hxx": "cpp",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".rb": "ruby",
    ".php": "php",
    ".phtml": "php",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".xml": "xml",
    ".xaml": "xml",
    ".md": "markdown",
    ".sql": "sql",
    ".toml": "toml",
    # Specific / Less Common
    ".as": "actionscript",
    ".ada": "ada",
    ".adb": "ada",
    ".ads": "ada",
    ".agda": "agda",
    ".cls": "apex",
    ".ino": "arduino",
    ".asm": "asm",
    ".s": "asm",
    ".astro": "astro",
    ".bib": "bibtex",
    ".clj": "clojure",
    ".cljs": "clojure",
    ".edn": "clojure",
    ".cbl": "cobol",
    ".lisp": "commonlisp",
    ".cl": "commonlisp",
    ".dart": "dart",
    ".dockerfile": "dockerfile",
    ".ex": "elixir",
    ".exs": "elixir",
    ".elm": "elm",
    ".erl": "erlang",
    ".fs": "fsharp",
    ".gd": "gdscript",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".groovy": "groovy",
    ".gradle": "groovy",
    ".hs": "haskell",
    ".jl": "julia",
    ".lua": "lua",
    ".m": "ambiguous_m",  # Objective-C vs Matlab
    ".h": "ambiguous_h",  # C vs C++
    ".v": "ambiguous_v",  # Verilog vs V
    ".pl": "perl",
    ".pm": "perl",  # Assuming Prolog isn't in supported list
    ".ps1": "powershell",
    ".r": "r",
    ".scala": "scala",
    ".sc": "scala",
    ".sol": "solidity",
    ".swift": "swift",
    ".tf": "terraform",
    ".vhd": "vhdl",
    ".vhdl": "vhdl",
    ".vim": "vim",
    ".vue": "vue",
    ".zig": "zig",
    ".ml": "ocaml",
    ".rst": "rst",
}

# Map Interpreter (Shebang) names to Language
SHEBANG_MAP = {
    "python": "python",
    "python3": "python",
    "node": "javascript",
    "bash": "bash",
    "sh": "bash",
    "zsh": "bash",
    "perl": "perl",
    "ruby": "ruby",
    "php": "php",
    "lua": "lua",
    "tcl": "tcl",
    "make": "make",
}

# -----------------------------------------------------------------------------
# 2. Ambiguity Resolvers
# -----------------------------------------------------------------------------


def _resolve_h_file(content: str) -> str:
    """Disambiguate .h files (C vs C++)."""
    # Look for C++ specific keywords or syntax
    cpp_indicators = [
        r"\bclass\s+\w+",  # Class definition
        r"\btemplate\s*<",  # Templates
        r"\bnamespace\s+\w+",  # Namespaces
        r"\busing\s+namespace\b",  # using namespace
        r"\bpublic:",
        r"\bprivate:",
        r"\bprotected:",  # Access specifiers
        r"#include\s+<iostream>",  # C++ standard lib
        r"std::",  # std namespace usage
    ]

    for indicator in cpp_indicators:
        if re.search(indicator, content):
            return "cpp"

    # Default to C if no strong C++ signals are found
    return "c"


def _resolve_m_file(content: str) -> str:
    """Disambiguate .m files (Objective-C vs Matlab/Octave)."""
    # Objective-C indicators
    objc_indicators = [
        r"#import\s+",
        r"@interface",
        r"@implementation",
        r"@end",
        r"\[\s*\w+\s+\w+\s*\]",  # Message passing syntax [Obj method]
        r'@"',  # NSString literal
        r"NSLog",
    ]

    # Matlab indicators
    # Comments start with % in Matlab, // in ObjC (usually)

    for ind in objc_indicators:
        if re.search(ind, content):
            return "objc"

    # Check for Matlab comments specifically
    if re.search(r"^\s*%", content, re.MULTILINE):
        return "matlab"

    # Default to Objective-C as it's more common in tree-sitter contexts
    return "objc"


def _resolve_v_file(content: str) -> str:
    """Disambiguate .v files (Verilog vs V)."""
    # Verilog indicators
    verilog_indicators = [
        r"\bmodule\s+\w+",
        r"\bendmodule\b",
        r"\balways\s*@",
        r"\bassign\s+",
        r"\breg\b",
        r"\bwire\b",
    ]

    for ind in verilog_indicators:
        if re.search(ind, content):
            return "verilog"

    # V Language indicators (looks like Go/Rust)
    v_indicators = [
        r"\bfn\s+main",
        r"\bpub\s+fn",
        r"\bstruct\s+\w+",
    ]

    for ind in v_indicators:
        if re.search(ind, content):
            return "v"

    # Default to Verilog (older, more established)
    return "verilog"


# -----------------------------------------------------------------------------
# 3. Main Detection Function
# -----------------------------------------------------------------------------


def detect_tree_sitter_language(file_path: str, file_content: str = "") -> str | None:
    """
    Detects the language compatible with tree-sitter-language-pack.
    """
    path_obj = Path(file_path)
    filename = path_obj.name.lower()

    name_with_spaces = path_obj.name.strip().lower()

    # b. Normalize by removing all internal whitespace
    # This turns 'my go. mod' or 'pack age.json' into 'mygo.mod' or 'package.json'
    filename_normalized = re.sub(r"\s+", "", name_with_spaces)

    # 1. Check Exact Filenames (Highest Priority)
    if filename_normalized in FILENAME_MAP:
        return FILENAME_MAP[filename_normalized]

    # 2. Check Extension
    extension = path_obj.suffix.lower().strip()
    lang_candidate = EXTENSION_MAP.get(extension)

    # 3. Handle Ambiguous Extensions
    if lang_candidate == "ambiguous_h":
        return _resolve_h_file(file_content)
    elif lang_candidate == "ambiguous_m":
        return _resolve_m_file(file_content)
    elif lang_candidate == "ambiguous_v":
        return _resolve_v_file(file_content)
    elif lang_candidate:
        return lang_candidate

    # 4. Check Shebang (Robust Parsing)
    if file_content:
        # Get first line safely
        lines = file_content.splitlines()
        if not lines:
            return None
        first_line = lines[0].strip()

        if first_line.startswith("#!"):
            # Remove '#!' and strip whitespace
            # e.g. "#!/usr/bin/python3.9" -> "/usr/bin/python3.9"
            shebang_cmd = first_line[2:].strip()

            # Split command from arguments
            # e.g. "/usr/bin/env node" -> ["/usr/bin/env", "node"]
            parts = shebang_cmd.split()

            if not parts:
                return None

            interpreter_path = parts[0]
            interpreter = None

            # Logic to extract interpreter name
            if interpreter_path.endswith("env"):
                # Case: #!/usr/bin/env python
                if len(parts) > 1:
                    interpreter = parts[1]
            else:
                # Case: #!/usr/bin/python3 or #!/bin/bash
                interpreter = Path(interpreter_path).name

            if interpreter:
                # Normalize: remove trailing version numbers/dots
                # e.g. 'python3.9' -> 'python', 'python3' -> 'python'
                interpreter_clean = re.sub(r"[\d.]+$", "", interpreter)

                # Check exact match (e.g. 'node')
                if interpreter in SHEBANG_MAP:
                    return SHEBANG_MAP[interpreter]

                # Check cleaned match (e.g. 'python' from 'python3')
                if interpreter_clean in SHEBANG_MAP:
                    return SHEBANG_MAP[interpreter_clean]

    # 5. Fallback for specific dotfiles not in map
    if filename.startswith(".bash"):
        return "bash"
    if filename.startswith(".zsh"):
        return "bash"

    return None

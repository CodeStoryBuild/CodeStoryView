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

import os
from dataclasses import fields
from pathlib import Path
from textwrap import shorten
from typing import Any, Literal

import tomllib
import typer
from colorama import Fore, Style, init

from codestory.constants import (
    CONFIG_FILENAME,
    ENV_APP_PREFIX,
    GLOBAL_CONFIG_FILE,
    LOCAL_CONFIG_FILE,
)
from codestory.context import GlobalConfig
from codestory.core.exceptions import ConfigurationError, handle_codestory_exception

# Initialize colorama
init(autoreset=True)


def display_config(
    data: list[dict],
    description_field: str = "Description",
    key_field: str = "Key",
    value_field: str = "Value",
    source_field: str = "Source",
    max_value_length: int = 50,
) -> None:
    """
    Display config data in a two-line format:
    Key: Description
      Value (Source)
    """
    for item in data:
        key = str(item.get(key_field, ""))
        description = str(item.get(description_field, ""))
        value = str(item.get(value_field, ""))
        source = str(item.get(source_field, ""))

        # Truncate value if too long
        value_display = shorten(value, width=max_value_length, placeholder="...")

        # Line 1: Key + Description
        print(
            f"{Fore.CYAN}{Style.BRIGHT}{key}{Style.RESET_ALL}: "
            f"{Fore.WHITE}{description}{Style.RESET_ALL}"
        )
        # Line 2: Value + Source (Indented)
        print(
            f"  {Fore.GREEN}{value_display}{Style.RESET_ALL} "
            f"{Fore.YELLOW}({source}){Style.RESET_ALL}"
        )
        print()  # Spacer


def _get_config_schema() -> dict[str, dict[str, Any]]:
    """Get the schema of available config options from GlobalConfig."""
    # Descriptions for each config field
    schema = {}

    for field in fields(GlobalConfig):
        field_name = field.name
        # Get the type annotation if possible, defaulting to str
        field_type = field.type
        default_value = field.default
        constraint = GlobalConfig.constraints.get(field_name)
        description = GlobalConfig.descriptions.get(
            field_name, "No description available"
        )

        schema[field_name] = {
            "description": description,
            "default": default_value,
            "type": field_type,
            "constraint": constraint,
        }

    return schema


def _truncate_text(text: str, max_length: int = 50) -> str:
    """Truncate text with ellipsis if it exceeds max_length."""
    text_str = str(text)
    if len(text_str) <= max_length:
        return text_str
    return text_str[: max_length - 3] + "..."


def print_describe_options():
    schema = _get_config_schema()

    print(
        f"{Fore.WHITE}{Style.BRIGHT}Available configuration options:{Style.RESET_ALL}\n"
    )

    table_data = []
    for config_key, info in sorted(schema.items()):
        default_str = str(info["default"]) if info["default"] is not None else "None"
        description = _truncate_text(info["description"], 100)
        table_data.append(
            {
                "Key": config_key,
                "Description": description,
                "Value": default_str,
                "Source": "Options: " + str(info["constraint"]),
            }
        )

    display_config(
        table_data,
        description_field="Description",
        key_field="Key",
        value_field="Value",
        source_field="Source",
        max_value_length=80,
    )


def _check_key_exists(key: str, exit_on_fail: bool = True) -> dict:
    """Check if a config key exists. If not, show available options and exit."""
    schema = _get_config_schema()

    if key not in schema:
        print(f"{Fore.RED}Error:{Style.RESET_ALL} Unknown configuration key '{key}'\n")
        print_describe_options()
        if exit_on_fail:
            raise typer.Exit(1)

    return schema[key]


def _add_to_gitignore(config_filename: str) -> None:
    """Add config file to .gitignore if it exists, otherwise print warning."""
    gitignore_path = Path(".gitignore")

    if gitignore_path.exists():
        gitignore_content = gitignore_path.read_text()
        if config_filename not in gitignore_content:
            with gitignore_path.open("a") as f:
                if gitignore_content and not gitignore_content.endswith("\n"):
                    f.write("\n")
                f.write(f"{config_filename}\n")
            print(f"Added {config_filename} to .gitignore")
    else:
        print(
            f"{Fore.YELLOW}Warning:{Style.RESET_ALL} .gitignore not found. "
            f"Please consider adding {config_filename} to your .gitignore file to avoid committing API keys."
        )


def set_config(key: str, value: str, scope: str) -> None:
    """Set a configuration value in the specified scope."""
    field_info = _check_key_exists(key)

    if scope == "env":
        env_var = f"{ENV_APP_PREFIX}{key}"
        print(f"{Fore.GREEN}To set this as an environment variable:{Style.RESET_ALL}")
        print(f"  Windows (PowerShell): $env:{env_var}='{value}'")
        print(f"  Windows (CMD): set {env_var}={value}")
        print(f"  Linux/macOS: export {env_var}='{value}'")
        return

    # Determine config file path based on scope
    if scope == "global":
        config_path = GLOBAL_CONFIG_FILE
        config_path.parent.mkdir(parents=True, exist_ok=True)
    else:  # local
        config_path = LOCAL_CONFIG_FILE
        _add_to_gitignore(CONFIG_FILENAME)

    # Load existing config
    config_data = {}
    if config_path.exists():
        try:
            with open(config_path, "rb") as f:
                config_data = tomllib.load(f)
        except tomllib.TOMLDecodeError as e:
            print(f"Failed to parse existing config: {e}. Creating new config.")

    # Type Conversion
    # Inputs from CLI are always strings, but TOML supports types.
    # We check the GlobalConfig type annotation to convert properly.
    final_value = value

    # If a constraint exists, use it for coercion and validation
    constraint = field_info.get("constraint")
    try:
        final_value = constraint.coerce(value)
    except ConfigurationError as e:
        print(f"{Fore.RED}Error:{Style.RESET_ALL} Invalid value for {key}: {e}")
        raise typer.Exit(1)

    # Update the value
    config_data[key] = final_value

    # Write back to file (Simple TOML serialization)
    with open(config_path, "w") as f:
        for k, v in config_data.items():
            if isinstance(v, bool):
                f.write(f"{k} = {str(v).lower()}\n")
            elif isinstance(v, (int, float)):
                f.write(f"{k} = {v}\n")
            else:
                # Use literal strings (single quotes) for TOML
                f.write(f"{k} = '{v}'\n")

    scope_label = "global" if scope == "global" else "local"
    # Format the display value to match how it's written to the file
    if isinstance(final_value, bool):
        display_value = str(final_value).lower()
    elif isinstance(final_value, (int, float)):
        display_value = str(final_value)
    else:
        display_value = f"'{final_value}'"

    print(f"{Fore.GREEN}Set {key} = {display_value} ({scope_label}){Style.RESET_ALL}")
    print(f"Config file: {config_path.absolute()}")


def get_config(key: str | None, scope: str | None) -> None:
    """Get configuration value(s) from the specified scope or all scopes."""
    schema = _get_config_schema()

    if key is not None:
        _check_key_exists(key)

    # 1. Gather all sources
    # Priority order for display: Local > Env > Global
    sources = []

    # Local
    if (scope is None or scope == "local") and LOCAL_CONFIG_FILE.exists():
        try:
            with open(LOCAL_CONFIG_FILE, "rb") as f:
                local_config = tomllib.load(f)
                sources.append(
                    ("Set from: Local Config", LOCAL_CONFIG_FILE, local_config)
                )
        except tomllib.TOMLDecodeError:
            pass

    # Env
    if scope is None or scope == "env":
        env_config = {
            k[len(ENV_APP_PREFIX) :]: v
            for k, v in os.environ.items()
            if k.lower().startswith(ENV_APP_PREFIX.lower())
        }
        if env_config:
            sources.append(("Environment", None, env_config))

    # Global
    if (scope is None or scope == "global") and GLOBAL_CONFIG_FILE.exists():
        try:
            with open(GLOBAL_CONFIG_FILE, "rb") as f:
                global_config = tomllib.load(f)
                sources.append(
                    ("Set from: Global Config", GLOBAL_CONFIG_FILE, global_config)
                )
        except tomllib.TOMLDecodeError:
            pass

    # 2. Display Logic
    table_data = []

    if key:
        # User requested a specific key
        found = False
        description = schema[key]["description"]

        # Check explicit sources
        for source_name, _, config_data in sources:
            if key in config_data:
                found = True
                val = _truncate_text(str(config_data[key]), 60)
                table_data.append(
                    {
                        "Key": key,
                        "Description": description,
                        "Value": val,
                        "Source": source_name,
                    }
                )

        # If not found in any active source, show the system default
        if not found:
            default_val = schema[key]["default"]
            val_str = str(default_val) if default_val is not None else "None"
            table_data.append(
                {
                    "Key": key,
                    "Description": description,
                    "Value": val_str,
                    "Source": "System Default (Not Set)",
                }
            )

        if found:
            print(
                f"{Fore.WHITE}{Style.BRIGHT}Configuration for key={key} displayed in order of priority:{Style.RESET_ALL}"
            )

        display_config(table_data)

    else:
        # List all keys
        for k in sorted(schema.keys()):
            description = schema[k]["description"]

            # Find the active value (first match in priority: Local -> Env -> Global)
            active_val = None
            active_source = None

            for source_name, _, config_data in sources:
                if k in config_data:
                    active_val = config_data[k]
                    active_source = source_name
                    break

            if active_val is not None:
                table_data.append(
                    {
                        "Key": k,
                        "Description": description,
                        "Value": str(active_val),
                        "Source": active_source,
                    }
                )
            else:
                # Fallback to default
                default_val = schema[k]["default"]
                val_str = str(default_val) if default_val is not None else "None"
                table_data.append(
                    {
                        "Key": k,
                        "Description": description,
                        "Value": val_str,
                        "Source": "Default",
                    }
                )

        display_config(table_data)


def delete_config(key: str | None, scope: str) -> None:
    """Delete configuration value(s) from the specified scope."""
    if scope == "env":
        if key is not None:
            env_var = f"{ENV_APP_PREFIX}{key.upper()}"
            print(
                f"{Fore.YELLOW}Info:{Style.RESET_ALL} Cannot delete environment variables through cst.\n"
                f"Please delete them through your terminal/OS:\n"
                f"  Windows (PowerShell): Remove-Item Env:\\{env_var}\n"
                f"  Windows (CMD): set {env_var}=\n"
                f"  Linux/macOS: unset {env_var}"
            )
        else:
            print(
                f"{Fore.YELLOW}Info:{Style.RESET_ALL} Cannot delete environment variables through cst.\n"
                f"Please delete them through your terminal/OS:\n"
                f"  Windows (PowerShell): Remove-Item Env:\\{ENV_APP_PREFIX}*\n"
                f"  Windows (CMD): set {ENV_APP_PREFIX}*=\n"
                f"  Linux/macOS: unset {ENV_APP_PREFIX}*"
            )
        return

    config_path = GLOBAL_CONFIG_FILE if scope == "global" else LOCAL_CONFIG_FILE

    if not config_path.exists():
        print(
            f"{Fore.YELLOW}Info:{Style.RESET_ALL} No {scope} config file found at {config_path}"
        )
        return

    # Load existing config
    try:
        with open(config_path, "rb") as f:
            config_data = tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        print(f"{Fore.RED}Error:{Style.RESET_ALL} Failed to parse config: {e}")
        raise typer.Exit(1)

    if not config_data:
        print(
            f"{Fore.YELLOW}Info:{Style.RESET_ALL} {scope.capitalize()} config is already empty"
        )
        return

    if key is not None:
        # Delete specific key
        if key not in config_data:
            print(
                f"{Fore.YELLOW}Info:{Style.RESET_ALL} Key '{key}' not found in {scope} config"
            )
            return

        # Confirmation prompt for specific key
        confirm = typer.confirm(
            f"Are you sure you want to delete '{key}' from {scope} config?"
        )
        if not confirm:
            print("Delete cancelled.")
            return

        del config_data[key]
        print(f"{Fore.GREEN}Deleted {key} from {scope} config{Style.RESET_ALL}")
    else:
        # Delete all keys
        keys_list = ", ".join(config_data.keys())
        confirm = typer.confirm(
            f"Are you sure you want to delete ALL config from {scope} scope?\n"
            f"Keys to be deleted: {keys_list}"
        )
        if not confirm:
            print("Delete cancelled.")
            return

        config_data.clear()
        print(f"{Fore.GREEN}Deleted all config from {scope} scope{Style.RESET_ALL}")

    # Write back to file
    if config_data:
        with open(config_path, "w") as f:
            for k, v in config_data.items():
                if isinstance(v, bool):
                    f.write(f"{k} = {str(v).lower()}\n")
                elif isinstance(v, (int, float)):
                    f.write(f"{k} = {v}\n")
                else:
                    f.write(f"{k} = '{v}'\n")
    else:
        # If empty, remove the file
        config_path.unlink()
        print(f"Removed empty config file: {config_path}")


def deleteall_config(key: str | None) -> None:
    """Delete configuration value(s) from both global and local scopes."""
    if key is not None:
        # Confirmation prompt for specific key across all scopes
        confirm = typer.confirm(
            f"Are you sure you want to delete '{key}' from BOTH global and local config?"
        )
        if not confirm:
            print("Delete cancelled.")
            return

        print(f"\n{Fore.CYAN}Deleting from local scope:{Style.RESET_ALL}")
        # Delete from local without additional confirmation (already confirmed)
        if LOCAL_CONFIG_FILE.exists():
            try:
                with open(LOCAL_CONFIG_FILE, "rb") as f:
                    config_data = tomllib.load(f)
                if key in config_data:
                    del config_data[key]
                    if config_data:
                        with open(LOCAL_CONFIG_FILE, "w") as f:
                            for k, v in config_data.items():
                                if isinstance(v, bool):
                                    f.write(f"{k} = {str(v).lower()}\n")
                                elif isinstance(v, (int, float)):
                                    f.write(f"{k} = {v}\n")
                                else:
                                    f.write(f"{k} = '{v}'\n")
                    else:
                        LOCAL_CONFIG_FILE.unlink()
                    print(
                        f"{Fore.GREEN}Deleted {key} from local config{Style.RESET_ALL}"
                    )
                else:
                    print(
                        f"{Fore.YELLOW}Info:{Style.RESET_ALL} Key '{key}' not found in local config"
                    )
            except tomllib.TOMLDecodeError as e:
                print(
                    f"{Fore.RED}Error:{Style.RESET_ALL} Failed to parse local config: {e}"
                )
        else:
            print(f"{Fore.YELLOW}Info:{Style.RESET_ALL} No local config file found")

        print(f"\n{Fore.CYAN}Deleting from global scope:{Style.RESET_ALL}")
        if GLOBAL_CONFIG_FILE.exists():
            try:
                with open(GLOBAL_CONFIG_FILE, "rb") as f:
                    config_data = tomllib.load(f)
                if key in config_data:
                    del config_data[key]
                    if config_data:
                        with open(GLOBAL_CONFIG_FILE, "w") as f:
                            for k, v in config_data.items():
                                if isinstance(v, bool):
                                    f.write(f"{k} = {str(v).lower()}\n")
                                elif isinstance(v, (int, float)):
                                    f.write(f"{k} = {v}\n")
                                else:
                                    f.write(f"{k} = '{v}'\n")
                    else:
                        GLOBAL_CONFIG_FILE.unlink()
                    print(
                        f"{Fore.GREEN}Deleted {key} from global config{Style.RESET_ALL}"
                    )
                else:
                    print(
                        f"{Fore.YELLOW}Info:{Style.RESET_ALL} Key '{key}' not found in global config"
                    )
            except tomllib.TOMLDecodeError as e:
                print(
                    f"{Fore.RED}Error:{Style.RESET_ALL} Failed to parse global config: {e}"
                )
        else:
            print(f"{Fore.YELLOW}Info:{Style.RESET_ALL} No global config file found")
    else:
        # Delete all from both scopes
        confirm = typer.confirm(
            "Are you sure you want to delete ALL config from BOTH global and local scopes?"
        )
        if not confirm:
            print("Delete cancelled.")
            return

        print(f"\n{Fore.CYAN}Deleting from local scope:{Style.RESET_ALL}")
        if LOCAL_CONFIG_FILE.exists():
            try:
                with open(LOCAL_CONFIG_FILE, "rb") as f:
                    config_data = tomllib.load(f)
                if config_data:
                    LOCAL_CONFIG_FILE.unlink()
                    print(
                        f"{Fore.GREEN}Deleted all config from local scope{Style.RESET_ALL}"
                    )
                else:
                    print(
                        f"{Fore.YELLOW}Info:{Style.RESET_ALL} Local config is already empty"
                    )
            except tomllib.TOMLDecodeError as e:
                print(
                    f"{Fore.RED}Error:{Style.RESET_ALL} Failed to parse local config: {e}"
                )
        else:
            print(f"{Fore.YELLOW}Info:{Style.RESET_ALL} No local config file found")

        print(f"\n{Fore.CYAN}Deleting from global scope:{Style.RESET_ALL}")
        if GLOBAL_CONFIG_FILE.exists():
            try:
                with open(GLOBAL_CONFIG_FILE, "rb") as f:
                    config_data = tomllib.load(f)
                if config_data:
                    GLOBAL_CONFIG_FILE.unlink()
                    print(
                        f"{Fore.GREEN}Deleted all config from global scope{Style.RESET_ALL}"
                    )
                else:
                    print(
                        f"{Fore.YELLOW}Info:{Style.RESET_ALL} Global config is already empty"
                    )
            except tomllib.TOMLDecodeError as e:
                print(
                    f"{Fore.RED}Error:{Style.RESET_ALL} Failed to parse global config: {e}"
                )
        else:
            print(f"{Fore.YELLOW}Info:{Style.RESET_ALL} No global config file found")


def describe_callback(ctx: typer.Context, param, value: bool):
    if not value or ctx.resilient_parsing:
        return

    print_describe_options()
    raise typer.Exit()


def main(
    ctx: typer.Context,
    describe: bool = typer.Option(
        False,
        "--describe",
        callback=describe_callback,
        is_eager=True,
        help="Describe available configuration options and exit.",
    ),
    key: str | None = typer.Argument(None, help="Configuration key to get or set."),
    value: str | None = typer.Argument(
        None, help="Value to set (omit to get current value)."
    ),
    scope: Literal["local", "global", "env"] = typer.Option(
        None,
        "--scope",
        help="Select which scope to modify. Defaults to local for setting/deleting, all for getting.",
    ),
    delete: bool = typer.Option(
        False,
        "--delete",
        help="Delete configuration. Deletes all config in scope if no key specified, or specific key if provided.",
    ),
    deleteall: bool = typer.Option(
        False,
        "--deleteall",
        help="Delete configuration from both global and local scopes.",
    ),
) -> None:
    """
    Manage global and local codestory configurations.

    Priority order: program arguments > custom config > local config > environment variables > global config

    Examples:
        # Get a configuration value
        cst config model

        # Set a local configuration value
        cst config model "gemini/gemini-2.0-flash"

        # Set a global configuration value
        cst config model "openai/gpt-4" --scope global

        # Show all configuration
        cst config

        # Delete a specific key from local config
        cst config model --delete

        # Delete all config from global scope
        cst config --delete --scope global

        # Delete a key from both global and local scopes
        cst config model --deleteall

        # Delete all config from both scopes
        cst config --deleteall
    """
    with handle_codestory_exception():
        # Check for conflicting operations
        if delete and deleteall:
            raise ConfigurationError(
                f"{Fore.RED}Error:{Style.RESET_ALL} Cannot use --delete and --deleteall together"
            )

        if deleteall:
            # DELETEALL operation
            if value is not None:
                raise ConfigurationError(
                    f"{Fore.RED}Error:{Style.RESET_ALL} Cannot specify a value when deleting"
                )
            if scope is not None:
                print(
                    f"{Fore.YELLOW}Warning:{Style.RESET_ALL} --scope is ignored when using --deleteall"
                )
            deleteall_config(key)
        elif delete:
            # DELETE operation
            if value is not None:
                raise ConfigurationError(
                    f"{Fore.RED}Error:{Style.RESET_ALL} Cannot specify a value when deleting"
                )
            # Default to local if deleting and no scope provided
            target_scope = scope if scope is not None else "local"
            delete_config(key, target_scope)
        elif value is not None:
            # SET operation
            if key is None:
                raise ConfigurationError(
                    f"{Fore.RED}Error:{Style.RESET_ALL} Key is required when setting a value"
                )

            # Default to local if setting and no scope provided
            target_scope = scope if scope is not None else "local"
            set_config(key, value, target_scope)
        else:
            # GET operation
            # If scope is None here, get_config handles searching all scopes
            get_config(key, scope)

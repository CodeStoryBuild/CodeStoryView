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

import subprocess

import typer
from colorama import Fore, Style

from codestory.commands.config import set_config
from codestory.constants import LOCAL_PROVIDERS, ONBOARDING_FLAG, get_cloud_providers

CODESTORY_ASCII = r"""
  ___  __  ____  ____    ____  ____  __  ____  _  _ 
 / __)/  \(    \(  __)  / ___)(_  _)/  \(  _ \( \/ )
( (__(  O )) D ( ) _)   \___ \  )( (  O ))   / )  / 
 \___)\__/(____/(____)  (____/ (__) \__/(__\_)(__/  
"""


def check_ollama_installed() -> bool:
    """Check if ollama is installed and accessible."""
    try:
        result = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def get_ollama_models() -> list[str]:
    """Get list of available ollama models."""
    try:
        result = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")[1:]  # Skip header
            models = [line.split()[0] for line in lines if line.strip()]
            return models
        return []
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []


def run_model_setup(scope: str):
    print(f"\n{Fore.CYAN}{Style.BRIGHT}=== Model Setup ==={Style.RESET_ALL}")

    # Inform about supported providers
    local = sorted(list(LOCAL_PROVIDERS))
    cloud = sorted(list(get_cloud_providers()))

    print(f"{Fore.WHITE}Supported providers:{Style.RESET_ALL}")

    def _print_grouped(title: str, items: list[str], color: str):
        if not items:
            return
        print(f"  {color}{title}:{Style.RESET_ALL}")
        # print up to 3 providers per line
        for i in range(0, len(items), 3):
            chunk = items[i : i + 3]
            print(f"    - {', '.join(chunk)}")

    _print_grouped("Local providers", local, Fore.GREEN)
    _print_grouped("Cloud providers", cloud, Fore.CYAN)

    # Show expected format
    print()
    print(f"{Fore.WHITE}Model format: provider:model{Style.RESET_ALL}")
    print(
        f"{Fore.WHITE}Examples: ollama:qwen2.5-coder:1.5b, openai:gpt-4o{Style.RESET_ALL}\n"
    )

    # Prompt for model
    model_string = typer.prompt("Enter model (format: provider:model)")
    while ":" not in model_string:
        print(f"{Fore.RED}Invalid format! Must be 'provider:model'{Style.RESET_ALL}")
        model_string = typer.prompt("Enter model (format: provider:model)")

    set_config(key="model", value=model_string, scope=scope)

    provider = model_string.split(":")[0].lower()
    need_api_key = provider in get_cloud_providers()

    if need_api_key:
        # If provider is not local, ask for an optional API key and explain env var options
        print()
        print(
            f"{Fore.WHITE}If this provider requires an API key you may enter it now (optional).{Style.RESET_ALL}"
        )
        print(
            f"{Fore.WHITE}You can also set the API key via environment variables: {Fore.YELLOW}CODESTORY_API_KEY{Fore.WHITE} or the provider-specific standard var (e.g. {Fore.YELLOW}{provider.upper()}_API_KEY{Fore.WHITE}).{Style.RESET_ALL}"
        )
        api_key = typer.prompt(
            f"Enter API key for {provider} (leave blank to use environment variables)",
            hide_input=True,
            default="",
        ).strip()

        if api_key:
            set_config(key="api_key", value=api_key, scope=scope)
            need_set_api_key = False
        else:
            print(
                f"{Fore.YELLOW}No API key provided. Please make sure to set as an environment variable.{Style.RESET_ALL}"
            )
            need_set_api_key = True
    else:
        need_set_api_key = False

    print(f"\n{Fore.GREEN}✓ Model configured: {model_string}{Style.RESET_ALL}")
    if need_set_api_key:
        print(
            f"{Fore.YELLOW}Codestory will exit for you to set your api key as an environment variable{Style.RESET_ALL}"
        )
        print(
            f"{Fore.WHITE}You can set the API key via environment variables: {Fore.YELLOW}CODESTORY_API_KEY{Fore.WHITE} or the provider-specific standard var (e.g. {Fore.YELLOW}{provider.upper()}_API_KEY{Fore.WHITE}).{Style.RESET_ALL}"
        )
        print(
            f"{Fore.WHITE}After setting the environment variable, please rerun the codestory command.{Style.RESET_ALL}"
        )

    return need_set_api_key


def run_onboarding():
    print(f"{Fore.CYAN}{Style.BRIGHT}{CODESTORY_ASCII}{Style.RESET_ALL}")
    print(f"{Fore.WHITE}{Style.BRIGHT}Welcome to CodeStory!{Style.RESET_ALL}")
    print(
        f"{Fore.WHITE}This is the first time you're running codestory. Let's get you set up!{Style.RESET_ALL}"
    )
    print(
        f"{Fore.WHITE}You can change any of these settings later using 'cst config'.{Style.RESET_ALL}\n"
    )

    print(f"{Fore.WHITE}{Style.BRIGHT}Press Enter to continue...{Style.RESET_ALL}")
    input()

    # Ask if global or local config
    global_ = typer.confirm(
        "\nDo you want to set this as the global configuration (applies to all repos)?",
        default=True,
    )
    scope = "global" if global_ else "local"

    # Configure embedding grouper
    need_api_key = run_model_setup(scope)

    # Final message
    print(f"\n{Fore.GREEN}{Style.BRIGHT}✓ Configuration completed!{Style.RESET_ALL}")
    print(f"{Fore.WHITE}There are many other configuration options available.")
    print(
        f"You can view and change them at any time using: {Fore.CYAN}cst config{Style.RESET_ALL}\n"
    )

    return need_api_key


def check_run_onboarding() -> None:
    # check a file in user config dir
    if not ONBOARDING_FLAG.exists():
        continue_ = run_onboarding()
        ONBOARDING_FLAG.touch()
        if not continue_:
            raise typer.Exit(0)
        else:
            print("Now continuing with command...\n")
    else:
        return

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
import sys
from pathlib import Path

import typer
from colorama import init
from loguru import logger

from codestory.commands import clean, commit, config, fix
from codestory.constants import APP_NAME
from codestory.context import GlobalConfig, GlobalContext
from codestory.core.config.config_loader import ConfigLoader
from codestory.core.exceptions import handle_codestory_exception
from codestory.core.logging.logging import setup_logger
from codestory.core.validation import validate_git_repository
from codestory.onboarding import check_run_onboarding
from codestory.runtimeutil import (
    ensure_utf8_output,
    get_log_dir_callback,
    get_supported_languages_callback,
    setup_signal_handlers,
    version_callback,
)

# Initialize colorama (colored output in terminal)
init(autoreset=True)

# main cli app
app = typer.Typer(
    help=f"{APP_NAME}: Give your project a good story worth reading",
    pretty_exceptions_show_locals=False,
    pretty_exceptions_enable=False,
    add_completion=False,  # TODO check if we want shell completion
)

# Main cli commands
app.command(name="commit")(commit.main)
app.command(name="fix")(fix.main)
app.command(name="clean")(clean.main)
app.command(name="config")(config.main)

# which commands do not require a global context
no_context_commands = {"config"}
# if you have a broken config, the config command should stil allow you to fix it (or check)
config_override_command = "config"


def load_global_config(custom_config_path: str, **input_args):
    # input args are the "runtime overrides" for configs
    config_args = {}

    for key, item in input_args.items():
        if item is not None:
            config_args[key] = item

    return ConfigLoader.get_full_config(
        GlobalConfig,
        config_args,
        custom_config_path=Path(custom_config_path)
        if custom_config_path is not None
        else None,
    )


def create_global_callback():
    """
    Dynamically creates the main callback function with GlobalConfig parameters.
    This allows the CLI arguments to be automatically synced with GlobalConfig fields.
    """
    # Get dynamic parameters from GlobalConfig
    cli_params = GlobalConfig.get_cli_params()

    # Define the callback function with dynamic signature
    def callback(
        ctx: typer.Context,
        version: bool = typer.Option(
            False,
            "--version",
            "-V",
            callback=version_callback,
            help="Show version and exit",
        ),
        log_path: bool = typer.Option(
            False,
            "--log-dir",
            "-LD",
            callback=get_log_dir_callback,
            help="Show log path (where logs for codestory live) and exit",
        ),
        supported_languages: bool = typer.Option(
            False,
            "--supported-languages",
            "-SL",
            callback=get_supported_languages_callback,
            help="Show languages that support semantic analysis and grouping, then exit",
        ),
        repo_path: str = typer.Option(
            ".",
            "--repo",
            help="Path to the git repository to operate on.",
        ),
        custom_config: str | None = typer.Option(
            None,
            "--custom-config",
            help="Path to a custom config file",
        ),
        **kwargs,  # Dynamic GlobalConfig params injected here
    ) -> None:
        """
        Global setup callback. Initialize global context/config used by commands
        """
        with handle_codestory_exception(exit_on_fail=True):
            # conditions to not create global context
            if ctx.invoked_subcommand is None:
                print(ctx.get_help())
                raise typer.Exit()

            # skip --help in subcommands
            if any(arg in ctx.help_option_names for arg in sys.argv):
                return

            if ctx.invoked_subcommand == config_override_command:
                # dont try to load config
                return

            if ctx.invoked_subcommand in no_context_commands:
                return

            config, used_config_sources, used_default = load_global_config(
                custom_config,
                **kwargs,  # Pass all dynamic config args
            )

            # if we run a command that requires a global context, check that the user has learned the onboarding process
            if not used_config_sources and used_default:
                # we only used defaults (so no user set config)
                check_run_onboarding()

                # reload any possible set configs through onboarding
                config, used_config_sources, used_default = load_global_config(
                    custom_config,
                    **kwargs,
                )

            # Set custom language config override if provided
            if config.custom_language_config is not None:
                from codestory.core.semantic_grouper.query_manager import QueryManager

                QueryManager.set_override(config.custom_language_config)

            setup_logger(
                ctx.invoked_subcommand, debug=config.verbose, silent=config.silent
            )

            logger.debug(f"Used {used_config_sources} to build global context.")
            global_context = GlobalContext.from_global_config(config, Path(repo_path))
            validate_git_repository(
                global_context.git_interface
            )  # fail immediately if we arent in a valid git repo as we expect one

            # Set up signal handlers with context for proper cleanup
            setup_signal_handlers(global_context)

            ctx.obj = global_context

    # Dynamically add GlobalConfig parameters to function signature
    # This is necessary for typer to recognize them
    import inspect

    sig = inspect.signature(callback)
    params = list(sig.parameters.values())

    # Remove **kwargs and add actual dynamic parameters
    params = [p for p in params if p.name != "kwargs"]
    for param_name, (param_type, param_default) in cli_params.items():
        params.append(
            inspect.Parameter(
                param_name,
                inspect.Parameter.KEYWORD_ONLY,
                default=param_default,
                annotation=param_type,
            )
        )

    callback.__signature__ = sig.replace(parameters=params)
    return callback


# Register the dynamically created callback
main = create_global_callback()
app.callback(invoke_without_command=True)(main)


def load_env(path=".env"):
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                key, _, value = line.partition("=")
            os.environ[key] = value
    except FileNotFoundError:
        pass


def run_app():
    """Run the application with global exception handling."""
    # force stdout to be utf8
    ensure_utf8_output()
    # load any .env files (config values possibly set through env)
    load_env()
    # launch cli
    app(prog_name="cst")


if __name__ == "__main__":
    run_app()

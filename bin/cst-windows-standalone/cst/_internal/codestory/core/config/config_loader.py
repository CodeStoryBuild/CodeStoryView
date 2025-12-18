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
from typing import Any, Literal, Union, get_args, get_origin

import tomllib

from codestory.constants import ENV_APP_PREFIX, GLOBAL_CONFIG_FILE, LOCAL_CONFIG_FILE
from codestory.core.exceptions import ConfigurationError


class ConfigLoader:
    """Handles loading and merging configuration from multiple sources into a unified model."""

    @staticmethod
    def get_full_config(
        config_model: type[Any],
        input_args: dict,
        local_config_path: Path = LOCAL_CONFIG_FILE,
        env_app_prefix: str = ENV_APP_PREFIX,
        global_config_path: Path = GLOBAL_CONFIG_FILE,
        custom_config_path: Path | None = None,
    ):
        """Merges configuration from multiple sources with priority: input args, custom config, local config, environment variables, global config."""

        # priority: input_arg,s optional custom config, local_config_path, env vars, global_config_path,
        source_names = [
            "Input Args",
            "Local Config",
            "Environment Variables",
            "Global Config",
        ]
        sources = [
            input_args,
            ConfigLoader.load_toml(local_config_path),
            ConfigLoader.load_env(env_app_prefix),
            ConfigLoader.load_toml(global_config_path),
        ]

        if custom_config_path is not None:
            custom_config = ConfigLoader.load_toml(custom_config_path)
            # custom config is priority #2
            sources.insert(1, custom_config)
            source_names.insert(1, "Custom Config")

        built_model, used_indexes, used_defaults = ConfigLoader.build(
            config_model, sources
        )

        source_names = [source_names[i] for i in used_indexes]

        return built_model, source_names, used_defaults

    @staticmethod
    def load_toml(path: Path):
        """Loads configuration data from a TOML file, returning an empty dict if the file doesn't exist or is invalid."""

        if not path.exists():
            return {}

        data = {}
        try:
            with open(path, "rb") as f:
                data = tomllib.load(f)
        except tomllib.TOMLDecodeError:
            pass

        return data

    @staticmethod
    def load_env(app_prefix: str):
        """Extracts configuration values from environment variables prefixed with the app prefix, converting keys to lowercase."""

        data = {}
        for k, v in os.environ.items():
            if k.lower().startswith(app_prefix.lower()):
                key_clean = k[len(app_prefix) :].lower()
                data[key_clean] = v
        return data

    @staticmethod
    def build(
        config_model: type[Any],
        sources: list[dict],
    ):
        """Builds the configuration model by merging data from sources in priority order, filling in defaults where needed."""

        remaining_keys = {field.name for field in fields(config_model)}

        final_data = {}
        used_indices = set()

        # 2. Iterate in order of highest-lowest preference
        for i, d in enumerate(sources):
            # Optimization: Stop if we have everything
            if not remaining_keys:
                break

            # Find which useful keys this dict provides
            # We use set intersection, which is very fast
            contributions = d.keys() & remaining_keys

            if contributions:
                used_indices.add(i)

                # Add these keys to our final data
                for key in contributions:
                    final_data[key] = d[key]

                # Remove found keys so we don't look for them in earlier dicts
                remaining_keys -= contributions

        coerced_data = {}
        # If the model provides a __constraints__ mapping, use it
        constraints_map = getattr(config_model, "__constraints__", {})

        for field in fields(config_model):
            name = field.name
            if name in final_data:
                value = final_data[name]
                coerced_value = ConfigLoader.coerce_value(
                    value, field.type, field_name=name, constraints_map=constraints_map
                )
                coerced_data[name] = coerced_value

        model = config_model(**coerced_data)

        # built model, what sources we used, and if we used any defaults
        return model, used_indices, bool(remaining_keys)

    @staticmethod
    def coerce_value(
        value: Any,
        typ: Any,
        field_name: str | None = None,
        constraints_map: dict | None = None,
    ) -> Any:
        """Coerce a value to the given type with manual validation.

        If a `constraints_map` is provided and contains a constraint for
        `field_name`, use that constraint's `coerce` method.
        """

        # If we have a constraint for this field, prefer it
        if constraints_map and field_name and field_name in constraints_map:
            constraint = constraints_map[field_name]
            return constraint.coerce(value)

        origin = get_origin(typ)
        args = get_args(typ)

        if origin is Union:
            # Handle Optional types like str | None
            non_none_types = [arg for arg in args if arg is not type(None)]
            if value is None:
                if type(None) in args:
                    return None
                else:
                    raise ConfigurationError(f"None not allowed for type {typ}")
            for subtyp in non_none_types:
                try:
                    return ConfigLoader.coerce_value(value, subtyp)
                except ConfigurationError:
                    continue
            raise ConfigurationError(f"Cannot coerce {value} to {typ}")
        elif origin is Literal:
            if value in args:
                return value
            raise ConfigurationError(f"{value} not in allowed values {args} for {typ}")
        elif typ is str:
            return str(value)
        elif typ is int:
            try:
                return int(value)
            except Exception as e:
                raise ConfigurationError() from e
        elif typ is float:
            try:
                return float(value)
            except Exception as e:
                raise ConfigurationError() from e
        elif typ is bool:
            if isinstance(value, str):
                return value.lower() in ("true", "1", "yes", "on")
            return bool(value)
        else:
            # For other types, assume it's already correct or str
            return value

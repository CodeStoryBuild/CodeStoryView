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

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from codestory.core.exceptions import ConfigurationError


class TypeConstraint(ABC):
    """Abstract base for type constraints.

    Subclasses should implement `coerce` which attempts to coerce/validate
    a provided value. If coercion/validation fails, raise ConfigurationError.
    """

    @abstractmethod
    def coerce(self, value: Any) -> Any:
        """Try to coerce and validate `value`. Return coerced value or raise."""


@dataclass
class RangeTypeConstraint(TypeConstraint):
    min_value: float | int | None = None
    max_value: float | int | None = None

    def coerce(self, value: Any) -> Any:
        try:
            if isinstance(value, str):
                # allow numeric strings
                v = float(value) if "." in value else int(value)
            else:
                v = value

            v = float(v)
        except Exception:
            raise ConfigurationError(f"Value {value!r} is not a number")

        if self.min_value is not None and v < self.min_value:
            raise ConfigurationError(f"{v} < min {self.min_value}")
        if self.max_value is not None and v > self.max_value:
            raise ConfigurationError(f"{v} > max {self.max_value}")

        # If original inputs were integer-like, return float or int appropriately
        if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
            try:
                return int(v)
            except Exception:
                return v
        return v

    def __str__(self) -> str:
        parts = []
        if self.min_value is not None:
            parts.append(f"min={self.min_value}")
        if self.max_value is not None:
            parts.append(f"max={self.max_value}")
        return f"range({', '.join(parts)})"


@dataclass
class LiteralTypeConstraint(TypeConstraint):
    allowed: Iterable[Any] = None

    def coerce(self, value: Any) -> Any:
        if value in self.allowed:
            return value
        # allow case-insensitive match for strings
        if isinstance(value, str):
            for a in self.allowed:
                if isinstance(a, str) and a.lower() == value.lower():
                    return a
        raise ConfigurationError(
            f"{value!r} not one of allowed values: {list(self.allowed)}"
        )

    def __str__(self) -> str:
        return f"literal({list(self.allowed)})"


class BoolConstraint(TypeConstraint):
    def coerce(self, value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            if value.lower() in ("true", "1", "yes", "on"):
                return True
            if value.lower() in ("false", "0", "no", "off"):
                return False
        if isinstance(value, (int, float)):
            return bool(value)
        raise ConfigurationError(f"Cannot coerce {value!r} to bool")

    def __str__(self) -> str:
        return "bool"


class IntConstraint(TypeConstraint):
    def coerce(self, value: Any) -> int:
        try:
            return int(value)
        except Exception:
            raise ConfigurationError(f"Cannot coerce {value!r} to int")

    def __str__(self) -> str:
        return "int"


class FloatConstraint(TypeConstraint):
    def coerce(self, value: Any) -> float:
        try:
            return float(value)
        except Exception:
            raise ConfigurationError(f"Cannot coerce {value!r} to float")

    def __str__(self) -> str:
        return "float"


class StringConstraint(TypeConstraint):
    def coerce(self, value: Any) -> str:
        if value is None:
            return ""
        return str(value)

    def __str__(self) -> str:
        return "str"

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

import asyncio
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Literal

from loguru import logger

from codestory.constants import LOCAL_PROVIDERS
from codestory.core.exceptions import LLMInitError


@dataclass
class ModelConfig:
    """
    Configuration for the LLM Adapter.
    model_string format: "provider:model_name" (e.g. "openai:gpt-4o")
    """

    model_string: str
    api_key: str | None = None
    api_base: str | None = None
    temperature: float = 0.7
    max_tokens: int | None = None


class CodeStoryAdapter:
    """
    A unified interface for calling LLM APIs using aisuite.
    Designed for CLI utility usage with persistent event loop management.
    """

    def __init__(self, config: ModelConfig):
        import aisuite

        self.config = config
        self.model_string = config.model_string
        self._loop = None  # Persistent loop for CLI context

        # Parse provider from model string (format: provider:model)
        try:
            self.provider = self.model_string.split(":")[0]
        except IndexError:
            raise LLMInitError(
                f"Invalid model string format: '{self.model_string}'. Expected 'provider:model'"
            )

        # Configure provider-specific settings
        provider_config = {}
        if config.api_key:
            provider_config["api_key"] = config.api_key
        if config.api_base:
            provider_config["base_url"] = config.api_base

        # Create aisuite client
        # passing {provider: config} allows specific config per provider
        client_config = {self.provider: provider_config} if provider_config else {}
        try:
            if client_config:
                self.client = aisuite.Client(client_config)
            else:
                self.client = aisuite.Client()
        except Exception as e:
            raise LLMInitError(f"Failed to initialize aisuite client: {e}") from e

    def close(self):
        """Cleanup method to properly close the persistent event loop."""
        if self._loop is not None and not self._loop.is_closed():
            try:
                # Cancel all running tasks immediately
                pending = asyncio.all_tasks(self._loop)
                for task in pending:
                    task.cancel()

                # Force stop the loop without waiting
                self._loop.stop()
            except Exception as e:
                logger.debug(f"Error closing event loop: {e}")
            finally:
                self._loop = None

    def is_local(self) -> bool:
        return self.provider in LOCAL_PROVIDERS

    # --- Helpers ---

    def _prepare_request(self, messages: str | list[dict[str, str]]) -> dict[str, Any]:
        """Prepares the arguments for the aisuite API call."""
        if isinstance(messages, str):
            messages = [{"role": "user", "content": messages}]

        kwargs = {
            "model": self.model_string,
            "messages": messages,
        }
        if self.config.temperature is not None:
            kwargs["temperature"] = self.config.temperature
        if self.config.max_tokens is not None:
            kwargs["max_tokens"] = self.config.max_tokens

        if self.provider == "ollama":
            kwargs["keep_alive"] = -1

        return kwargs

    @contextmanager
    def _handle_llm_error(self, operation_type: str):
        """Context manager to unify error handling across sync and async calls."""
        try:
            yield
        except LLMInitError:
            raise
        except asyncio.CancelledError:
            raise LLMInitError(f"{operation_type} was cancelled.")
        except Exception as e:
            error_str = str(e).lower()
            if any(x in error_str for x in ["auth", "unauthorized", "api key"]):
                raise LLMInitError(
                    f"Authentication failed for {self.provider}. "
                    f"Please check your API key is set correctly. "
                    f"Error: {e}"
                ) from e

            elif any(x in error_str for x in ["not found", "model"]):
                raise LLMInitError(
                    f"Model {self.model_string} not found. "
                    f"Please check the model name is correct. "
                    f"Error: {e}"
                ) from e

            elif "rate limit" in error_str:
                raise LLMInitError(
                    f"Rate limit exceeded for {self.model_string}. "
                    f"Please try again later. "
                    f"Error: {e}"
                ) from e

            elif any(x in error_str for x in ["connection", "network"]):
                raise LLMInitError(
                    f"Failed to connect to API for {self.model_string}. "
                    f"Please check your internet connection. "
                    f"Error: {e}"
                ) from e

            else:
                raise LLMInitError(
                    f"LLM request failed for {self.model_string}: {e}"
                ) from e

    # --- Unified Invocation Methods ---

    def invoke(
        self,
        messages: str | list[dict[str, str]],
        update_callback: Callable[[Literal["sent", "received"]], None] | None = None,
    ) -> str:
        """Unified sync invoke method. Returns the content string."""
        logger.debug(f"Invoking {self.model_string} (sync)")
        kwargs = self._prepare_request(messages)

        with self._handle_llm_error("Sync invocation"):
            if update_callback:
                update_callback("sent")
            response = self.client.chat.completions.create(**kwargs)
            if update_callback:
                update_callback("received")
            return response.choices[0].message.content

    async def async_invoke(
        self,
        messages: str | list[dict[str, str]],
        update_callback: Callable[[Literal["sent", "received"]], None] | None = None,
    ) -> str:
        """Unified async invoke method. Returns the content string."""
        logger.debug(f"Invoking {self.model_string} (async)")
        kwargs = self._prepare_request(messages)

        with self._handle_llm_error("Async invocation"):
            # Run in executor since aisuite is often blocking/sync
            loop = asyncio.get_running_loop()
            if update_callback:
                update_callback("sent")
            response = await loop.run_in_executor(
                None, lambda: self.client.chat.completions.create(**kwargs)
            )
            if update_callback:
                update_callback("received")
            return response.choices[0].message.content

    async def async_invoke_batch(
        self,
        batch: list[str | list[dict[str, str]]],
        max_concurrent: int = 10,
        sleep_between_tasks: float = -1,
        update_callback: Callable[[Literal["sent", "received"]], None] | None = None,
    ) -> list[str]:
        """
        Run a batch of invocations in parallel.
        FAILS FAST: If one task raises an exception, the exception is raised immediately
        and all other pending tasks are cancelled.
        """
        if self.model_string.startswith("ollama:") and max_concurrent > 3:
            logger.debug("Ollama detected: limiting max_concurrent to 3")
            max_concurrent = 3

        semaphore = asyncio.Semaphore(max_concurrent)

        async def sem_task(item):
            async with semaphore:
                if sleep_between_tasks > 0:
                    await asyncio.sleep(sleep_between_tasks)
                return await self.async_invoke(item, update_callback=update_callback)

        # Create tasks. We keep the reference to preserve order of results.
        tasks = [asyncio.create_task(sem_task(item)) for item in batch]

        # Wait for the first exception (FAIL FAST)
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)

        # Check for any exception in the completed tasks
        failed_task = next((t for t in done if t.exception() is not None), None)

        if failed_task:
            first_exception = failed_task.exception()

            # Cancel all pending tasks immediately
            for task in pending:
                task.cancel()

            # Await the cancellation of pending tasks to ensure clean loop state
            # return_exceptions=True ensures we don't raise CancelledError here
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

            # Raise ONLY the first exception encountered
            raise first_exception

        # If no exceptions, strict return of results in original order
        # (done set is unordered, so we iterate over original tasks list)
        return [task.result() for task in tasks]

    def invoke_batch(
        self,
        batch: list[str | list[dict[str, str]]],
        max_concurrent: int = 10,
        update_callback: Callable[[Literal["sent", "received"]], None] | None = None,
    ) -> list[str]:
        """
        Synchronous wrapper for batched calls reusing a persistent loop.
        Ideal for CLI usage to prevent overhead of creating/destroying loops per call.
        """
        if self._loop is None or self._loop.is_closed():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)

        # Use the persistent loop to run the batch
        return self._loop.run_until_complete(
            self.async_invoke_batch(
                batch, max_concurrent, update_callback=update_callback
            )
        )

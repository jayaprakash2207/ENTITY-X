"""
backend.utils.scheduler – background task scheduler (stub).

Intended to house periodic cleanup, cache-expiry, model-refresh, and
health-ping tasks.  Integrate APScheduler or a plain asyncio-based loop
here as the application grows.
"""
from __future__ import annotations

import asyncio


class BackgroundScheduler:
    """
    Simple asyncio-based background task runner.

    Usage::

        scheduler = BackgroundScheduler()
        scheduler.add_task("cleanup", cleanup_coro, interval_seconds=300)
        await scheduler.start()
        # … later …
        await scheduler.stop()
    """

    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._running = False

    def add_task(
        self,
        name: str,
        coro_factory,
        interval_seconds: float = 60.0,
    ) -> None:
        """
        Register a periodic background task.

        Args:
            name              Unique task name (used for logging / cancellation).
            coro_factory      Zero-argument callable that returns an awaitable.
            interval_seconds  How often (in seconds) to run the task.
        """
        self._task_registry = getattr(self, "_task_registry", {})
        self._task_registry[name] = (coro_factory, interval_seconds)

    async def start(self) -> None:
        """Start all registered periodic tasks."""
        self._running = True
        registry = getattr(self, "_task_registry", {})
        for name, (factory, interval) in registry.items():
            self._tasks[name] = asyncio.create_task(
                self._loop(name, factory, interval)
            )

    async def stop(self) -> None:
        """Cancel and await all running background tasks."""
        self._running = False
        for name, task in self._tasks.items():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._tasks.clear()

    async def _loop(self, name: str, factory, interval: float) -> None:
        while self._running:
            try:
                await factory()
            except Exception as exc:  # pragma: no cover
                print(f"[scheduler] Task '{name}' raised an exception: {exc}")
            await asyncio.sleep(interval)

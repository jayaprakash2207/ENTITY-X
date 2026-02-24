"""
backend.db – in-memory detection history store.

Provides the shared _history list, _history_lock, and record/query helpers
used by all route handlers.
"""
from __future__ import annotations

import asyncio

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

MAX_HISTORY = 10_000  # cap to prevent unbounded growth

_history: list[dict] = []
_history_lock: asyncio.Lock = asyncio.Lock()


async def record_history(record: dict) -> None:
    """
    Append a detection record to the in-memory history store.

    The oldest record is dropped when the buffer exceeds MAX_HISTORY.
    Designed for fire-and-forget use with asyncio.create_task().

    Record schema::

        {
            "entity_id":        str,    # SHA-256 short hash
            "type":             str,    # "IMAGE" | "TEXT"
            "source_url":       str,
            "title":            str,    # TEXT records only
            "risk_level":       str,    # "LOW" | "MEDIUM" | "HIGH"
            "fake_probability": float,
            "trust_score_after": float,
            "timestamp":        int,    # ms epoch
        }
    """
    async with _history_lock:
        _history.append(record)
        if len(_history) > MAX_HISTORY:
            del _history[0]


async def query_history(
    type_filter: str | None = None,
    risk_filter: str | None = None,
    limit: int = 500,
) -> dict:
    """
    Return detection records with optional filters, newest-first.

    Args:
        type_filter   Filter by record type ("IMAGE" or "TEXT"; case-insensitive).
        risk_filter   Filter by risk level ("LOW", "MEDIUM", "HIGH"; case-insensitive).
        limit         Maximum number of records to return (clamped 1–2000).

    Returns:
        {"records": [...], "total": int}
    """
    async with _history_lock:
        records = list(reversed(_history))  # newest first

    if type_filter:
        t = type_filter.upper()
        records = [r for r in records if r.get("type", "").upper() == t]

    if risk_filter:
        rl = risk_filter.upper()
        records = [r for r in records if r.get("risk_level", "").upper() == rl]

    limit = max(1, min(limit, 2000))
    return {"records": records[:limit], "total": len(records)}

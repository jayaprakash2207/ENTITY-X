"""
trust_engine – per-session trust-score tracking.

Sessions start at 100.0.  Each detection subtracts
``fake_probability * 100`` points (clamped to 0.0 – 100.0).
"""
from __future__ import annotations

import asyncio


class TrustScoreEngine:
    """
    Asynchronous, per-session trust-score tracker.

    Thread-safe via internal asyncio.Lock.

    Usage::

        engine = TrustScoreEngine()
        score, deducted = await engine.update_score("session-abc", 0.82)
    """

    def __init__(self, initial_score: float = 100.0) -> None:
        self.initial_score = initial_score
        self._session_scores: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def update_score(
        self, session_id: str, fake_probability: float
    ) -> tuple[float, float]:
        """
        Deduct a probability-weighted penalty from the session's trust score.

        Args:
            session_id       Unique session identifier string.
            fake_probability Probability value in [0.0, 1.0].

        Returns:
            (updated_score, deduction) — both as floats rounded to 2 d.p.
        """
        bounded = max(0.0, min(1.0, fake_probability))
        deduction = round(bounded * 100.0, 2)

        async with self._lock:
            current = self._session_scores.get(session_id, self.initial_score)
            updated = round(max(0.0, current - deduction), 2)
            self._session_scores[session_id] = updated

        return updated, deduction

    async def get_score(self, session_id: str) -> float:
        """Return the current trust score for a session (default: initial_score)."""
        async with self._lock:
            return self._session_scores.get(session_id, self.initial_score)

    async def reset_score(self, session_id: str) -> None:
        """Reset a session's trust score back to initial_score."""
        async with self._lock:
            self._session_scores[session_id] = self.initial_score

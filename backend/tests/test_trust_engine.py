"""Tests for backend.trust.trust_engine"""
import pytest
from unittest.mock import AsyncMock, patch

from backend.trust.trust_engine import TrustScoreEngine


@pytest.fixture
def engine():
    return TrustScoreEngine()


class TestTrustScoreEngine:

    def test_instantiation(self, engine):
        assert engine is not None

    @pytest.mark.asyncio
    async def test_high_probability_reduces_score(self, engine):
        with patch("backend.db.database.db_get_trust_score", new_callable=AsyncMock) as mock_get, \
             patch("backend.db.database.db_set_trust_score", new_callable=AsyncMock):
            mock_get.return_value = 100.0
            score, deduction = await engine.update_score("session-high", 0.95)
        assert score < 100.0
        assert deduction > 0

    @pytest.mark.asyncio
    async def test_low_probability_small_deduction(self, engine):
        with patch("backend.db.database.db_get_trust_score", new_callable=AsyncMock) as mock_get, \
             patch("backend.db.database.db_set_trust_score", new_callable=AsyncMock):
            mock_get.return_value = 100.0
            score, deduction = await engine.update_score("session-low", 0.05)
        assert score > 90.0
        assert deduction < 1.0

    @pytest.mark.asyncio
    async def test_score_never_goes_below_zero(self, engine):
        with patch("backend.db.database.db_get_trust_score", new_callable=AsyncMock) as mock_get, \
             patch("backend.db.database.db_set_trust_score", new_callable=AsyncMock):
            mock_get.return_value = 1.0
            score, deduction = await engine.update_score("session-floor", 1.0)
        assert score >= 0.0

    @pytest.mark.asyncio
    async def test_score_never_exceeds_initial(self, engine):
        with patch("backend.db.database.db_get_trust_score", new_callable=AsyncMock) as mock_get, \
             patch("backend.db.database.db_set_trust_score", new_callable=AsyncMock):
            mock_get.return_value = 99.0
            score, deduction = await engine.update_score("session-cap", 0.01)
        assert score <= 100.0

    @pytest.mark.asyncio
    async def test_zero_probability_no_deduction(self, engine):
        with patch("backend.db.database.db_get_trust_score", new_callable=AsyncMock) as mock_get, \
             patch("backend.db.database.db_set_trust_score", new_callable=AsyncMock):
            mock_get.return_value = 80.0
            score, deduction = await engine.update_score("session-zero", 0.0)
        assert deduction == 0.0
        assert score == 80.0

    @pytest.mark.asyncio
    async def test_probability_clamped_above_one(self, engine):
        with patch("backend.db.database.db_get_trust_score", new_callable=AsyncMock) as mock_get, \
             patch("backend.db.database.db_set_trust_score", new_callable=AsyncMock):
            mock_get.return_value = 100.0
            score1, deduction1 = await engine.update_score("s1", 1.0)
            mock_get.return_value = 100.0
            score2, deduction2 = await engine.update_score("s2", 9999.0)
        assert deduction1 == deduction2

    @pytest.mark.asyncio
    async def test_get_score_returns_initial_when_missing(self, engine):
        with patch("backend.db.database.db_get_trust_score", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = 100.0
            score = await engine.get_score("brand-new-session")
        assert score == 100.0

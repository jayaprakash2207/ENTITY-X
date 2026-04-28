"""Tests for backend.monitor.watchlist"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.monitor.watchlist import _simple_risk, _scan_keyword_item, _scan_url_item


class TestSimpleRisk:

    def test_no_high_words_returns_zero(self):
        assert _simple_risk("the cat sat on the mat") == 0.0

    def test_single_high_word(self):
        score = _simple_risk("this is fake news")
        assert 0.0 < score <= 1.0

    def test_many_high_words_capped_at_one(self):
        text = "fake hoax manipulated deepfake false misinformation disinformation fabricated"
        score = _simple_risk(text)
        assert score == 1.0

    def test_case_insensitive(self):
        assert _simple_risk("FAKE content") == _simple_risk("fake content")

    def test_four_words_gives_one(self):
        assert _simple_risk("fake hoax fraud scam") == 1.0

    def test_two_words_gives_half(self):
        score = _simple_risk("fake hoax")
        assert score == 0.5


class TestScanKeywordItem:

    @pytest.mark.asyncio
    async def test_empty_keyword_returns_no_alerts(self):
        item = {"keyword": "", "threshold": 0.3}
        client = AsyncMock()
        result = await _scan_keyword_item(item, client)
        assert result == []

    @pytest.mark.asyncio
    async def test_keyword_not_in_feed_returns_empty(self):
        item = {"keyword": "xyznotfound", "threshold": 0.3}
        mock_resp = MagicMock()
        mock_resp.text = "<rss><channel><title>News</title></channel></rss>"
        client = AsyncMock()
        client.get = AsyncMock(return_value=mock_resp)

        result = await _scan_keyword_item(item, client)
        assert result == []

    @pytest.mark.asyncio
    async def test_rss_fetch_error_returns_empty(self):
        item = {"keyword": "deepfake", "threshold": 0.3}
        client = AsyncMock()
        client.get = AsyncMock(side_effect=Exception("network error"))

        result = await _scan_keyword_item(item, client)
        assert result == []

    @pytest.mark.asyncio
    async def test_matching_keyword_above_threshold_returns_alert(self):
        item = {"keyword": "deepfake", "threshold": 0.1}
        rss_xml = (
            "<rss><channel>"
            "<title><![CDATA[deepfake video is fake and fabricated]]></title>"
            "<link>https://example.com/story1</link>"
            "</channel></rss>"
        )
        mock_resp = MagicMock()
        mock_resp.text = rss_xml
        client = AsyncMock()
        client.get = AsyncMock(return_value=mock_resp)

        result = await _scan_keyword_item(item, client)
        assert len(result) > 0
        assert result[0]["risk_level"] in ("LOW", "MEDIUM", "HIGH")
        assert 0.0 <= result[0]["fake_probability"] <= 1.0


class TestScanUrlItem:

    @pytest.mark.asyncio
    async def test_empty_url_returns_empty(self):
        item = {"url": "", "threshold": 0.5}
        client = AsyncMock()
        result = await _scan_url_item(item, client)
        assert result == []

    @pytest.mark.asyncio
    async def test_low_risk_content_below_threshold(self):
        item = {"url": "http://example.com", "threshold": 0.5}
        mock_resp = MagicMock()
        mock_resp.text = "Today is a sunny day. The birds are singing."
        client = AsyncMock()
        client.get = AsyncMock(return_value=mock_resp)

        result = await _scan_url_item(item, client)
        assert result == []

    @pytest.mark.asyncio
    async def test_high_risk_content_above_threshold(self):
        item = {"url": "http://example.com/page", "threshold": 0.2}
        mock_resp = MagicMock()
        mock_resp.text = "fake hoax fabricated deepfake false misinformation"
        client = AsyncMock()
        client.get = AsyncMock(return_value=mock_resp)

        result = await _scan_url_item(item, client)
        assert len(result) > 0
        assert result[0]["source_url"] == "http://example.com/page"

    @pytest.mark.asyncio
    async def test_fetch_error_returns_empty(self):
        item = {"url": "http://example.com", "threshold": 0.5}
        client = AsyncMock()
        client.get = AsyncMock(side_effect=Exception("timeout"))

        result = await _scan_url_item(item, client)
        assert result == []

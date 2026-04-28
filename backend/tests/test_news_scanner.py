"""Tests for backend.monitor.news_scanner"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.monitor.news_scanner import _strip_html, _extract_title, NewsScanner


class TestStripHtml:

    def test_removes_script_tags(self):
        html = "<html><script>alert('x')</script><p>Hello</p></html>"
        result = _strip_html(html)
        assert "alert" not in result
        assert "Hello" in result

    def test_removes_style_tags(self):
        html = "<html><style>body{color:red}</style><p>World</p></html>"
        result = _strip_html(html)
        assert "color" not in result
        assert "World" in result

    def test_decodes_html_entities(self):
        html = "<p>A &amp; B &lt;vs&gt; C &quot;quoted&quot; it&#39;s</p>"
        result = _strip_html(html)
        assert "&amp;" not in result
        assert "A & B" in result
        assert "<vs>" in result

    def test_collapses_whitespace(self):
        html = "<p>too   many    spaces</p>"
        result = _strip_html(html)
        assert "  " not in result

    def test_empty_string(self):
        assert _strip_html("") == ""

    def test_plain_text_unchanged(self):
        result = _strip_html("No tags here")
        assert result == "No tags here"


class TestExtractTitle:

    def test_extracts_og_title(self):
        html = '<meta property="og:title" content="OG Title Here" />'
        assert _extract_title(html) == "OG Title Here"

    def test_extracts_title_tag(self):
        html = "<html><head><title>Page Title</title></head></html>"
        assert _extract_title(html) == "Page Title"

    def test_og_title_preferred_over_title_tag(self):
        html = '<meta property="og:title" content="OG" /><title>Fallback</title>'
        assert _extract_title(html) == "OG"

    def test_no_title_returns_empty(self):
        assert _extract_title("<html><body>nothing</body></html>") == ""


class TestNewsScanner:

    @pytest.mark.asyncio
    async def test_scan_success_path(self):
        scanner = NewsScanner()
        html_body = "<html><title>Test Article</title><p>" + "word " * 150 + "</p></html>"

        mock_response = MagicMock()
        mock_response.text = html_body
        mock_response.raise_for_status = MagicMock()

        fake_analysis = {
            "ai_generated_probability": 0.2,
            "misinformation_risk": "LOW",
            "credibility_score": 0.8,
            "explanation": ["Looks credible"],
        }

        with patch("backend.monitor.news_scanner._text_analyzer") as mock_analyzer, \
             patch("httpx.AsyncClient") as mock_client_cls:
            mock_analyzer.analyze = AsyncMock(return_value=fake_analysis)
            mock_cm = AsyncMock()
            mock_cm.__aenter__ = AsyncMock(return_value=mock_cm)
            mock_cm.__aexit__ = AsyncMock(return_value=False)
            mock_cm.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_cm

            result = await scanner.scan("http://example.com/article", session_id="s1")

        assert result["article_url"] == "http://example.com/article"
        assert result["session_id"] == "s1"
        assert result["misinformation_risk"] == "LOW"
        assert result["credibility_score"] == 0.8

    @pytest.mark.asyncio
    async def test_scan_network_failure_returns_high_risk(self):
        scanner = NewsScanner()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_cm = AsyncMock()
            mock_cm.__aenter__ = AsyncMock(return_value=mock_cm)
            mock_cm.__aexit__ = AsyncMock(return_value=False)
            mock_cm.get = AsyncMock(side_effect=Exception("connection refused"))
            mock_client_cls.return_value = mock_cm

            result = await scanner.scan("http://bad.example.com/", session_id="s2")

        assert result["misinformation_risk"] == "HIGH"
        assert result["credibility_score"] == 0.0
        assert result.get("analysis_failed") is True

    @pytest.mark.asyncio
    async def test_scan_result_keys_present(self):
        scanner = NewsScanner()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_cm = AsyncMock()
            mock_cm.__aenter__ = AsyncMock(return_value=mock_cm)
            mock_cm.__aexit__ = AsyncMock(return_value=False)
            mock_cm.get = AsyncMock(side_effect=RuntimeError("timeout"))
            mock_client_cls.return_value = mock_cm

            result = await scanner.scan("http://x.com/", session_id="s3")

        required = {"article_url", "session_id", "title", "word_count",
                    "misinformation_risk", "credibility_score", "explanation"}
        assert required.issubset(result.keys())

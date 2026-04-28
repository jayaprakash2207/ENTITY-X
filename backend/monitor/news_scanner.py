"""
backend.monitor.news_scanner – article text extractor + text-analysis dispatcher.

Fetches a news article URL, extracts readable text from the HTML, then calls
RealTextAnalyzer.  Falls back gracefully to a minimal stub result on any error.
"""
from __future__ import annotations

import re

import httpx

from backend.ai.text_model import RealTextAnalyzer

_text_analyzer = RealTextAnalyzer()

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
}


def _strip_html(html: str) -> str:
    """Very lightweight HTML → plain-text extraction (no extra deps)."""
    # Remove scripts, styles, and nav blocks wholesale
    for tag in ("script", "style", "nav", "header", "footer", "aside"):
        html = re.sub(rf"<{tag}[^>]*>.*?</{tag}>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove remaining tags
    text = re.sub(r"<[^>]+>", " ", html)
    # Decode common HTML entities
    for entity, char in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                          ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " ")]:
        text = text.replace(entity, char)
    # Collapse whitespace
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text


def _extract_title(html: str) -> str:
    """Extract <title> or og:title from HTML."""
    og = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']', html, re.IGNORECASE)
    if og:
        return og.group(1).strip()
    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if title:
        return re.sub(r"\s+", " ", title.group(1)).strip()
    return ""


class NewsScanner:
    """
    Fetch article text from a URL and dispatch to the text-analysis pipeline.
    """

    async def scan(
        self,
        article_url: str,
        session_id: str = "default",
        *,
        title: str = "",
    ) -> dict:
        """
        Scan an article URL for AI-generation and misinformation signals.

        Returns a dict compatible with the TextMonitorResponse schema plus
        extra fields (word_count, title).
        """
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(20.0),
                follow_redirects=True,
                max_redirects=5,
            ) as client:
                resp = await client.get(article_url, headers=_BROWSER_HEADERS)
                resp.raise_for_status()
                html = resp.text

            extracted_title = title or _extract_title(html)
            body = _strip_html(html)

            # Keep only the most informative portion (first ~2 000 words)
            words = body.split()
            body = " ".join(words[:2000])

            if len(body) < 100:
                raise ValueError("Extracted text too short")

            result = await _text_analyzer.analyze(body, extracted_title, article_url)

            return {
                "article_url":              article_url,
                "session_id":               session_id,
                "title":                    extracted_title or "unknown",
                "word_count":               len(words),
                "ai_generated_probability": result["ai_generated_probability"],
                "misinformation_risk":      result["misinformation_risk"],
                "credibility_score":        result["credibility_score"],
                "explanation":              result["explanation"],
            }

        except Exception as exc:  # noqa: BLE001
            # Do NOT return LOW risk / high credibility on failure — that would
            # give users a false "safe" signal.  Return UNKNOWN/HIGH to force
            # manual review.
            return {
                "article_url":              article_url,
                "session_id":               session_id,
                "title":                    title or "unknown",
                "word_count":               0,
                "ai_generated_probability": None,
                "misinformation_risk":      "HIGH",
                "credibility_score":        0.0,
                "analysis_failed":          True,
                "explanation": [
                    f"Article extraction failed — analysis could not be completed: {type(exc).__name__}: {exc}",
                    "Treat this content as UNVERIFIED. Provide the text body directly via /api/text-monitor for analysis.",
                ],
            }

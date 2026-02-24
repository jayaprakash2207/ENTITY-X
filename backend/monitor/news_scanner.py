"""
backend.monitor.news_scanner – news and article content monitor (stub).

Intended to scrape/parse article body text from a given URL and route it
to the text-analysis pipeline.  Currently returns a stub response.
"""
from __future__ import annotations


class NewsScanner:
    """
    Fetch article text from a URL and dispatch to text-analysis pipeline.

    Future implementation should:
    1. Fetch HTML with httpx.
    2. Extract article body with a library such as newspaper3k or readability.
    3. Call MockTextAnalyzer (or a real NLP model) on the extracted text.
    4. Return the structured analysis result.
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

        Args:
            article_url  URL of the article or news page.
            session_id   Client session identifier.
            title        Optional pre-extracted title.

        Returns:
            Placeholder result dict.
        """
        return {
            "article_url":              article_url,
            "session_id":               session_id,
            "title":                    title or "unknown",
            "ai_generated_probability": 0.0,
            "misinformation_risk":      "LOW",
            "credibility_score":        1.0,
            "word_count":               0,
            "explanation": [
                "Automatic article extraction is not yet implemented.",
                "Provide the text body directly via /api/text-monitor for analysis.",
            ],
        }

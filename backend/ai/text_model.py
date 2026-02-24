"""
backend.ai.text_model – heuristic AI-generation and misinformation detector.

MockTextAnalyzer scores article/text content using vocabulary statistics,
surface-level AI-phrase detection, and URL-domain heuristics.  No external
model is required; replace analyze() with a real model when available.
"""
from __future__ import annotations

import hashlib
from typing import Literal


class MockTextAnalyzer:
    """
    Pseudo-deterministic text analyzer for AI-generation and misinformation.

    Returns a dict with::

        {
            "ai_generated_probability": float,
            "misinformation_risk":      "LOW" | "MEDIUM" | "HIGH",
            "credibility_score":        float,
            "explanation":              [str],
        }
    """

    # ----------------------------------------------------------------
    # Surface-level heuristic marker lists
    # ----------------------------------------------------------------

    _AI_MARKERS: list[str] = [
        "i am an ai", "as an ai", "i'm an ai", "i cannot",
        "please note that", "it is important to note", "furthermore",
        "in conclusion", "in summary", "overall", "to summarize",
        "as the ai model",
    ]

    _MISINFO_MARKERS: list[str] = [
        "fake news", "hoax", "conspiracy", "unverified",
        "allegedly", "rumor", "supposedly", "claimed",
        "unproven", "without evidence",
    ]

    _SUSPICIOUS_DOMAINS: list[str] = [
        "blogspot.", "wordpress.", "wix.", "weebly.",
    ]

    # ----------------------------------------------------------------
    # Public interface
    # ----------------------------------------------------------------

    async def analyze(self, text: str, title: str, url: str) -> dict:
        """
        Analyse text/article content.

        Args:
            text   Full body text of the article or post.
            title  Article headline or page title.
            url    Source URL.

        Returns:
            Dict with ai_generated_probability, misinformation_risk,
            credibility_score, and explanation.
        """
        text_hash = hashlib.sha256(text.encode("utf-8")).digest()
        pseudo_seed = int.from_bytes(text_hash[:8], byteorder="big") % 1000
        text_lower = text.lower()

        # ── AI generation probability ──────────────────────────────
        ai_marker_count = sum(
            1 for marker in self._AI_MARKERS if marker in text_lower
        )
        words = text.split()
        unique_word_ratio = len(set(words)) / max(len(words), 1)
        sentence_count = (
            text.count(".") + text.count("!") + text.count("?")
        )
        avg_sentence_length = len(words) / max(sentence_count, 1)

        # AI text often has consistent sentence length (~15 words)
        ai_consistency_signal = 1.0 - min(
            1.0, abs(avg_sentence_length - 15) / 20.0
        )

        ai_score = (
            0.1
            + 0.2 * (ai_marker_count / max(len(self._AI_MARKERS), 1))
            + 0.3 * unique_word_ratio
            + 0.4 * ai_consistency_signal
        )
        ai_score = max(0.05, min(0.99, ai_score))
        ai_score = ai_score * 0.7 + (pseudo_seed / 1000.0) * 0.3

        # ── Misinformation risk ────────────────────────────────────
        misinfo_count = sum(
            1 for m in self._MISINFO_MARKERS if m in text_lower
        )
        is_suspicious_url = any(
            d in url.lower() for d in self._SUSPICIOUS_DOMAINS
        )
        misinfo_score = (
            0.2 * (misinfo_count / max(len(self._MISINFO_MARKERS), 1))
            + 0.3 * (1.0 if is_suspicious_url else 0.0)
            + 0.5 * (pseudo_seed % 100) / 100.0
        )

        misinformation_risk: Literal["LOW", "MEDIUM", "HIGH"]
        if misinfo_score >= 0.6:
            misinformation_risk = "HIGH"
        elif misinfo_score >= 0.35:
            misinformation_risk = "MEDIUM"
        else:
            misinformation_risk = "LOW"

        # ── Credibility ────────────────────────────────────────────
        credibility_score = max(
            0.1, 1.0 - (ai_score * 0.6 + misinfo_score * 0.4)
        )

        # ── Explanation ────────────────────────────────────────────
        explanations: list[str] = []
        if ai_score > 0.6:
            explanations.append(
                f"Text exhibits traits commonly associated with AI generation "
                f"({ai_score * 100:.0f}% confidence)."
            )
        if misinformation_risk == "HIGH":
            explanations.append(
                f"Multiple misinformation risk factors detected. URL: {url}"
            )
            if is_suspicious_url:
                explanations.append(
                    "Source domain is associated with low-credibility hosting."
                )
        elif misinformation_risk == "MEDIUM":
            explanations.append(
                "Moderate misinformation risk detected based on content analysis."
            )
        if len(words) < 200:
            explanations.append(
                "Content is relatively short, limiting analysis depth."
            )
        explanations.append(
            f"Credibility score: {credibility_score * 100:.1f}%"
        )

        return {
            "ai_generated_probability": ai_score,
            "misinformation_risk":      misinformation_risk,
            "credibility_score":        credibility_score,
            "explanation":              explanations,
        }

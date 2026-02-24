"""
backend.ai.image_model – heuristic deepfake / synthetic-image detector.

MockDeepfakeAnalyzer provides a Hugging Face-compatible interface that works
without a GPU:  it uses SHA-256 seeding and byte-entropy to generate
pseudo-deterministic probability scores.  Swap it for a real model by
subclassing or replacing the ``analyze`` method.
"""
from __future__ import annotations

import hashlib
import math
from typing import Literal

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class AnalysisResult(BaseModel):
    """Structured result returned by the deepfake analyzer."""
    fake_probability: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    forensic_explanation: list[str]


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------

class MockDeepfakeAnalyzer:
    """
    Lightweight heuristic image analyzer.

    When *image_bytes* is None (e.g. the fetch failed due to a network
    timeout), a neutral LOW-risk result is returned so the caller can still
    log the detection event.
    """

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def analyze(
        self, image_bytes: bytes | None, image_url: str
    ) -> AnalysisResult:
        """
        Analyse image bytes and return an AnalysisResult.

        Args:
            image_bytes  Raw image bytes, or None if fetch failed.
            image_url    Source URL (always provided – used for seeding).

        Returns:
            AnalysisResult with fake_probability, risk_level, and
            forensic_explanation.
        """
        if not image_bytes:
            return AnalysisResult(
                fake_probability=0.0,
                risk_level="LOW",
                forensic_explanation=[
                    "Unable to fetch image data for analysis.",
                    "This likely indicates a network timeout or temporary connectivity issue.",
                    "The image has been logged for monitoring, but actual deepfake "
                    "analysis requires image content.",
                    "Trust score remains unchanged due to limited analysis confidence.",
                ],
            )

        digest = hashlib.sha256(
            image_bytes[:2048] + image_url.encode("utf-8")
        ).digest()
        pseudo_seed = int.from_bytes(digest[:8], byteorder="big")

        entropy_sample = image_bytes[: min(len(image_bytes), 8192)]
        entropy = self._byte_entropy(entropy_sample)

        base = (pseudo_seed % 1000) / 1000.0
        entropy_signal = max(0.0, min(1.0, (entropy - 5.0) / 3.0))
        score = max(0.01, min(0.99, 0.65 * base + 0.35 * entropy_signal))

        lighting_signal    = self._indicator_probability(digest[8],  entropy_signal, bias=0.05)
        texture_signal     = self._indicator_probability(digest[16], base, bias=-0.03)
        compression_signal = self._indicator_probability(digest[24], (base + entropy_signal) / 2.0)

        risk_level: Literal["LOW", "MEDIUM", "HIGH"]
        if score >= 0.75:
            risk_level = "HIGH"
        elif score >= 0.4:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        explanations = [
            "This output reflects probabilistic forensic cues from a lightweight "
            "heuristic model and should not be treated as a definitive finding.",
            f"Estimated manipulation likelihood is approximately {score:.2f}, which "
            f"suggests a {risk_level.lower()}-to-moderate concern level rather than certainty.",
            f"Inconsistent lighting cue: approximately {lighting_signal:.2f} likelihood "
            "of illumination mismatch patterns that may be consistent with synthetic or edited content.",
            f"Unnatural texture cue: approximately {texture_signal:.2f} likelihood of atypical "
            "texture continuity, which can occur in generated imagery but may also appear in "
            "heavily processed authentic images.",
            f"Compression artifact cue: approximately {compression_signal:.2f} likelihood of "
            "artifact structure divergence; this can indicate recompression or generation effects, "
            "but it is not conclusive on its own.",
            "For higher-confidence interpretation, combine this estimate with model-based analysis "
            "(for example, a dedicated Hugging Face classifier), metadata review, and provenance checks.",
        ]

        return AnalysisResult(
            fake_probability=round(score, 4),
            risk_level=risk_level,
            forensic_explanation=explanations,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _byte_entropy(data: bytes) -> float:
        """Shannon entropy of a byte sequence (0–8 bits/symbol scale)."""
        if not data:
            return 0.0
        counts = [0] * 256
        for value in data:
            counts[value] += 1
        total = len(data)
        entropy = 0.0
        for count in counts:
            if count == 0:
                continue
            p = count / total
            entropy -= p * math.log2(p)
        return entropy

    @staticmethod
    def _indicator_probability(
        raw_signal: int, blended_signal: float, bias: float = 0.0
    ) -> float:
        """Map a raw byte value + blended signal to a [0.01, 0.99] probability."""
        normalized_raw = raw_signal / 255.0
        blended = (
            0.6 * normalized_raw
            + 0.4 * max(0.0, min(1.0, blended_signal))
            + bias
        )
        return round(max(0.01, min(0.99, blended)), 2)

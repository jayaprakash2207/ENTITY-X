"""
backend.ai.video_model – video deepfake detection (stub).

Replace this module with a real video-frame pipeline such as
FaceForensics++ or a Hugging Face video classifier when available.
"""
from __future__ import annotations


class MockVideoAnalyzer:
    """
    Placeholder video deepfake analyzer.

    Currently returns a fixed neutral result to satisfy the API contract
    while the real model integration is pending.
    """

    async def analyze(self, video_url: str) -> dict:
        """
        Analyse a video URL for deepfake indicators.

        Args:
            video_url   Publicly accessible URL of the video asset.

        Returns:
            Dict with fake_probability, risk_level, and explanation.
        """
        return {
            "fake_probability": 0.0,
            "risk_level": "LOW",
            "explanation": [
                "Video deepfake analysis is not yet available in this build.",
                "Integration with a frame-level forensic pipeline is planned.",
                "This placeholder result does not reflect actual analysis.",
            ],
        }

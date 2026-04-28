"""
backend.monitor.video_scanner – wrapper around RealVideoAnalyzer for the
auto-detection pipeline.
"""
from __future__ import annotations

from backend.ai.video_model import RealVideoAnalyzer


class VideoScanner:
    """
    Thin wrapper that delegates to RealVideoAnalyzer so the auto-detection
    pipeline can call scanner.scan() with a consistent interface.
    """

    def __init__(self, image_analyzer=None) -> None:
        self._analyzer = RealVideoAnalyzer(image_analyzer=image_analyzer)

    async def scan(self, video_url: str, session_id: str = "default") -> dict:
        """
        Scan a video URL for deepfake / synthetic content.

        Returns a dict compatible with the VideoMonitorResponse schema.
        """
        result = await self._analyzer.analyze(video_url)
        return {
            "video_url":          video_url,
            "session_id":         session_id,
            "fake_probability":   result.fake_probability,
            "risk_level":         result.risk_level,
            "frames_analysed":    result.frames_analysed,
            "frame_scores":       result.frame_scores,
            "forensic_explanation": result.explanation,
        }

"""
backend.monitor.video_scanner – video content monitor (stub).

This module is a placeholder for a future frame-level video deepfake
detection pipeline.  Integrate a real forensic video model here when
available (e.g. frame sampling + CNN-based classifier).
"""
from __future__ import annotations


class VideoScanner:
    """
    Placeholder video scanner.

    Future implementation should:
    1. Download/stream video frames from the URL.
    2. Sample key-frames at configurable intervals.
    3. Run each frame through an image deepfake classifier.
    4. Aggregate per-frame scores into a final risk assessment.
    """

    async def scan(self, video_url: str, session_id: str = "default") -> dict:
        """
        Scan a video URL for deepfake / synthetic content.

        Args:
            video_url   Publicly accessible URL of the video.
            session_id  Client session identifier.

        Returns:
            Placeholder result dict.
        """
        return {
            "video_url":      video_url,
            "session_id":     session_id,
            "fake_probability": 0.0,
            "risk_level":     "LOW",
            "frame_count":    0,
            "explanation": [
                "Video scanning is not yet implemented in this build.",
                "No frames were analysed.  This result is a placeholder only.",
            ],
        }

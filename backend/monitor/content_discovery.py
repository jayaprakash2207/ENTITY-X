"""
backend.monitor.content_discovery – URL routing and content-type dispatcher.

ContentDiscovery inspects a URL and decides which scanner pipeline to invoke
(image, video, news/text, or unknown).  This acts as the entry-point for all
URL-based detection requests before individual scanners are called.
"""
from __future__ import annotations

from urllib.parse import urlparse

# Known image file extensions
_IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".bmp", ".tiff", ".tif", ".avif", ".heic",
}

# Known video file extensions
_VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".avi", ".mkv", ".webm",
    ".flv", ".wmv", ".m4v", ".3gp",
}

# Domains/paths commonly associated with news/article content
_NEWS_DOMAINS: list[str] = [
    "bbc.", "reuters.", "apnews.", "nytimes.", "theguardian.",
    "washingtonpost.", "cnn.", "foxnews.", "nbcnews.", "huffpost.",
]


def classify_url(url: str) -> str:
    """
    Classify a URL into a content category.

    Returns:
        "IMAGE" | "VIDEO" | "TEXT" | "UNKNOWN"
    """
    parsed = urlparse(url.lower())
    path = parsed.path

    ext = ""
    if "." in path.rsplit("/", 1)[-1]:
        ext = "." + path.rsplit(".", 1)[-1]

    if ext in _IMAGE_EXTENSIONS:
        return "IMAGE"

    if ext in _VIDEO_EXTENSIONS:
        return "VIDEO"

    netloc = parsed.netloc
    if any(domain in netloc for domain in _NEWS_DOMAINS):
        return "TEXT"

    # Fallback: no extension, not a known domain — treat as TEXT/article
    if not ext:
        return "TEXT"

    return "UNKNOWN"


def is_direct_image_url(url: str) -> bool:
    """Return True if the URL almost certainly points to a raw image file."""
    return classify_url(url) == "IMAGE"

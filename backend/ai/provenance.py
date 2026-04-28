"""
backend.ai.provenance – Content provenance scanner + spread chain tracker.

Two responsibilities:
  1. check_provenance(url)  – scan image bytes for C2PA / XMP markers.
  2. track_provenance(url)  – compute a perceptual fingerprint, record every
     domain the content appears on, and return the full spread chain.
"""
from __future__ import annotations

import hashlib
import logging
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Perceptual fingerprint (lightweight, no PIL required)
# ---------------------------------------------------------------------------

def _dhash(data: bytes, size: int = 8) -> str:
    """
    Compute a difference-hash of raw image bytes without PIL.
    Falls back to SHA-256 prefix for non-image content.
    """
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data)).convert("L").resize((size + 1, size))
        pixels = list(img.getdata())
        bits = []
        for row in range(size):
            for col in range(size):
                left = pixels[row * (size + 1) + col]
                right = pixels[row * (size + 1) + col + 1]
                bits.append("1" if left > right else "0")
        return format(int("".join(bits), 2), "016x")
    except Exception:
        return hashlib.sha256(data[:4096]).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Provenance marker detection
# ---------------------------------------------------------------------------

def _detect_markers(data: bytes) -> dict:
    low = data.lower()
    has_c2pa = (b"jumb" in data and b"c2pa" in low) or b"c2pa.manifest" in low or b"c2pa:" in low
    has_cai  = b"contentauth.org" in low or b"content credentials" in low or b"cai:" in low
    has_xmp  = b"<?xpacket" in data or b"<x:xmpmeta" in data

    if has_c2pa:
        return {"has_provenance": True, "standard": "C2PA",               "verified": False,
                "label": "C2PA Certified",      "color": "#34d399",
                "note": "C2PA provenance manifest detected. Content origin traceable."}
    if has_cai:
        return {"has_provenance": True, "standard": "Content Credentials", "verified": False,
                "label": "Content Credentials", "color": "#8b5cf6",
                "note": "Adobe Content Credentials / CAI metadata detected."}
    if has_xmp:
        return {"has_provenance": True, "standard": "XMP",                 "verified": False,
                "label": "XMP Metadata",        "color": "#fbbf24",
                "note": "XMP metadata present but no C2PA certificate."}
    return {"has_provenance": False, "standard": None, "verified": False,
            "label": "No Provenance", "color": "#f87171",
            "note": "No provenance certificate found. Origin unverifiable."}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def check_provenance(image_url: str) -> dict:
    """Return provenance markers for the given image URL."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0), follow_redirects=True) as client:
            resp = await client.get(image_url, headers={"Range": "bytes=0-65535"})
            data = resp.content
    except Exception as exc:
        return {"has_provenance": False, "standard": None, "verified": False,
                "label": "Check Failed", "color": "#475569",
                "note": f"Provenance check failed: {type(exc).__name__}"}

    return _detect_markers(data)


async def track_provenance(image_url: str) -> dict:
    """
    Fetch image, compute its fingerprint, detect provenance markers,
    persist to the chain DB, and return the full spread history.

    Returns::
        {
          "content_hash":   str,
          "provenance":     dict,        # same shape as check_provenance()
          "chain":          list[dict],  # all domains this content was seen on
          "spread_count":   int,
        }
    """
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=True) as client:
            resp = await client.get(image_url, headers={"Range": "bytes=0-131071"})
            data = resp.content
    except Exception as exc:
        return {"content_hash": None, "provenance": {"has_provenance": False, "label": "Fetch Failed"},
                "chain": [], "spread_count": 0, "error": str(exc)}

    content_hash = _dhash(data)
    provenance   = _detect_markers(data)
    domain       = urlparse(image_url).netloc or image_url[:80]

    try:
        from backend.db.database import db_record_provenance, db_query_provenance_chain
        await db_record_provenance(content_hash, image_url, domain, provenance.get("standard"))
        chain = await db_query_provenance_chain(content_hash)
    except Exception as exc:
        logger.warning(f"[provenance] DB error: {exc}")
        chain = []

    return {
        "content_hash": content_hash,
        "provenance":   provenance,
        "chain":        chain,
        "spread_count": sum(r.get("seen_count", 1) for r in chain),
    }

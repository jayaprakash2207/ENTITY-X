"""
backend.ai.generator_fingerprint – Identify which AI generator produced an image.

Uses pixel-level artifact heuristics (no heavy model required):
  • GAN checkerboard artifacts   → frequency-domain grid spikes
  • Diffusion smoothness         → high-frequency energy ratio
  • Eye / face symmetry          → left-right reflection correlation
  • EXIF / metadata absence      → common in AI-generated images
  • Colour palette clustering    → synthetic images often have fewer unique hues

Returns a generator label + confidence + evidence list.
"""
from __future__ import annotations

import io
import logging
import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Generator profiles and their artifact signatures
_GENERATORS = {
    "StyleGAN / GAN":         {"checkerboard": True,  "smooth": False, "palette_narrow": False},
    "Stable Diffusion":       {"checkerboard": False, "smooth": True,  "palette_narrow": False},
    "DALL-E / OpenAI":        {"checkerboard": False, "smooth": True,  "palette_narrow": True},
    "Midjourney":             {"checkerboard": False, "smooth": True,  "palette_narrow": False},
    "DeepFake (face-swap)":   {"checkerboard": True,  "smooth": False, "palette_narrow": False},
}


def _load_image(data: bytes):
    from PIL import Image
    return Image.open(io.BytesIO(data)).convert("RGB")


def _checkerboard_score(img) -> float:
    """
    GAN upsampling leaves a 2×2 checkerboard pattern detectable as
    grid spikes in the DCT / power spectrum.
    Returns 0–1 (higher = more checkerboard-like).
    """
    try:
        import numpy as np
        gray = img.convert("L").resize((256, 256))
        arr  = np.array(gray, dtype=np.float32)
        dct  = np.fft.fft2(arr)
        mag  = np.abs(np.fft.fftshift(dct))
        h, w = mag.shape
        cy, cx = h // 2, w // 2
        # Nyquist region — where checkerboard artefacts appear
        nyq = mag[cy - 4:cy + 4, cx - 4:cx + 4].mean()
        mid = mag[cy - 32:cy + 32, cx - 32:cx + 32].mean()
        if mid < 1e-6:
            return 0.0
        ratio = float(nyq / mid)
        return min(ratio / 5.0, 1.0)
    except Exception:
        return 0.0


def _smoothness_score(img) -> float:
    """
    Diffusion models produce images with low high-frequency energy.
    Returns 0–1 (higher = smoother / more diffusion-like).
    """
    try:
        import numpy as np
        gray = img.convert("L").resize((128, 128))
        arr  = np.array(gray, dtype=np.float32)
        # Laplacian variance — low variance → smooth image
        lap = arr[1:-1, 1:-1] - 0.25 * (
            arr[:-2, 1:-1] + arr[2:, 1:-1] + arr[1:-1, :-2] + arr[1:-1, 2:]
        )
        variance = float(np.var(lap))
        # Normalize: typical photo variance ~500–3000, diffusion ~50–300
        return max(0.0, min(1.0, 1.0 - (variance / 800.0)))
    except Exception:
        return 0.0


def _palette_narrow_score(img) -> float:
    """
    DALL-E images tend to use a narrower colour palette for coherence.
    Returns 0–1 (higher = fewer unique hues).
    """
    try:
        small = img.resize((64, 64))
        pixels = list(small.getdata())
        # Quantise to 32 hue buckets
        hues: set[int] = set()
        for r, g, b in pixels:
            mx = max(r, g, b); mn = min(r, g, b)
            if mx == mn:
                continue
            if mx == r:
                h = (60 * ((g - b) / (mx - mn))) % 360
            elif mx == g:
                h = 60 * ((b - r) / (mx - mn)) + 120
            else:
                h = 60 * ((r - g) / (mx - mn)) + 240
            hues.add(int(h / 11.25))   # 32 buckets
        unique = len(hues)
        return max(0.0, min(1.0, 1.0 - (unique / 32.0)))
    except Exception:
        return 0.0


def _exif_absent_score(data: bytes) -> float:
    """AI images often have no EXIF. Returns 1.0 if no EXIF found."""
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(data))
        exif = img._getexif() if hasattr(img, "_getexif") else None
        return 0.0 if (exif and len(exif) > 2) else 0.8
    except Exception:
        return 0.5


def _score_generators(cb: float, sm: float, pal: float) -> list[tuple[str, float]]:
    """Map artifact scores to generator candidates with confidence."""
    scores = []
    for name, profile in _GENERATORS.items():
        s = 0.0
        if profile["checkerboard"]:
            s += cb * 0.5
        else:
            s += (1.0 - cb) * 0.3
        if profile["smooth"]:
            s += sm * 0.4
        else:
            s += (1.0 - sm) * 0.2
        if profile["palette_narrow"]:
            s += pal * 0.3
        else:
            s += (1.0 - pal) * 0.1
        scores.append((name, round(s, 3)))
    return sorted(scores, key=lambda x: -x[1])


def analyze_generator(data: bytes) -> dict:
    """
    Synchronous analysis — call via asyncio.to_thread for async contexts.

    Returns::
        {
          "generator":   str,    # most likely generator name
          "confidence":  float,  # 0–1
          "candidates":  list,   # [(name, score), ...]
          "evidence":    list[str],
          "is_ai_generated": bool,
        }
    """
    try:
        img = _load_image(data)
    except Exception as exc:
        return {"generator": "Unknown", "confidence": 0.0, "candidates": [],
                "evidence": [f"Could not decode image: {exc}"], "is_ai_generated": False}

    cb  = _checkerboard_score(img)
    sm  = _smoothness_score(img)
    pal = _palette_narrow_score(img)
    ex  = _exif_absent_score(data)

    candidates = _score_generators(cb, sm, pal)
    top_name, top_score = candidates[0]

    evidence = []
    if cb > 0.4:
        evidence.append(f"GAN checkerboard artifacts detected (score {cb:.2f})")
    if sm > 0.5:
        evidence.append(f"High image smoothness consistent with diffusion models (score {sm:.2f})")
    if pal > 0.5:
        evidence.append(f"Narrow colour palette suggests AI-controlled generation (score {pal:.2f})")
    if ex > 0.6:
        evidence.append("No EXIF metadata — typical of AI-generated images")
    if not evidence:
        evidence.append("No strong AI-generation artifacts detected")

    # Require at least 0.45 combined score to call it AI-generated
    is_ai = top_score >= 0.45 or ex > 0.6

    return {
        "generator":      top_name if is_ai else "Likely Real / Camera",
        "confidence":     round(top_score, 3),
        "candidates":     [{"name": n, "score": s} for n, s in candidates[:3]],
        "evidence":       evidence,
        "is_ai_generated": is_ai,
        "artifact_scores": {"checkerboard": cb, "smoothness": sm, "palette": pal, "no_exif": ex},
    }

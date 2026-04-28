"""
backend.ai.enrichment – Rich content analysis beyond deepfake detection.

Provides per-type enrichment:
  - Image : EXIF metadata, dominant colors, content classification, face count
  - Video : metadata (yt-dlp), scene timeline, frame analysis summary
  - Text  : named entities, sentiment, topic, writing stats
  - Audio : Whisper transcript, speaker estimate, audio quality summary
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import re
from typing import Optional

logger = logging.getLogger(__name__)


def _ytdlp_cookie_opts() -> dict:
    """Build optional yt-dlp cookie options from env vars."""
    opts: dict = {}
    cookies_path = os.environ.get("ENTITYX_YTDLP_COOKIES_PATH") or os.environ.get("YTDLP_COOKIES_PATH")
    cookies_browser = os.environ.get("ENTITYX_YTDLP_COOKIES_BROWSER") or os.environ.get("YTDLP_COOKIES_BROWSER")
    if cookies_path and os.path.exists(cookies_path):
        opts["cookiefile"] = cookies_path
    if cookies_browser:
        opts["cookiesfrombrowser"] = cookies_browser
    return opts

# ── Optional dependencies ────────────────────────────────────────────────────
try:
    from PIL import Image, ExifTags
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import numpy as np
    NP_AVAILABLE = True
except ImportError:
    NP_AVAILABLE = False

try:
    from transformers import pipeline as hf_pipeline
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False


# ── Color helpers ────────────────────────────────────────────────────────────

def _color_name(r: int, g: int, b: int) -> str:
    rf, gf, bf = r / 255, g / 255, b / 255
    mx = max(rf, gf, bf)
    mn = min(rf, gf, bf)
    saturation = (mx - mn) / (mx + 1e-10)
    brightness = mx
    if brightness < 0.15:
        return "Black"
    if brightness > 0.88 and saturation < 0.12:
        return "White"
    if saturation < 0.12:
        return "Dark Gray" if brightness < 0.4 else "Gray"
    if mx == rf:
        h = (gf - bf) / (mx - mn + 1e-10) % 6
    elif mx == gf:
        h = (bf - rf) / (mx - mn + 1e-10) + 2
    else:
        h = (rf - gf) / (mx - mn + 1e-10) + 4
    h = h * 60
    if h < 15 or h >= 345: return "Red"
    if h < 45:  return "Orange"
    if h < 75:  return "Yellow"
    if h < 150: return "Green"
    if h < 195: return "Cyan"
    if h < 255: return "Blue"
    if h < 285: return "Indigo"
    if h < 315: return "Purple"
    return "Pink"


def _dominant_colors(img, n: int = 5) -> list[dict]:
    if not NP_AVAILABLE:
        return []
    try:
        small = img.convert("RGB").resize((80, 80))
        pixels = np.array(small).reshape(-1, 3)
        buckets: dict[tuple, int] = {}
        for px in pixels:
            key = (int(px[0] // 32) * 32, int(px[1] // 32) * 32, int(px[2] // 32) * 32)
            buckets[key] = buckets.get(key, 0) + 1
        top = sorted(buckets.items(), key=lambda x: -x[1])[:n]
        total = sum(cnt for _, cnt in top)
        return [
            {
                "hex": "#{:02x}{:02x}{:02x}".format(*rgb),
                "name": _color_name(*rgb),
                "percentage": round(cnt / max(total, 1) * 100, 1),
            }
            for rgb, cnt in top
        ]
    except Exception:
        return []


def _aspect_ratio_label(w: int, h: int) -> str:
    if h == 0:
        return "Unknown"
    r = w / h
    if r > 2.0:   return "Ultrawide"
    if r > 1.5:   return "Widescreen 16:9"
    if r > 1.2:   return "Landscape"
    if r > 0.95:  return "Square"
    if r > 0.65:  return "Portrait"
    return "Tall"


def _extract_gps(raw_exif: dict | None) -> dict | None:
    if not raw_exif:
        return None
    try:
        GPS_TAG = 34853
        gps_info = raw_exif.get(GPS_TAG)
        if not gps_info:
            return None
        def to_deg(vals):
            d, m, s = vals
            return float(d) + float(m) / 60 + float(s) / 3600
        lat = to_deg(gps_info.get(2, (0, 0, 0)))
        lon = to_deg(gps_info.get(4, (0, 0, 0)))
        if gps_info.get(1, "N") == "S": lat = -lat
        if gps_info.get(3, "E") == "W": lon = -lon
        return {"lat": round(lat, 5), "lon": round(lon, 5)}
    except Exception:
        return None


# ── Image content categories ─────────────────────────────────────────────────

IMAGE_CATEGORIES = [
    "portrait of a person or face",
    "nature or landscape or outdoor scenery",
    "building or architecture or city",
    "animal or wildlife",
    "art or illustration or digital painting",
    "food or drink or cuisine",
    "vehicle or transportation",
    "text or document or screenshot",
    "product or consumer item",
    "sports or physical activity",
    "medical or scientific image",
    "abstract or pattern or texture",
    "group of people or crowd event",
    "interior space or room",
]


# ── ImageEnricher ────────────────────────────────────────────────────────────

class ImageEnricher:
    """Extracts rich metadata and content description from image bytes."""

    def __init__(self, image_analyzer=None):
        self._analyzer = image_analyzer

    async def enrich(self, image_bytes: bytes, image_url: str = "") -> dict:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._enrich_sync, image_bytes, image_url)

    def _enrich_sync(self, image_bytes: bytes, image_url: str) -> dict:
        result: dict = {
            "description": "",
            "content_category": "Unknown",
            "content_categories": [],
            "exif": {},
            "camera": {},
            "location": None,
            "dimensions": {},
            "colors": [],
            "brightness": None,
            "technical": {},
        }

        if not PIL_AVAILABLE or not image_bytes:
            result["description"] = "Image enrichment unavailable (Pillow not installed)"
            return result

        try:
            img = Image.open(io.BytesIO(image_bytes))
            w, h = img.size
            fmt = img.format or "Unknown"
            file_size_kb = round(len(image_bytes) / 1024, 1)

            result["dimensions"] = {
                "width": w,
                "height": h,
                "megapixels": round(w * h / 1_000_000, 2),
                "aspect_ratio": _aspect_ratio_label(w, h),
                "format": fmt,
                "color_mode": img.mode,
                "file_size_kb": file_size_kb,
            }

            # ── EXIF ──────────────────────────────────────────────────────────
            raw_exif = None
            exif_data: dict = {}
            try:
                raw_exif = img._getexif() if hasattr(img, "_getexif") else None
                if raw_exif:
                    for tag_id, val in raw_exif.items():
                        tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
                        if isinstance(val, (str, int, float)):
                            exif_data[tag_name] = val
                        elif isinstance(val, tuple) and len(val) == 2:
                            try:
                                exif_data[tag_name] = round(float(val[0]) / float(val[1]), 4)
                            except Exception:
                                pass
            except Exception:
                pass

            camera_make  = str(exif_data.get("Make",  "")).strip()
            camera_model = str(exif_data.get("Model", "")).strip()
            software     = str(exif_data.get("Software", "")).strip()
            datetime_str = (exif_data.get("DateTimeOriginal") or exif_data.get("DateTime", ""))
            iso          = exif_data.get("ISOSpeedRatings")
            focal        = exif_data.get("FocalLength")
            exposure     = exif_data.get("ExposureTime")

            if camera_make or camera_model:
                result["camera"] = {
                    "make":              camera_make or None,
                    "model":             camera_model or None,
                    "software":          software or None,
                    "datetime":          str(datetime_str) if datetime_str else None,
                    "iso":               iso,
                    "focal_length_mm":   round(focal, 1) if focal else None,
                    "exposure_seconds":  round(float(exposure), 6) if exposure else None,
                }

            result["exif"]["has_exif"]  = bool(camera_make or camera_model or datetime_str)
            result["exif"]["datetime"]  = str(datetime_str) if datetime_str else None
            if software:
                result["exif"]["software"] = software

            # Flag AI-generator software in EXIF
            ai_sw_keywords = [
                "stable diffusion", "midjourney", "dall-e", "dalle", "firefly",
                "imagen", "comfyui", "automatic1111", "novelai", "invoke ai",
                "dream studio", "adobe firefly",
            ]
            if any(kw in software.lower() for kw in ai_sw_keywords):
                result["technical"]["ai_software_in_exif"] = software

            # GPS
            gps = _extract_gps(raw_exif)
            if gps:
                result["location"] = gps

            # ── Colors ────────────────────────────────────────────────────────
            result["colors"] = _dominant_colors(img)

            # ── Brightness ────────────────────────────────────────────────────
            if NP_AVAILABLE:
                try:
                    arr = np.array(img.convert("L"), dtype=np.float32)
                    brightness = float(np.mean(arr))
                    result["brightness"] = round(brightness, 1)
                    result["technical"]["brightness_label"] = (
                        "Dark" if brightness < 64 else
                        "Low light" if brightness < 100 else
                        "Normal" if brightness < 190 else
                        "Bright" if brightness < 230 else
                        "Overexposed"
                    )
                except Exception:
                    pass

            # ── Content classification ─────────────────────────────────────────
            categories = self._classify_content(img)
            result["content_category"]   = categories[0]["label"] if categories else "Unknown"
            result["content_categories"] = categories[:3]

            # ── Build description ──────────────────────────────────────────────
            result["description"] = self._build_description(result)

        except Exception as e:
            logger.error(f"[enrichment] Image enrichment error: {e}")
            result["description"] = "Enrichment analysis failed"

        return result

    def _classify_content(self, img) -> list[dict]:
        """Try CLIP classification, fall back to color heuristics."""
        if self._analyzer is not None:
            try:
                clip_model      = getattr(self._analyzer, "_ufd_model", None)
                clip_preprocess = getattr(self._analyzer, "_ufd_preprocess", None)
                if clip_model is not None and clip_preprocess is not None:
                    import clip  # type: ignore
                    import torch
                    with torch.no_grad():
                        img_tensor = clip_preprocess(img).unsqueeze(0)
                        img_feat   = clip_model.encode_image(img_tensor)
                        img_feat   = img_feat / img_feat.norm(dim=-1, keepdim=True)
                        text_tok   = clip.tokenize(IMAGE_CATEGORIES)
                        text_feat  = clip_model.encode_text(text_tok)
                        text_feat  = text_feat / text_feat.norm(dim=-1, keepdim=True)
                        sims       = (img_feat @ text_feat.T).squeeze(0).cpu().numpy()
                        top_idx    = sims.argsort()[::-1][:3]
                        return [
                            {"label": IMAGE_CATEGORIES[i].title(), "score": round(float(sims[i]), 3)}
                            for i in top_idx
                        ]
            except Exception as e:
                logger.debug(f"[enrichment] CLIP classify failed: {e}")
        return self._heuristic_classify(img)

    def _heuristic_classify(self, img) -> list[dict]:
        if not NP_AVAILABLE:
            return [{"label": "Image", "score": 1.0}]
        try:
            arr  = np.array(img.convert("RGB").resize((50, 50)))
            mr   = float(np.mean(arr[:, :, 0]))
            mg   = float(np.mean(arr[:, :, 1]))
            mb   = float(np.mean(arr[:, :, 2]))
            w, h = img.size
            ratio = w / max(h, 1)
            if mb > mr * 1.2 and mb > mg:
                cat = "Nature Or Outdoor Scenery" if mg > 80 else "Sky Or Water Scene"
            elif mg > mr * 1.15 and mg > mb:
                cat = "Nature Or Vegetation"
            elif mr > 170 and mg > 150 and mb > 140 and ratio < 0.9:
                cat = "Portrait Or Person"
            elif ratio > 1.6:
                cat = "Landscape Or Panoramic"
            elif ratio < 0.7:
                cat = "Portrait Or Vertical"
            else:
                cat = "General Scene Or Object"
            return [{"label": cat, "score": 0.6}]
        except Exception:
            return [{"label": "Image", "score": 1.0}]

    def _build_description(self, meta: dict) -> str:
        parts = []
        dim = meta.get("dimensions", {})
        cam = meta.get("camera", {})
        cat = meta.get("content_category", "Image")
        parts.append(cat)
        if dim.get("width"):
            parts.append(f"{dim['width']}×{dim['height']}px · {dim.get('megapixels','?')} MP · {dim.get('format','?')}")
        bright = meta.get("technical", {}).get("brightness_label", "")
        if bright:
            parts.append(bright)
        colors = meta.get("colors", [])
        if colors:
            parts.append("Dominant colors: " + ", ".join(c["name"] for c in colors[:3]))
        if cam.get("make") or cam.get("model"):
            cam_str = f"{cam.get('make', '')} {cam.get('model', '')}".strip()
            entry = f"Shot on {cam_str}"
            if cam.get("datetime"):
                entry += f" ({cam['datetime']})"
            parts.append(entry)
        ai_sw = meta.get("technical", {}).get("ai_software_in_exif", "")
        if ai_sw:
            parts.append(f"⚠ AI generator software in EXIF: {ai_sw}")
        loc = meta.get("location")
        if loc:
            parts.append(f"GPS: {loc['lat']}°, {loc['lon']}°")
        return " · ".join(parts) if parts else "Image file"


# ── VideoEnricher ────────────────────────────────────────────────────────────

class VideoEnricher:
    """Extracts video metadata, scene description, and content summarization."""

    async def enrich(self, video_url: str, frame_scores: list[float] | None = None,
                     frames_analysed: int = 0) -> dict:
        loop = asyncio.get_event_loop()
        metadata = await loop.run_in_executor(None, self._get_metadata_sync, video_url)
        scene    = self._analyze_frames(frame_scores or [], frames_analysed, metadata)

        # Transcript + summarization (async — network call)
        transcript_data = await self._get_transcript(video_url, metadata.get("video_id"))
        summarization   = self._build_summary(transcript_data, metadata)

        return {**metadata, **scene, **transcript_data, **summarization}

    # ── Transcript fetching ────────────────────────────────────────────────

    async def _get_transcript(self, url: str, video_id: str | None) -> dict:
        """
        Try three methods in order:
          1. youtube-transcript-api  (YouTube only, instant, no audio download)
          2. yt-dlp subtitle/auto-subtitle extraction
          3. Report unavailable
        """
        result: dict = {
            "transcript":      None,
            "transcript_lang": None,
            "transcript_note": None,
            "transcript_src":  None,
        }

        # Method 1: youtube-transcript-api (preferred for YouTube)
        if video_id:
            try:
                from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore
                entries = YouTubeTranscriptApi.get_transcript(
                    video_id,
                    languages=["en", "en-US", "en-GB", "a.en"],   # prefer English
                )
                text = " ".join(e["text"].strip() for e in entries if e.get("text"))
                text = re.sub(r"\s+", " ", text).strip()
                if text:
                    result["transcript"]      = text
                    result["transcript_lang"] = "en (captions)"
                    result["transcript_src"]  = "YouTube captions"
                    return result
            except ImportError:
                result["transcript_note"] = "youtube-transcript-api not installed (pip install youtube-transcript-api)"
            except Exception as e:
                err = str(e)
                if "No transcript" in err or "Transcript" in err:
                    result["transcript_note"] = "No captions available for this video"
                else:
                    logger.debug(f"[enrichment] YT transcript error: {e}")

        # Method 2: yt-dlp subtitle download (works for more platforms)
        if result["transcript"] is None:
            loop = asyncio.get_event_loop()
            sub_result = await loop.run_in_executor(None, self._ytdlp_subtitle_sync, url)
            if sub_result:
                result["transcript"]      = sub_result["text"]
                result["transcript_lang"] = sub_result["lang"]
                result["transcript_src"]  = "yt-dlp subtitles"
                return result

        if result["transcript"] is None and result["transcript_note"] is None:
            result["transcript_note"] = "No transcript or captions found for this video"

        return result

    def _ytdlp_subtitle_sync(self, url: str) -> dict | None:
        """Download and parse subtitles/auto-subtitles with yt-dlp."""
        import tempfile, os, json, glob
        try:
            import yt_dlp  # type: ignore
            with tempfile.TemporaryDirectory() as tmpdir:
                ydl_opts = {
                    "quiet":          True,
                    "no_warnings":    True,
                    "skip_download":  True,
                    "writesubtitles": True,
                    "writeautomaticsub": True,
                    "subtitleslangs": ["en", "en-US"],
                    "subtitlesformat": "json3",
                    "outtmpl":        os.path.join(tmpdir, "sub"),
                    **_ytdlp_cookie_opts(),
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])

                # Find downloaded subtitle file
                sub_files = glob.glob(os.path.join(tmpdir, "*.json3"))
                if not sub_files:
                    sub_files = glob.glob(os.path.join(tmpdir, "*.vtt"))

                if not sub_files:
                    return None

                sub_file = sub_files[0]
                lang = os.path.basename(sub_file).split(".")[-2] if "." in sub_file else "unknown"

                # Parse json3 format
                if sub_file.endswith(".json3"):
                    with open(sub_file, encoding="utf-8") as f:
                        data = json.load(f)
                    parts = []
                    for event in data.get("events", []):
                        for seg in event.get("segs", []):
                            t = seg.get("utf8", "").strip()
                            if t and t != "\n":
                                parts.append(t)
                    text = re.sub(r"\s+", " ", " ".join(parts)).strip()
                else:
                    # Basic VTT parse
                    with open(sub_file, encoding="utf-8") as f:
                        raw = f.read()
                    lines = [l.strip() for l in raw.splitlines()
                             if l.strip() and not l.startswith("WEBVTT")
                             and "-->" not in l and not l.isdigit()]
                    text = re.sub(r"<[^>]+>", "", " ".join(lines)).strip()

                if text and len(text) > 50:
                    return {"text": text, "lang": lang}
        except Exception as e:
            logger.debug(f"[enrichment] yt-dlp subtitle error: {e}")
        return None

    # ── Extractive summarization ───────────────────────────────────────────

    def _build_summary(self, transcript_data: dict, metadata: dict) -> dict:
        """
        Build a content summary from:
          1. Transcript (extractive TF-IDF summary) if available
          2. Video description fallback
        """
        transcript = transcript_data.get("transcript")
        result: dict = {
            "content_summary":    None,
            "summary_method":     None,
            "key_topics":         [],
            "summary_word_count": None,
        }

        if transcript and len(transcript.split()) >= 30:
            summary = _extractive_summarize(transcript, n_sentences=5)
            result["content_summary"]    = summary
            result["summary_method"]     = "Extractive (TF-IDF) from transcript"
            result["summary_word_count"] = len(transcript.split())
            result["key_topics"]         = _extract_topics(transcript)
        elif metadata.get("description_snippet"):
            result["content_summary"]  = metadata["description_snippet"]
            result["summary_method"]   = "Video description"
            result["key_topics"]       = _extract_topics(metadata.get("description_snippet", ""))
        elif metadata.get("title"):
            result["content_summary"] = f'"{metadata["title"]}" — no transcript or description available.'
            result["summary_method"]  = "Title only"

        return result

    def _get_metadata_sync(self, url: str) -> dict:
        meta: dict = {
            "title": None,
            "channel": None,
            "description_snippet": None,
            "duration_seconds": None,
            "resolution": None,
            "fps": None,
            "view_count": None,
            "upload_date": None,
            "like_count": None,
            "tags": [],
            "platform": _detect_platform(url),
            "video_id": _extract_video_id(url),
            "yt_dlp_note": None,
        }
        try:
            import yt_dlp  # type: ignore
            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                **_ytdlp_cookie_opts(),
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False) or {}
                meta["title"]    = info.get("title")
                meta["channel"]  = info.get("uploader") or info.get("channel")
                desc = info.get("description") or ""
                meta["description_snippet"] = (desc[:300] + "…") if len(desc) > 300 else desc
                meta["duration_seconds"] = info.get("duration")
                meta["fps"]              = info.get("fps")
                meta["view_count"]       = info.get("view_count")
                meta["upload_date"]      = info.get("upload_date")
                meta["like_count"]       = info.get("like_count")
                meta["tags"]             = (info.get("tags") or [])[:10]
                h = info.get("height")
                w = info.get("width")
                if h:
                    meta["resolution"] = f"{w}×{h}" if w else f"{h}p"
        except ImportError:
            meta["yt_dlp_note"] = "yt-dlp not installed — pip install yt-dlp for video metadata"
        except Exception as e:
            meta["yt_dlp_note"] = f"Metadata extraction error: {type(e).__name__}: {str(e)[:80]}"
        return meta

    def _analyze_frames(self, frame_scores: list[float], frames_analysed: int, meta: dict) -> dict:
        if not frame_scores:
            return {
                "scene_summary": "Frame analysis data not available.",
                "timeline": [],
                "frame_stats": {},
            }

        HIGH = 0.7
        MED  = 0.4
        high_count  = sum(1 for s in frame_scores if s >= HIGH)
        med_count   = sum(1 for s in frame_scores if MED <= s < HIGH)
        clean_count = sum(1 for s in frame_scores if s < MED)
        mean_score  = sum(frame_scores) / len(frame_scores)
        max_score   = max(frame_scores)

        duration = meta.get("duration_seconds")
        frame_duration = (duration / len(frame_scores)) if duration and len(frame_scores) else None

        # Build timeline (sample every frame, cap at 30 entries)
        step = max(1, len(frame_scores) // 30)
        timeline = []
        for i in range(0, len(frame_scores), step):
            score = frame_scores[i]
            if frame_duration:
                ts = int(i * frame_duration)
                m, s = divmod(ts, 60)
                stamp = f"{m:02d}:{s:02d}"
            else:
                stamp = f"Frame {i + 1}"
            label = (
                "High AI probability" if score >= HIGH else
                "Medium AI probability" if score >= MED else
                "Likely authentic"
            )
            timeline.append({
                "timestamp": stamp,
                "frame_idx": i,
                "score": round(score, 3),
                "label": label,
            })

        # Scene summary
        if mean_score > 0.65:
            summary = f"Video shows consistently high AI-generation signals ({high_count}/{len(frame_scores)} frames flagged HIGH)."
        elif mean_score > 0.4:
            summary = f"Mixed authenticity detected — {high_count} high-risk and {med_count} medium-risk frames out of {len(frame_scores)} analyzed."
        else:
            summary = f"Video appears largely authentic — {clean_count}/{len(frame_scores)} frames show low AI probability."

        # Find peak suspicious region
        if high_count > 0 and frame_duration:
            peak_idx = max(range(len(frame_scores)), key=lambda i: frame_scores[i])
            peak_ts  = int(peak_idx * frame_duration)
            pm, ps   = divmod(peak_ts, 60)
            summary  += f" Highest risk at {pm:02d}:{ps:02d} ({frame_scores[peak_idx]*100:.0f}%)."

        return {
            "scene_summary": summary,
            "timeline": timeline,
            "frame_stats": {
                "total":      len(frame_scores),
                "high_risk":  high_count,
                "medium_risk": med_count,
                "clean":      clean_count,
                "mean_score": round(mean_score, 3),
                "max_score":  round(max_score, 3),
            },
        }


def _extractive_summarize(text: str, n_sentences: int = 5) -> str:
    """
    TF-IDF-based extractive summarization.
    Scores sentences by the sum of their word TF-IDF weights,
    then returns the top N sentences in original order.
    """
    # Split into sentences
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip() and len(s.split()) > 4]
    if len(sentences) <= n_sentences:
        return text[:800] + ("…" if len(text) > 800 else "")

    stopwords = {
        "the","a","an","is","are","was","were","be","been","have","has","had",
        "do","does","did","will","would","could","should","may","might","of",
        "in","on","at","to","for","with","by","from","and","or","but","that",
        "this","these","those","it","its","he","she","they","we","you","i",
        "not","no","as","so","if","also","just","only","more","some","any",
        "about","which","who","what","when","where","how","all","been",
    }

    # Word frequency (TF across whole doc)
    all_words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
    freq: dict[str, int] = {}
    for w in all_words:
        if w not in stopwords:
            freq[w] = freq.get(w, 0) + 1

    # IDF-lite: penalise words appearing in >70% of sentences
    n = len(sentences)
    doc_freq: dict[str, int] = {}
    for sent in sentences:
        words_in = set(re.findall(r"\b[a-zA-Z]{3,}\b", sent.lower()))
        for w in words_in:
            if w not in stopwords:
                doc_freq[w] = doc_freq.get(w, 0) + 1
    import math
    tfidf: dict[str, float] = {
        w: cnt * math.log(n / (doc_freq.get(w, 1) + 1))
        for w, cnt in freq.items()
    }

    # Score sentences
    scores: list[float] = []
    for sent in sentences:
        words_in = re.findall(r"\b[a-zA-Z]{3,}\b", sent.lower())
        if not words_in:
            scores.append(0.0)
            continue
        score = sum(tfidf.get(w, 0) for w in words_in) / len(words_in)
        # Boost first and last sentences (usually topic sentences)
        scores.append(score)
    if scores:
        scores[0]  = scores[0] * 1.3
        scores[-1] = scores[-1] * 1.1

    # Pick top N, restore original order
    top_idx = sorted(sorted(range(len(scores)), key=lambda i: -scores[i])[:n_sentences])
    summary = " ".join(sentences[i] for i in top_idx)
    return summary


def _extract_topics(text: str) -> list[str]:
    """Extract top 5 topic keywords from text via TF-IDF word scores."""
    stopwords = {
        "the","a","an","is","are","was","were","be","been","have","has","had",
        "do","does","did","will","would","could","should","may","might","of",
        "in","on","at","to","for","with","by","from","and","or","but","that",
        "this","these","those","it","its","he","she","they","we","you","i",
        "not","no","as","so","if","also","just","only","more","some","any",
        "about","which","who","what","when","where","how","all","been","very",
        "just","like","get","got","make","one","two","three","can","said",
    }
    words = re.findall(r"\b[a-zA-Z]{4,}\b", text.lower())
    freq: dict[str, int] = {}
    for w in words:
        if w not in stopwords:
            freq[w] = freq.get(w, 0) + 1
    top = sorted(freq.items(), key=lambda x: -x[1])[:5]
    return [w.title() for w, _ in top]


def _detect_platform(url: str) -> str:
    u = url.lower()
    if "youtube.com" in u or "youtu.be" in u: return "YouTube"
    if "vimeo.com" in u:       return "Vimeo"
    if "tiktok.com" in u:      return "TikTok"
    if "twitter.com" in u or "x.com" in u: return "Twitter / X"
    if "instagram.com" in u:   return "Instagram"
    if "facebook.com" in u or "fb.com" in u: return "Facebook"
    return "Direct URL"


def _extract_video_id(url: str) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else None


# ── TextEnricher ─────────────────────────────────────────────────────────────

class TextEnricher:
    """NLP enrichment: named entities, sentiment, topic, writing stats."""

    POS_WORDS = {
        "good", "great", "excellent", "amazing", "wonderful", "fantastic", "outstanding",
        "brilliant", "superb", "positive", "success", "win", "benefit", "improve",
        "increase", "growth", "progress", "hope", "love", "happy", "celebrate",
        "achieve", "gain", "safe", "secure", "trust", "reliable", "effective",
        "innovative", "breakthrough", "solution", "advance", "helpful", "useful",
    }
    NEG_WORDS = {
        "bad", "terrible", "awful", "horrible", "disgusting", "failure", "fail",
        "problem", "crisis", "disaster", "danger", "threat", "risk", "harm",
        "death", "kill", "attack", "violence", "fraud", "corrupt", "scandal",
        "decline", "loss", "worse", "wrong", "false", "fake", "lie", "deceive",
        "illegal", "criminal", "abuse", "victim", "dangerous", "harmful",
        "outrage", "alarming", "shocking", "disturbing", "controversy", "hoax",
    }
    TOPIC_KEYWORDS = {
        "Politics":      {"government", "president", "minister", "parliament", "election",
                          "vote", "party", "policy", "congress", "senate", "campaign"},
        "Technology":    {"ai", "software", "hardware", "internet", "digital", "data",
                          "algorithm", "robot", "machine learning", "tech", "app",
                          "crypto", "blockchain", "neural", "startup"},
        "Science":       {"research", "study", "experiment", "scientist", "discovery",
                          "laboratory", "theory", "evidence", "climate", "biology",
                          "physics", "chemistry", "genome", "quantum"},
        "Health":        {"health", "medical", "hospital", "doctor", "patient", "disease",
                          "virus", "treatment", "drug", "therapy", "symptom",
                          "pandemic", "surgery", "mental health", "vaccine"},
        "Business":      {"company", "market", "stock", "economy", "investment",
                          "revenue", "profit", "billion", "startup", "ceo",
                          "corporate", "finance", "trade", "merger"},
        "Entertainment": {"movie", "film", "music", "celebrity", "actor", "singer",
                          "award", "netflix", "streaming", "album", "concert",
                          "fashion", "game", "entertainment"},
        "Sports":        {"sport", "team", "player", "championship", "league",
                          "tournament", "match", "goal", "score", "coach",
                          "athlete", "olympic", "football", "cricket", "tennis"},
        "World News":    {"war", "conflict", "international", "global", "treaty",
                          "diplomat", "military", "nation", "foreign", "border",
                          "refugee", "sanctions", "ceasefire"},
        "Crime":         {"crime", "criminal", "police", "arrest", "court", "judge",
                          "trial", "prison", "sentence", "victim", "suspect",
                          "murder", "theft", "fraud", "investigation"},
    }

    def enrich(self, text: str, title: str = "", url: str = "") -> dict:
        return {
            "entities":      self._extract_entities(text),
            "sentiment":     self._analyze_sentiment(text),
            "topic":         self._detect_topic(text, title),
            "key_phrases":   self._extract_key_phrases(text),
            "writing_stats": self._writing_stats(text),
            "language_style": self._language_style(text),
            "source_signals": self._source_signals(url),
        }

    def _extract_entities(self, text: str) -> dict:
        sentences = re.split(r"(?<=[.!?])\s+", text)
        name_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b")
        loc_suffixes  = {"City", "County", "State", "Province", "Republic", "Kingdom",
                         "Island", "Ocean", "River", "Mountain", "Street", "Avenue",
                         "Boulevard", "District", "Region"}
        org_keywords  = {"Inc", "Corp", "Ltd", "LLC", "University", "Institute",
                         "Organization", "Association", "Foundation", "Ministry",
                         "Department", "Agency", "Bureau", "Committee", "Commission",
                         "Bank", "Hospital", "School", "College"}
        person_titles = {"Mr", "Mrs", "Ms", "Dr", "Prof", "President", "Minister",
                         "Senator", "General", "Captain", "Director", "CEO"}
        persons, orgs, locations = set(), set(), set()
        for sent in sentences:
            for match in name_pattern.finditer(sent):
                phrase = match.group(1)
                words  = phrase.split()
                if len(words) == 1:
                    continue
                last_w  = words[-1]
                first_w = words[0]
                if last_w in loc_suffixes or first_w in {"North","South","East","West","New","Los","San","Fort"}:
                    locations.add(phrase)
                elif last_w in org_keywords or any(w in org_keywords for w in words):
                    orgs.add(phrase)
                elif first_w in person_titles:
                    persons.add(" ".join(words[1:]))
                elif len(words) == 2:
                    persons.add(phrase)
                else:
                    orgs.add(phrase)
        return {
            "persons":       sorted(persons)[:10],
            "organizations": sorted(orgs)[:10],
            "locations":     sorted(locations)[:10],
            "total_found":   len(persons) + len(orgs) + len(locations),
        }

    def _analyze_sentiment(self, text: str) -> dict:
        words = re.findall(r"\b\w+\b", text.lower())
        pos   = sum(1 for w in words if w in self.POS_WORDS)
        neg   = sum(1 for w in words if w in self.NEG_WORDS)
        score = (pos - neg) / max(pos + neg, 1)
        negations = len(re.findall(r"\b(?:not|no|never|neither)\s+\w+", text.lower()))
        label = (
            "Very Positive" if score > 0.4 else
            "Positive"      if score > 0.1 else
            "Neutral"       if score >= -0.1 else
            "Negative"      if score >= -0.4 else
            "Very Negative"
        )
        return {
            "label":            label,
            "score":            round(score, 3),
            "positive_signals": pos,
            "negative_signals": neg,
            "negation_count":   negations,
        }

    def _detect_topic(self, text: str, title: str = "") -> dict:
        combined  = (text + " " + title).lower()
        words     = set(re.findall(r"\b\w+\b", combined))
        word_list = re.findall(r"\b\w+\b", combined)
        bigrams   = {f"{word_list[i]} {word_list[i+1]}" for i in range(len(word_list)-1)}
        scores    = {}
        for topic, keywords in self.TOPIC_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in words or kw in bigrams)
            if score > 0:
                scores[topic] = score
        if not scores:
            return {"primary": "General", "secondary": None, "scores": {}}
        sorted_t = sorted(scores.items(), key=lambda x: -x[1])
        return {
            "primary":   sorted_t[0][0],
            "secondary": sorted_t[1][0] if len(sorted_t) > 1 else None,
            "scores":    {t: s for t, s in sorted_t[:5]},
        }

    def _extract_key_phrases(self, text: str) -> list[str]:
        stopwords = {
            "the","a","an","is","are","was","were","be","been","have","has","had",
            "do","does","did","will","would","could","should","may","might","of",
            "in","on","at","to","for","with","by","from","and","or","but","that",
            "this","these","those","it","its","he","she","they","we","you","i",
            "not","no","as","so","if","also","just","only","more","some","any",
        }
        words   = [w.lower() for w in re.findall(r"\b[a-zA-Z]{3,}\b", text)]
        filtered = [w for w in words if w not in stopwords]
        freq: dict[str, int] = {}
        for i in range(len(filtered) - 1):
            bg = f"{filtered[i]} {filtered[i+1]}"
            freq[bg] = freq.get(bg, 0) + 1
        top = sorted([(bg, c) for bg, c in freq.items() if c > 1], key=lambda x: -x[1])[:8]
        return [bg for bg, _ in top]

    def _writing_stats(self, text: str) -> dict:
        words      = text.split()
        sentences  = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        wc   = len(words)
        sc   = max(len(sentences), 1)
        asl  = wc / sc
        uniq = len(set(w.lower() for w in words))
        vd   = round(uniq / max(wc, 1), 3)
        syls = sum(_count_syllables(w) for w in words)
        flesch = max(0.0, min(100.0, 206.835 - 1.015 * (wc / sc) - 84.6 * (syls / max(wc, 1))))
        reading_level = (
            "Very Easy" if flesch > 90 else
            "Easy"      if flesch > 70 else
            "Standard"  if flesch > 50 else
            "Difficult" if flesch > 30 else
            "Very Difficult"
        )
        return {
            "word_count":               wc,
            "sentence_count":           sc,
            "paragraph_count":          len(paragraphs),
            "avg_sentence_length":      round(asl, 1),
            "vocab_diversity":          vd,
            "unique_words":             uniq,
            "reading_level":            reading_level,
            "flesch_score":             round(flesch, 1),
            "estimated_read_minutes":   round(wc / 200, 1),
        }

    def _language_style(self, text: str) -> dict:
        tl = text.lower()
        formal_words   = {"therefore","furthermore","however","moreover","consequently",
                          "regarding","pursuant","hereby","aforementioned","notwithstanding",
                          "nevertheless","accordingly","subsequently","therein"}
        informal_words = {"gonna","wanna","gotta","kinda","sorta","yeah","nah",
                          "ok","okay","btw","lol","omg","tbh","imo","asap"}
        words = set(re.findall(r"\b\w+\b", tl))
        fc = len(words & formal_words)
        ic = len(words & informal_words)
        formality = "Formal" if fc > ic * 2 else "Informal" if ic > fc else "Neutral"
        passive   = len(re.findall(r"\b(?:is|are|was|were|been|being)\s+\w+ed\b", tl))
        hedge     = sum(1 for h in {"may","might","could","possibly","perhaps","seemingly","appears to"}
                        if h in tl)
        return {
            "formality":              formality,
            "passive_voice_instances": passive,
            "question_count":         text.count("?"),
            "hedging_language_count": hedge,
            "uses_first_person":      bool(re.search(r"\b(i|we|my|our)\b", tl)),
        }

    def _source_signals(self, url: str) -> dict:
        ul = url.lower()
        trusted     = ["reuters.com","bbc.com","cnn.com","nytimes.com","washingtonpost.com",
                       "theguardian.com","apnews.com","bloomberg.com","wsj.com","ft.com",
                       "nature.com","science.org","nih.gov","who.int","nasa.gov"]
        questionable = ["blogspot.","wordpress.com","wix.com","weebly.com","tumblr.com"]
        is_trusted  = any(d in ul for d in trusted)
        is_quest    = any(d in ul for d in questionable)
        is_gov      = ".gov" in ul
        is_edu      = ".edu" in ul or ".ac." in ul
        dm = re.search(r"https?://(?:www\.)?([^/]+)", url)
        domain = dm.group(1) if dm else url[:40]
        return {
            "domain":          domain,
            "credibility":     "Trusted" if (is_trusted or is_gov or is_edu) else
                               "Questionable" if is_quest else "Unknown",
            "is_government":   is_gov,
            "is_educational":  is_edu,
        }


def _count_syllables(word: str) -> int:
    return max(1, len(re.findall(r"[aeiou]+", word.lower().rstrip("e"))))


# ── AudioEnricher ─────────────────────────────────────────────────────────────

class AudioEnricher:
    """Transcription and audio quality enrichment."""

    _whisper_pipe:   object | None = None
    _whisper_loaded: bool          = False
    _lock:           asyncio.Lock  | None = None

    def __init__(self):
        if AudioEnricher._lock is None:
            AudioEnricher._lock = asyncio.Lock()

    async def enrich(self, audio_url: str, duration_seconds: float = 0,
                     forensic_explanation: list[str] | None = None) -> dict:
        result: dict = {
            "transcript":       None,
            "transcript_note":  None,
            "language":         None,
            "duration_label":   _format_duration(duration_seconds),
            "content_type":     self._guess_content_type(audio_url, forensic_explanation),
            "quality_summary":  self._quality_summary(forensic_explanation),
            "speaker_estimate": self._estimate_speakers(forensic_explanation),
        }

        if duration_seconds > 0 and duration_seconds <= 300:
            data = await self._transcribe(audio_url)
            if data:
                result["transcript"] = data.get("text")
                result["language"]   = data.get("language")
            else:
                result["transcript_note"] = "Transcription unavailable (model or download error)"
        elif duration_seconds > 300:
            result["transcript_note"] = f"Audio too long for auto-transcription ({_format_duration(duration_seconds)})"
        else:
            result["transcript_note"] = "Duration unknown — transcription skipped"

        return result

    async def _transcribe(self, url: str) -> dict | None:
        if not TRANSFORMERS_AVAILABLE or not TORCH_AVAILABLE:
            return None
        try:
            assert AudioEnricher._lock is not None
            async with AudioEnricher._lock:
                if not AudioEnricher._whisper_loaded:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, self._load_whisper_sync)
                    AudioEnricher._whisper_loaded = True
            if AudioEnricher._whisper_pipe is None:
                return None
            import httpx
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url)
                if not resp.is_success:
                    return None
                audio_bytes = resp.content
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self._run_whisper_sync, audio_bytes)
        except Exception as e:
            logger.warning(f"[enrichment] Whisper transcription error: {e}")
            return None

    def _load_whisper_sync(self):
        try:
            dev = "cuda" if (TORCH_AVAILABLE and torch.cuda.is_available()) else "cpu"
            AudioEnricher._whisper_pipe = hf_pipeline(
                "automatic-speech-recognition",
                model="openai/whisper-base",
                device=dev,
            )
            logger.info("[enrichment] Whisper ASR loaded (openai/whisper-base)")
        except Exception as e:
            logger.warning(f"[enrichment] Whisper load failed: {e}")

    def _run_whisper_sync(self, audio_bytes: bytes) -> dict | None:
        if AudioEnricher._whisper_pipe is None:
            return None
        import tempfile, os
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                f.write(audio_bytes)
                tmp = f.name
            result = AudioEnricher._whisper_pipe(tmp, return_timestamps=False)
            text   = (result.get("text") or "").strip()
            return {"text": text} if text else None
        except Exception as e:
            logger.error(f"[enrichment] Whisper inference error: {e}")
            return None
        finally:
            if tmp:
                try: os.unlink(tmp)
                except: pass

    def _guess_content_type(self, url: str, expl: list[str] | None) -> str:
        ul = url.lower()
        if any(k in ul for k in ["podcast","interview","talk","speech"]): return "Podcast or Interview"
        if any(k in ul for k in ["music","song","track","album"]):        return "Music Track"
        if any(k in ul for k in ["news","broadcast","report"]):           return "News or Broadcast"
        if expl:
            joined = " ".join(expl).lower()
            if "tts" in joined or "synthetic" in joined: return "Likely TTS or Synthetic Voice"
        return "Voice or Audio Recording"

    def _quality_summary(self, expl: list[str] | None) -> str:
        if not expl:
            return "Unknown"
        joined = " ".join(expl)
        if "Extremely flat F0" in joined or "flat F0" in joined:
            return "Unnatural — extremely flat pitch (strong TTS indicator)"
        if "Low F0 variance" in joined:
            return "Low pitch variance — may indicate TTS"
        if "Voice identity change" in joined or "voice splice" in joined.lower():
            return "Voice splice or identity change detected"
        if "Within natural speech range" in joined or "Natural F0" in joined:
            return "Natural voice characteristics"
        if "spectral flatness" in joined.lower():
            return "Synthetic-like spectral profile"
        return "Analysis complete"

    def _estimate_speakers(self, expl: list[str] | None) -> str:
        if not expl:
            return "Unknown"
        joined = " ".join(expl).lower()
        if "voice identity change" in joined:
            return "Multiple speakers (voice identity change detected)"
        if "unnaturally consistent" in joined or "too similar" in joined:
            return "Single speaker — unnaturally consistent (TTS)"
        return "Single speaker (estimated)"


def _format_duration(seconds: float) -> str:
    if not seconds:
        return "Unknown"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:  return f"{h}h {m}m {s}s"
    if m:  return f"{m}m {s}s"
    return f"{s}s"


# ── Unified facade ───────────────────────────────────────────────────────────

class MediaEnricher:
    """Single entry-point over all media enrichers."""

    def __init__(self, image_analyzer=None):
        self.image = ImageEnricher(image_analyzer=image_analyzer)
        self.video = VideoEnricher()
        self.text  = TextEnricher()
        self.audio = AudioEnricher()

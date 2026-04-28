"""
backend.ai.video_model – Production video deepfake analyzer.

Two-approach ensemble, inspired by Pranesh-2005/AI-Generated-Video-Detector:

  Approach A — Face-focused HuggingFace ensemble (primary)
  ─────────────────────────────────────────────────────────
  • Face detection:   OpenCV Haar cascade — crops face region before classify
  • Tier 1 visual:   dima806/deepfake_vs_real_image_detection (ViT,    99.3 % acc)
  • Tier 2 visual:   haywoodsloan/ai-image-detector-deploy (SwinV2, 98.1 % acc)
  • Ensemble:        60 % Tier-1 + 40 % Tier-2 per frame

  Approach B — Audio deepfake analysis (complements visual)
  ─────────────────────────────────────────────────────────
  • Extraction:      ffmpeg subprocess → 16 kHz mono WAV
  • ML pipeline:     RealAudioAnalyzer spectral + WavLM analysis (audio_model)
  • Fallback:        heuristic spectral flatness, ZCR, MFCC delta, silence ratio
  • Detects:         TTS / voice-clone synthesis artifacts

  Evidence fusion
  ───────────────
  final = 80 % visual_score + 20 % audio_score
  + temporal consistency penalty (variance, spikes, optical flow)

  Temporal / optical flow
  ───────────────────────
  Optical flow (cv2.calcOpticalFlowFarneback) between consecutive face regions:
  • Natural video:   flow variance HIGH (micro-movements)
  • Deepfake:        flow too smooth (face blended in) OR very high (artifacts)
  Combined with frame-score variance/spike analysis.

  Fallback chain
  ──────────────
  HuggingFace models unavailable  →  image_model proxy (original behavior)
  Face not detected in frame      →  classify full frame
  Audio extraction fails          →  visual-only score
  ffmpeg / librosa not available  →  skip audio
  RealAudioAnalyzer unavailable   →  heuristic audio analysis

Performance
───────────
  Models load in parallel (ThreadPoolExecutor).
  Cached by HuggingFace Hub after first download (~400 MB total).
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import io
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _ytdlp_cookie_args() -> list[str]:
    """Build optional yt-dlp cookie args from env vars."""
    args: list[str] = []
    cookies_path = os.environ.get("ENTITYX_YTDLP_COOKIES_PATH") or os.environ.get("YTDLP_COOKIES_PATH")
    cookies_browser = os.environ.get("ENTITYX_YTDLP_COOKIES_BROWSER") or os.environ.get("YTDLP_COOKIES_BROWSER")
    if cookies_path and os.path.exists(cookies_path):
        args += ["--cookies", cookies_path]
    elif cookies_path:
        logger.warning(f"[video_model] cookies file not found: {cookies_path}")
    if cookies_browser:
        # Example: chrome, edge, firefox, brave
        args += ["--cookies-from-browser", cookies_browser]
    return args

# ── Optional imports ───────────────────────────────────────────────────────────

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    logger.warning("[video_model] opencv-python not installed — frame extraction disabled")

try:
    import numpy as np
    NP_AVAILABLE = True
except ImportError:
    NP_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    from transformers import pipeline as hf_pipeline
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    logger.warning("[video_model] transformers not installed — ML classifiers disabled")

MEDIAPIPE_AVAILABLE = False  # using OpenCV Haar cascade instead (see _load_face_detector)

try:
    import librosa
    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False
    logger.warning("[video_model] librosa not installed — audio analysis disabled")

# Try to import RealAudioAnalyzer for enhanced audio analysis
try:
    from backend.ai.audio_model import RealAudioAnalyzer as _RealAudioAnalyzer
    AUDIO_ANALYZER_AVAILABLE = True
except Exception:
    AUDIO_ANALYZER_AVAILABLE = False
    _RealAudioAnalyzer = None


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class VideoAnalysisResult:
    """Structured result for a single video analysis."""
    fake_probability: float
    risk_level: str          # "LOW" | "MEDIUM" | "HIGH"
    frames_analysed: int
    frame_scores: list[float]
    explanation: list[str] = field(default_factory=list)


# ── Main analyzer ─────────────────────────────────────────────────────────────

class RealVideoAnalyzer:
    """
    Production video deepfake analyzer.

    Visual pipeline  (Approach A — Pranesh-2005 inspired):
        MediaPipe face crop → dima806/deepfake_vs_real_image_detection (primary)
                           → haywoodsloan/ai-image-detector-deploy (secondary)

    Audio pipeline   (Approach B):
        ffmpeg audio extract → RealAudioAnalyzer ML pipeline (spectral + WavLM)
        fallback             → librosa heuristic analysis

    Temporal analysis:
        Frame-score variance, spike detection, range penalty
        + Optical flow (cv2.calcOpticalFlowFarneback) across face regions

    Evidence fusion:
        80 % visual + 20 % audio (when audio available)
        + optical flow penalty

    Falls back to original image_model proxy if HuggingFace models fail.
    """

    # HuggingFace model IDs (both deepfake-specific, verified)
    PRIMARY_MODEL   = "dima806/deepfake_vs_real_image_detection"  # ViT,    99.3 %
    SECONDARY_MODEL = "haywoodsloan/ai-image-detector-deploy"     # SwinV2, 98.1 %

    # Frame extraction
    MAX_FRAMES         = 20   # increased from 16
    FRAME_INTERVAL_SEC = 1.5
    MAX_VIDEO_SIZE_MB  = 150
    DOWNLOAD_TIMEOUT   = 60

    # Scene change detection threshold (absdiff mean)
    SCENE_CHANGE_THRESHOLD = 30.0

    # Optical flow thresholds
    # Natural videos: flow_var > FLOW_VAR_NATURAL_MIN
    # Too-smooth deepfake: flow_var < FLOW_VAR_SMOOTH_MAX
    # Artifact deepfake: flow_var > FLOW_VAR_ARTIFACT_MIN
    FLOW_VAR_SMOOTH_MAX    = 0.5    # below this → suspiciously smooth
    FLOW_VAR_NATURAL_MIN   = 0.5    # above this is expected for natural video
    FLOW_VAR_ARTIFACT_MIN  = 15.0   # above this → artifacts (extreme blending seams)
    FLOW_MAG_SMOOTH_MAX    = 0.8    # mean magnitude below this → nearly frozen face

    # Social media platforms — require yt-dlp, not direct HTTP
    SOCIAL_DOMAINS = (
        "youtube.com", "youtu.be",
        "instagram.com", "instagr.am",
        "facebook.com", "fb.com", "fb.watch",
        "tiktok.com",
        "twitter.com", "x.com",
        "reddit.com", "v.redd.it",
        "twitch.tv",
        "dailymotion.com",
        "vimeo.com",
    )

    # Risk thresholds
    HIGH_THRESHOLD   = 0.65
    MEDIUM_THRESHOLD = 0.42

    # Evidence fusion weights
    W_VISUAL = 0.80
    W_AUDIO  = 0.20

    # Per-frame ensemble weights (primary / secondary)
    W_PRIMARY_FRAME   = 0.60
    W_SECONDARY_FRAME = 0.40

    def __init__(self, image_analyzer=None):
        self._image_analyzer  = image_analyzer
        self._primary_pipe    = None
        self._secondary_pipe  = None
        self._face_detector   = None
        self._models_loaded   = False
        self._http_client: Optional[httpx.AsyncClient] = None
        # Shared RealAudioAnalyzer instance for the video pipeline
        self._audio_analyzer  = None

    # ── Model loading ──────────────────────────────────────────────────────────

    async def _ensure_models_loaded(self):
        if self._models_loaded:
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._load_models_sync)

    def _load_models_sync(self):
        """Load both classifiers + OpenCV Haar cascade face detector in parallel."""
        if not TRANSFORMERS_AVAILABLE or not TORCH_AVAILABLE:
            logger.info("[video_model] ML libraries unavailable — will use image_model fallback")
            self._models_loaded = True
            return

        device_id = 0 if (TORCH_AVAILABLE and torch.cuda.is_available()) else -1

        def load_primary():
            try:
                p = hf_pipeline(
                    "image-classification",
                    model=self.PRIMARY_MODEL,
                    device=device_id,
                )
                logger.info(f"[video_model] Loaded primary: {self.PRIMARY_MODEL}")
                return p
            except Exception as e:
                logger.warning(f"[video_model] Primary model failed: {e}")
                return None

        def load_secondary():
            try:
                p = hf_pipeline(
                    "image-classification",
                    model=self.SECONDARY_MODEL,
                    device=device_id,
                )
                logger.info(f"[video_model] Loaded secondary: {self.SECONDARY_MODEL}")
                return p
            except Exception as e:
                logger.warning(f"[video_model] Secondary model failed: {e}")
                return None

        def load_face_detector():
            if not CV2_AVAILABLE:
                return None
            try:
                import cv2
                cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
                fd = cv2.CascadeClassifier(cascade_path)
                if fd.empty():
                    logger.warning("[video_model] Haar cascade file not found")
                    return None
                logger.info("[video_model] OpenCV Haar cascade face detector ready")
                return fd
            except Exception as e:
                logger.warning(f"[video_model] Face detector init failed: {e}")
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
            f_primary   = ex.submit(load_primary)
            f_secondary = ex.submit(load_secondary)
            f_face      = ex.submit(load_face_detector)
            self._primary_pipe   = f_primary.result()
            self._secondary_pipe = f_secondary.result()
            self._face_detector  = f_face.result()

        self._models_loaded = True

    # ── HTTP helpers ───────────────────────────────────────────────────────────

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.DOWNLOAD_TIMEOUT),
                follow_redirects=True,
                headers={"User-Agent": "EntityX-VideoAnalyzer/1.0"},
            )
        return self._http_client

    def _is_social_url(self, url: str) -> bool:
        """Return True if the URL belongs to a social/streaming platform needing yt-dlp."""
        low = url.lower()
        return any(d in low for d in self.SOCIAL_DOMAINS)

    def _download_with_ytdlp_sync(self, url: str) -> Optional[bytes]:
        """
        Use yt-dlp to download a social media video to a temp file, return bytes.
        Downloads lowest-quality mp4 (enough for frame analysis) capped at 100 MB.
        Tries browser cookies automatically to bypass YouTube 429/auth errors.
        """
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name

            import sys
            base_cmd = [
                sys.executable, "-m", "yt_dlp",
                "--format", "worst[ext=mp4]/worst",
                "--no-playlist",
                "--max-filesize", "80M",
                "--no-warnings",
                "--quiet",
                "--output", tmp_path,
                "--force-overwrites",
                # Use web + iOS player clients — avoids the JS runtime requirement entirely
                "--extractor-args", "youtube:player_client=web,ios",
                "--add-headers", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            ]

            # Attempt matrix: explicit cookies → browser cookies → no cookies
            # Each entry is tried; stop on success or "video unavailable"
            cookie_attempts: list[list[str]] = []
            explicit = _ytdlp_cookie_args()
            if explicit:
                cookie_attempts.append(explicit)
            for browser in ["chrome", "edge", "firefox", "brave"]:
                cookie_attempts.append(["--cookies-from-browser", browser])
            cookie_attempts.append([])  # final: no cookies

            result = None
            for cookie_args in cookie_attempts:
                cmd = base_cmd + cookie_args + [url]
                result = subprocess.run(cmd, capture_output=True, timeout=180)
                if result.returncode == 0:
                    break
                err_text = result.stderr.decode("utf-8", errors="replace")
                if "This video is unavailable" in err_text or "Video unavailable" in err_text:
                    logger.warning("[video_model] yt-dlp: video unavailable")
                    break
                logger.debug(f"[video_model] yt-dlp attempt {cookie_args} failed, trying next")

            if result is None or result.returncode != 0:
                err = (result.stderr.decode("utf-8", errors="replace")[:300] if result else "no result")
                logger.warning(f"[video_model] yt-dlp all attempts failed: {err}")
                return None

            if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
                # yt-dlp may add an extension — try finding the actual file
                base = tmp_path.replace(".mp4", "")
                for ext in [".mp4", ".webm", ".mkv", ".avi", ".mov"]:
                    if os.path.exists(base + ext) and os.path.getsize(base + ext) > 0:
                        tmp_path = base + ext
                        break
                else:
                    logger.warning("[video_model] yt-dlp produced no output file")
                    return None

            with open(tmp_path, "rb") as f:
                data = f.read()
            logger.info(f"[video_model] yt-dlp downloaded {len(data) / 1e6:.1f} MB from {url[:60]}")
            return data

        except subprocess.TimeoutExpired:
            logger.warning("[video_model] yt-dlp timed out")
            return None
        except FileNotFoundError:
            logger.warning("[video_model] yt-dlp not installed — pip install yt-dlp")
            return None
        except Exception as e:
            logger.error(f"[video_model] yt-dlp error: {e}")
            return None
        finally:
            for path in [tmp_path] if tmp_path else []:
                if path and os.path.exists(path):
                    try:
                        os.unlink(path)
                    except Exception:
                        pass

    async def _download_video(self, url: str) -> Optional[bytes]:
        """
        Download video bytes from a URL.
        - Social/streaming platforms (YouTube, Instagram, Facebook, TikTok, etc.)
          → yt-dlp (handles auth, HLS, DASH, age-gates)
        - Direct video file URLs (.mp4, .webm, etc.)
          → plain HTTP GET
        """
        if self._is_social_url(url):
            logger.info(f"[video_model] Social URL — using yt-dlp: {url[:60]}")
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self._download_with_ytdlp_sync, url)

        # Direct file download
        try:
            client = await self._get_client()
            try:
                head = await client.head(url)
                size = int(head.headers.get("content-length", 0))
                if size > self.MAX_VIDEO_SIZE_MB * 1024 * 1024:
                    logger.warning(f"[video_model] Video too large: {size / 1e6:.1f} MB")
                    return None
            except Exception:
                pass

            resp = await client.get(url)
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            video_types  = ["video", "mp4", "webm", "mpeg", "quicktime", "x-msvideo"]
            video_exts   = [".mp4", ".webm", ".avi", ".mov", ".mkv", ".m4v"]
            if not any(t in content_type.lower() for t in video_types):
                if not any(url.lower().endswith(e) for e in video_exts):
                    logger.warning(f"[video_model] Not a video content-type: {content_type}")
                    return None

            return resp.content
        except Exception as e:
            logger.error(f"[video_model] Direct download failed: {e}")
            return None

    # ── Frame extraction (with scene-change detection) ─────────────────────────

    def _extract_frames(self, video_bytes: bytes) -> tuple[list, list]:
        """
        Extract up to MAX_FRAMES frames from the video.

        Strategy:
          1. Sample frames uniformly at FRAME_INTERVAL_SEC intervals.
          2. Detect scene changes via cv2.absdiff() between consecutive raw frames.
          3. Add scene-change frames to the sample (de-duplicated by frame index).
          4. Cap total at MAX_FRAMES=20.

        Returns (pil_frames, numpy_frames) — parallel lists.
        pil_frames:   list[PIL.Image]   for classifier input
        numpy_frames: list[np.ndarray]  (H, W, 3) BGR for optical flow
        """
        if not CV2_AVAILABLE or not PIL_AVAILABLE:
            return [], []

        pil_frames   = []
        numpy_frames = []
        tmp_path     = None

        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(video_bytes)
                tmp_path = tmp.name

            cap = cv2.VideoCapture(tmp_path)
            if not cap.isOpened():
                return [], []

            fps          = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration_sec = total_frames / fps
            interval     = max(1, int(fps * self.FRAME_INTERVAL_SEC))
            n_uniform    = min(self.MAX_FRAMES, max(1, int(duration_sec / self.FRAME_INTERVAL_SEC)))

            # ── Step 1: uniform sampling ──────────────────────────────────────
            uniform_indices = [i * interval for i in range(n_uniform)]
            frame_index_set = set(uniform_indices)

            # ── Step 2: scene-change detection ────────────────────────────────
            if NP_AVAILABLE and total_frames > 1:
                prev_frame = None
                scene_step = max(1, interval // 2)  # check at half the sample interval

                for fi in range(0, min(total_frames, n_uniform * interval * 2), scene_step):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
                    ret, frame = cap.read()
                    if not ret:
                        break
                    small = cv2.resize(frame, (160, 90))
                    if prev_frame is not None:
                        diff  = cv2.absdiff(small, prev_frame)
                        score = float(np.mean(diff))
                        if score > self.SCENE_CHANGE_THRESHOLD:
                            frame_index_set.add(fi)
                    prev_frame = small

            # ── Step 3: cap + sort ────────────────────────────────────────────
            sorted_indices = sorted(frame_index_set)[: self.MAX_FRAMES]

            # ── Step 4: read selected frames ──────────────────────────────────
            for fi in sorted_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
                ret, frame = cap.read()
                if not ret:
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_frames.append(Image.fromarray(rgb))
                numpy_frames.append(frame.copy())  # keep BGR for optical flow

            cap.release()
            logger.info(
                f"[video_model] Extracted {len(pil_frames)} frames "
                f"({duration_sec:.1f}s, {len(frame_index_set) - len(uniform_indices)} scene-change frames added)"
            )

        except Exception as e:
            logger.error(f"[video_model] Frame extraction error: {e}")
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        return pil_frames, numpy_frames

    # ── Face detection (Pranesh-2005 approach: crop face before classifying) ───

    def _crop_face(self, pil_image) -> Optional:
        """
        Detect and crop largest face with 20 % padding using OpenCV Haar cascade.
        Returns cropped PIL.Image or None when no face is found.
        cv2 is already required — no extra deps needed.
        """
        if self._face_detector is None or not NP_AVAILABLE or not CV2_AVAILABLE:
            return None
        try:
            import cv2
            img_np = np.array(pil_image)
            gray   = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
            faces  = self._face_detector.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(60, 60),
            )
            if len(faces) == 0:
                return None

            # Pick the largest face
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            H, W       = img_np.shape[:2]
            pad        = 0.20
            x1 = max(0, int(x - pad * w))
            y1 = max(0, int(y - pad * h))
            x2 = min(W, int(x + (1 + pad) * w))
            y2 = min(H, int(y + (1 + pad) * h))

            if x2 <= x1 or y2 <= y1:
                return None
            return Image.fromarray(img_np[y1:y2, x1:x2])
        except Exception:
            return None

    def _get_face_roi_bgr(self, bgr_frame) -> Optional["np.ndarray"]:
        """
        Detect and return the face region from a BGR numpy frame.
        Returns cropped BGR array, or None if no face detected.
        Used by optical flow analysis (which operates on raw numpy arrays).
        """
        if self._face_detector is None or not NP_AVAILABLE or not CV2_AVAILABLE:
            return None
        try:
            gray  = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2GRAY)
            faces = self._face_detector.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(60, 60),
            )
            if len(faces) == 0:
                return None
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            H, W       = bgr_frame.shape[:2]
            pad        = 0.15
            x1 = max(0, int(x - pad * w))
            y1 = max(0, int(y - pad * h))
            x2 = min(W, int(x + (1 + pad) * w))
            y2 = min(H, int(y + (1 + pad) * h))
            if x2 <= x1 or y2 <= y1:
                return None
            return bgr_frame[y1:y2, x1:x2]
        except Exception:
            return None

    # ── Frame classification ───────────────────────────────────────────────────

    def _classify_frame(self, pil_image) -> Optional[float]:
        """
        Run primary + secondary classifiers on a PIL image.
        Returns fake probability [0, 1] or None on total failure.
        """
        scores = []
        pipes  = [
            (self._primary_pipe,   self.W_PRIMARY_FRAME),
            (self._secondary_pipe, self.W_SECONDARY_FRAME),
        ]
        for pipe, _ in pipes:
            if pipe is None:
                continue
            try:
                result = pipe(pil_image)
                scores.append(self._extract_fake_score(result))
            except Exception:
                pass

        if not scores:
            return None
        if len(scores) == 1:
            return scores[0]
        # Weighted: 60 % primary + 40 % secondary
        return self.W_PRIMARY_FRAME * scores[0] + self.W_SECONDARY_FRAME * scores[1]

    def _extract_fake_score(self, result: list) -> float:
        """Normalise HuggingFace classifier output → fake probability."""
        if not result:
            return 0.5
        item  = result[0]
        label = item.get("label", "").lower()
        score = item.get("score", 0.5)
        # dima806 labels:      "Fake" / "Real"
        # haywoodsloan labels: "ai-generated" / "real"
        if label in ("fake", "ai-generated", "ai", "generated", "deepfake", "machine"):
            return score
        if label in ("real", "human", "original", "authentic"):
            return 1.0 - score
        return score

    # ── Audio analysis (Approach B) ────────────────────────────────────────────

    def _extract_audio_to_wav(self, video_bytes: bytes) -> Optional[str]:
        """
        Write video to a temp file, extract audio to 16 kHz mono WAV via ffmpeg.
        Returns path to WAV file, or None if ffmpeg is unavailable / fails.
        """
        video_tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as vf:
                vf.write(video_bytes)
                video_tmp = vf.name

            audio_tmp = video_tmp.replace(".mp4", "_audio.wav")
            result = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", video_tmp,
                    "-vn", "-acodec", "pcm_s16le",
                    "-ar", "16000", "-ac", "1",
                    audio_tmp,
                ],
                capture_output=True,
                timeout=30,
            )
            if result.returncode == 0 and os.path.exists(audio_tmp):
                return audio_tmp
            return None
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
            logger.debug(f"[video_model] Audio extraction skipped: {e}")
            return None
        finally:
            if video_tmp and os.path.exists(video_tmp):
                try:
                    os.unlink(video_tmp)
                except Exception:
                    pass

    def _analyze_audio_heuristic(self, audio_path: str) -> tuple[float, list[str]]:
        """
        Heuristic audio analysis for TTS / voice-clone deepfake signals using librosa.

        Signal checks:
          1. Spectral flatness variance   — TTS produces unnaturally uniform flatness
          2. Zero-crossing rate variance  — synthetic voices show low ZCR variation
          3. MFCC delta statistics        — over-smooth transitions indicate synthesis
          4. Silence ratio                — TTS systems rarely generate natural pauses

        Returns (fake_probability, explanation_lines).
        """
        if not LIBROSA_AVAILABLE:
            return 0.5, []

        explanations = []
        signals      = []

        try:
            y, sr = librosa.load(audio_path, sr=16000, duration=60.0)
            if len(y) < sr:
                return 0.5, ["Audio too short for deepfake analysis."]

            # 1. Spectral flatness
            flatness     = librosa.feature.spectral_flatness(y=y)[0]
            flatness_std = float(np.std(flatness))
            if flatness_std < 0.002:
                signals.append(0.30)
                explanations.append(
                    f"Uniform spectral flatness (std={flatness_std:.4f}) — "
                    "consistent with TTS synthesis."
                )
            elif flatness_std > 0.05:
                signals.append(-0.10)

            # 2. Zero-crossing rate
            zcr     = librosa.feature.zero_crossing_rate(y)[0]
            zcr_std = float(np.std(zcr))
            if zcr_std < 0.01:
                signals.append(0.20)
                explanations.append(
                    f"Low zero-crossing variance ({zcr_std:.4f}) — "
                    "natural speech shows more variation."
                )

            # 3. MFCC delta
            mfcc           = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
            delta          = librosa.feature.delta(mfcc)
            delta_std_mean = float(np.mean(np.std(delta, axis=1)))
            if delta_std_mean < 1.5:
                signals.append(0.25)
                explanations.append(
                    f"Low MFCC delta variance ({delta_std_mean:.2f}) — "
                    "overly smooth voice transitions (TTS artifact)."
                )

            # 4. Silence ratio
            rms       = librosa.feature.rms(y=y)[0]
            silence_r = float(np.mean(rms < 0.01))
            if silence_r < 0.02:
                signals.append(0.15)
                explanations.append(
                    f"Near-zero silence ({silence_r * 100:.1f}%) — "
                    "TTS systems rarely produce natural pauses."
                )
            elif silence_r > 0.50:
                signals.append(-0.10)

            prob = max(0.05, min(0.95, 0.35 + sum(signals)))
            if not explanations:
                explanations.append(
                    f"Audio heuristics: no strong synthetic speech signals "
                    f"(score {prob * 100:.0f}%)."
                )

        except Exception as e:
            logger.warning(f"[video_model] Heuristic audio analysis error: {e}")
            return 0.5, [f"Audio heuristic analysis failed: {str(e)[:60]}"]
        finally:
            try:
                if os.path.exists(audio_path):
                    os.unlink(audio_path)
            except Exception:
                pass

        return prob, explanations

    def _analyze_audio_ml(self, audio_path: str) -> tuple[float, list[str]]:
        """
        Run audio through RealAudioAnalyzer's internal ML pipeline directly
        (spectral + WavLM analysis), using the loaded audio array.

        This reuses audio_model's spectral/temporal/WavLM analyses on the video
        audio track without needing a URL download.

        Falls back to heuristic if RealAudioAnalyzer is not available.
        """
        if not AUDIO_ANALYZER_AVAILABLE or _RealAudioAnalyzer is None:
            return self._analyze_audio_heuristic(audio_path)
        if not LIBROSA_AVAILABLE or not NP_AVAILABLE:
            return self._analyze_audio_heuristic(audio_path)

        explanations: list[str] = []
        try:
            # Load audio array directly (bypass URL download in RealAudioAnalyzer)
            y, sr = librosa.load(audio_path, sr=16000, mono=True, duration=60.0)
            if len(y) == 0:
                return 0.5, ["Audio array is empty after loading."]

            # Instantiate (or reuse) a RealAudioAnalyzer — no model loading needed
            # for spectral/temporal analysis; WavLM requires models to be loaded.
            if self._audio_analyzer is None:
                self._audio_analyzer = _RealAudioAnalyzer()
                # Attempt to initialise models synchronously; ignore failures gracefully
                try:
                    self._audio_analyzer._load_models_sync()
                except Exception as load_err:
                    logger.debug(f"[video_model] Audio analyzer model load (partial): {load_err}")

            analyzer = self._audio_analyzer

            # Run spectral heuristics
            spectral_score, spectral_exp = analyzer._run_spectral(y, 16000)
            # Run temporal heuristics
            temporal_score, temporal_exp = analyzer._run_temporal(y, 16000)
            # Run WavLM if available
            wavlm_score, wavlm_exp       = analyzer._run_wavlm(y, 16000)

            explanations += spectral_exp + temporal_exp + wavlm_exp

            # Fuse: WavLM available → weight it; otherwise spectral+temporal only
            if analyzer._wavlm_ok and wavlm_score > 0:
                prob = 0.40 * wavlm_score + 0.40 * spectral_score + 0.20 * temporal_score
                explanations.insert(0, "[AUDIO-ML] WavLM + spectral/temporal pipeline on video audio track")
            else:
                prob = 0.70 * spectral_score + 0.30 * temporal_score
                explanations.insert(0, "[AUDIO-ML] Spectral/temporal pipeline on video audio track")

            prob = max(0.0, min(1.0, prob))

        except Exception as e:
            logger.warning(f"[video_model] ML audio analysis error: {e} — falling back to heuristic")
            return self._analyze_audio_heuristic(audio_path)
        finally:
            try:
                if os.path.exists(audio_path):
                    os.unlink(audio_path)
            except Exception:
                pass

        return prob, explanations

    def _analyze_audio(self, audio_path: str) -> tuple[float, list[str]]:
        """
        Dispatch to ML audio analysis (RealAudioAnalyzer internal pipeline),
        falling back to heuristic if unavailable.
        """
        if AUDIO_ANALYZER_AVAILABLE:
            return self._analyze_audio_ml(audio_path)
        return self._analyze_audio_heuristic(audio_path)

    # ── Optical flow temporal consistency ──────────────────────────────────────

    def _analyze_optical_flow(
        self, numpy_frames: list
    ) -> tuple[float, list[str]]:
        """
        Compute dense optical flow (Farneback) between consecutive face regions
        (or full frames if no face detected) to detect temporal inconsistencies.

        Natural videos:
          - Irregular micro-movements → flow variance is meaningfully high
          - Face moves with body, lighting shifts naturally

        Deepfake signals:
          - Too-smooth flow (face region blended in): flow_var < FLOW_VAR_SMOOTH_MAX
          - Very low mean magnitude: face is nearly frozen (blending artefact)
          - Extremely high variance: blending seam flickering (flow_var > FLOW_VAR_ARTIFACT_MIN)

        Returns (penalty [0..0.20], explanation_lines).
        """
        if not CV2_AVAILABLE or not NP_AVAILABLE or len(numpy_frames) < 2:
            return 0.0, []

        flow_magnitudes: list[float] = []
        flow_variances:  list[float] = []

        for i in range(len(numpy_frames) - 1):
            frame_a = numpy_frames[i]
            frame_b = numpy_frames[i + 1]

            try:
                # Prefer face region; fall back to full frame
                roi_a = self._get_face_roi_bgr(frame_a) if self._face_detector is not None else None
                roi_b = self._get_face_roi_bgr(frame_b) if self._face_detector is not None else None

                if roi_a is None or roi_b is None:
                    roi_a, roi_b = frame_a, frame_b

                # Resize to a fixed small size for speed (flow is scale-invariant enough)
                h, w   = 128, 128
                gray_a = cv2.cvtColor(cv2.resize(roi_a, (w, h)), cv2.COLOR_BGR2GRAY)
                gray_b = cv2.cvtColor(cv2.resize(roi_b, (w, h)), cv2.COLOR_BGR2GRAY)

                # Dense optical flow (Farneback)
                flow = cv2.calcOpticalFlowFarneback(
                    gray_a, gray_b,
                    None,
                    pyr_scale=0.5,
                    levels=3,
                    winsize=15,
                    iterations=3,
                    poly_n=5,
                    poly_sigma=1.2,
                    flags=0,
                )

                # Magnitude of each flow vector
                mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                flow_magnitudes.append(float(np.mean(mag)))
                flow_variances.append(float(np.var(mag)))

            except Exception as e:
                logger.debug(f"[video_model] Optical flow pair {i} failed: {e}")
                continue

        if not flow_variances:
            return 0.0, []

        mean_mag = float(np.mean(flow_magnitudes))
        mean_var = float(np.mean(flow_variances))

        explanations: list[str] = []
        penalty = 0.0

        # Signal 1: unnaturally smooth / frozen face region
        if mean_mag < self.FLOW_MAG_SMOOTH_MAX:
            penalty += 0.08
            explanations.append(
                f"[OPT-FLOW] Nearly frozen face region (mean motion={mean_mag:.3f}) — "
                "consistent with face-swap blending."
            )
        elif mean_var < self.FLOW_VAR_SMOOTH_MAX:
            penalty += 0.10
            explanations.append(
                f"[OPT-FLOW] Suspiciously smooth temporal flow (variance={mean_var:.3f}) — "
                "natural faces have irregular micro-movements."
            )

        # Signal 2: extreme variance (blending seam artifacts)
        elif mean_var > self.FLOW_VAR_ARTIFACT_MIN:
            penalty += 0.10
            explanations.append(
                f"[OPT-FLOW] Very high flow variance ({mean_var:.2f}) — "
                "possible blending seam / compression artifacts."
            )

        if not explanations:
            explanations.append(
                f"[OPT-FLOW] Natural temporal motion detected "
                f"(mean mag={mean_mag:.3f}, var={mean_var:.3f})."
            )

        return min(penalty, 0.20), explanations

    # ── Temporal consistency (frame-score variance + optical flow) ─────────────

    def _analyze_temporal_consistency(
        self,
        scores: list[float],
        numpy_frames: Optional[list] = None,
    ) -> tuple[float, list[str]]:
        """
        Detect inconsistent frame-level manipulation.

        Part 1 — frame-score variance / spikes (original):
          - High inter-frame variance (manipulation not applied uniformly)
          - Large score range (some frames untouched, others heavily altered)
          - Localized spikes (blending artifacts at specific timestamps)

        Part 2 — optical flow (new):
          - cv2.calcOpticalFlowFarneback on face regions
          - Penalizes unnaturally smooth OR artifact-heavy flow
        """
        explanations: list[str] = []
        penalty      = 0.0

        # ── Part 1: frame-score checks ────────────────────────────────────────
        if len(scores) >= 2 and NP_AVAILABLE:
            arr  = np.array(scores)
            var  = float(np.var(arr))
            span = float(np.max(arr) - np.min(arr))

            if var > 0.04:
                penalty += 0.10
                explanations.append(
                    f"High frame variance ({var:.3f}) — inconsistent manipulation detected."
                )
            if span > 0.4:
                penalty += 0.10
                explanations.append(
                    f"Large score range ({span:.2f}) — selective per-frame manipulation."
                )
            if len(arr) >= 3:
                for i in range(1, len(arr) - 1):
                    diff = abs(arr[i] - (arr[i - 1] + arr[i + 1]) / 2)
                    if diff > 0.25:
                        penalty += 0.05
                        explanations.append(f"Anomalous spike at frame {i + 1}.")
                        break

        # ── Part 2: optical flow ──────────────────────────────────────────────
        if numpy_frames is not None and len(numpy_frames) >= 2 and CV2_AVAILABLE:
            flow_penalty, flow_exp = self._analyze_optical_flow(numpy_frames)
            penalty      += flow_penalty
            explanations += flow_exp

        # ── Part 3: face-region vs background differential ────────────────────
        # Deepfakes blend a synthetic face onto a real background.
        # The face region often changes LESS between frames than the background
        # (because the face swap is applied uniformly) — detects paste artifacts.
        if numpy_frames is not None and len(numpy_frames) >= 3 and NP_AVAILABLE:
            try:
                face_ratios: list[float] = []
                for i in range(len(numpy_frames) - 1):
                    f1 = numpy_frames[i].astype(np.float32)
                    f2 = numpy_frames[i + 1].astype(np.float32)
                    diff = np.abs(f1 - f2)
                    h, w = diff.shape[:2]
                    # Approximate face/body region: centre 40% of frame height/width
                    fy1, fy2 = int(h * 0.15), int(h * 0.65)
                    fx1, fx2 = int(w * 0.25), int(w * 0.75)
                    face_diff  = float(diff[fy1:fy2, fx1:fx2].mean())
                    full_diff  = float(diff.mean())
                    if full_diff > 0.5:          # skip nearly-static frames
                        face_ratios.append(face_diff / full_diff)

                if len(face_ratios) >= 2:
                    avg_ratio = sum(face_ratios) / len(face_ratios)
                    if avg_ratio < 0.35:
                        penalty += 0.12
                        explanations.append(
                            f"Face region unusually stable vs background "
                            f"(ratio {avg_ratio:.2f}) — consistent with face-swap blending."
                        )
                    elif avg_ratio < 0.52:
                        penalty += 0.05
                        explanations.append(
                            f"Reduced face-region temporal variance (ratio {avg_ratio:.2f}) — "
                            "possible blending artifact."
                        )
            except Exception:
                pass

        return min(penalty, 0.30), explanations  # raised cap 0.25 → 0.30

    # ── CGI / Animation detection ──────────────────────────────────────────────

    def _detect_cgi_animation(
        self, pil_frames: list, faces_found: int
    ) -> tuple[float, Optional[str], list[str]]:
        """
        Detect computer-generated / animated content using per-frame pixel analysis.

        Face-deepfake models (dima806, haywoodsloan) are trained on photorealistic
        face-swap forgeries. They give LOW fake scores to animation/CGI because
        animated frames contain no blending artifacts. This method catches what
        those models miss.

        Signals
        ───────
        1. Gradient flatness ratio — animation has large flat-color regions
           (cell-shaded backgrounds, uniform character fills).
           Natural photos have texture gradients everywhere.
        2. Average color saturation — animation/CGI uses vivid, saturated palettes;
           real footage is naturally more muted.
        3. No face detection — face-deepfake classifiers are calibrated for human
           faces; reliable scores cannot be made for non-face content.

        Returns (boost [0..0.55], risk_override ["HIGH"|"MEDIUM"|None], explanations).
        """
        if not pil_frames or not NP_AVAILABLE or not CV2_AVAILABLE:
            return 0.0, None, []

        import cv2 as _cv2

        signals:     list[float] = []
        explanations: list[str]  = []

        sample = pil_frames[: min(8, len(pil_frames))]
        flat_ratios: list[float] = []
        avg_sats:    list[float] = []

        for frame in sample:
            try:
                small_np = np.array(frame.resize((96, 96)))
                bgr  = _cv2.cvtColor(small_np, _cv2.COLOR_RGB2BGR)
                gray = _cv2.cvtColor(bgr, _cv2.COLOR_BGR2GRAY).astype(np.float32)

                # Gradient flatness: fraction of near-zero-gradient pixels.
                # Animation → many flat-color regions → high flat_ratio.
                # Real photo → texture everywhere → lower flat_ratio.
                gx   = _cv2.Sobel(gray, _cv2.CV_64F, 1, 0, ksize=3)
                gy   = _cv2.Sobel(gray, _cv2.CV_64F, 0, 1, ksize=3)
                gmag = np.sqrt(gx ** 2 + gy ** 2)
                flat_ratios.append(float(np.mean(gmag < 8.0)))

                # Color saturation: high mean saturation = vivid animation palette.
                hsv = _cv2.cvtColor(bgr, _cv2.COLOR_BGR2HSV)
                avg_sats.append(float(np.mean(hsv[:, :, 1])))

            except Exception:
                pass

        # ── Signal 1: flat-gradient ratio ────────────────────────────────────
        if flat_ratios:
            avg_flat = sum(flat_ratios) / len(flat_ratios)
            if avg_flat > 0.62:
                signals.append(0.30)
                explanations.append(
                    f"[CGI] Large flat-color regions ({avg_flat * 100:.0f}% of pixels) — "
                    "strongly consistent with animation/CGI; deepfake model scores unreliable."
                )
            elif avg_flat > 0.50:
                signals.append(0.14)
                explanations.append(
                    f"[CGI] Elevated flat-region ratio ({avg_flat * 100:.0f}%) — possible CGI/animation."
                )

        # ── Signal 2: vivid/saturated color palette ───────────────────────────
        if avg_sats:
            avg_sat = sum(avg_sats) / len(avg_sats)
            if avg_sat > 148:
                signals.append(0.13)
                explanations.append(
                    f"[CGI] High average saturation (μ={avg_sat:.0f}/255) — "
                    "CGI/animation uses more vivid palettes than natural footage."
                )
            elif avg_sat > 110:
                signals.append(0.06)

        # ── Signal 3: no human faces detected ────────────────────────────────
        if faces_found == 0 and len(pil_frames) >= 4:
            signals.append(0.10)
            explanations.append(
                "[CGI] No human faces detected — face-deepfake classifiers are "
                "trained on real human faces and cannot reliably score animation/CGI."
            )

        boost = min(sum(signals), 0.55)

        # Risk override: strong CGI evidence → don't let LOW deepfake score hide it
        risk_override = None
        if boost >= 0.40:
            risk_override = "HIGH"
        elif boost >= 0.22:
            risk_override = "MEDIUM"

        if boost > 0.10:
            explanations.insert(
                0,
                f"[CGI/ANIMATION DETECTED] AI-generated visual characteristics "
                f"detected (+{boost * 100:.0f}% boost, risk override → {risk_override or 'none'})"
            )

        return boost, risk_override, explanations

    # ── Image-model fallback (original behavior) ───────────────────────────────

    def _get_image_analyzer(self):
        if self._image_analyzer is None:
            from backend.ai.image_model import RealDeepfakeAnalyzer
            self._image_analyzer = RealDeepfakeAnalyzer()
        return self._image_analyzer

    async def _image_model_fallback(
        self, frames: list, numpy_frames: list, explanations: list
    ) -> tuple[float, list[str]]:
        """Use image_model proxy on each frame (original Entity-X behavior)."""
        image_analyzer = self._get_image_analyzer()
        frame_scores   = []

        for i, frame in enumerate(frames):
            try:
                buf = io.BytesIO()
                frame.save(buf, format="PNG")
                result = await image_analyzer.analyze(buf.getvalue(), f"frame_{i}")
                frame_scores.append(result.fake_probability)
            except Exception:
                frame_scores.append(0.0)

        if not frame_scores:
            return 0.1, explanations + ["No frames could be analyzed."]

        if NP_AVAILABLE:
            arr  = np.array(frame_scores)
            p75  = float(np.percentile(arr, 75))
            base = float(np.mean(arr) * 0.70 + p75 * 0.30)
        else:
            base = sum(frame_scores) / len(frame_scores)

        temporal_penalty, temporal_exp = self._analyze_temporal_consistency(
            frame_scores, numpy_frames
        )
        explanations.append(
            "[FALLBACK] HuggingFace video models not loaded — using image deepfake model proxy."
        )
        explanations.extend(temporal_exp)
        return min(base + temporal_penalty, 1.0), explanations

    # ── Thumbnail-based fallback for social media URLs ─────────────────────────

    async def _analyze_via_thumbnails(self, url: str) -> Optional["VideoAnalysisResult"]:
        """
        When yt-dlp cannot download a video, fall back to analyzing public
        thumbnail images (works without auth for YouTube).

        Returns VideoAnalysisResult or None if thumbnails unavailable.
        """
        import re as _re

        # ── Extract YouTube video ID ──────────────────────────────────────────
        yt_id = None
        for pattern in [
            r"(?:youtube\.com/watch\?[^#]*v=)([A-Za-z0-9_-]{11})",
            r"(?:youtu\.be/)([A-Za-z0-9_-]{11})",
            r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})",
            r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})",
        ]:
            m = _re.search(pattern, url)
            if m:
                yt_id = m.group(1)
                break

        if not yt_id:
            logger.info("[video_model] thumbnail fallback: not a supported YouTube URL")
            return None

        # ── Fetch oEmbed metadata (title, channel) ────────────────────────────
        metadata: dict = {}
        try:
            client = await self._get_client()
            r = await client.get(
                f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={yt_id}&format=json",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if r.status_code == 200:
                metadata = r.json()
        except Exception as e:
            logger.debug(f"[video_model] oEmbed fetch failed: {e}")

        # ── Download all available thumbnails ─────────────────────────────────
        thumb_urls = [
            f"https://img.youtube.com/vi/{yt_id}/maxresdefault.jpg",
            f"https://img.youtube.com/vi/{yt_id}/sddefault.jpg",
            f"https://img.youtube.com/vi/{yt_id}/hqdefault.jpg",
            f"https://img.youtube.com/vi/{yt_id}/mqdefault.jpg",
            f"https://img.youtube.com/vi/{yt_id}/default.jpg",
        ]

        pil_frames: list = []
        if PIL_AVAILABLE:
            from PIL import Image as _PILImage
            client = await self._get_client()
            for turl in thumb_urls:
                try:
                    r = await client.get(turl, headers={"User-Agent": "Mozilla/5.0"})
                    if r.status_code == 200 and len(r.content) > 2000:
                        img = _PILImage.open(io.BytesIO(r.content)).convert("RGB")
                        w, h = img.size
                        # Skip YouTube's "video not available" placeholder (120x90)
                        if w >= 320 and h >= 180:
                            pil_frames.append(img)
                except Exception:
                    continue
                if len(pil_frames) >= 4:
                    break

        if not pil_frames:
            logger.info("[video_model] thumbnail fallback: no usable thumbnails downloaded")
            return None

        logger.info(f"[video_model] thumbnail fallback: analyzing {len(pil_frames)} thumbnail(s) for {yt_id}")

        # ── Analyze thumbnails with the video-specific HuggingFace models ─────
        explanations: list[str] = []
        if metadata.get("title"):
            explanations.append(f"Video title: \"{metadata['title']}\"")
        if metadata.get("author_name"):
            explanations.append(f"Channel: {metadata['author_name']}")

        frame_scores: list[float] = []
        loop = asyncio.get_event_loop()

        if self._primary_pipe is not None or self._secondary_pipe is not None:
            # Use the real deepfake video classifiers (dima806 ViT + haywoodsloan SwinV2)
            for i, img in enumerate(pil_frames):
                try:
                    score = await loop.run_in_executor(
                        None, lambda im=img: self._classify_frame(im)
                    )
                    if score is not None:
                        frame_scores.append(score)
                        logger.debug(f"[video_model] thumbnail {i}: fake_prob={score:.3f}")
                except Exception as e:
                    logger.debug(f"[video_model] thumbnail classify failed: {e}")

            if frame_scores:
                model_names = []
                if self._primary_pipe is not None:
                    model_names.append("dima806/deepfake_vs_real_image_detection (ViT 99.3%)")
                if self._secondary_pipe is not None:
                    model_names.append("haywoodsloan/ai-image-detector-deploy (SwinV2 98.1%)")
                explanations.append(
                    f"Thumbnail deepfake analysis via {' + '.join(model_names)} — "
                    f"{len(frame_scores)} thumbnail(s) analyzed."
                )

        # Fallback to image model proxy if HF video models weren't loaded
        if not frame_scores:
            explanations.append(
                f"Video download unavailable — analyzing {len(pil_frames)} YouTube thumbnail(s) via image deepfake model."
            )
            fake_prob, explanations = await self._image_model_fallback(pil_frames, [], explanations)
            explanations = [e.replace("[FALLBACK] ", "") for e in explanations]
        else:
            if NP_AVAILABLE:
                import numpy as _np
                arr = _np.array(frame_scores)
                fake_prob = float(_np.mean(arr) * 0.70 + _np.percentile(arr, 75) * 0.30)
            else:
                fake_prob = sum(frame_scores) / len(frame_scores)
            fake_prob = min(fake_prob, 1.0)

        return VideoAnalysisResult(
            fake_probability=round(fake_prob, 4),
            risk_level=self._determine_risk_level(fake_prob),
            frames_analysed=len(pil_frames),
            frame_scores=frame_scores,
            explanation=explanations,
        )

    # ── Public API ─────────────────────────────────────────────────────────────

    async def analyze(self, video_url: str) -> VideoAnalysisResult:
        """
        Analyze a video URL for deepfake / synthetic content.

        Returns VideoAnalysisResult with fake_probability, risk_level,
        frames_analysed, frame_scores, and explanation list.
        """
        await self._ensure_models_loaded()
        explanations = []

        if not CV2_AVAILABLE:
            return VideoAnalysisResult(
                fake_probability=0.0,
                risk_level="LOW",
                frames_analysed=0,
                frame_scores=[],
                explanation=["opencv-python required for video analysis."],
            )

        # Download
        video_bytes = await self._download_video(video_url)
        if video_bytes is None:
            # For social/streaming URLs try thumbnail-based image analysis first
            if self._is_social_url(video_url):
                thumb_result = await self._analyze_via_thumbnails(video_url)
                if thumb_result is not None:
                    return thumb_result
            return self._url_heuristic_result(video_url)

        # Extract frames (returns PIL + numpy arrays)
        frames, numpy_frames = self._extract_frames(video_bytes)
        if not frames:
            return VideoAnalysisResult(
                fake_probability=0.1,
                risk_level="LOW",
                frames_analysed=0,
                frame_scores=[],
                explanation=["Could not extract frames from video."],
            )

        # ── Route: HuggingFace pipeline vs image-model fallback ───────────────
        if not self._primary_pipe:
            final_prob, explanations = await self._image_model_fallback(
                frames, numpy_frames, explanations
            )
            return VideoAnalysisResult(
                fake_probability=round(final_prob, 4),
                risk_level=self._determine_risk_level(final_prob),
                frames_analysed=len(frames),
                frame_scores=[],
                explanation=explanations,
            )

        # ── Approach A: Face-focused visual analysis ──────────────────────────
        loop         = asyncio.get_event_loop()
        frame_scores = []
        faces_found  = 0

        for frame in frames:
            crop      = self._crop_face(frame)
            input_img = crop if crop is not None else frame
            if crop is not None:
                faces_found += 1
            try:
                score = await loop.run_in_executor(
                    None, lambda img=input_img: self._classify_frame(img)
                )
                frame_scores.append(score if score is not None else 0.0)
            except Exception:
                frame_scores.append(0.0)

        models_used = [self.PRIMARY_MODEL.split("/")[-1]]
        if self._secondary_pipe:
            models_used.append(self.SECONDARY_MODEL.split("/")[-1])
        face_info = (
            f"{faces_found}/{len(frames)} frames with face crop"
            if self._face_detector is not None
            else "no face detection"
        )
        explanations.append(
            f"[ML ENSEMBLE] {' + '.join(models_used)} | "
            f"{len(frames)} frames | {face_info}"
        )

        # Aggregate visual score.
        # Old formula used 0.30 * max which caused false positives on real videos
        # (one bad frame inflated the entire score). Use p75 instead — still weights
        # toward suspicious frames but without a single-frame outlier dominating.
        if NP_AVAILABLE and frame_scores:
            arr          = np.array(frame_scores)
            p75          = float(np.percentile(arr, 75))
            visual_score = float(np.mean(arr) * 0.70 + p75 * 0.30)
        else:
            visual_score = sum(frame_scores) / max(len(frame_scores), 1)

        # Temporal consistency: frame-score variance + optical flow
        temporal_penalty, temporal_exp = self._analyze_temporal_consistency(
            frame_scores, numpy_frames
        )
        explanations.extend(temporal_exp)

        # ── CGI / Animation detection ─────────────────────────────────────────
        # Face-deepfake models can't detect animation — we use pixel heuristics
        # to catch CGI/animated content and correct the ML score accordingly.
        cgi_boost, cgi_risk_override, cgi_exp = self._detect_cgi_animation(
            frames, faces_found
        )
        if cgi_boost > 0.10:
            explanations.extend(cgi_exp)
            if cgi_boost >= 0.40:
                # Strong CGI signal — deepfake model score is unreliable,
                # let the CGI score take precedence.
                visual_score = max(visual_score, cgi_boost)
            elif cgi_boost >= 0.15:
                # Moderate signal — blend (CGI 50 % + ML 50 %)
                visual_score = min(0.50 * visual_score + 0.50 * cgi_boost, 1.0)

        # ── Approach B: Audio deepfake analysis ───────────────────────────────
        audio_score = None
        if LIBROSA_AVAILABLE:
            audio_path = await loop.run_in_executor(
                None, lambda: self._extract_audio_to_wav(video_bytes)
            )
            if audio_path:
                audio_score, audio_exp = await loop.run_in_executor(
                    None, lambda p=audio_path: self._analyze_audio(p)
                )
                explanations.extend(audio_exp)

        # ── Evidence fusion ───────────────────────────────────────────────────
        if audio_score is not None:
            fused_visual = self.W_VISUAL * visual_score + self.W_AUDIO * audio_score
            explanations.append(
                f"[FUSION] Visual={visual_score * 100:.1f}% "
                f"Audio={audio_score * 100:.1f}% → "
                f"Combined={fused_visual * 100:.1f}%"
            )
            visual_score = fused_visual

        # Add optical flow penalty on top of fused score
        final_prob = min(visual_score + temporal_penalty, 1.0)

        # High-risk frame summary
        if NP_AVAILABLE and frame_scores:
            high_risk = sum(1 for s in frame_scores if s >= self.HIGH_THRESHOLD)
            if high_risk:
                explanations.append(
                    f"{high_risk}/{len(frames)} frames flagged as high-risk."
                )

        # CGI risk override takes precedence when pixel evidence is strong
        risk_level = cgi_risk_override if cgi_risk_override else self._determine_risk_level(final_prob)
        if risk_level == "HIGH":
            explanations.append(
                f"HIGH probability ({final_prob * 100:.1f}%) of synthetic / manipulated content."
            )
        elif risk_level == "MEDIUM":
            explanations.append(
                f"MODERATE probability ({final_prob * 100:.1f}%) — possible manipulation."
            )
        else:
            explanations.append(
                f"LOW probability ({final_prob * 100:.1f}%) — content appears authentic."
            )

        return VideoAnalysisResult(
            fake_probability=round(final_prob, 4),
            risk_level=risk_level,
            frames_analysed=len(frames),
            frame_scores=[round(s, 4) for s in frame_scores],
            explanation=explanations,
        )

    def _determine_risk_level(self, p: float) -> str:
        if p >= self.HIGH_THRESHOLD:
            return "HIGH"
        if p >= self.MEDIUM_THRESHOLD:
            return "MEDIUM"
        return "LOW"

    def _url_heuristic_result(self, url: str, reason: str = "Could not download video") -> VideoAnalysisResult:
        """Last-resort heuristic when video cannot be downloaded."""
        url_lower  = url.lower()
        risk_score = 0.0
        indicators = []

        for pattern in ["deepfake", "synthetic", "ai-generated"]:
            if pattern in url_lower:
                risk_score += 0.15
                indicators.append(f"Suspicious URL pattern: '{pattern}'")

        # Social platforms are trusted — don't penalise them
        if not self._is_social_url(url):
            trusted_direct = ["vimeo.com", "dailymotion.com"]
            if not any(d in url_lower for d in trusted_direct):
                risk_score += 0.10
                indicators.append("Video source not in a recognised trusted domain.")

        # Explain WHY download failed
        if self._is_social_url(url):
            indicators.append(
                "yt-dlp could not download the video. Possible reasons: private/age-restricted content, "
                "yt-dlp needs updating (pip install -U yt-dlp), or the link has expired."
            )

        risk_score = min(risk_score, 0.5)
        return VideoAnalysisResult(
            fake_probability=round(risk_score, 4),
            risk_level=self._determine_risk_level(risk_score),
            frames_analysed=0,
            frame_scores=[],
            explanation=[reason + " — URL heuristics only."] + indicators,
        )


# ── Mock fallback ─────────────────────────────────────────────────────────────

class MockVideoAnalyzer:
    """
    Stub video analyzer returning fixed placeholder results.
    Used when CV2 is not available or for testing.
    """

    async def analyze(self, video_url: str) -> dict:
        return {
            "fake_probability":  0.0,
            "risk_level":        "LOW",
            "frames_analysed":   0,
            "frame_scores":      [],
            "explanation": [
                "Video deepfake analysis is not yet available in this build.",
                "This result is a placeholder only; no frames were inspected.",
            ],
        }

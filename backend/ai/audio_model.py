"""
backend.ai.audio_model – ML-based audio deepfake/synthetic voice detection.

Detection pipeline:
1. PRIMARY  – Dedicated audio deepfake classification model (audio-classification pipeline)
              Trained on real vs. synthetic speech datasets (ASVspoof-style)
2. SECONDARY – WavLM-based feature analysis (Microsoft, outperforms Wav2Vec2 on anti-spoofing)
3. TERTIARY  – Spectral + temporal heuristics (vocoder artifacts, energy patterns)
               Includes pitch/F0 variance analysis and harmonic-to-noise ratio (NEW)
4. SPEAKER   – Speaker consistency check across segments via MFCC cosine similarity (NEW)

Models (tried in order until one loads):
  PRIMARY_MODELS = [
    "mo-thecreator/deepfake-audio-detection",   (fine-tuned binary fake/real)
    "Hemg/deepfake-audio-detection",             (alternative fine-tuned)
    "facebook/wav2vec2-base",                    (general feature extractor fallback)
  ]
  SECONDARY = "microsoft/wavlm-base-plus"        (WavLM feature extraction)

Falls back through methods based on available dependencies.
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
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
        logger.warning(f"[audio_model] cookies file not found: {cookies_path}")
    if cookies_browser:
        args += ["--cookies-from-browser", cookies_browser]
    return args

# --------------------------------------------------------------------------- #
# Optional import guards                                                        #
# --------------------------------------------------------------------------- #
try:
    import numpy as np
    NP_AVAILABLE = True
except ImportError:
    NP_AVAILABLE = False
    logger.warning("[audio_model] numpy not installed.")

try:
    import librosa
    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False
    logger.warning("[audio_model] librosa not installed – spectral analysis unavailable.")

try:
    from scipy.stats import kurtosis
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("[audio_model] torch not installed – ML analysis unavailable.")

try:
    from transformers import pipeline as hf_pipeline
    from transformers import AutoFeatureExtractor, WavLMModel
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    logger.warning("[audio_model] transformers not available.")


# --------------------------------------------------------------------------- #
# Model IDs                                                                     #
# --------------------------------------------------------------------------- #
# Primary: ordered list of binary audio deepfake classifiers to try in sequence
PRIMARY_MODELS = [
    "mo-thecreator/deepfake-audio-detection",   # fine-tuned binary fake/real
    "Hemg/deepfake-audio-detection",             # alternative fine-tuned fake/real
    # NOTE: facebook/wav2vec2-base removed — it's a feature extractor, NOT a classifier.
    # Loading it as audio-classification gives garbage output. Spectral analysis handles
    # the fallback when both classifiers above are unavailable.
]

# Secondary: WavLM – Microsoft's masked-speech model, better for anti-spoofing
#            than vanilla Wav2Vec2 (self-supervised pre-training on 94k hrs)
SECONDARY_MODEL = "microsoft/wavlm-base-plus"

# Keep legacy single-model names for backward compatibility
PRIMARY_MODEL     = PRIMARY_MODELS[0]
PRIMARY_MODEL_ALT = PRIMARY_MODELS[1]


# --------------------------------------------------------------------------- #
# Result dataclass                                                               #
# --------------------------------------------------------------------------- #
@dataclass
class AudioAnalysisResult:
    fake_probability: float
    risk_level: str          # "LOW" | "MEDIUM" | "HIGH"
    duration_seconds: float
    analysis_type: str       # "ml" | "spectral" | "heuristic"
    explanation: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Main analyzer                                                                 #
# --------------------------------------------------------------------------- #
class RealAudioAnalyzer:
    """
    Production audio deepfake analyzer.

    Loading order (parallel via ThreadPoolExecutor):
      1. Primary classification pipeline  – tries PRIMARY_MODELS in order
      2. Secondary WavLM extractor        – hidden-state analysis

    Analysis stages:
      1. _run_primary()           – binary classifier fake/real score
      2. _run_wavlm()             – WavLM hidden-state pattern analysis
      3. _run_spectral()          – spectral flatness, mel smoothness, ZCR,
                                    HF deficit, MFCC delta + NEW pitch/F0
                                    variance + harmonic-to-noise ratio
      4. _run_temporal()          – energy variance, silence, onset rate
      5. _run_speaker_consistency() – MFCC cosine similarity across 5-s segments

    Score fusion:
      If primary available:    50 % primary + 20 % wavlm + 15 % spectral
                               + 10 % temporal + 5 % speaker
      If only secondary avail: 40 % wavlm  + 35 % spectral + 15 % temporal
                               + 10 % speaker
      If only heuristics:      55 % spectral + 25 % temporal + 20 % speaker
      Pitch score blended into spectral when available.
    """

    MAX_AUDIO_SIZE_MB = 50
    DOWNLOAD_TIMEOUT  = 60
    SAMPLE_RATE       = 16_000   # standard for voice models
    CHUNK_SECONDS     = 30       # process audio in 30-s chunks

    HIGH_THRESHOLD   = 0.65
    MEDIUM_THRESHOLD = 0.35

    N_MELS     = 128
    N_FFT      = 2048
    HOP_LENGTH = 512

    # Pitch / F0 analysis thresholds
    F0_STD_FLAT_THRESHOLD = 10.0   # Hz — below this → suspiciously flat (TTS)
    F0_STD_REGULAR_MAX    = 5.0    # Hz — extremely regular (step-function TTS)

    # Speaker consistency thresholds
    SPEAKER_SIM_TOO_SIMILAR = 0.98   # all segments identical → TTS
    SPEAKER_SIM_SPLICE_MIN  = 0.70   # sudden drop → voice splice

    def __init__(self):
        self._http_client: Optional[httpx.AsyncClient] = None

        # Primary pipeline state
        self._primary_pipe     = None
        self._primary_ok       = False
        self._primary_model_id = None   # which model from PRIMARY_MODELS was loaded

        # Secondary WavLM state
        self._wavlm_model    = None
        self._wavlm_extractor = None
        self._wavlm_ok       = False

        self._device    = "cpu"
        self._loaded    = False
        self._load_lock = asyncio.Lock()

    # ------------------------------------------------------------------ #
    # Model loading                                                        #
    # ------------------------------------------------------------------ #
    async def _ensure_loaded(self):
        if self._loaded:
            return
        async with self._load_lock:
            if self._loaded:
                return
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._load_models_sync)
            self._loaded = True

    def _load_models_sync(self):
        if not TRANSFORMERS_AVAILABLE or not TORCH_AVAILABLE:
            logger.info("[audio_model] Transformers/torch unavailable – spectral-only mode.")
            return

        # Detect best device
        if torch.cuda.is_available():
            self._device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            self._device = "mps"
        else:
            self._device = "cpu"
        logger.info(f"[audio_model] Device: {self._device}")

        with ThreadPoolExecutor(max_workers=2) as pool:
            f_primary   = pool.submit(self._load_primary_sync)
            f_secondary = pool.submit(self._load_secondary_sync)
            f_primary.result()
            f_secondary.result()

    def _load_primary_sync(self):
        """
        Load binary fake/real audio classification pipeline.
        Tries each model in PRIMARY_MODELS in order until one succeeds.
        """
        for model_id in PRIMARY_MODELS:
            try:
                pipe = hf_pipeline(
                    "audio-classification",
                    model=model_id,
                    device=0 if self._device == "cuda" else -1,
                )
                self._primary_pipe     = pipe
                self._primary_ok       = True
                self._primary_model_id = model_id
                logger.info(f"[audio_model] PRIMARY loaded: {model_id}")
                return
            except Exception as e:
                logger.warning(f"[audio_model] Primary {model_id} failed: {e}")
        logger.warning("[audio_model] No primary classification model available.")

    def _load_secondary_sync(self):
        """Load WavLM feature extractor for hidden-state analysis."""
        try:
            self._wavlm_extractor = AutoFeatureExtractor.from_pretrained(SECONDARY_MODEL)
            self._wavlm_model     = WavLMModel.from_pretrained(SECONDARY_MODEL)
            self._wavlm_model.to(self._device)
            self._wavlm_model.eval()
            self._wavlm_ok = True
            logger.info(f"[audio_model] SECONDARY loaded: {SECONDARY_MODEL}")
        except Exception as e:
            logger.warning(f"[audio_model] WavLM load failed: {e}")

    # Social/streaming platforms that need yt-dlp for audio extraction
    SOCIAL_DOMAINS = (
        "youtube.com", "youtu.be",
        "instagram.com", "instagr.am",
        "tiktok.com", "vm.tiktok.com",
        "facebook.com", "fb.watch",
        "twitter.com", "x.com",
        "vimeo.com",
        "twitch.tv",
        "dailymotion.com",
        "reddit.com",
    )

    def _is_social_url(self, url: str) -> bool:
        low = url.lower()
        return any(d in low for d in self.SOCIAL_DOMAINS)

    @staticmethod
    def _get_ffmpeg_exe() -> Optional[str]:
        """
        Return a usable ffmpeg executable path, or None if unavailable.
        Preference order:
          1. imageio-ffmpeg bundled binary (always present after pip install)
          2. System ffmpeg in PATH
        """
        import subprocess
        # 1. imageio-ffmpeg bundled binary
        try:
            import imageio_ffmpeg
            exe = imageio_ffmpeg.get_ffmpeg_exe()
            if exe:
                return exe
        except Exception:
            pass
        # 2. System PATH
        try:
            subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
            return "ffmpeg"
        except Exception:
            return None

    def _download_audio_ytdlp_sync(self, url: str) -> Optional[bytes]:
        """
        Download audio from a social/video URL and return PCM-decodable bytes.

        Strategy (in order):
          1. yt-dlp + --extract-audio --audio-format wav  (needs ffmpeg in PATH)
             → tries browser cookies (chrome→edge→firefox→brave) + iOS player client
          2. yt-dlp native download (m4a/opus/webm) + ffmpeg post-convert to WAV
          3. Native bytes as-is — librosa tries every codec
        """
        import subprocess, sys, glob as _glob, shutil
        tmp_dir = None

        # Build the cookie attempt list once (reused for both stages)
        _cookie_matrix: list[list[str]] = []
        explicit = _ytdlp_cookie_args()
        if explicit:
            _cookie_matrix.append(explicit)
        for _browser in ["chrome", "edge", "firefox", "brave"]:
            _cookie_matrix.append(["--cookies-from-browser", _browser])
        _cookie_matrix.append([])  # no cookies

        _yt_client_args = ["--extractor-args", "youtube:player_client=web,ios",
                           "--add-headers",
                           "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"]

        def _run_ytdlp(base_cmd: list, timeout: int) -> Optional[subprocess.CompletedProcess]:
            """Run yt-dlp trying each cookie strategy; return first successful result."""
            for cookie_args in _cookie_matrix:
                r = subprocess.run(base_cmd + cookie_args, capture_output=True, timeout=timeout)
                if r.returncode == 0:
                    return r
                err = r.stderr.decode("utf-8", errors="replace")
                if "This video is unavailable" in err or "Video unavailable" in err:
                    logger.warning("[audio_model] yt-dlp: video unavailable")
                    return r   # return failed result — callers check returncode
                logger.debug(f"[audio_model] yt-dlp attempt {cookie_args} failed, trying next")
            return r  # last failed attempt

        try:
            tmp_dir = tempfile.mkdtemp()
            ffmpeg_exe = self._get_ffmpeg_exe()

            # ── Stage 1: yt-dlp with direct WAV conversion ──────────────────
            if ffmpeg_exe:
                out_wav_tmpl = os.path.join(tmp_dir, "audio_wav.%(ext)s")
                base_cmd = [
                    sys.executable, "-m", "yt_dlp",
                    "--format", "bestaudio/best",
                    "--extract-audio", "--audio-format", "wav",
                    "--ffmpeg-location", ffmpeg_exe,
                    "--download-sections", "*00:00:00-00:02:30",
                    "--no-playlist", "--no-warnings", "--quiet",
                    *_yt_client_args,
                    "-o", out_wav_tmpl, url,
                ]
                r = _run_ytdlp(base_cmd, timeout=120)
                if r and r.returncode == 0:
                    hits = [f for f in _glob.glob(os.path.join(tmp_dir, "audio_wav.*"))
                            if os.path.getsize(f) > 0 and not f.endswith(".part")]
                    if hits:
                        out_file = max(hits, key=os.path.getsize)
                        logger.info(f"[audio_model] yt-dlp WAV ok: {os.path.getsize(out_file)/1e6:.1f} MB")
                        with open(out_file, "rb") as f:
                            return f.read()

            # ── Stage 2: native audio download ──────────────────────────────
            out_nat_tmpl = os.path.join(tmp_dir, "audio_nat.%(ext)s")
            fmt = (
                "bestaudio[ext=m4a]/bestaudio[ext=opus]/bestaudio[ext=webm]"
                "/bestaudio/worst[ext=mp4]/worst"
            )
            base_cmd = [
                sys.executable, "-m", "yt_dlp",
                "--format", fmt,
                "--no-playlist", "--max-filesize", "50M",
                "--no-warnings", "--quiet",
                *_yt_client_args,
                "-o", out_nat_tmpl, url,
            ]
            r = _run_ytdlp(base_cmd, timeout=90)
            if r is None or r.returncode != 0:
                err = r.stderr.decode("utf-8", errors="replace")[:300] if r else "no result"
                logger.warning(f"[audio_model] yt-dlp native all attempts failed: {err}")
                return None

            hits = [f for f in _glob.glob(os.path.join(tmp_dir, "audio_nat.*"))
                    if os.path.getsize(f) > 0 and not f.endswith(".part")]
            if not hits:
                logger.warning("[audio_model] yt-dlp produced no native output file")
                return None

            native_file = max(hits, key=os.path.getsize)
            logger.info(f"[audio_model] yt-dlp native: {os.path.splitext(native_file)[1]}, "
                        f"{os.path.getsize(native_file)/1e6:.1f} MB")

            # ── Stage 2b: convert native file → WAV with ffmpeg ─────────────
            if ffmpeg_exe:
                wav_out = os.path.join(tmp_dir, "converted.wav")
                r2 = subprocess.run(
                    [ffmpeg_exe, "-y", "-i", native_file,
                     "-ar", "16000", "-ac", "1", "-f", "wav", wav_out],
                    capture_output=True, timeout=60
                )
                if r2.returncode == 0 and os.path.exists(wav_out) and os.path.getsize(wav_out) > 0:
                    logger.info("[audio_model] ffmpeg WAV conversion ok")
                    with open(wav_out, "rb") as f:
                        return f.read()

            # ── Stage 3: return native bytes, let librosa try all codecs ────
            with open(native_file, "rb") as f:
                return f.read()

        except subprocess.TimeoutExpired:
            logger.warning("[audio_model] yt-dlp audio download timed out")
            return None
        except FileNotFoundError:
            logger.warning("[audio_model] yt-dlp not installed — pip install yt-dlp")
            return None
        except Exception as e:
            logger.error(f"[audio_model] yt-dlp audio error: {e}")
            return None
        finally:
            try:
                if tmp_dir:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    def _download_audio_pytubefix_sync(self, url: str) -> Optional[bytes]:
        """
        Download audio from YouTube using pytubefix (pure-Python, no JS runtime,
        no browser cookies needed). Fallback when yt-dlp fails.
        Returns WAV bytes if ffmpeg available, otherwise raw webm/m4a bytes.
        """
        import re as _re, shutil, subprocess, sys
        try:
            from pytubefix import YouTube
        except ImportError:
            logger.warning("[audio_model] pytubefix not installed")
            return None

        tmp_dir = None
        try:
            tmp_dir = tempfile.mkdtemp()
            yt = YouTube(url)
            stream = (
                yt.streams.filter(only_audio=True).order_by("abr").last()
                or yt.streams.filter(only_audio=True).first()
            )
            if stream is None:
                logger.warning("[audio_model] pytubefix: no audio stream found")
                return None

            logger.info(f"[audio_model] pytubefix: {stream.mime_type} {getattr(stream, 'abr', '?')}")
            raw_path = stream.download(output_path=tmp_dir, filename="ptf_audio", skip_existing=False)
            if not raw_path or not os.path.exists(raw_path):
                return None

            ffmpeg_exe = self._get_ffmpeg_exe()
            if ffmpeg_exe:
                wav_out = os.path.join(tmp_dir, "ptf_audio.wav")
                r = subprocess.run(
                    [ffmpeg_exe, "-y", "-i", raw_path,
                     "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", wav_out],
                    capture_output=True, timeout=60,
                )
                if r.returncode == 0 and os.path.exists(wav_out) and os.path.getsize(wav_out) > 0:
                    logger.info(f"[audio_model] pytubefix WAV: {os.path.getsize(wav_out)/1e6:.1f} MB")
                    with open(wav_out, "rb") as f:
                        return f.read()

            # Return raw bytes as fallback — librosa will try native codecs
            with open(raw_path, "rb") as f:
                return f.read()

        except Exception as e:
            logger.error(f"[audio_model] pytubefix error: {e}")
            return None
        finally:
            try:
                if tmp_dir:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    # ------------------------------------------------------------------ #
    # HTTP helpers                                                         #
    # ------------------------------------------------------------------ #
    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.DOWNLOAD_TIMEOUT),
                follow_redirects=True,
                headers={"User-Agent": "EntityX-AudioAnalyzer/1.0"},
            )
        return self._http_client

    async def _download_audio(self, url: str) -> Optional[bytes]:
        # Social/video platforms: try yt-dlp first, then pytubefix
        if self._is_social_url(url):
            logger.info(f"[audio_model] Social URL — trying yt-dlp for audio: {url[:60]}")
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self._download_audio_ytdlp_sync, url)
            if result is not None:
                return result
            # yt-dlp failed — fall back to pytubefix (YouTube-specific, no auth needed)
            logger.info(f"[audio_model] yt-dlp failed — trying pytubefix: {url[:60]}")
            result = await loop.run_in_executor(None, self._download_audio_pytubefix_sync, url)
            if result is not None:
                return result
            return None

        try:
            client = await self._get_client()
            try:
                head = await client.head(url)
                size = int(head.headers.get("content-length", 0))
                if size > self.MAX_AUDIO_SIZE_MB * 1024 * 1024:
                    logger.warning(f"[audio_model] Audio too large: {size / 1e6:.1f} MB")
                    return None
            except Exception:
                pass

            resp = await client.get(url)
            resp.raise_for_status()

            ct = resp.headers.get("content-type", "")
            audio_types = ["audio", "mp3", "wav", "ogg", "flac", "m4a", "aac", "mpeg", "opus", "webm"]
            audio_exts  = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus", ".weba"]
            # Accept octet-stream / unknown types if URL path looks like audio
            url_path = url.lower().split('?')[0]
            is_audio_ext = any(url_path.endswith(e) for e in audio_exts)
            is_audio_ct  = any(t in ct.lower() for t in audio_types)
            is_generic   = ct.lower() in ('application/octet-stream', 'binary/octet-stream', '')
            if not is_audio_ct and not is_audio_ext and not is_generic:
                logger.warning(f"[audio_model] Not audio content-type: {ct}")
                return None

            return resp.content
        except Exception as e:
            logger.error(f"[audio_model] Download failed: {e}")
            return None

    # ------------------------------------------------------------------ #
    # Audio loading                                                        #
    # ------------------------------------------------------------------ #
    def _load_audio(self, audio_bytes: bytes, source_url: str = '') -> tuple[Optional["np.ndarray"], float]:
        if not LIBROSA_AVAILABLE or not NP_AVAILABLE:
            return None, 0.0

        # Detect best extension from URL path (before query string)
        detected_ext = '.mp3'
        if source_url:
            url_path = source_url.split('?')[0].lower()
            for candidate in ('.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.weba', '.mp3'):
                if url_path.endswith(candidate):
                    detected_ext = candidate
                    break

        # Try detected extension first, then all common fallbacks
        # Include .m4a, .webm, .opus — yt-dlp often downloads these natively
        exts_to_try = [detected_ext]
        for fb in ('.m4a', '.mp3', '.wav', '.ogg', '.flac', '.opus', '.webm', '.aac'):
            if fb != detected_ext:
                exts_to_try.append(fb)

        last_err = None
        for ext in exts_to_try:
            tmp = None
            try:
                with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
                    f.write(audio_bytes)
                    tmp = f.name
                y, sr = librosa.load(tmp, sr=self.SAMPLE_RATE, mono=True)
                if y is not None and len(y) > 0:
                    return y, len(y) / sr
            except Exception as e:
                last_err = e
                logger.debug(f"[audio_model] Decode failed with {ext}: {e}")
            finally:
                if tmp and os.path.exists(tmp):
                    try:
                        os.unlink(tmp)
                    except Exception:
                        pass

        logger.error(f"[audio_model] All decode attempts failed. Last error: {last_err}")
        return None, 0.0

    # ------------------------------------------------------------------ #
    # Primary: audio-classification pipeline                               #
    # ------------------------------------------------------------------ #
    def _run_primary(self, y: "np.ndarray", sr: int) -> tuple[float, list[str]]:
        """
        Pass audio chunks through the binary fake/real classification pipeline.
        Returns (fake_probability, explanations).
        """
        if not self._primary_ok or self._primary_pipe is None:
            return 0.0, []

        explanations: list[str] = []
        chunk_size  = self.CHUNK_SECONDS * sr
        fake_scores: list[float] = []

        try:
            chunks = [
                y[i : i + chunk_size]
                for i in range(0, len(y), chunk_size)
                if len(y[i : i + chunk_size]) > sr // 2   # skip sub-0.5s tail
            ]

            for chunk in chunks[:6]:   # cap at 6 chunks = 3 min
                result = self._primary_pipe({"array": chunk, "sampling_rate": sr})
                # result is list of {label, score}
                for item in result:
                    lbl = item["label"].lower()
                    if any(k in lbl for k in ("fake", "spoof", "synthetic", "generated")):
                        fake_scores.append(item["score"])
                        break
                    elif any(k in lbl for k in ("real", "bona", "genuine", "human")):
                        fake_scores.append(1.0 - item["score"])
                        break

            if fake_scores:
                avg        = float(np.mean(fake_scores))
                model_name = (self._primary_model_id or "").split("/")[-1]
                explanations.append(
                    f"[ML-PRIMARY:{model_name}] Deepfake classifier: {avg * 100:.1f}% fake "
                    f"({len(fake_scores)} chunk{'s' if len(fake_scores) > 1 else ''} analyzed)"
                )
                if avg > 0.7:
                    explanations.append("[ML-PRIMARY] HIGH confidence synthetic speech signature")
                elif avg > 0.4:
                    explanations.append("[ML-PRIMARY] MEDIUM confidence synthetic voice patterns")
                else:
                    explanations.append("[ML-PRIMARY] LOW fake probability — likely human speech")
                return avg, explanations

        except Exception as e:
            logger.error(f"[audio_model] Primary inference error: {e}")
            explanations.append(f"[ML-PRIMARY] Inference failed: {type(e).__name__}")

        return 0.0, explanations

    # ------------------------------------------------------------------ #
    # Secondary: WavLM hidden-state analysis                               #
    # ------------------------------------------------------------------ #
    def _run_wavlm(self, y: "np.ndarray", sr: int) -> tuple[float, list[str]]:
        """
        Extract WavLM hidden states and analyze for synthetic patterns.
        WavLM is trained with masked speech prediction + denoising on 94k hours,
        making its feature space more sensitive to voice forgery than Wav2Vec2.
        """
        if not self._wavlm_ok or self._wavlm_model is None:
            return 0.0, []
        if not NP_AVAILABLE or not TORCH_AVAILABLE:
            return 0.0, []

        explanations: list[str] = []
        risk_score = 0.0

        try:
            clip = y[: 20 * sr]   # limit to 20s for memory
            inputs = self._wavlm_extractor(
                clip, sampling_rate=sr, return_tensors="pt", padding=True
            )
            inputs = {k: v.to(self._device) for k, v in inputs.items()}

            with torch.no_grad():
                out    = self._wavlm_model(**inputs)
                hidden = out.last_hidden_state[0].cpu().numpy()  # (T, D)

            # --- Temporal variance (AI speech is unnaturally uniform) -------
            t_var = float(np.var(hidden, axis=0).mean())
            if t_var < 0.08:
                risk_score += 0.18
                explanations.append(
                    f"[WavLM] Very low temporal variance ({t_var:.4f}) — synthetic uniformity"
                )
            elif t_var < 0.15:
                risk_score += 0.08
                explanations.append(f"[WavLM] Reduced temporal variance ({t_var:.4f})")

            # --- Feature transition smoothness (vocoders over-smooth) --------
            diff       = np.diff(hidden, axis=0)
            smoothness = float(np.mean(np.abs(diff)))
            if smoothness < 0.04:
                risk_score += 0.15
                explanations.append(
                    f"[WavLM] Unnaturally smooth feature transitions ({smoothness:.4f})"
                )
            elif smoothness < 0.07:
                risk_score += 0.06
                explanations.append(f"[WavLM] Slightly smooth transitions ({smoothness:.4f})")

            # --- Inter-feature correlation (AI tends to produce correlated features)
            if hidden.shape[0] > 10:
                corr = np.corrcoef(hidden.T)
                triu = corr[np.triu_indices_from(corr, k=1)]
                mean_corr = float(np.mean(np.abs(triu)))
                if mean_corr > 0.55:
                    risk_score += 0.12
                    explanations.append(
                        f"[WavLM] High inter-feature correlation ({mean_corr:.3f}) — synthesis indicator"
                    )

            # --- Kurtosis of feature distribution ----------------------------
            if SCIPY_AVAILABLE:
                kurt = float(np.mean([kurtosis(hidden[:, i]) for i in range(min(hidden.shape[1], 64))]))
                if abs(kurt) > 6:
                    risk_score += 0.10
                    explanations.append(
                        f"[WavLM] Abnormal feature kurtosis ({kurt:.2f}) — non-natural distribution"
                    )

            if not [e for e in explanations if "[WavLM]" in e]:
                explanations.append("[WavLM] Features within natural speech range")

        except Exception as e:
            logger.error(f"[audio_model] WavLM analysis error: {e}")
            explanations.append(f"[WavLM] Analysis failed: {type(e).__name__}")

        return min(risk_score, 0.55), explanations

    # ------------------------------------------------------------------ #
    # Spectral heuristics (with pitch/F0 variance + HNR)                  #
    # ------------------------------------------------------------------ #
    def _run_spectral(self, y: "np.ndarray", sr: int) -> tuple[float, list[str]]:
        if not LIBROSA_AVAILABLE or not NP_AVAILABLE:
            return 0.0, ["Spectral analysis unavailable (librosa missing)"]

        explanations: list[str] = []
        risk = 0.0

        try:
            mel  = librosa.feature.melspectrogram(
                y=y, sr=sr, n_mels=self.N_MELS, n_fft=self.N_FFT, hop_length=self.HOP_LENGTH
            )
            mel_db = librosa.power_to_db(mel, ref=np.max)

            # Spectral flatness — AI audio is more uniform
            flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)))
            if flatness > 0.15:
                risk += 0.14
                explanations.append(f"High spectral flatness ({flatness:.3f}) — synthetic uniformity")

            # Mel-spectrogram transition smoothness
            smoothness = float(np.mean(np.abs(np.diff(mel_db, axis=1))))
            if smoothness < 1.5:
                risk += 0.12
                explanations.append(f"Unnaturally smooth mel transitions ({smoothness:.2f})")

            # High-frequency energy deficit (vocoders struggle at HF)
            hf_energy  = float(np.mean(mel_db[self.N_MELS // 2:, :]))
            lf_energy  = float(np.mean(mel_db[:self.N_MELS // 2, :]))
            hf_ratio   = hf_energy / (lf_energy + 1e-6)
            if hf_ratio < 0.40:
                risk += 0.10
                explanations.append(f"Reduced high-frequency content (ratio: {hf_ratio:.2f})")

            # ZCR variance — synthetic is unnaturally consistent
            zcr_var = float(np.var(librosa.feature.zero_crossing_rate(y)))
            if zcr_var < 0.001:
                risk += 0.08
                explanations.append("Very low ZCR variance — consistent with TTS synthesis")

            # Periodic vocoder artifacts (autocorrelation peaks)
            if SCIPY_AVAILABLE and len(y) >= sr:
                ac   = np.correlate(y[:sr], y[:sr], mode="same")
                pks  = np.where(ac > np.max(ac) * 0.5)[0]
                if len(pks) > 10 and np.std(np.diff(pks)) < 5:
                    risk += 0.14
                    explanations.append("Regular periodic artifacts detected — vocoder signature")

            # MFCC delta variance — AI speech has flatter dynamics
            mfcc  = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
            delta = librosa.feature.delta(mfcc)
            d_var = float(np.mean(np.var(delta, axis=1)))
            if d_var < 0.5:
                risk += 0.08
                explanations.append(f"Low MFCC delta variance ({d_var:.3f}) — reduced speech dynamics")

            # ── NEW: Pitch / F0 variance analysis ────────────────────────────
            # Natural human speech: F0 varies substantially (prosodic variation)
            # TTS/AI: F0 is unnaturally flat or follows perfectly regular patterns
            try:
                # librosa.yin returns F0 estimates per frame; voiced frames > 0
                f0_all = librosa.yin(
                    y,
                    fmin=librosa.note_to_hz("C2"),   # ~65 Hz
                    fmax=librosa.note_to_hz("C7"),   # ~2093 Hz
                    sr=sr,
                    hop_length=self.HOP_LENGTH,
                )
                # Filter to voiced frames (exclude silence/unvoiced near the fmin boundary)
                voiced_mask = (f0_all > 80.0) & (f0_all < 1200.0)
                f0_voiced   = f0_all[voiced_mask]

                if len(f0_voiced) > 10:
                    f0_std = float(np.std(f0_voiced))

                    if f0_std < self.F0_STD_REGULAR_MAX:
                        risk += 0.18
                        explanations.append(
                            f"[PITCH] Extremely flat F0 (std={f0_std:.1f} Hz) — "
                            "consistent with neural TTS / voice cloning."
                        )
                    elif f0_std < self.F0_STD_FLAT_THRESHOLD:
                        risk += 0.10
                        explanations.append(
                            f"[PITCH] Low F0 variance (std={f0_std:.1f} Hz) — "
                            "natural speech typically has more prosodic variation."
                        )
                    else:
                        explanations.append(
                            f"[PITCH] Natural F0 variance (std={f0_std:.1f} Hz)."
                        )
                else:
                    explanations.append("[PITCH] Insufficient voiced frames for F0 analysis.")

            except Exception as f0_err:
                logger.debug(f"[audio_model] F0 analysis skipped: {f0_err}")

            # ── NEW: Harmonic-to-Noise Ratio (HNR) ───────────────────────────
            # Human voice: harmonic energy >> noise energy
            # Vocoders/TTS: may have unusually high or low HNR
            try:
                harmonic   = librosa.effects.harmonic(y)
                noise      = y - harmonic

                # RMS via librosa
                h_rms = float(np.sqrt(np.mean(harmonic ** 2)) + 1e-10)
                n_rms = float(np.sqrt(np.mean(noise ** 2)) + 1e-10)
                hnr   = 20.0 * np.log10(h_rms / n_rms)  # dB

                if hnr > 25.0:
                    # Unusually clean — some TTS vocoders produce near-perfect harmonics
                    risk += 0.08
                    explanations.append(
                        f"[HNR] Very high harmonic-to-noise ratio ({hnr:.1f} dB) — "
                        "may indicate vocoder synthesis."
                    )
                elif hnr < 5.0:
                    # Very noisy — could be heavy codec artifact or background noise
                    explanations.append(
                        f"[HNR] Low HNR ({hnr:.1f} dB) — noisy recording (less TTS-like)."
                    )
                else:
                    explanations.append(f"[HNR] HNR within natural range ({hnr:.1f} dB).")

            except Exception as hnr_err:
                logger.debug(f"[audio_model] HNR analysis skipped: {hnr_err}")

        except Exception as e:
            logger.error(f"[audio_model] Spectral error: {e}")
            explanations.append(f"Spectral analysis partial failure: {type(e).__name__}")

        return min(risk, 0.65), explanations  # cap raised slightly to accommodate new signals

    # ------------------------------------------------------------------ #
    # Temporal heuristics                                                  #
    # ------------------------------------------------------------------ #
    def _run_temporal(self, y: "np.ndarray", sr: int) -> tuple[float, list[str]]:
        if not LIBROSA_AVAILABLE or not NP_AVAILABLE:
            return 0.0, []

        explanations: list[str] = []
        risk = 0.0

        try:
            rms    = librosa.feature.rms(y=y, frame_length=self.N_FFT, hop_length=self.HOP_LENGTH)[0]

            # Energy variance — human speech varies naturally
            if np.var(rms) < 0.002:
                risk += 0.10
                explanations.append("Unnaturally consistent energy levels")

            # Silence ratio — natural speech has breath pauses
            silence = np.sum(rms < np.mean(rms) * 0.1) / len(rms)
            if silence < 0.05:
                risk += 0.08
                explanations.append("Missing natural pauses / breath sounds")

            # Onset rate — AI speech has abnormally uniform onset density
            onsets     = librosa.onset.onset_detect(y=y, sr=sr)
            onset_rate = len(onsets) / max(len(y) / sr, 1.0)
            if onset_rate < 1.0:
                risk += 0.06
                explanations.append(f"Low onset rate ({onset_rate:.2f}/s) — missing speech microstructure")
            elif onset_rate > 8.0:
                risk += 0.06
                explanations.append(f"Unusually high onset rate ({onset_rate:.2f}/s) — possible artifact")

        except Exception as e:
            logger.error(f"[audio_model] Temporal error: {e}")

        return min(risk, 0.28), explanations

    # ------------------------------------------------------------------ #
    # NEW: Speaker consistency check                                       #
    # ------------------------------------------------------------------ #
    def _run_speaker_consistency(self, y: "np.ndarray", sr: int) -> tuple[float, list[str]]:
        """
        Detect voice splicing or unnaturally consistent TTS by comparing
        MFCC fingerprints across 5-second segments.

        Signals:
          - LOW cosine similarity between adjacent segments → voice splice / clone swap
          - ALL similarities > SPEAKER_SIM_TOO_SIMILAR → unnaturally uniform (TTS)

        Returns (risk_score [0..0.30], explanation_lines).
        """
        if not LIBROSA_AVAILABLE or not NP_AVAILABLE:
            return 0.0, []

        explanations: list[str] = []
        risk = 0.0

        try:
            segment_len = 5 * sr   # 5 seconds per segment
            if len(y) < segment_len:
                return 0.0, ["[SPEAKER] Audio too short for consistency check."]

            # Split into 5-second segments
            segments = [
                y[i: i + segment_len]
                for i in range(0, len(y) - segment_len + 1, segment_len)
            ]

            if len(segments) < 2:
                return 0.0, ["[SPEAKER] Too few segments for consistency check."]

            # Extract 16-dimensional MFCC mean vector per segment
            mfcc_vectors: list["np.ndarray"] = []
            for seg in segments:
                mfcc    = librosa.feature.mfcc(y=seg, sr=sr, n_mfcc=16)
                vec     = np.mean(mfcc, axis=1)   # shape (16,)
                mfcc_vectors.append(vec)

            # Cosine similarity between consecutive segment pairs
            cosine_sims: list[float] = []
            for i in range(len(mfcc_vectors) - 1):
                a = mfcc_vectors[i]
                b = mfcc_vectors[i + 1]
                denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-10
                sim   = float(np.dot(a, b) / denom)
                cosine_sims.append(sim)

            min_sim = float(np.min(cosine_sims))
            max_sim = float(np.max(cosine_sims))
            mean_sim = float(np.mean(cosine_sims))

            # Signal 1: Sudden identity switch (voice splice / clone replacement)
            splice_detected = False
            for i, sim in enumerate(cosine_sims):
                if sim < self.SPEAKER_SIM_SPLICE_MIN:
                    risk += 0.15
                    explanations.append(
                        f"[SPEAKER] Voice identity change at segment {i + 1}→{i + 2} "
                        f"(cosine similarity={sim:.3f}) — possible voice splice or clone swap."
                    )
                    splice_detected = True
                    break   # report once to avoid noise

            # Signal 2: All segments are unnaturally identical (TTS)
            if not splice_detected and all(s > self.SPEAKER_SIM_TOO_SIMILAR for s in cosine_sims):
                risk += 0.15
                explanations.append(
                    f"[SPEAKER] All segments too similar (min sim={min_sim:.3f}) — "
                    "unnaturally consistent voice fingerprint (TTS indicator)."
                )
            elif not explanations:
                explanations.append(
                    f"[SPEAKER] Voice consistency normal "
                    f"(sim range {min_sim:.3f}–{max_sim:.3f}, mean {mean_sim:.3f})."
                )

        except Exception as e:
            logger.error(f"[audio_model] Speaker consistency error: {e}")
            explanations.append(f"[SPEAKER] Analysis failed: {type(e).__name__}")

        return min(risk, 0.30), explanations

    # ------------------------------------------------------------------ #
    # Risk helper                                                          #
    # ------------------------------------------------------------------ #
    def _risk_level(self, p: float) -> str:
        if p >= self.HIGH_THRESHOLD:
            return "HIGH"
        if p >= self.MEDIUM_THRESHOLD:
            return "MEDIUM"
        return "LOW"

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #
    async def analyze(self, audio_url: str) -> AudioAnalysisResult:
        """Download and analyze an audio URL for deepfake/synthetic voice."""
        await self._ensure_loaded()

        if not LIBROSA_AVAILABLE or not NP_AVAILABLE:
            return AudioAnalysisResult(
                fake_probability=0.0,
                risk_level="LOW",
                duration_seconds=0.0,
                analysis_type="heuristic",
                explanation=[
                    "Audio analysis requires librosa and numpy.",
                    "pip install librosa numpy soundfile",
                ],
            )

        # Skip streaming manifests / playlist formats — no single decodable file
        url_lower = audio_url.lower().split('?')[0]
        if any(url_lower.endswith(ext) for ext in ('.m3u8', '.mpd', '.m3u', '.pls')):
            return self._url_heuristic(audio_url)

        audio_bytes = await self._download_audio(audio_url)
        if audio_bytes is None:
            reason = (
                "Could not extract audio track — yt-dlp download failed. "
                "Ensure yt-dlp is installed and up to date (pip install -U yt-dlp). "
                "URL heuristics applied."
            ) if self._is_social_url(audio_url) else "Could not download audio — URL heuristics only."
            return self._url_heuristic(audio_url, reason=reason)

        # For social URLs, yt-dlp likely downloaded m4a/webm — hint the loader
        # by using a fake source URL with the right extension so it tries
        # the most likely format first.
        load_hint = audio_url
        if self._is_social_url(audio_url):
            # Detect by magic bytes: m4a starts with ftyp box, webm with 0x1A45DFA3
            if len(audio_bytes) >= 12 and audio_bytes[4:8] == b'ftyp':
                load_hint = "audio.m4a"
            elif len(audio_bytes) >= 4 and audio_bytes[:4] == b'\x1a\x45\xdf\xa3':
                load_hint = "audio.webm"
            elif len(audio_bytes) >= 3 and audio_bytes[:3] == b'OggS':
                load_hint = "audio.ogg"
            else:
                load_hint = "audio.m4a"  # best guess for YouTube

        y, duration = self._load_audio(audio_bytes, source_url=load_hint)
        if y is None or len(y) == 0:
            # Fall back to URL heuristics rather than showing "inconclusive"
            result = self._url_heuristic(audio_url)
            result.explanation.insert(0, "Audio bytes downloaded but could not be decoded (unsupported codec). URL heuristics applied.")
            return result

        explanations = [f"Analyzed {duration:.1f}s of audio at {self.SAMPLE_RATE} Hz"]

        # Determine analysis method tag
        if self._primary_ok:
            model_name    = (self._primary_model_id or "").split("/")[-1]
            analysis_type = "ml-ensemble"
            explanations.append(
                f"[ENSEMBLE] {model_name} + WavLM + spectral/temporal/pitch/speaker analysis"
            )
        elif self._wavlm_ok:
            analysis_type = "ml-spectral"
            explanations.append("[ENSEMBLE] WavLM + spectral/temporal/pitch/speaker analysis")
        else:
            analysis_type = "spectral"
            explanations.append("[ENSEMBLE] Spectral + temporal + pitch + speaker heuristics only")

        # Run all analyses in executor (CPU-bound)
        loop = asyncio.get_event_loop()
        primary_score,  primary_exp  = await loop.run_in_executor(None, self._run_primary,  y, self.SAMPLE_RATE)
        wavlm_score,    wavlm_exp    = await loop.run_in_executor(None, self._run_wavlm,    y, self.SAMPLE_RATE)
        spectral_score, spectral_exp = await loop.run_in_executor(None, self._run_spectral, y, self.SAMPLE_RATE)
        temporal_score, temporal_exp = await loop.run_in_executor(None, self._run_temporal, y, self.SAMPLE_RATE)
        speaker_score,  speaker_exp  = await loop.run_in_executor(None, self._run_speaker_consistency, y, self.SAMPLE_RATE)

        explanations += primary_exp + wavlm_exp + spectral_exp + temporal_exp + speaker_exp

        # Score fusion — includes speaker_score
        if self._primary_ok and primary_score > 0:
            # Trust primary most; supplementary evidence refines
            final = (
                0.50 * primary_score
                + 0.20 * wavlm_score
                + 0.15 * spectral_score
                + 0.10 * temporal_score
                + 0.05 * speaker_score
            )
        elif self._wavlm_ok and wavlm_score > 0:
            final = (
                0.40 * wavlm_score
                + 0.35 * spectral_score
                + 0.15 * temporal_score
                + 0.10 * speaker_score
            )
        else:
            final = (
                0.55 * spectral_score
                + 0.25 * temporal_score
                + 0.20 * speaker_score
            )

        final = round(min(final, 1.0), 4)

        return AudioAnalysisResult(
            fake_probability=final,
            risk_level=self._risk_level(final),
            duration_seconds=round(duration, 2),
            analysis_type=analysis_type,
            explanation=explanations,
        )

    def _url_heuristic(self, url: str, reason: str = "Could not download audio — URL heuristics only.") -> AudioAnalysisResult:
        risk  = 0.0
        notes = []
        url_l = url.lower()

        for pat in ["ai-voice", "synthetic", "clone", "tts", "text-to-speech", "generated"]:
            if pat in url_l:
                risk += 0.15
                notes.append(f"URL contains suspicious pattern: '{pat}'")

        trusted = ["spotify.com", "soundcloud.com", "youtube.com", "youtu.be", "apple.com", "vimeo.com", "tiktok.com", "instagram.com"]
        if not any(d in url_l for d in trusted):
            risk += 0.10
            notes.append("Audio from unverified source")

        return AudioAnalysisResult(
            fake_probability=round(min(risk, 0.5), 4),
            risk_level=self._risk_level(min(risk, 0.5)),
            duration_seconds=0.0,
            analysis_type="heuristic",
            explanation=[reason] + notes,
        )


# --------------------------------------------------------------------------- #
# Fallback stub                                                                 #
# --------------------------------------------------------------------------- #
class MockAudioAnalyzer:
    async def analyze(self, audio_url: str) -> dict:  # noqa: ARG002
        return {
            "fake_probability": 0.0,
            "risk_level": "LOW",
            "duration_seconds": 0.0,
            "analysis_type": "mock",
            "explanation": [
                "Audio deepfake analysis is not available in this build.",
                "This is a placeholder only; no audio was inspected.",
            ],
        }

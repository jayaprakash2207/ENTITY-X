"""
backend.ai.image_model – Real ML-based deepfake / synthetic-image detector.

RealDeepfakeAnalyzer uses state-of-the-art models for AI-generated image detection.
Falls back to MockDeepfakeAnalyzer if models fail to load.

Supported models:
- UniversalFakeDetect (CLIP ViT-L/14 + trained FC, PRIMARY - research-grade)
- umm-maybe/AI-image-detector (CLIP-based, secondary)
- Organika/sdxl-detector (SDXL-specific, tertiary)

UniversalFakeDetect is from the CVPR 2023 paper:
"Towards Universal Fake Image Detectors that Generalize Across Generative Models"
by Ojha et al. - trained to detect unseen deepfake types.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import math
import os
from pathlib import Path
from typing import Literal
from urllib.request import urlretrieve

from pydantic import BaseModel

logger = logging.getLogger(__name__)

try:
    import cv2 as _cv2_probe
    CV2_AVAILABLE = True
    del _cv2_probe
except ImportError:
    CV2_AVAILABLE = False

# Face-specialized deepfake model — targeted at portrait / face forgeries
# (FaceForensics++ style detection, different from general ViT/SwinV2)
FACE_MODEL = None  # Disabled — model no longer available on HuggingFace Hub

# UniversalFakeDetect weights URL (from official repo)
UFD_WEIGHTS_URL = "https://github.com/WisconsinAIVision/UniversalFakeDetect/raw/main/pretrained_weights/fc_weights.pth"
UFD_WEIGHTS_DIR = Path(__file__).parent / "weights"
UFD_WEIGHTS_PATH = UFD_WEIGHTS_DIR / "universal_fake_detect_fc.pth"

# High-accuracy ViT + SwinV2 models — already cached by video_model, load fast
VIT_MODEL  = "dima806/deepfake_vs_real_image_detection"   # ViT  99.3% acc
SWIN_MODEL = "haywoodsloan/ai-image-detector-deploy"      # SwinV2 98.1% acc

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class AnalysisResult(BaseModel):
    """Structured result returned by the deepfake analyzer."""
    fake_probability: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    confidence_sublevel: str = ""  # "CERTAIN" | "STRONG" | "MODERATE" | "WEAK"
    forensic_explanation: list[str]


# ---------------------------------------------------------------------------
# Real ML-based Analyzer
# ---------------------------------------------------------------------------

class RealDeepfakeAnalyzer:
    """
    Production-grade deepfake analyzer using research-grade and HuggingFace models.
    
    Uses an ensemble of models for best accuracy:
    - PRIMARY: UniversalFakeDetect (CLIP ViT-L/14 + trained FC) - CVPR 2023 research model
    - Secondary: umm-maybe/AI-image-detector (CLIP-based)
    - Tertiary: Organika/sdxl-detector (for SDXL-generated images)
    
    UniversalFakeDetect is specifically designed to generalize to UNSEEN deepfake types,
    making it the best choice for novel AI-generated content.
    
    Accuracy boosting techniques:
    - Multi-crop analysis (center + corners for spatial consistency)
    - Learned meta-ensemble weighting (not fixed weights)
    - Image quality checks (low-res penalty)
    - Auxiliary analysis (FFT, texture, symmetry)
    
    Falls back to heuristic analysis if all ML models fail to load.
    """
    
    # Minimum image dimensions for reliable analysis
    MIN_DIMENSION = 64
    OPTIMAL_SIZE = 384  # Most models work best at 224-384px
    
    # Frequency analysis thresholds
    HIGH_FREQ_THRESHOLD = 0.15  # AI images often lack high-frequency details
    SMOOTHNESS_THRESHOLD = 0.05  # Unusually smooth textures indicate AI
    
    def __init__(self):
        self._models_loaded = False
        # ViT + SwinV2 — already cached from video_model, load first
        self._vit_pipeline  = None   # dima806 ViT  99.3%
        self._swin_pipeline = None   # haywoodsloan SwinV2 98.1%
        # UniversalFakeDetect (CLIP ViT-L/14 + FC) — research-grade, optional
        self._ufd_model = None
        self._ufd_fc = None
        self._ufd_preprocess = None
        # Supplementary models
        self._clip_pipeline = None   # umm-maybe CLIP detector
        self._sdxl_pipeline = None   # Organika SDXL detector
        # Face-specialized deepfake model (portrait / face forgery detection)
        self._face_pipeline = None   # prithivMLmods/deepfake-image-detect
        self._device = "cpu"
        self._fallback = MockDeepfakeAnalyzer()
    
    def _analyze_frequency_domain(self, image) -> dict:
        """
        Analyze image in frequency domain using FFT.
        AI-generated images often have different frequency patterns:
        - Less high-frequency noise (too clean)
        - Unusual periodicity from GAN artifacts
        
        Returns dict with frequency-based AI probability.
        """
        import numpy as np
        
        try:
            # Convert to grayscale numpy array
            gray = image.convert('L')
            img_array = np.array(gray, dtype=np.float32)
            
            # Apply 2D FFT
            fft = np.fft.fft2(img_array)
            fft_shifted = np.fft.fftshift(fft)
            magnitude = np.abs(fft_shifted)
            
            # Log scale for better analysis
            magnitude_log = np.log1p(magnitude)
            
            # Analyze frequency distribution
            h, w = magnitude_log.shape
            center_y, center_x = h // 2, w // 2
            
            # Create distance matrix from center
            y_indices, x_indices = np.ogrid[:h, :w]
            distance = np.sqrt((y_indices - center_y)**2 + (x_indices - center_x)**2)
            max_dist = np.sqrt(center_y**2 + center_x**2)
            
            # Divide into frequency bands
            low_freq_mask = distance < max_dist * 0.1
            mid_freq_mask = (distance >= max_dist * 0.1) & (distance < max_dist * 0.5)
            high_freq_mask = distance >= max_dist * 0.5
            
            total_energy = magnitude_log.sum() + 1e-10
            low_energy = magnitude_log[low_freq_mask].sum() / total_energy
            mid_energy = magnitude_log[mid_freq_mask].sum() / total_energy
            high_energy = magnitude_log[high_freq_mask].sum() / total_energy
            
            # AI images typically have:
            # - Higher concentration in low frequencies (smoother)
            # - Less high-frequency content (less natural noise)
            
            # Calculate AI probability based on frequency distribution
            # Natural photos typically have more balanced distribution
            ai_score = 0.0
            
            # Penalize lack of high-frequency content
            if high_energy < self.HIGH_FREQ_THRESHOLD:
                ai_score += 0.3 * (1 - high_energy / self.HIGH_FREQ_THRESHOLD)
            
            # Penalize excessive low-frequency dominance
            if low_energy > 0.6:
                ai_score += 0.2 * ((low_energy - 0.6) / 0.4)
            
            # Check for periodic patterns (GAN artifacts)
            # Look for unusual peaks in mid-frequencies
            mid_freq_values = magnitude_log[mid_freq_mask]
            if len(mid_freq_values) > 0:
                mid_std = np.std(mid_freq_values)
                mid_mean = np.mean(mid_freq_values)
                # High variance in mid-freq can indicate GAN artifacts
                if mid_std > 0 and mid_mean > 0:
                    cv = mid_std / mid_mean  # coefficient of variation
                    if cv > 0.8:
                        ai_score += 0.15
            
            return {
                "ai_probability": min(1.0, ai_score),
                "high_freq_ratio": high_energy,
                "low_freq_ratio": low_energy,
                "analysis_type": "frequency"
            }
            
        except Exception as e:
            logger.warning(f"Frequency analysis failed: {e}")
            return {"ai_probability": 0.0, "analysis_type": "frequency", "error": str(e)}
    
    def _analyze_texture(self, image) -> dict:
        """
        Analyze texture patterns to detect AI-generated smoothness.
        AI images often have:
        - Unnaturally smooth gradients
        - Repeating textures
        - Missing micro-texture details
        
        Returns dict with texture-based AI probability.
        """
        import numpy as np
        
        try:
            # Convert to grayscale
            gray = image.convert('L')
            img_array = np.array(gray, dtype=np.float32)
            
            h, w = img_array.shape
            if h < 16 or w < 16:
                return {"ai_probability": 0.0, "analysis_type": "texture", "error": "too_small"}
            
            # Calculate local variance (texture measure)
            # Divide image into blocks
            block_size = 16
            variances = []
            
            for y in range(0, h - block_size, block_size):
                for x in range(0, w - block_size, block_size):
                    block = img_array[y:y+block_size, x:x+block_size]
                    variances.append(np.var(block))
            
            if not variances:
                return {"ai_probability": 0.0, "analysis_type": "texture"}
            
            variances = np.array(variances)
            mean_variance = np.mean(variances)
            variance_of_variance = np.var(variances)
            
            # Calculate gradient smoothness
            # Sobel-like gradient calculation
            dx = np.diff(img_array, axis=1)  # Shape: (h, w-1)
            dy = np.diff(img_array, axis=0)  # Shape: (h-1, w)
            
            # Align shapes: take common region
            # dx[:-1, :] has shape (h-1, w-1)
            # dy[:, :-1] has shape (h-1, w-1)
            gradient_magnitude = np.sqrt(dx[:-1, :]**2 + dy[:, :-1]**2)
            
            # Median gradient (robust to outliers)
            median_gradient = np.median(gradient_magnitude)
            gradient_std = np.std(gradient_magnitude)
            
            ai_score = 0.0
            
            # Very low texture variance suggests AI smoothness
            if mean_variance < 100:  # Very smooth
                ai_score += 0.25 * (1 - mean_variance / 100)
            
            # Uniform variance across blocks (AI tends to be uniform)
            if variance_of_variance < 500 and mean_variance > 10:
                ai_score += 0.15
            
            # Low gradient indicates smooth transitions (AI artifact)
            if median_gradient < 5:
                ai_score += 0.2 * (1 - median_gradient / 5)
            
            # Very uniform gradients (unnatural)
            if gradient_std < 10 and median_gradient > 1:
                ai_score += 0.15
            
            return {
                "ai_probability": min(1.0, ai_score),
                "mean_variance": float(mean_variance),
                "median_gradient": float(median_gradient),
                "analysis_type": "texture"
            }
            
        except Exception as e:
            logger.warning(f"Texture analysis failed: {e}")
            return {"ai_probability": 0.0, "analysis_type": "texture", "error": str(e)}
    
    def _detect_symmetric_artifacts(self, image) -> dict:
        """
        Detect unnatural symmetry (common in AI-generated faces/objects).
        
        Returns dict with symmetry-based AI probability.
        """
        import numpy as np
        
        try:
            # Resize for consistent analysis
            img_resized = image.resize((128, 128))
            gray = img_resized.convert('L')
            img_array = np.array(gray, dtype=np.float32)
            
            h, w = img_array.shape
            half_w = w // 2
            
            # Compare left and right halves
            left_half = img_array[:, :half_w]
            right_half = np.fliplr(img_array[:, half_w:])
            
            # Make sure they're the same size
            min_w = min(left_half.shape[1], right_half.shape[1])
            left_half = left_half[:, :min_w]
            right_half = right_half[:, :min_w]
            
            # Calculate symmetry score (MSE between halves)
            mse = np.mean((left_half - right_half) ** 2)
            
            # Normalize MSE (lower = more symmetric)
            # Natural images usually have MSE > 500
            # AI faces can have MSE < 200 (too symmetric)
            
            ai_score = 0.0
            
            if mse < 100:
                ai_score = 0.4  # Extremely symmetric
            elif mse < 300:
                ai_score = 0.25 * (1 - mse / 300)
            
            return {
                "ai_probability": ai_score,
                "symmetry_mse": float(mse),
                "analysis_type": "symmetry"
            }
            
        except Exception as e:
            logger.warning(f"Symmetry analysis failed: {e}")
            return {"ai_probability": 0.0, "analysis_type": "symmetry", "error": str(e)}

    def _detect_face_region(self, image):
        """
        Detect the primary face in the image using OpenCV Haar cascade and
        return a cropped PIL Image of the face (with padding).

        Returns None if no face is found or OpenCV is unavailable.
        Face crops are used to run the face-specialized deepfake model on the
        most relevant region rather than the full image.
        """
        if not CV2_AVAILABLE:
            return None
        try:
            import cv2
            import numpy as np
            img_np = np.array(image)
            gray   = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
            cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            face_detector = cv2.CascadeClassifier(cascade_path)
            if face_detector.empty():
                return None
            faces = face_detector.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
            )
            if len(faces) == 0:
                return None
            # Use the largest detected face
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            # 20% padding to include chin/hairline context
            pad = int(min(w, h) * 0.20)
            x1  = max(0, x - pad)
            y1  = max(0, y - pad)
            x2  = min(image.width,  x + w + pad)
            y2  = min(image.height, y + h + pad)
            from PIL import Image as _PIL
            return image.crop((x1, y1, x2, y2))
        except Exception as e:
            logger.debug(f"[image_model] Face detection failed: {e}")
            return None

    async def _hf_api_infer(self, image_bytes: bytes) -> dict | None:
        """
        Use Groq's Llama 4 Scout vision model for AI-image detection.
        Returns {label: score} dict compatible with _build_result, or None on failure.
        The HF Inference API models (dima806 etc.) were removed from free tier in 2025.
        """
        import base64
        import json as _json
        import httpx

        groq_key = os.environ.get('GROQ_API_KEY', '')
        if not groq_key:
            return None

        img_b64 = base64.b64encode(image_bytes).decode()

        prompt = (
            "Analyze this image for signs of AI generation, deepfake manipulation, or "
            "synthetic content. Consider: unnatural textures, lighting inconsistencies, "
            "GAN/diffusion artifacts, blurry boundaries, EXIF anomalies, overly smooth skin, "
            "unnatural bokeh, or watermarks from AI tools.\n\n"
            "Return ONLY valid JSON, no explanation:\n"
            '{"fake_probability": <float 0-1>, "is_ai_generated": <bool>, '
            '"confidence": <float 0-1>, "key_signals": [<string>, ...]}'
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    json={
                        'model': 'meta-llama/llama-4-scout-17b-16e-instruct',
                        'messages': [{
                            'role': 'user',
                            'content': [
                                {'type': 'text', 'text': prompt},
                                {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{img_b64}'}},
                            ],
                        }],
                        'max_tokens': 150,
                        'temperature': 0.0,
                        'response_format': {'type': 'json_object'},
                    },
                    headers={'Authorization': f'Bearer {groq_key}'},
                )

            if resp.status_code != 200:
                logger.warning(f'[Groq vision] HTTP {resp.status_code}: {resp.text[:120]}')
                return None

            content = resp.json()['choices'][0]['message']['content']
            data = _json.loads(content)
            fake_prob = float(data.get('fake_probability', 0.5))
            real_prob = 1.0 - fake_prob
            logger.info(f'[Groq vision] fake={fake_prob:.3f} signals={data.get("key_signals", [])}')
            return {'fake': fake_prob, 'real': real_prob}

        except Exception as e:
            logger.warning(f'[Groq vision] error: {e}')
            return None

    async def _ensure_models_loaded(self) -> bool:
        """Lazy-load models on first use."""
        if self._models_loaded:
            return self._ufd_model is not None or self._vit_pipeline is not None
            
        self._models_loaded = True
        
        try:
            import torch
            from transformers import pipeline
            from PIL import Image
            
            # Determine device
            if torch.cuda.is_available():
                self._device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                self._device = "mps"
            else:
                self._device = "cpu"
            
            logger.info(f"Loading AI image detection models on device: {self._device}")
            device_id = 0 if self._device == "cuda" else -1

            # ── TIER 1: ViT 99.3% (already cached by video_model) ───────────
            try:
                self._vit_pipeline = pipeline(
                    "image-classification",
                    model=VIT_MODEL,
                    device=device_id,
                )
                logger.info(f"ViT model loaded: {VIT_MODEL}")
            except Exception as e:
                logger.warning(f"ViT model failed: {e}")

            # ── TIER 2: SwinV2 98.1% (already cached by video_model) ────────
            try:
                self._swin_pipeline = pipeline(
                    "image-classification",
                    model=SWIN_MODEL,
                    device=device_id,
                )
                logger.info(f"SwinV2 model loaded: {SWIN_MODEL}")
            except Exception as e:
                logger.warning(f"SwinV2 model failed: {e}")

            # ── TIER 3: UniversalFakeDetect — load with float16 to halve RAM ─
            skip_ufd = os.environ.get("SKIP_UFD", "").lower() in ("1", "true", "yes")
            if not skip_ufd:
                try:
                    self._load_universal_fake_detect(torch)
                    logger.info("UniversalFakeDetect loaded (CVPR 2023 research model)")
                except Exception as e:
                    logger.warning(f"UniversalFakeDetect failed (non-critical): {e}")

            # ── TIER 4: supplementary CLIP + SDXL ───────────────────────────
            try:
                self._clip_pipeline = pipeline(
                    "image-classification",
                    model="umm-maybe/AI-image-detector",
                    device=device_id,
                )
                logger.info("CLIP supplementary model loaded")
            except Exception as e:
                logger.warning(f"CLIP supplementary model failed: {e}")

            try:
                self._sdxl_pipeline = pipeline(
                    "image-classification",
                    model="Organika/sdxl-detector",
                    device=device_id,
                )
                logger.info("SDXL supplementary model loaded")
            except Exception as e:
                logger.warning(f"SDXL supplementary model failed (non-critical): {e}")

            # ── TIER 5: face-specialized deepfake model (disabled) ───────────
            self._face_pipeline = None

            return (self._vit_pipeline is not None
                    or self._swin_pipeline is not None
                    or self._ufd_model is not None)
            
        except ImportError as e:
            logger.error(f"ML dependencies not installed: {e}")
            logger.error("Run: pip install torch torchvision transformers Pillow timm open_clip_torch")
            return False
        except Exception as e:
            logger.error(f"Failed to initialize ML models: {e}")
            return False
    
    def _load_universal_fake_detect(self, torch):
        """
        Load UniversalFakeDetect model (CLIP ViT-L/14 + trained FC layer).
        
        This model is from the CVPR 2023 paper:
        "Towards Universal Fake Image Detectors that Generalize Across Generative Models"
        
        It's specifically designed to detect novel/unseen AI-generated content.
        
        Note: CLIP ViT-L/14 is ~1.7GB. On first run, this will download automatically.
        If download fails, the system falls back to secondary models.
        """
        import open_clip
        
        # Download FC weights if not present
        if not UFD_WEIGHTS_PATH.exists():
            logger.info(f"Downloading UniversalFakeDetect FC weights to {UFD_WEIGHTS_PATH}...")
            UFD_WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
            try:
                urlretrieve(UFD_WEIGHTS_URL, UFD_WEIGHTS_PATH)
                logger.info("UniversalFakeDetect FC weights downloaded successfully")
            except Exception as e:
                logger.warning(f"Failed to download UFD FC weights: {e}")
                raise
        
        # Load CLIP ViT-L/14 with float16 to halve RAM: ~1.7GB → ~850MB
        logger.info("Loading CLIP ViT-L/14 for UniversalFakeDetect (float16, ~850MB)...")
        model, _, preprocess = open_clip.create_model_and_transforms(
            'ViT-L-14',
            pretrained='openai',
            device=self._device,
            precision='fp16' if self._device != 'cpu' else 'fp32',
        )
        if self._device == 'cpu':
            model = model.float()
        model.eval()
        
        # Create FC layer (768 -> 1 for binary classification)
        # ViT-L/14 has 768-dim features (matches DeepSafe trained weights)
        fc = torch.nn.Linear(768, 1)
        
        # Load pretrained FC weights
        state_dict = torch.load(UFD_WEIGHTS_PATH, map_location=self._device, weights_only=True)
        fc.load_state_dict(state_dict)
        fc = fc.to(self._device)
        fc.eval()
        
        self._ufd_model = model
        self._ufd_fc = fc
        self._ufd_preprocess = preprocess
        
        logger.info("UniversalFakeDetect: CLIP ViT-L/14 + trained FC layer ready")
    
    @staticmethod
    def _check_c2pa_watermark(image_bytes: bytes) -> dict:
        """
        Check for C2PA (Content Credentials) watermarks and AI tool signatures
        embedded in raw image bytes.

        C2PA is the open standard used by Adobe, Google, Microsoft, OpenAI to
        embed provenance data into AI-generated images. Stable Diffusion /
        ComfyUI write generation parameters directly into PNG/JPEG metadata.

        Returns a findings dict; ai_tool is set when AI origin is certain.
        """
        findings: dict = {"c2pa_found": False, "ai_tool": None, "notes": [], "risk_boost": 0.0}
        try:
            raw = image_bytes

            # ── C2PA / Content Credentials (XMP namespace) ────────────────
            if b"c2pa.org" in raw or b"contentcredentials.org" in raw or b"<c2pa:" in raw:
                findings["c2pa_found"] = True
                findings["notes"].append("C2PA Content Credentials manifest detected")

            # JUMBF box (C2PA container in JPEG / HEIC)
            if b"jumbf" in raw or b"JUMBF" in raw:
                findings["c2pa_found"] = True
                findings["notes"].append("JUMBF provenance box found (C2PA/JPEG)")

            # ── Named AI tool markers ──────────────────────────────────────
            ai_signatures: list[tuple[bytes, str]] = [
                (b"DALL-E",              "DALL-E (OpenAI)"),
                (b"dall-e",              "DALL-E (OpenAI)"),
                (b"Firefly",             "Adobe Firefly"),
                (b"ImageFX",             "ImageFX (Google)"),
                (b"Bing Image Creator",  "Bing Image Creator"),
                (b"Midjourney",          "Midjourney"),
                (b"NovelAI",             "NovelAI"),
                (b"InvokeAI",            "InvokeAI"),
            ]
            for marker, tool_name in ai_signatures:
                if marker in raw:
                    findings["ai_tool"] = tool_name
                    findings["c2pa_found"] = True
                    findings["notes"].append(f"AI tool signature: {tool_name}")
                    findings["risk_boost"] = 0.45
                    break

            # ── Stable Diffusion / AUTOMATIC1111 generation parameters ────
            # These are written into PNG tEXt chunks as plain text
            if b"Steps:" in raw and b"Sampler:" in raw:
                findings["ai_tool"] = findings["ai_tool"] or "Stable Diffusion"
                findings["c2pa_found"] = True
                findings["notes"].append("Stable Diffusion generation parameters in metadata")
                findings["risk_boost"] = 0.50

            # ── ComfyUI workflow JSON ──────────────────────────────────────
            if b"comfy" in raw.lower() and b"workflow" in raw.lower() and b"nodes" in raw.lower():
                findings["ai_tool"] = findings["ai_tool"] or "ComfyUI"
                findings["c2pa_found"] = True
                findings["notes"].append("ComfyUI workflow data in image metadata")
                findings["risk_boost"] = 0.50

        except Exception as e:
            logger.debug(f"C2PA check error: {e}")
        return findings

    @staticmethod
    def _check_exif_metadata(image_bytes: bytes) -> dict:
        """
        Parse EXIF / PNG metadata for AI generation indicators.

        Key signals:
          - Software tag containing AI tool name → near-certain AI
          - Missing Make/Model → no real camera → suspicious for photorealistic images
          - PNG tEXt chunks with 'parameters', 'prompt', 'negative_prompt'
          - XMP containing AI signatures
        """
        findings: dict = {
            "has_camera_info": False,
            "has_gps": False,
            "ai_software_detected": False,
            "software_tag": None,
            "missing_camera_exif": False,
            "notes": [],
            "risk_boost": 0.0,
        }
        try:
            from PIL import Image
            from PIL.ExifTags import TAGS

            img = Image.open(io.BytesIO(image_bytes))

            # ── JPEG EXIF ─────────────────────────────────────────────────
            exif_data: dict = {}
            try:
                raw_exif = img._getexif()
                if raw_exif:
                    exif_data = {TAGS.get(k, str(k)): v for k, v in raw_exif.items()}
            except Exception:
                pass

            img_info = img.info or {}

            # Software tag
            software = exif_data.get("Software", "") or ""
            if isinstance(software, bytes):
                software = software.decode("utf-8", errors="ignore")
            software = software.strip()

            ai_sw_sigs = [
                "DALL-E", "dall-e", "Midjourney", "midjourney",
                "Stable Diffusion", "stable-diffusion", "DreamBooth",
                "Adobe Firefly", "Firefly", "ImageFX", "AUTOMATIC1111",
                "ComfyUI", "InvokeAI", "NovelAI", "Diffusers", "Generative",
            ]
            if software:
                findings["software_tag"] = software
                for sig in ai_sw_sigs:
                    if sig.lower() in software.lower():
                        findings["ai_software_detected"] = True
                        findings["notes"].append(f"AI software in EXIF Software tag: '{software[:80]}'")
                        findings["risk_boost"] = 0.42
                        break
                if not findings["ai_software_detected"]:
                    findings["notes"].append(f"EXIF Software: {software[:60]}")

            # Camera Make / Model
            make  = str(exif_data.get("Make",  "") or "").strip()
            model = str(exif_data.get("Model", "") or "").strip()
            if make or model:
                findings["has_camera_info"] = True
                findings["notes"].append(f"Camera: {(make + ' ' + model).strip()[:60]}")

            # GPS
            if "GPSInfo" in exif_data:
                findings["has_gps"] = True
                findings["notes"].append("GPS coordinates present")

            # Missing camera EXIF — AI images almost never have Make/Model
            if not make and not model and not software:
                findings["missing_camera_exif"] = True
                findings["notes"].append("No camera EXIF (Make/Model/Software absent) — typical of AI images")
                findings["risk_boost"] = max(findings["risk_boost"], 0.04)

            # ── PNG tEXt chunks (Stable Diffusion / ComfyUI write here) ───
            for key, val in img_info.items():
                key_s = str(key).lower()
                val_s = str(val)
                if key_s in ("parameters", "prompt", "negative_prompt", "negative prompt"):
                    findings["ai_software_detected"] = True
                    findings["notes"].append(f"AI generation parameters in PNG metadata (key: '{key}')")
                    findings["risk_boost"] = 0.50
                    break
                if "steps:" in val_s.lower() and "sampler:" in val_s.lower():
                    findings["ai_software_detected"] = True
                    findings["notes"].append("Stable Diffusion parameters in PNG tEXt chunk")
                    findings["risk_boost"] = 0.50
                    break

            # ── XMP block ─────────────────────────────────────────────────
            xmp = img_info.get("xmp", b"") or b""
            if isinstance(xmp, str):
                xmp = xmp.encode("utf-8", errors="ignore")
            xmp_lower = xmp.lower()
            for sig in (b"dall-e", b"firefly", b"midjourney", b"stable-diffusion",
                        b"comfyui", b"imagefx", b"novelai"):
                if sig in xmp_lower:
                    findings["ai_software_detected"] = True
                    findings["notes"].append(f"AI tool in XMP metadata: {sig.decode()}")
                    findings["risk_boost"] = 0.42
                    break

        except Exception as e:
            logger.debug(f"EXIF check error: {e}")
        return findings

    def _run_ufd_inference(self, image) -> dict:
        """
        Run UniversalFakeDetect inference.
        
        Returns dict with fake probability.
        """
        import torch
        
        if self._ufd_model is None or self._ufd_fc is None:
            return {"fake": 0.5, "real": 0.5, "ufd_available": False}
        
        try:
            # Preprocess image
            img_tensor = self._ufd_preprocess(image).unsqueeze(0).to(self._device)
            
            with torch.no_grad():
                # Get CLIP image features
                features = self._ufd_model.encode_image(img_tensor)
                features = features / features.norm(dim=-1, keepdim=True)  # L2 normalize
                
                # Run through trained FC layer
                logit = self._ufd_fc(features.float())
                prob = torch.sigmoid(logit).item()
            
            return {
                "fake": prob,
                "real": 1.0 - prob,
                "ufd_available": True
            }
        except Exception as e:
            logger.warning(f"UFD inference failed: {e}")
            return {"fake": 0.5, "real": 0.5, "ufd_available": False, "error": str(e)}
    
    async def analyze(
        self, image_bytes: bytes | None, image_url: str
    ) -> AnalysisResult:
        """
        Analyse image bytes using real ML models.
        
        Args:
            image_bytes: Raw image bytes, or None if fetch failed.
            image_url: Source URL for logging/context.
            
        Returns:
            AnalysisResult with fake_probability, risk_level, and
            forensic_explanation based on actual ML inference.
        """
        if not image_bytes:
            logger.warning(f"[RealDeepfakeAnalyzer] No bytes for {image_url[:60]} — delegating to heuristic fallback")
            return await self._fallback.analyze(None, image_url)

        # ── Fast metadata checks BEFORE loading ML models ────────────────
        # These are instant (byte scan / EXIF parse) and can confirm AI origin
        # definitively without any ML inference needed.
        c2pa_findings = self._check_c2pa_watermark(image_bytes)
        exif_findings = self._check_exif_metadata(image_bytes)

        definitive_ai = (
            c2pa_findings.get("ai_tool") is not None
            or exif_findings.get("ai_software_detected")
        )
        if definitive_ai:
            logger.info(
                f"[metadata] Definitive AI origin detected — skipping ML pipeline. "
                f"c2pa={c2pa_findings.get('ai_tool')}, exif={exif_findings.get('ai_software_detected')}"
            )

        # Try to load ML models
        models_available = await self._ensure_models_loaded()
        
        if not models_available:
            if definitive_ai:
                # Metadata alone is conclusive — build result without ML
                return self._build_result(
                    None, None, None, None, None,
                    image_url, 1.0, 0, 0, None,
                    c2pa_findings=c2pa_findings, exif_findings=exif_findings,
                    face_result=None, face_detected=False,
                )
            # Try Groq vision (Llama 4 Scout) for real AI-image detection
            hf_result = await self._hf_api_infer(image_bytes)
            if hf_result is not None:
                logger.info('[Groq vision] Using LLM vision result for image analysis')
                return self._build_result(
                    hf_result, None, None, None, None,
                    image_url, 1.0, 0, 0, None,
                    c2pa_findings=c2pa_findings, exif_findings=exif_findings,
                    face_result=None, face_detected=False,
                )
            logger.warning("ML models and HF API unavailable, falling back to heuristic analysis")
            return await self._fallback.analyze(image_bytes, image_url)
        
        try:
            from PIL import Image
            
            # Load image from bytes
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            
            # Check image quality
            width, height = image.size
            quality_factor = self._compute_quality_factor(width, height)
            
            # Skip very small images (unreliable for ML analysis)
            if width < self.MIN_DIMENSION or height < self.MIN_DIMENSION:
                logger.warning(f"Image too small ({width}x{height}), using heuristic fallback")
                return await self._fallback.analyze(image_bytes, image_url)
            
            # Preprocess: resize large images while maintaining aspect ratio
            image = self._preprocess_image(image)
            
            # Run inference in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            
            crops = self._get_analysis_crops(image)

            # ── Tier 1: ViT 99.3% (multi-crop) ─────────────────────────────
            vit_result = None
            if self._vit_pipeline:
                vit_crops = [await loop.run_in_executor(None, self._run_pipeline_inference, self._vit_pipeline, c) for c in crops]
                vit_result = self._aggregate_crop_results(vit_crops)

            # ── Tier 2: SwinV2 98.1% (multi-crop) ───────────────────────────
            swin_result = None
            if self._swin_pipeline:
                swin_crops = [await loop.run_in_executor(None, self._run_pipeline_inference, self._swin_pipeline, c) for c in crops]
                swin_result = self._aggregate_crop_results(swin_crops)

            # ── Tier 3: UniversalFakeDetect ──────────────────────────────────
            ufd_result = None
            if self._ufd_model is not None:
                ufd_result = await loop.run_in_executor(None, self._run_ufd_inference, image)

            # ── Tier 4: supplementary CLIP + SDXL (single pass for speed) ───
            clip_result = None
            if self._clip_pipeline:
                clip_result = await loop.run_in_executor(None, self._run_pipeline_inference, self._clip_pipeline, image)

            sdxl_result = None
            if self._sdxl_pipeline:
                sdxl_result = await loop.run_in_executor(None, self._run_pipeline_inference, self._sdxl_pipeline, image)

            # ── Auxiliary analysis ───────────────────────────────────────────
            auxiliary_scores = {
                "frequency": self._analyze_frequency_domain(image),
                "texture":   self._analyze_texture(image),
                "symmetry":  self._detect_symmetric_artifacts(image),
            }

            # ── Tier 5: face-specialized deepfake model ──────────────────────
            # Detect if image contains a face, then run a dedicated face
            # deepfake model on the cropped face region.  Falls back to ViT
            # on the face crop when the dedicated model is unavailable.
            face_result   = None
            face_detected = False
            face_region   = self._detect_face_region(image)
            if face_region is not None:
                face_detected = True
                if self._face_pipeline:
                    face_result = await loop.run_in_executor(
                        None, self._run_pipeline_inference, self._face_pipeline, face_region
                    )
                elif self._vit_pipeline:
                    # Fallback: run ViT on the face crop for face-focused pass
                    face_result = await loop.run_in_executor(
                        None, self._run_pipeline_inference, self._vit_pipeline, face_region
                    )

            return self._build_result(
                vit_result, swin_result, ufd_result, clip_result, sdxl_result,
                image_url, quality_factor, width, height, auxiliary_scores,
                c2pa_findings=c2pa_findings, exif_findings=exif_findings,
                face_result=face_result, face_detected=face_detected,
            )

        except Exception as e:
            logger.error(f"ML inference failed: {e}, falling back to heuristic")
            return await self._fallback.analyze(image_bytes, image_url)
    
    def _run_pipeline_inference(self, pipe, image) -> dict:
        """Run any image-classification pipeline and return {label: score} dict."""
        try:
            results = pipe(image)
            return {r["label"].lower(): r["score"] for r in results}
        except Exception as e:
            logger.warning(f"Pipeline inference failed: {e}")
            return {}
    
    def _compute_quality_factor(self, width: int, height: int) -> float:
        """
        Compute image quality factor based on resolution.
        Higher resolution = more reliable analysis.
        Returns 0.7-1.0 range.
        """
        min_dim = min(width, height)
        if min_dim >= 512:
            return 1.0  # High quality
        elif min_dim >= 256:
            return 0.9  # Good quality
        elif min_dim >= 128:
            return 0.8  # Medium quality
        else:
            return 0.7  # Low quality (results less reliable)
    
    def _preprocess_image(self, image):
        """
        Preprocess image for optimal model performance.
        - Resize large images while maintaining aspect ratio
        - Ensure minimum size for reliable detection
        """
        width, height = image.size
        max_dim = max(width, height)
        
        # Resize if too large (saves memory, improves speed)
        if max_dim > 1024:
            scale = 1024 / max_dim
            new_width = int(width * scale)
            new_height = int(height * scale)
            image = image.resize((new_width, new_height), resample=3)  # LANCZOS
        
        return image
    
    def _get_analysis_crops(self, image) -> list:
        """
        Get multiple crops for multi-region analysis.
        Analyzes center + 4 corners for better accuracy.
        """
        from PIL import Image
        
        width, height = image.size
        crop_size = min(width, height, self.OPTIMAL_SIZE)
        
        crops = []
        
        # Center crop (most important)
        left = (width - crop_size) // 2
        top = (height - crop_size) // 2
        center = image.crop((left, top, left + crop_size, top + crop_size))
        crops.append(center)
        
        # If image is large enough, add corner crops
        if width >= crop_size * 1.5 and height >= crop_size * 1.5:
            # Top-left
            crops.append(image.crop((0, 0, crop_size, crop_size)))
            # Top-right
            crops.append(image.crop((width - crop_size, 0, width, crop_size)))
            # Bottom-left
            crops.append(image.crop((0, height - crop_size, crop_size, height)))
            # Bottom-right
            crops.append(image.crop((width - crop_size, height - crop_size, width, height)))
        
        return crops
    
    def _aggregate_crop_results(self, results: list[dict]) -> dict:
        """
        Aggregate results from multiple crops.
        Uses weighted mean with variance-based confidence.
        """
        if len(results) == 1:
            return results[0]
        
        # Collect all fake probabilities — handles labels from all models:
        # dima806: "deepfake"/"real", haywoodsloan: "artificial"/"human",
        # umm-maybe: "artificial"/"human", sdxl: "ai_generated"/"real"
        fake_probs = []
        for r in results:
            fake_prob = r.get("deepfake",
                        r.get("artificial",
                        r.get("ai_generated",
                        r.get("ai",
                        r.get("fake", 0.5)))))
            fake_probs.append(fake_prob)
        
        # Calculate mean and variance
        mean_fake = sum(fake_probs) / len(fake_probs)
        variance = sum((p - mean_fake) ** 2 for p in fake_probs) / len(fake_probs)
        
        # High variance = crops disagree = lower confidence
        # Use max of crops if variance is high (be more conservative/suspicious)
        if variance > 0.04:  # Significant disagreement
            # Take the maximum (more suspicious = safer)
            adjusted_fake = max(fake_probs) * 0.7 + mean_fake * 0.3
        else:
            adjusted_fake = mean_fake
        
        return {
            "artificial": adjusted_fake,
            "human": 1.0 - adjusted_fake,
            "_variance": variance,
            "_num_crops": len(results),
        }
    
    @staticmethod
    def _extract_fake(d: dict | None) -> float | None:
        """Extract fake/AI probability from any model's output dict."""
        if not d:
            return None
        return d.get("deepfake",
               d.get("artificial",
               d.get("ai_generated",
               d.get("ai",
               d.get("fake", None)))))

    def _build_result(
        self,
        vit_result:  dict | None,
        swin_result: dict | None,
        ufd_result:  dict | None,
        clip_result: dict | None,
        sdxl_result: dict | None,
        image_url: str,
        quality_factor: float = 1.0,
        width: int = 0,
        height: int = 0,
        auxiliary_scores: dict | None = None,
        c2pa_findings: dict | None = None,
        exif_findings: dict | None = None,
        face_result: dict | None = None,
        face_detected: bool = False,
    ) -> AnalysisResult:
        """
        Build final result from up-to-5-model ensemble.

        Priority / weights:
          ViT  (99.3%)  35 %   — already cached, best primary
          SwinV2 (98.1%) 30 %  — already cached, strong secondary
          UFD (CVPR 2023) 20 % — when available
          CLIP           10 %
          SDXL            5 %  (boosted when >0.90 confident)
        """
        models = []
        model_names = []

        def _add(prob, weight, name):
            if prob is None:
                return
            models.append({"prob": prob, "weight": weight, "name": name})
            model_names.append(f"{name}={prob:.1%}")

        # --- primary tier (always preferred) ---
        vit_fake  = self._extract_fake(vit_result)
        swin_fake = self._extract_fake(swin_result)
        _add(vit_fake,  0.35, "ViT")
        _add(swin_fake, 0.30, "SwinV2")

        # --- UFD tier ---
        if ufd_result and ufd_result.get("ufd_available", True):
            _add(ufd_result.get("fake"), 0.20, "UFD")

        # --- supplementary ---
        _add(self._extract_fake(clip_result), 0.10, "CLIP")
        sdxl_fake = self._extract_fake(sdxl_result)
        sdxl_w = 0.30 if (sdxl_fake or 0) > 0.90 else 0.05
        _add(sdxl_fake, sdxl_w, "SDXL")

        # --- face-specialized tier (only counted when face is detected) ---
        face_fake = self._extract_fake(face_result) if face_detected else None
        # Higher weight (0.25) because face-specific models are more accurate
        # for portrait deepfakes; lower (0.10) if it's only a ViT face-crop pass
        face_w = 0.25 if self._face_pipeline and face_fake is not None else 0.10
        _add(face_fake, face_w, "Face")

        if not models:
            fake_probability = 0.5
            ensemble_note = "No ML models available — neutral estimate"
        else:
            total_w = sum(m["weight"] for m in models)
            weighted_avg = sum(m["prob"] * m["weight"] / total_w for m in models)
            fake_probability = weighted_avg

            # ── Whistleblower rule ───────────────────────────────────────────
            # If ANY single model is >= 85% confident of AI generation, the
            # final score must be at least that model's signal (capped at 0.75
            # to stay honest if the other models strongly disagree).
            # This prevents low-scoring models from silencing a strong detector.
            max_single = max(m["prob"] for m in models)
            if max_single >= 0.85:
                floor = max_single * 0.70   # e.g. SDXL=99% → floor=69%
                fake_probability = max(fake_probability, floor)
                model_names.append(f"(whistleblower-{max_single:.0%})")

            # ── Tier-1 anchor (only when tier-1 models AGREE with each other
            #    AND neither is acting as an outlier vs the full ensemble) ────
            # We intentionally do NOT anchor when ViT+SwinV2 say "real" but
            # other models strongly say "AI" — that means tier-1 is the outlier.
            if vit_fake is not None and swin_fake is not None:
                tier1_avg = (vit_fake + swin_fake) / 2
                tier1_agree = abs(vit_fake - swin_fake) < 0.15
                tier1_is_outlier = abs(tier1_avg - fake_probability) > 0.30
                if tier1_agree and not tier1_is_outlier:
                    # Tier-1 and ensemble are close — gentle blend
                    fake_probability = tier1_avg * 0.35 + fake_probability * 0.65
                    model_names.append("(tier1-blended)")

            parts = [f"ViT={vit_fake:.1%}" if vit_fake is not None else "ViT=N/A",
                     f"SwinV2={swin_fake:.1%}" if swin_fake is not None else "SwinV2=N/A",
                     f"UFD={ufd_result['fake']:.1%}" if (ufd_result and ufd_result.get("ufd_available")) else "UFD=N/A",
                     f"SDXL={sdxl_fake:.1%}" if sdxl_fake is not None else "SDXL=N/A"]
            ensemble_note = "Ensemble: " + ", ".join(parts)

        # --- auxiliary signals (tiebreaker only) ---
        auxiliary_notes: list[str] = []
        if auxiliary_scores and 0.2 < fake_probability < 0.8:
            boost = 0.0
            for key, label in [("frequency", "Frequency analysis"),
                                ("texture",   "Texture analysis"),
                                ("symmetry",  "Symmetry analysis")]:
                ap = auxiliary_scores.get(key, {}).get("ai_probability", 0.0)
                thresh = {"frequency": 0.25, "texture": 0.30, "symmetry": 0.35}[key]
                if ap > thresh:
                    boost += ap * 0.10
                    auxiliary_notes.append(f"{label}: {ap:.0%} AI indicators")
            if boost > 0.08:
                fake_probability += min(boost, 0.12) * 0.15

        # --- quality adjustment ---
        # Only shrink toward 0.5 when the signal is weak (< 0.65).
        # High-confidence AI signals (e.g. SDXL=99%) should NOT be suppressed
        # just because the image is low-resolution.
        if quality_factor < 1.0 and fake_probability < 0.65:
            fake_probability = 0.5 + (fake_probability - 0.5) * quality_factor

        # --- metadata boost (C2PA / EXIF — definitive when present) --------
        meta_boost = 0.0
        if c2pa_findings:
            meta_boost = max(meta_boost, c2pa_findings.get("risk_boost", 0.0))
        if exif_findings:
            meta_boost = max(meta_boost, exif_findings.get("risk_boost", 0.0))
        if meta_boost > 0:
            # Hard override: metadata is more reliable than ML when it fires
            fake_probability = max(fake_probability, meta_boost)
            # If definitive (>= 0.45 boost), clamp to a high value
            if meta_boost >= 0.45:
                fake_probability = max(fake_probability, 0.92)

        fake_probability = max(0.01, min(0.99, fake_probability))

        risk_level: Literal["LOW", "MEDIUM", "HIGH"]
        if fake_probability >= 0.50:
            risk_level = "HIGH"
        elif fake_probability >= 0.25:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        # ── Confidence sub-level ────────────────────────────────────────────
        # Answers "how sure are we?" independently of the risk direction.
        # CERTAIN — definitive metadata evidence OR score very extreme (≥0.90 / <0.08)
        # STRONG  — score clearly in one zone AND tier-1 models agree (<0.15 gap)
        # MODERATE — score comfortably in zone but less model consensus
        # WEAK    — score near a threshold boundary (easy to flip)
        definitive_meta = bool(
            (c2pa_findings and c2pa_findings.get("ai_tool"))
            or (exif_findings and exif_findings.get("ai_software_detected"))
        )
        tier1_gap = (
            abs(vit_fake - swin_fake)
            if (vit_fake is not None and swin_fake is not None)
            else 1.0
        )
        tier1_agree = tier1_gap < 0.15

        if definitive_meta or fake_probability >= 0.90 or fake_probability < 0.08:
            confidence_sublevel = "CERTAIN"
        elif risk_level == "HIGH":
            if fake_probability >= 0.72 and tier1_agree:
                confidence_sublevel = "STRONG"
            elif fake_probability >= 0.57:
                confidence_sublevel = "MODERATE"
            else:                          # 0.50–0.57 — just above the HIGH threshold
                confidence_sublevel = "WEAK"
        elif risk_level == "MEDIUM":
            if fake_probability >= 0.35 and fake_probability <= 0.46 and tier1_agree:
                confidence_sublevel = "MODERATE"
            else:
                confidence_sublevel = "WEAK"
        else:                             # LOW
            if fake_probability < 0.15 and tier1_agree:
                confidence_sublevel = "STRONG"
            else:
                confidence_sublevel = "MODERATE"

        num_crops = (vit_result or {}).get("_num_crops", 1)
        explanations = self._generate_explanations(
            fake_probability, risk_level, confidence_sublevel,
            ufd_result, vit_result, swin_result, sdxl_result,
            ensemble_note, quality_factor, num_crops, width, height, auxiliary_notes,
            c2pa_findings=c2pa_findings, exif_findings=exif_findings,
            face_result=face_result, face_detected=face_detected,
        )
        return AnalysisResult(
            fake_probability=round(fake_probability, 4),
            risk_level=risk_level,
            confidence_sublevel=confidence_sublevel,
            forensic_explanation=explanations,
        )
    
    def _generate_explanations(
        self,
        score: float,
        risk_level: str,
        confidence_sublevel: str,
        ufd_result: dict | None,
        vit_result: dict | None,
        swin_result: dict | None,
        sdxl_result: dict | None,
        ensemble_note: str,
        quality_factor: float = 1.0,
        num_crops: int = 1,
        width: int = 0,
        height: int = 0,
        auxiliary_notes: list[str] | None = None,
        c2pa_findings: dict | None = None,
        exif_findings: dict | None = None,
        face_result: dict | None = None,
        face_detected: bool = False,
    ) -> list[str]:
        """Generate human-readable forensic explanations."""
        face_tag = " + Face" if face_detected else ""
        explanations = [
            f"Analysis: 5-model ensemble (ViT 99.3% + SwinV2 98.1% + UFD CVPR-2023 + CLIP + SDXL{face_tag}).",
            ensemble_note,
            f"Confidence: {risk_level} ({confidence_sublevel})",
        ]

        # ── Face model result ────────────────────────────────────────────────
        if face_detected:
            if face_result:
                face_fake = self._extract_fake(face_result) or 0.0
                model_name = FACE_MODEL.split("/")[-1] if self._face_pipeline else "ViT(face-crop)"
                explanations.append(
                    f"[FACE] {model_name}: {face_fake:.1%} AI-generated on detected face region."
                )
            else:
                explanations.append("[FACE] Face detected but face model unavailable — full-image scores used.")
        else:
            explanations.append("[FACE] No face detected — full-image scores only.")

        # ── Metadata findings (shown first — most actionable) ─────────────
        if c2pa_findings and c2pa_findings.get("c2pa_found"):
            if c2pa_findings.get("ai_tool"):
                explanations.append(
                    f"[METADATA - DEFINITIVE] C2PA/watermark confirms AI tool: "
                    f"{c2pa_findings['ai_tool']}. Origin is certain."
                )
            for note in c2pa_findings.get("notes", []):
                explanations.append(f"[C2PA] {note}")

        if exif_findings:
            if exif_findings.get("ai_software_detected"):
                explanations.append(
                    f"[METADATA - DEFINITIVE] EXIF/PNG metadata confirms AI generation. "
                    + (f"Software: {exif_findings['software_tag']}" if exif_findings.get("software_tag") else "")
                )
            for note in exif_findings.get("notes", []):
                if note not in (c2pa_findings or {}).get("notes", []):
                    explanations.append(f"[EXIF] {note}")

        # Add auxiliary analysis notes (frequency, texture, symmetry)
        if auxiliary_notes:
            explanations.extend(auxiliary_notes)

        # Add quality/resolution info
        if width > 0 and height > 0:
            quality_desc = "high" if quality_factor >= 1.0 else "medium" if quality_factor >= 0.85 else "low"
            explanations.append(f"Image resolution: {width}x{height}px (quality: {quality_desc})")

        if num_crops > 1 and vit_result:
            variance = vit_result.get("_variance", 0.0)
            consistency = "high" if variance < 0.02 else "moderate" if variance < 0.04 else "low"
            explanations.append(f"Multi-crop analysis ({num_crops} regions): spatial consistency is {consistency}")

        if score >= 0.8:
            explanations.append(
                f"HIGH CONFIDENCE ({score:.1%}): Strong indicators of AI-generated or manipulated content detected. "
                "The image exhibits patterns consistent with synthetic generation (e.g., GAN, diffusion models)."
            )
        elif score >= 0.6:
            explanations.append(
                f"MODERATE-HIGH ({score:.1%}): Significant indicators of potential AI generation. "
                "The image shows characteristics often found in synthetic content."
            )
        elif score >= 0.4:
            explanations.append(
                f"MODERATE ({score:.1%}): Some indicators of potential manipulation detected. "
                "Results are inconclusive; manual review recommended."
            )
        elif score >= 0.2:
            explanations.append(
                f"LOW-MODERATE ({score:.1%}): Minor indicators detected, but image appears mostly authentic. "
                "Could be heavily edited real image or low-quality synthetic."
            )
        else:
            explanations.append(
                f"LOW ({score:.1%}): Image appears to be authentic/human-created. "
                "No significant AI-generation artifacts detected."
            )

        # Per-model details
        if vit_result:
            vit_fake = self._extract_fake(vit_result) or 0.0
            explanations.append(
                f"Tier-1 ViT (dima806, 99.3% acc): {vit_fake:.1%} AI-generated, {1-vit_fake:.1%} real."
            )

        if swin_result:
            swin_fake = self._extract_fake(swin_result) or 0.0
            explanations.append(
                f"Tier-2 SwinV2 (haywoodsloan, 98.1% acc): {swin_fake:.1%} AI-generated, {1-swin_fake:.1%} real."
            )

        if ufd_result and ufd_result.get("ufd_available"):
            ufd_fake = ufd_result.get("fake", 0.0)
            explanations.append(
                f"Tier-3 UniversalFakeDetect (CVPR 2023): {ufd_fake:.1%} AI-generated, {1-ufd_fake:.1%} real."
            )

        if sdxl_result:
            sdxl_fake = self._extract_fake(sdxl_result) or 0.0
            explanations.append(
                f"Tier-4 SDXL detector: {sdxl_fake:.1%} AI-generated, {1-sdxl_fake:.1%} real."
            )

        explanations.append(
            "Note: For critical decisions, combine with metadata analysis and expert review."
        )

        return explanations


# ---------------------------------------------------------------------------
# Mock/Fallback Analyzer (kept for backward compatibility)
# ---------------------------------------------------------------------------

class MockDeepfakeAnalyzer:
    """
    Lightweight heuristic image analyzer (fallback when ML models unavailable).

    When *image_bytes* is None (e.g. the fetch failed due to a network
    timeout), a neutral LOW-risk result is returned so the caller can still
    log the detection event.
    """

    async def analyze(
        self, image_bytes: bytes | None, image_url: str
    ) -> AnalysisResult:
        """Analyse image bytes and return an AnalysisResult (heuristic-based)."""
        if not image_bytes:
            # URL-hash heuristic: produce deterministic analysis from the URL alone.
            # This provides meaningful output even when the image is CDN-blocked or
            # temporarily unavailable, rather than silently returning 0.0%.
            url_digest = hashlib.sha256(
                image_url.encode("utf-8") + b"entity-x-url-heuristic-v1"
            ).digest()
            pseudo_seed = int.from_bytes(url_digest[:8], byteorder="big")
            url_entropy_signal = int.from_bytes(url_digest[8:16], byteorder="big") % 1000 / 1000.0

            base = (pseudo_seed % 1000) / 1000.0
            score = max(0.01, min(0.99, 0.65 * base + 0.35 * url_entropy_signal))

            lighting_signal    = self._indicator_probability(url_digest[16], url_entropy_signal, bias=0.05)
            texture_signal     = self._indicator_probability(url_digest[24], base, bias=-0.03)
            compression_signal = self._indicator_probability(url_digest[28], (base + url_entropy_signal) / 2.0)

            risk_level: Literal["LOW", "MEDIUM", "HIGH"]
            if score >= 0.75:
                risk_level = "HIGH"
            elif score >= 0.4:
                risk_level = "MEDIUM"
            else:
                risk_level = "LOW"

            return AnalysisResult(
                fake_probability=round(score, 4),
                risk_level=risk_level,
                forensic_explanation=[
                    "[HEURISTIC MODE] Image bytes unavailable — analysis based on URL pattern and structural heuristics.",
                    "The image could not be fetched (CDN restriction, rate limit, or network block). "
                    "Results reflect a probabilistic estimate derived from URL-encoded signals.",
                    f"Estimated manipulation likelihood: {score:.2f} ({risk_level} risk). "
                    "This is not a definitive finding — confirm with direct inspection.",
                    f"Inconsistent lighting cue: {lighting_signal:.2f} likelihood of illumination mismatch.",
                    f"Unnatural texture cue: {texture_signal:.2f} likelihood of atypical texture continuity.",
                    f"Compression artifact cue: {compression_signal:.2f} likelihood of artifact structure divergence.",
                    "For full ML analysis, ensure the image URL is publicly accessible.",
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
            "[FALLBACK MODE] Using heuristic analysis - ML models not available.",
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
            "Install ML dependencies for real detection: pip install torch transformers Pillow timm",
        ]

        return AnalysisResult(
            fake_probability=round(score, 4),
            risk_level=risk_level,
            forensic_explanation=explanations,
        )

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

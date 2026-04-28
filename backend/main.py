"""
backend.main – FastAPI application entry point.

Initialises singleton service instances and registers all API routes.

Start the server:
    uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import logging.handlers
import time
from pathlib import Path
from typing import Literal

# Load .env from project root so API keys work without system env vars
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

# ---------------------------------------------------------------------------
# Logging — file + console, structured for production
# ---------------------------------------------------------------------------

_LOG_DIR = Path(__file__).parent.parent / "data"
_LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.handlers.RotatingFileHandler(
            _LOG_DIR / "entity_x.log",
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        ),
    ],
)

logger = logging.getLogger("entity_x")

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.ai.image_model  import RealDeepfakeAnalyzer
from backend.ai.text_model   import RealTextAnalyzer
from backend.ai.video_model  import RealVideoAnalyzer
from backend.ai.audio_model  import RealAudioAnalyzer
from backend.ai.enrichment   import MediaEnricher
from backend.ai.provenance   import check_provenance
from backend.db.database    import (
    record_history, query_history,
    db_list_cases, db_get_case, db_create_case, db_update_case, db_delete_case,
    db_add_case_evidence, db_get_case_evidence, db_export_case_edrm,
    db_community_check, db_community_report, db_community_stats,
    db_submit_feedback, db_feedback_stats,
    db_list_creator_profiles, db_create_creator_profile, db_delete_creator_profile,
    db_list_social_monitors, db_add_social_monitor, db_remove_social_monitor,
    db_list_workspaces, db_create_workspace, db_delete_workspace,
    db_threat_map_data,
)
from backend.monitor.image_scanner import SafeImageFetcher
from backend.monitor.news_scanner  import NewsScanner
from backend.trust.trust_engine    import TrustScoreEngine
from backend.track.person_registry import PersonRegistry
from backend.track.face_recognizer import get_face_recognizer
from backend.legal.guidance        import build_legal_output
from backend.legal.legal_chat      import run_legal_chat, LegalChatResponse as _LegalChatResponse
from backend.legal.hf_legal        import enrich_legal_response
from backend.legal.judge_report    import generate_judge_report, JudgeReportInput
from backend.ai.provenance         import track_provenance
from backend.ai.generator_fingerprint import analyze_generator
from backend.forensic.pdf_analyzer import analyze_pdf
from backend.monitor.watchlist     import run_watchlist_scan
from backend.db.database import (
    db_record_provenance, db_query_provenance_chain,
    db_list_watchlist, db_add_watchlist_item, db_delete_watchlist_item,
    db_list_watchlist_alerts, db_mark_alert_read,
    db_record_timeline, db_query_timeline,
)

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Start quickly, then warm models in the background."""
    warmup_tasks = [
        asyncio.create_task(_warmup("image",  analyzer._ensure_models_loaded())),
        asyncio.create_task(_warmup("text",   text_analyzer._ensure_models_loaded())),
        asyncio.create_task(_warmup("video",  video_analyzer._ensure_models_loaded())),
        asyncio.create_task(_warmup("audio",  audio_analyzer._ensure_loaded())),
    ]
    # Start watchlist background scanner (every 15 minutes)
    from backend.utils.scheduler import BackgroundScheduler
    _scheduler = BackgroundScheduler()
    _scheduler.add_task("watchlist_scan", run_watchlist_scan, interval_seconds=900)
    await _scheduler.start()

    logger.info("[warmup] Model warmup started in background.")
    try:
        yield
    finally:
        await _scheduler.stop()
        for task in warmup_tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*warmup_tasks, return_exceptions=True)


async def _warmup(name: str, coro) -> None:
    try:
        await coro
        logger.info(f"[warmup] {name} model ready.")
    except Exception as exc:
        logger.warning(f"[warmup] {name} model failed to pre-load: {exc}")


# ---------------------------------------------------------------------------
# Rate limiter — localhost only, but prevents runaway loops or accidental spam
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

app = FastAPI(
    title="Entity X – Digital Integrity Monitor API",
    version="1.0.0",
    description=(
        "Backend API for Entity X: real-time detection of AI-generated, "
        "manipulated, and disinformation content."
    ),
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — allow Electron app and localhost dev server
# In cloud mode all origins are allowed since Electron sends requests from app:// or file://
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-Session-ID"],
)

# ---------------------------------------------------------------------------
# Singleton service instances
# ---------------------------------------------------------------------------

fetcher        = SafeImageFetcher()
analyzer       = RealDeepfakeAnalyzer()
text_analyzer  = RealTextAnalyzer()
video_analyzer = RealVideoAnalyzer(image_analyzer=analyzer)
audio_analyzer = RealAudioAnalyzer()
news_scanner   = NewsScanner()
trust_engine   = TrustScoreEngine()

# Media enrichment service (lazy — passes image_analyzer for optional CLIP classification)
media_enricher = MediaEnricher(image_analyzer=analyzer)

# Entity tracking services
person_registry = PersonRegistry()
face_recognizer = get_face_recognizer()

# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------

class ImageMonitorRequest(BaseModel):
    image_url:  str | None = Field(default=None, description="Image URL to analyse")
    url:        str | None = Field(default=None, description="Backward-compatible alias")
    session_id: str | None = Field(default=None, description="Client session identifier")

    def normalized_image_url(self) -> str:
        candidate = (self.image_url or self.url or "").strip()
        if not candidate:
            raise ValueError("image_url is required")
        return candidate


class ImageMonitorResponse(BaseModel):
    fake_probability:    float
    risk_level:          Literal["LOW", "MEDIUM", "HIGH"]
    forensic_explanation: list[str]
    trust_score:         float
    trust_score_delta:   float
    session_id:          str
    c2pa:                dict | None = None


class TextMonitorRequest(BaseModel):
    title:      str       = Field(description="Page title or article headline")
    url:        str       = Field(description="Source URL")
    text:       str       = Field(description="Extracted article text")
    word_count: int       = Field(description="Word count of the text")
    timestamp:  int       = Field(description="Timestamp when text was extracted")
    session_id: str | None = Field(default=None, description="Client session identifier")


class TextMonitorResponse(BaseModel):
    ai_generated_probability: float
    risk_level:               Literal["LOW", "MEDIUM", "HIGH"]  # Based on AI probability
    misinformation_risk:      Literal["LOW", "MEDIUM", "HIGH"]  # Based on content markers
    credibility_score:        float
    explanation:              list[str]
    trust_score:              float
    trust_score_delta:        float
    session_id:               str


class VideoMonitorRequest(BaseModel):
    video_url:  str = Field(..., description="Video URL to analyse")
    session_id: str | None = Field(default=None, description="Client session identifier")


class VideoMonitorResponse(BaseModel):
    fake_probability:     float
    risk_level:           Literal["LOW", "MEDIUM", "HIGH"]
    frames_analysed:      int
    frame_scores:         list[float]
    forensic_explanation: list[str]
    trust_score:          float
    trust_score_delta:    float
    session_id:           str


class AudioMonitorRequest(BaseModel):
    audio_url:  str = Field(..., description="Audio URL to analyse")
    session_id: str | None = Field(default=None, description="Client session identifier")


class AudioMonitorResponse(BaseModel):
    fake_probability:     float
    risk_level:           Literal["LOW", "MEDIUM", "HIGH"]
    duration_seconds:     float
    analysis_type:        str
    forensic_explanation: list[str]
    trust_score:          float
    trust_score_delta:    float
    session_id:           str


class EnrichRequest(BaseModel):
    type:                 Literal["IMAGE", "VIDEO", "TEXT", "AUDIO"]
    url:                  str | None       = Field(default=None)
    text:                 str | None       = Field(default=None)
    title:                str | None       = Field(default=None)
    frame_scores:         list[float] | None = Field(default=None)
    frames_analysed:      int | None       = Field(default=None)
    duration_seconds:     float | None     = Field(default=None)
    forensic_explanation: list[str] | None = Field(default=None)


class LegalChatAPIRequest(BaseModel):
    """Request body for the /api/legal/chat endpoint."""
    entity_type:   Literal["IMAGE", "NEWS", "TEXT"] = Field(
        default="TEXT",
        description="Type of the detected entity being queried about",
    )
    context:       str = Field(
        default="",
        description=(
            "Free-text scenario description: e.g. 'image misuse', "
            "'deepfake', 'defamation', 'fake news', 'impersonation'"
        ),
    )
    country:       str = Field(
        default="India",
        description="Jurisdiction: 'India', 'Global', or 'Both'",
    )
    analysis_data: dict = Field(
        default_factory=dict,
        description=(
            "Optional detection pipeline outputs: fake_probability, "
            "misinformation_risk, credibility_score, "
            "ai_generated_probability, forensic_explanation"
        ),
    )


class LegalChatAPIResponse(BaseModel):
    """Structured legal chat guidance response."""
    scenario:           str
    rights_explanation: str
    relevant_sections:  list[str]
    steps_to_proceed:   list[str]
    evidence_needed:    list[str]
    reporting_paths:    list[str]
    analysis_context:   list[str]
    disclaimer:         str
    # AI enrichment fields (populated when HuggingFace Inference API is available)
    ai_explanation:     str | None = None   # free-text answer from generative model
    inlegal_context:    list[str]  = []     # InLegalBERT top legal terms


class LegalGenerateRequest(BaseModel):
    entity_id:    str = Field(default="N/A",     description="Internal entity identifier")
    entity_type:  Literal["IMAGE", "TEXT", "UNKNOWN"] = Field(default="UNKNOWN")
    source_url:   str = Field(default="",        description="Source URL of the content")
    content_title: str = Field(default="",       description="Title or description of content")
    ai_generated_probability: float | None = Field(default=None, ge=0.0, le=1.0)
    misinformation_risk:      str | None   = Field(default=None)
    credibility_score:        float | None = Field(default=None, ge=0.0, le=1.0)
    fake_probability:         float | None = Field(default=None, ge=0.0, le=1.0)
    forensic_findings:        list[str]    = Field(default_factory=list)
    ai_summary:               str | None   = Field(default=None)
    key_claims:               list[str]    = Field(default_factory=list)
    trust_score_delta:        float | None = Field(default=None)
    detected_at:              int | None   = Field(default=None, description="Detection timestamp (ms)")


class LegalGenerateResponse(BaseModel):
    complaint_draft:  str
    evidence_summary: dict
    disclaimer:       str


# ---------------------------------------------------------------------------
# Entity Tracking - Request/Response Models
# ---------------------------------------------------------------------------

class RegisterPersonRequest(BaseModel):
    """Request to register a protected person."""
    name: str = Field(..., description="Full name of the protected person")
    description: str = Field(default="", description="Description or context")
    category: str = Field(default="celebrity", description="Category: celebrity, client, public_figure, other")
    metadata: dict = Field(default_factory=dict, description="Additional metadata")


class RegisterPersonResponse(BaseModel):
    """Response after registering a protected person."""
    person_id: str
    name: str
    category: str
    embeddings_count: int
    message: str


class UpdatePersonRequest(BaseModel):
    """Request to update a protected person."""
    name: str | None = Field(default=None)
    description: str | None = Field(default=None)
    category: str | None = Field(default=None)
    is_active: bool | None = Field(default=None)
    metadata: dict | None = Field(default=None)


class PersonResponse(BaseModel):
    """Response containing protected person info."""
    person_id: str
    name: str
    description: str
    category: str
    embeddings_count: int
    is_active: bool
    created_at: str
    updated_at: str


class FaceMatchResponse(BaseModel):
    """A face match result."""
    person_id: str
    person_name: str
    similarity: float
    is_match: bool
    bbox: list[int]


class CheckFaceRequest(BaseModel):
    """Request to check an image for protected persons."""
    image_url: str | None = Field(default=None, description="URL of image to check")
    threshold: float = Field(default=0.6, ge=0.0, le=1.0, description="Match threshold")


class CheckFaceResponse(BaseModel):
    """Response from face checking."""
    faces_detected: int
    matches: list[FaceMatchResponse]
    potential_impersonation: bool
    highest_match_person: str | None
    highest_match_similarity: float


class ImpersonationAlertResponse(BaseModel):
    """An impersonation alert."""
    alert_id: str
    person_id: str
    person_name: str
    content_type: str
    content_url: str
    similarity_score: float
    status: str
    created_at: str


class AlertStatsResponse(BaseModel):
    """Statistics about impersonation alerts."""
    total_alerts: int
    pending_alerts: int
    confirmed_alerts: int
    dismissed_alerts: int
    alerts_by_person: dict


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, str]:
    """Liveness probe — returns {"status": "ok"} when the server is up."""
    return {"status": "ok"}


@app.post("/api/trust/reset")
async def reset_trust_score(payload: dict = None) -> dict:
    """Reset a session's trust score back to 100."""
    session_id = ((payload or {}).get("session_id") or "default-session").strip() or "default-session"
    await trust_engine.reset_score(session_id)
    return {"session_id": session_id, "trust_score": 100.0}


@app.get("/api/history")
async def get_history(
    type: str | None = None,
    risk_level: str | None = None,
    limit: int = 500,
) -> dict:
    """
    Return detection history with optional filters, newest-first.

    Query params:
        type        IMAGE or TEXT (case-insensitive)
        risk_level  LOW, MEDIUM, HIGH (case-insensitive)
        limit       Max records (default 500, max 2 000)
    """
    return await query_history(
        type_filter=type,
        risk_filter=risk_level,
        limit=limit,
    )


@app.post("/api/image-monitor/bytes", response_model=ImageMonitorResponse)
async def image_monitor_bytes(
    image: UploadFile = File(...),
    image_url: str = Form(default=""),
    session_id: str = Form(default=None),
) -> ImageMonitorResponse:
    """Analyse raw image bytes uploaded directly — bypasses backend re-fetch."""
    image_bytes = await image.read()
    if not image_bytes or len(image_bytes) < 100:
        raise HTTPException(status_code=422, detail="Empty or too-small image upload")

    analysis = await analyzer.analyze(image_bytes, image_url or "uploaded")
    logger.info(f"[main] Bytes upload ML analysis: {analysis.risk_level} ({analysis.fake_probability:.1%}) - {(image_url or 'upload')[:60]}")

    resolved_session_id = (session_id or "default-session").strip() or "default-session"
    trust_score, deduction = await trust_engine.update_score(resolved_session_id, analysis.fake_probability)

    url_for_hash = image_url or f"upload-{hashlib.sha256(image_bytes[:256]).hexdigest()[:16]}"
    asyncio.create_task(
        record_history({
            "entity_id":         hashlib.sha256(f"image-{url_for_hash}".encode()).hexdigest()[:16],
            "type":              "IMAGE",
            "source_url":        url_for_hash,
            "risk_level":        analysis.risk_level,
            "fake_probability":  round(analysis.fake_probability, 4),
            "trust_score_after": trust_score,
            "timestamp":         int(time.time() * 1000),
        })
    )

    return ImageMonitorResponse(
        fake_probability=analysis.fake_probability,
        risk_level=analysis.risk_level,
        forensic_explanation=analysis.forensic_explanation,
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=resolved_session_id,
    )


@app.post("/api/image-monitor", response_model=ImageMonitorResponse)
@limiter.limit("30/minute")
async def image_monitor(request: Request, payload: ImageMonitorRequest) -> ImageMonitorResponse:
    """Analyse a remote image URL for deepfake / synthetic-image signals."""
    try:
        image_url = payload.normalized_image_url()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    image_bytes = None
    analysis = None
    provenance_result = None
    try:
        image_bytes, provenance_result = await asyncio.gather(
            fetcher.fetch(image_url),
            check_provenance(image_url),
        )
        # fetcher.fetch() now returns None for CDN/network failures (no raise),
        # so we always call analyze() — it handles None via URL-hash heuristic.
        if image_bytes is None:
            logger.warning(f"[main] Fetch returned None, using URL heuristic: {image_url[:60]}")
        analysis = await analyzer.analyze(image_bytes, image_url)
        mode = "ML" if image_bytes else "heuristic"
        logger.info(f"[main] {mode} analysis: {analysis.risk_level} ({analysis.fake_probability:.1%}) - {image_url[:60]}...")
    except HTTPException as http_exc:
        if http_exc.status_code == 400:
            raise  # Re-raise SSRF / bad-scheme validation errors
        logger.warning(f"[main] HTTP {http_exc.status_code} error, falling back to heuristic: {image_url[:60]}")
        analysis = await analyzer.analyze(None, image_url)
        if provenance_result is None:
            provenance_result = await check_provenance(image_url)
    except Exception as exc:
        logger.error(f"[main] Unexpected error for {image_url[:60]}: {type(exc).__name__}: {exc}")
        raise

    if analysis is None:
        logger.error(f"[main] ERROR: analysis is None for {image_url[:60]}")
        raise RuntimeError("Analysis failed - image bytes unavailable")

    session_id = (payload.session_id or "default-session").strip() or "default-session"

    # Only update trust score for real ML analysis — heuristic results are
    # probabilistic estimates and should not erode session integrity.
    is_heuristic = image_bytes is None
    if is_heuristic:
        trust_score = await trust_engine.get_score(session_id)
        deduction = 0.0
    else:
        trust_score, deduction = await trust_engine.update_score(
            session_id, analysis.fake_probability
        )

    asyncio.create_task(
        record_history({
            "entity_id":        hashlib.sha256(
                                    f"image-{image_url}".encode()
                                ).hexdigest()[:16],
            "type":             "IMAGE",
            "source_url":       image_url,
            "risk_level":       analysis.risk_level,
            "fake_probability": round(analysis.fake_probability, 4),
            "trust_score_after": trust_score,
            "timestamp":        int(time.time() * 1000),
        })
    )

    return ImageMonitorResponse(
        fake_probability=analysis.fake_probability,
        risk_level=analysis.risk_level,
        forensic_explanation=analysis.forensic_explanation,
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=session_id,
        c2pa=provenance_result,
    )


@app.post("/api/text-monitor", response_model=TextMonitorResponse)
@limiter.limit("30/minute")
async def text_monitor(request: Request, payload: TextMonitorRequest) -> TextMonitorResponse:
    """Analyse article/text content for AI-generation and misinformation signals."""
    if not payload.text or len(payload.text.strip()) < 50:
        raise HTTPException(
            status_code=422, detail="Text must be at least 50 characters"
        )

    analysis = await text_analyzer.analyze(payload.text, payload.title, payload.url)

    session_id = (payload.session_id or "default-session").strip() or "default-session"
    
    # Determine risk level based on AI probability
    ai_prob = analysis["ai_generated_probability"]
    if ai_prob >= 0.70:
        risk_level = "HIGH"
    elif ai_prob >= 0.40:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"
    
    # Calculate trust penalty based on AI risk level (more relevant than misinformation markers)
    risk_to_penalty = {"LOW": 0.0, "MEDIUM": 0.1, "HIGH": 0.3}
    penalty = risk_to_penalty.get(risk_level, 0.0)
    trust_score, deduction = await trust_engine.update_score(session_id, penalty)

    asyncio.create_task(
        record_history({
            "entity_id":        hashlib.sha256(
                                    f"text-{payload.url}-{payload.title}".encode()
                                ).hexdigest()[:16],
            "type":             "TEXT",
            "source_url":       payload.url,
            "title":            payload.title,
            "risk_level":       risk_level,
            "fake_probability": round(analysis["ai_generated_probability"], 4),
            "trust_score_after": trust_score,
            "timestamp":        int(time.time() * 1000),
        })
    )

    return TextMonitorResponse(
        ai_generated_probability=analysis["ai_generated_probability"],
        risk_level=risk_level,
        misinformation_risk=analysis["misinformation_risk"],
        credibility_score=analysis["credibility_score"],
        explanation=analysis["explanation"],
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=session_id,
    )


@app.post("/api/video-monitor", response_model=VideoMonitorResponse)
@limiter.limit("10/minute")
async def video_monitor(request: Request, payload: VideoMonitorRequest) -> VideoMonitorResponse:
    """Analyse a video URL for deepfake / synthetic content using frame analysis."""
    if not payload.video_url or not payload.video_url.strip():
        raise HTTPException(status_code=422, detail="video_url is required")

    video_url = payload.video_url.strip()
    analysis = await video_analyzer.analyze(video_url)

    session_id = (payload.session_id or "default-session").strip() or "default-session"
    trust_score, deduction = await trust_engine.update_score(session_id, analysis.fake_probability)

    asyncio.create_task(
        record_history({
            "entity_id":         hashlib.sha256(f"video-{video_url}".encode()).hexdigest()[:16],
            "type":              "VIDEO",
            "source_url":        video_url,
            "risk_level":        analysis.risk_level,
            "fake_probability":  round(analysis.fake_probability, 4),
            "frames_analysed":   analysis.frames_analysed,
            "trust_score_after": trust_score,
            "timestamp":         int(time.time() * 1000),
        })
    )

    logger.info(f"[main] Video analysis: {analysis.risk_level} ({analysis.fake_probability:.1%}) - {video_url[:60]}...")

    return VideoMonitorResponse(
        fake_probability=analysis.fake_probability,
        risk_level=analysis.risk_level,
        frames_analysed=analysis.frames_analysed,
        frame_scores=analysis.frame_scores,
        forensic_explanation=analysis.explanation,
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=session_id,
    )


@app.post("/api/audio-monitor", response_model=AudioMonitorResponse)
@limiter.limit("20/minute")
async def audio_monitor(request: Request, payload: AudioMonitorRequest) -> AudioMonitorResponse:
    """Analyse an audio URL for synthetic voice / deepfake audio signals."""
    if not payload.audio_url or not payload.audio_url.strip():
        raise HTTPException(status_code=422, detail="audio_url is required")

    audio_url = payload.audio_url.strip()
    analysis = await audio_analyzer.analyze(audio_url)

    session_id = (payload.session_id or "default-session").strip() or "default-session"
    trust_score, deduction = await trust_engine.update_score(session_id, analysis.fake_probability)

    asyncio.create_task(
        record_history({
            "entity_id":         hashlib.sha256(f"audio-{audio_url}".encode()).hexdigest()[:16],
            "type":              "AUDIO",
            "source_url":        audio_url,
            "risk_level":        analysis.risk_level,
            "fake_probability":  round(analysis.fake_probability, 4),
            "duration_seconds":  analysis.duration_seconds,
            "trust_score_after": trust_score,
            "timestamp":         int(time.time() * 1000),
        })
    )

    logger.info(f"[main] Audio analysis: {analysis.risk_level} ({analysis.fake_probability:.1%}) - {audio_url[:60]}...")

    return AudioMonitorResponse(
        fake_probability=analysis.fake_probability,
        risk_level=analysis.risk_level,
        duration_seconds=analysis.duration_seconds,
        analysis_type=analysis.analysis_type,
        forensic_explanation=analysis.explanation,
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=session_id,
    )


@app.post("/api/enrich")
async def enrich_content(payload: EnrichRequest) -> dict:
    """
    Rich content enrichment beyond deepfake detection.
    Returns type-specific metadata: EXIF/colors for images, video metadata,
    NLP analysis for text, Whisper transcript for audio.
    """
    t = payload.type

    if t == "IMAGE":
        if not payload.url:
            return {"error": "url required for IMAGE enrichment"}
        image_bytes = None
        try:
            image_bytes = await fetcher.fetch(payload.url)
        except Exception:
            pass
        return await media_enricher.image.enrich(image_bytes or b"", payload.url or "")

    if t == "VIDEO":
        return await media_enricher.video.enrich(
            video_url=payload.url or "",
            frame_scores=payload.frame_scores or [],
            frames_analysed=payload.frames_analysed or 0,
        )

    if t == "TEXT":
        if not payload.text:
            return {"error": "text required for TEXT enrichment"}
        return media_enricher.text.enrich(
            text=payload.text,
            title=payload.title or "",
            url=payload.url or "",
        )

    if t == "AUDIO":
        return await media_enricher.audio.enrich(
            audio_url=payload.url or "",
            duration_seconds=payload.duration_seconds or 0,
            forensic_explanation=payload.forensic_explanation or [],
        )

    return {"error": f"Unknown type: {t}"}


class NewsScanRequest(BaseModel):
    article_url: str = Field(..., description="URL of the article to scan")
    session_id:  str | None = Field(default=None)


@app.post("/api/news-scanner")
async def news_scanner_endpoint(payload: NewsScanRequest) -> dict:
    """Fetch an article URL, extract body text, and run text-analysis pipeline."""
    if not payload.article_url.strip():
        raise HTTPException(status_code=422, detail="article_url is required")
    result = await news_scanner.scan(
        payload.article_url.strip(),
        session_id=(payload.session_id or "default"),
    )
    # Add trust score tracking (mirrors /api/text-monitor logic)
    ai_prob = result.get("ai_generated_probability", 0.0)
    if ai_prob >= 0.70:
        risk_level = "HIGH"
        penalty = 0.3
    elif ai_prob >= 0.40:
        risk_level = "MEDIUM"
        penalty = 0.1
    else:
        risk_level = "LOW"
        penalty = 0.0
    session_id = (payload.session_id or "default").strip() or "default"
    trust_score, deduction = await trust_engine.update_score(session_id, penalty)
    result["risk_level"] = risk_level
    result["trust_score"] = trust_score
    result["trust_score_delta"] = round(-deduction, 2)
    return result


@app.post("/api/legal/chat", response_model=LegalChatAPIResponse)
async def legal_chat(payload: LegalChatAPIRequest) -> LegalChatAPIResponse:
    """
    Jurisdiction-aware legal guidance chat for a detected entity.

    Accepts an entity type, a free-text scenario context, an optional
    jurisdiction preference, and optional detection pipeline outputs.
    Returns structured guidance covering:
      - Rights explanation
      - Relevant laws and provisions commonly referenced
      - Action steps
      - Evidence preservation checklist
      - Reporting pathways (platform / cyber cell / court)

    Design constraints (same as the rest of the legal pipeline):
    - Does NOT give legal advice.
    - Does NOT accuse anyone.
    - Does NOT assert that any content is illegal.
    - Uses probabilistic and informational language only.
    - Mandatory disclaimer included in every response.
    """
    result: _LegalChatResponse = run_legal_chat(
        entity_type=payload.entity_type,
        context=payload.context,
        country=payload.country,
        analysis_data=payload.analysis_data,
    )

    # Enrich with free HuggingFace AI (InLegalBERT + generative model).
    # Fire-and-forget: returns empty fields on any network/API failure.
    enrichment = await enrich_legal_response(
        user_query=payload.context or payload.entity_type,
        scenario=result.scenario,
        relevant_sections=result.relevant_sections,
    )

    return LegalChatAPIResponse(
        scenario=result.scenario,
        rights_explanation=result.rights_explanation,
        relevant_sections=result.relevant_sections,
        steps_to_proceed=result.steps_to_proceed,
        evidence_needed=result.evidence_needed,
        reporting_paths=result.reporting_paths,
        analysis_context=result.analysis_context,
        disclaimer=result.disclaimer,
        ai_explanation=enrichment.get("ai_explanation"),
        inlegal_context=enrichment.get("inlegal_context", []),
    )


@app.post("/api/legal/generate", response_model=LegalGenerateResponse)
async def legal_generate(payload: LegalGenerateRequest) -> LegalGenerateResponse:
    """
    Generate a neutral, platform-safe complaint draft for a detected entity.

    Design constraints:
    - No accusations or definitive claims of wrongdoing.
    - Probabilistic language throughout ("analysis suggests", "may indicate").
    - No references to specific jurisdictions or legal statutes.
    - Ethical, platform-neutral, read-only output.
    - Does NOT submit anything — returns text only.
    """
    output = build_legal_output(
        entity_id=payload.entity_id,
        entity_type=payload.entity_type,
        source_url=payload.source_url,
        content_title=payload.content_title,
        ai_generated_probability=payload.ai_generated_probability,
        misinformation_risk=payload.misinformation_risk,
        credibility_score=payload.credibility_score,
        fake_probability=payload.fake_probability,
        forensic_findings=payload.forensic_findings,
        ai_summary=payload.ai_summary,
        key_claims=payload.key_claims,
        trust_score_delta=payload.trust_score_delta,
        detected_at=payload.detected_at,
    )
    return LegalGenerateResponse(
        complaint_draft=output.complaint_draft,
        evidence_summary=output.evidence_summary,
        disclaimer=output.disclaimer,
    )


# ---------------------------------------------------------------------------
# Entity Tracking Routes
# ---------------------------------------------------------------------------

@app.post("/api/persons", response_model=RegisterPersonResponse)
async def register_person(
    payload: RegisterPersonRequest,
    image: UploadFile = File(None),
) -> RegisterPersonResponse:
    """
    Register a protected person for impersonation monitoring.
    
    Optionally upload a reference image to extract face embedding.
    """
    # Register the person
    person = await person_registry.register_person(
        name=payload.name,
        notes=payload.description or "",
        category=payload.category,
    )
    
    embeddings_count = 0
    
    # If image provided, extract embedding
    if image:
        image_bytes = await image.read()
        if image_bytes and len(image_bytes) > 100:
            embedding = await face_recognizer.extract_embedding(image_bytes)
            if embedding:
                await person_registry.add_embeddings(person.person_id, [embedding])
                embeddings_count = 1
    
    return RegisterPersonResponse(
        person_id=person.person_id,
        name=person.name,
        category=person.category,
        embeddings_count=embeddings_count,
        message=f"Protected person '{person.name}' registered successfully",
    )


@app.post("/api/persons/register", response_model=RegisterPersonResponse)
async def register_person_json(payload: RegisterPersonRequest) -> RegisterPersonResponse:
    """Register a protected person (JSON only, no image)."""
    person = await person_registry.register_person(
        name=payload.name,
        notes=payload.description or "",
        category=payload.category,
    )
    
    return RegisterPersonResponse(
        person_id=person.person_id,
        name=person.name,
        category=person.category,
        embeddings_count=0,
        message=f"Protected person '{person.name}' registered successfully",
    )


@app.get("/api/persons", response_model=list[PersonResponse])
async def list_persons(
    category: str | None = None,
    active_only: bool = True,
) -> list[PersonResponse]:
    """List all registered protected persons."""
    persons = await person_registry.list_persons(
        category=category,
        active_only=active_only,
    )
    
    return [
        PersonResponse(
            person_id=p.person_id,
            name=p.name,
            description=p.notes,
            category=p.category,
            embeddings_count=len(p.face_embeddings),
            is_active=p.is_active,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in persons
    ]


@app.get("/api/persons/{person_id}", response_model=PersonResponse)
async def get_person(person_id: str) -> PersonResponse:
    """Get details of a specific protected person."""
    person = await person_registry.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    
    return PersonResponse(
        person_id=person.person_id,
        name=person.name,
        description=person.notes,
        category=person.category,
        embeddings_count=len(person.face_embeddings),
        is_active=person.is_active,
        created_at=person.created_at,
        updated_at=person.updated_at,
    )


@app.put("/api/persons/{person_id}", response_model=PersonResponse)
async def update_person(person_id: str, payload: UpdatePersonRequest) -> PersonResponse:
    """Update a protected person's details."""
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    # PersonRegistry uses 'notes' not 'description'; drop unknown keys
    if 'description' in updates:
        updates['notes'] = updates.pop('description')
    updates.pop('metadata', None)

    person = await person_registry.update_person(person_id, **updates)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    return PersonResponse(
        person_id=person.person_id,
        name=person.name,
        description=person.notes,
        category=person.category,
        embeddings_count=len(person.face_embeddings),
        is_active=person.is_active,
        created_at=person.created_at,
        updated_at=person.updated_at,
    )


@app.delete("/api/persons/{person_id}")
async def delete_person(person_id: str) -> dict:
    """Delete a protected person."""
    success = await person_registry.delete_person(person_id)
    if not success:
        raise HTTPException(status_code=404, detail="Person not found")
    
    return {"message": "Person deleted successfully", "person_id": person_id}


@app.post("/api/persons/{person_id}/embeddings")
async def add_embedding(
    person_id: str,
    image: UploadFile = File(...),
) -> dict:
    """
    Add a face embedding from an image to a protected person.
    
    Upload reference images to improve face matching accuracy.
    """
    person = await person_registry.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    
    image_bytes = await image.read()
    if not image_bytes or len(image_bytes) < 100:
        raise HTTPException(status_code=422, detail="Invalid image")
    
    embedding = await face_recognizer.extract_embedding(image_bytes)
    if not embedding:
        raise HTTPException(status_code=422, detail="No face detected in image")
    
    await person_registry.add_embeddings(person_id, [embedding])

    return {
        "message": "Embedding added successfully",
        "person_id": person_id,
        "total_embeddings": len(person.face_embeddings) + 1,
    }


@app.post("/api/check-face", response_model=CheckFaceResponse)
async def check_face(
    payload: CheckFaceRequest = None,
    image: UploadFile = File(None),
) -> CheckFaceResponse:
    """
    Check an image for faces matching protected persons.
    
    Returns matches with similarity scores. Use for detecting
    potential impersonation in deepfake content.
    """
    image_bytes = None
    
    # Get image from upload or URL
    if image:
        image_bytes = await image.read()
    elif payload and payload.image_url:
        image_bytes = await fetcher.fetch(payload.image_url)
    
    if not image_bytes or len(image_bytes) < 100:
        raise HTTPException(status_code=422, detail="No valid image provided")
    
    # Detect faces
    faces = await face_recognizer.detect_faces(image_bytes)
    
    if not faces:
        return CheckFaceResponse(
            faces_detected=0,
            matches=[],
            potential_impersonation=False,
            highest_match_person=None,
            highest_match_similarity=0.0,
        )
    
    # Get all registered persons with embeddings
    persons = await person_registry.list_persons(active_only=True)
    registered = [
        {
            "person_id": p.person_id,
            "name": p.name,
            "embeddings": p.face_embeddings,
        }
        for p in persons
        if p.face_embeddings
    ]
    
    threshold = payload.threshold if payload else 0.6
    
    # Match faces against registered persons
    matches = await face_recognizer.match_faces(faces, registered, threshold)
    
    # Find highest match
    highest_match = max(matches, key=lambda m: m.similarity) if matches else None
    
    match_responses = [
        FaceMatchResponse(
            person_id=m.person_id,
            person_name=m.person_name,
            similarity=round(m.similarity, 3),
            is_match=m.is_match,
            bbox=list(m.bbox),
        )
        for m in matches
    ]
    
    potential_impersonation = any(m.is_match for m in matches)
    
    return CheckFaceResponse(
        faces_detected=len(faces),
        matches=match_responses,
        potential_impersonation=potential_impersonation,
        highest_match_person=highest_match.person_name if highest_match else None,
        highest_match_similarity=round(highest_match.similarity, 3) if highest_match else 0.0,
    )


@app.post("/api/check-face/bytes", response_model=CheckFaceResponse)
async def check_face_bytes(
    image: UploadFile = File(...),
    threshold: float = Form(default=0.6),
) -> CheckFaceResponse:
    """Check uploaded image bytes for protected persons."""
    image_bytes = await image.read()
    if not image_bytes or len(image_bytes) < 100:
        raise HTTPException(status_code=422, detail="Invalid image")
    
    # Detect faces
    faces = await face_recognizer.detect_faces(image_bytes)
    
    if not faces:
        return CheckFaceResponse(
            faces_detected=0,
            matches=[],
            potential_impersonation=False,
            highest_match_person=None,
            highest_match_similarity=0.0,
        )
    
    # Get all registered persons with embeddings
    persons = await person_registry.list_persons(active_only=True)
    registered = [
        {
            "person_id": p.person_id,
            "name": p.name,
            "embeddings": p.face_embeddings,
        }
        for p in persons
        if p.face_embeddings
    ]
    
    # Match faces
    matches = await face_recognizer.match_faces(faces, registered, threshold)
    
    highest_match = max(matches, key=lambda m: m.similarity) if matches else None
    
    match_responses = [
        FaceMatchResponse(
            person_id=m.person_id,
            person_name=m.person_name,
            similarity=round(m.similarity, 3),
            is_match=m.is_match,
            bbox=list(m.bbox),
        )
        for m in matches
    ]
    
    potential_impersonation = any(m.is_match for m in matches)
    
    return CheckFaceResponse(
        faces_detected=len(faces),
        matches=match_responses,
        potential_impersonation=potential_impersonation,
        highest_match_person=highest_match.person_name if highest_match else None,
        highest_match_similarity=round(highest_match.similarity, 3) if highest_match else 0.0,
    )


@app.get("/api/alerts", response_model=list[ImpersonationAlertResponse])
async def list_alerts(
    person_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[ImpersonationAlertResponse]:
    """List impersonation alerts."""
    alerts = await person_registry.get_alerts(
        person_id=person_id,
        status=status,
        limit=limit,
    )
    
    # Get person names
    person_names = {}
    for alert in alerts:
        if alert.person_id not in person_names:
            person = await person_registry.get_person(alert.person_id)
            person_names[alert.person_id] = person.name if person else "Unknown"
    
    return [
        ImpersonationAlertResponse(
            alert_id=a.alert_id,
            person_id=a.person_id,
            person_name=person_names.get(a.person_id, "Unknown"),
            content_type=a.content_type,
            content_url=a.content_url,
            similarity_score=a.similarity_score,
            status=a.status,
            created_at=a.created_at,
        )
        for a in alerts
    ]


@app.put("/api/alerts/{alert_id}/status")
async def update_alert_status(alert_id: str, status: str) -> dict:
    """Update an alert's status (pending, confirmed, dismissed)."""
    if status not in ("pending", "confirmed", "dismissed"):
        raise HTTPException(status_code=422, detail="Invalid status")
    
    success = await person_registry.update_alert_status(alert_id, status)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    return {"message": "Alert status updated", "alert_id": alert_id, "status": status}


@app.get("/api/alerts/stats", response_model=AlertStatsResponse)
async def get_alert_stats() -> AlertStatsResponse:
    """Get statistics about impersonation alerts."""
    stats = await person_registry.get_alert_stats()
    return AlertStatsResponse(**stats)


@app.get("/api/face-recognizer/status")
async def face_recognizer_status() -> dict:
    """Get face recognizer status and backend info."""
    await face_recognizer.initialize()
    return {
        "available": face_recognizer.is_available,
        "backend": face_recognizer.backend_name,
    }


# ─── Cases ────────────────────────────────────────────────────────────────────

class CaseCreateRequest(BaseModel):
    title: str
    description: str = ""
    workspace_id: str = ""

class CaseUpdateRequest(BaseModel):
    title: str = ""
    description: str = ""
    status: str = ""

class EvidenceAddRequest(BaseModel):
    entity_id: str = ""
    detection_type: str = ""
    source_url: str = ""
    risk_level: str = ""
    fake_probability: float = 0.0
    note: str = ""

@app.get("/api/cases")
async def list_cases(workspace_id: str = ""):
    cases = await db_list_cases(workspace_id or None)
    for c in cases:
        ev = await db_get_case_evidence(c["id"])
        c["evidence_count"] = len(ev)
    return {"cases": cases}

@app.post("/api/cases")
async def create_case(req: CaseCreateRequest):
    return await db_create_case({"title": req.title, "description": req.description, "workspace_id": req.workspace_id or None})

@app.get("/api/cases/{case_id}")
async def get_case(case_id: str):
    case = await db_get_case(case_id)
    if not case:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Case not found")
    return case

@app.put("/api/cases/{case_id}")
async def update_case(case_id: str, req: CaseUpdateRequest):
    await db_update_case(case_id, req.dict())
    return {"ok": True}

@app.delete("/api/cases/{case_id}")
async def delete_case(case_id: str):
    await db_delete_case(case_id)
    return {"ok": True}

@app.post("/api/cases/{case_id}/evidence")
async def add_case_evidence(case_id: str, req: EvidenceAddRequest):
    return await db_add_case_evidence(case_id, req.dict())

@app.get("/api/cases/{case_id}/evidence")
async def get_case_evidence(case_id: str):
    return {"evidence": await db_get_case_evidence(case_id)}

@app.get("/api/cases/{case_id}/export/edrm")
async def export_case_edrm(case_id: str):
    from fastapi.responses import Response
    xml = await db_export_case_edrm(case_id)
    return Response(content=xml, media_type="application/xml",
                    headers={"Content-Disposition": f"attachment; filename=case_{case_id}.xml"})


# ─── Community Hashes ─────────────────────────────────────────────────────────

class CommunityCheckRequest(BaseModel):
    hash: str
    content_type: str = "UNKNOWN"

class CommunityReportRequest(BaseModel):
    hash: str
    content_type: str = "UNKNOWN"
    risk_level: str = "HIGH"
    source_domain: str = ""

@app.get("/api/community/stats")
async def community_stats():
    return await db_community_stats()

@app.post("/api/community/check")
async def community_check(req: CommunityCheckRequest):
    result = await db_community_check(req.hash)
    return {"found": result is not None, "record": result}

@app.post("/api/community/report")
async def community_report(req: CommunityReportRequest):
    return await db_community_report(req.hash, req.content_type, req.risk_level, req.source_domain)


# ─── Feedback ─────────────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    entity_id: str = ""
    content_hash: str = ""
    user_label: str = "UNSURE"
    original_risk: str = ""
    original_probability: float = 0.0

@app.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest):
    await db_submit_feedback(req.dict())
    return {"ok": True}

@app.get("/api/feedback/stats")
async def feedback_stats():
    return await db_feedback_stats()


# ─── Creator Shield ───────────────────────────────────────────────────────────

class CreatorProfileRequest(BaseModel):
    name: str
    content_type: str = "general"
    description: str = ""
    metadata: dict = {}

@app.get("/api/creator/profiles")
async def list_creator_profiles():
    return {"profiles": await db_list_creator_profiles()}

@app.post("/api/creator/profiles")
async def create_creator_profile(req: CreatorProfileRequest):
    return await db_create_creator_profile(req.dict())

@app.delete("/api/creator/profiles/{profile_id}")
async def delete_creator_profile(profile_id: str):
    await db_delete_creator_profile(profile_id)
    return {"ok": True}


# ─── Social Monitors ──────────────────────────────────────────────────────────

class SocialMonitorRequest(BaseModel):
    platform: str
    handle: str
    rss_url: str = ""

@app.get("/api/social/feeds")
async def list_social_feeds():
    return {"feeds": await db_list_social_monitors()}

def _extract_handle(platform: str, raw: str) -> str:
    """Strip full URLs down to just the handle/channel-ID."""
    import re
    raw = raw.strip().rstrip("/")
    if platform == "youtube":
        # https://www.youtube.com/channel/UCxxxxxx  or  UCxxxxxx
        m = re.search(r"channel/([A-Za-z0-9_-]+)", raw)
        if m: return m.group(1)
        # https://www.youtube.com/@handle
        m = re.search(r"@([A-Za-z0-9_.-]+)", raw)
        if m: return m.group(1)
    elif platform in ("twitter", "instagram"):
        # https://www.instagram.com/handle  or  @handle  or  handle
        m = re.search(r"(?:instagram\.com|twitter\.com|x\.com)/([A-Za-z0-9_.]+)", raw)
        if m: return m.group(1)
        return raw.lstrip("@")
    return raw

def _build_rss_url(platform: str, handle: str, explicit_rss: str) -> str:
    if explicit_rss:
        return explicit_rss
    if platform == "youtube" and handle.startswith("UC"):
        return f"https://www.youtube.com/feeds/videos.xml?channel_id={handle}"
    if platform == "twitter":
        return f"https://nitter.privacydev.net/{handle}/rss"
    if platform == "instagram":
        # Primary: public RSSHub — may be rate-limited for heavy use
        return f"https://rsshub.app/instagram/user/{handle}"
    return ""

# Fallback RSS sources tried in order during scan
_FALLBACK_RSS = {
    "instagram": [
        "https://rsshub.app/instagram/user/{handle}",
        "https://rss.app/feeds/_YOIUNGz9smJkPLCN.xml",  # placeholder — user can configure
    ],
    "twitter": [
        "https://nitter.privacydev.net/{handle}/rss",
        "https://nitter.poast.org/{handle}/rss",
        "https://nitter.cz/{handle}/rss",
    ],
}

@app.post("/api/social/feeds")
async def add_social_feed(req: SocialMonitorRequest):
    handle = _extract_handle(req.platform, req.handle)
    rss_url = _build_rss_url(req.platform, handle, req.rss_url or "")
    return await db_add_social_monitor(req.platform, handle, rss_url)

@app.put("/api/social/feeds/{feed_id}/refresh-rss")
async def refresh_feed_rss(feed_id: int):
    """Re-compute and update the RSS URL for an existing feed (migration helper)."""
    feeds = await db_list_social_monitors()
    feed = next((f for f in feeds if f["id"] == feed_id), None)
    if not feed:
        from fastapi import HTTPException
        raise HTTPException(404)
    handle = _extract_handle(feed["platform"], feed["handle"])
    rss_url = _build_rss_url(feed["platform"], handle, "")
    import asyncio
    loop = asyncio.get_event_loop()
    def _update():
        import sqlite3, os
        db_path = os.path.join(os.path.dirname(__file__), "..", "data.db")
        conn = sqlite3.connect(db_path)
        conn.execute("UPDATE social_monitors SET handle=?, rss_url=? WHERE id=?", (handle, rss_url, feed_id))
        conn.commit(); conn.close()
    await loop.run_in_executor(None, _update)
    return {"id": feed_id, "handle": handle, "rss_url": rss_url}

@app.delete("/api/social/feeds/{feed_id}")
async def remove_social_feed(feed_id: int):
    await db_remove_social_monitor(feed_id)
    return {"ok": True}

@app.get("/api/social/scan")
async def scan_social_feeds():
    import httpx
    import xml.etree.ElementTree as ET

    BROWSER_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    async def _parse_rss_xml(text):
        root = ET.fromstring(text)
        ns_atom = {"atom": "http://www.w3.org/2005/Atom"}
        items = []
        entries = root.findall("atom:entry", ns_atom)
        if entries:
            for entry in entries[:8]:
                title_el = entry.find("atom:title", ns_atom)
                link_el  = entry.find("atom:link",  ns_atom)
                pub_el   = entry.find("atom:published", ns_atom)
                items.append({
                    "title": title_el.text if title_el is not None else "",
                    "url": link_el.get("href", "") if link_el is not None else "",
                    "published": pub_el.text if pub_el is not None else "",
                })
        else:
            for item in root.findall(".//item")[:8]:
                title_el = item.find("title")
                link_el  = item.find("link")
                pub_el   = item.find("pubDate")
                items.append({
                    "title": title_el.text if title_el is not None else "",
                    "url": link_el.text if link_el is not None else "",
                    "published": pub_el.text if pub_el is not None else "",
                })
        return items

    async def _scan_instagram(client, handle):
        """Scrape public Instagram profile via their web API (no key needed)."""
        import json, datetime
        # Instagram's internal GraphQL/web API used by their own website
        url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={handle}"
        headers = {**BROWSER_HEADERS,
                   "X-IG-App-ID": "936619743392459",
                   "X-Requested-With": "XMLHttpRequest",
                   "Referer": f"https://www.instagram.com/{handle}/"}
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        user = data.get("data", {}).get("user", {})
        edges = user.get("edge_owner_to_timeline_media", {}).get("edges", [])
        items = []
        for edge in edges[:8]:
            node = edge.get("node", {})
            shortcode = node.get("shortcode", "")
            caption_edges = node.get("edge_media_to_caption", {}).get("edges", [])
            caption = caption_edges[0]["node"]["text"] if caption_edges else node.get("accessibility_caption", "Instagram post")
            ts = node.get("taken_at_timestamp", 0)
            pub = datetime.datetime.utcfromtimestamp(ts).isoformat() if ts else ""
            items.append({
                "title": (caption[:120] + "…") if len(caption) > 120 else caption or "Instagram post",
                "url": f"https://www.instagram.com/p/{shortcode}/",
                "published": pub,
                "thumbnail": node.get("thumbnail_src", ""),
            })
        return items

    async def _scan_twitter(client, handle):
        """Fetch Twitter/X feed via Nitter RSS (try multiple public instances)."""
        nitter_instances = [
            "https://nitter.privacydev.net",
            "https://nitter.poast.org",
            "https://nitter.cz",
            "https://nitter.1d4.us",
        ]
        for base in nitter_instances:
            try:
                resp = await client.get(f"{base}/{handle}/rss", headers=BROWSER_HEADERS)
                if resp.status_code == 200:
                    return await _parse_rss_xml(resp.text)
            except Exception:
                continue
        raise Exception("All Nitter instances unavailable")

    feeds = await db_list_social_monitors()
    results = []
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        for feed in feeds:
            platform = feed["platform"]
            handle   = _extract_handle(platform, feed["handle"])
            feed_id  = feed["id"]
            try:
                items = []
                if platform == "instagram":
                    items = await _scan_instagram(client, handle)
                elif platform == "twitter":
                    items = await _scan_twitter(client, handle)
                elif platform == "youtube":
                    rss_url = feed.get("rss_url") or _build_rss_url("youtube", handle, "")
                    resp = await client.get(rss_url, headers=BROWSER_HEADERS)
                    resp.raise_for_status()
                    items = await _parse_rss_xml(resp.text)
                elif platform == "rss":
                    rss_url = feed.get("rss_url") or handle
                    resp = await client.get(rss_url, headers=BROWSER_HEADERS)
                    resp.raise_for_status()
                    items = await _parse_rss_xml(resp.text)

                for item in items:
                    results.append({"platform": platform, "handle": handle, "feed_id": feed_id, **item})

                if not items:
                    results.append({"platform": platform, "handle": handle,
                                    "error": "No posts found", "feed_id": feed_id})
            except httpx.HTTPStatusError as e:
                results.append({"platform": platform, "handle": handle,
                                 "error": f"HTTP {e.response.status_code} from {platform}", "feed_id": feed_id})
            except Exception as e:
                results.append({"platform": platform, "handle": handle,
                                 "error": str(e), "feed_id": feed_id})
    return {"results": results}


# ─── Workspaces ───────────────────────────────────────────────────────────────

class WorkspaceRequest(BaseModel):
    name: str
    description: str = ""

@app.get("/api/newsroom/workspaces")
async def list_workspaces():
    workspaces = await db_list_workspaces()
    for ws in workspaces:
        cases = await db_list_cases(ws["id"])
        ws["case_count"] = len(cases)
    return {"workspaces": workspaces}

@app.post("/api/newsroom/workspaces")
async def create_workspace(req: WorkspaceRequest):
    return await db_create_workspace({"name": req.name, "description": req.description})

@app.delete("/api/newsroom/workspaces/{ws_id}")
async def delete_workspace(ws_id: str):
    await db_delete_workspace(ws_id)
    return {"ok": True}


# ─── Web News Search ──────────────────────────────────────────────────────────

class NewsSearchRequest(BaseModel):
    query: str
    max_results: int = 10

@app.post("/api/news-search")
async def news_search(req: NewsSearchRequest):
    import httpx
    import xml.etree.ElementTree as ET
    import urllib.parse
    import re as _re

    _UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

    query = req.query.strip()
    if not query:
        return {"results": [], "ddg_answer": None, "query": query, "resolved_query": query}

    results = []
    ddg_answer = None
    seen_urls: set = set()

    # ── If a URL is given, resolve it to a searchable headline ───────────────
    is_url = query.startswith("http://") or query.startswith("https://")
    resolved_query = query

    if is_url:
        # Try to extract <title> from the page (short timeout so it doesn't hang)
        try:
            async with httpx.AsyncClient(timeout=5, follow_redirects=True, max_redirects=5) as client:
                r = await client.get(query, headers={"User-Agent": _UA})
                if r.status_code == 200:
                    m = _re.search(r"<title[^>]*>([^<]{5,200})</title>", r.text, _re.IGNORECASE)
                    if m:
                        raw = m.group(1).strip()
                        raw = _re.sub(r"\s*[\|\-–—]\s*[^|\-–—]{3,60}$", "", raw).strip()
                        if len(raw) > 8:
                            resolved_query = raw
        except Exception:
            pass

        # Fallback: extract readable keywords from the URL path
        if resolved_query == query:
            try:
                parsed = urllib.parse.urlparse(query)
                words = [w for w in _re.split(r"[/\-_]", parsed.path) if len(w) > 3 and not w.isdigit()]
                if words:
                    resolved_query = " ".join(words[:10])
            except Exception:
                pass

    search_q = resolved_query

    def _parse_rss(xml_bytes_or_str, max_n, default_source="News"):
        items_out = []
        try:
            if isinstance(xml_bytes_or_str, str):
                xml_bytes_or_str = xml_bytes_or_str.encode("utf-8", errors="replace")
            root = ET.fromstring(xml_bytes_or_str)
            channel = root.find("channel")
            for item in (channel.findall("item") if channel is not None else [])[:max_n]:
                title  = (item.findtext("title") or "").strip()
                link   = (item.findtext("link")  or "").strip()
                desc   = _re.sub(r"<[^>]+>", "", item.findtext("description") or "")[:280].strip()
                pub    = (item.findtext("pubDate") or "").strip()
                src_el = item.find("source")
                source = (src_el.text or "").strip() if src_el is not None else default_source
                if title and link:
                    items_out.append({"title": title, "url": link, "snippet": desc,
                                      "source": source or default_source, "date": pub})
        except Exception as _e:
            logger.warning(f"[news-search] RSS parse error: {_e}")
        return items_out

    encoded = urllib.parse.quote(search_q)

    # ── 1. GDELT Project (primary — free, no key, JSON) ──────────────────────
    try:
        gdelt_url = (
            f"https://api.gdeltproject.org/api/v2/doc/doc"
            f"?query={encoded}&mode=artlist&maxrecords={req.max_results}"
            f"&format=json&sort=DateDesc"
        )
        async with httpx.AsyncClient(timeout=12, follow_redirects=True, max_redirects=5) as client:
            r = await client.get(gdelt_url, headers={"User-Agent": _UA})
            if r.status_code == 200:
                data = r.json()
                for art in (data.get("articles") or [])[:req.max_results]:
                    url = art.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        results.append({
                            "title":   art.get("title", ""),
                            "url":     url,
                            "snippet": art.get("seendate", ""),
                            "source":  art.get("domain", "GDELT"),
                            "date":    art.get("seendate", ""),
                        })
    except Exception as _e:
        logger.warning(f"[news-search] GDELT error: {_e}")

    # ── 2. Google News RSS (supplement) ──────────────────────────────────────
    if len(results) < req.max_results:
        try:
            rss_url = f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en"
            async with httpx.AsyncClient(timeout=10, follow_redirects=True, max_redirects=5) as client:
                r = await client.get(rss_url, headers={"User-Agent": _UA})
                if r.status_code == 200:
                    for item in _parse_rss(r.content, req.max_results, "Google News"):
                        if item["url"] not in seen_urls:
                            seen_urls.add(item["url"])
                            results.append(item)
        except Exception as _e:
            logger.warning(f"[news-search] Google News error: {_e}")

    # ── 3. Bing News RSS (supplement) ────────────────────────────────────────
    if len(results) < 5:
        try:
            bing_url = f"https://www.bing.com/news/search?q={encoded}&format=RSS"
            async with httpx.AsyncClient(timeout=10, follow_redirects=True, max_redirects=5) as client:
                r = await client.get(bing_url, headers={"User-Agent": _UA})
                if r.status_code == 200:
                    for item in _parse_rss(r.content, req.max_results, "Bing News"):
                        if item["url"] not in seen_urls:
                            seen_urls.add(item["url"])
                            results.append(item)
        except Exception as _e:
            logger.warning(f"[news-search] Bing News error: {_e}")

    # ── 4. DuckDuckGo Instant Answer ─────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"https://api.duckduckgo.com/?q={encoded}&format=json&no_html=1&skip_disambig=1",
                headers={"User-Agent": _UA}
            )
            if r.status_code == 200:
                data = r.json()
                if data.get("AbstractText"):
                    ddg_answer = {
                        "text":   data["AbstractText"],
                        "url":    data.get("AbstractURL", ""),
                        "source": data.get("AbstractSource", ""),
                    }
                for topic in data.get("RelatedTopics", [])[:4]:
                    if isinstance(topic, dict) and topic.get("Text") and topic.get("FirstURL"):
                        url = topic["FirstURL"]
                        if url not in seen_urls:
                            seen_urls.add(url)
                            results.append({
                                "title":   topic["Text"][:120],
                                "url":     url,
                                "snippet": topic["Text"][:250],
                                "source":  "DuckDuckGo",
                                "date":    "",
                            })
    except Exception as _e:
        logger.warning(f"[news-search] DDG error: {_e}")

    final = results[:req.max_results]
    return {
        "results":        final,
        "ddg_answer":     ddg_answer,
        "query":          query,
        "resolved_query": resolved_query,
        "total":          len(final),
    }


# ─── Threat Map ───────────────────────────────────────────────────────────────

@app.get("/api/threat-map")
async def threat_map():
    return await db_threat_map_data()


# ─── Trust Badge ──────────────────────────────────────────────────────────────

@app.get("/api/badge/{url_hash}")
async def get_badge(url_hash: str):
    from fastapi.responses import Response
    record = await db_community_check(url_hash)
    if record:
        risk = record.get("risk_level", "HIGH")
        label = "HIGH RISK" if risk == "HIGH" else "MEDIUM RISK"
        color = "#f87171" if risk == "HIGH" else "#fbbf24"
    else:
        label = "VERIFIED HUMAN"
        color = "#34d399"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="160" height="22">
  <rect width="160" height="22" rx="3" fill="#111120"/>
  <rect x="0" y="0" width="72" height="22" rx="3" fill="rgba(139,92,246,0.15)"/>
  <text x="36" y="15" font-family="Arial,sans-serif" font-size="10" fill="#a78bfa" text-anchor="middle" font-weight="bold">Entity X</text>
  <text x="116" y="15" font-family="Arial,sans-serif" font-size="9" fill="{color}" text-anchor="middle" font-weight="bold">{label}</text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"})


# ─── Provenance Chain ─────────────────────────────────────────────────────────

class ProvenanceTrackRequest(BaseModel):
    url: str = Field(..., min_length=4)

@app.post("/api/provenance/track")
@limiter.limit("20/minute")
async def provenance_track(request: Request, body: ProvenanceTrackRequest):
    result = await track_provenance(body.url)
    return result

@app.get("/api/provenance/chain/{content_hash}")
async def provenance_chain(content_hash: str):
    chain = await db_query_provenance_chain(content_hash)
    return {"content_hash": content_hash, "chain": chain, "spread_count": sum(r.get("seen_count", 1) for r in chain)}


# ─── Generator Fingerprint ────────────────────────────────────────────────────

@app.post("/api/analyze/generator")
@limiter.limit("15/minute")
async def generator_fingerprint(request: Request, file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")
    result = await asyncio.to_thread(analyze_generator, data)
    return result


# ─── PDF Forgery Detection ────────────────────────────────────────────────────

@app.post("/api/analyze/pdf")
@limiter.limit("10/minute")
async def analyze_pdf_endpoint(request: Request, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files accepted")
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    result = await asyncio.to_thread(analyze_pdf, data)
    return result


# ─── Watchlist ────────────────────────────────────────────────────────────────

class WatchlistItemRequest(BaseModel):
    name:       str  = Field(..., min_length=1, max_length=120)
    keyword:    str  = Field("", max_length=200)
    url:        str  = Field("", max_length=2000)
    watch_type: str  = Field("keyword")
    threshold:  float = Field(0.4, ge=0.0, le=1.0)

@app.get("/api/watchlist")
async def list_watchlist():
    return await db_list_watchlist()

@app.post("/api/watchlist")
async def add_watchlist_item(body: WatchlistItemRequest):
    return await db_add_watchlist_item(body.model_dump())

@app.delete("/api/watchlist/{item_id}")
async def delete_watchlist_item(item_id: int):
    await db_delete_watchlist_item(item_id)
    return {"ok": True}

@app.get("/api/watchlist/alerts")
async def list_watchlist_alerts(unread_only: bool = False):
    return await db_list_watchlist_alerts(unread_only)

@app.put("/api/watchlist/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: int):
    await db_mark_alert_read(alert_id)
    return {"ok": True}

@app.post("/api/watchlist/scan")
@limiter.limit("5/minute")
async def trigger_watchlist_scan(request: Request):
    asyncio.create_task(run_watchlist_scan())
    return {"ok": True, "message": "Watchlist scan triggered"}


# ─── Confidence Timeline ──────────────────────────────────────────────────────

class TimelineRecordRequest(BaseModel):
    entity_id:    str   = Field(..., min_length=1)
    content_hash: str   = Field("", max_length=64)
    score:        float = Field(..., ge=0.0, le=1.0)
    score_type:   str   = Field("fake_probability")
    source:       str   = Field("")

@app.post("/api/timeline/record")
async def record_timeline(body: TimelineRecordRequest):
    await db_record_timeline(body.entity_id, body.content_hash, body.score, body.score_type, body.source)
    return {"ok": True}

@app.get("/api/timeline")
async def query_timeline(entity_id: str | None = None, content_hash: str | None = None, limit: int = 100):
    limit = max(1, min(limit, 500))
    return await db_query_timeline(entity_id, content_hash, limit)


# ─── Explain to a Judge ───────────────────────────────────────────────────────

class JudgeReportRequest(BaseModel):
    entity_id:                str
    entity_type:              str   = "UNKNOWN"
    source_url:               str   = ""
    content_title:            str   = ""
    detected_at:              int | None = None
    fake_probability:         float | None = None
    ai_generated_probability: float | None = None
    misinformation_risk:      str | None = None
    credibility_score:        float | None = None
    trust_score:              float | None = None
    forensic_findings:        list[str] = []
    key_claims:               list[str] = []
    ai_summary:               str | None = None
    legal_complaint:          str | None = None
    include_provenance:       bool = True
    include_timeline:         bool = True

@app.post("/api/legal/judge-report")
@limiter.limit("10/minute")
async def judge_report(request: Request, body: JudgeReportRequest):
    from fastapi.responses import HTMLResponse

    provenance_chain = []
    confidence_timeline = []
    generator_fp = None

    if body.include_provenance and body.source_url:
        try:
            prov_result = await track_provenance(body.source_url)
            provenance_chain = prov_result.get("chain", [])
            generator_fp = None  # fingerprint requires image bytes, not URL here
        except Exception:
            pass

    if body.include_timeline:
        try:
            confidence_timeline = await db_query_timeline(entity_id=body.entity_id, limit=50)
        except Exception:
            pass

    inp = JudgeReportInput(
        entity_id=body.entity_id,
        entity_type=body.entity_type,
        source_url=body.source_url,
        content_title=body.content_title,
        detected_at=body.detected_at,
        fake_probability=body.fake_probability,
        ai_generated_probability=body.ai_generated_probability,
        misinformation_risk=body.misinformation_risk,
        credibility_score=body.credibility_score,
        trust_score=body.trust_score,
        forensic_findings=body.forensic_findings,
        key_claims=body.key_claims,
        ai_summary=body.ai_summary,
        provenance_chain=provenance_chain,
        generator_fingerprint=generator_fp,
        confidence_timeline=confidence_timeline,
        legal_complaint=body.legal_complaint,
    )
    html_content = await asyncio.to_thread(generate_judge_report, inp)
    return HTMLResponse(content=html_content)

"""
backend.main – FastAPI application entry point.

Initialises singleton service instances and registers all API routes.

Start the server:
    uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from backend.ai.image_model import MockDeepfakeAnalyzer
from backend.ai.text_model  import MockTextAnalyzer
from backend.db.database    import record_history, query_history
from backend.monitor.image_scanner import SafeImageFetcher
from backend.trust.trust_engine    import TrustScoreEngine
from legal.guidance                import build_legal_output
from legal.legal_chat              import run_legal_chat, LegalChatResponse as _LegalChatResponse

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Entity X – Digital Integrity Monitor API",
    version="1.0.0",
    description=(
        "Backend API for Entity X: real-time detection of AI-generated, "
        "manipulated, and disinformation content."
    ),
)

# ---------------------------------------------------------------------------
# Singleton service instances
# ---------------------------------------------------------------------------

fetcher      = SafeImageFetcher()
analyzer     = MockDeepfakeAnalyzer()
text_analyzer = MockTextAnalyzer()
trust_engine = TrustScoreEngine()

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


class TextMonitorRequest(BaseModel):
    title:      str       = Field(description="Page title or article headline")
    url:        str       = Field(description="Source URL")
    text:       str       = Field(description="Extracted article text")
    word_count: int       = Field(description="Word count of the text")
    timestamp:  int       = Field(description="Timestamp when text was extracted")
    session_id: str | None = Field(default=None, description="Client session identifier")


class TextMonitorResponse(BaseModel):
    ai_generated_probability: float
    misinformation_risk:      Literal["LOW", "MEDIUM", "HIGH"]
    credibility_score:        float
    explanation:              list[str]
    trust_score:              float
    trust_score_delta:        float
    session_id:               str


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
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, str]:
    """Liveness probe — returns {"status": "ok"} when the server is up."""
    return {"status": "ok"}


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


@app.post("/api/image-monitor", response_model=ImageMonitorResponse)
async def image_monitor(payload: ImageMonitorRequest) -> ImageMonitorResponse:
    """Analyse a remote image URL for deepfake / synthetic-image signals."""
    try:
        image_url = payload.normalized_image_url()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    image_bytes = None
    try:
        image_bytes = await fetcher.fetch(image_url)
        analysis = await analyzer.analyze(image_bytes, image_url)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[main] Fetch failed for {image_url}: {exc}")
        analysis = await analyzer.analyze(None, image_url)

    session_id = (payload.session_id or "default-session").strip() or "default-session"
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
    )


@app.post("/api/text-monitor", response_model=TextMonitorResponse)
async def text_monitor(payload: TextMonitorRequest) -> TextMonitorResponse:
    """Analyse article/text content for AI-generation and misinformation signals."""
    if not payload.text or len(payload.text.strip()) < 50:
        raise HTTPException(
            status_code=422, detail="Text must be at least 50 characters"
        )

    analysis = await text_analyzer.analyze(payload.text, payload.title, payload.url)

    session_id = (payload.session_id or "default-session").strip() or "default-session"
    risk_to_penalty = {"LOW": 0.0, "MEDIUM": 0.1, "HIGH": 0.3}
    penalty = risk_to_penalty.get(analysis["misinformation_risk"], 0.0)
    trust_score, deduction = await trust_engine.update_score(session_id, penalty)

    asyncio.create_task(
        record_history({
            "entity_id":        hashlib.sha256(
                                    f"text-{payload.url}-{payload.title}".encode()
                                ).hexdigest()[:16],
            "type":             "TEXT",
            "source_url":       payload.url,
            "title":            payload.title,
            "risk_level":       analysis["misinformation_risk"],
            "fake_probability": round(analysis["ai_generated_probability"], 4),
            "trust_score_after": trust_score,
            "timestamp":        int(time.time() * 1000),
        })
    )

    return TextMonitorResponse(
        ai_generated_probability=analysis["ai_generated_probability"],
        misinformation_risk=analysis["misinformation_risk"],
        credibility_score=analysis["credibility_score"],
        explanation=analysis["explanation"],
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=session_id,
    )


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
    return LegalChatAPIResponse(
        scenario=result.scenario,
        rights_explanation=result.rights_explanation,
        relevant_sections=result.relevant_sections,
        steps_to_proceed=result.steps_to_proceed,
        evidence_needed=result.evidence_needed,
        reporting_paths=result.reporting_paths,
        analysis_context=result.analysis_context,
        disclaimer=result.disclaimer,
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

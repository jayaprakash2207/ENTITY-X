from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import math
import socket
import time
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MAX_IMAGE_BYTES = 10 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 6.0
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
}

app = FastAPI(title="Entity X Image Monitor API", version="0.1.0")


class ImageMonitorRequest(BaseModel):
    image_url: str | None = Field(default=None, description="Image URL to analyze")
    url: str | None = Field(default=None, description="Backward-compatible alias")
    session_id: str | None = Field(default=None, description="Client session identifier")

    def normalized_image_url(self) -> str:
        candidate = (self.image_url or self.url or "").strip()
        if not candidate:
            raise ValueError("image_url is required")
        return candidate


class ImageMonitorResponse(BaseModel):
    fake_probability: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    forensic_explanation: list[str]
    trust_score: float
    trust_score_delta: float
    session_id: str


class TextMonitorRequest(BaseModel):
    """Request for text/article analysis."""
    title: str = Field(description="Page title or article headline")
    url: str = Field(description="Source URL")
    text: str = Field(description="Extracted article text")
    word_count: int = Field(description="Word count of the text")
    timestamp: int = Field(description="Timestamp when text was extracted")
    session_id: str | None = Field(default=None, description="Client session identifier")


class TextMonitorResponse(BaseModel):
    """Response from text/article analyzer."""
    ai_generated_probability: float
    misinformation_risk: Literal["LOW", "MEDIUM", "HIGH"]
    credibility_score: float
    explanation: list[str]
    trust_score: float
    trust_score_delta: float
    session_id: str


# ── Legal Complaint Generator ──────────────────────────────────────────────────

class LegalGenerateRequest(BaseModel):
    """Input needed to produce a neutral complaint draft."""
    entity_id: str = Field(default="N/A", description="Internal entity identifier")
    entity_type: Literal["IMAGE", "TEXT", "UNKNOWN"] = Field(default="UNKNOWN")
    source_url: str = Field(default="", description="Source URL of the content")
    content_title: str = Field(default="", description="Title or description of the content")
    # Scored evidence fields (all optional — absent values are omitted from draft)
    ai_generated_probability: float | None = Field(default=None, ge=0.0, le=1.0)
    misinformation_risk: str | None = Field(default=None)
    credibility_score: float | None = Field(default=None, ge=0.0, le=1.0)
    fake_probability: float | None = Field(default=None, ge=0.0, le=1.0)
    forensic_findings: list[str] = Field(default_factory=list)
    ai_summary: str | None = Field(default=None)
    key_claims: list[str] = Field(default_factory=list)
    trust_score_delta: float | None = Field(default=None)
    detected_at: int | None = Field(default=None, description="Detection timestamp (ms epoch)")


class LegalGenerateResponse(BaseModel):
    """Neutral, probabilistic complaint draft — not legal advice."""
    complaint_draft: str
    evidence_summary: dict
    disclaimer: str


@app.post("/api/legal/generate", response_model=LegalGenerateResponse)
async def legal_generate(payload: LegalGenerateRequest) -> LegalGenerateResponse:
    """
    Generate a neutral, platform-safe complaint draft for a detected entity.

    Design constraints:
    - No accusations or definitive claims of wrongdoing
    - Probabilistic language throughout ("analysis suggests", "may indicate")
    - No references to specific jurisdictions or legal statutes
    - Ethical, platform-neutral, read-only output
    - Does NOT submit anything — returns text only
    """
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    detected_ts = (
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(payload.detected_at / 1000))
        if payload.detected_at else now_iso
    )

    entity_type_label = {
        "IMAGE": "image content",
        "TEXT":  "text/article content",
        "UNKNOWN": "digital content"
    }.get(payload.entity_type, "digital content")

    source_display = payload.source_url or "source URL not recorded"
    title_display  = payload.content_title or "title not available"

    # ── Evidence narrative ──────────────────────────────────────────────────────
    evidence_lines: list[str] = []

    if payload.ai_generated_probability is not None:
        pct = round(payload.ai_generated_probability * 100, 1)
        qualifier = (
            "a high probability" if pct >= 70
            else "a moderate probability" if pct >= 40
            else "a low probability"
        )
        evidence_lines.append(
            f"Automated analysis estimates {qualifier} ({pct}%) that this content "
            f"may have been produced or significantly altered by generative AI systems."
        )

    if payload.fake_probability is not None and payload.entity_type == "IMAGE":
        fpct = round(payload.fake_probability * 100, 1)
        evidence_lines.append(
            f"Image authenticity scoring indicates a synthetic or manipulated origin "
            f"probability of {fpct}%."
        )

    if payload.misinformation_risk:
        risk = payload.misinformation_risk.upper()
        risk_desc = {
            "HIGH":   "a high potential for misleading readers",
            "MEDIUM": "a moderate potential for misleading readers",
            "LOW":    "a low potential for misleading readers"
        }.get(risk, "an undetermined potential for misleading readers")
        evidence_lines.append(
            f"Content-level analysis indicates {risk_desc} based on "
            f"automated heuristic and model-based assessment."
        )

    if payload.credibility_score is not None:
        cpct = round(payload.credibility_score * 100, 1)
        evidence_lines.append(
            f"An automated credibility indicator placed this content at "
            f"{cpct}/100, suggesting {'reduced' if cpct < 50 else 'moderate'} verifiability "
            f"relative to reference baseline datasets."
        )

    if payload.forensic_findings:
        evidence_lines.append("Forensic detection findings include:")
        for i, finding in enumerate(payload.forensic_findings[:10], 1):
            evidence_lines.append(f"  {i}. {finding}")

    if payload.ai_summary:
        evidence_lines.append(f"Model-generated summary of content: \"{payload.ai_summary}\"")

    if payload.key_claims:
        evidence_lines.append("Identified claims within the content:")
        for i, claim in enumerate(payload.key_claims[:8], 1):
            evidence_lines.append(f"  {i}. {claim}")

    if payload.trust_score_delta is not None:
        delta = round(abs(payload.trust_score_delta), 2)
        if delta > 0:
            evidence_lines.append(
                f"This detection contributed a trust score decrement of {delta} points "
                f"to the active session's running integrity index."
            )

    evidence_block = "\n".join(evidence_lines) or "No quantitative evidence data provided."

    # ── Complaint draft ─────────────────────────────────────────────────────────
    draft_lines = [
        "CONTENT REVIEW REQUEST",
        "=" * 54,
        f"Reference ID  : {payload.entity_id}",
        f"Report date   : {now_iso}",
        f"Detection date: {detected_ts}",
        f"Content type  : {entity_type_label.upper()}",
        f"Content title : {title_display}",
        f"Source URL    : {source_display}",
        "=" * 54,
        "",
        "TO WHOM IT MAY CONCERN,",
        "",
        f"I am writing to bring to your attention {entity_type_label} that has been "
        "flagged by an automated digital-integrity monitoring system for further "
        "platform review.",
        "",
        "The content was submitted to automated forensic analysis. "
        "The results of that analysis are summarised below. "
        "Please note that these findings are probabilistic in nature and do not "
        "constitute a definitive determination. Independent verification is recommended.",
        "",
        "-" * 54,
        "AUTOMATED ANALYSIS FINDINGS",
        "-" * 54,
        "",
        evidence_block,
        "",
        "-" * 54,
        "REQUESTED ACTION",
        "-" * 54,
        "",
        "I respectfully request that your platform's trust and safety team:",
        "",
        "  1. Review the referenced content against your community guidelines and "
        "content authenticity policies.",
        "  2. Consider applying appropriate content labels, reduced distribution, or "
        "removal if your review determines a policy violation has occurred.",
        "  3. Provide any available transparency information regarding the provenance "
        "review of this content.",
        "",
        "I understand that final moderation decisions rest solely with your platform "
        "and that automated analysis tools provide supplementary signals only.",
        "",
        "-" * 54,
        "EVIDENCE PRESERVATION",
        "-" * 54,
        "",
        "A full forensic report for this entity has been retained locally and is "
        "available to share with relevant parties upon request. "
        "No modifications have been made to the original content or its metadata.",
        "",
        "=" * 54,
        "Report generated automatically by Entity X v1.0.",
        "This document is a structured request for platform review and does not",
        "constitute a legal filing, formal complaint, or legal advice of any kind.",
        "Submitting party bears sole responsibility for verifying these findings",
        "and determining appropriate use of this document.",
        "=" * 54,
    ]
    complaint_draft = "\n".join(draft_lines)

    # ── Evidence summary object ─────────────────────────────────────────────────
    evidence_summary: dict = {
        "entity_id":    payload.entity_id,
        "entity_type":  payload.entity_type,
        "source_url":   payload.source_url,
        "detected_at":  detected_ts,
        "report_date":  now_iso,
    }
    if payload.ai_generated_probability is not None:
        evidence_summary["ai_generated_probability"] = round(payload.ai_generated_probability, 4)
    if payload.fake_probability is not None:
        evidence_summary["fake_probability"] = round(payload.fake_probability, 4)
    if payload.misinformation_risk:
        evidence_summary["misinformation_risk"] = payload.misinformation_risk.upper()
    if payload.credibility_score is not None:
        evidence_summary["credibility_score"] = round(payload.credibility_score, 4)
    if payload.forensic_findings:
        evidence_summary["forensic_findings"] = payload.forensic_findings
    if payload.key_claims:
        evidence_summary["key_claims"] = payload.key_claims
    if payload.ai_summary:
        evidence_summary["ai_summary"] = payload.ai_summary

    disclaimer = (
        "IMPORTANT — NOT LEGAL ADVICE: "
        "This document was generated automatically by Entity X, an informational "
        "tool. It does not constitute legal advice, a formal legal complaint, "
        "or any filing with a regulatory authority. "
        "All analysis results are probabilistic estimates produced by automated "
        "systems and may contain errors. "
        "You are solely responsible for reviewing, editing, and deciding whether "
        "to use this document. "
        "Consult a qualified legal professional before taking any formal action."
    )

    return LegalGenerateResponse(
        complaint_draft=complaint_draft,
        evidence_summary=evidence_summary,
        disclaimer=disclaimer,
    )


# ── Legal Awareness Chat ────────────────────────────────────────────────────────
class LegalChatHttpRequest(BaseModel):
    """HTTP wrapper for a legal-awareness chat session."""
    entity_type: Literal["IMAGE", "NEWS", "TEXT"] = Field(default="TEXT")
    context:     str   = Field(default="",      description="Scenario or user query text")
    country:     str   = Field(default="India",  description="India | Global | Both")
    analysis_data: dict = Field(default_factory=dict)


class LegalChatHttpResponse(BaseModel):
    scenario:           str
    rights_explanation: str
    relevant_sections:  list[str]
    steps_to_proceed:   list[str]
    evidence_needed:    list[str]
    reporting_paths:    list[str]
    analysis_context:   list[str]
    disclaimer:         str


@app.post("/api/legal/chat", response_model=LegalChatHttpResponse)
async def legal_chat(payload: LegalChatHttpRequest) -> LegalChatHttpResponse:
    """
    Rule-based legal awareness chat endpoint.
    Returns jurisdiction-aware guidance for digital content threats.
    All responses are general awareness only — not legal advice.
    """
    try:
        from legal.legal_chat import LegalChatEngine, LegalChatRequest  # type: ignore
        engine = LegalChatEngine()
        req = LegalChatRequest(
            entity_type=payload.entity_type,
            context=payload.context,
            country=payload.country,
            analysis_data=payload.analysis_data,
        )
        result = engine.build_response(req)
        return LegalChatHttpResponse(
            scenario=result.scenario,
            rights_explanation=result.rights_explanation,
            relevant_sections=result.relevant_sections,
            steps_to_proceed=result.steps_to_proceed,
            evidence_needed=result.evidence_needed,
            reporting_paths=result.reporting_paths,
            analysis_context=result.analysis_context,
            disclaimer=result.disclaimer,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class SafeImageFetcher:
    def __init__(self, timeout_seconds: float = REQUEST_TIMEOUT_SECONDS, max_bytes: int = MAX_IMAGE_BYTES) -> None:
        self.timeout = httpx.Timeout(timeout_seconds, connect=timeout_seconds, read=timeout_seconds)
        self.max_bytes = max_bytes

    async def fetch(self, image_url: str) -> bytes:
        self._validate_url_format(image_url)
        await self._ensure_public_host(image_url)

        limits = httpx.Limits(max_keepalive_connections=10, max_connections=20)
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True, limits=limits) as client:
            async with client.stream("GET", image_url, headers={"User-Agent": "EntityXMonitor/0.1"}) as response:
                if response.status_code != 200:
                    raise HTTPException(status_code=422, detail="Unable to fetch image from the provided URL")

                content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
                if content_type and content_type not in ALLOWED_CONTENT_TYPES:
                    raise HTTPException(status_code=415, detail="Content type is not a supported image format")

                advertised_size = response.headers.get("content-length")
                if advertised_size and advertised_size.isdigit() and int(advertised_size) > self.max_bytes:
                    raise HTTPException(status_code=413, detail="Image exceeds maximum allowed size")

                collected = bytearray()
                async for chunk in response.aiter_bytes(64 * 1024):
                    if not chunk:
                        continue
                    collected.extend(chunk)
                    if len(collected) > self.max_bytes:
                        raise HTTPException(status_code=413, detail="Image exceeds maximum allowed size")

                if not collected:
                    raise HTTPException(status_code=422, detail="Fetched payload is empty")

                if not content_type and not self._looks_like_image_bytes(collected):
                    raise HTTPException(status_code=415, detail="Fetched payload does not appear to be an image")

                return bytes(collected)

    @staticmethod
    def _validate_url_format(image_url: str) -> None:
        parsed = urlparse(image_url)
        if parsed.scheme not in {"http", "https"}:
            raise HTTPException(status_code=400, detail="image_url must use http or https")
        if not parsed.netloc:
            raise HTTPException(status_code=400, detail="image_url host is missing")

    async def _ensure_public_host(self, image_url: str) -> None:
        parsed = urlparse(image_url)
        hostname = parsed.hostname
        if not hostname:
            raise HTTPException(status_code=400, detail="image_url host is invalid")

        try:
            ip_literal = ipaddress.ip_address(hostname)
            if self._is_private_or_reserved(ip_literal):
                raise HTTPException(status_code=400, detail="Private or reserved hosts are not allowed")
            return
        except ValueError:
            pass

        try:
            addr_info = await self._resolve_hostname(hostname)
        except socket.gaierror as exc:
            raise HTTPException(status_code=422, detail="Could not resolve image host") from exc

        for entry in addr_info:
            ip_text = entry[4][0]
            ip_obj = ipaddress.ip_address(ip_text)
            if self._is_private_or_reserved(ip_obj):
                raise HTTPException(status_code=400, detail="Private or reserved hosts are not allowed")

    @staticmethod
    async def _resolve_hostname(hostname: str):
        return await asyncio.to_thread(socket.getaddrinfo, hostname, None)

    @staticmethod
    def _is_private_or_reserved(ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
        return any(
            [
                ip_obj.is_private,
                ip_obj.is_loopback,
                ip_obj.is_link_local,
                ip_obj.is_multicast,
                ip_obj.is_unspecified,
                ip_obj.is_reserved,
            ]
        )

    @staticmethod
    def _looks_like_image_bytes(blob: bytes) -> bool:
        signatures = (
            b"\xFF\xD8\xFF",
            b"\x89PNG\r\n\x1a\n",
            b"GIF87a",
            b"GIF89a",
            b"RIFF",
            b"BM",
            b"II*\x00",
            b"MM\x00*",
        )
        return any(blob.startswith(signature) for signature in signatures)


class AnalysisResult(BaseModel):
    """Result from the deepfake analyzer (without trust scoring)."""
    fake_probability: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    forensic_explanation: list[str]


class MockDeepfakeAnalyzer:
    """Heuristic analyzer with a Hugging Face-ready interface."""

    async def analyze(self, image_bytes: bytes | None, image_url: str) -> AnalysisResult:
        # If we couldn't fetch the image, return a neutral analysis with low confidence
        if not image_bytes:
            return AnalysisResult(
                fake_probability=0.0,
                risk_level="LOW",
                forensic_explanation=[
                    "Unable to fetch image data for analysis.",
                    "This likely indicates a network timeout or temporary connectivity issue.",
                    "The image has been logged for monitoring, but actual deepfake analysis requires image content.",
                    "Trust score remains unchanged due to limited analysis confidence.",
                ],
            )

        digest = hashlib.sha256(image_bytes[:2048] + image_url.encode("utf-8")).digest()
        pseudo_seed = int.from_bytes(digest[:8], byteorder="big")

        entropy_sample = image_bytes[: min(len(image_bytes), 8192)]
        entropy = self._byte_entropy(entropy_sample)

        base = (pseudo_seed % 1000) / 1000.0
        entropy_signal = max(0.0, min(1.0, (entropy - 5.0) / 3.0))
        score = max(0.01, min(0.99, 0.65 * base + 0.35 * entropy_signal))

        lighting_signal = self._indicator_probability(digest[8], entropy_signal, bias=0.05)
        texture_signal = self._indicator_probability(digest[16], base, bias=-0.03)
        compression_signal = self._indicator_probability(digest[24], (base + entropy_signal) / 2.0, bias=0.0)

        risk_level: Literal["LOW", "MEDIUM", "HIGH"]
        if score >= 0.75:
            risk_level = "HIGH"
        elif score >= 0.4:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        explanations = [
            "This output reflects probabilistic forensic cues from a lightweight heuristic model and should not be treated as a definitive finding.",
            f"Estimated manipulation likelihood is approximately {score:.2f}, which suggests a {risk_level.lower()}-to-moderate concern level rather than certainty.",
            f"Inconsistent lighting cue: approximately {lighting_signal:.2f} likelihood of illumination mismatch patterns that may be consistent with synthetic or edited content.",
            f"Unnatural texture cue: approximately {texture_signal:.2f} likelihood of atypical texture continuity, which can occur in generated imagery but may also appear in heavily processed authentic images.",
            f"Compression artifact cue: approximately {compression_signal:.2f} likelihood of artifact structure divergence; this can indicate recompression or generation effects, but it is not conclusive on its own.",
            "For higher-confidence interpretation, combine this estimate with model-based analysis (for example, a dedicated Hugging Face classifier), metadata review, and provenance checks.",
        ]

        return AnalysisResult(
            fake_probability=round(score, 4),
            risk_level=risk_level,
            forensic_explanation=explanations,
        )

    @staticmethod
    def _byte_entropy(data: bytes) -> float:
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
            probability = count / total
            entropy -= probability * math.log2(probability)
        return entropy

    @staticmethod
    def _indicator_probability(raw_signal: int, blended_signal: float, bias: float = 0.0) -> float:
        normalized_raw = raw_signal / 255.0
        blended = (0.6 * normalized_raw) + (0.4 * max(0.0, min(1.0, blended_signal))) + bias
        return round(max(0.01, min(0.99, blended)), 2)


class TrustScoreEngine:
    def __init__(self, initial_score: float = 100.0) -> None:
        self.initial_score = initial_score
        self._session_scores: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def update_score(self, session_id: str, fake_probability: float) -> tuple[float, float]:
        bounded_probability = max(0.0, min(1.0, fake_probability))
        deduction = round(bounded_probability * 100.0, 2)

        async with self._lock:
            current_score = self._session_scores.get(session_id, self.initial_score)
            updated_score = round(max(0.0, current_score - deduction), 2)
            self._session_scores[session_id] = updated_score

        return updated_score, deduction


fetcher = SafeImageFetcher()
analyzer = MockDeepfakeAnalyzer()
trust_engine = TrustScoreEngine()

# In-memory global detection history
# Each record: {entity_id, type, source_url, risk_level, fake_probability, trust_score_after, timestamp}
_history: list[dict] = []
_history_lock = asyncio.Lock()

MAX_HISTORY = 10_000  # cap to prevent unbounded growth

async def _record_history(record: dict) -> None:
    """Append a detection record to the in-memory history store."""
    async with _history_lock:
        _history.append(record)
        if len(_history) > MAX_HISTORY:
            del _history[0]  # drop oldest
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/history")
async def get_history(
    type: str | None = None,
    risk_level: str | None = None,
    limit: int = 500
) -> dict:
    """
    Return detection history with optional filters.
    Query params:
      type       — IMAGE or TEXT (case-insensitive)
      risk_level — LOW, MEDIUM, HIGH (case-insensitive)
      limit      — max records to return (default 500, max 2000)
    Records are returned newest-first.
    """
    async with _history_lock:
        records = list(reversed(_history))  # newest first

    if type:
        t = type.upper()
        records = [r for r in records if r.get("type", "").upper() == t]

    if risk_level:
        rl = risk_level.upper()
        records = [r for r in records if r.get("risk_level", "").upper() == rl]

    limit = max(1, min(limit, 2000))
    return {"records": records[:limit], "total": len(records)}


@app.post("/api/image-monitor", response_model=ImageMonitorResponse)
async def image_monitor(payload: ImageMonitorRequest) -> ImageMonitorResponse:
    try:
        image_url = payload.normalized_image_url()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Try to fetch and analyze the image
    # If fetch fails due to network timeout, return a neutral analysis
    # rather than 500 error
    image_bytes = None
    try:
        image_bytes = await fetcher.fetch(image_url)
        analysis = await analyzer.analyze(image_bytes, image_url)
    except HTTPException:
        # Re-raise HTTP errors from validation
        raise
    except Exception as exc:
        # Network/timeout errors: return neutral analysis
        # This allows the sidebar to display detection events even if
        # actual image fetch failed (e.g., network unavailable)
        print(f"[BACKEND] Fetch failed for {image_url}: {exc}")
        analysis = await analyzer.analyze(None, image_url)

    session_id = (payload.session_id or "default-session").strip() or "default-session"
    trust_score, deduction = await trust_engine.update_score(session_id, analysis.fake_probability)

    # Record detection to global history (fire-and-forget background task)
    asyncio.create_task(_record_history({
        "entity_id": hashlib.sha256(f"image-{image_url}".encode()).hexdigest()[:16],
        "type": "IMAGE",
        "source_url": image_url,
        "risk_level": analysis.risk_level,
        "fake_probability": round(analysis.fake_probability, 4),
        "trust_score_after": trust_score,
        "timestamp": int(time.time() * 1000)
    }))

    return ImageMonitorResponse(
        fake_probability=analysis.fake_probability,
        risk_level=analysis.risk_level,
        forensic_explanation=analysis.forensic_explanation,
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=session_id,
    )


class MockTextAnalyzer:
    """Mock analyzer for text/article AI-generation and misinformation detection."""

    async def analyze(self, text: str, title: str, url: str) -> dict:
        """
        Analyze text for AI generation and misinformation risk.
        
        Returns:
            {
                "ai_generated_probability": float (0-1),
                "misinformation_risk": "LOW" | "MEDIUM" | "HIGH",
                "credibility_score": float (0-1),
                "explanation": [str]
            }
        """
        
        # Hash the text for pseudo-deterministic results
        text_hash = hashlib.sha256(text.encode("utf-8")).digest()
        pseudo_seed = int.from_bytes(text_hash[:8], byteorder="big") % 1000
        
        # Heuristics for AI generation detection
        text_lower = text.lower()
        
        # Count suspicious AI-generation indicators
        ai_markers = [
            "i am an ai", "as an ai", "i'm an ai", "i cannot",
            "please note that", "it is important to note", "furthermore",
            "in conclusion", "in summary", "overall", "to summarize",
            "as the ai model"
        ]
        ai_marker_count = sum(1 for marker in ai_markers if marker in text_lower)
        
        # Large vocabulary and structured text suggest AI
        words = text.split()
        unique_word_ratio = len(set(words)) / max(len(words), 1)
        sentence_count = text.count('.') + text.count('!') + text.count('?')
        avg_sentence_length = len(words) / max(sentence_count, 1)
        
        # AI-generated text often has very consistent sentence length
        ai_consistency_signal = 1.0 - min(1.0, abs(avg_sentence_length - 15) / 20.0)
        
        # Base score from heuristics
        ai_score = (
            0.1 +
            0.2 * (ai_marker_count / max(len(ai_markers), 1)) +
            0.3 * unique_word_ratio +
            0.4 * ai_consistency_signal
        )
        ai_score = max(0.05, min(0.99, ai_score))
        
        # Apply pseudo-random variation from seed
        ai_score = ai_score * 0.7 + (pseudo_seed / 1000.0) * 0.3
        
        # Misinformation risk assessment
        misinformation_markers = [
            "fake news", "hoax", "conspiracy", "unverified",
            "allegedly", "rumor", "supposedly", "claimed",
            "unproven", "without evidence"
        ]
        misinformation_count = sum(1 for marker in misinformation_markers if marker in text_lower)
        
        # High misinformation if URL is from suspicious domain
        suspicious_domains = ["blogspot.", "wordpress.", "wix.", "weebly."]
        is_suspicious_url = any(domain in url.lower() for domain in suspicious_domains)
        
        misinfo_score = (
            0.2 * (misinformation_count / max(len(misinformation_markers), 1)) +
            0.3 * (1.0 if is_suspicious_url else 0.0) +
            0.5 * (pseudo_seed % 100) / 100.0
        )
        
        misinformation_risk: Literal["LOW", "MEDIUM", "HIGH"]
        if misinfo_score >= 0.6:
            misinformation_risk = "HIGH"
        elif misinfo_score >= 0.35:
            misinformation_risk = "MEDIUM"
        else:
            misinformation_risk = "LOW"
        
        # Credibility score (inverse of AI generation)
        credibility_score = max(0.1, 1.0 - (ai_score * 0.6 + misinfo_score * 0.4))
        
        # Build explanation
        explanations = []
        
        if ai_score > 0.6:
            explanations.append(f"Text exhibits traits commonly associated with AI generation ({ai_score*100:.0f}% confidence).")
        
        if misinformation_risk == "HIGH":
            explanations.append(f"Multiple misinformation risk factors detected. URL: {url}")
            if is_suspicious_url:
                explanations.append("Source domain is associated with low-credibility hosting.")
        elif misinformation_risk == "MEDIUM":
            explanations.append(f"Moderate misinformation risk detected based on content analysis.")
        
        if len(words) < 200:
            explanations.append("Content is relatively short, limiting analysis depth.")
        
        explanations.append(f"Credibility score: {credibility_score*100:.1f}%")
        
        return {
            "ai_generated_probability": ai_score,
            "misinformation_risk": misinformation_risk,
            "credibility_score": credibility_score,
            "explanation": explanations
        }


text_analyzer = MockTextAnalyzer()


@app.post("/api/text-monitor", response_model=TextMonitorResponse)
async def text_monitor(payload: TextMonitorRequest) -> TextMonitorResponse:
    """Analyze text/article content for AI generation and misinformation."""
    
    if not payload.text or len(payload.text.strip()) < 50:
        raise HTTPException(status_code=422, detail="Text must be at least 50 characters")
    
    # Run analysis
    analysis = await text_analyzer.analyze(payload.text, payload.title, payload.url)
    
    # Update trust score
    session_id = (payload.session_id or "default-session").strip() or "default-session"
    
    # Use misinformation_risk as the main trust factor
    risk_to_penalty = {
        "LOW": 0.0,
        "MEDIUM": 0.1,
        "HIGH": 0.3
    }
    penalty = risk_to_penalty.get(analysis["misinformation_risk"], 0.0)
    
    trust_score, deduction = await trust_engine.update_score(session_id, penalty)

    # Record detection to global history (fire-and-forget background task)
    asyncio.create_task(_record_history({
        "entity_id": hashlib.sha256(f"text-{payload.url}-{payload.title}".encode()).hexdigest()[:16],
        "type": "TEXT",
        "source_url": payload.url,
        "title": payload.title,
        "risk_level": analysis["misinformation_risk"],
        "fake_probability": round(analysis["ai_generated_probability"], 4),
        "trust_score_after": trust_score,
        "timestamp": int(time.time() * 1000)
    }))

    return TextMonitorResponse(
        ai_generated_probability=analysis["ai_generated_probability"],
        misinformation_risk=analysis["misinformation_risk"],
        credibility_score=analysis["credibility_score"],
        explanation=analysis["explanation"],
        trust_score=trust_score,
        trust_score_delta=round(-deduction, 2),
        session_id=session_id,
    )

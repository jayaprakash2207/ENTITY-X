"""
guidance – high-level orchestration for legal output generation.

Coordinates complaint_drafter, evidence_packager, and disclaimer into a
single callable: build_legal_output().
"""
from __future__ import annotations

import time
from dataclasses import dataclass

from .complaint_drafter import build_complaint_draft
from .evidence_packager import build_evidence_block, build_evidence_summary
from .disclaimer import get_disclaimer


@dataclass
class LegalOutput:
    """Container returned by build_legal_output()."""
    complaint_draft: str
    evidence_summary: dict
    disclaimer: str


def build_legal_output(
    entity_id: str = "N/A",
    entity_type: str = "UNKNOWN",
    source_url: str = "",
    content_title: str = "",
    ai_generated_probability: float | None = None,
    misinformation_risk: str | None = None,
    credibility_score: float | None = None,
    fake_probability: float | None = None,
    forensic_findings: list[str] | None = None,
    ai_summary: str | None = None,
    key_claims: list[str] | None = None,
    trust_score_delta: float | None = None,
    detected_at: int | None = None,
) -> LegalOutput:
    """
    Build the complete legal-output package (draft + evidence + disclaimer).

    All detection fields are optional.  Pass only the values your detection
    pipeline produced; missing fields are omitted from the output text.

    Args:
        entity_id               Internal reference identifier.
        entity_type             "IMAGE" | "TEXT" | "UNKNOWN".
        source_url              URL of the flagged content.
        content_title           Human-readable title or description.
        ai_generated_probability  0–1 AI generation probability.
        misinformation_risk     "LOW" | "MEDIUM" | "HIGH".
        credibility_score       0–1 credibility indicator.
        fake_probability        0–1 image deepfake probability.
        forensic_findings       List of forensic annotation strings.
        ai_summary              Short model-generated content summary.
        key_claims              List of claims identified in the content.
        trust_score_delta       Trust-score deduction for this detection.
        detected_at             Detection timestamp in milliseconds epoch.

    Returns:
        LegalOutput dataclass with complaint_draft, evidence_summary,
        and disclaimer fields.
    """
    forensic_findings = forensic_findings or []
    key_claims = key_claims or []

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    detected_ts = (
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(detected_at / 1000))
        if detected_at
        else now_iso
    )

    evidence_block = build_evidence_block(
        ai_generated_probability=ai_generated_probability,
        fake_probability=fake_probability,
        entity_type=entity_type,
        misinformation_risk=misinformation_risk,
        credibility_score=credibility_score,
        forensic_findings=forensic_findings,
        ai_summary=ai_summary,
        key_claims=key_claims,
        trust_score_delta=trust_score_delta,
    )

    complaint_draft = build_complaint_draft(
        entity_id=entity_id,
        entity_type=entity_type,
        source_url=source_url,
        content_title=content_title,
        evidence_block=evidence_block,
        now_iso=now_iso,
        detected_ts=detected_ts,
    )

    evidence_summary = build_evidence_summary(
        entity_id=entity_id,
        entity_type=entity_type,
        source_url=source_url,
        detected_ts=detected_ts,
        now_iso=now_iso,
        ai_generated_probability=ai_generated_probability,
        fake_probability=fake_probability,
        misinformation_risk=misinformation_risk,
        credibility_score=credibility_score,
        forensic_findings=forensic_findings,
        key_claims=key_claims,
        ai_summary=ai_summary,
    )

    return LegalOutput(
        complaint_draft=complaint_draft,
        evidence_summary=evidence_summary,
        disclaimer=get_disclaimer(),
    )

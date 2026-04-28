"""
evidence_packager – assembles the evidence narrative block and the
structured evidence-summary dict that accompany a legal complaint draft.
"""
from __future__ import annotations


def build_evidence_block(
    ai_generated_probability: float | None,
    fake_probability: float | None,
    entity_type: str,
    misinformation_risk: str | None,
    credibility_score: float | None,
    forensic_findings: list[str],
    ai_summary: str | None,
    key_claims: list[str],
    trust_score_delta: float | None,
) -> str:
    """
    Return a human-readable, multi-line summary of all detection evidence.

    All values are optional — missing values are silently omitted.
    """
    lines: list[str] = []

    if ai_generated_probability is not None:
        pct = round(ai_generated_probability * 100, 1)
        qualifier = (
            "a high probability" if pct >= 70
            else "a moderate probability" if pct >= 40
            else "a low probability"
        )
        lines.append(
            f"Automated analysis estimates {qualifier} ({pct}%) that this content "
            "may have been produced or significantly altered by generative AI systems."
        )

    if fake_probability is not None and entity_type.upper() == "IMAGE":
        fpct = round(fake_probability * 100, 1)
        lines.append(
            f"Image authenticity scoring indicates a synthetic or manipulated origin "
            f"probability of {fpct}%."
        )

    if misinformation_risk:
        risk = misinformation_risk.upper()
        risk_desc = {
            "HIGH":   "a high potential for misleading readers",
            "MEDIUM": "a moderate potential for misleading readers",
            "LOW":    "a low potential for misleading readers",
        }.get(risk, "an undetermined potential for misleading readers")
        lines.append(
            f"Content-level analysis indicates {risk_desc} based on "
            "automated heuristic and model-based assessment."
        )

    if credibility_score is not None:
        cpct = round(credibility_score * 100, 1)
        lines.append(
            f"An automated credibility indicator placed this content at "
            f"{cpct}/100, suggesting {'reduced' if cpct < 50 else 'moderate'} verifiability "
            "relative to reference baseline datasets."
        )

    if forensic_findings:
        lines.append("Forensic detection findings include:")
        for i, finding in enumerate(forensic_findings[:10], 1):
            lines.append(f"  {i}. {finding}")

    if ai_summary:
        lines.append(f'Model-generated summary of content: "{ai_summary}"')

    if key_claims:
        lines.append("Identified claims within the content:")
        for i, claim in enumerate(key_claims[:8], 1):
            lines.append(f"  {i}. {claim}")

    if trust_score_delta is not None:
        delta = round(abs(trust_score_delta), 2)
        if delta > 0:
            lines.append(
                f"This detection contributed a trust score decrement of {delta} points "
                "to the active session's running integrity index."
            )

    return "\n".join(lines) or "No quantitative evidence data provided."


def build_evidence_summary(
    entity_id: str,
    entity_type: str,
    source_url: str,
    detected_ts: str,
    now_iso: str,
    ai_generated_probability: float | None,
    fake_probability: float | None,
    misinformation_risk: str | None,
    credibility_score: float | None,
    forensic_findings: list[str],
    key_claims: list[str],
    ai_summary: str | None,
) -> dict:
    """
    Return a structured dict capturing the core evidence fields.
    Only non-None / non-empty fields are included.
    """
    summary: dict = {
        "entity_id":   entity_id,
        "entity_type": entity_type,
        "source_url":  source_url,
        "detected_at": detected_ts,
        "report_date": now_iso,
    }
    if ai_generated_probability is not None:
        summary["ai_generated_probability"] = round(ai_generated_probability, 4)
    if fake_probability is not None:
        summary["fake_probability"] = round(fake_probability, 4)
    if misinformation_risk:
        summary["misinformation_risk"] = misinformation_risk.upper()
    if credibility_score is not None:
        summary["credibility_score"] = round(credibility_score, 4)
    if forensic_findings:
        summary["forensic_findings"] = forensic_findings
    if key_claims:
        summary["key_claims"] = key_claims
    if ai_summary:
        summary["ai_summary"] = ai_summary
    return summary

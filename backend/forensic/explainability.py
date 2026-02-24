"""
backend.forensic.explainability – forensic explanation enrichment.

Takes raw model outputs and produces human-readable forensic annotations
suitable for display in the Entity X UI and inclusion in complaint drafts.
"""
from __future__ import annotations


def enrich_image_explanation(
    fake_probability: float,
    risk_level: str,
    raw_explanations: list[str],
) -> list[str]:
    """
    Append contextual forensic annotations to a base explanation list.

    Args:
        fake_probability  Model probability score [0.0, 1.0].
        risk_level        "LOW" | "MEDIUM" | "HIGH".
        raw_explanations  Explanation strings from the model.

    Returns:
        Augmented explanation list (original strings + forensic context).
    """
    enriched = list(raw_explanations)

    if risk_level == "HIGH":
        enriched.append(
            "HIGH risk classification: content should be reviewed manually "
            "before any downstream use or distribution."
        )
    elif risk_level == "MEDIUM":
        enriched.append(
            "MEDIUM risk classification: automated signals are inconclusive; "
            "human review is recommended."
        )
    else:
        enriched.append(
            "LOW risk classification: no strong synthetic indicators detected, "
            "but automated tools are not infallible."
        )

    enriched.append(
        f"Overall probabilistic manipulation score: {fake_probability:.4f} "
        "(scale 0.0 = authentic, 1.0 = highly synthetic)."
    )
    return enriched


def enrich_text_explanation(
    ai_probability: float,
    misinfo_risk: str,
    credibility: float,
    raw_explanations: list[str],
) -> list[str]:
    """
    Append contextual forensic annotations to a text-analysis explanation list.

    Args:
        ai_probability    AI-generation probability [0.0, 1.0].
        misinfo_risk      "LOW" | "MEDIUM" | "HIGH".
        credibility       Credibility score [0.0, 1.0].
        raw_explanations  Base explanation strings from the model.

    Returns:
        Augmented explanation list.
    """
    enriched = list(raw_explanations)
    enriched.append(
        f"AI generation probability: {ai_probability * 100:.1f}% | "
        f"Misinformation risk: {misinfo_risk} | "
        f"Credibility: {credibility * 100:.1f}%"
    )
    return enriched

"""
complaint_drafter – builds the formatted CONTENT REVIEW REQUEST text block.
"""
from __future__ import annotations

import time


def build_complaint_draft(
    entity_id: str,
    entity_type: str,                 # "IMAGE" | "TEXT" | "UNKNOWN"
    source_url: str,
    content_title: str,
    evidence_block: str,
    now_iso: str,
    detected_ts: str,
) -> str:
    """
    Return the full multi-line complaint draft as a plain string.

    Args:
        entity_id       Internal reference ID.
        entity_type     One of IMAGE / TEXT / UNKNOWN.
        source_url      Source URL of the flagged content.
        content_title   Title or description of the content.
        evidence_block  Pre-formatted evidence narrative produced by
                        evidence_packager.build_evidence_block().
        now_iso         ISO-8601 report timestamp.
        detected_ts     ISO-8601 detection timestamp.

    Returns:
        A fully formatted complaint draft string.
    """
    entity_type_label = {
        "IMAGE":   "image content",
        "TEXT":    "text/article content",
        "UNKNOWN": "digital content",
    }.get(entity_type, "digital content")

    source_display = source_url or "source URL not recorded"
    title_display  = content_title or "title not available"

    draft_lines = [
        "CONTENT REVIEW REQUEST",
        "=" * 54,
        f"Reference ID  : {entity_id}",
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

    return "\n".join(draft_lines)

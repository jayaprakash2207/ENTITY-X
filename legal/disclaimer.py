"""
disclaimer – canonical disclaimer text for all generated complaint drafts.

The text is intentionally short, non-jurisdictional, and platform-neutral.
"""
from __future__ import annotations

_DISCLAIMER = (
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


def get_disclaimer() -> str:
    """Return the standard disclaimer string."""
    return _DISCLAIMER

"""
legal – Legal Complaint generation pipeline.

Submodules
----------
complaint_drafter   Builds the full formatted complaint draft text.
evidence_packager   Assembles a structured evidence-summary dictionary.
disclaimer          Returns the standard disclaimer string.
guidance            High-level orchestration: build_legal_output().
legal_chat          Jurisdiction-aware legal-chat engine:
                    run_legal_chat() → LegalChatResponse.
"""

from .guidance    import build_legal_output
from .legal_chat  import run_legal_chat, LegalChatRequest, LegalChatResponse

__all__ = [
    "build_legal_output",
    "run_legal_chat",
    "LegalChatRequest",
    "LegalChatResponse",
]

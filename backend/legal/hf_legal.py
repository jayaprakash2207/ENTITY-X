"""
legal.hf_legal – Free AI legal explanation via HuggingFace Inference API.

Uses two complementary approaches:

1. InLegalBERT  (law-ai/InLegalBERT)
   Pre-trained on 5.4 million Indian Supreme Court & High Court decisions.
   Used for SEMANTIC CONTEXT: we run fill-mask on key legal phrases to surface
   the most relevant Indian legal vocabulary for a given query.

2. Free generative model  (Mistral-7B-Instruct via HF Inference API)
   Converts the detected scenario + InLegalBERT context into a readable
   AI explanation with jurisdiction-specific guidance.

Both calls are fire-and-forget if the API is unavailable — the rule-based
LegalChatEngine response is always returned regardless.

Environment:
  HF_API_KEY  — optional HuggingFace access token (free at hf.co/settings/tokens)
                Works unauthenticated for popular models (rate-limited to ~10 req/min)
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HF_API_KEY   = os.environ.get("HF_API_KEY", "")
HF_BASE_URL  = "https://router.huggingface.co"

# InLegalBERT — BERT trained on Indian legal corpus (fill-mask)
INLEGAL_BERT = "law-ai/InLegalBERT"

# Generative models for legal explanation (tried in order)
_GEN_MODELS = [
    "mistralai/Mistral-7B-Instruct-v0.3",
    "HuggingFaceH4/zephyr-7b-beta",
    "microsoft/Phi-3-mini-4k-instruct",
]

_TIMEOUT = 30  # seconds per HF call

_HEADERS_BASE = {"Content-Type": "application/json"}
if HF_API_KEY:
    _HEADERS_BASE["Authorization"] = f"Bearer {HF_API_KEY}"


# ---------------------------------------------------------------------------
# InLegalBERT: surface relevant Indian legal terms
# ---------------------------------------------------------------------------

_LEGAL_PROBES = {
    "IMAGE_MISUSE":   "Publishing someone's image without consent may violate [MASK] Act.",
    "DEEPFAKE":       "Creating synthetic AI-generated images of a person without consent may violate [MASK] Act.",
    "DEFAMATION":     "Publishing false statements that harm reputation is addressed under [MASK] Sanhita.",
    "FAKE_NEWS":      "Spreading false information that causes public harm may be covered under [MASK] Sanhita.",
    "IMPERSONATION":  "Creating a fake account in someone's name using a computer may violate [MASK] Act.",
    "GENERIC":        "Digital harm and misuse of personal information are addressed under [MASK] Act.",
}


async def get_inlegal_context(scenario: str) -> list[str]:
    """
    Run InLegalBERT fill-mask on a probe sentence matching the scenario.
    Returns top predicted tokens (Indian law terms) as context strings.
    Silently returns [] on any failure.
    """
    probe = _LEGAL_PROBES.get(scenario, _LEGAL_PROBES["GENERIC"])
    url   = f"https://api-inference.huggingface.co/models/{INLEGAL_BERT}"  # fill-mask uses legacy endpoint

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                url,
                headers=_HEADERS_BASE,
                json={"inputs": probe},
            )
            if resp.status_code == 503:
                # Model is loading (cold start) — skip
                logger.debug("[hf_legal] InLegalBERT cold start, skipping")
                return []
            if not resp.is_success:
                logger.debug(f"[hf_legal] InLegalBERT HTTP {resp.status_code}")
                return []

            data = resp.json()
            if not isinstance(data, list):
                return []

            # data is list of [{"score": 0.x, "token_str": "...", ...}, ...]
            top = data[:3] if isinstance(data[0], dict) else data[0][:3]
            tokens = [item.get("token_str", "").strip() for item in top if item.get("token_str")]
            logger.info(f"[hf_legal] InLegalBERT top tokens for {scenario}: {tokens}")
            return [t for t in tokens if t]
    except Exception as e:
        logger.debug(f"[hf_legal] InLegalBERT failed: {e}")
        return []


# ---------------------------------------------------------------------------
# Generative explanation
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a calm, factual Indian legal awareness assistant specialising in "
    "digital law (IT Act 2000, Bharatiya Nyaya Sanhita 2023, GDPR, EU DSA). "
    "Provide clear, structured, jurisdiction-aware AWARENESS only — never legal "
    "advice, never directive ('file an FIR'), never accusatory. "
    "Use bullet points. Be concise. End with a one-line disclaimer."
)


async def get_ai_explanation(
    user_query: str,
    scenario: str,
    inlegal_context: list[str],
    relevant_sections: list[str],
) -> Optional[str]:
    """
    Call a free generative model on HuggingFace Inference API to produce
    a readable AI explanation enriched with InLegalBERT context.

    Returns None on failure (caller falls back to rule-based response).
    """
    # Build an enriched user prompt
    context_str = ""
    if inlegal_context:
        context_str += f"\nInLegalBERT suggests these relevant legal terms: {', '.join(inlegal_context)}."
    if relevant_sections:
        context_str += f"\nRelevant provisions commonly referenced: {'; '.join(relevant_sections[:3])}."

    prompt = (
        f"Scenario: {scenario.replace('_', ' ').title()}\n"
        f"User question: {user_query}\n"
        f"{context_str}\n\n"
        "Provide a concise, structured legal awareness response for India "
        "(mention relevant BNS / IT Act sections if applicable). "
        "Do NOT give legal advice or tell the user to take any specific action."
    )

    for model in _GEN_MODELS:
        url = f"{HF_BASE_URL}/models/{model}/v1/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    url,
                    headers=_HEADERS_BASE,
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": _SYSTEM_PROMPT},
                            {"role": "user",   "content": prompt},
                        ],
                        "temperature": 0.3,
                        "max_tokens": 800,
                    },
                )
                if resp.status_code == 503:
                    logger.debug(f"[hf_legal] {model} cold start, trying next")
                    continue
                if not resp.is_success:
                    logger.debug(f"[hf_legal] {model} HTTP {resp.status_code}")
                    continue

                data = resp.json()
                text = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                    .strip()
                )
                if text:
                    logger.info(f"[hf_legal] AI explanation from {model} ({len(text)} chars)")
                    return text
        except Exception as e:
            logger.debug(f"[hf_legal] {model} error: {e}")

    return None


# ---------------------------------------------------------------------------
# Combined entry point
# ---------------------------------------------------------------------------

async def enrich_legal_response(
    user_query: str,
    scenario: str,
    relevant_sections: list[str],
) -> dict:
    """
    Run InLegalBERT + generative model in parallel.
    Returns { inlegal_context, ai_explanation } — both may be empty/None on failure.
    """
    inlegal_task = asyncio.create_task(get_inlegal_context(scenario))
    # Wait for InLegalBERT first (fast) to feed into generative model
    inlegal_context = await inlegal_task

    ai_explanation = await get_ai_explanation(
        user_query=user_query,
        scenario=scenario,
        inlegal_context=inlegal_context,
        relevant_sections=relevant_sections,
    )

    return {
        "inlegal_context": inlegal_context,
        "ai_explanation":  ai_explanation,
    }

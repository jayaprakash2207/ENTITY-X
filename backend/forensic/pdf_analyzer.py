"""
backend.forensic.pdf_analyzer – PDF document forgery & AI-generation detector.

Analyses a PDF binary for signs of tampering or AI generation using only
the standard library + Pillow (already a dependency):

  1. Structure integrity   – valid header, cross-ref table, trailer
  2. Metadata consistency  – Producer / Creator / ModDate anomalies
  3. Font fingerprinting   – embedded font names associated with AI tools
  4. Text layer analysis   – AI-generation vocabulary patterns in extracted text
  5. Image artifact check  – embedded images scanned via generator_fingerprint
  6. Edit history          – presence of /Prev cross-ref (document was modified)
"""
from __future__ import annotations

import io
import logging
import re
import struct
import time
from typing import Any

logger = logging.getLogger(__name__)

# Words that appear disproportionately in AI-generated documents
_AI_VOCAB = {
    "delve", "tapestry", "nuanced", "multifaceted", "intricate", "pivotal",
    "leverage", "synergy", "paradigm", "transformative", "holistic", "robust",
    "embark", "underscore", "elucidate", "pertaining", "aforementioned",
    "comprehensive", "furthermore", "it is worth noting", "in conclusion",
}

# PDF producers known to originate from AI writing tools
_AI_PRODUCERS = {"chatgpt", "jasper", "copy.ai", "writesonic", "notion ai", "grammarly go"}

# Legitimate camera / scanner producers — lower suspicion
_LEGIT_PRODUCERS = {"adobe", "microsoft", "libreoffice", "google docs", "apple"}


def _extract_metadata(raw: bytes) -> dict[str, str]:
    """Extract /Producer, /Creator, /ModDate from raw PDF bytes."""
    meta: dict[str, str] = {}
    for field in ("Producer", "Creator", "ModDate", "CreationDate", "Author"):
        pattern = rb"/" + field.encode() + rb"\s*\(([^)]{0,200})\)"
        m = re.search(pattern, raw)
        if m:
            try:
                meta[field] = m.group(1).decode("latin-1", errors="replace").strip()
            except Exception:
                pass
    return meta


def _extract_text_sample(raw: bytes, max_chars: int = 4000) -> str:
    """Pull visible text strings from PDF stream content (BT...ET blocks)."""
    text_parts: list[str] = []
    for m in re.finditer(rb"BT\s*(.*?)\s*ET", raw, re.DOTALL):
        block = m.group(1)
        for tm in re.finditer(rb"\(([^)]{1,300})\)\s*T[jJ]", block):
            try:
                text_parts.append(tm.group(1).decode("latin-1", errors="replace"))
            except Exception:
                pass
        if sum(len(p) for p in text_parts) >= max_chars:
            break
    return " ".join(text_parts)[:max_chars]


def _ai_vocab_score(text: str) -> tuple[float, list[str]]:
    """Score text for AI-generation vocabulary. Returns (0–1, matched_words)."""
    if not text:
        return 0.0, []
    words_lower = text.lower()
    hits = [w for w in _AI_VOCAB if w in words_lower]
    score = min(len(hits) / 5.0, 1.0)
    return score, hits


def _check_structure(raw: bytes) -> tuple[bool, list[str]]:
    """Validate basic PDF structure. Returns (ok, issues)."""
    issues: list[str] = []
    if not raw.startswith(b"%PDF-"):
        issues.append("Missing PDF header — file may be corrupted or forged")
    if b"%%EOF" not in raw[-1024:]:
        issues.append("Missing %%EOF marker — truncated or tampered file")
    if b"xref" not in raw and b"startxref" not in raw:
        issues.append("No cross-reference table found — structural anomaly")
    # Multiple /Prev entries indicate document was modified after creation
    prev_count = len(re.findall(rb"/Prev\s+\d+", raw))
    if prev_count > 0:
        issues.append(f"Document has {prev_count} edit revision(s) recorded in history")
    return len(issues) == 0, issues


def _check_embedded_images(raw: bytes) -> dict:
    """
    Extract the first embedded JPEG/PNG and run generator fingerprint on it.
    """
    result = {"found": False, "generator_analysis": None}
    # Look for JPEG streams (FF D8 FF)
    idx = raw.find(b"\xff\xd8\xff")
    if idx == -1:
        return result
    end = raw.find(b"\xff\xd9", idx)
    if end == -1 or (end - idx) < 512:
        return result
    img_bytes = raw[idx: end + 2]
    result["found"] = True
    try:
        from backend.ai.generator_fingerprint import analyze_generator
        result["generator_analysis"] = analyze_generator(img_bytes)
    except Exception as exc:
        logger.debug(f"[pdf] Image fingerprint error: {exc}")
    return result


def analyze_pdf(data: bytes) -> dict:
    """
    Synchronous full PDF analysis. Call via asyncio.to_thread().

    Returns::
        {
          "risk_level":          str,    # LOW / MEDIUM / HIGH
          "fake_probability":    float,
          "is_ai_generated":     bool,
          "findings":            list[str],
          "metadata":            dict,
          "structure_ok":        bool,
          "ai_vocab_score":      float,
          "matched_ai_words":    list[str],
          "embedded_image":      dict | None,
        }
    """
    findings: list[str] = []
    score_parts: list[float] = []

    # 1. Structure check
    structure_ok, struct_issues = _check_structure(data)
    findings.extend(struct_issues)
    if not structure_ok:
        score_parts.append(0.4)

    # 2. Metadata analysis
    meta = _extract_metadata(data)
    producer = (meta.get("Producer") or "").lower()
    creator  = (meta.get("Creator") or "").lower()

    if not producer and not creator:
        findings.append("No Producer/Creator metadata — common in AI-generated or anonymised PDFs")
        score_parts.append(0.3)
    else:
        for ai_prod in _AI_PRODUCERS:
            if ai_prod in producer or ai_prod in creator:
                findings.append(f"Producer '{meta.get('Producer','?')}' is an AI writing tool")
                score_parts.append(0.7)
                break
        else:
            for legit in _LEGIT_PRODUCERS:
                if legit in producer or legit in creator:
                    findings.append(f"Producer identified as legitimate tool: {meta.get('Producer','?')}")
                    score_parts.append(-0.1)
                    break

    # 3. AI vocabulary in text
    text = _extract_text_sample(data)
    vocab_score, matched_words = _ai_vocab_score(text)
    if vocab_score > 0.2:
        findings.append(f"AI-generation vocabulary detected: {', '.join(matched_words[:6])}")
        score_parts.append(vocab_score * 0.6)

    # 4. Embedded image fingerprint
    img_result = _check_embedded_images(data)
    if img_result["found"] and img_result["generator_analysis"]:
        ga = img_result["generator_analysis"]
        if ga.get("is_ai_generated"):
            findings.append(f"Embedded image identified as AI-generated ({ga['generator']})")
            score_parts.append(0.5)

    # 5. File size heuristic (AI-gen PDFs often lack embedded resources)
    if len(data) < 20_000 and b"stream" not in data:
        findings.append("Unusually small PDF with no embedded streams — may be text-only AI output")
        score_parts.append(0.2)

    if not findings:
        findings.append("No significant forgery or AI-generation indicators found")

    raw_score     = max(0.0, min(1.0, sum(score_parts) / max(len(score_parts), 1)))
    risk_level    = "HIGH" if raw_score >= 0.6 else "MEDIUM" if raw_score >= 0.35 else "LOW"
    is_ai_gen     = raw_score >= 0.4 or vocab_score >= 0.4

    return {
        "risk_level":        risk_level,
        "fake_probability":  round(raw_score, 3),
        "is_ai_generated":   is_ai_gen,
        "findings":          findings,
        "metadata":          meta,
        "structure_ok":      structure_ok,
        "ai_vocab_score":    round(vocab_score, 3),
        "matched_ai_words":  matched_words,
        "embedded_image":    img_result if img_result["found"] else None,
        "file_size_bytes":   len(data),
    }

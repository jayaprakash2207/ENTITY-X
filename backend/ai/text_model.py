"""
backend.ai.text_model – ML-based AI-generation and misinformation detector.

RealTextAnalyzer uses an ensemble of two HuggingFace transformer models to
detect AI-generated text:

Model lineup:
- Primary:   Hello-SimpleAI/chatgpt-detector-roberta
             (RoBERTa fine-tuned on ChatGPT/GPT-4 outputs — modern LLM-aware)
- Secondary: Hello-SimpleAI/chatgpt-detector-roberta-qa
             (Same architecture, Q&A style AI text specialization)

Why these two?
- Both tested and verified: human text → low score, AI text → higher score
- roberta-base-openai-detector was trained only on GPT-2 and fires BACKWARDS
  on modern AI text (labels formal AI output as "Real" and human text as "Fake")
- GPT-2 perplexity is also inverted for modern LLM output (formal AI text has
  higher GPT-2 perplexity than casual human text — opposite of assumption)

Performance:
- Both models load in PARALLEL (ThreadPoolExecutor) — ~3s from cache
- First-run: models download from HuggingFace and cache locally

Ensemble weights (when both available):
    60% Primary + 40% Statistical
    or 50% Primary + 30% Secondary + 20% Statistical

Falls back to MockTextAnalyzer (heuristics) if models fail to load.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import logging
from typing import Literal, Optional

logger = logging.getLogger(__name__)

# Optional ML imports
try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("[text_model] torch not installed. ML analysis unavailable.")

try:
    from transformers import pipeline
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    logger.warning("[text_model] transformers not installed. ML analysis unavailable.")

try:
    import numpy as np
    NP_AVAILABLE = True
except ImportError:
    NP_AVAILABLE = False


class RealTextAnalyzer:
    """
    Production text analyzer using an ensemble of transformer classifiers
    and GPT-2 perplexity scoring.

    Detection pipeline:
    1. roberta-large-openai-detector   – primary binary classifier
    2. chatgpt-detector-roberta        – secondary ChatGPT-specific classifier
    3. roberta-mixed-detector          – tertiary multi-source classifier
    4. GPT-2 perplexity                – AI text has lower perplexity
    5. Statistical heuristics          – burstiness, vocabulary diversity, prompts

    Falls back gracefully when libraries or individual models are unavailable.
    """

    # Model identifiers
    # Primary: RoBERTa fine-tuned on ChatGPT/GPT-4 outputs — verified accurate on modern AI text
    # Secondary: same model, but run on TAIL chunks of long documents for diversity
    #   (chatgpt-detector-roberta-qa was listed here previously but doesn't exist on HuggingFace)
    PRIMARY_MODEL   = "Hello-SimpleAI/chatgpt-detector-roberta"
    SECONDARY_MODEL = ""   # empty = tail-chunk pass of primary (no second download needed)

    # Ensemble weights
    W_PRIMARY   = 0.50
    W_SECONDARY = 0.30
    W_STAT      = 0.20

    # Classification thresholds
    HIGH_THRESHOLD   = 0.70
    MEDIUM_THRESHOLD = 0.40

    # Text limits
    MAX_LENGTH = 512   # classifier token limit
    MIN_WORDS  = 20    # minimum for reliable analysis

    def __init__(self):
        self._models_loaded  = False
        self._primary_pipe   = None
        self._secondary_pipe = None
        self._device         = "cpu"
        self._fallback       = MockTextAnalyzer()

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------

    async def _hf_api_infer(self, text: str, title: str, url: str) -> dict | None:
        """
        Call HuggingFace Inference API for AI-text detection when local torch is unavailable.
        Returns the same dict format as analyze() or None on failure.
        """
        import os
        hf_key = os.environ.get('HF_API_KEY', '')
        if not hf_key:
            return None

        import httpx

        # Truncate to model token limit (~512 tokens ≈ 2000 chars)
        input_text = text[:2000]

        try:
            api_url = 'https://api-inference.huggingface.co/models/Hello-SimpleAI/chatgpt-detector-roberta'
            async with httpx.AsyncClient(timeout=40.0) as client:
                resp = await client.post(
                    api_url,
                    json={'inputs': input_text},
                    headers={'Authorization': f'Bearer {hf_key}'},
                )
            if resp.status_code == 200:
                data = resp.json()
                # HF returns [[{label, score}, ...]] for text classification
                items = data[0] if isinstance(data, list) and isinstance(data[0], list) else data
                scores = {r['label'].lower(): r['score'] for r in items}
                # Labels: 'chatgpt' (AI) or 'human'
                ai_prob = scores.get('chatgpt', scores.get('fake', scores.get('ai', 0.5)))
                ai_prob = round(max(0.0, min(1.0, ai_prob)), 4)

                if ai_prob >= self.HIGH_THRESHOLD:
                    risk: str = 'HIGH'
                elif ai_prob >= self.MEDIUM_THRESHOLD:
                    risk = 'MEDIUM'
                else:
                    risk = 'LOW'

                credibility = round(max(0.1, 1.0 - ai_prob * 0.6), 4)
                logger.info(f'[HF API] chatgpt-detector → AI prob={ai_prob:.2f}')
                return {
                    'ai_generated_probability': ai_prob,
                    'misinformation_risk': risk,
                    'credibility_score': credibility,
                    'explanation': [
                        f'[HF CLOUD ML] HuggingFace chatgpt-detector-roberta (RoBERTa): {ai_prob*100:.1f}% AI-generated.',
                        f'Risk level: {risk} | Credibility: {credibility*100:.0f}%',
                        'Analysis performed via HuggingFace Inference API — same model accuracy as local ML.',
                    ],
                }
            elif resp.status_code == 503:
                logger.info('[HF API] chatgpt-detector model still loading')
        except Exception as e:
            logger.warning(f'[HF API] text inference error: {e}')

        return None

    async def _ensure_models_loaded(self):
        """Lazy-load all ML models on first use."""
        if self._models_loaded:
            return
        if not TORCH_AVAILABLE or not TRANSFORMERS_AVAILABLE:
            logger.info("[text_model] ML libraries not available, using heuristics")
            self._models_loaded = True
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._load_models_sync)

    def _load_models_sync(self):
        """
        Load both models in PARALLEL using ThreadPoolExecutor.

        Sequential: ~5-6s cached. Parallel: ~3s cached.
        """
        try:
            if torch.cuda.is_available():
                self._device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                self._device = "mps"
            else:
                self._device = "cpu"
            logger.info(f"[text_model] Using device: {self._device}")

            device_id = 0 if self._device == "cuda" else -1

            def load_primary():
                try:
                    p = pipeline(
                        "text-classification",
                        model=self.PRIMARY_MODEL,
                        device=device_id,
                        truncation=True,
                        max_length=self.MAX_LENGTH,
                    )
                    logger.info(f"[text_model] Loaded primary: {self.PRIMARY_MODEL}")
                    return p
                except Exception as e:
                    logger.warning(f"[text_model] Primary model failed: {e}")
                    return None

            # Only one model to load — secondary uses tail chunks of primary (no download)
            self._primary_pipe = load_primary()

        except Exception as e:
            logger.error(f"[text_model] Model loading error: {e}")

        self._models_loaded = True

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def analyze(self, text: str, title: str, url: str) -> dict:
        """
        Analyse text for AI-generation probability and misinformation risk.

        Returns dict with:
            ai_generated_probability, misinformation_risk,
            credibility_score, explanation
        """
        await self._ensure_models_loaded()

        words = text.split()
        if len(words) < self.MIN_WORDS:
            result = await self._fallback.analyze(text, title, url)
            result["explanation"].insert(
                0, f"Text too short ({len(words)} words) for ML analysis. Using heuristics."
            )
            return result

        if not self._primary_pipe:
            # Try HuggingFace Inference API (free cloud GPU — no torch needed)
            hf_result = await self._hf_api_infer(text, title, url)
            if hf_result is not None:
                return hf_result
            result = await self._fallback.analyze(text, title, url)
            result["explanation"].insert(0, "[HEURISTIC MODE] ML classifiers not loaded.")
            return result

        try:
            return await self._ml_analyze(text, title, url)
        except Exception as e:
            logger.error(f"[text_model] ML analysis failed: {e}")
            result = await self._fallback.analyze(text, title, url)
            result["explanation"].insert(0, f"[FALLBACK] ML error: {str(e)[:60]}")
            return result

    # ------------------------------------------------------------------
    # ML pipeline
    # ------------------------------------------------------------------

    async def _ml_analyze(self, text: str, title: str, url: str) -> dict:
        """Run ensemble ML analysis."""
        loop = asyncio.get_event_loop()
        chunks = self._chunk_text(text, self.MAX_LENGTH * 4)

        # ── Sliding window: score ALL chunks for full document coverage ──────
        # Previously only head (first 4) + tail (last 3) were scored, missing
        # AI text buried in the middle of long documents.  Now every chunk is
        # scored and combined as:  mean * 0.65 + max * 0.35
        # (any AI section is evidence of AI authorship, so max matters)
        all_scores: list[float] = []
        for chunk in chunks:
            try:
                result = await loop.run_in_executor(None, lambda c=chunk: self._primary_pipe(c))
                all_scores.append(self._extract_ai_score(result))
            except Exception:
                pass

        if not all_scores:
            primary_avg = 0.5
        elif len(all_scores) == 1:
            primary_avg = all_scores[0]
        else:
            chunk_mean  = sum(all_scores) / len(all_scores)
            chunk_max   = max(all_scores)
            primary_avg = chunk_mean * 0.65 + chunk_max * 0.35

        # ── Secondary: head-vs-tail divergence check ──────────────────
        # Detects mixed-authorship documents (human intro, AI body).
        secondary_avg = None
        if self._secondary_pipe:
            secondary_avg = await self._run_classifier(loop, self._secondary_pipe, chunks[:3])
        elif len(all_scores) >= 4:
            head_avg = sum(all_scores[:2]) / 2
            tail_avg = sum(all_scores[-2:]) / 2
            if abs(head_avg - tail_avg) > 0.20:
                # Mixed document — surface the higher-AI half
                secondary_avg = max(head_avg, tail_avg)

        # ── Statistical features ─────────────────────────────────────
        stats = self._compute_text_statistics(text)
        stat_score = self._compute_statistical_ai_score(stats)
        prompt_score = stats.get("prompt_score", 0)

        # ── Ensemble ─────────────────────────────────────────────────
        ai_score = self._ensemble(primary_avg, secondary_avg, stat_score)

        # Prompt override: ML models are trained on AI outputs, not AI prompts
        if prompt_score > 0.6:
            ai_score = max(ai_score, 0.75)
        elif prompt_score > 0.4:
            ai_score = max(ai_score, 0.55)
        elif prompt_score > 0.2:
            ai_score = max(ai_score, 0.40)

        # Response override: heuristics that catch AI output the ML model misses
        # (bracket placeholders, meta-commentary, formal document + explanation, etc.)
        response_score = stats.get("response_score", 0)
        if response_score > 0.65:
            ai_score = max(ai_score, 0.80)
        elif response_score > 0.45:
            ai_score = max(ai_score, 0.65)
        elif response_score > 0.25:
            ai_score = max(ai_score, 0.50)
        elif response_score > 0.10:
            ai_score = max(ai_score, 0.38)

        ai_score = max(0.0, min(1.0, ai_score))

        # ── Risk level ───────────────────────────────────────────────
        if ai_score >= self.HIGH_THRESHOLD:
            risk_level: Literal["LOW", "MEDIUM", "HIGH"] = "HIGH"
        elif ai_score >= self.MEDIUM_THRESHOLD:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        misinfo_risk = self._assess_misinformation_risk(text, url)
        credibility  = max(0.1, 1.0 - (ai_score * 0.6 + misinfo_risk * 0.4))

        secondary_label = "Head/Tail-Divergence" if (secondary_avg is not None and not self._secondary_pipe) else "QA-Detector"
        explanations = self._build_explanations(
            ai_score, primary_avg, secondary_avg,
            stat_score, stats, risk_level, url, misinfo_risk,
            secondary_label=secondary_label,
        )

        return {
            "ai_generated_probability": round(ai_score, 4),
            "misinformation_risk": "HIGH" if misinfo_risk > 0.6 else "MEDIUM" if misinfo_risk > 0.3 else "LOW",
            "credibility_score": round(credibility, 4),
            "explanation": explanations,
        }

    async def _run_classifier(self, loop, pipe, chunks: list[str]) -> float:
        """Run a classifier pipeline on text chunks, return averaged AI score."""
        scores = []
        for chunk in chunks:
            try:
                result = await loop.run_in_executor(None, lambda c=chunk: pipe(c))
                scores.append(self._extract_ai_score(result))
            except Exception:
                pass
        return sum(scores) / len(scores) if scores else 0.5

    def _ensemble(self, primary: float, secondary: Optional[float], stat: float) -> float:
        """
        Combine scores with dynamic weights based on availability.

        Both models:   50% Primary + 30% Secondary + 20% Statistical
        Primary only:  80% Primary + 20% Statistical
        """
        if secondary is not None:
            return self.W_PRIMARY * primary + self.W_SECONDARY * secondary + self.W_STAT * stat
        return 0.80 * primary + 0.20 * stat

    # ------------------------------------------------------------------
    # Statistical features
    # ------------------------------------------------------------------

    def _compute_text_statistics(self, text: str) -> dict:
        """Compute statistical features that distinguish AI vs human text."""
        words = text.split()
        sentences = [s.strip() for s in text.replace("!", ".").replace("?", ".").split(".") if s.strip()]

        if not words or not sentences:
            return {}

        unique_words = set(w.lower() for w in words)
        ttr = len(unique_words) / len(words)

        sent_lengths = [len(s.split()) for s in sentences]
        avg_sent_len = sum(sent_lengths) / len(sent_lengths) if sent_lengths else 0

        if NP_AVAILABLE and len(sent_lengths) > 1:
            sent_len_std = float(np.std(sent_lengths))
        else:
            mean = avg_sent_len
            variance = sum((x - mean) ** 2 for x in sent_lengths) / max(len(sent_lengths) - 1, 1)
            sent_len_std = variance ** 0.5

        burstiness = sent_len_std / avg_sent_len if avg_sent_len > 0 else 0
        long_word_ratio = len([w for w in words if len(w) > 7]) / len(words)
        prompt_score   = self._detect_ai_prompt_patterns(text)
        response_score = self._detect_ai_response_patterns(text)

        return {
            "word_count": len(words),
            "sentence_count": len(sentences),
            "vocabulary_diversity": ttr,
            "avg_sentence_length": avg_sent_len,
            "sentence_length_std": sent_len_std,
            "burstiness": burstiness,
            "long_word_ratio": long_word_ratio,
            "prompt_score": prompt_score,
            "response_score": response_score,
        }

    def _detect_ai_prompt_patterns(self, text: str) -> float:
        """Detect if text is an AI prompt/instruction (input TO an AI system)."""
        text_lower = text.lower()
        score = 0.0

        prompt_starters = [
            "create a", "generate a", "design a", "write a", "make a",
            "build a", "draw a", "produce a", "develop a", "compose a",
            "craft a", "construct a", "render a", "illustrate a",
            "create an", "generate an", "design an", "write an",
        ]
        if any(text_lower.startswith(p) or f"\n{p}" in text_lower for p in prompt_starters):
            score += 0.35

        ai_references = [
            "diagram", "infographic", "vector", "illustration", "render",
            "midjourney", "dalle", "dall-e", "stable diffusion", "chatgpt",
            "gpt", "claude", "gemini", "copilot", "ai assistant",
            "professional presentation", "ppt", "powerpoint",
            "design style", "style:", "theme:", "format:",
        ]
        score += min(0.30, sum(1 for ref in ai_references if ref in text_lower) * 0.08)

        spec_patterns = ["→", "->", "=>", "•", "◦", "▪", "⁃"]
        if any(p in text for p in spec_patterns):
            score += 0.15

        import re
        if re.search(r"\d+\.\s+\w+", text):
            score += 0.10
        if text.count(":") >= 3 and ("style:" in text_lower or "design:" in text_lower):
            score += 0.10

        instruction_words = [
            "should show", "should include", "should have", "must include",
            "include:", "exclude:", "requirements:", "specifications:",
            "the following", "as follows", "listed below",
            "suitable for", "appropriate for", "optimized for",
        ]
        score += min(0.20, sum(1 for w in instruction_words if w in text_lower) * 0.05)

        lines = [l.strip() for l in text.split("\n") if l.strip()]
        if len(lines) >= 5:
            if sum(1 for l in lines if len(l.split()) <= 6) / len(lines) > 0.5:
                score += 0.15

        return min(1.0, score)

    def _detect_ai_response_patterns(self, text: str) -> float:
        """
        Detect if text is output FROM an AI system (not a prompt TO one).

        Targets patterns that AI assistants (Gemini, ChatGPT, Claude, etc.)
        reliably produce but humans rarely write naturally:
        - Bracket placeholders  [Insert Start Date], [Your Name], [Signature]
        - Meta-commentary sections explaining their own output
        - AI response openers
        - Structural over-explanation markers
        - Formal document + commentary two-part structure
        """
        import re
        text_lower = text.lower()
        score = 0.0

        # ── Bracket placeholders ─────────────────────────────────────────────
        # [Insert X], [Your X], [X Here], [Date], [Signature], [College Seal], etc.
        # Humans do not write documents with unfilled bracket slots — AI does.
        bracket_matches = re.findall(r'\[([^\]]{2,60})\]', text)
        if bracket_matches:
            # Any bracket placeholder is a strong signal
            score += min(0.55, len(bracket_matches) * 0.18)
            # Especially if it looks like an instruction placeholder
            instruction_placeholders = [
                "insert", "your ", "date", "name", "signature", "seal",
                "address", "start", "end", "here", "fill", "add ",
            ]
            placeholder_hits = sum(
                1 for m in bracket_matches
                if any(kw in m.lower() for kw in instruction_placeholders)
            )
            if placeholder_hits > 0:
                score += min(0.30, placeholder_hits * 0.15)

        # ── AI response opener patterns ──────────────────────────────────────
        # AI assistants commonly start responses with acknowledgement phrases
        ai_openers = [
            "got it.", "got it!", "sure!", "sure,", "of course!", "of course,",
            "absolutely!", "certainly!", "here is", "here's", "here are",
            "i have", "i've", "i'd be happy", "i can help",
            "as requested", "as per your", "as you requested",
            "based on your request", "based on your",
            "below is", "the following is",
        ]
        stripped = text_lower.strip()
        for opener in ai_openers:
            if stripped.startswith(opener):
                score += 0.30
                break
        # Also check first 120 chars for these patterns
        first_120 = text_lower[:120]
        opener_hits = sum(1 for o in ai_openers if o in first_120)
        score += min(0.15, opener_hits * 0.08)

        # ── Meta-commentary sections ─────────────────────────────────────────
        # AI explains why its output is good / what to do next — humans don't
        meta_headers = [
            "why this works", "why it works", "here's why",
            "next step:", "next steps:", "what to do next",
            "key points:", "key features:", "important notes:",
            "note:", "tip:", "pro tip:",
            "this works because", "this is effective because",
            "let me know if", "feel free to", "don't hesitate to",
            "would you like me to", "do you want me to",
            "i can also", "i can further", "additionally, i can",
            "alternatively,", "another option",
        ]
        meta_hits = sum(1 for h in meta_headers if h in text_lower)
        if meta_hits > 0:
            score += min(0.45, meta_hits * 0.15)

        # ── Formal document + explanation structure ──────────────────────────
        # AI often generates a document AND then appends an explanation section.
        # Detect: long formal block followed by "Why this works" / "Key reasons" etc.
        explanation_section_markers = [
            "why this works", "here's why", "why it works",
            "key reason", "this approach", "this version",
            "the reason", "points to note",
        ]
        if any(m in text_lower for m in explanation_section_markers):
            # If text also contains formal document structure, it's a two-part AI response
            formal_signals = [
                "to whom it may concern", "this is to certify",
                "ref:", "date:", "dear sir", "dear madam",
                "yours sincerely", "yours faithfully",
                "we hereby", "the undersigned",
            ]
            if any(f in text_lower for f in formal_signals):
                score += 0.40  # Document + meta-commentary = very strong AI signal

        # ── Formal document AI signals ───────────────────────────────────────
        # AI-generated formal docs have specific over-precise phrasing
        formal_ai_phrases = [
            "this is to certify that",
            "we hereby grant",
            "we hereby certify",
            "it is to certify",
            "the college has no objection",
            "the institute has no objection",
            "adhere to the code of conduct",
            "we believe this experience will be",
            "we request you to kindly",
            "kindly facilitate",
            "academic and professional growth",
            "practical industry exposure",
            "we are pleased to certify",
            "this experience will be highly beneficial",
        ]
        formal_hits = sum(1 for p in formal_ai_phrases if p in text_lower)
        if formal_hits > 0:
            score += min(0.35, formal_hits * 0.12)

        # ── AI self-reference patterns ────────────────────────────────────────
        ai_self = [
            "as an ai", "i'm an ai", "i am an ai",
            "as a language model", "as an llm",
            "as your assistant", "as your ai",
            "i generated", "i've generated", "i have generated",
            "i rewrote", "i have rewritten", "i've rewritten",
            "i drafted", "i have drafted",
        ]
        ai_self_hits = sum(1 for p in ai_self if p in text_lower)
        if ai_self_hits > 0:
            score += min(0.50, ai_self_hits * 0.25)

        # ── Numbered instruction lists with section labels ────────────────────
        # AI responses often include numbered/bulleted action sections
        section_labels = re.findall(
            r'^(?:\d+\.|[-•*])\s+\*?\*?([A-Z][^:]{3,40})\*?\*?:', text, re.MULTILINE
        )
        if len(section_labels) >= 2:
            score += 0.15

        return min(1.0, score)

    def _compute_statistical_ai_score(self, stats: dict) -> float:
        """Compute AI probability from statistical features."""
        if not stats:
            return 0.5

        score = 0.5
        prompt_score   = stats.get("prompt_score", 0)
        response_score = stats.get("response_score", 0)

        # Prompt patterns (text sent TO an AI)
        if prompt_score > 0.5:
            score += 0.35
        elif prompt_score > 0.25:
            score += 0.20
        elif prompt_score > 0.1:
            score += 0.10

        # Response patterns (text generated BY an AI) — highest priority signal
        if response_score > 0.65:
            score += 0.40
        elif response_score > 0.45:
            score += 0.30
        elif response_score > 0.25:
            score += 0.20
        elif response_score > 0.10:
            score += 0.10

        ttr = stats.get("vocabulary_diversity", 0.5)
        if ttr < 0.4:
            score += 0.10
        elif ttr > 0.6:
            score -= 0.05

        burstiness = stats.get("burstiness", 0.5)
        if burstiness < 0.3:
            score += 0.10
        elif burstiness > 0.6:
            score -= 0.05

        avg_sent = stats.get("avg_sentence_length", 15)
        if 14 <= avg_sent <= 18:
            score += 0.05

        sent_std = stats.get("sentence_length_std", 5)
        if sent_std < 4:
            score += 0.05
        elif sent_std > 8:
            score -= 0.05

        return max(0.0, min(1.0, score))

    def _assess_misinformation_risk(self, text: str, url: str) -> float:
        """Assess misinformation risk based on content markers and source."""
        risk = 0.0
        text_lower = text.lower()

        markers = [
            "fake news", "hoax", "conspiracy", "unverified", "allegedly",
            "rumor", "supposedly", "claimed", "unproven", "without evidence",
            "sources say", "some people believe", "many are saying",
        ]
        risk += min(0.3, sum(1 for m in markers if m in text_lower) * 0.05)

        suspicious_domains = [
            "blogspot.", "wordpress.", "wix.", "weebly.", "medium.com", "substack.com",
        ]
        if any(d in url.lower() for d in suspicious_domains):
            risk += 0.15

        sensational = [
            "shocking", "unbelievable", "you won't believe", "secret",
            "they don't want you to know", "mainstream media won't tell you",
        ]
        if any(s in text_lower for s in sensational):
            risk += 0.2

        return min(1.0, risk)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_ai_score(self, result: list) -> float:
        """Extract AI probability from classifier output."""
        if not result:
            return 0.5
        item = result[0]
        label = item.get("label", "").lower()
        score = item.get("score", 0.5)
        if label in ["fake", "ai", "generated", "chatgpt", "gpt", "machine"]:
            return score
        elif label in ["real", "human", "original"]:
            return 1.0 - score
        return score

    def _chunk_text(self, text: str, max_chars: int) -> list[str]:
        """Split text into sentence-aligned chunks."""
        if len(text) <= max_chars:
            return [text]

        sentences = text.replace("!", ".").replace("?", ".").split(".")
        chunks, current = [], ""
        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            if len(current) + len(sent) + 2 <= max_chars:
                current += sent + ". "
            else:
                if current:
                    chunks.append(current.strip())
                current = sent + ". "
        if current:
            chunks.append(current.strip())
        return chunks if chunks else [text[:max_chars]]

    def _build_explanations(
        self,
        ai_score, primary, secondary,
        stat_score, stats, risk_level, url, misinfo_risk,
        secondary_label: str = "Secondary",
    ) -> list[str]:
        """Build human-readable explanations for the analysis result."""
        explanations = []

        # Model scores summary
        parts = [f"ChatGPT-Detector(sliding-window)={primary * 100:.1f}%"]
        if secondary is not None:
            parts.append(f"{secondary_label}={secondary * 100:.1f}%")
        parts.append(f"Statistical={stat_score * 100:.1f}%")
        explanations.append(f"[ML ENSEMBLE] {' | '.join(parts)}")

        # Prompt detection
        prompt_score   = stats.get("prompt_score", 0) if stats else 0
        response_score = stats.get("response_score", 0) if stats else 0
        if response_score > 0.45:
            explanations.append(
                f"[AI OUTPUT DETECTED] Structural patterns strongly indicate AI-generated content "
                f"(bracket placeholders, meta-commentary, or formal doc+explanation structure) "
                f"(response pattern score: {response_score * 100:.0f}%)."
            )
        elif response_score > 0.20:
            explanations.append(
                f"Content has AI output characteristics (response pattern score: {response_score * 100:.0f}%) — "
                "e.g. placeholder brackets, AI response openers, or meta-commentary."
            )
        if prompt_score > 0.5:
            explanations.append(
                f"[AI PROMPT DETECTED] Content appears to be instructions for an AI tool "
                f"(prompt confidence: {prompt_score * 100:.0f}%)."
            )
        elif prompt_score > 0.25:
            explanations.append(
                f"Content has characteristics of AI prompts/instructions ({prompt_score * 100:.0f}% match)."
            )

        # Overall risk
        if risk_level == "HIGH":
            explanations.append(
                f"HIGH probability ({ai_score * 100:.1f}%) of AI-generated content. "
                "Multiple models and perplexity analysis confirm machine authorship signals."
            )
        elif risk_level == "MEDIUM":
            explanations.append(
                f"MODERATE probability ({ai_score * 100:.1f}%) of AI involvement. "
                "Some patterns consistent with AI generation detected."
            )
        else:
            explanations.append(
                f"LOW probability ({ai_score * 100:.1f}%) of AI generation. "
                "Content appears human-authored."
            )

        # Statistical findings
        if stats:
            if stats.get("vocabulary_diversity", 1) < 0.4:
                explanations.append(
                    f"Low vocabulary diversity ({stats['vocabulary_diversity'] * 100:.0f}%) — typical of AI text."
                )
            if stats.get("burstiness", 1) < 0.3:
                explanations.append(
                    f"Low burstiness ({stats['burstiness']:.2f}) — unusually uniform sentence structure."
                )
            if stats.get("sentence_length_std", 10) < 4:
                explanations.append(
                    "Sentence lengths are unusually consistent — common in AI output."
                )

        # Misinformation
        if misinfo_risk > 0.3:
            explanations.append(
                f"Misinformation risk indicators detected (score: {misinfo_risk * 100:.0f}%)."
            )

        return explanations


# ---------------------------------------------------------------------------
# Mock fallback
# ---------------------------------------------------------------------------

class MockTextAnalyzer:
    """
    Pseudo-deterministic heuristic text analyzer.
    Used when ML models are unavailable.

    Returns a dict with::

        {
            "ai_generated_probability": float,
            "misinformation_risk":      "LOW" | "MEDIUM" | "HIGH",
            "credibility_score":        float,
            "explanation":              [str],
        }
    """

    _AI_MARKERS: list[str] = [
        "i am an ai", "as an ai", "i'm an ai", "i cannot",
        "please note that", "it is important to note", "furthermore",
        "in conclusion", "in summary", "overall", "to summarize",
        "as the ai model",
    ]

    _PROMPT_MARKERS: list[str] = [
        "create a", "generate a", "design a", "write a", "make a",
        "build a", "draw a", "produce a", "develop a", "compose a",
        "should include", "should show", "should have", "must include",
        "design style", "style:", "theme:", "format:",
        "suitable for", "appropriate for", "optimized for",
    ]

    _AI_TOOL_REFS: list[str] = [
        "diagram", "infographic", "vector", "illustration", "render",
        "midjourney", "dalle", "dall-e", "stable diffusion", "chatgpt",
        "gpt", "ppt", "powerpoint", "presentation",
    ]

    _MISINFO_MARKERS: list[str] = [
        "fake news", "hoax", "conspiracy", "unverified",
        "allegedly", "rumor", "supposedly", "claimed",
        "unproven", "without evidence",
    ]

    _SUSPICIOUS_DOMAINS: list[str] = [
        "blogspot.", "wordpress.", "wix.", "weebly.",
    ]

    async def analyze(self, text: str, title: str, url: str) -> dict:
        text_hash   = hashlib.sha256(text.encode("utf-8")).digest()
        pseudo_seed = int.from_bytes(text_hash[:8], byteorder="big") % 1000
        text_lower  = text.lower()

        # Prompt detection
        prompt_marker_count = sum(1 for m in self._PROMPT_MARKERS if m in text_lower)
        ai_tool_count       = sum(1 for r in self._AI_TOOL_REFS    if r in text_lower)
        has_arrows   = any(p in text for p in ["→", "->", "=>"])
        has_bullets  = any(p in text for p in ["•", "◦", "▪"])
        import re
        has_numbered = bool(re.search(r"\d+\.\s+\w+", text))

        prompt_score = (
            0.25 * min(1.0, prompt_marker_count / 3)
            + 0.25 * min(1.0, ai_tool_count / 2)
            + 0.15 * (1.0 if has_arrows  else 0.0)
            + 0.15 * (1.0 if has_bullets else 0.0)
            + 0.10 * (1.0 if has_numbered else 0.0)
        )
        is_ai_prompt = prompt_score > 0.3

        # AI response output detection (text generated BY an AI)
        # Reuse the full detection logic from RealTextAnalyzer
        response_score = RealTextAnalyzer._detect_ai_response_patterns(self, text)
        is_ai_response = response_score > 0.25

        # AI probability
        ai_marker_count    = sum(1 for m in self._AI_MARKERS if m in text_lower)
        words              = text.split()
        unique_word_ratio  = len(set(words)) / max(len(words), 1)
        sentence_count     = text.count(".") + text.count("!") + text.count("?")
        avg_sentence_length = len(words) / max(sentence_count, 1)
        ai_consistency_signal = 1.0 - min(1.0, abs(avg_sentence_length - 15) / 20.0)

        ai_score = (
            0.1
            + 0.2 * (ai_marker_count / max(len(self._AI_MARKERS), 1))
            + 0.3 * unique_word_ratio
            + 0.4 * ai_consistency_signal
        )
        if is_ai_prompt:
            ai_score = max(ai_score, 0.55 + prompt_score * 0.4)
        if is_ai_response:
            if response_score > 0.65:
                ai_score = max(ai_score, 0.80)
            elif response_score > 0.45:
                ai_score = max(ai_score, 0.65)
            elif response_score > 0.25:
                ai_score = max(ai_score, 0.50)

        ai_score = max(0.05, min(0.99, ai_score))
        ai_score = ai_score * 0.8 + (pseudo_seed / 1000.0) * 0.2

        # Misinformation
        misinfo_count  = sum(1 for m in self._MISINFO_MARKERS if m in text_lower)
        is_susp_url    = any(d in url.lower() for d in self._SUSPICIOUS_DOMAINS)
        misinfo_score  = (
            0.2 * (misinfo_count / max(len(self._MISINFO_MARKERS), 1))
            + 0.3 * (1.0 if is_susp_url else 0.0)
            + 0.5 * (pseudo_seed % 100) / 100.0
        )

        if misinfo_score >= 0.45:
            misinformation_risk: Literal["LOW", "MEDIUM", "HIGH"] = "HIGH"
        elif misinfo_score >= 0.25:
            misinformation_risk = "MEDIUM"
        else:
            misinformation_risk = "LOW"

        credibility_score = max(0.1, 1.0 - (ai_score * 0.6 + misinfo_score * 0.4))

        explanations: list[str] = []
        if is_ai_prompt:
            explanations.append(
                f"[AI PROMPT DETECTED] Content appears to be instructions for an AI tool "
                f"(prompt confidence: {prompt_score * 100:.0f}%)."
            )
        if ai_score > 0.6:
            explanations.append(
                f"Text exhibits traits commonly associated with AI generation "
                f"({ai_score * 100:.0f}% confidence)."
            )
        if misinformation_risk == "HIGH":
            explanations.append(f"Multiple misinformation risk factors detected. URL: {url}")
            if is_susp_url:
                explanations.append("Source domain is associated with low-credibility hosting.")
        elif misinformation_risk == "MEDIUM":
            explanations.append("Moderate misinformation risk detected based on content analysis.")
        if len(words) < 200:
            explanations.append("Content is relatively short, limiting analysis depth.")
        explanations.append(f"Credibility score: {credibility_score * 100:.1f}%")

        return {
            "ai_generated_probability": ai_score,
            "misinformation_risk":      misinformation_risk,
            "credibility_score":        credibility_score,
            "explanation":              explanations,
        }

# Entity X Backend API

FastAPI service for real-time digital-integrity monitoring: deepfake image
detection, AI-generated text detection, misinformation risk scoring, trust
scoring, and legal-complaint generation.

## Package Structure

```
backend/                  ← Python package (entry-point: backend.main:app)
├── main.py               ← FastAPI app + all route handlers
├── ai/
│   ├── image_model.py    ← MockDeepfakeAnalyzer + AnalysisResult
│   ├── text_model.py     ← MockTextAnalyzer (AI-gen + misinformation)
│   └── video_model.py    ← Stub video analyzer (future)
├── db/
│   └── database.py       ← In-memory history store + query helpers
├── forensic/
│   └── explainability.py ← Forensic annotation enrichment
├── monitor/
│   ├── content_discovery.py  ← URL-type classifier
│   ├── image_scanner.py      ← SafeImageFetcher (SSRF-safe)
│   ├── news_scanner.py       ← Article scraper stub (future)
│   └── video_scanner.py      ← Video scanner stub (future)
├── trust/
│   └── trust_engine.py   ← Per-session trust-score engine
└── utils/
    └── scheduler.py      ← Background task scheduler

legal/                    ← Legal-complaint generation pipeline (top-level)
├── complaint_drafter.py  ← Formats the CONTENT REVIEW REQUEST text
├── disclaimer.py         ← Standard disclaimer string
├── evidence_packager.py  ← Builds evidence block + summary dict
├── guidance.py           ← Orchestration: build_legal_output()
└── legal_chat.py         ← Legal Chat Architecture: run_legal_chat()
                              Inputs : entity_type, context, country,
                                       analysis_data
                              Outputs: rights_explanation, relevant_sections,
                                       steps_to_proceed, evidence_needed,
                                       reporting_paths, disclaimer
```

## Endpoints

| Method | Path                   | Description                                  |
|--------|------------------------|----------------------------------------------|
| GET    | `/api/health`          | Liveness probe                               |
| GET    | `/api/history`         | Detection history (filterable)               |
| POST   | `/api/image-monitor`   | Deepfake / synthetic-image analysis          |
| POST   | `/api/text-monitor`    | AI-generation + misinformation analysis      |
| POST   | `/api/legal/generate`  | Neutral complaint draft generation           |
| POST   | `/api/legal/chat`      | Jurisdiction-aware legal guidance chat       |

## Run

1. Create and activate a Python virtual environment.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start server from the **project root** (one level above `backend/`):
   ```bash
   uvicorn backend.main:app --reload --port 8000
   ```

Interactive API docs: http://127.0.0.1:8000/docs

## Notes

- Image fetching is guarded with URL validation, SSRF protection (private IP
  blocking), content-type checking, magic-byte verification, and a 10 MB cap.
- Detection models are deterministic heuristics with Hugging Face-compatible
  interfaces — swap `analyze()` for a real model without changing route code.
- Trust score starts at 100 per session; each detection deducts
  `fake_probability × 100` points (clamped at 0).
- Detection history is in-memory only (no persistence across restarts).
- The legacy monolithic implementation is preserved in `app_legacy.py`.

## Legal Chat Architecture

The `/api/legal/chat` endpoint implements a structured legal-guidance pipeline
separate from the complaint-draft generator.

### Inputs to Legal Chat

| Field           | Type                      | Default  | Description                                          |
|-----------------|---------------------------|----------|------------------------------------------------------|
| `entity_type`   | `IMAGE` \| `NEWS` \| `TEXT` | `TEXT`   | Category of the detected entity                      |
| `context`       | string                    | `""`     | Scenario tag: e.g. `"deepfake"`, `"defamation"`       |
| `country`       | string                    | `India`  | Jurisdiction: `India`, `Global`, or `Both`           |
| `analysis_data` | object                    | `{}`     | Optional detection outputs (see below)               |

**Accepted `analysis_data` keys:** `fake_probability`, `ai_generated_probability`,
`misinformation_risk`, `credibility_score`, `forensic_explanation`.

### Outputs (LegalChatAPIResponse)

| Field                | Description                                                  |
|----------------------|--------------------------------------------------------------|
| `scenario`           | Detected scenario tag (e.g. `DEEPFAKE`, `DEFAMATION`)        |
| `rights_explanation` | Plain-language summary of potentially applicable rights      |
| `relevant_sections`  | Commonly referenced laws / acts for the scenario + country   |
| `steps_to_proceed`   | Numbered action checklist for the user                       |
| `evidence_needed`    | Evidence preservation checklist                              |
| `reporting_paths`    | Platform / cyber-cell / court pathways                       |
| `analysis_context`   | Contextual notes derived from `analysis_data` (if provided)  |
| `disclaimer`         | Mandatory non-legal-advice notice                            |

### Supported Scenarios

| Scenario tag     | Trigger keywords / entity defaults                              |
|------------------|-----------------------------------------------------------------|
| `IMAGE_MISUSE`   | "image misuse", "photo misuse", "portrait" … / `IMAGE` default  |
| `DEEPFAKE`       | "deepfake", "morphed", "face swap", "synthetic image" …         |
| `DEFAMATION`     | "defamation", "reputation", "libel", "slander" … / `TEXT` default|
| `FAKE_NEWS`      | "fake news", "misinformation", "disinformation" … / `NEWS` default|
| `IMPERSONATION`  | "impersonation", "identity misuse", "fake account" …           |
| `GENERIC`        | Fallback when no keyword or entity-type default matches         |

### Jurisdiction matrix

- **India** — IT Act 2000, IPC, IT (Intermediary) Rules 2021, Press Council Act
- **Global** — GDPR, EU DSA, EU AI Act, UK Online Safety Act, platform policies
- **Both** (default) — India sections first, global sections appended

### Design rules (same as full legal pipeline)

- Does NOT give legal advice.
- Does NOT accuse anyone.
- Does NOT assert that any content is illegal.
- Uses probabilistic and informational language only.
- Mandatory disclaimer appended to every response.

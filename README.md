<div align="center">

<img src="public/icon.png" width="140" alt="Entity X Logo" />

# ENTITY X

### AI-Powered Digital Integrity Intelligence Platform

*Detect deepfakes. Expose misinformation. Protect the truth — in real time.*

<br/>

[![Release](https://img.shields.io/github/v/release/jayaprakash2207/ENTITY-X?style=for-the-badge&color=6366f1&label=Latest%20Release)](https://github.com/jayaprakash2207/ENTITY-X/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/jayaprakash2207/ENTITY-X/build.yml?style=for-the-badge&color=22c55e&label=CI%2FCD)](https://github.com/jayaprakash2207/ENTITY-X/actions)
[![Electron](https://img.shields.io/badge/Electron-36.x-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.129-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge)](LICENSE.txt)

<br/>

[**⬇️ Download for Windows**](https://github.com/jayaprakash2207/ENTITY-X/releases/latest) · [**📖 Docs**](#-getting-started) · [**🐛 Report Bug**](https://github.com/jayaprakash2207/ENTITY-X/issues) · [**💬 Discussions**](https://github.com/jayaprakash2207/ENTITY-X/discussions)

</div>

---

## What is Entity X?

**Entity X** is a desktop application that acts as your personal AI forensic analyst — silently monitoring every image, article, and video you encounter online, scoring them for authenticity in real time.

It embeds a live AI layer into a built-in browser. As you browse, Entity X automatically:

- Scans images for **deepfake manipulation** using a 5-model ML ensemble (ViT + SwinV2 + UniversalFakeDetect + CLIP + SDXL)
- Detects **AI-generated text** using RoBERTa transformer classifiers
- Performs **forensic article analysis** via Gemini 2.0 Flash
- Maintains a live **Trust Score** for your current session
- Provides **legal guidance and complaint drafting** for digital rights violations

All powered by real AI — no setup, no API keys needed. Just install and use.

---

## ✨ Feature Overview

<table>
<tr>
<td width="50%">

### 🔍 Live Detection
- **Image Deepfake Scanner** — 5-model ensemble (ViT 99.3%, SwinV2 98.1%, UniversalFakeDetect CVPR-2023, CLIP, SDXL detector)
- **C2PA / EXIF Metadata** — Definitively detects AI tool watermarks (DALL-E, Midjourney, Stable Diffusion, Firefly)
- **AI Text Detector** — RoBERTa-based chatgpt-detector with statistical ensemble
- **Video Analyzer** — Frame-level deepfake scoring pipeline
- **Audio Analyzer** — Voice synthesis detection
- **News Scanner** — Article provenance and source credibility

</td>
<td width="50%">

### 🧠 Intelligence
- **Forensic Lab** — Deep-dive forensic evidence viewer
- **Investigation Mode** — Per-entity detailed analysis
- **Audit History** — Full session detection timeline
- **Trust Score Engine** — Live session integrity metric (0–100)
- **Watchlist Monitor** — Track and alert on specific entities
- **Domain Intelligence** — Domain reputation analysis
- **Provenance Chain** — Content origin tracing

</td>
</tr>
<tr>
<td width="50%">

### ⚖️ Legal Intelligence
- **Complaint Generator** — AI-drafted platform/authority complaint letters
- **Legal Chat Assistant** — Jurisdiction-aware guidance (India / EU / Global)
- **Evidence Packager** — Structured forensic evidence for proceedings
- **Judge Report Generator** — Court-ready forensic reports
- Laws covered: IT Act 2000, IPC, GDPR, EU AI Act, DSA, UK OSB, US CDA §230

</td>
<td width="50%">

### 🛡️ Monitoring & Alerts
- **Alert Rules Engine** — Custom rules with real-time toast notifications
- **Social Scanner** — Social media content monitoring
- **Creator Shield** — Protect original content from misuse
- **Threat Map** — Geographic threat visualization
- **Case Manager** — Organize investigations into cases
- **Community DB** — Shared threat intelligence database
- **PDF Analyzer** — Document forensics and AI detection

</td>
</tr>
</table>

---

## 🤖 AI & ML Stack

Entity X uses a **multi-tier AI strategy** — production-grade models with intelligent cloud fallbacks:

### Image Deepfake Detection

| Tier | Model | Accuracy | Method |
|------|-------|----------|--------|
| Primary | `dima806/deepfake_vs_real_image_detection` (ViT) | **99.3%** | HuggingFace Inference API |
| Secondary | `haywoodsloan/ai-image-detector-deploy` (SwinV2) | **98.1%** | HuggingFace Inference API |
| Research | UniversalFakeDetect (CLIP ViT-L/14, CVPR 2023) | State-of-art | Local / HF API |
| Supplementary | `umm-maybe/AI-image-detector` (CLIP) | — | HuggingFace Inference API |
| Supplementary | `Organika/sdxl-detector` | — | HuggingFace Inference API |
| Metadata | C2PA / EXIF / PNG watermark scan | **100%** (when present) | Built-in (Pillow) |

### Text & Article Analysis

| Model | Purpose | Provider |
|-------|---------|---------|
| `Hello-SimpleAI/chatgpt-detector-roberta` | AI text detection | HuggingFace Inference API |
| Gemini 2.0 Flash | Full forensic article analysis | Google AI Studio |
| Statistical ensemble | Burstiness, vocabulary, pattern analysis | Built-in |

### Language Models (Chat, Legal, Copilot)

| Model | Use Case | Provider |
|-------|---------|---------|
| DeepSeek R1 / DeepSeek Chat | Primary reasoning | OpenRouter (free) |
| Gemma 3 27B / 12B | Fallback LLM | OpenRouter (free) |
| Mistral Small 3.1 24B | Legal generation | OpenRouter (free) |
| Llama 4 Scout / Llama 3.3 70B | Fallback chain | OpenRouter (free) |
| Gemini 2.0 Flash | Chat fallback | Google AI Studio |
| Pollinations.ai | Last-resort fallback | No key required |
| Groq (Llama 3.3 70B) | Ultra-fast inference | Groq Cloud |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ELECTRON DESKTOP APP                          │
│                                                                  │
│  ┌─────────────────┐   IPC    ┌──────────────────────────────┐  │
│  │  Main Process   │◄────────►│      Renderer (React)        │  │
│  │  (main.js)      │          │                              │  │
│  │                 │          │  Live Browser  │  20+ Pages  │  │
│  │  • AI Calls     │          │  (WebView)     │  (Features) │  │
│  │  • Gemini API   │          │                              │  │
│  │  • OpenRouter   │          └──────────────────────────────┘  │
│  │  • Groq API     │                                            │
│  │  • SQLite DB    │                                            │
│  │  • Auto-updater │                                            │
│  └────────┬────────┘                                            │
└───────────┼─────────────────────────────────────────────────────┘
            │ HTTPS
            ▼
┌───────────────────────────────────────────────────────────────┐
│           CLOUD BACKEND  (Render.com · Docker · FastAPI)       │
│                  https://entity-x.onrender.com                 │
│                                                                │
│  /api/image-monitor  →  ViT + SwinV2 via HF Inference API     │
│  /api/text-monitor   →  RoBERTa via HF Inference API          │
│  /api/news-scanner   →  Article scraping + analysis           │
│  /api/legal/*        →  Legal chat + complaint generation      │
│  /api/health         →  Liveness probe                        │
│                                                                │
│  Trust Engine  │  SQLite History  │  Watchlist  │  Alerts     │
└───────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 36.x + Node.js |
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | FastAPI 0.129 + uvicorn (Python 3.11) |
| Database | better-sqlite3 (Electron) + SQLite (Python) |
| Cloud Hosting | Render.com (Docker) |
| CI/CD | GitHub Actions → GitHub Releases |
| Installer | electron-builder NSIS (Windows x64) |
| Auto-update | electron-updater (GitHub Releases) |

---

## 🛡️ Trust Score System

Every session starts at **100/100**. As you browse, it degrades with each suspicious detection:

```
trust_score -= fake_probability × 100   (clamped to 0–100)
```

| Score | Status |
|-------|--------|
| 🟢 90–100 | High integrity |
| 🟡 70–89 | Some suspicious content |
| 🟠 50–69 | Multiple detections — caution |
| 🔴 0–49 | Heavy deepfake / misinformation activity |

---

## ⬇️ Installation

### Option A — Download Installer (Recommended)

1. Go to [**Releases**](https://github.com/jayaprakash2207/ENTITY-X/releases/latest)
2. Download `Entity-X-Setup-x.x.x.exe`
3. Run the installer → Launch Entity X
4. Everything works out of the box — cloud backend + all AI features included

> No Python, no API keys, no setup required.

### Option B — Run from Source (Developers)

```bash
# 1. Clone
git clone https://github.com/jayaprakash2207/ENTITY-X.git
cd ENTITY-X

# 2. Install Node dependencies
npm install

# 3. Set up Python venv
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
pip install -r backend/requirements.txt

# 4. Configure API keys (.env file)
cp .env.example .env
# Edit .env and add your keys

# 5. Launch
npm start
```

---

## ⚙️ Configuration

Create a `.env` file in the project root (copy from `.env.example`):

```env
# AI Keys — get these for free:
GEMINI_API_KEY=        # aistudio.google.com (free)
OPENROUTER_API_KEY=    # openrouter.ai (free)
GROQ_API_KEY=          # console.groq.com (free)
HF_API_KEY=            # huggingface.co/settings/tokens (free)

# Cloud backend (set automatically in production builds)
ENTITY_X_CLOUD_URL=https://entity-x.onrender.com

# Leave empty to force local backend in dev
# ENTITY_X_CLOUD_URL=
```

---

## 🔒 Security

- **Electron hardening** — context isolation, sandbox, `setPermissionRequestHandler`, `setCertificateVerifyProc`, `setWindowOpenHandler`
- **SSRF protection** — blocks private IP ranges (10.x, 192.168.x, 127.x, 172.16.x) in all image fetches
- **Content-Type + magic-byte validation** — images verified at byte level before processing
- **10 MB size cap** — on all image downloads
- **No hard-coded secrets** — all keys via environment variables, never in source
- **Rate limiting** — `slowapi` on all backend endpoints

---

## 📁 Project Structure

```
ENTITY-X/
├── main.js                    # Electron main process (AI calls, IPC, backend spawn)
├── preload.js                 # Secure contextBridge (IPC bridge to renderer)
├── db.js                      # SQLite database layer
├── Dockerfile                 # Cloud backend container
├── render.yaml                # Render.com deployment config
│
├── renderer/                  # React frontend (20+ pages)
│   ├── App.jsx                # Root component + routing
│   ├── components/            # BrowserShell, TabBar, ChatPanel, DetectionFeed
│   └── pages/                 # ControlCenter, Investigation, ForensicLab,
│                              #   LegalGenerator, TextAnalyzer, VideoAnalyzer,
│                              #   AudioAnalyzer, DomainReputation, AlertRules,
│                              #   SocialScanner, CreatorShield, ThreatMap,
│                              #   CaseManager, CommunityDB, Newsroom,
│                              #   TrustBadge, WatchlistMonitor, PDFAnalyzer,
│                              #   ProvenanceChain, AuditHistory
│
├── backend/                   # FastAPI Python backend
│   ├── main.py                # API routes + app factory
│   ├── ai/
│   │   ├── image_model.py     # 5-model deepfake ensemble + HF API fallback
│   │   ├── text_model.py      # RoBERTa AI-text detector + HF API fallback
│   │   └── video_model.py     # Video frame analysis pipeline
│   ├── monitor/               # image_scanner, news_scanner, video_scanner
│   ├── trust/                 # trust_engine.py (session scoring)
│   ├── legal/                 # guidance, complaint_drafter, legal_chat, judge_report
│   ├── db/                    # database.py (detection history)
│   └── tests/                 # 115+ unit tests
│
└── .github/workflows/
    └── build.yml              # CI: test → PyInstaller → Vite → electron-builder → release
```

---

## 🧪 Running Tests

```bash
# Activate venv first
.venv\Scripts\activate

# Run all tests (excludes heavy face recognition deps)
python -m pytest backend/tests/ -q --tb=short \
  --ignore=backend/tests/test_face_recognizer.py \
  --ignore=backend/tests/test_person_registry.py
```

115 tests · 3 pre-existing skips (optional face recognition module)

---

## 🗺️ Roadmap

- [x] Real ML image deepfake detection (ViT + SwinV2 + CVPR-2023 model)
- [x] Real ML text AI detection (RoBERTa)
- [x] Cloud backend (Render.com)
- [x] Windows installer (electron-builder NSIS)
- [x] Auto-updater (electron-updater)
- [x] CI/CD pipeline (GitHub Actions)
- [x] 20+ feature pages
- [ ] macOS `.dmg` installer
- [ ] Browser extension (Chrome / Firefox)
- [ ] Mobile companion app
- [ ] Multi-language UI
- [ ] Fact-check database integration
- [ ] Enterprise API access

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m "feat: add amazing feature"`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📜 License

MIT License — see [LICENSE.txt](LICENSE.txt) for details.

Copyright © 2026 **Jayaprakash A R**

---

<div align="center">

<img src="public/icon.png" width="60" alt="Entity X" />

**Entity X** — *Because the truth deserves a defender.*

Made with ⚡ by [Jayaprakash A R](https://github.com/jayaprakash2207)

[![GitHub stars](https://img.shields.io/github/stars/jayaprakash2207/ENTITY-X?style=social)](https://github.com/jayaprakash2207/ENTITY-X/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/jayaprakash2207/ENTITY-X?style=social)](https://github.com/jayaprakash2207/ENTITY-X/network/members)

</div>

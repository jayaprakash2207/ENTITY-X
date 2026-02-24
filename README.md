<div align="center">

```
███████╗███╗   ██╗████████╗██╗████████╗██╗   ██╗    ██╗  ██╗
██╔════╝████╗  ██║╚══██╔══╝██║╚══██╔══╝╚██╗ ██╔╝    ╚██╗██╔╝
█████╗  ██╔██╗ ██║   ██║   ██║   ██║    ╚████╔╝      ╚███╔╝ 
██╔══╝  ██║╚██╗██║   ██║   ██║   ██║     ╚██╔╝       ██╔██╗ 
███████╗██║ ╚████║   ██║   ██║   ██║      ██║        ██╔╝ ██╗
╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝   ╚═╝      ╚═╝        ╚═╝  ╚═╝
```

**Real-Time Digital Integrity Intelligence Platform**

*Detect deepfakes. Expose misinformation. Protect the truth.*

[![Status](https://img.shields.io/badge/status-under%20development-orange?style=for-the-badge)](#)
[![Electron](https://img.shields.io/badge/Electron-40.x-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](#)

</div>

---

## ⚡ What is Entity X?

**Entity X** is a desktop-native digital forensics platform built for the era of synthetic media. It embeds an AI-driven monitoring layer directly into a live browser, silently analyzing every image and article you encounter — scoring it for manipulation, AI generation, and misinformation risk in real time.

> 🚧 **This project is actively under development.** Core detection pipelines are functional. Video analysis, real ML model integration, and several advanced features are on the roadmap.

---

## 🎯 Core Capabilities

| Module | Description | Status |
|--------|-------------|--------|
| 🖼️ **Image Deepfake Detector** | Heuristic forensic scoring of images for synthetic manipulation | ✅ Active |
| 📰 **Text / Article Analyzer** | AI-generation probability + misinformation risk scoring | ✅ Active |
| 🛡️ **Trust Score Engine** | Per-session integrity score that degrades on each suspicious detection | ✅ Active |
| 🔬 **Forensic Explainability** | Human-readable forensic annotations for every detection | ✅ Active |
| ⚖️ **Legal Complaint Generator** | AI-drafted neutral content review requests | ✅ Active |
| 🧑‍⚖️ **Legal Chat Assistant** | Jurisdiction-aware (India / Global / Both) legal guidance | ✅ Active |
| 🗂️ **Entity Investigation Mode** | Deep-dive view for every flagged entity with export support | ✅ Active |
| 🎬 **Video Scanner** | Frame-level deepfake analysis for video content | 🚧 Planned |
| 📡 **News / Source Scanner** | Article provenance and source credibility pipeline | 🚧 Planned |
| 🤖 **Real ML Models** | Swap heuristics for Hugging Face classifiers | 🚧 Planned |

---

## 🏗️ Architecture

Entity X is a two-process application:

```
┌─────────────────────────────────────────────────────────────┐
│                      ELECTRON APP                           │
│                                                             │
│  ┌──────────────┐   IPC    ┌─────────────────────────────┐  │
│  │  Main Process │◄───────►│      Renderer Process       │  │
│  │  (main.js)   │         │   (HTML / CSS / JS UI)      │  │
│  │              │         │                             │  │
│  │  • AI calls  │         │  ┌─────────┐  ┌─────────┐  │  │
│  │  • DB layer  │         │  │  Live   │  │ Entity  │  │  │
│  │  • Backend   │         │  │ Monitor │  │ History │  │  │
│  │    spawn     │         │  │         │  │         │  │  │
│  └──────┬───────┘         │  └─────────┘  └─────────┘  │  │
│         │ HTTP            └─────────────────────────────┘  │
│         │ localhost:8000                                     │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                   PYTHON BACKEND (FastAPI)                  │
│                                                             │
│  /api/image-monitor   →  AI Image Analyzer                 │
│  /api/text-monitor    →  AI Text Analyzer                  │
│  /api/legal/generate  →  Complaint Drafter                 │
│  /api/legal/chat      →  Legal Chat Assistant              │
│  /api/history         →  Detection History                 │
│  /api/health          →  Liveness Probe                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🤖 AI Stack

Entity X leverages a multi-model AI strategy with graceful fallbacks:

| Layer | Model / API | Purpose |
|-------|-------------|---------|
| Primary Analysis | **Google Gemini 2.0 Flash** | Full forensic article analysis (risk scores, claims, summary) |
| Legal Generation | **OpenRouter** (free tier) | Legal complaint drafting + legal chat |
| Model Fallbacks | `liquid/lfm-2.5`, `google/gemma-3`, `meta-llama/llama-3.x` | Resilient multi-model chain |
| Image Detection | Heuristic (SHA-256 + byte entropy) | Deepfake probability scoring *(real model: planned)* |
| Text Detection | Vocabulary heuristics + domain signals | AI-generation + misinformation *(real model: planned)* |

> All AI keys can be overridden via environment variables — see [Configuration](#️-configuration).

---

## 🛡️ Trust Score System

Every browsing session starts with a **Trust Score of 100**. Each detection event subtracts a probability-weighted penalty:

```
trust_score -= fake_probability × 100   (clamped to 0 – 100)
```

The score reflects the cumulative integrity of everything you've encountered in the session — a living measure of the digital environment you're browsing in.

---

## ⚖️ Legal Intelligence

Entity X includes a complete **LegalTech pipeline**:

- **Complaint Generator** — produces neutral, non-accusatory content review request drafts suitable for filing with platforms, cyber cells, or courts.
- **Legal Chat** — jurisdiction-aware assistant covering:
  - 🇮🇳 **India** — IT Act 2000, IPC, IT (Intermediary) Rules 2021, Press Council Act
  - 🌍 **Global** — GDPR, EU DSA, EU AI Act, UK Online Safety Act
  - **Both** — Combined India + Global sections

Supported scenarios: `DEEPFAKE` · `IMAGE_MISUSE` · `DEFAMATION` · `FAKE_NEWS` · `IMPERSONATION` · `GENERIC`

> ⚠️ Entity X does **not** give legal advice. All outputs are informational and include a mandatory disclaimer.

---

## 📁 Project Structure

```
ENTITY-X/
├── main.js                  # Electron main process — app core, AI calls, IPC
├── preload.js               # Renderer preload — secure IPC bridge
├── db.js                    # SQLite database layer (better-sqlite3)
│
├── renderer/                # Frontend UI (Electron renderer)
│   ├── index.html           # Main app shell — navigation + sections
│   ├── sidebar.html/js      # Detection sidebar
│   ├── entity-view.html/js  # Entity investigation deep-dive
│   ├── history.html/js      # Detection history browser
│   └── webview-preload.js   # Webview content injection
│
├── backend/                 # Python FastAPI backend
│   ├── main.py              # App entry-point + all API routes
│   ├── app.py               # FastAPI app factory + models
│   ├── requirements.txt     # Python dependencies
│   ├── ai/
│   │   ├── image_model.py   # Deepfake image analyzer
│   │   ├── text_model.py    # AI-text + misinformation analyzer
│   │   └── video_model.py   # Video analyzer stub (planned)
│   ├── forensic/
│   │   └── explainability.py # Forensic annotation enrichment
│   ├── monitor/
│   │   ├── image_scanner.py  # SSRF-safe image fetcher
│   │   ├── content_discovery.py # URL-type classifier
│   │   ├── news_scanner.py   # News scraper stub (planned)
│   │   └── video_scanner.py  # Video scanner stub (planned)
│   ├── trust/
│   │   └── trust_engine.py  # Async per-session trust scorer
│   ├── db/
│   │   └── database.py      # In-memory detection history store
│   └── utils/
│       └── scheduler.py     # Background task scheduler
│
└── legal/                   # Legal pipeline (top-level package)
    ├── guidance.py          # Orchestrator: build_legal_output()
    ├── complaint_drafter.py # Complaint text formatter
    ├── evidence_packager.py # Evidence block builder
    ├── legal_chat.py        # Legal chat pipeline
    └── disclaimer.py        # Mandatory disclaimer string
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.10+
- **Git**

### 1 — Clone & Install Node Dependencies

```bash
git clone https://github.com/jayaprakash2207/ENTITY-X.git
cd ENTITY-X
npm install
```

### 2 — Set Up Python Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 3 — Start the Backend

From the **project root** (one level above `backend/`):

```bash
uvicorn backend.main:app --reload --port 8000
```

Interactive API docs → [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 4 — Launch the Electron App

```bash
# In a new terminal, from the project root
npm start
```

---

## ⚙️ Configuration

All sensitive keys should be set as environment variables — never hard-coded in production:

| Variable | Purpose | Default |
|----------|---------|---------|
| `GEMINI_API_KEY` | Google Gemini 2.0 Flash API key | **⚠️ Must be set — use your own key** |
| `OPENROUTER_API_KEY` | OpenRouter API key (legal AI + chat) | **⚠️ Must be set — use your own key** |
| `IMAGE_MONITOR_API_URL` | Override image-monitor endpoint | `http://127.0.0.1:8000/api/image-monitor` |
| `TEXT_MONITOR_API_URL` | Override text-monitor endpoint | `http://127.0.0.1:8000/api/text-monitor` |

> ⚠️ **Never commit API keys to source control.** Always supply keys via environment variables. Obtain your own keys from the [Google AI Studio](https://aistudio.google.com/apikey) (Gemini) and [OpenRouter](https://openrouter.ai/keys) dashboards.

```powershell
# Windows PowerShell
$env:GEMINI_API_KEY="AIza..."
$env:OPENROUTER_API_KEY="sk-or-v1-..."
npm start
```

```bash
# macOS / Linux
GEMINI_API_KEY="AIza..." OPENROUTER_API_KEY="sk-or-v1-..." npm start
```

---

## 🔒 Security Design

- **SSRF Protection** — All image fetching blocks private IP ranges (`10.x`, `192.168.x`, `127.x`, etc.)
- **Content-Type Validation** — Only accepted MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/bmp`, `image/tiff`
- **Magic-Byte Verification** — File headers are checked against declared content type
- **10 MB Cap** — Image downloads are hard-limited to prevent memory exhaustion
- **Electron Context Isolation** — Renderer and main processes are fully isolated via `contextBridge`
- **No Legal Advice** — All legal outputs carry a mandatory disclaimer; the system never accuses or asserts illegality

---

## 🗺️ Roadmap

- [ ] Real deepfake ML model integration (Hugging Face classifiers)
- [ ] Video frame-level deepfake analysis
- [ ] News article provenance & source credibility scoring
- [ ] Persistent detection database (cross-session history)
- [ ] Electron auto-updater
- [ ] Packaged installers (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`)
- [ ] Browser extension companion (Chrome / Firefox)
- [ ] Dashboard analytics with trend visualization
- [ ] Multi-language UI support

---

## 🤝 Contributing

This project is under active development. Contributions, ideas, and bug reports are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📜 License

ISC License — see [LICENSE](LICENSE) for details.

---

<div align="center">

*Built with ⚡ by [jayaprakash2207](https://github.com/jayaprakash2207)*

**Entity X** — *Because the truth deserves a defender.*

</div>

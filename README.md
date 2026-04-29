<div align="center">

```
███████╗███╗   ██╗████████╗██╗████████╗██╗   ██╗    ██╗  ██╗
██╔════╝████╗  ██║╚══██╔══╝██║╚══██╔══╝╚██╗ ██╔╝    ╚██╗██╔╝
█████╗  ██╔██╗ ██║   ██║   ██║   ██║    ╚████╔╝      ╚███╔╝ 
██╔══╝  ██║╚██╗██║   ██║   ██║   ██║     ╚██╔╝       ██╔██╗ 
███████╗██║ ╚████║   ██║   ██║   ██║      ██║       ██╔╝ ██╗
╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝   ╚═╝      ╚═╝       ╚═╝  ╚═╝
```

# **Entity X**
### Real-Time Digital Integrity Intelligence Platform
*Detect deepfakes. Expose misinformation. Protect the truth.*

[![Status](https://img.shields.io/badge/status-under%20active%20development-orange?style=for-the-badge)](#-project-status)
[![Electron](https://img.shields.io/badge/Electron-40.x-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](#-license)
[![GitHub](https://img.shields.io/badge/GitHub-jayaprakash2207-181717?style=for-the-badge&logo=github)](https://github.com/jayaprakash2207/ENTITY-X)

</div>

---

## 📑 Table of Contents

- [About Entity X](#-about-entity-x)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [AI Stack](#-ai-stack)
- [Trust Score System](#-trust-score-system)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Configuration](#️-configuration)
- [API Endpoints](#-api-endpoints)
- [Security Design](#-security-design)
- [Legal Intelligence](#-legal-intelligence)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 About Entity X

**Entity X** is a desktop-native digital forensics platform engineered for the era of synthetic media. It embeds an AI-driven monitoring layer directly into a live browser experience, **silently analyzing every image and article you encounter** — scoring each for:

- 🎬 **Deepfake detection** (image manipulation & synthesis)
- 🤖 **AI-generated content** (text generation detection)
- ⚠️ **Misinformation risk** (claim factuality assessment)
- 🔬 **Forensic evidence** (human-readable explanations)

All in **real-time**, with a **live Trust Score** that reflects the overall integrity of your digital environment.

> 🚧 **Project Status:** Core detection pipelines are fully functional. Video analysis, real ML models, and several advanced features are on the development roadmap.

---

## ✨ Key Features

### Detection & Monitoring

| Feature | Description | Status |
|---------|-------------|--------|
| 🖼️ **Image Deepfake Detector** | Heuristic-based forensic scoring of images for synthetic manipulation | ✅ Active |
| 📰 **Article Analyzer** | AI-generation probability + misinformation risk scoring + claim extraction | ✅ Active |
| 🛡️ **Live Trust Score** | Per-session integrity metric that degrades with each suspicious detection | ✅ Active |
| 🔬 **Forensic Explainability** | Human-readable forensic annotations for every detection | ✅ Active |

### Legal & Compliance

| Feature | Description | Status |
|---------|-------------|--------|
| ⚖️ **Complaint Generator** | AI-drafted neutral content review requests for platforms & authorities | ✅ Active |
| 🧑‍⚖️ **Legal Chat Assistant** | Jurisdiction-aware (India/Global/Both) legal guidance & regulations | ✅ Active |
| 📋 **Evidence Packager** | Structured forensic evidence compilation for legal proceedings | ✅ Active |

### Investigation & History

| Feature | Description | Status |
|---------|-------------|--------|
| 🗂️ **Entity Investigation** | Deep-dive view for every flagged entity with detailed forensic data | ✅ Active |
| 📊 **Detection History** | Session-based detection history with export capabilities | ✅ Active |
| 🔍 **Content Discovery** | Automatic URL-type classification (image/article/video) | ✅ Active |

### Planned Features

| Feature | Description | Status |
|---------|-------------|--------|
| 🎬 **Video Scanner** | Frame-level deepfake analysis for video content | 🚧 Planned |
| 📡 **News Scanner** | Article provenance & source credibility pipeline | 🚧 Planned |
| 🤖 **Real ML Models** | Integration of Hugging Face deepfake & text classifiers | 🚧 Planned |
| 📱 **Browser Extension** | Chrome/Firefox companion extension | 🚧 Planned |

---

## 🏗️ Architecture

Entity X is a **two-process desktop application** with clear separation of concerns:

```
┌────────────────────────────────────────────────────────────────────┐
│                      ELECTRON APP (Node.js)                        │
│                                                                    │
│  ┌──────────────────┐         IPC          ┌─────────────────┐    │
│  │ Main Process     │◄───────────────────►│ Renderer Process │    │
│  │ (main.js)        │                     │ (HTML/CSS/JS UI)│    │
│  │                  │                     │                 │    │
│  │ • AI Integration │                     │ ┌─────────────┐ │    │
│  │ • DB Layer       │                     │ │ Live Monitor│ │    │
│  │ • Backend Spawn  │                     │ │ Entity View │ │    │
│  │ • System Calls   │                     │ │ History     │ │    │
│  └────────┬─────────┘                     │ └─────────────┘ │    │
│           │                               └─────────────────┘    │
│           │ HTTP (localhost:8000)                                 │
└───────────┼─────────────────────────────────────────────────────┘
            │
┌───────────▼──────────────────────────────────────────────────────┐
│              PYTHON BACKEND (FastAPI + Async)                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ API ROUTES                                               │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ POST /api/image-monitor        → Image Deepfake Scanner │   │
│  │ POST /api/text-monitor         → Article Analyzer       │   │
│  │ POST /api/legal/generate       → Complaint Generator    │   │
│  │ POST /api/legal/chat           → Legal Chat Assistant   │   │
│  │ GET  /api/history              → Detection History      │   │
│  │ GET  /api/health               → Liveness Probe         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ AI Analyzers │  │ Trust Engine │  │ DB Layer     │           │
│  │ (ML Models)  │  │ (Scoring)    │  │ (In-Memory)  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└───────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Desktop UI** | Electron 40.x | Cross-platform desktop app |
| **Rendering** | HTML5/CSS3/JavaScript | Modern responsive UI |
| **Backend** | FastAPI 0.115+ | Async REST API |
| **Language** | Python 3.10+ | Core AI logic & analysis |
| **Database** | better-sqlite3 | Local session history |
| **IPC** | Electron IPC | Main ↔ Renderer communication |

---

## 🤖 AI Stack

Entity X uses a **multi-model strategy** with intelligent fallbacks for resilience:

### Primary Models

| Purpose | Model | API | Status |
|---------|-------|-----|--------|
| **Full Article Analysis** | Google Gemini 2.0 Flash | Google AI Studio | ✅ Active |
| **Legal Generation** | OpenRouter (Dynamic) | OpenRouter API | ✅ Active |
| **Fallback Models** | Llama 3.x, Gemma-3, LFM-2.5 | OpenRouter | ✅ Active |

### Detection Strategies

| Component | Current Method | Planned | Status |
|-----------|----------------|---------|--------|
| **Image Deepfakes** | Heuristic (SHA-256 + Entropy) | Real ML Model | 🚧 Planned |
| **AI Text Detection** | Vocabulary + Domain Signals | Transformer Classifier | 🚧 Planned |
| **Misinformation** | Claim Extraction + Scoring | Fact-Check DB Integration | 🚧 Planned |
| **Video Analysis** | *Not yet implemented* | Frame-level deepfake scoring | 🚧 Planned |

### Environment Configuration

All AI API keys are managed through **environment variables** (never hard-coded):

```bash
GEMINI_API_KEY="AIza..."
OPENROUTER_API_KEY="sk-or-v1-..."
```

If not set, the application uses bundled development keys (intended for demo/testing only).

---

## 🛡️ Trust Score System

Every browsing session starts with a **Trust Score of 100** (0–100 range).

### Scoring Mechanism

```
trust_score -= fake_probability × 100   (result clamped to 0–100)
```

**Examples:**
- Image flagged as 75% deepfake → Trust Score drops by 75 points
- Article detected as 40% AI-generated → Trust Score drops by 40 points
- Clean content detected → No change

### Interpretation

| Score | Interpretation |
|-------|-----------------|
| **90–100** | High integrity; minimal suspicious content |
| **70–89** | Moderate; some flagged items encountered |
| **50–69** | Caution; multiple suspicious detections |
| **0–49** | Severe; heavy misinformation/deepfakes detected |

The Trust Score **reflects your cumulative digital environment** — a living measure of the truth you've encountered in your current session.

---

## ⚖️ Legal Intelligence Module

### Complaint Generator

Generates **neutral, non-accusatory** content review request drafts suitable for:
- Platform reporting (YouTube, Facebook, Twitter, TikTok)
- Cybercrime cells & law enforcement
- Court filings & legal proceedings

### Legal Chat Assistant

Jurisdiction-aware guidance covering:

#### 🇮🇳 **India**
- IT Act 2000 (sections 66, 67, 67A, 67B)
- Indian Penal Code (defamation, identity theft)
- IT (Intermediary) Rules 2021
- Press Council Act 1978

#### 🌍 **Global**
- GDPR (EU data protection)
- Digital Services Act (EU)
- EU AI Act & Online Safety Regulations
- UK Online Safety Bill 2023
- US Section 230 (CDA)

#### **Supported Scenarios**
- `DEEPFAKE` — Face/voice synthesis misuse
- `IMAGE_MISUSE` — Photo manipulation & false context
- `DEFAMATION` — False statements causing harm
- `FAKE_NEWS` — Misinformation & disinformation
- `IMPERSONATION` — Identity fraud & account takeover
- `GENERIC` — General legal information

### ⚠️ Important Disclaimer

**Entity X does NOT provide legal advice.** All outputs are:
- ✅ Informational only
- ✅ Jurisdiction-specific guidance
- ✅ General education on relevant laws
- ❌ NOT a substitute for professional legal counsel

Every output includes a **mandatory disclaimer** reminding users to consult actual attorneys.

---

## 📁 Project Structure

```
ENTITY-X/
│
├── 📄 main.js                      # Electron main process entry point
├── 📄 preload.js                   # Secure IPC bridge (contextBridge)
├── 📄 db.js                        # SQLite database layer
├── 📄 package.json                 # Node.js dependencies
│
├── 📂 renderer/                    # Electron Renderer Process (Frontend)
│   ├── 📄 index.html               # Main app shell & navigation
│   ├── 📄 index.js                 # Main renderer logic
│   ├── 📄 sidebar.html/js          # Real-time detection sidebar
│   ├── 📄 entity-view.html/js      # Deep-dive investigation view
│   ├── 📄 history.html/js          # Detection history browser
│   ├── 📄 style.css                # Global styling
│   └── 📄 webview-preload.js       # Content injection for browsers
│
├── 📂 backend/                     # Python FastAPI Backend
│   ├── 📄 main.py                  # FastAPI app + all route definitions
│   ├── 📄 app.py                   # FastAPI application factory
│   ├── 📄 requirements.txt          # Python package dependencies
│   │
│   ├── 📂 ai/                      # AI Model Layer
│   │   ├── 📄 image_model.py       # Deepfake image analyzer
│   │   ├── 📄 text_model.py        # AI-text + misinformation detector
│   │   └── 📄 video_model.py       # Video analyzer (stub)
│   │
│   ├── 📂 forensic/                # Explainability & Evidence
│   │   └── 📄 explainability.py    # Forensic annotation enrichment
│   │
│   ├── 📂 monitor/                 # Content Scanning & Discovery
│   │   ├── 📄 image_scanner.py     # SSRF-safe image fetcher
│   │   ├── 📄 content_discovery.py # URL-type classifier
│   │   ├── 📄 news_scanner.py      # News scraper (stub)
│   │   └── 📄 video_scanner.py     # Video scanner (stub)
│   │
│   ├── 📂 trust/                   # Trust Score Engine
│   │   └── 📄 trust_engine.py      # Async per-session trust scoring
│   │
│   ├── 📂 db/                      # Data Layer
│   │   └── 📄 database.py          # In-memory detection history
│   │
│   └── 📂 utils/                   # Utilities
│       └── 📄 scheduler.py         # Background task scheduler
│
└── 📂 legal/                       # Legal Pipeline (Top-level Package)
    ├── 📄 guidance.py              # Orchestrator: build_legal_output()
    ├── 📄 complaint_drafter.py     # Complaint text formatter
    ├── 📄 evidence_packager.py     # Evidence block builder
    ├── 📄 legal_chat.py            # Legal chat pipeline
    └── 📄 disclaimer.py            # Mandatory disclaimer string
```

---

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js** 18.0 or higher
- **npm** 9.0 or higher
- **Python** 3.10 or higher
- **Git**

### Step 1: Clone the Repository

```bash
git clone https://github.com/jayaprakash2207/ENTITY-X.git
cd ENTITY-X
```

### Step 2: Install Node Dependencies

```bash
npm install
```

### Step 3: Set Up Python Backend

Navigate to the backend directory and create a virtual environment:

```bash
cd backend
```

**On Windows (PowerShell):**
```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

**On macOS / Linux:**
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Step 4: Configure API Keys (Optional)

Set environment variables for AI API keys. If not set, development keys are used.

**Windows (PowerShell):**
```powershell
$env:GEMINI_API_KEY="AIza..."
$env:OPENROUTER_API_KEY="sk-or-v1-..."
```

**macOS / Linux:**
```bash
export GEMINI_API_KEY="AIza..."
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### Step 5: Start the Python Backend

From the project root (parent of `backend/` directory):

```bash
uvicorn backend.main:app --reload --port 8000
```

✅ Backend is running! Check interactive API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### Step 6: Launch the Electron App

Open a **new terminal** in the project root:

```bash
npm start
```

🎉 Entity X desktop app should now launch!

---

## ⚙️ Configuration

All configuration is managed via **environment variables**. Never hard-code sensitive credentials.

### Environment Variables

| Variable | Purpose | Default | Notes |
|----------|---------|---------|-------|
| `GEMINI_API_KEY` | Google Gemini 2.0 Flash API key | Bundled dev key | Get from [Google AI Studio](https://aistudio.google.com) |
| `OPENROUTER_API_KEY` | OpenRouter API key (legal AI + chat) | Bundled dev key | Get from [OpenRouter](https://openrouter.ai) |
| `IMAGE_MONITOR_API_URL` | Custom image analyzer endpoint | `http://127.0.0.1:8000/api/image-monitor` | Override if backend on different host |
| `TEXT_MONITOR_API_URL` | Custom text analyzer endpoint | `http://127.0.0.1:8000/api/text-monitor` | Override if backend on different host |
| `BACKEND_TIMEOUT` | HTTP timeout (seconds) | `30` | Increase for slow networks |

### Example Configuration

**Windows (PowerShell):**
```powershell
$env:GEMINI_API_KEY="AIza1234567890abcdefghij"
$env:OPENROUTER_API_KEY="sk-or-v1-abcdef1234567890"
$env:BACKEND_TIMEOUT="60"
npm start
```

**macOS / Linux (.env file):**
```bash
# Create .env file in project root
GEMINI_API_KEY=AIza1234567890abcdefghij
OPENROUTER_API_KEY=sk-or-v1-abcdef1234567890
BACKEND_TIMEOUT=60
```

Then load and start:
```bash
source .env
npm start
```

---

## 🔌 API Endpoints

### Image Analysis

**POST** `/api/image-monitor`

Analyze an image for deepfake indicators.

```json
{
  "image_url": "https://example.com/image.jpg"
}
```

**Response:**
```json
{
  "deepfake_probability": 0.75,
  "fake_indicators": ["unusual_edge_artifacts", "inconsistent_lighting"],
  "forensic_details": "Image contains signs of blending artifacts...",
  "confidence": 0.82
}
```

### Text / Article Analysis

**POST** `/api/text-monitor`

Analyze article content for AI generation & misinformation.

```json
{
  "content": "Full article text here...",
  "title": "Article Title"
}
```

**Response:**
```json
{
  "ai_generated_probability": 0.45,
  "misinformation_risk": 0.62,
  "claims": ["Claim 1", "Claim 2"],
  "summary": "Summary of findings",
  "risk_level": "medium"
}
```

### Legal Complaint Generation

**POST** `/api/legal/generate`

Generate a complaint draft.

```json
{
  "content_type": "deepfake",
  "platform": "youtube",
  "description": "Deepfake video of public figure..."
}
```

**Response:**
```json
{
  "complaint_text": "Dear Platform Team...",
  "evidence_summary": "...",
  "jurisdiction": "global"
}
```

### Legal Chat

**POST** `/api/legal/chat`

Get legal guidance on a scenario.

```json
{
  "scenario": "deepfake",
  "jurisdiction": "india",
  "question": "What are my legal options?"
}
```

**Response:**
```json
{
  "guidance": "In India under the IT Act 2000...",
  "relevant_laws": ["IT Act 2000 §67", "IPC §500"],
  "disclaimer": "This is not legal advice..."
}
```

### Detection History

**GET** `/api/history`

Retrieve session detection history.

**Response:**
```json
{
  "detections": [
    {
      "id": "uuid",
      "timestamp": "2024-03-21T10:30:00Z",
      "type": "image",
      "url": "https://...",
      "result": {...}
    }
  ],
  "session_id": "uuid",
  "trust_score": 72
}
```

### Health Check

**GET** `/api/health`

Verify backend is running.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "backend_ready": true
}
```

---

## 🔒 Security Design

Entity X implements multiple security layers:

### Network Security

- ✅ **SSRF Protection** — All image/file fetching blocks private IP ranges:
  - `10.0.0.0/8`
  - `192.168.0.0/16`
  - `127.0.0.0/8`
  - `172.16.0.0/12`

- ✅ **Content-Type Validation** — Only accepted MIME types:
  - `image/jpeg`, `image/png`, `image/webp`
  - `image/gif`, `image/bmp`, `image/tiff`

- ✅ **Magic-Byte Verification** — File headers checked against declared type

- ✅ **Size Limits** — Hard cap of **10 MB** per image download

### Application Security

- ✅ **Electron Context Isolation** — Renderer & main processes fully isolated
- ✅ **Preload Script Hardening** — Only safe APIs exposed via `contextBridge`
- ✅ **No Eval or Dynamic Code** — No `eval()`, `Function()`, or `innerHTML` abuse
- ✅ **Content Security Policy** — Strict CSP headers on all responses
- ✅ **Input Validation** — All user inputs sanitized before processing

### Legal Compliance

- ✅ **No Accusations** — System never claims illegality or accuses individuals
- ✅ **Mandatory Disclaimers** — All legal outputs include warnings
- ✅ **Informational Only** — Legal module is educational, not advisory
- ✅ **User Consent** — Clear disclosure of data collection & monitoring

---

## 🗺️ Roadmap

### Near-term (Q2 2024)

- [ ] Real deepfake ML models (Hugging Face classifiers)
- [ ] Video frame-level analysis pipeline
- [ ] Persistent detection database (cross-session history)
- [ ] Electron auto-updater

### Medium-term (Q3 2024)

- [ ] News article provenance & source credibility
- [ ] Packaged installers (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`)
- [ ] Browser extension (Chrome / Firefox)
- [ ] Dashboard with analytics & trends

### Long-term (Q4 2024+)

- [ ] Multi-language UI support
- [ ] Real-time news feed monitoring
- [ ] Integration with fact-check databases
- [ ] Mobile app (iOS / Android)
- [ ] API access for enterprise clients

---

## 🤝 Contributing

Entity X is under **active development** and contributions are welcome!

### Contribution Process

1. **Fork** the repository
2. **Create** a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Commit** with descriptive messages:
   ```bash
   git commit -m "feat: add deepfake model integration"
   ```
4. **Push** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
5. **Open** a Pull Request with detailed description

### Development Guidelines

- **Code Style** — Follow PEP 8 (Python) & ESLint (JavaScript)
- **Testing** — Include tests for new features
- **Documentation** — Update docs for API changes
- **Commits** — Use conventional commit format
- **Reviews** — Be open to feedback and discussion

### Areas We Need Help With

- 🎯 ML model integration
- 🎬 Video analysis implementation
- 📱 Browser extension development
- 🌍 Localization & translations
- 📊 UI/UX improvements
- 🧪 Testing & QA

---

## 📜 License

This project is licensed under the **ISC License**.

See [LICENSE](LICENSE) for full details.

```
ISC License

Permission to use, copy, modify, and/or distribute this software
for any purpose with or without fee is hereby granted...
```

---

## 📞 Support & Contact

- **GitHub Issues** — [Report bugs](https://github.com/jayaprakash2207/ENTITY-X/issues)
- **Discussions** — [Ask questions](https://github.com/jayaprakash2207/ENTITY-X/discussions)
- **Author** — [@jayaprakash2207](https://github.com/jayaprakash2207)

---

<div align="center">

### Built with ⚡ by the Entity X Team

**Entity X** — *Because the truth deserves a defender.*

![Entity X Banner](https://img.shields.io/badge/Entity%20X-Digital%20Integrity%20Platform-blueviolet?style=for-the-badge)

</div>

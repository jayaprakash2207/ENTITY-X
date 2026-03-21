<div align="center">███████╗███╗    ██╗████████╗██╗████████╗██╗   ██╗     ██╗  ██╗
██╔════╝████╗   ██║╚══██╔══╝██║╚══██╔══╝╚██╗ ██╔╝     ╚██╗██╔╝
█████╗  ██╔██╗  ██║   ██║   ██║   ██║    ╚████╔╝       ╚███╔╝ 
██╔══╝  ██║╚██╗ ██║   ██║   ██║   ██║     ╚██╔╝        ██╔██╗ 
███████╗██║ ╚████║   ██║   ██║   ██║      ██║        ██╔╝ ██╗
╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝   ╚═╝      ╚═╝        ╚═╝  ╚═╝
Real-Time Digital Integrity Intelligence PlatformDetect deepfakes. Expose misinformation. Protect the truth.</div>⚡ What is Entity X?Entity X is a desktop-native digital forensics platform designed to police the era of synthetic media. It embeds an AI-driven monitoring layer directly into a live desktop environment, silently analyzing digital entities (images and text) in real time. It calculates manipulation probability, AI-generation likelihood, and misinformation risk.🚧 Active Development: Core detection heuristics and the Legal Intelligence pipeline are fully functional. Real-time video analysis and advanced ML model integrations are currently on the roadmap.🎯 Core CapabilitiesModuleDescriptionStatus🖼️ Image Forensic MonitorHeuristic scanning using SHA-256 and byte entropy to detect synthetic patterns.✅ Active📰 Text / Article AnalyzerAI-generation probability and misinformation scoring via Gemini 2.0 Flash.✅ Active🛡️ Dynamic Trust EngineA session-based integrity score (starts at 100) that degrades based on suspicious content.✅ Active🔬 Explainability LayerDetailed forensic notes explaining why content was flagged (e.g., high entropy).✅ Active⚖️ Legal Complaint DrafterAI-drafted content review requests tailored for platforms and cyber cells.✅ Active🧑‍⚖️ Jurisdiction ChatLegal guidance covering India (IT Act) and Global (EU AI Act/DSA) laws.✅ Active🗂️ Entity InvestigationDeep-dive UI for flagged entities with full evidence packaging.✅ Active🎬 Video ScannerFrame-by-frame deepfake detection for video streams.🚧 Planned🏗️ ArchitectureEntity X utilizes a dual-process architecture to ensure high-performance UI and secure forensic backend operations.Code snippetgraph TD
    A[Electron Frontend - Renderer] <-->|IPC Bridge| B[Main Process - main.js]
    B <-->|HTTP localhost:8000| C[Python FastAPI Backend]
    C --> D[AI Forensic Models]
    C --> E[Legal Intel Pipeline]
    C --> F[Session Trust Engine]
    B --- G[(Better-SQLite3 DB)]
🤖 AI & Forensic StackEntity X leverages a multi-layered detection strategy:Article Analysis: Powered by Google Gemini 2.0 Flash for deep semantic checking and summarization.Legal Generation: Multi-model fallback via OpenRouter (supporting liquid/lfm-2.5, google/gemma-3, and meta-llama).Image Forensics: Uses advanced heuristics analyzing file entropy and structure to identify synthetic artifacts.Trust Scoring: Probability-weighted logic: trust_score -= (fake_probability * 100).⚖️ Legal Intelligence PipelineThe platform includes a specialized LegalTech suite to move from detection to action:India Context: Covers IT Act 2000, IPC, and IT (Intermediary Guidelines) Rules 2021.Global Context: Covers GDPR, EU Digital Services Act (DSA), and the EU AI Act.Evidence Packaging: Automatically formats detection results into structured reports suitable for legal review.⚠️ Disclaimer: Entity X outputs are for informational purposes only and do not constitute legal advice.🔧 Installation & Setup1. PrerequisitesNode.js (v18+)Python (v3.14+)2. Backend SetupBashcd backend
python -m venv .venv
# Windows: .venv\Scripts\activate | Unix: source .venv/bin/activate
pip install -r requirements.txt
python main.py
3. Frontend SetupBash# In the root directory
npm install
npm start
⚙️ ConfigurationSet your environment variables to enable the full AI suite:VariableDescriptionGEMINI_API_KEYKey for forensic text analysis.OPENROUTER_API_KEYKey for legal drafting and chat assistance.🗺️ Roadmap[ ] ML-Native Image Detection: Move from entropy-based heuristics to Hugging Face Vision Transformers.[ ] Video Forensic Module: Real-time frame analysis for deepfake detection.[ ] Persistent History: Transition detection logs to permanent SQLite storage.[ ] Browser Companion: Companion extension to sync data between browser and desktop app.<div align="center">Built by jayaprakash2207Entity X — Because the truth deserves a defender.</div>

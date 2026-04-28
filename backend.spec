# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for Entity X backend (Python/FastAPI).
#
# Build with:
#   pip install pyinstaller
#   pyinstaller backend.spec
#
# Output: dist/entity_x_backend/entity_x_backend.exe
#
# The Electron main process spawns this executable as a child process.
# It binds to 127.0.0.1:8000 and reads .env from the same directory as the exe.

import sys
from pathlib import Path

ROOT = Path(SPECPATH)            # project root  (c:\MY-PROJECTS\ENTITY-X)
BACKEND = ROOT / "backend"

block_cipher = None

a = Analysis(
    [str(BACKEND / "main.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Include .env.example so users can see required vars
        (str(ROOT / ".env.example"), "."),
        # Include any model config files if present
        # (str(ROOT / "models"), "models"),   # uncomment if local model files exist
    ],
    hiddenimports=[
        # FastAPI + ASGI
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "fastapi",
        "fastapi.middleware.cors",
        "starlette.middleware.cors",
        "starlette.routing",
        "starlette.responses",
        "starlette.requests",
        "starlette.background",
        # Rate limiting
        "slowapi",
        "slowapi.errors",
        "slowapi.middleware",
        # HTTP client
        "httpx",
        "anyio",
        "anyio.abc",
        "anyio._backends._asyncio",
        # Image processing
        "PIL",
        "PIL.Image",
        "PIL.ImageFilter",
        # Environment / config
        "dotenv",
        # Standard library async
        "asyncio",
        "concurrent.futures",
        # Backend sub-packages (ensure all are bundled)
        "backend",
        "backend.ai",
        "backend.ai.text_model",
        "backend.ai.image_model",
        "backend.ai.video_model",
        "backend.ai.audio_model",
        "backend.ai.enrichment",
        "backend.ai.provenance",
        "backend.ai.generator_fingerprint",
        "backend.db",
        "backend.db.database",
        "backend.forensic",
        "backend.forensic.pdf_analyzer",
        "backend.forensic.explainability",
        "backend.legal",
        "backend.legal.guidance",
        "backend.legal.complaint_drafter",
        "backend.legal.evidence_packager",
        "backend.legal.disclaimer",
        "backend.legal.judge_report",
        "backend.legal.legal_chat",
        "backend.legal.hf_legal",
        "backend.monitor",
        "backend.monitor.news_scanner",
        "backend.monitor.image_scanner",
        "backend.monitor.video_scanner",
        "backend.monitor.watchlist",
        "backend.monitor.content_discovery",
        "backend.track",
        "backend.track.face_recognizer",
        "backend.track.person_registry",
        "backend.trust",
        "backend.trust.trust_engine",
        "backend.utils",
        "backend.utils.scheduler",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Dev/test dependencies — not needed at runtime
        "pytest",
        "pytest_asyncio",
        "unittest",
        "tkinter",
        "matplotlib",
        "notebook",
        "jupyter",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="entity_x_backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,           # keep console for log output
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "public" / "icon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="entity_x_backend",
)

"""
backend – Entity X digital-integrity monitor package.

Entry point:  backend.main:app  (FastAPI ASGI application)

Sub-packages:
    ai          Detection models (image, text, video)
    db          In-memory history store
    forensic    Forensic explainability utilities
    monitor     Content scanners (image, video, news)
    trust       Per-session trust-score engine
    utils       Background scheduler and shared utilities
"""

"""backend.ai – detection model sub-package."""
from .image_model import MockDeepfakeAnalyzer, AnalysisResult
from .text_model import MockTextAnalyzer
from .video_model import MockVideoAnalyzer

__all__ = [
    "MockDeepfakeAnalyzer",
    "AnalysisResult",
    "MockTextAnalyzer",
    "MockVideoAnalyzer",
]

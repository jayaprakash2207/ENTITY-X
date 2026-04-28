"""backend.ai – detection model sub-package."""
from .image_model import MockDeepfakeAnalyzer, RealDeepfakeAnalyzer, AnalysisResult
from .text_model import MockTextAnalyzer, RealTextAnalyzer
from .video_model import MockVideoAnalyzer, RealVideoAnalyzer, VideoAnalysisResult
from .audio_model import MockAudioAnalyzer, RealAudioAnalyzer, AudioAnalysisResult

__all__ = [
    "MockDeepfakeAnalyzer",
    "RealDeepfakeAnalyzer",
    "AnalysisResult",
    "MockTextAnalyzer",
    "RealTextAnalyzer",
    "MockVideoAnalyzer",
    "RealVideoAnalyzer",
    "VideoAnalysisResult",
    "MockAudioAnalyzer",
    "RealAudioAnalyzer",
    "AudioAnalysisResult",
]

"""backend.track – Person tracking and impersonation detection sub-package."""
from .person_registry import PersonRegistry, ProtectedPerson
from .face_recognizer import FaceRecognizer, FaceMatch

__all__ = [
    "PersonRegistry",
    "ProtectedPerson",
    "FaceRecognizer",
    "FaceMatch",
]

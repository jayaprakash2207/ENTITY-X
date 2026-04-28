"""
backend.track.face_recognizer – Face detection and recognition for impersonation tracking.

Detects faces in images/video frames and compares them against registered
protected persons to identify potential impersonation attempts.

Uses multiple backends:
- Primary: InsightFace (SOTA accuracy)
- Fallback: face_recognition library (dlib-based)
- Fallback: MediaPipe (lightweight, fast)
"""
from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from io import BytesIO
from typing import Optional

logger = logging.getLogger(__name__)

# Optional face recognition imports
try:
    import numpy as np
    NP_AVAILABLE = True
except ImportError:
    NP_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# Try InsightFace (SOTA)
try:
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    INSIGHTFACE_AVAILABLE = False
    logger.info("[face_recognizer] insightface not available")

# Try face_recognition (dlib-based)
try:
    import face_recognition
    FACE_RECOGNITION_AVAILABLE = True
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False
    logger.info("[face_recognizer] face_recognition not available")

# Try MediaPipe (lightweight)
try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False
    logger.info("[face_recognizer] mediapipe not available")


@dataclass
class FaceDetection:
    """A detected face in an image."""
    bbox: tuple[int, int, int, int]  # x, y, width, height
    confidence: float
    embedding: Optional[list[float]] = None
    landmarks: Optional[dict] = None


@dataclass
class FaceMatch:
    """A match between a detected face and a protected person."""
    person_id: str
    person_name: str
    similarity: float
    bbox: tuple[int, int, int, int]
    is_match: bool  # True if similarity exceeds threshold


class FaceRecognizer:
    """
    Face detection and recognition engine.
    
    Detects faces in images and compares embeddings against registered
    persons to identify potential impersonation.
    
    Supports multiple backends for flexibility:
    - InsightFace: Highest accuracy, requires onnxruntime
    - face_recognition: Good accuracy, requires dlib
    - MediaPipe: Fastest, lower accuracy
    """
    
    # Similarity thresholds for matching
    MATCH_THRESHOLD = 0.6  # Faces with similarity >= this are matches
    HIGH_CONFIDENCE_THRESHOLD = 0.75  # High confidence matches
    
    def __init__(self):
        self._backend = None
        self._backend_name = None
        self._initialized = False
        self._insight_app = None
        self._mp_face_detection = None
        self._mp_face_mesh = None
        
    async def initialize(self):
        """Initialize the best available face recognition backend."""
        if self._initialized:
            return
            
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._init_backend)
        self._initialized = True
        
    def _init_backend(self):
        """Initialize face recognition backend."""
        # Try InsightFace first (best accuracy)
        if INSIGHTFACE_AVAILABLE:
            try:
                self._insight_app = FaceAnalysis(
                    name='buffalo_l',  # Larger model for better accuracy
                    providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
                )
                self._insight_app.prepare(ctx_id=0, det_size=(640, 640))
                self._backend = "insightface"
                self._backend_name = "InsightFace (buffalo_l)"
                logger.info(f"[face_recognizer] Using backend: {self._backend_name}")
                return
            except Exception as e:
                logger.warning(f"[face_recognizer] InsightFace init failed: {e}")
                
        # Try face_recognition (dlib-based)
        if FACE_RECOGNITION_AVAILABLE:
            self._backend = "face_recognition"
            self._backend_name = "face_recognition (dlib)"
            logger.info(f"[face_recognizer] Using backend: {self._backend_name}")
            return
            
        # Try MediaPipe (lightweight)
        if MEDIAPIPE_AVAILABLE:
            try:
                self._mp_face_detection = mp.solutions.face_detection.FaceDetection(
                    model_selection=1,  # Full range model
                    min_detection_confidence=0.5
                )
                self._backend = "mediapipe"
                self._backend_name = "MediaPipe"
                logger.info(f"[face_recognizer] Using backend: {self._backend_name}")
                return
            except Exception as e:
                logger.warning(f"[face_recognizer] MediaPipe init failed: {e}")
                
        # No backend available
        self._backend = None
        self._backend_name = None
        logger.warning("[face_recognizer] No face recognition backend available")
        
    @property
    def is_available(self) -> bool:
        """Check if face recognition is available."""
        return self._backend is not None
        
    @property
    def backend_name(self) -> str:
        """Get the active backend name."""
        return self._backend_name or "None"
        
    async def detect_faces(self, image_bytes: bytes) -> list[FaceDetection]:
        """
        Detect faces in an image.
        
        Args:
            image_bytes: Image data as bytes
            
        Returns:
            List of FaceDetection objects with bounding boxes and embeddings
        """
        await self.initialize()
        
        if not self.is_available or not PIL_AVAILABLE or not NP_AVAILABLE:
            return []
            
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._detect_faces_sync, image_bytes)
        
    def _detect_faces_sync(self, image_bytes: bytes) -> list[FaceDetection]:
        """Synchronous face detection."""
        try:
            # Load image
            img = Image.open(BytesIO(image_bytes)).convert('RGB')
            img_array = np.array(img)
            
            if self._backend == "insightface":
                return self._detect_insightface(img_array)
            elif self._backend == "face_recognition":
                return self._detect_face_recognition(img_array)
            elif self._backend == "mediapipe":
                return self._detect_mediapipe(img_array, img.width, img.height)
            else:
                return []
                
        except Exception as e:
            logger.error(f"[face_recognizer] Detection error: {e}")
            return []
            
    def _detect_insightface(self, img_array: np.ndarray) -> list[FaceDetection]:
        """Detect faces using InsightFace."""
        faces = self._insight_app.get(img_array)
        
        results = []
        for face in faces:
            bbox = face.bbox.astype(int).tolist()
            x, y, x2, y2 = bbox
            
            results.append(FaceDetection(
                bbox=(x, y, x2 - x, y2 - y),
                confidence=float(face.det_score),
                embedding=face.embedding.tolist() if face.embedding is not None else None,
                landmarks=face.landmark.tolist() if hasattr(face, 'landmark') and face.landmark is not None else None
            ))
            
        return results
        
    def _detect_face_recognition(self, img_array: np.ndarray) -> list[FaceDetection]:
        """Detect faces using face_recognition library."""
        # Detect face locations
        face_locations = face_recognition.face_locations(img_array, model='hog')
        
        if not face_locations:
            return []
            
        # Get face encodings
        face_encodings = face_recognition.face_encodings(img_array, face_locations)
        
        results = []
        for (top, right, bottom, left), encoding in zip(face_locations, face_encodings):
            results.append(FaceDetection(
                bbox=(left, top, right - left, bottom - top),
                confidence=1.0,  # face_recognition doesn't provide confidence
                embedding=encoding.tolist()
            ))
            
        return results
        
    def _detect_mediapipe(
        self, img_array: np.ndarray, width: int, height: int
    ) -> list[FaceDetection]:
        """Detect faces using MediaPipe."""
        results = self._mp_face_detection.process(img_array)
        
        if not results.detections:
            return []
            
        detections = []
        for detection in results.detections:
            bbox = detection.location_data.relative_bounding_box
            x = int(bbox.xmin * width)
            y = int(bbox.ymin * height)
            w = int(bbox.width * width)
            h = int(bbox.height * height)
            
            detections.append(FaceDetection(
                bbox=(x, y, w, h),
                confidence=detection.score[0],
                embedding=None  # MediaPipe doesn't provide embeddings directly
            ))
            
        return detections
        
    def compute_similarity(
        self, embedding1: list[float], embedding2: list[float]
    ) -> float:
        """
        Compute cosine similarity between two face embeddings.
        
        Returns:
            Similarity score between 0 and 1 (higher = more similar)
        """
        if not NP_AVAILABLE:
            return 0.0
            
        e1 = np.array(embedding1)
        e2 = np.array(embedding2)
        
        # Normalize
        e1 = e1 / (np.linalg.norm(e1) + 1e-8)
        e2 = e2 / (np.linalg.norm(e2) + 1e-8)
        
        # Cosine similarity (converted to 0-1 range)
        similarity = float(np.dot(e1, e2))
        return (similarity + 1) / 2  # Convert from [-1, 1] to [0, 1]
        
    async def match_faces(
        self,
        detected_faces: list[FaceDetection],
        registered_persons: list[dict],  # [{person_id, name, embeddings: list[list[float]]}]
        threshold: float = None
    ) -> list[FaceMatch]:
        """
        Match detected faces against registered persons.
        
        Args:
            detected_faces: Faces detected in the content
            registered_persons: List of registered persons with embeddings
            threshold: Similarity threshold for matching (default: MATCH_THRESHOLD)
            
        Returns:
            List of FaceMatch objects, one per detected face
        """
        if threshold is None:
            threshold = self.MATCH_THRESHOLD
            
        if not NP_AVAILABLE:
            return []
            
        matches = []
        
        for face in detected_faces:
            if face.embedding is None:
                continue
                
            best_match = None
            best_similarity = 0.0
            
            for person in registered_persons:
                person_embeddings = person.get("embeddings", [])
                
                for registered_embedding in person_embeddings:
                    similarity = self.compute_similarity(face.embedding, registered_embedding)
                    
                    if similarity > best_similarity:
                        best_similarity = similarity
                        best_match = person
                        
            if best_match:
                matches.append(FaceMatch(
                    person_id=best_match["person_id"],
                    person_name=best_match["name"],
                    similarity=best_similarity,
                    bbox=face.bbox,
                    is_match=best_similarity >= threshold
                ))
                
        return matches
        
    async def extract_embedding(self, image_bytes: bytes) -> Optional[list[float]]:
        """
        Extract face embedding from an image (assumes single face).
        
        Useful for registering reference images of protected persons.
        
        Args:
            image_bytes: Image data
            
        Returns:
            Face embedding vector, or None if no face detected
        """
        faces = await self.detect_faces(image_bytes)
        
        if not faces:
            return None
            
        # Return embedding of largest face (by area)
        largest_face = max(faces, key=lambda f: f.bbox[2] * f.bbox[3])
        return largest_face.embedding
        
    async def compare_images(
        self, image1_bytes: bytes, image2_bytes: bytes
    ) -> Optional[float]:
        """
        Compare two images to check if they contain the same person.
        
        Args:
            image1_bytes: First image
            image2_bytes: Second image
            
        Returns:
            Similarity score (0-1), or None if faces couldn't be detected
        """
        emb1 = await self.extract_embedding(image1_bytes)
        emb2 = await self.extract_embedding(image2_bytes)
        
        if emb1 is None or emb2 is None:
            return None
            
        return self.compute_similarity(emb1, emb2)


# Singleton instance
_face_recognizer: Optional[FaceRecognizer] = None


def get_face_recognizer() -> FaceRecognizer:
    """Get the global FaceRecognizer instance."""
    global _face_recognizer
    if _face_recognizer is None:
        _face_recognizer = FaceRecognizer()
    return _face_recognizer

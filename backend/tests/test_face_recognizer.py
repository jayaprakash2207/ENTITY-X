"""
Tests for backend.track.face_recognizer – FaceRecognizer.

Tests face detection and similarity computation.
"""
import pytest
from backend.track.face_recognizer import (
    FaceRecognizer,
    FaceDetection,
    FaceMatch,
    get_face_recognizer,
)


class TestFaceRecognizer:
    """Test suite for FaceRecognizer."""
    
    @pytest.fixture
    def recognizer(self):
        """Create a FaceRecognizer instance."""
        return FaceRecognizer()
    
    @pytest.mark.asyncio
    async def test_initialize(self, recognizer):
        """Test that recognizer initializes without error."""
        await recognizer.initialize()
        # Should complete without raising
    
    @pytest.mark.asyncio
    async def test_backend_status(self, recognizer):
        """Test checking backend availability."""
        await recognizer.initialize()
        
        # Should have a backend name (even if unavailable)
        assert recognizer.backend_name is not None
        
        # is_available depends on installed packages
        assert isinstance(recognizer.is_available, bool)
    
    def test_compute_similarity_identical(self, recognizer):
        """Test cosine similarity with identical embeddings."""
        emb = [1.0, 0.0, 0.0]
        similarity = recognizer.compute_similarity(emb, emb)
        
        # Identical vectors should have similarity of 1.0
        assert abs(similarity - 1.0) < 0.001
    
    def test_compute_similarity_opposite(self, recognizer):
        """Test cosine similarity with opposite embeddings."""
        emb1 = [1.0, 0.0, 0.0]
        emb2 = [-1.0, 0.0, 0.0]
        
        similarity = recognizer.compute_similarity(emb1, emb2)
        
        # Opposite vectors should have similarity near 0 (after normalization)
        assert similarity < 0.1
    
    def test_compute_similarity_orthogonal(self, recognizer):
        """Test cosine similarity with orthogonal embeddings."""
        emb1 = [1.0, 0.0, 0.0]
        emb2 = [0.0, 1.0, 0.0]
        
        similarity = recognizer.compute_similarity(emb1, emb2)
        
        # Orthogonal vectors should have similarity of 0.5 (normalized from 0)
        assert abs(similarity - 0.5) < 0.001
    
    def test_compute_similarity_similar_vectors(self, recognizer):
        """Test cosine similarity with similar embeddings."""
        emb1 = [0.9, 0.1, 0.0]
        emb2 = [0.85, 0.15, 0.05]
        
        similarity = recognizer.compute_similarity(emb1, emb2)
        
        # Similar vectors should have high similarity
        assert similarity > 0.9
    
    @pytest.mark.asyncio
    async def test_match_faces_threshold(self, recognizer):
        """Test face matching with threshold."""
        # Create mock detected face
        detected_faces = [
            FaceDetection(
                bbox=(100, 100, 50, 50),
                confidence=0.99,
                embedding=[0.9, 0.1, 0.0, 0.0, 0.0],
            )
        ]
        
        # Create mock registered person with similar embedding
        registered = [
            {
                "person_id": "person-1",
                "name": "Test Person",
                "embeddings": [[0.85, 0.15, 0.0, 0.0, 0.0]],
            }
        ]
        
        # High threshold - no match
        matches = await recognizer.match_faces(detected_faces, registered, threshold=0.99)
        assert len(matches) == 1
        assert matches[0].is_match is False
        
        # Lower threshold - should match
        matches = await recognizer.match_faces(detected_faces, registered, threshold=0.5)
        assert len(matches) == 1
        assert matches[0].is_match is True
        assert matches[0].person_name == "Test Person"
    
    @pytest.mark.asyncio
    async def test_match_faces_best_match(self, recognizer):
        """Test that matching returns the best match among registered persons."""
        detected_faces = [
            FaceDetection(
                bbox=(100, 100, 50, 50),
                confidence=0.99,
                embedding=[1.0, 0.0, 0.0],
            )
        ]
        
        registered = [
            {
                "person_id": "person-1",
                "name": "Far Match",
                "embeddings": [[0.5, 0.5, 0.0]],  # Less similar
            },
            {
                "person_id": "person-2",
                "name": "Close Match",
                "embeddings": [[0.95, 0.05, 0.0]],  # More similar
            },
        ]
        
        matches = await recognizer.match_faces(detected_faces, registered, threshold=0.5)
        
        assert len(matches) == 1
        # Should match the closer person
        assert matches[0].person_name == "Close Match"
    
    @pytest.mark.asyncio
    async def test_match_faces_no_embedding(self, recognizer):
        """Test matching with faces that have no embedding."""
        detected_faces = [
            FaceDetection(
                bbox=(100, 100, 50, 50),
                confidence=0.99,
                embedding=None,  # No embedding
            )
        ]
        
        registered = [
            {
                "person_id": "person-1",
                "name": "Test Person",
                "embeddings": [[1.0, 0.0, 0.0]],
            }
        ]
        
        matches = await recognizer.match_faces(detected_faces, registered, threshold=0.5)
        
        # No matches because no embedding
        assert len(matches) == 0


class TestFaceDetection:
    """Test FaceDetection dataclass."""
    
    def test_create_detection(self):
        """Test creating a FaceDetection instance."""
        detection = FaceDetection(
            bbox=(10, 20, 100, 150),
            confidence=0.95,
            embedding=[1.0, 2.0, 3.0],
        )
        
        assert detection.bbox == (10, 20, 100, 150)
        assert detection.confidence == 0.95
        assert detection.embedding == [1.0, 2.0, 3.0]
    
    def test_detection_without_embedding(self):
        """Test FaceDetection without embedding."""
        detection = FaceDetection(
            bbox=(0, 0, 50, 50),
            confidence=0.8,
        )
        
        assert detection.embedding is None
        assert detection.landmarks is None


class TestFaceMatch:
    """Test FaceMatch dataclass."""
    
    def test_create_match(self):
        """Test creating a FaceMatch instance."""
        match = FaceMatch(
            person_id="person-123",
            person_name="John Doe",
            similarity=0.85,
            bbox=(100, 100, 50, 50),
            is_match=True,
        )
        
        assert match.person_id == "person-123"
        assert match.person_name == "John Doe"
        assert match.similarity == 0.85
        assert match.is_match is True


class TestSingleton:
    """Test singleton behavior."""
    
    def test_get_face_recognizer_returns_same_instance(self):
        """Test that get_face_recognizer returns singleton."""
        instance1 = get_face_recognizer()
        instance2 = get_face_recognizer()
        
        assert instance1 is instance2



"""
Tests for backend.main – FastAPI API endpoints.

Integration tests for the API routes.
"""
import pytest
from fastapi.testclient import TestClient

# Import the FastAPI app
from backend.main import app


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app)


class TestHealthEndpoint:
    """Test the health check endpoint."""
    
    def test_health_returns_ok(self, client):
        """Test that /api/health returns ok status."""
        response = client.get("/api/health")
        
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestTextMonitorEndpoint:
    """Test the text monitor endpoint."""
    
    def test_text_monitor_valid_request(self, client):
        """Test text monitoring with valid input."""
        response = client.post(
            "/api/text-monitor",
            json={
                "title": "Test Article",
                "url": "https://example.com/article",
                "text": "This is a test article with enough content. " * 10,
                "word_count": 100,
                "timestamp": 1700000000000,
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "ai_generated_probability" in data
        assert "risk_level" in data  # AI-based risk level
        assert data["risk_level"] in ["LOW", "MEDIUM", "HIGH"]
        assert "misinformation_risk" in data
        assert "credibility_score" in data
        assert "explanation" in data
        assert "trust_score" in data
    
    def test_text_monitor_short_text_rejected(self, client):
        """Test that short text is rejected."""
        response = client.post(
            "/api/text-monitor",
            json={
                "title": "Short",
                "url": "https://example.com",
                "text": "Too short",
                "word_count": 2,
                "timestamp": 1700000000000,
            }
        )
        
        assert response.status_code == 422


class TestPersonsEndpoint:
    """Test the persons management endpoints."""
    
    def test_register_person(self, client):
        """Test registering a protected person."""
        response = client.post(
            "/api/persons/register",
            json={
                "name": "Test Celebrity",
                "description": "A test protected person",
                "category": "celebrity",
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["name"] == "Test Celebrity"
        assert data["category"] == "celebrity"
        assert "person_id" in data
    
    def test_list_persons(self, client):
        """Test listing protected persons."""
        # Register a person first
        client.post(
            "/api/persons/register",
            json={"name": "List Test Person", "category": "client"}
        )
        
        response = client.get("/api/persons")
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
    
    def test_get_person_not_found(self, client):
        """Test getting a person that doesn't exist."""
        response = client.get("/api/persons/nonexistent-id-12345")
        
        assert response.status_code == 404


class TestFaceRecognizerStatus:
    """Test the face recognizer status endpoint."""
    
    def test_face_recognizer_status(self, client):
        """Test checking face recognizer status."""
        response = client.get("/api/face-recognizer/status")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "available" in data
        assert "backend" in data
        assert isinstance(data["available"], bool)


class TestAlertsEndpoint:
    """Test the alerts endpoints."""
    
    def test_list_alerts(self, client):
        """Test listing impersonation alerts."""
        response = client.get("/api/alerts")
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
    
    def test_alert_stats(self, client):
        """Test getting alert statistics."""
        response = client.get("/api/alerts/stats")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "total_alerts" in data
        assert "pending_alerts" in data
        assert "confirmed_alerts" in data
        assert "dismissed_alerts" in data

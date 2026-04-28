"""
Tests for backend.track.person_registry – PersonRegistry.

Tests protected person management and impersonation alerts.
"""
import pytest
from backend.track.person_registry import PersonRegistry, ProtectedPerson, ImpersonationAlert


class TestPersonRegistry:
    """Test suite for PersonRegistry."""
    
    @pytest.fixture
    async def registry(self, temp_db_path):
        """Create a fresh registry with temp database."""
        reg = PersonRegistry(db_path=temp_db_path)
        await reg.initialize()
        yield reg
    
    @pytest.mark.asyncio
    async def test_register_person(self, registry):
        """Test registering a new protected person."""
        person = await registry.register_person(
            name="John Doe",
            description="Test celebrity",
            category="celebrity",
        )
        
        assert person is not None
        assert person.name == "John Doe"
        assert person.description == "Test celebrity"
        assert person.category == "celebrity"
        assert person.is_active is True
        assert person.person_id is not None
    
    @pytest.mark.asyncio
    async def test_get_person(self, registry):
        """Test retrieving a registered person."""
        created = await registry.register_person(name="Jane Smith", category="client")
        
        retrieved = await registry.get_person(created.person_id)
        
        assert retrieved is not None
        assert retrieved.person_id == created.person_id
        assert retrieved.name == "Jane Smith"
    
    @pytest.mark.asyncio
    async def test_get_nonexistent_person(self, registry):
        """Test retrieving a person that doesn't exist."""
        result = await registry.get_person("nonexistent-id-12345")
        assert result is None
    
    @pytest.mark.asyncio
    async def test_list_persons(self, registry):
        """Test listing all protected persons."""
        await registry.register_person(name="Person A", category="celebrity")
        await registry.register_person(name="Person B", category="client")
        await registry.register_person(name="Person C", category="celebrity")
        
        all_persons = await registry.list_persons()
        assert len(all_persons) == 3
        
        # Filter by category
        celebrities = await registry.list_persons(category="celebrity")
        assert len(celebrities) == 2
        
        clients = await registry.list_persons(category="client")
        assert len(clients) == 1
    
    @pytest.mark.asyncio
    async def test_update_person(self, registry):
        """Test updating a protected person."""
        person = await registry.register_person(name="Original Name")
        
        updated = await registry.update_person(
            person.person_id,
            name="Updated Name",
            description="New description"
        )
        
        assert updated is not None
        assert updated.name == "Updated Name"
        assert updated.description == "New description"
    
    @pytest.mark.asyncio
    async def test_update_nonexistent_person(self, registry):
        """Test updating a person that doesn't exist."""
        result = await registry.update_person("nonexistent", name="Test")
        assert result is None
    
    @pytest.mark.asyncio
    async def test_delete_person(self, registry):
        """Test deleting a protected person."""
        person = await registry.register_person(name="To Delete")
        
        success = await registry.delete_person(person.person_id)
        assert success is True
        
        # Verify deleted
        retrieved = await registry.get_person(person.person_id)
        assert retrieved is None
    
    @pytest.mark.asyncio
    async def test_delete_nonexistent_person(self, registry):
        """Test deleting a person that doesn't exist."""
        success = await registry.delete_person("nonexistent")
        assert success is False
    
    @pytest.mark.asyncio
    async def test_add_embedding(self, registry):
        """Test adding a face embedding to a person."""
        person = await registry.register_person(name="With Embedding")
        
        # Add fake embedding
        embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
        await registry.add_embedding(person.person_id, embedding)
        
        # Verify embedding was added
        updated = await registry.get_person(person.person_id)
        assert len(updated.embeddings) == 1
        assert updated.embeddings[0] == embedding
    
    @pytest.mark.asyncio
    async def test_multiple_embeddings(self, registry):
        """Test adding multiple embeddings to a person."""
        person = await registry.register_person(name="Multiple Embeddings")
        
        await registry.add_embedding(person.person_id, [1.0, 2.0, 3.0])
        await registry.add_embedding(person.person_id, [4.0, 5.0, 6.0])
        await registry.add_embedding(person.person_id, [7.0, 8.0, 9.0])
        
        updated = await registry.get_person(person.person_id)
        assert len(updated.embeddings) == 3
    
    @pytest.mark.asyncio
    async def test_inactive_person_filtering(self, registry):
        """Test that inactive persons are filtered by default."""
        person = await registry.register_person(name="To Deactivate")
        await registry.update_person(person.person_id, is_active=False)
        
        # Active only (default)
        active = await registry.list_persons(active_only=True)
        assert len(active) == 0
        
        # Include inactive
        all_persons = await registry.list_persons(active_only=False)
        assert len(all_persons) == 1


class TestImpersonationAlerts:
    """Test suite for impersonation alert management."""
    
    @pytest.fixture
    async def registry_with_person(self, temp_db_path):
        """Create a registry with a test person."""
        reg = PersonRegistry(db_path=temp_db_path)
        await reg.initialize()
        person = await reg.register_person(name="Test Person")
        yield reg, person
    
    @pytest.mark.asyncio
    async def test_create_alert(self, registry_with_person):
        """Test creating an impersonation alert."""
        registry, person = registry_with_person
        
        alert = await registry.create_alert(
            person_id=person.person_id,
            content_type="IMAGE",
            content_url="https://example.com/fake-image.jpg",
            similarity_score=0.85,
        )
        
        assert alert is not None
        assert alert.person_id == person.person_id
        assert alert.content_type == "IMAGE"
        assert alert.similarity_score == 0.85
        assert alert.status == "pending"
    
    @pytest.mark.asyncio
    async def test_get_alerts(self, registry_with_person):
        """Test retrieving alerts."""
        registry, person = registry_with_person
        
        await registry.create_alert(
            person_id=person.person_id,
            content_type="VIDEO",
            content_url="https://example.com/video1.mp4",
            similarity_score=0.75,
        )
        await registry.create_alert(
            person_id=person.person_id,
            content_type="IMAGE",
            content_url="https://example.com/image1.jpg",
            similarity_score=0.90,
        )
        
        alerts = await registry.get_alerts(person_id=person.person_id)
        assert len(alerts) == 2
    
    @pytest.mark.asyncio
    async def test_update_alert_status(self, registry_with_person):
        """Test updating alert status."""
        registry, person = registry_with_person
        
        alert = await registry.create_alert(
            person_id=person.person_id,
            content_type="IMAGE",
            content_url="https://example.com/image.jpg",
            similarity_score=0.80,
        )
        
        success = await registry.update_alert_status(alert.alert_id, "confirmed")
        assert success is True
        
        # Verify status changed
        alerts = await registry.get_alerts(status="confirmed")
        assert len(alerts) == 1
        assert alerts[0].status == "confirmed"
    
    @pytest.mark.asyncio
    async def test_alert_stats(self, registry_with_person):
        """Test getting alert statistics."""
        registry, person = registry_with_person
        
        # Create multiple alerts with different statuses
        alert1 = await registry.create_alert(
            person_id=person.person_id,
            content_type="IMAGE",
            content_url="https://example.com/1.jpg",
            similarity_score=0.80,
        )
        alert2 = await registry.create_alert(
            person_id=person.person_id,
            content_type="VIDEO",
            content_url="https://example.com/2.mp4",
            similarity_score=0.75,
        )
        alert3 = await registry.create_alert(
            person_id=person.person_id,
            content_type="IMAGE",
            content_url="https://example.com/3.jpg",
            similarity_score=0.90,
        )
        
        await registry.update_alert_status(alert1.alert_id, "confirmed")
        await registry.update_alert_status(alert2.alert_id, "dismissed")
        
        stats = await registry.get_alert_stats()
        
        assert stats["total_alerts"] == 3
        assert stats["pending_alerts"] == 1
        assert stats["confirmed_alerts"] == 1
        assert stats["dismissed_alerts"] == 1


class TestProtectedPersonDataclass:
    """Test the ProtectedPerson dataclass."""
    
    def test_create_protected_person(self):
        """Test creating a ProtectedPerson instance."""
        person = ProtectedPerson(
            person_id="test-123",
            name="Test Person",
            description="A test",
            category="celebrity",
            embeddings=[[1.0, 2.0, 3.0]],
            metadata={"key": "value"},
            is_active=True,
            created_at="2024-01-01T00:00:00",
            updated_at="2024-01-01T00:00:00",
        )
        
        assert person.person_id == "test-123"
        assert person.name == "Test Person"
        assert len(person.embeddings) == 1
    
    def test_default_values(self):
        """Test default values for optional fields."""
        person = ProtectedPerson(
            person_id="test",
            name="Test",
        )
        
        assert person.description == ""
        assert person.category == "other"
        assert person.embeddings == []
        assert person.metadata == {}
        assert person.is_active is True

"""
backend.track.person_registry – Protected person management for impersonation detection.

Manages a registry of protected persons (celebrities, clients, etc.) whose
likeness should be monitored for potential deepfake impersonation.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, Literal

logger = logging.getLogger(__name__)

# Database location
DB_DIR = Path(__file__).parent.parent.parent / "data"
DB_PATH = DB_DIR / "entity_registry.db"


@dataclass
class ProtectedPerson:
    """A protected person registered for impersonation monitoring."""
    person_id: str
    name: str
    category: str  # "celebrity", "client", "self", "other"
    notes: str = ""
    reference_images: list[str] = field(default_factory=list)  # Paths to reference images
    face_embeddings: list[list[float]] = field(default_factory=list)  # Face embedding vectors
    alert_level: str = "HIGH"  # Alert level when detected
    created_at: str = ""
    updated_at: str = ""
    is_active: bool = True


@dataclass
class ImpersonationAlert:
    """An alert when a protected person is detected in potentially fake content."""
    alert_id: str
    person_id: str
    person_name: str
    detection_id: str  # ID of the content detection
    content_url: str
    content_type: str
    fake_probability: float
    face_similarity: float
    risk_level: str
    timestamp: str
    status: str = "unreviewed"  # unreviewed, acknowledged, false_positive, confirmed


class PersonRegistry:
    """
    Registry for protected persons and impersonation detection.
    
    Features:
    - Register persons with reference images
    - Store face embeddings for fast matching
    - Track impersonation alerts
    - Query person detection history
    """
    
    def __init__(self):
        self._db_path = DB_PATH
        self._lock = asyncio.Lock()
        self._initialized = False
        
    async def initialize(self):
        """Initialize the database schema."""
        if self._initialized:
            return
            
        DB_DIR.mkdir(parents=True, exist_ok=True)
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._create_schema)
        self._initialized = True
        
    def _create_schema(self):
        """Create database tables."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        # Protected persons table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS protected_persons (
                person_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT DEFAULT 'other',
                notes TEXT DEFAULT '',
                reference_images_json TEXT DEFAULT '[]',
                face_embeddings_json TEXT DEFAULT '[]',
                alert_level TEXT DEFAULT 'HIGH',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_active INTEGER DEFAULT 1
            )
        """)
        
        # Impersonation alerts table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS impersonation_alerts (
                alert_id TEXT PRIMARY KEY,
                person_id TEXT NOT NULL,
                person_name TEXT NOT NULL,
                detection_id TEXT,
                content_url TEXT,
                content_type TEXT,
                fake_probability REAL,
                face_similarity REAL,
                risk_level TEXT,
                timestamp TEXT NOT NULL,
                status TEXT DEFAULT 'unreviewed',
                notes TEXT DEFAULT '',
                FOREIGN KEY (person_id) REFERENCES protected_persons(person_id)
            )
        """)
        
        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_person ON impersonation_alerts(person_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_status ON impersonation_alerts(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON impersonation_alerts(timestamp)")
        
        conn.commit()
        conn.close()
        logger.info(f"[person_registry] Database initialized at {self._db_path}")
        
    def _generate_person_id(self, name: str) -> str:
        """Generate a unique person ID."""
        timestamp = datetime.utcnow().isoformat()
        data = f"{name}:{timestamp}"
        return hashlib.sha256(data.encode()).hexdigest()[:16]
        
    def _generate_alert_id(self, person_id: str, content_url: str) -> str:
        """Generate a unique alert ID."""
        timestamp = datetime.utcnow().isoformat()
        data = f"{person_id}:{content_url}:{timestamp}"
        return hashlib.sha256(data.encode()).hexdigest()[:16]
        
    async def register_person(
        self,
        name: str,
        category: str = "other",
        notes: str = "",
        reference_images: list[str] = None,
        face_embeddings: list[list[float]] = None,
        alert_level: str = "HIGH"
    ) -> ProtectedPerson:
        """
        Register a new protected person.
        
        Args:
            name: Person's name (e.g., "John Doe", "Celebrity Name")
            category: "celebrity", "client", "self", or "other"
            notes: Additional notes about the person
            reference_images: List of paths to reference images
            face_embeddings: Pre-computed face embeddings (if available)
            alert_level: "HIGH", "MEDIUM", or "LOW"
            
        Returns:
            The registered ProtectedPerson object
        """
        await self.initialize()
        
        person_id = self._generate_person_id(name)
        now = datetime.utcnow().isoformat()
        
        person = ProtectedPerson(
            person_id=person_id,
            name=name,
            category=category,
            notes=notes,
            reference_images=reference_images or [],
            face_embeddings=face_embeddings or [],
            alert_level=alert_level,
            created_at=now,
            updated_at=now,
            is_active=True
        )
        
        async with self._lock:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._insert_person, person)
            
        logger.info(f"[person_registry] Registered person: {name} ({person_id})")
        return person
        
    def _insert_person(self, person: ProtectedPerson):
        """Insert person into database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO protected_persons 
            (person_id, name, category, notes, reference_images_json, 
             face_embeddings_json, alert_level, created_at, updated_at, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            person.person_id,
            person.name,
            person.category,
            person.notes,
            json.dumps(person.reference_images),
            json.dumps(person.face_embeddings),
            person.alert_level,
            person.created_at,
            person.updated_at,
            1 if person.is_active else 0
        ))
        
        conn.commit()
        conn.close()
        
    async def update_person(
        self,
        person_id: str,
        name: str = None,
        category: str = None,
        notes: str = None,
        reference_images: list[str] = None,
        face_embeddings: list[list[float]] = None,
        alert_level: str = None,
        is_active: bool = None
    ) -> Optional[ProtectedPerson]:
        """Update an existing protected person."""
        await self.initialize()
        
        # Get existing person
        person = await self.get_person(person_id)
        if not person:
            return None
            
        # Update fields
        if name is not None:
            person.name = name
        if category is not None:
            person.category = category
        if notes is not None:
            person.notes = notes
        if reference_images is not None:
            person.reference_images = reference_images
        if face_embeddings is not None:
            person.face_embeddings = face_embeddings
        if alert_level is not None:
            person.alert_level = alert_level
        if is_active is not None:
            person.is_active = is_active
            
        person.updated_at = datetime.utcnow().isoformat()
        
        async with self._lock:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._update_person, person)
            
        return person
        
    def _update_person(self, person: ProtectedPerson):
        """Update person in database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE protected_persons SET
                name = ?, category = ?, notes = ?,
                reference_images_json = ?, face_embeddings_json = ?,
                alert_level = ?, updated_at = ?, is_active = ?
            WHERE person_id = ?
        """, (
            person.name,
            person.category,
            person.notes,
            json.dumps(person.reference_images),
            json.dumps(person.face_embeddings),
            person.alert_level,
            person.updated_at,
            1 if person.is_active else 0,
            person.person_id
        ))
        
        conn.commit()
        conn.close()
        
    async def get_person(self, person_id: str) -> Optional[ProtectedPerson]:
        """Get a protected person by ID."""
        await self.initialize()
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_person, person_id)
        
    def _get_person(self, person_id: str) -> Optional[ProtectedPerson]:
        """Get person from database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT person_id, name, category, notes, reference_images_json,
                   face_embeddings_json, alert_level, created_at, updated_at, is_active
            FROM protected_persons WHERE person_id = ?
        """, (person_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
            
        return ProtectedPerson(
            person_id=row[0],
            name=row[1],
            category=row[2],
            notes=row[3],
            reference_images=json.loads(row[4]),
            face_embeddings=json.loads(row[5]),
            alert_level=row[6],
            created_at=row[7],
            updated_at=row[8],
            is_active=bool(row[9])
        )
        
    async def list_persons(
        self,
        category: str = None,
        active_only: bool = True,
        limit: int = 100
    ) -> list[ProtectedPerson]:
        """List all protected persons."""
        await self.initialize()
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._list_persons, category, active_only, limit
        )
        
    def _list_persons(
        self, category: str, active_only: bool, limit: int
    ) -> list[ProtectedPerson]:
        """List persons from database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        query = """
            SELECT person_id, name, category, notes, reference_images_json,
                   face_embeddings_json, alert_level, created_at, updated_at, is_active
            FROM protected_persons WHERE 1=1
        """
        params = []
        
        if active_only:
            query += " AND is_active = 1"
        if category:
            query += " AND category = ?"
            params.append(category)
            
        query += " ORDER BY name LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        
        return [
            ProtectedPerson(
                person_id=row[0],
                name=row[1],
                category=row[2],
                notes=row[3],
                reference_images=json.loads(row[4]),
                face_embeddings=json.loads(row[5]),
                alert_level=row[6],
                created_at=row[7],
                updated_at=row[8],
                is_active=bool(row[9])
            )
            for row in rows
        ]
        
    async def delete_person(self, person_id: str) -> bool:
        """Delete (soft) a protected person."""
        await self.initialize()
        
        async with self._lock:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self._delete_person, person_id)
            
    def _delete_person(self, person_id: str) -> bool:
        """Soft delete person in database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE protected_persons SET is_active = 0, updated_at = ?
            WHERE person_id = ?
        """, (datetime.utcnow().isoformat(), person_id))
        
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        
        return affected > 0
        
    async def add_embeddings(
        self, person_id: str, new_embeddings: list[list[float]]
    ) -> bool:
        """Add face embeddings to an existing person."""
        person = await self.get_person(person_id)
        if not person:
            return False
            
        # Append new embeddings
        person.face_embeddings.extend(new_embeddings)
        
        await self.update_person(
            person_id, 
            face_embeddings=person.face_embeddings
        )
        return True
        
    # ─── Alert Management ────────────────────────────────────────────────────
    
    async def create_alert(
        self,
        person_id: str,
        person_name: str,
        detection_id: str,
        content_url: str,
        content_type: str,
        fake_probability: float,
        face_similarity: float,
        risk_level: str
    ) -> ImpersonationAlert:
        """Create a new impersonation alert."""
        await self.initialize()
        
        alert_id = self._generate_alert_id(person_id, content_url)
        now = datetime.utcnow().isoformat()
        
        alert = ImpersonationAlert(
            alert_id=alert_id,
            person_id=person_id,
            person_name=person_name,
            detection_id=detection_id,
            content_url=content_url,
            content_type=content_type,
            fake_probability=fake_probability,
            face_similarity=face_similarity,
            risk_level=risk_level,
            timestamp=now,
            status="unreviewed"
        )
        
        async with self._lock:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._insert_alert, alert)
            
        logger.warning(f"[person_registry] ALERT: {person_name} detected in potential deepfake (similarity: {face_similarity:.1%})")
        return alert
        
    def _insert_alert(self, alert: ImpersonationAlert):
        """Insert alert into database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO impersonation_alerts 
            (alert_id, person_id, person_name, detection_id, content_url,
             content_type, fake_probability, face_similarity, risk_level, timestamp, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            alert.alert_id,
            alert.person_id,
            alert.person_name,
            alert.detection_id,
            alert.content_url,
            alert.content_type,
            alert.fake_probability,
            alert.face_similarity,
            alert.risk_level,
            alert.timestamp,
            alert.status
        ))
        
        conn.commit()
        conn.close()
        
    async def get_alerts(
        self,
        person_id: str = None,
        status: str = None,
        limit: int = 100
    ) -> list[ImpersonationAlert]:
        """Get impersonation alerts with optional filters."""
        await self.initialize()
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._get_alerts, person_id, status, limit
        )
        
    def _get_alerts(
        self, person_id: str, status: str, limit: int
    ) -> list[ImpersonationAlert]:
        """Get alerts from database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        query = """
            SELECT alert_id, person_id, person_name, detection_id, content_url,
                   content_type, fake_probability, face_similarity, risk_level, 
                   timestamp, status
            FROM impersonation_alerts WHERE 1=1
        """
        params = []
        
        if person_id:
            query += " AND person_id = ?"
            params.append(person_id)
        if status:
            query += " AND status = ?"
            params.append(status)
            
        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        
        return [
            ImpersonationAlert(
                alert_id=row[0],
                person_id=row[1],
                person_name=row[2],
                detection_id=row[3],
                content_url=row[4],
                content_type=row[5],
                fake_probability=row[6],
                face_similarity=row[7],
                risk_level=row[8],
                timestamp=row[9],
                status=row[10]
            )
            for row in rows
        ]
        
    async def update_alert_status(
        self, alert_id: str, status: str, notes: str = ""
    ) -> bool:
        """Update an alert's status."""
        await self.initialize()
        
        async with self._lock:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None, self._update_alert_status, alert_id, status, notes
            )
            
    def _update_alert_status(self, alert_id: str, status: str, notes: str) -> bool:
        """Update alert status in database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE impersonation_alerts SET status = ?, notes = ?
            WHERE alert_id = ?
        """, (status, notes, alert_id))
        
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        
        return affected > 0
        
    async def get_alert_stats(self) -> dict:
        """Get summary statistics for alerts."""
        await self.initialize()
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_alert_stats)
        
    def _get_alert_stats(self) -> dict:
        """Get alert statistics from database."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM impersonation_alerts")
        total = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM impersonation_alerts WHERE status = 'unreviewed'")
        pending = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM impersonation_alerts WHERE status = 'confirmed'")
        confirmed = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM impersonation_alerts WHERE status = 'dismissed'")
        dismissed = cursor.fetchone()[0]
        
        # Get alerts by person
        cursor.execute("""
            SELECT person_name, COUNT(*) as count 
            FROM impersonation_alerts 
            GROUP BY person_name
        """)
        alerts_by_person = {row[0]: row[1] for row in cursor.fetchall()}
        
        conn.close()
        
        return {
            "total_alerts": total,
            "pending_alerts": pending,
            "confirmed_alerts": confirmed,
            "dismissed_alerts": dismissed,
            "alerts_by_person": alerts_by_person
        }

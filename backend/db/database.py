"""
backend.db – SQLite-backed detection history store.

Persists to data.db in the project root so history survives restarts.
Provides the same record_history / query_history API as before.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DB path — same directory as the project root (parent of backend/)
# ---------------------------------------------------------------------------

_DB_PATH = Path(__file__).parent.parent.parent / "data" / "data.db"

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA_DETECTIONS = """
CREATE TABLE IF NOT EXISTS detections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id        TEXT,
    type             TEXT,
    source_url       TEXT,
    title            TEXT,
    risk_level       TEXT,
    fake_probability REAL,
    trust_score_after REAL,
    timestamp        INTEGER,
    extra_json       TEXT
);
"""

_SCHEMA_TRUST = """
CREATE TABLE IF NOT EXISTS trust_scores (
    session_id  TEXT PRIMARY KEY,
    score       REAL NOT NULL DEFAULT 100.0,
    updated_at  INTEGER NOT NULL
);
"""

_SCHEMA_IDX = """
CREATE INDEX IF NOT EXISTS idx_det_type      ON detections (type);
CREATE INDEX IF NOT EXISTS idx_det_risk      ON detections (risk_level);
CREATE INDEX IF NOT EXISTS idx_det_timestamp ON detections (timestamp DESC);
"""

_SCHEMA_CASES = """
CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open',
    workspace_id TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    signature TEXT,
    metadata_json TEXT
);
"""

_SCHEMA_CASE_EVIDENCE = """
CREATE TABLE IF NOT EXISTS case_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    entity_id TEXT,
    detection_type TEXT,
    source_url TEXT,
    risk_level TEXT,
    fake_probability REAL,
    added_at INTEGER,
    note TEXT,
    content_hash TEXT
);
"""

_SCHEMA_COMMUNITY_HASHES = """
CREATE TABLE IF NOT EXISTS community_hashes (
    hash TEXT PRIMARY KEY,
    content_type TEXT,
    risk_level TEXT DEFAULT 'HIGH',
    confirmed_count INTEGER DEFAULT 1,
    first_seen INTEGER,
    last_seen INTEGER,
    source_domains TEXT
);
"""

_SCHEMA_FEEDBACK = """
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT,
    content_hash TEXT,
    user_label TEXT,
    original_risk TEXT,
    original_probability REAL,
    timestamp INTEGER
);
"""

_SCHEMA_CREATOR_PROFILES = """
CREATE TABLE IF NOT EXISTS creator_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content_type TEXT,
    description TEXT,
    created_at INTEGER,
    metadata_json TEXT
);
"""

_SCHEMA_SOCIAL_MONITORS = """
CREATE TABLE IF NOT EXISTS social_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    rss_url TEXT,
    last_checked INTEGER,
    active INTEGER DEFAULT 1,
    added_at INTEGER
);
"""

_SCHEMA_WORKSPACES = """
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at INTEGER,
    updated_at INTEGER
);
"""

_SCHEMA_PROVENANCE_CHAIN = """
CREATE TABLE IF NOT EXISTS provenance_chain (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash TEXT NOT NULL,
    source_url  TEXT,
    domain      TEXT,
    provenance_standard TEXT,
    first_seen  INTEGER,
    last_seen   INTEGER,
    seen_count  INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_prov_hash ON provenance_chain (content_hash);
"""

_SCHEMA_WATCHLIST = """
CREATE TABLE IF NOT EXISTS watchlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    keyword     TEXT,
    url         TEXT,
    watch_type  TEXT DEFAULT 'keyword',
    threshold   REAL DEFAULT 0.6,
    active      INTEGER DEFAULT 1,
    last_scanned INTEGER,
    created_at  INTEGER
);
CREATE TABLE IF NOT EXISTS watchlist_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_id INTEGER NOT NULL,
    source_url  TEXT,
    title       TEXT,
    risk_level  TEXT,
    fake_probability REAL,
    detected_at INTEGER,
    read        INTEGER DEFAULT 0
);
"""

_SCHEMA_CONFIDENCE_TIMELINE = """
CREATE TABLE IF NOT EXISTS confidence_timeline (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id   TEXT,
    content_hash TEXT,
    score       REAL NOT NULL,
    score_type  TEXT DEFAULT 'trust',
    source      TEXT,
    recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ct_entity ON confidence_timeline (entity_id);
CREATE INDEX IF NOT EXISTS idx_ct_hash   ON confidence_timeline (content_hash);
"""

MAX_HISTORY = 10_000

# ---------------------------------------------------------------------------
# Sync DB helpers (run in threadpool via asyncio.to_thread)
# ---------------------------------------------------------------------------

# Threading lock to serialise all SQLite writes across threadpool workers.
# SQLite WAL mode is safe for concurrent reads but not concurrent writes.
_db_write_lock = threading.Lock()


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Schema migrations — safe ALTER TABLE additions for existing databases.
# Each entry: (version, sql). Applied once, in order, and recorded in
# the schema_version table so they never run twice.
# ---------------------------------------------------------------------------

_MIGRATIONS: list[tuple[int, str]] = [
    (1, "ALTER TABLE detections ADD COLUMN content_hash TEXT"),
    (2, "ALTER TABLE cases ADD COLUMN priority TEXT DEFAULT 'normal'"),
    (3, "ALTER TABLE watchlist ADD COLUMN last_alert_count INTEGER DEFAULT 0"),
]


def _run_migrations(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version  INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )
    """)
    applied = {row[0] for row in conn.execute("SELECT version FROM schema_version").fetchall()}
    for version, sql in _MIGRATIONS:
        if version in applied:
            continue
        try:
            conn.execute(sql)
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (version, int(time.time() * 1000)),
            )
            logger.info(f"[db] Applied migration v{version}")
        except sqlite3.OperationalError as exc:
            if "duplicate column" in str(exc).lower():
                # Column already exists — record as applied and move on
                conn.execute(
                    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)",
                    (version, int(time.time() * 1000)),
                )
            else:
                logger.warning(f"[db] Migration v{version} skipped: {exc}")


def _init_db() -> None:
    """Create tables, indexes, and run pending migrations."""
    try:
        conn = _get_connection()
        with conn:
            conn.executescript(
                _SCHEMA_DETECTIONS + _SCHEMA_TRUST + _SCHEMA_IDX +
                _SCHEMA_CASES + _SCHEMA_CASE_EVIDENCE + _SCHEMA_COMMUNITY_HASHES +
                _SCHEMA_FEEDBACK + _SCHEMA_CREATOR_PROFILES + _SCHEMA_SOCIAL_MONITORS +
                _SCHEMA_WORKSPACES + _SCHEMA_PROVENANCE_CHAIN + _SCHEMA_WATCHLIST +
                _SCHEMA_CONFIDENCE_TIMELINE
            )
            _run_migrations(conn)
        conn.close()
        logger.info(f"[db] Initialized SQLite DB at {_DB_PATH}")
    except Exception as e:
        logger.error(f"[db] Failed to init DB: {e}")


def _insert_record(record: dict) -> None:
    known = {"entity_id", "type", "source_url", "title", "risk_level",
             "fake_probability", "trust_score_after", "timestamp"}
    row = {k: record.get(k) for k in known}
    extra = {k: v for k, v in record.items() if k not in known}
    row["extra_json"] = json.dumps(extra) if extra else None

    with _db_write_lock:
        conn = _get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO detections
                      (entity_id, type, source_url, title, risk_level,
                       fake_probability, trust_score_after, timestamp, extra_json)
                    VALUES
                      (:entity_id, :type, :source_url, :title, :risk_level,
                       :fake_probability, :trust_score_after, :timestamp, :extra_json)
                    """,
                    row,
                )
                # Trim oldest records if over cap
                count = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
                if count > MAX_HISTORY:
                    conn.execute(
                        "DELETE FROM detections WHERE id IN "
                        "(SELECT id FROM detections ORDER BY timestamp ASC LIMIT ?)",
                        (count - MAX_HISTORY,),
                    )
        finally:
            conn.close()


def _query_records(
    type_filter: str | None,
    risk_filter: str | None,
    limit: int,
) -> dict:
    conn = _get_connection()
    try:
        params: list[Any] = []
        where_clauses: list[str] = []

        if type_filter:
            where_clauses.append("UPPER(type) = ?")
            params.append(type_filter.upper())
        if risk_filter:
            where_clauses.append("UPPER(risk_level) = ?")
            params.append(risk_filter.upper())

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        rows = conn.execute(
            f"SELECT * FROM detections {where_sql} ORDER BY timestamp DESC LIMIT ?",
            params + [limit],
        ).fetchall()

        total = conn.execute(
            f"SELECT COUNT(*) FROM detections {where_sql}",
            params,
        ).fetchone()[0]

        records = []
        for row in rows:
            rec = dict(row)
            extra_raw = rec.pop("extra_json", None)
            rec.pop("id", None)
            if extra_raw:
                try:
                    rec.update(json.loads(extra_raw))
                except Exception:
                    pass
            records.append(rec)

        return {"records": records, "total": total}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Trust score sync helpers
# ---------------------------------------------------------------------------

def _get_trust_score(session_id: str, initial: float = 100.0) -> float:
    conn = _get_connection()
    try:
        row = conn.execute(
            "SELECT score FROM trust_scores WHERE session_id = ?", (session_id,)
        ).fetchone()
        return row["score"] if row else initial
    finally:
        conn.close()


def _set_trust_score(session_id: str, score: float) -> None:
    import time
    with _db_write_lock:
        conn = _get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO trust_scores (session_id, score, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at
                    """,
                    (session_id, score, int(time.time() * 1000)),
                )
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

_history_lock: asyncio.Lock = asyncio.Lock()


async def record_history(record: dict) -> None:
    """
    Persist a detection record to SQLite.
    Fire-and-forget safe — call with asyncio.create_task().

    Record schema::

        {
            "entity_id":         str,
            "type":              str,    # "IMAGE" | "TEXT" | "VIDEO" | "AUDIO"
            "source_url":        str,
            "title":             str,
            "risk_level":        str,    # "LOW" | "MEDIUM" | "HIGH"
            "fake_probability":  float,
            "trust_score_after": float,
            "timestamp":         int,    # ms epoch
            ... (any extra fields stored in extra_json)
        }
    """
    async with _history_lock:
        await asyncio.to_thread(_insert_record, record)


async def query_history(
    type_filter: str | None = None,
    risk_filter: str | None = None,
    limit: int = 500,
) -> dict:
    """
    Return detection records with optional filters, newest-first.

    Returns:
        {"records": [...], "total": int}
    """
    limit = max(1, min(limit, 2000))
    return await asyncio.to_thread(_query_records, type_filter, risk_filter, limit)


# ---------------------------------------------------------------------------
# Async trust score helpers (used by TrustScoreEngine)
# ---------------------------------------------------------------------------

async def db_get_trust_score(session_id: str, initial: float = 100.0) -> float:
    return await asyncio.to_thread(_get_trust_score, session_id, initial)


async def db_set_trust_score(session_id: str, score: float) -> None:
    await asyncio.to_thread(_set_trust_score, session_id, score)


# ---------------------------------------------------------------------------
# Init on import
# ---------------------------------------------------------------------------

_init_db()


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------

def _list_cases(workspace_id=None):
    import json as _j
    conn = _get_connection()
    try:
        if workspace_id:
            rows = conn.execute("SELECT * FROM cases WHERE workspace_id = ? ORDER BY updated_at DESC", (workspace_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM cases ORDER BY updated_at DESC").fetchall()
        result = []
        for row in rows:
            r = dict(row)
            r.pop("metadata_json", None)
            result.append(r)
        return result
    finally:
        conn.close()


def _create_case(case):
    import time as _t, hashlib as _h
    conn = _get_connection()
    try:
        cid = _h.sha256(f"{case['title']}{_t.time()}".encode()).hexdigest()[:16]
        now = int(_t.time() * 1000)
        sig = _h.sha256(f"{cid}{case['title']}{now}".encode()).hexdigest()
        with conn:
            conn.execute(
                "INSERT INTO cases (id,title,description,status,workspace_id,created_at,updated_at,signature) VALUES (?,?,?,?,?,?,?,?)",
                (cid, case["title"], case.get("description",""), "open", case.get("workspace_id"), now, now, sig)
            )
        return {"id": cid, "title": case["title"], "description": case.get("description",""), "status": "open", "created_at": now, "updated_at": now, "signature": sig}
    finally:
        conn.close()


def _update_case(case_id, updates):
    import time as _t
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        fields, vals = [], []
        for k in ("title","description","status"):
            if k in updates and updates[k]:
                fields.append(f"{k} = ?"); vals.append(updates[k])
        fields.append("updated_at = ?"); vals.append(now); vals.append(case_id)
        with conn:
            conn.execute(f"UPDATE cases SET {', '.join(fields)} WHERE id = ?", vals)
        return True
    finally:
        conn.close()


def _delete_case(case_id):
    conn = _get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM case_evidence WHERE case_id = ?", (case_id,))
            conn.execute("DELETE FROM cases WHERE id = ?", (case_id,))
        return True
    finally:
        conn.close()


def _add_case_evidence(case_id, evidence):
    import time as _t, hashlib as _h
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        ch = _h.sha256(f"{evidence.get('source_url','')}{evidence.get('entity_id','')}".encode()).hexdigest()
        with conn:
            cur = conn.execute(
                "INSERT INTO case_evidence (case_id,entity_id,detection_type,source_url,risk_level,fake_probability,added_at,note,content_hash) VALUES (?,?,?,?,?,?,?,?,?)",
                (case_id, evidence.get("entity_id"), evidence.get("detection_type"), evidence.get("source_url"), evidence.get("risk_level"), evidence.get("fake_probability"), now, evidence.get("note",""), ch)
            )
            conn.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id))
        return {"id": cur.lastrowid, "case_id": case_id, "added_at": now, "content_hash": ch, **evidence}
    finally:
        conn.close()


def _get_case_evidence(case_id):
    conn = _get_connection()
    try:
        rows = conn.execute("SELECT * FROM case_evidence WHERE case_id = ? ORDER BY added_at ASC", (case_id,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _export_case_edrm(case_id):
    import time as _t
    conn = _get_connection()
    try:
        crow = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
        if not crow:
            return ""
        c = dict(crow)
        evs = [dict(r) for r in conn.execute("SELECT * FROM case_evidence WHERE case_id = ? ORDER BY added_at ASC", (case_id,)).fetchall()]
        lines = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<Root DataInterchangeType="LoadFile" DataSetName="EntityX_Evidence" xmlns="urn:edrm.net:xmlns:edrm:1.2">',
            f'  <Batch BatchID="{case_id}" BatchName="{c["title"]}" CreationDate="{_t.strftime("%Y-%m-%d")}">',
            f'    <ChainOfCustody Signature="{c.get("signature","")}" />']
        for ev in evs:
            lines += [
                f'    <Document DocID="{ev["content_hash"]}">',
                f'      <Location Type="URL">{ev.get("source_url","")}</Location>',
                f'      <Field Name="RiskLevel">{ev.get("risk_level","")}</Field>',
                f'      <Field Name="FakeProbability">{ev.get("fake_probability","")}</Field>',
                f'      <Field Name="DetectionType">{ev.get("detection_type","")}</Field>',
                '    </Document>']
        lines += ['  </Batch>', '</Root>']
        return "\n".join(lines)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Community Hashes
# ---------------------------------------------------------------------------

def _community_check(hash_val):
    conn = _get_connection()
    try:
        row = conn.execute("SELECT * FROM community_hashes WHERE hash = ?", (hash_val,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _community_report(hash_val, content_type, risk_level, source_domain=""):
    import time as _t, json as _j
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        ex = conn.execute("SELECT * FROM community_hashes WHERE hash = ?", (hash_val,)).fetchone()
        with conn:
            if ex:
                ex = dict(ex)
                domains = _j.loads(ex.get("source_domains") or "[]")
                if source_domain and source_domain not in domains:
                    domains.append(source_domain)
                conn.execute("UPDATE community_hashes SET confirmed_count=confirmed_count+1, last_seen=?, source_domains=? WHERE hash=?", (now, _j.dumps(domains), hash_val))
                return {"hash": hash_val, "confirmed_count": ex["confirmed_count"]+1, "status": "updated"}
            else:
                conn.execute("INSERT INTO community_hashes (hash,content_type,risk_level,confirmed_count,first_seen,last_seen,source_domains) VALUES (?,?,?,1,?,?,?)",
                    (hash_val, content_type, risk_level, now, now, _j.dumps([source_domain] if source_domain else [])))
                return {"hash": hash_val, "confirmed_count": 1, "status": "added"}
    finally:
        conn.close()


def _community_stats():
    import json as _j
    conn = _get_connection()
    try:
        total = conn.execute("SELECT COUNT(*) FROM community_hashes").fetchone()[0]
        high = conn.execute("SELECT COUNT(*) FROM community_hashes WHERE risk_level='HIGH'").fetchone()[0]
        by_type = {r["content_type"] or "UNKNOWN": r["cnt"] for r in conn.execute("SELECT content_type, COUNT(*) as cnt FROM community_hashes GROUP BY content_type").fetchall()}
        dc = {}
        for row in conn.execute("SELECT source_domains FROM community_hashes WHERE source_domains IS NOT NULL").fetchall():
            try:
                for d in _j.loads(row["source_domains"] or "[]"):
                    dc[d] = dc.get(d, 0) + 1
            except Exception:
                pass
        top = sorted([{"domain": k, "count": v} for k, v in dc.items()], key=lambda x: -x["count"])[:10]
        return {"total": total, "high_risk": high, "by_type": by_type, "top_domains": top}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

def _submit_feedback(fb):
    import time as _t
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        with conn:
            conn.execute("INSERT INTO feedback (entity_id,content_hash,user_label,original_risk,original_probability,timestamp) VALUES (?,?,?,?,?,?)",
                (fb.get("entity_id"), fb.get("content_hash"), fb.get("user_label"), fb.get("original_risk"), fb.get("original_probability"), now))
        return True
    finally:
        conn.close()


def _feedback_stats():
    conn = _get_connection()
    try:
        total = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
        by_label = {r["user_label"] or "UNSURE": r["cnt"] for r in conn.execute("SELECT user_label, COUNT(*) as cnt FROM feedback GROUP BY user_label").fetchall()}
        return {"total": total, "by_label": by_label}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Creator Profiles
# ---------------------------------------------------------------------------

def _list_creator_profiles():
    import json as _j
    conn = _get_connection()
    try:
        rows = conn.execute("SELECT * FROM creator_profiles ORDER BY created_at DESC").fetchall()
        result = []
        for row in rows:
            r = dict(row)
            r.pop("metadata_json", None)
            result.append(r)
        return result
    finally:
        conn.close()


def _create_creator_profile(profile):
    import time as _t, hashlib as _h, json as _j
    conn = _get_connection()
    try:
        pid = _h.sha256(f"{profile['name']}{_t.time()}".encode()).hexdigest()[:16]
        now = int(_t.time() * 1000)
        with conn:
            conn.execute("INSERT INTO creator_profiles (id,name,content_type,description,created_at,metadata_json) VALUES (?,?,?,?,?,?)",
                (pid, profile["name"], profile.get("content_type","general"), profile.get("description",""), now, _j.dumps(profile.get("metadata",{}))))
        return {"id": pid, "name": profile["name"], "content_type": profile.get("content_type","general"), "description": profile.get("description",""), "created_at": now}
    finally:
        conn.close()


def _delete_creator_profile(profile_id):
    conn = _get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM creator_profiles WHERE id = ?", (profile_id,))
        return True
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Social Monitors
# ---------------------------------------------------------------------------

def _list_social_monitors():
    conn = _get_connection()
    try:
        rows = conn.execute("SELECT * FROM social_monitors WHERE active=1 ORDER BY added_at DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _add_social_monitor(platform, handle, rss_url=""):
    import time as _t
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        with conn:
            cur = conn.execute("INSERT INTO social_monitors (platform,handle,rss_url,active,added_at) VALUES (?,?,?,1,?)", (platform, handle, rss_url, now))
        return {"id": cur.lastrowid, "platform": platform, "handle": handle, "rss_url": rss_url, "added_at": now}
    finally:
        conn.close()


def _remove_social_monitor(monitor_id):
    conn = _get_connection()
    try:
        with conn:
            conn.execute("UPDATE social_monitors SET active=0 WHERE id=?", (monitor_id,))
        return True
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Workspaces
# ---------------------------------------------------------------------------

def _list_workspaces():
    conn = _get_connection()
    try:
        rows = conn.execute("SELECT * FROM workspaces ORDER BY updated_at DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _create_workspace(workspace):
    import time as _t, hashlib as _h
    conn = _get_connection()
    try:
        wid = _h.sha256(f"{workspace['name']}{_t.time()}".encode()).hexdigest()[:16]
        now = int(_t.time() * 1000)
        with conn:
            conn.execute("INSERT INTO workspaces (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)",
                (wid, workspace["name"], workspace.get("description",""), now, now))
        return {"id": wid, "name": workspace["name"], "description": workspace.get("description",""), "created_at": now, "updated_at": now}
    finally:
        conn.close()


def _delete_workspace(ws_id):
    conn = _get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM workspaces WHERE id=?", (ws_id,))
        return True
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Threat Map
# ---------------------------------------------------------------------------

def _threat_map_data():
    conn = _get_connection()
    try:
        rows = conn.execute("""
            SELECT source_url, risk_level, type, COUNT(*) as cnt, AVG(fake_probability) as avg_prob
            FROM detections WHERE source_url IS NOT NULL AND source_url != ''
            GROUP BY source_url, risk_level, type ORDER BY cnt DESC LIMIT 200
        """).fetchall()
        dm = {}
        for row in rows:
            url = row["source_url"] or ""
            try:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc or url
            except Exception:
                domain = url[:50]
            if domain not in dm:
                dm[domain] = {"domain": domain, "total": 0, "high": 0, "medium": 0, "low": 0, "types": {}, "avg_prob": 0}
            dm[domain]["total"] += row["cnt"]
            lv = (row["risk_level"] or "LOW").lower()
            dm[domain][lv] = dm[domain].get(lv, 0) + row["cnt"]
            t = row["type"] or "UNKNOWN"
            dm[domain]["types"][t] = dm[domain]["types"].get(t, 0) + row["cnt"]
            dm[domain]["avg_prob"] = row["avg_prob"] or 0
        ch = conn.execute("SELECT COUNT(*) FROM community_hashes").fetchone()[0]
        fb = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
        tl = conn.execute("SELECT timestamp, risk_level, type FROM detections WHERE risk_level IN ('HIGH','MEDIUM') ORDER BY timestamp DESC LIMIT 50").fetchall()
        return {"domains": sorted(dm.values(), key=lambda x: -x["high"])[:50], "community_hashes": ch, "feedback_count": fb, "timeline": [dict(r) for r in tl]}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Async wrappers
# ---------------------------------------------------------------------------

async def db_list_cases(workspace_id=None): return await asyncio.to_thread(_list_cases, workspace_id)
async def db_get_case(cid):
    def _get(cid):
        conn = _get_connection()
        try:
            row = conn.execute("SELECT * FROM cases WHERE id = ?", (cid,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
    return await asyncio.to_thread(_get, cid)
async def db_create_case(case): return await asyncio.to_thread(_create_case, case)
async def db_update_case(cid, updates): return await asyncio.to_thread(_update_case, cid, updates)
async def db_delete_case(cid): return await asyncio.to_thread(_delete_case, cid)
async def db_add_case_evidence(cid, ev): return await asyncio.to_thread(_add_case_evidence, cid, ev)
async def db_get_case_evidence(cid): return await asyncio.to_thread(_get_case_evidence, cid)
async def db_export_case_edrm(cid): return await asyncio.to_thread(_export_case_edrm, cid)
async def db_community_check(h): return await asyncio.to_thread(_community_check, h)
async def db_community_report(h, ct, rl, sd=""): return await asyncio.to_thread(_community_report, h, ct, rl, sd)
async def db_community_stats(): return await asyncio.to_thread(_community_stats)
async def db_submit_feedback(fb): return await asyncio.to_thread(_submit_feedback, fb)
async def db_feedback_stats(): return await asyncio.to_thread(_feedback_stats)
async def db_list_creator_profiles(): return await asyncio.to_thread(_list_creator_profiles)
async def db_create_creator_profile(p): return await asyncio.to_thread(_create_creator_profile, p)
async def db_delete_creator_profile(pid): return await asyncio.to_thread(_delete_creator_profile, pid)
async def db_list_social_monitors(): return await asyncio.to_thread(_list_social_monitors)
async def db_add_social_monitor(pl, h, ru=""): return await asyncio.to_thread(_add_social_monitor, pl, h, ru)
async def db_remove_social_monitor(mid): return await asyncio.to_thread(_remove_social_monitor, mid)
async def db_list_workspaces(): return await asyncio.to_thread(_list_workspaces)
async def db_create_workspace(w): return await asyncio.to_thread(_create_workspace, w)
async def db_delete_workspace(wid): return await asyncio.to_thread(_delete_workspace, wid)
async def db_threat_map_data(): return await asyncio.to_thread(_threat_map_data)


# ---------------------------------------------------------------------------
# Provenance Chain
# ---------------------------------------------------------------------------

def _record_provenance(content_hash: str, source_url: str, domain: str, standard: str | None) -> dict:
    import time as _t
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        with _db_write_lock:
            with conn:
                existing = conn.execute(
                    "SELECT id, seen_count FROM provenance_chain WHERE content_hash=? AND source_url=?",
                    (content_hash, source_url)
                ).fetchone()
                if existing:
                    conn.execute(
                        "UPDATE provenance_chain SET seen_count=seen_count+1, last_seen=? WHERE id=?",
                        (now, existing["id"])
                    )
                    return {"status": "updated", "content_hash": content_hash}
                else:
                    conn.execute(
                        "INSERT INTO provenance_chain (content_hash,source_url,domain,provenance_standard,first_seen,last_seen,seen_count) VALUES (?,?,?,?,?,?,1)",
                        (content_hash, source_url, domain, standard, now, now)
                    )
                    return {"status": "added", "content_hash": content_hash}
    finally:
        conn.close()


def _query_provenance_chain(content_hash: str) -> list:
    conn = _get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM provenance_chain WHERE content_hash=? ORDER BY first_seen ASC",
            (content_hash,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


async def db_record_provenance(content_hash: str, source_url: str, domain: str, standard: str | None = None) -> dict:
    return await asyncio.to_thread(_record_provenance, content_hash, source_url, domain, standard)

async def db_query_provenance_chain(content_hash: str) -> list:
    return await asyncio.to_thread(_query_provenance_chain, content_hash)


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------

def _list_watchlist() -> list:
    conn = _get_connection()
    try:
        rows = conn.execute("SELECT * FROM watchlist WHERE active=1 ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _add_watchlist_item(item: dict) -> dict:
    import time as _t
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        with _db_write_lock:
            with conn:
                cur = conn.execute(
                    "INSERT INTO watchlist (name,keyword,url,watch_type,threshold,active,created_at) VALUES (?,?,?,?,?,1,?)",
                    (item["name"], item.get("keyword",""), item.get("url",""),
                     item.get("watch_type","keyword"), item.get("threshold", 0.6), now)
                )
        return {"id": cur.lastrowid, "name": item["name"], "created_at": now}
    finally:
        conn.close()


def _delete_watchlist_item(item_id: int) -> bool:
    conn = _get_connection()
    try:
        with _db_write_lock:
            with conn:
                conn.execute("UPDATE watchlist SET active=0 WHERE id=?", (item_id,))
        return True
    finally:
        conn.close()


def _add_watchlist_alert(watchlist_id: int, alert: dict) -> dict:
    import time as _t
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        with _db_write_lock:
            with conn:
                cur = conn.execute(
                    "INSERT INTO watchlist_alerts (watchlist_id,source_url,title,risk_level,fake_probability,detected_at,read) VALUES (?,?,?,?,?,?,0)",
                    (watchlist_id, alert.get("source_url",""), alert.get("title",""),
                     alert.get("risk_level",""), alert.get("fake_probability",0.0), now)
                )
        return {"id": cur.lastrowid, "watchlist_id": watchlist_id, "detected_at": now}
    finally:
        conn.close()


def _list_watchlist_alerts(unread_only: bool = False) -> list:
    conn = _get_connection()
    try:
        sql = "SELECT a.*, w.name as watchlist_name FROM watchlist_alerts a JOIN watchlist w ON a.watchlist_id=w.id"
        if unread_only:
            sql += " WHERE a.read=0"
        sql += " ORDER BY a.detected_at DESC LIMIT 200"
        rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _mark_alert_read(alert_id: int) -> bool:
    conn = _get_connection()
    try:
        with _db_write_lock:
            with conn:
                conn.execute("UPDATE watchlist_alerts SET read=1 WHERE id=?", (alert_id,))
        return True
    finally:
        conn.close()


async def db_list_watchlist() -> list:
    return await asyncio.to_thread(_list_watchlist)

async def db_add_watchlist_item(item: dict) -> dict:
    return await asyncio.to_thread(_add_watchlist_item, item)

async def db_delete_watchlist_item(item_id: int) -> bool:
    return await asyncio.to_thread(_delete_watchlist_item, item_id)

async def db_add_watchlist_alert(watchlist_id: int, alert: dict) -> dict:
    return await asyncio.to_thread(_add_watchlist_alert, watchlist_id, alert)

async def db_list_watchlist_alerts(unread_only: bool = False) -> list:
    return await asyncio.to_thread(_list_watchlist_alerts, unread_only)

async def db_mark_alert_read(alert_id: int) -> bool:
    return await asyncio.to_thread(_mark_alert_read, alert_id)


# ---------------------------------------------------------------------------
# Confidence Timeline
# ---------------------------------------------------------------------------

def _record_timeline(entity_id: str, content_hash: str, score: float, score_type: str, source: str) -> None:
    import time as _t
    conn = _get_connection()
    try:
        now = int(_t.time() * 1000)
        with _db_write_lock:
            with conn:
                conn.execute(
                    "INSERT INTO confidence_timeline (entity_id,content_hash,score,score_type,source,recorded_at) VALUES (?,?,?,?,?,?)",
                    (entity_id, content_hash, score, score_type, source, now)
                )
    finally:
        conn.close()


def _query_timeline(entity_id: str | None, content_hash: str | None, limit: int) -> list:
    conn = _get_connection()
    try:
        if entity_id:
            rows = conn.execute(
                "SELECT * FROM confidence_timeline WHERE entity_id=? ORDER BY recorded_at ASC LIMIT ?",
                (entity_id, limit)
            ).fetchall()
        elif content_hash:
            rows = conn.execute(
                "SELECT * FROM confidence_timeline WHERE content_hash=? ORDER BY recorded_at ASC LIMIT ?",
                (content_hash, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM confidence_timeline ORDER BY recorded_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


async def db_record_timeline(entity_id: str, content_hash: str, score: float, score_type: str = "fake_probability", source: str = "") -> None:
    await asyncio.to_thread(_record_timeline, entity_id, content_hash, score, score_type, source)

async def db_query_timeline(entity_id: str | None = None, content_hash: str | None = None, limit: int = 100) -> list:
    return await asyncio.to_thread(_query_timeline, entity_id, content_hash, limit)

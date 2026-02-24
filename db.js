/**
 * db.js — Entity X Local Persistent Database
 *
 * SQLite-backed, offline-first, audit-ready storage.
 * Database file: entityx.db  (written to Electron userData directory)
 *
 * Tables
 * ──────
 *   entities        — Every detected IMAGE / NEWS / TEXT entity
 *   trust_history   — Trust score changes per entity over time
 *   audit_log       — Immutable event trail for forensic / audit purposes
 *   legal_sessions  — Legal chat interactions (query + AI response)
 *
 * Usage
 * ──────
 *   // In app.whenReady():
 *   const db = require('./db');
 *   db.initDb(path.join(app.getPath('userData'), 'entityx.db'));
 *
 *   // Then anywhere in main process:
 *   db.insertEntity({ entity_id, entity_type, source_url, ... });
 *   db.insertAuditLog('ENTITY_DETECTED', entityId, sessionId, { risk_level });
 *
 * All write helpers are synchronous (better-sqlite3 is sync by design).
 * They are all wrapped in try/catch — a DB failure NEVER crashes the app.
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const BetterSqlite3 = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Internal state — lazy-initialised by initDb()
// ---------------------------------------------------------------------------

/** @type {import('better-sqlite3').Database | null} */
let _db = null;

/** @type {Object.<string, import('better-sqlite3').Statement>} */
const _stmts = {};   // prepared statement cache

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Open (or create) the SQLite database, run all CREATE TABLE IF NOT EXISTS
 * migrations, and prepare reusable statements.
 *
 * Call this ONCE from app.whenReady() before any other db.* calls.
 *
 * @param {string} dbPath  Absolute path to the database file.
 *                         Recommended: path.join(app.getPath('userData'), 'entityx.db')
 */
function initDb(dbPath) {
  try {
    // Ensure the parent directory exists (it always does for userData, but be safe)
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    _db = new BetterSqlite3(dbPath, { verbose: null });

    // WAL mode — faster writes, safe concurrent reads, no corruption on crash
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    _runMigrations();
    _prepareStatements();

    console.log(`[DB] Initialized SQLite database: ${dbPath}`);
  } catch (err) {
    console.error('[DB] FATAL — could not initialise database:', err.message);
    _db = null;   // keep running; all helpers will no-op when _db is null
  }
}

// ---------------------------------------------------------------------------
// Schema migrations
// ---------------------------------------------------------------------------

function _runMigrations() {
  _db.exec(`
    -- ── 1. entities ──────────────────────────────────────────────────────────
    -- Stores every detected entity.  analysis_json holds the full raw payload
    -- as JSON so no schema change is needed when the backend adds new fields.
    CREATE TABLE IF NOT EXISTS entities (
      entity_id      TEXT    PRIMARY KEY,
      entity_type    TEXT    NOT NULL CHECK(entity_type IN ('IMAGE','NEWS','TEXT','UNKNOWN')),
      source_url     TEXT    DEFAULT '',
      title          TEXT    DEFAULT '',
      extracted_text TEXT    DEFAULT '',
      risk_level     TEXT    DEFAULT 'LOW',
      analysis_json  TEXT    DEFAULT '{}',
      detected_at    DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    -- ── 2. trust_history ─────────────────────────────────────────────────────
    -- Records every trust-score change so we can chart score drift over time.
    CREATE TABLE IF NOT EXISTS trust_history (
      id             INTEGER  PRIMARY KEY AUTOINCREMENT,
      entity_id      TEXT     NOT NULL,
      trust_score    REAL     NOT NULL,
      delta          REAL     DEFAULT 0,
      timestamp      DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    -- ── 3. audit_log ─────────────────────────────────────────────────────────
    -- Immutable event trail.  Rows should NEVER be deleted.
    -- event_type:  ENTITY_DETECTED | ENTITY_VIEWED | LEGAL_CHAT_USED |
    --              PDF_EXPORTED    | MANUAL_ANALYSIS
    CREATE TABLE IF NOT EXISTS audit_log (
      event_id       TEXT    PRIMARY KEY,
      event_type     TEXT    NOT NULL,
      entity_id      TEXT    DEFAULT '',
      session_id     TEXT    DEFAULT '',
      timestamp      DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      metadata       TEXT    DEFAULT '{}'
    );

    -- ── 4. legal_sessions ────────────────────────────────────────────────────
    -- Every legal-chat or AI-complaint interaction is persisted here.
    CREATE TABLE IF NOT EXISTS legal_sessions (
      id             INTEGER  PRIMARY KEY AUTOINCREMENT,
      entity_id      TEXT     DEFAULT '',
      user_query     TEXT     DEFAULT '',
      ai_response    TEXT     DEFAULT '',
      session_type   TEXT     DEFAULT 'LEGAL_CHAT',
      timestamp      DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_entities_type        ON entities(entity_type);
    CREATE INDEX IF NOT EXISTS idx_entities_risk        ON entities(risk_level);
    CREATE INDEX IF NOT EXISTS idx_entities_detected    ON entities(detected_at);
    CREATE INDEX IF NOT EXISTS idx_trust_entity         ON trust_history(entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_type           ON audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp      ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_legal_entity         ON legal_sessions(entity_id);
  `);
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

function _prepareStatements() {
  _stmts.insertEntity = _db.prepare(`
    INSERT OR REPLACE INTO entities
      (entity_id, entity_type, source_url, title, extracted_text, risk_level, analysis_json, detected_at)
    VALUES
      (@entity_id, @entity_type, @source_url, @title, @extracted_text, @risk_level, @analysis_json, @detected_at)
  `);

  _stmts.insertTrust = _db.prepare(`
    INSERT INTO trust_history (entity_id, trust_score, delta, timestamp)
    VALUES (@entity_id, @trust_score, @delta, @timestamp)
  `);

  _stmts.insertAudit = _db.prepare(`
    INSERT OR IGNORE INTO audit_log (event_id, event_type, entity_id, session_id, timestamp, metadata)
    VALUES (@event_id, @event_type, @entity_id, @session_id, @timestamp, @metadata)
  `);

  _stmts.insertLegal = _db.prepare(`
    INSERT INTO legal_sessions (entity_id, user_query, ai_response, session_type, timestamp)
    VALUES (@entity_id, @user_query, @ai_response, @session_type, @timestamp)
  `);

  _stmts.queryEntities = _db.prepare(`
    SELECT * FROM entities
    WHERE (@type IS NULL OR entity_type = @type)
      AND (@risk  IS NULL OR risk_level  = @risk)
    ORDER BY detected_at DESC
    LIMIT @limit
  `);

  _stmts.countEntities = _db.prepare(`
    SELECT COUNT(*) AS total FROM entities
    WHERE (@type IS NULL OR entity_type = @type)
      AND (@risk  IS NULL OR risk_level  = @risk)
  `);

  _stmts.getEntity = _db.prepare(`SELECT * FROM entities WHERE entity_id = ?`);

  _stmts.queryAudit = _db.prepare(`
    SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT @limit
  `);

  _stmts.queryLegal = _db.prepare(`
    SELECT * FROM legal_sessions ORDER BY timestamp DESC LIMIT @limit
  `);

  _stmts.queryTrust = _db.prepare(`
    SELECT * FROM trust_history WHERE entity_id = @entity_id ORDER BY timestamp ASC
  `);

  // Legal chat history per entity — ordered oldest-first for chat replay
  _stmts.queryLegalByEntity = _db.prepare(`
    SELECT id, entity_id, user_query, ai_response, session_type, timestamp
    FROM   legal_sessions
    WHERE  entity_id = @entity_id
    ORDER  BY timestamp ASC
    LIMIT  200
  `);
}

// ---------------------------------------------------------------------------
// Guard helper — all public write functions use this
// ---------------------------------------------------------------------------

function _ready() {
  if (!_db) {
    console.warn('[DB] Database not initialised — skipping write.');
    return false;
  }
  return true;
}

function _nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function _uuid() {
  // tiny UUID-like unique ID without external deps
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Public write helpers
// ---------------------------------------------------------------------------

/**
 * Persist a detected entity.
 *
 * @param {object} p
 * @param {string}  p.entity_id
 * @param {string}  p.entity_type    'IMAGE' | 'TEXT' | 'NEWS' | 'UNKNOWN'
 * @param {string}  [p.source_url]
 * @param {string}  [p.title]        content_title or article title
 * @param {string}  [p.text]         full extracted text (TEXT entities)
 * @param {string}  [p.risk_level]   'LOW' | 'MEDIUM' | 'HIGH'
 * @param {object}  [p.analysis]     raw analysis hash — stored as JSON blob
 * @param {number}  [p.detected_at]  ms epoch; defaults to now
 */
function insertEntity(p) {
  if (!_ready()) return;
  try {
    const detectedIso = p.detected_at
      ? new Date(p.detected_at).toISOString().replace('T', ' ').slice(0, 19)
      : _nowIso();

    _stmts.insertEntity.run({
      entity_id:      p.entity_id        || 'unknown',
      entity_type:    (p.entity_type     || 'UNKNOWN').toUpperCase(),
      source_url:     p.source_url       || p.url || p.image_url || '',
      title:          p.title            || p.content_title || '',
      extracted_text: p.text             || '',
      risk_level:     (p.risk_level      || p.misinformation_risk || 'LOW').toUpperCase(),
      analysis_json:  JSON.stringify(p.analysis || {}),
      detected_at:    detectedIso,
    });
    console.log(`[DB] Entity saved: ${p.entity_id} (${p.entity_type})`);
  } catch (err) {
    console.error('[DB] insertEntity error:', err.message);
  }
}

/**
 * Record a trust-score change event.
 *
 * @param {string} entityId
 * @param {number} trustScore   Current score (0–100)
 * @param {number} [delta]      Change amount (negative = deduction)
 */
function insertTrustHistory(entityId, trustScore, delta = 0) {
  if (!_ready()) return;
  try {
    _stmts.insertTrust.run({
      entity_id:   entityId,
      trust_score: trustScore,
      delta:       delta,
      timestamp:   _nowIso(),
    });
  } catch (err) {
    console.error('[DB] insertTrustHistory error:', err.message);
  }
}

/**
 * Append an event to the immutable audit log.
 *
 * @param {string} eventType   One of: ENTITY_DETECTED | ENTITY_VIEWED |
 *                             LEGAL_CHAT_USED | PDF_EXPORTED | MANUAL_ANALYSIS
 * @param {string} [entityId]  Related entity, if applicable
 * @param {string} [sessionId] Electron session or user session ID
 * @param {object} [metadata]  Any extra JSON-serialisable data
 */
function insertAuditLog(eventType, entityId = '', sessionId = '', metadata = {}) {
  if (!_ready()) return;
  try {
    _stmts.insertAudit.run({
      event_id:   _uuid(),
      event_type: eventType,
      entity_id:  entityId  || '',
      session_id: sessionId || '',
      timestamp:  _nowIso(),
      metadata:   JSON.stringify(metadata),
    });
  } catch (err) {
    console.error('[DB] insertAuditLog error:', err.message);
  }
}

/**
 * Save a legal-chat or complaint-generation interaction.
 *
 * @param {string} entityId     Related entity (may be empty for generic chats)
 * @param {string} userQuery    The user's question or complaint payload summary
 * @param {string} aiResponse   The AI-generated response / draft
 * @param {string} [sessionType] 'LEGAL_CHAT' (default) | 'COMPLAINT_DRAFT'
 */
function insertLegalSession(entityId, userQuery, aiResponse, sessionType = 'LEGAL_CHAT') {
  if (!_ready()) return;
  try {
    _stmts.insertLegal.run({
      entity_id:    entityId    || '',
      user_query:   userQuery   || '',
      ai_response:  aiResponse  || '',
      session_type: sessionType,
      timestamp:    _nowIso(),
    });
    console.log(`[DB] Legal session saved (${sessionType}) for entity: ${entityId || 'n/a'}`);
  } catch (err) {
    console.error('[DB] insertLegalSession error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Public read helpers
// ---------------------------------------------------------------------------

/**
 * Query entities — used as a local fallback when the Python backend is down.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.type]        Filter by entity_type (case-insensitive)
 * @param {string}  [opts.risk_level]  Filter by risk_level  (case-insensitive)
 * @param {number}  [opts.limit]       Max rows (default 500, max 2000)
 * @returns {{ records: object[], total: number }}
 */
function queryEntities({ type = null, risk_level = null, limit = 500 } = {}) {
  if (!_ready()) return { records: [], total: 0 };
  try {
    const t   = type       ? type.toUpperCase()       : null;
    const r   = risk_level ? risk_level.toUpperCase() : null;
    const lim = Math.max(1, Math.min(limit, 2000));

    const rows  = _stmts.queryEntities.all({ type: t, risk: r, limit: lim });
    const count = _stmts.countEntities.get({ type: t, risk: r });

    // Parse stored analysis_json back into an object for each row
    const records = rows.map(row => {
      try { row.analysis = JSON.parse(row.analysis_json || '{}'); } catch { row.analysis = {}; }
      return row;
    });

    return { records, total: count.total };
  } catch (err) {
    console.error('[DB] queryEntities error:', err.message);
    return { records: [], total: 0 };
  }
}

/**
 * Retrieve a single entity by ID.
 * @param {string} entityId
 * @returns {object|null}
 */
function getEntity(entityId) {
  if (!_ready() || !entityId) return null;
  try {
    const row = _stmts.getEntity.get(entityId);
    if (row) {
      try { row.analysis = JSON.parse(row.analysis_json || '{}'); } catch { row.analysis = {}; }
    }
    return row || null;
  } catch (err) {
    console.error('[DB] getEntity error:', err.message);
    return null;
  }
}

/**
 * Retrieve the last N entries from the audit log.
 * @param {number} [limit=200]
 * @returns {object[]}
 */
function queryAuditLog(limit = 200) {
  if (!_ready()) return [];
  try {
    return _stmts.queryAudit.all({ limit: Math.min(limit, 5000) });
  } catch (err) {
    console.error('[DB] queryAuditLog error:', err.message);
    return [];
  }
}

/**
 * Retrieve the last N legal sessions.
 * @param {number} [limit=100]
 * @returns {object[]}
 */
function queryLegalSessions(limit = 100) {
  if (!_ready()) return [];
  try {
    return _stmts.queryLegal.all({ limit: Math.min(limit, 1000) });
  } catch (err) {
    console.error('[DB] queryLegalSessions error:', err.message);
    return [];
  }
}

/**
 * Get all legal-chat messages for a specific entity, oldest-first.
 * Used to restore chat history when an entity is opened in the UI.
 * Rows are READ-ONLY by design — no delete or update is exposed.
 *
 * @param {string} entityId
 * @returns {{ id, entity_id, user_query, ai_response, session_type, timestamp }[]}
 */
function getLegalChatHistory(entityId) {
  if (!_ready() || !entityId) return [];
  try {
    return _stmts.queryLegalByEntity.all({ entity_id: entityId });
  } catch (err) {
    console.error('[DB] getLegalChatHistory error:', err.message);
    return [];
  }
}

/**
 * Retrieve trust-score history for one entity.
 * @param {string} entityId
 * @returns {object[]}
 */
function queryTrustHistory(entityId) {
  if (!_ready() || !entityId) return [];
  try {
    return _stmts.queryTrust.all({ entity_id: entityId });
  } catch (err) {
    console.error('[DB] queryTrustHistory error:', err.message);
    return [];
  }
}

/**
 * Return the raw better-sqlite3 Database instance for advanced queries.
 * @returns {import('better-sqlite3').Database|null}
 */
function getDb() { return _db; }

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Lifecycle
  initDb,

  // Write helpers
  insertEntity,
  insertTrustHistory,
  insertAuditLog,
  insertLegalSession,

  // Read helpers
  queryEntities,
  getEntity,
  queryAuditLog,
  queryLegalSessions,
  getLegalChatHistory,
  queryTrustHistory,

  // Escape hatch
  getDb,
};

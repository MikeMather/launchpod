import Database from 'bun:sqlite'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import path from 'path'
import fs from 'fs'
import { config } from './config.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string
  password_hash: string
  role: 'admin' | 'editor'
  created_at: string
  deactivated_at: string | null
}

export interface Token {
  id: string
  user_id: string
  token_hash: string
  label: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface TokenMetadata {
  id: string
  label: string
  created_at: string
  last_used_at: string | null
}

export interface AuditEntry {
  id: string
  user_id: string | null
  action: string
  detail: string | null
  created_at: string
}

export interface SessionRecord {
  id: string
  user_id: string
  branch: string
  preview_url: string | null
  started_at: string
  ended_at: string | null
  outcome: 'published' | 'discarded' | 'timed_out' | null
}

export interface AuditLogFilters {
  userId?: string
  action?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface SessionListOptions {
  userId?: string
  limit?: number
  offset?: number
}

export interface OAuthClient {
  id: string
  user_id: string
  client_id: string
  client_secret_hash: string
  label: string
  created_at: string
  revoked_at: string | null
}

export interface OAuthClientMetadata {
  id: string
  client_id: string
  label: string
  created_at: string
}

// ── Database singleton ─────────────────────────────────────────────────────

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return _db
}

export function initDb(): Database.Database {
  if (_db) return _db

  // Ensure the directory exists
  const dbDir = path.dirname(config.ADMIN_DB_PATH)
  fs.mkdirSync(dbDir, { recursive: true })

  _db = new Database(config.ADMIN_DB_PATH)
  // _db.pragma('journal_mode = WAL')
  // _db.pragma('foreign_keys = ON')

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('admin','editor')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deactivated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      branch TEXT NOT NULL,
      preview_url TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      outcome TEXT CHECK(outcome IN ('published','discarded','timed_out'))
    );

    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT UNIQUE NOT NULL,
      client_secret_hash TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );
  `)

  return _db
}

// ── Helpers ────────────────────────────────────────────────────────────────

function hashToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

// ── User operations ────────────────────────────────────────────────────────

export async function createUser(
  email: string,
  name: string,
  password: string,
  role: 'admin' | 'editor' = 'editor'
): Promise<User> {
  const db = getDb()
  const id = crypto.randomUUID()
  const password_hash = await bcrypt.hash(password, 12)

  const stmt = db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(id, email, name, password_hash, role)

  return getUserById(id)!
}

export function getUserByEmail(email: string): User | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined
}

export function getUserById(id: string): User | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
}

export function listUsers(): User[] {
  const db = getDb()
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as User[]
}

export function updateUserRole(id: string, role: 'admin' | 'editor'): void {
  const db = getDb()
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
}

export function deactivateUser(id: string): void {
  const db = getDb()
  db.prepare("UPDATE users SET deactivated_at = datetime('now') WHERE id = ?").run(id)
}

export function reactivateUser(id: string): void {
  const db = getDb()
  db.prepare('UPDATE users SET deactivated_at = NULL WHERE id = ?').run(id)
}

// ── Token operations ───────────────────────────────────────────────────────

export function generateToken(userId: string, label: string): { token: string; id: string } {
  const db = getDb()
  const id = crypto.randomUUID()
  const plaintext = crypto.randomBytes(32).toString('hex') // 64-char hex string
  const token_hash = hashToken(plaintext)

  db.prepare(`
    INSERT INTO tokens (id, user_id, token_hash, label)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, token_hash, label)

  return { token: plaintext, id }
}

export function validateToken(plaintext: string): User | null {
  const db = getDb()
  const token_hash = hashToken(plaintext)

  const token = db.prepare(`
    SELECT t.*, u.* FROM tokens t
    JOIN users u ON t.user_id = u.id
    WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.deactivated_at IS NULL
  `).get(token_hash) as (Token & User) | undefined

  if (!token) return null

  // Update last_used_at
  db.prepare("UPDATE tokens SET last_used_at = datetime('now') WHERE token_hash = ?").run(token_hash)

  // Return user fields only
  return {
    id: token.user_id,
    email: token.email,
    name: token.name,
    password_hash: token.password_hash,
    role: token.role as 'admin' | 'editor',
    created_at: token.created_at,
    deactivated_at: token.deactivated_at,
  }
}

export function revokeToken(tokenId: string): void {
  const db = getDb()
  db.prepare("UPDATE tokens SET revoked_at = datetime('now') WHERE id = ?").run(tokenId)
}

export function listUserTokens(userId: string): TokenMetadata[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, label, created_at, last_used_at
    FROM tokens
    WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(userId) as TokenMetadata[]
}

// ── Audit log operations ───────────────────────────────────────────────────

export function logAction(userId: string | null, action: string, detail?: string): void {
  const db = getDb()
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO audit_log (id, user_id, action, detail)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, action, detail ?? null)
}

export function queryAuditLog(filters: AuditLogFilters = {}): { entries: AuditEntry[]; total: number } {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.userId) {
    conditions.push('user_id = ?')
    params.push(filters.userId)
  }
  if (filters.action) {
    conditions.push('action = ?')
    params.push(filters.action)
  }
  if (filters.from) {
    conditions.push('created_at >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    conditions.push('created_at <= ?')
    params.push(filters.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0

  const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as { count: number }).count

  const entries = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditEntry[]

  return { entries, total }
}

// ── Session record operations ──────────────────────────────────────────────

export function createSessionRecord(
  userId: string,
  branch: string,
  previewUrl?: string
): SessionRecord {
  const db = getDb()
  const id = crypto.randomUUID()

  db.prepare(`
    INSERT INTO sessions (id, user_id, branch, preview_url)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, branch, previewUrl ?? null)

  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRecord
}

export function endSessionRecord(
  id: string,
  outcome: 'published' | 'discarded' | 'timed_out'
): void {
  const db = getDb()
  db.prepare("UPDATE sessions SET ended_at = datetime('now'), outcome = ? WHERE id = ?").run(outcome, id)
}

export function listSessionRecords(options: SessionListOptions = {}): {
  records: SessionRecord[]
  total: number
} {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (options.userId) {
    conditions.push('user_id = ?')
    params.push(options.userId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  const total = (db.prepare(`SELECT COUNT(*) as count FROM sessions ${where}`).get(...params) as { count: number }).count

  const records = db.prepare(
    `SELECT * FROM sessions ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as SessionRecord[]

  return { records, total }
}

export function getActiveSessionRecord(): SessionRecord | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get() as SessionRecord | undefined
}

// ── OAuth client operations ────────────────────────────────────────────────

export async function generateOAuthClient(
  userId: string,
  label: string
): Promise<{ clientId: string; clientSecret: string; id: string }> {
  const db = getDb()
  const id = crypto.randomUUID()
  const clientId = `lp_${crypto.randomBytes(16).toString('hex')}` // 32 char hex with prefix
  const clientSecret = crypto.randomBytes(32).toString('hex') // 64 char hex
  const clientSecretHash = await bcrypt.hash(clientSecret, 12)

  db.prepare(`
    INSERT INTO oauth_clients (id, user_id, client_id, client_secret_hash, label)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, clientId, clientSecretHash, label)

  return { clientId, clientSecret, id }
}

export async function validateOAuthClient(
  clientId: string,
  clientSecret: string
): Promise<User | null> {
  const db = getDb()

  const client = db.prepare(`
    SELECT c.*, u.* FROM oauth_clients c
    JOIN users u ON c.user_id = u.id
    WHERE c.client_id = ? AND c.revoked_at IS NULL AND u.deactivated_at IS NULL
  `).get(clientId) as (OAuthClient & User) | undefined

  if (!client) return null

  // Verify the client secret
  const valid = await bcrypt.compare(clientSecret, client.client_secret_hash)
  if (!valid) return null

  // Return user fields only
  return {
    id: client.user_id,
    email: client.email,
    name: client.name,
    password_hash: client.password_hash,
    role: client.role as 'admin' | 'editor',
    created_at: client.created_at,
    deactivated_at: client.deactivated_at,
  }
}

export function revokeOAuthClient(clientId: string): void {
  const db = getDb()
  db.prepare("UPDATE oauth_clients SET revoked_at = datetime('now') WHERE id = ?").run(clientId)
}

export function listUserOAuthClients(userId: string): OAuthClientMetadata[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, client_id, label, created_at
    FROM oauth_clients
    WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(userId) as OAuthClientMetadata[]
}

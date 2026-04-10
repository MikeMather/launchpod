#!/usr/bin/env node

// ── LaunchPod — Database Seed Utility ─────────────────────────────────────
//
// Creates the admin database tables and inserts an initial admin user.
//
// Usage:
//   node seed-db.js --db-path /path/to/admin.db --email admin@example.com --password secret123 [--name "Admin"]
//
// Requires better-sqlite3 and bcrypt from admin-server/node_modules.
// ───────────────────────────────────────────────────────────────────────────

import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve modules from admin-server's node_modules
const adminServerDir = path.resolve(__dirname, '..', 'admin-server');
const require = createRequire(path.join(adminServerDir, 'node_modules', 'noop.js'));

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

// ── Parse arguments ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  let i = 2; // skip node and script path
  while (i < argv.length) {
    const key = argv[i];
    if (key === '--db-path') {
      args.dbPath = argv[++i];
    } else if (key === '--email') {
      args.email = argv[++i];
    } else if (key === '--password') {
      args.password = argv[++i];
    } else if (key === '--name') {
      args.name = argv[++i];
    } else {
      console.error(`Unknown argument: ${key}`);
      process.exit(1);
    }
    i++;
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.dbPath) {
  console.error('Error: --db-path is required');
  process.exit(1);
}
if (!args.email) {
  console.error('Error: --email is required');
  process.exit(1);
}
if (!args.password) {
  console.error('Error: --password is required');
  process.exit(1);
}

const dbPath = path.resolve(args.dbPath);
const email = args.email;
const password = args.password;
const name = args.name || 'Admin';

// ── Ensure directory exists ───────────────────────────────────────────────

const dbDir = path.dirname(dbPath);
fs.mkdirSync(dbDir, { recursive: true });

// ── Open database ─────────────────────────────────────────────────────────

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Create tables ─────────────────────────────────────────────────────────

console.log('Creating tables...');
db.exec(`
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
`);
console.log('Tables created.');

// ── Insert admin user (idempotent) ────────────────────────────────────────

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.log(`User with email ${email} already exists. Skipping insert.`);
} else {
  console.log(`Creating admin user: ${email}`);
  const id = randomUUID();
  const passwordHash = bcrypt.hashSync(password, 12);

  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role)
    VALUES (?, ?, ?, ?, 'admin')
  `).run(id, email, name, passwordHash);

  // Log the action in audit_log
  const auditId = randomUUID();
  db.prepare(`
    INSERT INTO audit_log (id, user_id, action, detail)
    VALUES (?, ?, 'user.created', 'Initial admin user created via seed script')
  `).run(auditId, id);

  console.log(`Admin user created: ${email} (${name})`);
}

// ── Cleanup ───────────────────────────────────────────────────────────────

db.close();
console.log('Database seeded successfully.');

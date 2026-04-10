// Database initialization — opens SQLite, creates tables from models.yaml
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { loadModels } from './models.js';

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  const dbPath = process.env.SITE_DB_PATH || path.join(process.cwd(), 'data', 'site.db');

  // Ensure the directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function initializeDatabase(projectRoot?: string): void {
  const database = getDb();
  const models = loadModels(projectRoot);

  for (const [name, collection] of Object.entries(models.collections)) {
    // Create table with JSON document pattern
    database.exec(`
      CREATE TABLE IF NOT EXISTS "${name}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create unique indexes for fields marked as unique
    for (const [fieldName, field] of Object.entries(collection.fields)) {
      if (field.unique) {
        database.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS "idx_${name}_${fieldName}"
          ON "${name}" (json_extract(data, '$.${fieldName}'))
        `);
      }
    }
  }
}

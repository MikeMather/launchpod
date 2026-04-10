// CRUD operations for collections using JSON document pattern
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { loadModels } from './models.js';
import { validate, applyDefaults } from './validation.js';

export interface ListOptions {
  page?: number;
  perPage?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  filters?: Record<string, any>;
}

export interface ListResult {
  items: any[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

function parseRecord(row: any): any {
  return {
    id: row.id,
    ...JSON.parse(row.data),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listRecords(collection: string, options: ListOptions = {}): ListResult {
  const db = getDb();
  const { page = 1, perPage = 25, sort = 'created_at', order = 'desc', filters = {} } = options;
  const offset = (page - 1) * perPage;

  let whereClause = '';
  const params: any[] = [];

  // Build filter conditions
  const conditions: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'created_at' || key === 'updated_at') {
      conditions.push(`${key} = ?`);
    } else {
      conditions.push(`json_extract(data, '$.${key}') = ?`);
    }
    params.push(value);
  }

  if (conditions.length > 0) {
    whereClause = 'WHERE ' + conditions.join(' AND ');
  }

  // Determine sort column
  const sortCol = (sort === 'created_at' || sort === 'updated_at')
    ? sort
    : `json_extract(data, '$.${sort}')`;

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${collection}" ${whereClause}`).get(...params) as any;
  const total = countRow?.count || 0;

  const rows = db.prepare(
    `SELECT * FROM "${collection}" ${whereClause} ORDER BY ${sortCol} ${order === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset);

  return {
    items: rows.map(parseRecord),
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}

export function getRecord(collection: string, id: string): any | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM "${collection}" WHERE id = ?`).get(id) as any;
  return row ? parseRecord(row) : null;
}

export function createRecord(collection: string, data: Record<string, any>): { id: string; errors?: string[] } {
  const models = loadModels();
  const collectionDef = models.collections[collection];
  if (!collectionDef) {
    return { id: '', errors: [`Collection '${collection}' not found`] };
  }

  // Apply defaults and validate
  const withDefaults = applyDefaults(data, collectionDef.fields);
  const errors = validate(withDefaults, collectionDef.fields);
  if (errors.length > 0) {
    return { id: '', errors };
  }

  const db = getDb();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO "${collection}" (id, data, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`
  ).run(id, JSON.stringify(withDefaults));

  return { id };
}

export function updateRecord(collection: string, id: string, data: Record<string, any>): { success: boolean; errors?: string[] } {
  const models = loadModels();
  const collectionDef = models.collections[collection];
  if (!collectionDef) {
    return { success: false, errors: [`Collection '${collection}' not found`] };
  }

  const db = getDb();
  const existing = db.prepare(`SELECT * FROM "${collection}" WHERE id = ?`).get(id) as any;
  if (!existing) {
    return { success: false, errors: ['Record not found'] };
  }

  // Merge with existing data
  const existingData = JSON.parse(existing.data);
  const merged = { ...existingData, ...data };

  const errors = validate(merged, collectionDef.fields);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  db.prepare(
    `UPDATE "${collection}" SET data = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(merged), id);

  return { success: true };
}

export function deleteRecord(collection: string, id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM "${collection}" WHERE id = ?`).run(id);
  return result.changes > 0;
}

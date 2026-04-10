// Auto-generated CRUD routes — GET (single), PATCH (update), DELETE
import type { APIRoute } from 'astro';
import { loadModels } from '../../../lib/launchpod/models.js';
import { initializeDatabase } from '../../../lib/launchpod/db.js';
import { getRecord, updateRecord, deleteRecord } from '../../../lib/launchpod/crud.js';
import { executeHooks } from '../../../lib/launchpod/hooks.js';

initializeDatabase();

export const GET: APIRoute = async ({ params }) => {
  const { collection, id } = params;
  const models = loadModels();

  if (!models.collections[collection!]) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404 });
  }

  const record = getRecord(collection!, id!);
  if (!record) {
    return new Response(JSON.stringify({ error: 'Record not found' }), { status: 404 });
  }

  return new Response(JSON.stringify(record), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const { collection, id } = params;
  const models = loadModels();

  if (!models.collections[collection!]) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404 });
  }

  const access = models.collections[collection!].access;
  if (access.update === 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 401 });
  }

  let data: Record<string, any>;
  try {
    data = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const result = updateRecord(collection!, id!, data);
  if (result.errors) {
    return new Response(JSON.stringify({ errors: result.errors }), { status: 400 });
  }

  // Execute hooks
  const collectionDef = models.collections[collection!];
  if (collectionDef.hooks?.on_update) {
    const updated = getRecord(collection!, id!);
    if (updated) {
      executeHooks(collectionDef.hooks.on_update, updated).catch(console.error);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ params }) => {
  const { collection, id } = params;
  const models = loadModels();

  if (!models.collections[collection!]) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404 });
  }

  const access = models.collections[collection!].access;
  if (access.delete === 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 401 });
  }

  const deleted = deleteRecord(collection!, id!);
  if (!deleted) {
    return new Response(JSON.stringify({ error: 'Record not found' }), { status: 404 });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

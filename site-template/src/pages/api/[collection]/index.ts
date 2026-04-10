// Auto-generated CRUD routes — GET (list) and POST (create)
// Routes are generated for each collection defined in backend/models.yaml
import type { APIRoute } from 'astro';
import { loadModels } from '../../../lib/launchpod/models.js';
import { initializeDatabase } from '../../../lib/launchpod/db.js';
import { listRecords, createRecord } from '../../../lib/launchpod/crud.js';
import { executeHooks } from '../../../lib/launchpod/hooks.js';

// Ensure database is initialized
initializeDatabase();

export const GET: APIRoute = async ({ params, url }) => {
  const collection = params.collection!;
  const models = loadModels();

  if (!models.collections[collection]) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404 });
  }

  const access = models.collections[collection].access;
  if (access.list === 'admin') {
    // TODO: Check admin authorization header
    const authHeader = url.searchParams.get('_auth');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 401 });
    }
  }

  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = parseInt(url.searchParams.get('per_page') || '25');
  const sort = url.searchParams.get('sort') || 'created_at';
  const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

  // Build filters from query params (excluding pagination/sort params)
  const reservedParams = ['page', 'per_page', 'sort', 'order', '_auth'];
  const filters: Record<string, any> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (!reservedParams.includes(key)) {
      filters[key] = value;
    }
  }

  const result = listRecords(collection, { page, perPage, sort, order, filters });
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const collection = params.collection!;
  const models = loadModels();

  if (!models.collections[collection]) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404 });
  }

  const access = models.collections[collection].access;
  if (access.create === 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 401 });
  }

  let data: Record<string, any>;
  try {
    data = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const result = createRecord(collection, data);
  if (result.errors) {
    return new Response(JSON.stringify({ errors: result.errors }), { status: 400 });
  }

  // Execute hooks asynchronously
  const collectionDef = models.collections[collection];
  if (collectionDef.hooks?.on_create) {
    executeHooks(collectionDef.hooks.on_create, { id: result.id, ...data }).catch(console.error);
  }

  return new Response(JSON.stringify({ id: result.id }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

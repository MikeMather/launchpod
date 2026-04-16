import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import fs from 'fs'
import path from 'path'
import Database from 'bun:sqlite'
import YAML from 'yaml'
import { config } from '../config.js'
import {
  dashboardAuthMiddleware,
  adminOnlyMiddleware,
  type AuthUser,
} from '../auth.js'
import {
  createUser,
  getUserById,
  listUsers,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  generateToken,
  revokeToken,
  listUserTokens,
  generateOAuthClient,
  revokeOAuthClient,
  listUserOAuthClients,
  logAction,
  queryAuditLog,
  listSessionRecords,
  getActiveSessionRecord,
  getDb,
} from '../db.js'
import { Layout, type LayoutUser } from './layout.js'
import { sessionManager } from '../session.js'
import { uploadToSession } from '../upload.js'

// Views
import { HomePage } from './views/home.js'
import { UsersPage } from './views/users.js'
import { TokensPage } from './views/tokens.js'
import { DataPage } from './views/data.js'
import { AuditPage } from './views/audit.js'
import { SessionsPage } from './views/sessions.js'
import { UploadPage } from './views/upload.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function getUser(c: any): LayoutUser {
  const u = c.get('user') as AuthUser
  // Try to fetch full user for name
  const full = getUserById(u.id)
  return {
    id: u.id,
    name: full?.name,
    email: u.email,
    role: u.role,
  }
}

function getSiteDb(mode: 'readonly' | 'readwrite' = 'readonly'): Database.Database | null {
  try {
    if (!fs.existsSync(config.SITE_DB_PATH)) return null
    return new Database(config.SITE_DB_PATH, { readonly: mode === 'readonly' })
  } catch (err) {
    console.error(`[admin] Failed to open site database: ${err}`)
    return null
  }
}

interface CollectionField {
  type: string
  required?: boolean
  options?: string[]
}

interface CollectionDef {
  fields: Record<string, CollectionField>
  access?: Record<string, string>
}

interface ModelsConfig {
  collections: Record<string, CollectionDef>
}

function loadModels(): ModelsConfig {
  const modelsPath = path.join(config.SITE_DIR, 'backend', 'models.yaml')
  if (!fs.existsSync(modelsPath)) {
    return { collections: {} }
  }
  const content = fs.readFileSync(modelsPath, 'utf-8')
  return YAML.parse(content) as ModelsConfig
}

// ── App ─────────────────────────────────────────────────────────────────────

const dashboard = new Hono()

// ── Static assets ───────────────────────────────────────────────────────────

dashboard.get('/assets/*', serveStatic({ root: './src/dashboard' }))

// ── Protected routes ────────────────────────────────────────────────────────

dashboard.use('/', dashboardAuthMiddleware)
dashboard.use('/admin/*', dashboardAuthMiddleware)

// ── Home ────────────────────────────────────────────────────────────────────

dashboard.get('/', (c) => {
  const user = getUser(c)
  const db = getDb()

  // Last publish time: most recent ended session with outcome 'published'
  const lastPublishRow = db.prepare(
    "SELECT ended_at FROM sessions WHERE outcome = 'published' ORDER BY ended_at DESC LIMIT 1"
  ).get() as { ended_at: string } | undefined

  // Active session
  const activeSession = getActiveSessionRecord()
  let activeSessionWithName: any = null
  if (activeSession) {
    const sessionUser = getUserById(activeSession.user_id)
    activeSessionWithName = { ...activeSession, user_name: sessionUser?.name }
  }

  // Recent audit
  const { entries } = queryAuditLog({ limit: 10 })
  const enrichedEntries = entries.map((e) => {
    const u = e.user_id ? getUserById(e.user_id) : null
    return { ...e, user_name: u?.name }
  })

  return c.html(
    <HomePage
      user={user}
      siteDomain={config.SITE_DOMAIN}
      lastPublish={lastPublishRow?.ended_at ?? null}
      activeSession={activeSessionWithName}
      recentAudit={enrichedEntries}
    />
  )
})

// ── Users (admin only) ──────────────────────────────────────────────────────

dashboard.use('/admin/users', adminOnlyMiddleware)
dashboard.get('/admin/users', (c) => {
  const user = getUser(c)
  const users = listUsers()
  return c.html(<UsersPage user={user} users={users} />)
})

dashboard.post('/admin/api/users', adminOnlyMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    const { name, email, password, role } = body
    if (!name || !email || !password) {
      return c.json({ error: 'Name, email, and password are required' }, 400)
    }
    if (password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400)
    }
    const newUser = await createUser(email, name, password, role || 'editor')
    const currentUser = c.get('user') as AuthUser
    logAction(currentUser.id, 'create_user', `Created user ${email} with role ${role || 'editor'}`)
    return c.json({ ok: true, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role } })
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'A user with that email already exists' }, 409)
    }
    return c.json({ error: 'Failed to create user' }, 500)
  }
})

dashboard.post('/admin/api/users/:id/role', adminOnlyMiddleware, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json()
  const { role } = body
  if (!role || !['admin', 'editor'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400)
  }
  updateUserRole(id, role)
  const currentUser = c.get('user') as AuthUser
  logAction(currentUser.id, 'update_role', `Changed user ${id} role to ${role}`)
  return c.json({ ok: true })
})

dashboard.post('/admin/api/users/:id/deactivate', adminOnlyMiddleware, async (c) => {
  const { id } = c.req.param()
  deactivateUser(id)
  const currentUser = c.get('user') as AuthUser
  logAction(currentUser.id, 'deactivate_user', `Deactivated user ${id}`)
  return c.json({ ok: true })
})

dashboard.post('/admin/api/users/:id/reactivate', adminOnlyMiddleware, async (c) => {
  const { id } = c.req.param()
  reactivateUser(id)
  const currentUser = c.get('user') as AuthUser
  logAction(currentUser.id, 'reactivate_user', `Reactivated user ${id}`)
  return c.json({ ok: true })
})

// ── Tokens ──────────────────────────────────────────────────────────────────

dashboard.get('/admin/tokens', (c) => {
  const user = getUser(c)
  const tokens = listUserTokens(user.id)
  const oauthClients = listUserOAuthClients(user.id)
  return c.html(<TokensPage user={user} tokens={tokens} oauthClients={oauthClients} />)
})

dashboard.post('/admin/api/tokens', async (c) => {
  const currentUser = c.get('user') as AuthUser
  const body = await c.req.json()
  const { label } = body
  if (!label || !label.trim()) {
    return c.json({ error: 'Label is required' }, 400)
  }
  const result = generateToken(currentUser.id, label.trim())
  logAction(currentUser.id, 'generate_token', `Generated token "${label.trim()}"`)
  return c.json({ ok: true, token: result.token, id: result.id })
})

dashboard.post('/admin/api/tokens/:id/revoke', async (c) => {
  const { id } = c.req.param()
  const currentUser = c.get('user') as AuthUser
  revokeToken(id)
  logAction(currentUser.id, 'revoke_token', `Revoked token ${id}`)
  return c.json({ ok: true })
})

// ── OAuth Clients ───────────────────────────────────────────────────────────

dashboard.post('/admin/api/oauth-clients', async (c) => {
  const currentUser = c.get('user') as AuthUser
  const body = await c.req.json()
  const { label } = body
  if (!label || !label.trim()) {
    return c.json({ error: 'Label is required' }, 400)
  }
  const result = await generateOAuthClient(currentUser.id, label.trim())
  logAction(currentUser.id, 'generate_oauth_client', `Generated OAuth client "${label.trim()}"`)
  return c.json({ ok: true, clientId: result.clientId, clientSecret: result.clientSecret, id: result.id })
})

dashboard.post('/admin/api/oauth-clients/:id/revoke', async (c) => {
  const { id } = c.req.param()
  const currentUser = c.get('user') as AuthUser
  revokeOAuthClient(id)
  logAction(currentUser.id, 'revoke_oauth_client', `Revoked OAuth client ${id}`)
  return c.json({ ok: true })
})

// ── Data Viewer ─────────────────────────────────────────────────────────────

dashboard.get('/admin/data', (c) => {
  const user = getUser(c)
  const models = loadModels()
  const collectionNames = Object.keys(models.collections || {})
  const collections = collectionNames.map((name) => ({
    name,
    fields: models.collections[name].fields,
  }))

  const activeCollection = c.req.query('collection') || (collectionNames.length > 0 ? collectionNames[0] : null)
  const page = parseInt(c.req.query('page') || '1')
  const sort = c.req.query('sort') || 'id'
  const dir = c.req.query('dir') === 'desc' ? 'DESC' : 'ASC'
  const perPage = 25

  let records: Record<string, unknown>[] = []
  let columns: string[] = []
  let total = 0
  let totalPages = 0

  if (activeCollection) {
    const siteDb = getSiteDb()
    if (siteDb) {
      try {
        // Check if table exists
        const tableCheck = siteDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(activeCollection) as { name: string } | undefined

        if (tableCheck) {
          // Get column info
          const colInfo = siteDb.prepare(`PRAGMA table_info("${activeCollection}")`).all() as { name: string }[]

          const models = loadModels()
          const collectionDef = models.collections[activeCollection]
          const modelFields = collectionDef?.fields || {}
          const hasDataColumn = colInfo.some((c: { name: string }) => c.name === 'data')

          // Determine display columns: if there's a 'data' JSON column, use model fields; otherwise use table columns
          const displayColumns = hasDataColumn && Object.keys(modelFields).length > 0
            ? ['id', ...Object.keys(modelFields), 'created_at', 'updated_at']
            : columns

          // Count
          const countRow = siteDb.prepare(`SELECT COUNT(*) as count FROM "${activeCollection}"`).get() as { count: number }
          total = countRow.count
          totalPages = Math.ceil(total / perPage)

          // Validate sort column
          const sortCol = displayColumns.includes(sort) ? sort : 'id'
          const offset = (page - 1) * perPage
          const rawRecords = siteDb.prepare(
            `SELECT * FROM "${activeCollection}" ORDER BY "${sortCol}" ${dir} LIMIT ? OFFSET ?`
          ).all(perPage, offset) as Record<string, unknown>[]

          // If there's a data column, parse it and flatten into the record
          records = rawRecords.map((row) => {
            if (hasDataColumn && typeof row.data === 'string') {
              try {
                const parsed = JSON.parse(row.data)
                const { data: _, ...rest } = row
                return { ...rest, ...parsed }
              } catch {
                return row
              }
            }
            return row
          })

          columns.length = 0
          columns.push(...displayColumns)
        }
      } catch {
        // Table doesn't exist or other error
      } finally {
        siteDb.close()
      }
    }
  }

  return c.html(
    <DataPage
      user={user}
      collections={collections}
      activeCollection={activeCollection}
      records={records}
      columns={columns}
      page={page}
      totalPages={totalPages}
      total={total}
    />
  )
})

dashboard.get('/admin/api/data/:collection', (c) => {
  const { collection } = c.req.param()
  const page = parseInt(c.req.query('page') || '1')
  const perPage = parseInt(c.req.query('perPage') || '25')
  const sort = c.req.query('sort') || 'id'
  const dir = c.req.query('dir') === 'desc' ? 'DESC' : 'ASC'

  const siteDb = getSiteDb()
  if (!siteDb) {
    return c.json({ error: 'Site database not available' }, 500)
  }

  try {
    const tableCheck = siteDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(collection)
    if (!tableCheck) {
      return c.json({ error: 'Collection not found' }, 404)
    }

    const colInfo = siteDb.prepare(`PRAGMA table_info("${collection}")`).all() as { name: string }[]
    const columns = colInfo.map((col) => col.name)
    const sortCol = columns.includes(sort) ? sort : 'id'

    const countRow = siteDb.prepare(`SELECT COUNT(*) as count FROM "${collection}"`).get() as { count: number }
    const offset = (page - 1) * perPage
    const records = siteDb.prepare(
      `SELECT * FROM "${collection}" ORDER BY "${sortCol}" ${dir} LIMIT ? OFFSET ?`
    ).all(perPage, offset)

    return c.json({ records, total: countRow.count, page, perPage, columns })
  } finally {
    siteDb.close()
  }
})

dashboard.patch('/admin/api/data/:collection/:id', async (c) => {
  const { collection, id } = c.req.param()
  const body = await c.req.json()
  const currentUser = c.get('user') as AuthUser

  const siteDb = getSiteDb('readwrite')
  if (!siteDb) {
    return c.json({ error: 'Site database not available' }, 500)
  }

  try {
    const tableCheck = siteDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(collection)
    if (!tableCheck) {
      return c.json({ error: 'Collection not found' }, 404)
    }

    // Only allow updating specific safe fields
    const colInfo = siteDb.prepare(`PRAGMA table_info("${collection}")`).all() as { name: string }[]
    const validColumns = colInfo.map((col) => col.name)

    const updates: string[] = []
    const values: unknown[] = []

    for (const [key, value] of Object.entries(body)) {
      if (validColumns.includes(key) && key !== 'id') {
        updates.push(`"${key}" = ?`)
        values.push(value)
      }
    }

    if (updates.length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400)
    }

    values.push(id)
    siteDb.prepare(
      `UPDATE "${collection}" SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values)

    logAction(currentUser.id, 'update_record', `Updated ${collection}/${id}: ${JSON.stringify(body)}`)
    return c.json({ ok: true })
  } finally {
    siteDb.close()
  }
})

dashboard.get('/admin/api/data/:collection/csv', (c) => {
  const { collection } = c.req.param()

  const siteDb = getSiteDb()
  if (!siteDb) {
    return c.json({ error: 'Site database not available' }, 500)
  }

  try {
    const tableCheck = siteDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(collection)
    if (!tableCheck) {
      return c.json({ error: 'Collection not found' }, 404)
    }

    const colInfo = siteDb.prepare(`PRAGMA table_info("${collection}")`).all() as { name: string }[]
    const hasDataColumn = colInfo.some((c: { name: string }) => c.name === 'data')

    const models = loadModels()
    const collectionDef = models.collections[collection]
    const modelFields = collectionDef?.fields || {}

    // Determine columns: if there's a data column, use model field names; otherwise use table columns
    const columns = hasDataColumn && Object.keys(modelFields).length > 0
      ? ['id', ...Object.keys(modelFields), 'created_at', 'updated_at']
      : colInfo.map((c: { name: string }) => c.name)

    const rawRecords = siteDb.prepare(`SELECT * FROM "${collection}" ORDER BY id`).all() as Record<string, unknown>[]

    // Flatten data JSON column if present
    const records = rawRecords.map((row) => {
      if (hasDataColumn && typeof row.data === 'string') {
        try {
          const parsed = JSON.parse(row.data)
          const { data: _, ...rest } = row
          return { ...rest, ...parsed }
        } catch {
          return row
        }
      }
      return row
    })

    // Build CSV
    const escapeCsv = (val: unknown): string => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    }

    let csv = columns.join(',') + '\n'
    for (const row of records) {
      csv += columns.map((col) => escapeCsv(row[col])).join(',') + '\n'
    }

    c.header('Content-Type', 'text/csv')
    c.header('Content-Disposition', `attachment; filename="${collection}.csv"`)
    return c.body(csv)
  } finally {
    siteDb.close()
  }
})

// ── Audit Log ───────────────────────────────────────────────────────────────

dashboard.get('/admin/audit', (c) => {
  const user = getUser(c)
  const page = parseInt(c.req.query('page') || '1')
  const perPage = 50
  const filters = {
    userId: c.req.query('userId') || undefined,
    action: c.req.query('action') || undefined,
    from: c.req.query('from') || undefined,
    to: c.req.query('to') || undefined,
  }

  const { entries, total } = queryAuditLog({
    ...filters,
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  const enrichedEntries = entries.map((e) => {
    const u = e.user_id ? getUserById(e.user_id) : null
    return { ...e, user_name: u?.name }
  })

  // Get distinct users and actions for filter dropdowns
  const db = getDb()
  const allUsers = listUsers().map((u) => ({ id: u.id, name: u.name, email: u.email }))
  const allActions = (db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all() as { action: string }[]).map((r) => r.action)

  const totalPages = Math.ceil(total / perPage)

  return c.html(
    <AuditPage
      user={user}
      entries={enrichedEntries}
      total={total}
      page={page}
      totalPages={totalPages}
      users={allUsers}
      actions={allActions}
      filters={filters}
    />
  )
})

// ── Sessions ────────────────────────────────────────────────────────────────

dashboard.get('/admin/sessions', (c) => {
  const user = getUser(c)
  const page = parseInt(c.req.query('page') || '1')
  const perPage = 50

  const { records, total } = listSessionRecords({
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  const db = getDb()
  const enrichedRecords = records.map((rec) => {
    const u = getUserById(rec.user_id)
    // Count audit actions during the session window
    let actionCount = 0
    try {
      const countRow = db.prepare(
        `SELECT COUNT(*) as count FROM audit_log WHERE user_id = ? AND created_at >= ? AND (? IS NULL OR created_at <= ?)`
      ).get(rec.user_id, rec.started_at, rec.ended_at, rec.ended_at) as { count: number }
      actionCount = countRow.count
    } catch {
      // ignore
    }
    return { ...rec, user_name: u?.name, action_count: actionCount }
  })

  const totalPages = Math.ceil(total / perPage)

  return c.html(
    <SessionsPage
      user={user}
      records={enrichedRecords}
      total={total}
      page={page}
      totalPages={totalPages}
    />
  )
})

// ── Session Upload ──────────────────────────────────────────────────────────

dashboard.get('/session/:sessionId/upload', (c) => {
  const user = getUser(c)
  const { sessionId } = c.req.param()

  // Verify session exists and is active
  const status = sessionManager.getStatus()
  if (!status || status.sessionId !== sessionId) {
    return c.html(
      <Layout title="Upload" user={user} activePath="">
        <div class="card">
          <h2>Session Not Found</h2>
          <p class="text-muted">
            This upload URL is no longer valid. The session may have ended or does not exist.
          </p>
          <a href="/" class="button mt-4">Return to Dashboard</a>
        </div>
      </Layout>
    )
  }

  // Check user owns the session
  if (status.userId !== user.id) {
    return c.html(
      <Layout title="Upload" user={user} activePath="">
        <div class="card">
          <h2>Access Denied</h2>
          <p class="text-muted">
            This upload session belongs to another user.
          </p>
          <a href="/" class="button mt-4">Return to Dashboard</a>
        </div>
      </Layout>
    )
  }

  return c.html(
    <UploadPage
      user={user}
      sessionId={sessionId}
      previewUrl={status.previewUrl}
    />
  )
})

dashboard.post('/session/:sessionId/upload', async (c) => {
  const user = getUser(c)
  const { sessionId } = c.req.param()

  // Verify session exists and is active
  const status = sessionManager.getStatus()
  if (!status || status.sessionId !== sessionId) {
    return c.json({ error: 'Session not found or no longer active' }, 404)
  }

  // Check user owns the session
  if (status.userId !== user.id) {
    return c.json({ error: 'Access denied' }, 403)
  }

  try {
    const body = await c.req.parseBody()
    const file = body['file'] as File

    if (!file) {
      return c.json({ error: 'No file provided' }, 400)
    }

    const result = await uploadToSession(file, {
      id: user.id,
      name: user.name || user.email,
      email: user.email,
    })

    // Redirect back to upload page with success
    return c.html(
      <UploadPage
        user={user}
        sessionId={sessionId}
        previewUrl={status.previewUrl}
        uploadedFile={result}
      />
    )
  } catch (err) {
    console.error('[upload] Upload failed:', err)
    return c.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      500
    )
  }
})

export { dashboard as dashboardRoutes }

import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { initDb, getUserByEmail, logAction } from './db.js'
import {
  verifyPassword,
  createJWT,
  setSessionCookie,
  clearSessionCookie,
  mcpTokenAuthMiddleware,
} from './auth.js'
import { createMcpRoutes } from './mcp.js'
import { registerShutdownHandlers } from './session.js'
import { dashboardRoutes } from './dashboard/routes.js'

// ── Initialize database on startup ─────────────────────────────────────────

initDb()
console.log('Database initialized')

// ── App ────────────────────────────────────────────────────────────────────

const app = new Hono()

app.use('*', logger())

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// ── Auth API (public) ──────────────────────────────────────────────────────

app.post('/admin/api/login', async (c) => {
  try {
    const body = await c.req.json()
    const { email, password } = body

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    const user = getUserByEmail(email)
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    if (user.deactivated_at) {
      return c.json({ error: 'Account is deactivated' }, 403)
    }

    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    const token = createJWT(user)
    setSessionCookie(c, token)

    logAction(user.id, 'login', `Dashboard login for ${user.email}`)

    return c.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    })
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }
})

app.post('/admin/api/logout', (c) => {
  clearSessionCookie(c)
  return c.json({ ok: true })
})

// ── Dashboard routes (server-rendered HTML) ───────────────────────────────

app.route('/', dashboardRoutes)

// ── MCP SSE transport ──────────────────────────────────────────────────────

const mcpRoutes = createMcpRoutes()
app.route('/', mcpRoutes)

// ── Start server ───────────────────────────────────────────────────────────

// ── Graceful shutdown ──────────────────────────────────────────────────────

registerShutdownHandlers()

// ── Start server ───────────────────────────────────────────────────────────

const port = parseInt(config.ADMIN_PORT || '3100')
console.log(`Admin server starting on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}

import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { initDb, getUserByEmail, logAction, validateOAuthClient } from './db.js'
import {
  verifyPassword,
  createJWT,
  setSessionCookie,
  clearSessionCookie,
  mcpTokenAuthMiddleware,
  createOAuthAccessToken,
} from './auth.js'
import { createMcpRoutes } from './mcp.js'
import { registerShutdownHandlers } from './session.js'
import { dashboardRoutes } from './dashboard/routes.js'
import { LoginPage } from './dashboard/views/login.js'

// ── Initialize database on startup ─────────────────────────────────────────

initDb()
console.log('Database initialized')

// ── App ────────────────────────────────────────────────────────────────────

const app = new Hono()

app.use('*', logger())

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

// ── Auth (public) ──────────────────────────────────────────────────────────

app.get('/login', (c) => {
  const error = c.req.query('error') || ''
  return c.html(<LoginPage error={error} />)
})

app.post('/login', async (c) => {
  const formData = await c.req.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return c.redirect('/login?error=Email+and+password+are+required')
  }

  const user = getUserByEmail(email)
  if (!user) {
    return c.redirect('/login?error=Invalid+credentials')
  }

  if (user.deactivated_at) {
    return c.redirect('/login?error=Account+is+deactivated')
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.redirect('/login?error=Invalid+credentials')
  }

  const token = createJWT(user)
  setSessionCookie(c, token)

  logAction(user.id, 'login', `Dashboard login for ${user.email}`)

  return c.redirect('/')
})

app.post('/logout', (c) => {
  clearSessionCookie(c)
  return c.redirect('/login')
})

// ── OAuth 2.0 Token Endpoint ──────────────────────────────────────────────

app.post('/oauth/token', async (c) => {
  console.log('[OAuth] POST /oauth/token - Incoming request')
  console.log('[OAuth] Headers:', Object.fromEntries(c.req.raw.headers.entries()))

  try {
    const body = await c.req.json()
    console.log('[OAuth] Request body:', {
      grant_type: body.grant_type,
      client_id: body.client_id,
      has_secret: !!body.client_secret
    })
    const { client_id, client_secret, grant_type } = body

    // Validate grant_type (OAuth 2.0 Client Credentials)
    if (grant_type && grant_type !== 'client_credentials') {
      console.log('[OAuth] Invalid grant_type:', grant_type)
      return c.json(
        {
          error: 'unsupported_grant_type',
          error_description: 'Only client_credentials grant type is supported',
        },
        400
      )
    }

    // Validate required fields
    if (!client_id || !client_secret) {
      return c.json(
        {
          error: 'invalid_request',
          error_description: 'client_id and client_secret are required',
        },
        400
      )
    }

    // Validate the OAuth client credentials
    const user = await validateOAuthClient(client_id, client_secret)
    if (!user) {
      return c.json(
        {
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        },
        401
      )
    }

    // Generate access token
    const tokenResponse = createOAuthAccessToken(user)

    // Log the OAuth token generation
    logAction(user.id, 'oauth.token', `OAuth token generated for client ${client_id}`)

    return c.json(tokenResponse)
  } catch (err) {
    console.error('OAuth token error:', err)
    return c.json(
      {
        error: 'server_error',
        error_description: 'An error occurred while processing the request',
      },
      500
    )
  }
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

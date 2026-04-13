import crypto from 'crypto'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { registerFileTools } from './tools/files.js'
import { registerSessionTools } from './tools/session.js'
import { validateToken } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

interface AuthenticatedUser {
  id: string
  name: string
  email: string
}

/**
 * A custom Transport that bridges Hono SSE streaming with the MCP protocol.
 * - `send()` writes JSON-RPC messages to the SSE stream
 * - `handleIncoming()` feeds POST-received messages into the MCP server
 */
class SSEBridgeTransport implements Transport {
  sessionId: string
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  private _sendEvent: ((event: string, data: string) => void) | null = null
  private _closed = false

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  /** Called by the SSE handler once the stream is ready */
  setSendEvent(fn: (event: string, data: string) => void): void {
    this._sendEvent = fn
  }

  async start(): Promise<void> {
    // No-op; the SSE stream is already established when we call connect()
  }

  async close(): Promise<void> {
    this._closed = true
    this._sendEvent = null
    this.onclose?.()
  }

  /** Called by the MCP server to send a JSON-RPC response/notification to the client */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed || !this._sendEvent) return
    this._sendEvent('message', JSON.stringify(message))
  }

  /** Called by our POST handler to feed incoming messages to the MCP server */
  handleIncoming(message: JSONRPCMessage): void {
    if (this._closed) return
    this.onmessage?.(message)
  }

  get closed(): boolean {
    return this._closed
  }

  markClosed(): void {
    this._closed = true
  }
}

// ── Connection store ───────────────────────────────────────────────────────

interface Connection {
  transport: SSEBridgeTransport
  mcpServer: McpServer
  user: AuthenticatedUser | null
}

const connections = new Map<string, Connection>()

// ── MCP Server factory ─────────────────────────────────────────────────────

function createMcpServer(
  getUser: () => AuthenticatedUser | null
): McpServer {
  const server = new McpServer(
    {
      name: 'Launchpod',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  registerFileTools(server, getUser)
  registerSessionTools(server, getUser)

  return server
}

// ── Auth helper ────────────────────────────────────────────────────────────

async function extractUser(authHeader: string | undefined): Promise<AuthenticatedUser | null> {
  if (!authHeader) return null

  // Check for Basic Auth (OAuth client_id:client_secret)
  if (authHeader.startsWith('Basic ')) {
    const base64Credentials = authHeader.slice(6)
    try {
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
      const [clientId, clientSecret] = credentials.split(':')
      console.log('[MCP Auth] Basic Auth detected, client_id:', clientId?.substring(0, 10) + '...')

      if (clientId && clientSecret) {
        const { validateOAuthClient } = await import('./db.js')
        const user = await validateOAuthClient(clientId, clientSecret)
        if (user) {
          console.log('[MCP Auth] Valid OAuth client for user:', user.email)
          return { id: user.id, name: user.name, email: user.email }
        }
      }
    } catch (err) {
      console.log('[MCP Auth] Basic Auth parsing failed:', err)
      return null
    }
  }

  // Check for Bearer token
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  if (!token) return null

  try {
    const user = validateToken(token)
    if (!user) return null
    return { id: user.id, name: user.name, email: user.email }
  } catch {
    return null
  }
}

// ── Hono route factory ─────────────────────────────────────────────────────

export function createMcpRoutes(): Hono {
  const app = new Hono()

  // ── GET /sse - Establish SSE connection and MCP session ──────────────

  app.get('/sse', async (c) => {
    console.log('[MCP SSE] New SSE connection request')
    console.log('[MCP SSE] ALL HEADERS:', JSON.stringify(Object.fromEntries(c.req.raw.headers.entries()), null, 2))
    const authHeader = c.req.header('Authorization')
    console.log('[MCP SSE] Auth header:', authHeader ? authHeader.substring(0, 20) + '...' : 'MISSING')

    let user = await extractUser(authHeader)

    // If no user extracted and MCP_PROXY_AUTH is enabled, create a default user
    // This allows the MCP proxy to handle authentication
    if (!user && process.env.MCP_PROXY_AUTH === 'true') {
      console.log('[MCP SSE] MCP_PROXY_AUTH enabled - using default user')
      const { getUserByEmail } = await import('./db.js')
      const defaultUser = getUserByEmail(process.env.ADMIN_EMAIL!);
      if (defaultUser) {
        user = { id: defaultUser.id, name: defaultUser.name, email: defaultUser.email }
        console.log('[MCP SSE] Default user set:', user.email)
      } else {
        console.log('[MCP SSE] ERROR: Could not find default user admin@localhost')
      }
    }

    console.log('[MCP SSE] Final user for connection:', user ? user.email : 'NONE')

    if (!user) {
      console.log('[MCP SSE] ERROR: No user available - tools will fail')
    }

    const sessionId = crypto.randomBytes(16).toString('hex')
    const transport = new SSEBridgeTransport(sessionId)

    // Create the MCP server. The getUser closure reads from the connection.
    const conn: Connection = {
      transport,
      mcpServer: null as unknown as McpServer,
      user,
    }
    const mcpServer = createMcpServer(() => conn.user)
    conn.mcpServer = mcpServer
    connections.set(sessionId, conn)

    return streamSSE(c, async (stream) => {
      // Wire the transport's send to the SSE stream
      transport.setSendEvent((event: string, data: string) => {
        stream.writeSSE({ event, data }).catch(() => {
          transport.markClosed()
        })
      })

      // Send the endpoint event so the MCP client knows where to POST
      const messagesUrl = `/messages?sessionId=${sessionId}`
      await stream.writeSSE({ event: 'endpoint', data: messagesUrl })

      // Connect the MCP server to our transport (sets up onmessage, etc.)
      await mcpServer.connect(transport)

      // Handle stream abort
      stream.onAbort(() => {
        transport.markClosed()
        connections.delete(sessionId)
        mcpServer.close().catch(() => {})
      })

      // Keep the SSE stream alive with periodic pings
      while (!transport.closed) {
        await new Promise((resolve) => setTimeout(resolve, 30_000))
        if (!transport.closed) {
          try {
            await stream.writeSSE({ event: 'ping', data: '' })
          } catch {
            transport.markClosed()
          }
        }
      }
    })
  })

  // ── POST /messages - Receive JSON-RPC messages from the client ───────

  app.post('/messages', async (c) => {
    console.log('[MCP Messages] Incoming message')
    const sessionId = c.req.query('sessionId')
    console.log('[MCP Messages] Session ID:', sessionId)
    if (!sessionId) {
      return c.json({ error: 'Missing sessionId query parameter' }, 400)
    }

    const conn = connections.get(sessionId)
    if (!conn) {
      console.log('[MCP Messages] Session not found')
      return c.json({ error: 'Invalid or expired session' }, 404)
    }

    // Update auth if provided
    const authHeader = c.req.header('Authorization')
    console.log('[MCP Messages] Auth header:', authHeader ? authHeader.substring(0, 20) + '...' : 'MISSING')
    if (authHeader) {
      const updatedUser = await extractUser(authHeader)
      console.log('[MCP Messages] Updated user:', updatedUser ? updatedUser.email : 'NONE')
      if (updatedUser) conn.user = updatedUser
    }

    // If still no user and MCP_PROXY_AUTH is enabled, use default user
    if (!conn.user && process.env.MCP_PROXY_AUTH === 'true') {
      console.log('[MCP Messages] MCP_PROXY_AUTH enabled - using default user')
      const { getUserByEmail } = await import('./db.js')
      const defaultUser = getUserByEmail('admin@localhost')
      if (defaultUser) {
        conn.user = { id: defaultUser.id, name: defaultUser.name, email: defaultUser.email }
      }
    }

    try {
      const body = await c.req.json()

      // Handle single message or batch
      if (Array.isArray(body)) {
        for (const msg of body) {
          conn.transport.handleIncoming(msg as JSONRPCMessage)
        }
      } else {
        conn.transport.handleIncoming(body as JSONRPCMessage)
      }

      // The response goes through the SSE stream, so we return 202
      return c.text('Accepted', 202)
    } catch (err) {
      return c.json(
        { error: `Failed to process message: ${err instanceof Error ? err.message : String(err)}` },
        400
      )
    }
  })

  return app
}

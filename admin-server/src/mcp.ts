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
      name: 'launchpod-admin',
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

function extractUser(authHeader: string | undefined): AuthenticatedUser | null {
  if (!authHeader) return null

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

  app.get('/sse', (c) => {
    const authHeader = c.req.header('Authorization')
    const user = extractUser(authHeader)

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
    const sessionId = c.req.query('sessionId')
    if (!sessionId) {
      return c.json({ error: 'Missing sessionId query parameter' }, 400)
    }

    const conn = connections.get(sessionId)
    if (!conn) {
      return c.json({ error: 'Invalid or expired session' }, 404)
    }

    // Update auth if provided
    const authHeader = c.req.header('Authorization')
    if (authHeader) {
      const updatedUser = extractUser(authHeader)
      if (updatedUser) conn.user = updatedUser
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

import { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import bcrypt from 'bcrypt'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { config } from './config.js'
import { validateToken } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface JWTPayload {
  sub: string
  email: string
  role: 'admin' | 'editor'
  iat?: number
  exp?: number
}

export interface AuthUser {
  id: string
  email: string
  role: 'admin' | 'editor'
}

// ── Password helpers ───────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ── JWT helpers ────────────────────────────────────────────────────────────

export function createJWT(user: { id: string; email: string; role: string }): string {
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    role: user.role as 'admin' | 'editor',
  }

  const signOpts: SignOptions = {
    expiresIn: config.JWT_EXPIRATION as unknown as SignOptions['expiresIn'],
  }
  return jwt.sign(payload, config.JWT_SECRET, signOpts)
}

export function verifyJWT(token: string): JWTPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload
  return decoded
}

/**
 * Create an OAuth access token (JWT) for a user.
 * Used by the OAuth token endpoint.
 */
export function createOAuthAccessToken(user: { id: string; email: string; role: string }): {
  access_token: string
  token_type: string
  expires_in: number
} {
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    role: user.role as 'admin' | 'editor',
  }

  const expiresInSeconds = 3600 // 1 hour
  const signOpts: SignOptions = {
    expiresIn: expiresInSeconds,
  }
  const token = jwt.sign(payload, config.JWT_SECRET, signOpts)

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresInSeconds,
  }
}

// ── Cookie helpers ─────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production'

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, 'session', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, 'session', {
    path: '/',
  })
}

// ── Middleware ──────────────────────────────────────────────────────────────

/**
 * Dashboard auth middleware.
 * Checks the httpOnly "session" cookie for a valid JWT.
 * Attaches the user to context. Redirects to /login if invalid.
 */
export async function dashboardAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const sessionToken = getCookie(c, 'session')

  if (!sessionToken) {
    return c.redirect('/login')
  }

  try {
    const payload = verifyJWT(sessionToken)
    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    }
    c.set('user', user)
    await next()
  } catch {
    clearSessionCookie(c)
    return c.redirect('/login')
  }
}

/**
 * MCP token auth middleware.
 * Extracts Bearer token from Authorization header and validates it.
 * Accepts both:
 * - MCP tokens (from the tokens table)
 * - OAuth JWT tokens (from the OAuth flow)
 * Attaches user to context. Returns 401 if invalid.
 */
export async function mcpTokenAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')

  console.log('[Auth] MCP request to:', c.req.path)
  console.log('[Auth] Authorization header:', authHeader ? authHeader.substring(0, 20) + '...' : 'MISSING')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[Auth] No Bearer token found')
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  console.log('[Auth] Token length:', token.length)
  console.log('[Auth] Token prefix:', token.substring(0, 10) + '...')

  // Try to validate as JWT first (OAuth tokens)
  try {
    const payload = verifyJWT(token)
    console.log('[Auth] Valid JWT token for user:', payload.email)
    const authUser: AuthUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    }
    c.set('user', authUser)
    return await next()
  } catch (err) {
    console.log('[Auth] Not a valid JWT, trying MCP token...')
  }

  // Try to validate as MCP token
  const user = validateToken(token)
  if (!user) {
    console.log('[Auth] Token validation failed - not JWT and not MCP token')
    return c.json({ error: 'Invalid or revoked token' }, 401)
  }

  console.log('[Auth] Valid MCP token for user:', user.email)
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
  }
  c.set('user', authUser)
  await next()
}

/**
 * Admin-only middleware.
 * Must be used after an auth middleware that sets 'user' on context.
 * Returns 403 if user is not an admin.
 */
export async function adminOnlyMiddleware(c: Context, next: Next): Promise<Response | void> {
  const user = c.get('user') as AuthUser | undefined

  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403)
  }

  await next()
}

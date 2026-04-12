import path from 'path'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue
}

// In development, provide sensible defaults
const isDev = process.env.NODE_ENV !== 'production'

export const config = {
  SITE_DIR: isDev ? optionalEnv('SITE_DIR', path.resolve('../site-template')) : requireEnv('SITE_DIR'),
  PREVIEWS_DIR: isDev ? optionalEnv('PREVIEWS_DIR', path.resolve('../previews')) : requireEnv('PREVIEWS_DIR'),
  SITE_DOMAIN: optionalEnv('SITE_DOMAIN', 'localhost'),
  ADMIN_PORT: optionalEnv('ADMIN_PORT', '3100'),
  ADMIN_DB_PATH: isDev ? optionalEnv('ADMIN_DB_PATH', path.resolve('../data/admin.db')) : requireEnv('ADMIN_DB_PATH'),
  SITE_DB_PATH: isDev ? optionalEnv('SITE_DB_PATH', path.resolve('../data/site.db')) : requireEnv('SITE_DB_PATH'),
  CADDY_ADMIN_URL: optionalEnv('CADDY_ADMIN_URL', 'http://localhost:2019'),
  JWT_SECRET: optionalEnv('JWT_SECRET', 'dev-secret-change-in-production'),
  JWT_EXPIRATION: optionalEnv('JWT_EXPIRATION', '24h'),
  SESSION_TIMEOUT_MINUTES: parseInt(optionalEnv('SESSION_TIMEOUT_MINUTES', '30')),
}

// Path validation
const WRITABLE_DIRS = [
  'src/pages',
  'src/content',
  'src/components',
  'src/layouts',
  'src/styles',
  'public/assets',
  'backend',
]

const LOCKED_FILES = [
  'astro.config.mjs',
  'package.json',
  'package-lock.json',
  'bun.lockb',
  'tsconfig.json',
]

const LOCKED_DIRS = [
  'node_modules',
  '.git',
  'data',
  'dist',
]

export function validatePath(
  filePath: string,
  siteDir: string,
  options: { requireWritable?: boolean } = {}
): { valid: boolean; resolved: string; error?: string } {
  // Normalize and resolve the path
  const normalized = path.normalize(filePath).replace(/\\/g, '/')

  // Prevent traversal
  if (normalized.includes('..')) {
    return { valid: false, resolved: '', error: 'Path traversal not allowed' }
  }

  const resolved = path.resolve(siteDir, normalized)
  const relative = path.relative(siteDir, resolved).replace(/\\/g, '/')

  // Must be within site directory
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { valid: false, resolved, error: 'Path is outside the project directory' }
  }

  // Check locked directories
  for (const dir of LOCKED_DIRS) {
    if (relative.startsWith(dir + '/') || relative === dir) {
      return { valid: false, resolved, error: `Access to ${dir}/ is not allowed` }
    }
  }

  // Check locked files
  if (LOCKED_FILES.includes(relative)) {
    return { valid: false, resolved, error: `File ${relative} is locked and cannot be modified` }
  }

  // Check writable directories if required
  if (options.requireWritable) {
    const isWritable = WRITABLE_DIRS.some(
      (dir) => relative.startsWith(dir + '/') || relative === dir
    )
    if (!isWritable) {
      return { valid: false, resolved, error: `File is not in a writable directory. Writable directories: ${WRITABLE_DIRS.join(', ')}` }
    }
  }

  return { valid: true, resolved }
}

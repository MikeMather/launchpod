import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'node:child_process'
import { sessionManager } from './session.js'
import { logAction } from './db.js'

const MAX_SIZE = 10 * 1024 * 1024 // 10MB

export interface UploadResult {
  url: string
  path: string
  filename: string
}

export async function uploadToSession(
  file: File,
  user: { id: string; name: string; email: string }
): Promise<UploadResult> {
  // Validate file size
  if (file.size > MAX_SIZE) {
    const maxMB = MAX_SIZE / 1024 / 1024
    const fileMB = (file.size / 1024 / 1024).toFixed(2)
    throw new Error(`File too large: ${fileMB}MB. Maximum allowed: ${maxMB}MB`)
  }

  // Get worktree path
  const worktreePath = sessionManager.getWorkingDir()
  const assetsDir = path.join(worktreePath, 'public/assets')

  // Create assets directory if it doesn't exist
  fs.mkdirSync(assetsDir, { recursive: true })

  // Generate unique filename
  const ext = path.extname(file.name) || ''
  const hash = crypto.randomBytes(4).toString('hex')
  const timestamp = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  const sanitized = file.name
    .replace(ext, '')
    .replace(/[^a-z0-9-_]/gi, '-')
    .toLowerCase()
    .slice(0, 30)
  const filename = `${timestamp}-${sanitized}-${hash}${ext}`

  // Write file
  const filePath = path.join(assetsDir, filename)
  const buffer = await file.arrayBuffer()
  fs.writeFileSync(filePath, Buffer.from(buffer))

  // Auto-commit to preview branch
  const relativePath = path.relative(worktreePath, filePath).replace(/\\/g, '/')
  try {
    execSync(`git add "${relativePath}"`, {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout: 10_000,
    })

    // Check if there's anything to commit
    try {
      execSync('git diff --cached --quiet', { cwd: worktreePath, encoding: 'utf-8' })
      // Nothing to commit
    } catch {
      // There are staged changes, commit them
      execSync(
        `git -c user.name="${user.name}" -c user.email="${user.email}" commit -m "upload: ${filename}"`,
        { cwd: worktreePath, encoding: 'utf-8', timeout: 10_000 }
      )
    }
  } catch (err) {
    console.warn(`[upload] Auto-commit failed: ${err}`)
  }

  // Log action
  logAction(user.id, 'file.upload', `assets/${filename}`)

  // Return URL (will work after publish)
  const publicUrl = `/assets/${filename}`

  return {
    url: publicUrl,
    path: `public/assets/${filename}`,
    filename,
  }
}

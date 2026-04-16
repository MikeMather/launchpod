import { spawn, spawnSync, type ChildProcess, execFileSync } from 'node:child_process'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { config } from './config.js'
import {
  createSessionRecord,
  endSessionRecord,
  logAction,
} from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface SessionState {
  sessionId: string
  branch: string
  worktreePath: string
  previewPort: number
  previewProcess: ChildProcess | null
  previewUrl: string
  userId: string
  startedAt: Date
  lastActivityAt: Date
}

export interface SessionStatus {
  sessionId: string
  branch: string
  previewUrl: string
  userId: string
  startedAt: string
  lastActivityAt: string
  worktreePath: string
  previewPort: number
}

// ── Git helpers ────────────────────────────────────────────────────────────

function gitExec(
  args: string[],
  cwd: string,
  env?: Record<string, string>
): string {
  // Use execFileSync which resolves PATH correctly
  const output = execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  })

  return (output || '').trim()
}

function createBranch(name: string): void {
  gitExec(['checkout', '-b', name], config.SITE_DIR)
  // Go back to main so the worktree can use the branch
  gitExec(['checkout', 'main'], config.SITE_DIR)
}

function createWorktree(worktreePath: string, branch: string): void {
  gitExec(['worktree', 'add', worktreePath, branch], config.SITE_DIR)
}

function removeWorktree(worktreePath: string): void {
  try {
    gitExec(['worktree', 'remove', worktreePath, '--force'], config.SITE_DIR)
  } catch (err) {
    console.warn(`[session] Failed to remove worktree via git, cleaning up manually: ${err}`)
    // Manual cleanup as fallback
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true })
      gitExec(['worktree', 'prune'], config.SITE_DIR)
    } catch (cleanupErr) {
      console.warn(`[session] Manual worktree cleanup also failed: ${cleanupErr}`)
    }
  }
}

function stageAndCommit(
  message: string,
  cwd: string,
  userName: string,
  userEmail: string
): void {
  gitExec(['add', '-A'], cwd)

  // Check if there's anything to commit
  try {
    gitExec(['diff', '--cached', '--quiet'], cwd)
    // If no error, nothing staged - skip commit
    return
  } catch {
    // There are staged changes, proceed with commit
  }

  gitExec(
    [
      '-c', `user.name="${userName}"`,
      '-c', `user.email="${userEmail}"`,
      'commit', '-m', `"${message.replace(/"/g, '\\"')}"`,
    ],
    cwd
  )
}

function mergeBranch(
  branch: string,
  userName: string,
  userEmail: string
): void {
  gitExec(
    [
      '-c', `user.name="${userName}"`,
      '-c', `user.email="${userEmail}"`,
      'merge', '--no-ff', branch,
    ],
    config.SITE_DIR
  )
}

function deleteBranch(name: string): void {
  try {
    gitExec(['branch', '-D', name], config.SITE_DIR)
  } catch (err) {
    console.warn(`[session] Failed to delete branch ${name}: ${err}`)
  }
}

function resetHard(commitHash: string, cwd: string): void {
  gitExec(['reset', '--hard', commitHash], cwd)
}

// ── Caddy integration ──────────────────────────────────────────────────────

async function addCaddyRoute(sessionId: string, port: number): Promise<void> {
  const domain = config.SITE_DOMAIN
  const hostname = `preview-${sessionId}.admin.${domain}`

  const route = {
    '@id': `preview-${sessionId}`,
    match: [{ host: [hostname] }],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: `localhost:${port}` }],
      },
    ],
    terminal: true,
  }

  try {
    const resp = await fetch(`${config.CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route),
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.warn(`[session] Caddy route add returned ${resp.status}: ${text}`)
    }
  } catch (err) {
    console.warn(`[session] Failed to add Caddy route (Caddy may not be running): ${err}`)
  }
}

async function removeCaddyRoute(sessionId: string): Promise<void> {
  try {
    const resp = await fetch(`${config.CADDY_ADMIN_URL}/id/preview-${sessionId}`, {
      method: 'DELETE',
    })
    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text()
      console.warn(`[session] Caddy route delete returned ${resp.status}: ${text}`)
    }
  } catch (err) {
    console.warn(`[session] Failed to remove Caddy route: ${err}`)
  }
}

// ── Session Manager ────────────────────────────────────────────────────────

class SessionManager {
  private session: SessionState | null = null
  private timeoutInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.startTimeoutChecker()
  }

  // ── Query methods ──────────────────────────────────────────────────────

  getWorkingDir(): string {
    if (this.session) {
      return this.session.worktreePath
    }
    return config.SITE_DIR
  }

  isActive(): boolean {
    return this.session !== null
  }

  getStatus(): SessionStatus | null {
    if (!this.session) return null
    return {
      sessionId: this.session.sessionId,
      branch: this.session.branch,
      previewUrl: this.session.previewUrl,
      userId: this.session.userId,
      startedAt: this.session.startedAt.toISOString(),
      lastActivityAt: this.session.lastActivityAt.toISOString(),
      worktreePath: this.session.worktreePath,
      previewPort: this.session.previewPort,
    }
  }

  touchActivity(): void {
    if (this.session) {
      this.session.lastActivityAt = new Date()
    }
  }

  // ── Start editing ──────────────────────────────────────────────────────

  async startEditing(
    userId: string,
    userName: string,
    userEmail: string
  ): Promise<{ previewUrl: string; sessionId: string }> {
    if (this.session) {
      throw new Error(
        `An editing session is already active (session ${this.session.sessionId} by user ${this.session.userId})`
      )
    }

    const sessionId = crypto.randomBytes(4).toString('hex')
    const branch = `preview/${sessionId}`
    const previewsBase = config.PREVIEWS_DIR
    fs.mkdirSync(previewsBase, { recursive: true })
    const worktreePath = path.join(previewsBase, sessionId)
    const port = 5000 + Math.floor(Math.random() * 4000)
    const previewUrl = `https://preview-${sessionId}.admin.${config.SITE_DOMAIN}`
    console.log('[session] preview port:', port)

    // Track what we've done for rollback
    const cleanupSteps: (() => void)[] = []

    try {
      // b. Create git branch off main
      createBranch(branch)
      cleanupSteps.push(() => deleteBranch(branch))

      // c. Create git worktree
      createWorktree(worktreePath, branch)
      cleanupSteps.push(() => removeWorktree(worktreePath))

      // d. Install dependencies in worktree
      console.log(`[preview:${sessionId}] Installing dependencies...`)
      const installResult = spawnSync('bun', ['install'], {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
        env: { ...process.env, PATH: process.env.PATH },
      })
      if (installResult.status !== 0) {
        throw new Error(`bun install failed: ${installResult.stderr || installResult.stdout}`)
      }
      console.log(`[preview:${sessionId}] Dependencies installed.`)

      // e. Symlink data directory
      const siteDataDir = path.join(config.SITE_DIR, 'data')
      const worktreeDataDir = path.join(worktreePath, 'data')
      if (fs.existsSync(siteDataDir) && !fs.existsSync(worktreeDataDir)) {
        fs.symlinkSync(siteDataDir, worktreeDataDir, 'junction')
      }

      // f. Spawn dev server
      const devProcess = spawn('bun', ['run', 'dev', '--host', '0.0.0.0', '--port', String(port)], {
        cwd: worktreePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        detached: true,
        env: { ...process.env, PATH: process.env.PATH },
      })

      devProcess.stdout?.on('data', (data: Buffer) => {
        console.log(`[preview:${sessionId}] ${data.toString().trim()}`)
      })
      devProcess.stderr?.on('data', (data: Buffer) => {
        console.error(`[preview:${sessionId}] ${data.toString().trim()}`)
      })
      devProcess.on('error', (err) => {
        console.error(`[preview:${sessionId}] Process error: ${err.message}`)
      })
      devProcess.on('exit', (code) => {
        console.log(`[preview:${sessionId}] Dev server exited with code ${code}`)
      })

      cleanupSteps.push(() => {
        try {
          devProcess.kill('SIGTERM')
        } catch { /* ignore */ }
      })

      // g. Register Caddy route
      await addCaddyRoute(sessionId, port)
      cleanupSteps.push(() => {
        removeCaddyRoute(sessionId).catch(() => {})
      })

      // h. Record session in DB
      try {
        createSessionRecord(userId, branch, previewUrl)
      } catch (err) {
        console.warn(`[session] Failed to record session in DB: ${err}`)
      }

      // i. Audit log
      logAction(userId, 'session.start', `Started editing session ${sessionId}`)

      // j. Store session state
      this.session = {
        sessionId,
        branch,
        worktreePath,
        previewPort: port,
        previewProcess: devProcess,
        previewUrl,
        userId,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      }

      return { previewUrl, sessionId }
    } catch (err) {
      // Rollback in reverse order
      console.error(`[session] startEditing failed, rolling back: ${err}`)
      for (const step of cleanupSteps.reverse()) {
        try {
          step()
        } catch (cleanupErr) {
          console.warn(`[session] Rollback step failed: ${cleanupErr}`)
        }
      }
      throw err
    }
  }

  // ── Publish changes ────────────────────────────────────────────────────

  async publishChanges(
    userId: string,
    userName: string,
    userEmail: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.session) {
      throw new Error('No active editing session to publish')
    }

    const { sessionId, branch, worktreePath } = this.session

    try {
      // a. Stage and commit remaining changes in worktree
      stageAndCommit(
        `Preview changes from session ${sessionId}`,
        worktreePath,
        userName,
        userEmail
      )

      // b. Kill the preview dev server
      this.killPreviewProcess()

      // c. Record pre-merge commit of main
      const preMergeCommit = gitExec(['rev-parse', 'HEAD'], config.SITE_DIR)

      // d. Run install and build in worktree with timeout
      try {
        const installResult = spawnSync('bun', ['install'], {
          cwd: worktreePath,
          encoding: 'utf-8',
          timeout: 120_000,
          stdio: 'pipe',
          env: { ...process.env, PATH: process.env.PATH },
        })
        if (installResult.status !== 0) {
          throw new Error(`bun install failed: ${installResult.stderr || installResult.stdout}`)
        }
        const buildResult = spawnSync('bun', ['run', 'build'], {
          cwd: worktreePath,
          encoding: 'utf-8',
          timeout: 120_000,
          stdio: 'pipe',
          env: { ...process.env, PATH: process.env.PATH },
        })
        if (buildResult.status !== 0) {
          throw new Error(buildResult.stderr || buildResult.stdout || 'Build failed')
        }
      } catch (buildErr) {
        // Build failed
        console.error(`[session] Build failed, not merging: ${buildErr}`)
        return {
          success: false,
          error: `Build failed: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`,
        }
      }

      // e. Checkout main (should already be on main in SITE_DIR)
      try {
        gitExec(['checkout', 'main'], config.SITE_DIR)
      } catch {
        // Already on main, that's fine
      }

      // f. Merge preview branch
      mergeBranch(branch, userName, userEmail)

      // g. Build in SITE_DIR (the worktree build output is in the worktree, not SITE_DIR,
      //    and dist/ is gitignored so the merge doesn't carry it over)
      console.log('[session] Building site in main directory...')
      const mainInstallResult = spawnSync('bun', ['install'], {
        cwd: config.SITE_DIR,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
        env: { ...process.env, PATH: process.env.PATH },
      })
      if (mainInstallResult.status !== 0) {
        throw new Error(`bun install failed: ${mainInstallResult.stderr || mainInstallResult.stdout}`)
      }
      const mainBuildResult = spawnSync('bun', ['run', 'build'], {
        cwd: config.SITE_DIR,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
        env: { ...process.env, PATH: process.env.PATH },
      })
      if (mainBuildResult.status !== 0) {
        const buildErr = mainBuildResult.stderr || mainBuildResult.stdout || 'Build failed'
        console.error(`[session] Main build failed after merge: ${buildErr}`)
        // Revert the merge
        try {
          gitExec(['reset', '--hard', preMergeCommit], config.SITE_DIR)
        } catch (revertErr) {
          console.error(`[session] Failed to revert merge: ${revertErr}`)
        }
        return {
          success: false,
          error: `Build failed after merging changes: ${buildErr}`,
        }
      }
      console.log('[session] Site built successfully in main directory.')
      // PM2 watch will auto-restart the site process when dist/ changes

      // h. Cleanup preview environment
      await this.cleanupPreview()

      // i. Update session record
      try {
        endSessionRecord(sessionId, 'published')
      } catch (err) {
        console.warn(`[session] Failed to update session record: ${err}`)
      }

      logAction(userId, 'session.publish', `Published changes from session ${sessionId}`)

      return { success: true }
    } catch (err) {
      throw new Error(
        `Publish failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // ── Discard changes ────────────────────────────────────────────────────

  async discardChanges(): Promise<void> {
    if (!this.session) {
      throw new Error('No active editing session to discard')
    }

    const { sessionId, branch, worktreePath, userId } = this.session

    // a. Kill preview process
    this.killPreviewProcess()

    // b. Remove Caddy route
    await removeCaddyRoute(sessionId)

    // c. Remove worktree and delete branch
    removeWorktree(worktreePath)
    deleteBranch(branch)

    // d. Ensure we're on main
    try {
      gitExec(['checkout', 'main'], config.SITE_DIR)
    } catch {
      // Already on main
    }

    // e. Update session record
    try {
      endSessionRecord(sessionId, 'discarded')
    } catch (err) {
      console.warn(`[session] Failed to update session record: ${err}`)
    }

    logAction(userId, 'session.discard', `Discarded changes from session ${sessionId}`)

    this.session = null
  }

  // ── Restart preview ────────────────────────────────────────────────────

  async restartPreview(): Promise<void> {
    if (!this.session) {
      throw new Error('No active editing session to restart')
    }

    const { sessionId, worktreePath, previewPort } = this.session

    console.log(`[session] Restarting preview server for session ${sessionId}`)

    // Kill existing preview process
    this.killPreviewProcess()

    // Wait a moment for the port to be released
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Spawn new dev server on the same port
    const devProcess = spawn('bun', ['run', 'dev', '--host', '0.0.0.0', '--port', String(previewPort)], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: true,
      env: { ...process.env, PATH: process.env.PATH },
    })

    devProcess.stdout?.on('data', (data: Buffer) => {
      console.log(`[preview:${sessionId}] ${data.toString().trim()}`)
    })
    devProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[preview:${sessionId}] ${data.toString().trim()}`)
    })
    devProcess.on('error', (err) => {
      console.error(`[preview:${sessionId}] Process error: ${err.message}`)
    })
    devProcess.on('exit', (code) => {
      console.log(`[preview:${sessionId}] Dev server exited with code ${code}`)
    })

    this.session.previewProcess = devProcess

    console.log(`[session] Preview server restarted for session ${sessionId}`)
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  async cleanup(): Promise<void> {
    if (!this.session) return

    console.log(`[session] Force cleanup of session ${this.session.sessionId}`)
    try {
      await this.discardChanges()
    } catch (err) {
      console.error(`[session] Cleanup error: ${err}`)
      // Force reset state even if cleanup fails
      this.killPreviewProcess()
      this.session = null
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private killPreviewProcess(): void {
    if (this.session?.previewProcess) {
      try {
        // Kill the entire process group to ensure child processes are killed
        if (this.session.previewProcess.pid) {
          process.kill(-this.session.previewProcess.pid, 'SIGTERM')
        }
      } catch {
        // Process may already be dead
      }
      this.session.previewProcess = null
    }
  }

  private async cleanupPreview(): Promise<void> {
    if (!this.session) return

    const { sessionId, branch, worktreePath } = this.session

    this.killPreviewProcess()
    await removeCaddyRoute(sessionId)
    removeWorktree(worktreePath)
    deleteBranch(branch)

    this.session = null
  }

  // ── Timeout checker ────────────────────────────────────────────────────

  private startTimeoutChecker(): void {
    this.timeoutInterval = setInterval(() => {
      if (!this.session) return

      const elapsed = Date.now() - this.session.lastActivityAt.getTime()
      const timeoutMs = config.SESSION_TIMEOUT_MINUTES * 60 * 1000

      if (elapsed > timeoutMs) {
        console.log(
          `[session] Session ${this.session.sessionId} timed out after ${config.SESSION_TIMEOUT_MINUTES} minutes of inactivity`
        )
        const sessionId = this.session.sessionId
        const userId = this.session.userId

        this.discardChanges()
          .then(() => {
            try {
              endSessionRecord(sessionId, 'timed_out')
            } catch { /* already ended by discard */ }
            logAction(userId, 'session.timeout', `Session ${sessionId} timed out`)
          })
          .catch((err) => {
            console.error(`[session] Timeout cleanup failed: ${err}`)
          })
      }
    }, 60_000)
  }

  stopTimeoutChecker(): void {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval)
      this.timeoutInterval = null
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const sessionManager = new SessionManager()

// ── Graceful shutdown ──────────────────────────────────────────────────────

export function registerShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    console.log(`[session] Received ${signal}, cleaning up...`)
    sessionManager.stopTimeoutChecker()
    await sessionManager.cleanup()
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

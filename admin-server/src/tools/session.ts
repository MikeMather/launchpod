import fs from 'fs'
import path from 'path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { config } from '../config.js'
import { sessionManager } from '../session.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function countFiles(dirPath: string, extensions?: string[]): number {
  let count = 0
  const SKIP = new Set(['.git', 'node_modules', 'data', 'dist'])

  function walk(dir: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
          count++
        }
      }
    }
  }

  walk(dirPath)
  return count
}

// ── Tool registration ──────────────────────────────────────────────────────

export function registerSessionTools(
  server: McpServer,
  getUser: () => { id: string; name: string; email: string } | null
): void {
  // ── start_editing ──────────────────────────────────────────────────────

  server.tool(
    'start_editing',
    'Start a new editing session with a live preview. Creates a separate branch and dev server for safe editing.',
    {},
    async () => {
      const user = getUser()
      if (!user) {
        return {
          content: [{ type: 'text', text: 'Error: Authentication required to start editing' }],
          isError: true,
        }
      }

      try {
        const result = await sessionManager.startEditing(user.id, user.name, user.email)
        return {
          content: [
            {
              type: 'text',
              text: [
                `Editing session started successfully!`,
                `Session ID: ${result.sessionId}`,
                `Preview URL: ${result.previewUrl}`,
                ``,
                `You can now edit files and see changes live at the preview URL.`,
                `When done, use publish_changes to deploy or discard_changes to cancel.`,
              ].join('\n'),
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error starting editing session: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ── publish_changes ────────────────────────────────────────────────────

  server.tool(
    'publish_changes',
    'Publish the current editing session changes to the live site. Merges changes, builds, and restarts the site.',
    {},
    async () => {
      const user = getUser()
      if (!user) {
        return {
          content: [{ type: 'text', text: 'Error: Authentication required to publish' }],
          isError: true,
        }
      }

      if (sessionManager.isActive()) sessionManager.touchActivity()

      try {
        const result = await sessionManager.publishChanges(user.id, user.name, user.email)
        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: 'Changes published successfully! The site has been rebuilt and restarted.',
              },
            ],
          }
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Publish failed: ${result.error}\n\nThe editing session is still active. You can fix the issues and try again, or discard changes.`,
              },
            ],
            isError: true,
          }
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error publishing changes: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ── discard_changes ────────────────────────────────────────────────────

  server.tool(
    'discard_changes',
    'Discard all changes in the current editing session and clean up the preview environment.',
    {},
    async () => {
      const user = getUser()

      if (sessionManager.isActive()) sessionManager.touchActivity()

      try {
        await sessionManager.discardChanges()
        return {
          content: [
            {
              type: 'text',
              text: 'Changes discarded. The editing session has been cleaned up.',
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error discarding changes: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ── get_session_status ─────────────────────────────────────────────────

  server.tool(
    'get_session_status',
    'Get the current editing session status, including preview URL and session info.',
    {},
    async () => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      const status = sessionManager.getStatus()
      if (!status) {
        return {
          content: [
            {
              type: 'text',
              text: 'No active editing session. Use start_editing to begin.',
            },
          ],
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `Active editing session:`,
              `  Session ID: ${status.sessionId}`,
              `  Branch: ${status.branch}`,
              `  Preview URL: ${status.previewUrl}`,
              `  Started: ${status.startedAt}`,
              `  Last activity: ${status.lastActivityAt}`,
            ].join('\n'),
          },
        ],
      }
    }
  )

  // ── get_preview_url ────────────────────────────────────────────────────

  server.tool(
    'get_preview_url',
    'Get the preview URL for the current editing session.',
    {},
    async () => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      const status = sessionManager.getStatus()
      if (!status) {
        return {
          content: [
            { type: 'text', text: 'No active editing session. Start one first with start_editing.' },
          ],
        }
      }

      return {
        content: [{ type: 'text', text: status.previewUrl }],
      }
    }
  )

  // ── get_site_status ────────────────────────────────────────────────────

  server.tool(
    'get_site_status',
    'Get general information about the site: domain, file counts, and whether an editing session is active.',
    {},
    async () => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      const siteDir = config.SITE_DIR
      const totalFiles = countFiles(siteDir)
      const pageFiles = countFiles(path.join(siteDir, 'src', 'pages'), ['.astro', '.md', '.mdx'])
      const componentFiles = countFiles(path.join(siteDir, 'src', 'components'), ['.astro', '.tsx', '.jsx'])
      const sessionActive = sessionManager.isActive()
      const sessionStatus = sessionManager.getStatus()

      const lines = [
        `Site: ${config.SITE_NAME}`,
        `Domain: ${config.SITE_DOMAIN}`,
        `Directory: ${siteDir}`,
        `Total files: ${totalFiles}`,
        `Pages: ${pageFiles}`,
        `Components: ${componentFiles}`,
        `Editing session: ${sessionActive ? `Active (${sessionStatus?.sessionId})` : 'None'}`,
      ]

      if (sessionActive && sessionStatus) {
        lines.push(`Preview URL: ${sessionStatus.previewUrl}`)
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    }
  )
}

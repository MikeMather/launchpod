import { execSync } from 'node:child_process'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { config, validatePath } from '../config.js'
import { sessionManager } from '../session.js'
import { logAction } from '../db.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const FILTERED_DIRS = new Set(['.git', 'node_modules', 'data', 'dist'])

function buildTree(
  dirPath: string,
  basePath: string,
  currentDepth: number,
  maxDepth: number,
  prefix: string = ''
): string {
  if (currentDepth > maxDepth) return ''

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return ''
  }

  // Filter out hidden and ignored directories/files
  entries = entries.filter((e) => !FILTERED_DIRS.has(e.name) && !e.name.startsWith('.'))

  // Sort: directories first, then files, alphabetically within each group
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter((e) => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
  const sorted = [...dirs, ...files]

  let result = ''
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]
    const isLast = i === sorted.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = isLast ? '    ' : '│   '

    if (entry.isDirectory()) {
      result += `${prefix}${connector}${entry.name}/\n`
      if (currentDepth < maxDepth) {
        result += buildTree(
          path.join(dirPath, entry.name),
          basePath,
          currentDepth + 1,
          maxDepth,
          prefix + childPrefix
        )
      }
    } else {
      result += `${prefix}${connector}${entry.name}\n`
    }
  }

  return result
}

function stageAndCommitIfSession(
  filePath: string,
  message: string,
  userId: string | null,
  userName?: string,
  userEmail?: string
): void {
  if (!sessionManager.isActive()) return

  const cwd = sessionManager.getWorkingDir()
  const relative = path.relative(cwd, filePath).replace(/\\/g, '/')

  try {
    execSync(`git add "${relative}"`, { cwd, encoding: 'utf-8', timeout: 10_000 })

    // Check if there's anything to commit
    try {
      execSync('git diff --cached --quiet', { cwd, encoding: 'utf-8' })
      return // nothing staged
    } catch {
      // staged changes exist, proceed
    }

    const nameFlag = userName ? `-c user.name="${userName}"` : ''
    const emailFlag = userEmail ? `-c user.email="${userEmail}"` : ''
    execSync(
      `git ${nameFlag} ${emailFlag} commit -m "${message.replace(/"/g, '\\"')}"`,
      { cwd, encoding: 'utf-8', timeout: 10_000 }
    )
  } catch (err) {
    console.warn(`[files] Auto-commit failed: ${err}`)
  }
}

// ── Tool registration ──────────────────────────────────────────────────────

export function registerFileTools(
  server: McpServer,
  getUser: () => { id: string; name: string; email: string } | null
): void {
  // ── list_files ─────────────────────────────────────────────────────────

  server.tool(
    'list_files',
    'List files and directories in the site project. Returns a tree view.',
    {
      path: z.string().optional().describe('Relative path within the project (default: root)'),
      depth: z.number().optional().describe('Maximum directory depth to display (default: 3)'),
    },
    async (args) => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      const workDir = sessionManager.getWorkingDir()
      const targetPath = args.path
        ? path.resolve(workDir, args.path)
        : workDir
      const maxDepth = args.depth ?? 3

      // Validate path is within project
      if (!targetPath.startsWith(workDir)) {
        return {
          content: [{ type: 'text', text: 'Error: Path is outside the project directory' }],
          isError: true,
        }
      }

      if (!fs.existsSync(targetPath)) {
        return {
          content: [{ type: 'text', text: `Error: Path does not exist: ${args.path ?? '/'}` }],
          isError: true,
        }
      }

      const rootName = args.path || '.'
      const tree = `${rootName}/\n${buildTree(targetPath, workDir, 1, maxDepth)}`

      return {
        content: [{ type: 'text', text: tree }],
      }
    }
  )

  const infoText = `
  LaunchPod is a tool for managing a website built with Astro.
  You can use the tools provided by this MCP server to manager a users website.

  Some general tips:
  - This is an astro project so refer to the astro docs for general astro usage
  - Avoid overusing gradients
  - Do not use emojis. Use icons instead of emojis if visual cues are necessary
  - performance of the site is a priority
  - Ensure the site is SEO friendly
  - Use software architecture best practices (e.g. separation of concerns, DRY)
  - Don't publish changes without explicit confirmation
  - Preview URLs should be shared with the user before any changes are made

  Use the list_files tool to view the files in the project before beginning.

  ── Data / CRUD Layer ──────────────────────────────────────────────────────

  The site has a built-in data layer for storing and managing structured data
  (e.g. contact form submissions, blog comments, newsletter signups, custom
  content types). It is defined in backend/models.yaml and backed by SQLite.

  **How it works:**

  1. **Models** — Collections are defined in \`backend/models.yaml\`. Each
     collection defines fields (type, required, default, validation rules) and
     access permissions (public vs admin for create/list/read/update/delete).
     Supported field types: text, email, url, richtext, number, boolean,
     datetime, select, multiselect, file, list, relation.

  2. **API Routes** — Auto-generated REST endpoints at \`/api/[collection]\`:
     - \`GET  /api/{collection}\`          — List records (paginated, sortable, filterable)
     - \`POST /api/{collection}\`          — Create a record
     - \`GET  /api/{collection}/{id}\`     — Get a single record
     - \`PATCH /api/{collection}/{id}\`    — Update a record
     - \`DELETE /api/{collection}/{id}\`   — Delete a record

  3. **Server-side usage** — Import from \`src/lib/launchpod/\`:
     - \`listRecords(collection, options)\` — Paginated list with sorting/filtering
     - \`getRecord(collection, id)\`        — Get single record by ID
     - \`createRecord(collection, data)\`   — Create (validates against model schema)
     - \`updateRecord(collection, id, data)\` — Update (validates against model schema)
     - \`deleteRecord(collection, id)\`     — Delete by ID

  4. **Validation** — Data is validated against the model definition before
     create/update. Required fields, max lengths, min/max numbers, enum options,
     and unique constraints are all enforced.

  5. **Hooks** — Collections can define hooks in models.yaml:
     - \`on_create\`: Triggered after a record is created (email notifications, webhooks)
     - \`on_update\`: Triggered after a record is updated

  **When to use the CRUD layer vs files:**
  - Use the CRUD layer for user-generated data, form submissions, dynamic
    content, or anything that needs to be queried/filtered/paginated.
  - Use file tools (write_file, edit_file) for static content like blog posts
    in \`src/content/\`, page templates, components, and configuration.

  **Adding a new collection:** Edit \`backend/models.yaml\` to add a new
  collection definition with fields, access rules, and optional hooks. The
  API routes are auto-generated from the model definitions — no extra code
  needed. The database tables are created automatically on first access.
  `;

  server.tool(
    'info',
    'Instructions for using LaunchPod and the tools provided',
    {},
    async () => {
      return {
        content: [{ type: 'text', text: infoText }],
      }
    }
  )

  // ── read_file ──────────────────────────────────────────────────────────

  server.tool(
    'read_file',
    'Read the contents of a file in the site project.',
    {
      path: z.string().describe('Relative path to the file within the project'),
    },
    async (args) => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      const workDir = sessionManager.getWorkingDir()
      const validation = validatePath(args.path, workDir)

      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: `Error: ${validation.error}` }],
          isError: true,
        }
      }

      if (!fs.existsSync(validation.resolved)) {
        return {
          content: [{ type: 'text', text: `Error: File not found: ${args.path}` }],
          isError: true,
        }
      }

      const stat = fs.statSync(validation.resolved)
      if (stat.isDirectory()) {
        return {
          content: [{ type: 'text', text: `Error: Path is a directory, not a file: ${args.path}` }],
          isError: true,
        }
      }

      const contents = fs.readFileSync(validation.resolved, 'utf-8')
      return {
        content: [{ type: 'text', text: contents }],
      }
    }
  )

  // ── write_file ─────────────────────────────────────────────────────────

  server.tool(
    'write_file',
    'Write content to a file in the site project. Creates parent directories if needed. Only works in writable directories.',
    {
      path: z.string().describe('Relative path to the file within the project'),
      content: z.string().describe('Content to write to the file'),
    },
    async (args) => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      // Guard: require active editing session
      if (!sessionManager.isActive()) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: You must start an editing session before writing files. Use the start_editing tool first.',
            },
          ],
          isError: true,
        }
      }

      const workDir = sessionManager.getWorkingDir()
      const validation = validatePath(args.path, workDir, { requireWritable: true })

      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: `Error: ${validation.error}` }],
          isError: true,
        }
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(validation.resolved)
      fs.mkdirSync(parentDir, { recursive: true })

      const isNew = !fs.existsSync(validation.resolved)
      fs.writeFileSync(validation.resolved, args.content, 'utf-8')

      // Auto-commit if session is active
      const user = getUser()
      const action = isNew ? 'create' : 'update'
      stageAndCommitIfSession(
        validation.resolved,
        `${action}: ${args.path}`,
        user?.id ?? null,
        user?.name,
        user?.email
      )

      logAction(user?.id ?? null, `file.${action}`, args.path)

      return {
        content: [
          {
            type: 'text',
            text: `File ${isNew ? 'created' : 'updated'}: ${args.path}`,
          },
        ],
      }
    }
  )

  // ── edit_file ──────────────────────────────────────────────────────────

  server.tool(
    'edit_file',
    'Edit a file by replacing a search string with a replacement string. Use this for targeted edits without rewriting the entire file. The search string must match exactly (case-sensitive). For best results, include enough context in the search string to make it unique.',
    {
      path: z.string().describe('Relative path to the file within the project'),
      search: z.string().describe('The exact string to search for (must match exactly, case-sensitive)'),
      replacement: z.string().describe('The string to replace the search string with'),
    },
    async (args) => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      const workDir = sessionManager.getWorkingDir()
      const validation = validatePath(args.path, workDir, { requireWritable: true })

      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: `Error: ${validation.error}` }],
          isError: true,
        }
      }

      if (!fs.existsSync(validation.resolved)) {
        return {
          content: [{ type: 'text', text: `Error: File not found: ${args.path}` }],
          isError: true,
        }
      }

      const stat = fs.statSync(validation.resolved)
      if (stat.isDirectory()) {
        return {
          content: [{ type: 'text', text: `Error: Path is a directory, not a file: ${args.path}` }],
          isError: true,
        }
      }

      const contents = fs.readFileSync(validation.resolved, 'utf-8')

      if (!contents.includes(args.search)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Search string not found in ${args.path}. Make sure the search string matches exactly (case-sensitive).`,
            },
          ],
          isError: true,
        }
      }

      const newContents = contents.replace(args.search, args.replacement)
      fs.writeFileSync(validation.resolved, newContents, 'utf-8')

      // Auto-commit if session is active
      const user = getUser()
      stageAndCommitIfSession(
        validation.resolved,
        `edit: ${args.path}`,
        user?.id ?? null,
        user?.name,
        user?.email
      )

      logAction(user?.id ?? null, 'file.edit', args.path)

      return {
        content: [
          {
            type: 'text',
            text: `File edited: ${args.path}`,
          },
        ],
      }
    }
  )

  // ── delete_file ────────────────────────────────────────────────────────

  server.tool(
    'delete_file',
    'Delete a file from the site project. Only works in writable directories.',
    {
      path: z.string().describe('Relative path to the file to delete'),
    },
    async (args) => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      const workDir = sessionManager.getWorkingDir()
      const validation = validatePath(args.path, workDir, { requireWritable: true })

      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: `Error: ${validation.error}` }],
          isError: true,
        }
      }

      if (!fs.existsSync(validation.resolved)) {
        return {
          content: [{ type: 'text', text: `Error: File not found: ${args.path}` }],
          isError: true,
        }
      }

      const stat = fs.statSync(validation.resolved)
      if (stat.isDirectory()) {
        return {
          content: [{ type: 'text', text: `Error: Cannot delete a directory. Only files can be deleted.` }],
          isError: true,
        }
      }

      fs.unlinkSync(validation.resolved)

      // Auto-commit if session is active
      const user = getUser()
      stageAndCommitIfSession(
        validation.resolved,
        `delete: ${args.path}`,
        user?.id ?? null,
        user?.name,
        user?.email
      )

      logAction(user?.id ?? null, 'file.delete', args.path)

      return {
        content: [{ type: 'text', text: `File deleted: ${args.path}` }],
      }
    }
  )

  // ── install_package ────────────────────────────────────────────────────

  server.tool(
    'install_package',
    'Install an npm package in the current preview session. Only works during active editing sessions. The preview server will be restarted after installation to load the new dependencies.',
    {
      package_name: z.string().describe('The npm package name to install (e.g., "react-hook-form")'),
      version: z.string().optional().describe('Optional version specifier (e.g., "^7.0.0"). If omitted, installs latest version.'),
    },
    async (args) => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      // Guard: require active editing session
      if (!sessionManager.isActive()) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: You must start an editing session before installing packages. Use the start_editing tool first.',
            },
          ],
          isError: true,
        }
      }

      const user = getUser()
      const workDir = sessionManager.getWorkingDir()

      // Validate package name format (basic check)
      const packageNameRegex = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
      if (!packageNameRegex.test(args.package_name)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Invalid package name format: ${args.package_name}`,
            },
          ],
          isError: true,
        }
      }

      // Build package specifier
      const packageSpec = args.version
        ? `${args.package_name}@${args.version}`
        : args.package_name

      console.log(`[install_package] Installing ${packageSpec} in ${workDir}`)

      // Run bun install
      try {
        const installResult = execSync(`bun install ${packageSpec}`, {
          cwd: workDir,
          encoding: 'utf-8',
          timeout: 120_000,
          stdio: 'pipe',
        })

        console.log(`[install_package] Install output: ${installResult}`)

        // Auto-commit package.json and lockfile changes
        try {
          const packageJsonPath = path.join(workDir, 'package.json')
          const lockfilePath = path.join(workDir, 'bun.lockb')

          stageAndCommitIfSession(
            packageJsonPath,
            `install: ${packageSpec}`,
            user?.id ?? null,
            user?.name,
            user?.email
          )

          // Also stage lockfile if it exists
          if (fs.existsSync(lockfilePath)) {
            execSync(`git add bun.lockb`, { cwd: workDir, encoding: 'utf-8' })
          }
        } catch (commitErr) {
          console.warn(`[install_package] Auto-commit failed: ${commitErr}`)
        }

        // Restart preview server to load new dependencies
        try {
          await sessionManager.restartPreview()
          console.log(`[install_package] Preview server restarted`)
        } catch (restartErr) {
          console.error(`[install_package] Preview restart failed: ${restartErr}`)
          return {
            content: [
              {
                type: 'text',
                text: `Package installed successfully, but preview server restart failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}\n\nYou may need to discard and start a new editing session.`,
              },
            ],
            isError: true,
          }
        }

        logAction(user?.id ?? null, 'package.install', packageSpec)

        return {
          content: [
            {
              type: 'text',
              text: `Package installed successfully: ${packageSpec}\n\nThe preview server has been restarted to load the new dependencies.`,
            },
          ],
        }
      } catch (err: any) {
        const errorOutput = err.stderr || err.stdout || err.message || String(err)
        console.error(`[install_package] Installation failed: ${errorOutput}`)

        return {
          content: [
            {
              type: 'text',
              text: `Error installing package ${packageSpec}:\n\n${errorOutput}\n\nPlease check the package name and version, and try again.`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ── uninstall_package ──────────────────────────────────────────────────

  server.tool(
    'uninstall_package',
    'Uninstall an npm package from the current preview session. Only works during active editing sessions. The preview server will be restarted after uninstallation.',
    {
      package_name: z.string().describe('The npm package name to uninstall (e.g., "react-hook-form")'),
    },
    async (args) => {
      if (sessionManager.isActive()) sessionManager.touchActivity()

      // Guard: require active editing session
      if (!sessionManager.isActive()) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: You must start an editing session before uninstalling packages. Use the start_editing tool first.',
            },
          ],
          isError: true,
        }
      }

      const user = getUser()
      const workDir = sessionManager.getWorkingDir()

      // Validate package name format (basic check)
      const packageNameRegex = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
      if (!packageNameRegex.test(args.package_name)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Invalid package name format: ${args.package_name}`,
            },
          ],
          isError: true,
        }
      }

      console.log(`[uninstall_package] Uninstalling ${args.package_name} from ${workDir}`)

      // Run bun remove
      try {
        const uninstallResult = execSync(`bun remove ${args.package_name}`, {
          cwd: workDir,
          encoding: 'utf-8',
          timeout: 120_000,
          stdio: 'pipe',
        })

        console.log(`[uninstall_package] Uninstall output: ${uninstallResult}`)

        // Auto-commit package.json and lockfile changes
        try {
          const packageJsonPath = path.join(workDir, 'package.json')
          const lockfilePath = path.join(workDir, 'bun.lockb')

          stageAndCommitIfSession(
            packageJsonPath,
            `uninstall: ${args.package_name}`,
            user?.id ?? null,
            user?.name,
            user?.email
          )

          // Also stage lockfile if it exists
          if (fs.existsSync(lockfilePath)) {
            execSync(`git add bun.lockb`, { cwd: workDir, encoding: 'utf-8' })
          }
        } catch (commitErr) {
          console.warn(`[uninstall_package] Auto-commit failed: ${commitErr}`)
        }

        // Restart preview server to unload the removed dependencies
        try {
          await sessionManager.restartPreview()
          console.log(`[uninstall_package] Preview server restarted`)
        } catch (restartErr) {
          console.error(`[uninstall_package] Preview restart failed: ${restartErr}`)
          return {
            content: [
              {
                type: 'text',
                text: `Package uninstalled successfully, but preview server restart failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}\n\nYou may need to discard and start a new editing session.`,
              },
            ],
            isError: true,
          }
        }

        logAction(user?.id ?? null, 'package.uninstall', args.package_name)

        return {
          content: [
            {
              type: 'text',
              text: `Package uninstalled successfully: ${args.package_name}\n\nThe preview server has been restarted.`,
            },
          ],
        }
      } catch (err: any) {
        const errorOutput = err.stderr || err.stdout || err.message || String(err)
        console.error(`[uninstall_package] Uninstallation failed: ${errorOutput}`)

        return {
          content: [
            {
              type: 'text',
              text: `Error uninstalling package ${args.package_name}:\n\n${errorOutput}\n\nPlease check the package name and try again.`,
            },
          ],
          isError: true,
        }
      }
    }
  )
}

# launchpod — Project Overview

## What This Is

launchpod is a platform for dev agencies that want to give their non-technical customers an AI-powered way to manage their websites. The agency builds the initial site, deploys it on a VPS, and gives the customer access to an admin dashboard. From the dashboard the customer manages their account, views form submissions, and generates MCP connection tokens. They plug that token into any MCP-compatible AI agent (Claude Desktop, Claude.ai, Cursor, or any future client) and ask for changes in plain language. The AI reads the site files, makes edits, shows a preview, and publishes — all without the customer knowing anything about git, servers, or code.

The agency retains full control over the underlying stack, infrastructure, and site template. There is no custom chat UI to build — the MCP protocol is the interface layer, and the customer brings their own client.

---

## Core Architecture Principle

The system is split into two fully independent processes per customer site. This separation is the most important architectural decision in the project.

**The Site Server** is a standard Astro SSR application. It serves the customer's website to the public, handles visitor-facing API routes (form submissions, etc.), and manages its own SQLite database for visitor data. It has no knowledge of MCP, git, users, tokens, or editing sessions. It is a normal website. You could run it, edit it manually with a text editor, deploy it by hand, and completely ditch the admin/MCP layer. It is not coupled to the management plane in any way.

**The Admin/MCP Server** is the management plane. It is a single Node.js service that provides two interfaces: an admin dashboard (web UI for account management, token generation, and data viewing) and an MCP endpoint (AI agent interface for file editing and deployment). It owns its own SQLite database for system data (users, tokens, audit logs). It has filesystem access to the site's git repo so it can read and write project files, manage git branches, and trigger builds. It communicates with Caddy to manage preview subdomain routing.

These two processes share nothing except the filesystem. The admin/MCP server reads and writes files in the site's repo directory. It can also read (but does not write to) the site's visitor database to display data in the admin dashboard. The site server is unaware the admin/MCP server exists.

---

## System Components

### 1. Admin/MCP Server

A single Node.js service that runs on its own port and handles all management concerns for a customer site. It serves two interfaces from the same process.

**Tech stack:** TypeScript, Hono (HTTP framework), `@modelcontextprotocol/sdk` (MCP protocol), `better-sqlite3` (system database). The admin dashboard is server-rendered HTML using Hono's JSX support — the dashboard is simple enough that a client-side framework with its own build step is unnecessary. Hono handles both the dashboard routes and the MCP SSE transport from the same HTTP server.

**Admin Dashboard (web UI):**

Served at the root of the admin subdomain (e.g., `admin.customer.com`). Provides:

- Login page — email and password authentication.
- Dashboard home — site status overview: live URL, last deploy, active editing session, recent audit log entries.
- Users — list all users, invite new users, assign roles (admin or editor), deactivate accounts. Only accessible to admins.
- Tokens — list the current user's MCP tokens with labels and last-used timestamps. Generate new token (displayed once on creation, then only the label and metadata are stored). Revoke tokens.
- Data viewer — read-only view of the site's visitor data (form submissions, newsletter signups, bookings, etc.). Reads from the site's `data/site.db`. For each collection defined in `backend/models.yaml`: a table view with sortable columns, basic filtering, pagination. Ability to update status fields (e.g., mark a contact submission as "read"). CSV export.
- Audit log — filterable timeline of all MCP tool calls: who connected, what files they changed, when sessions were started and published.
- Session history — past editing sessions: who started it, when, how many files changed, outcome (published or discarded).

**MCP Endpoint (AI agent interface):**

Served from the same Hono HTTP server. AI agents connect to `admin.customer.com/sse` and authenticate with a bearer token generated through the dashboard. Every request is authenticated — the server hashes the incoming token and looks it up in its system database to resolve the user. Unauthenticated requests are rejected.

The MCP endpoint exposes these tools:

- `list_files` — returns a tree view of the project. Filters out node_modules, .git, data, and dist.
- `read_file` — returns the contents of a single file. Path-validated against allowed directories.
- `write_file` — creates or overwrites a file. Must be in an allowed directory. Auto-commits to git if a session is active. The commit is attributed to the authenticated user.
- `delete_file` — removes a file. Same path restrictions as write.
- `start_editing` — creates a git branch and worktree, spawns an Astro dev server on a dynamic port, registers a Caddy preview route, returns the preview URL.
- `get_preview_url` — returns the current preview URL if a session is active.
- `publish_changes` — commits outstanding changes, merges the branch into main, rebuilds the production site, restarts the production process via PM2, cleans up the preview environment.
- `discard_changes` — kills the preview process, removes the Caddy route, deletes the worktree and branch. No changes reach production.
- `get_session_status` — whether a session is active, the session ID, preview URL, and start time.
- `get_site_status` — the site URL, file counts across key directories, and current state.

**System database (`data/admin.db`):**

Owned exclusively by the admin/MCP server. Managed via `better-sqlite3`. Contains:

- `users` — id, email, name, password_hash, role (admin/editor), created_at, deactivated_at. The initial admin user is seeded during site provisioning.
- `tokens` — id, user_id, token_hash, label, created_at, last_used_at, revoked_at. Tokens are random strings stored as bcrypt hashes. Lookup requires hashing the incoming value and querying by hash.
- `audit_log` — id, user_id, action (tool name), detail (file path, commit message, etc.), created_at. Every MCP tool call is logged with the resolved user.
- `sessions` — id, user_id, branch, preview_url, started_at, ended_at, outcome (published/discarded).

This database is never touched by the site server or the AI agent. It is not in the git repo.


### 2. Site Server (Astro SSR)

A completely standard Astro project running in SSR mode. Serves the public-facing website and handles visitor interactions. Knows nothing about the management layer.

**Owner content (files in git):** Pages, blog posts, service listings, team bios, images, styles, components. Blog posts are markdown files in `src/content/blog/`. Services are YAML files in `src/content/services/`. Pages are Astro templates in `src/pages/`. Content collection schemas are defined in `src/content/config.ts`. The AI agent creates and edits all of these through the admin/MCP server's file tools.

**Visitor data (site database):** Form submissions, newsletter signups, booking requests. Defined in `backend/models.yaml`, stored in `data/site.db` (SQLite, JSON document pattern), served through auto-generated CRUD API routes at `/api/{collection}`.

**Project structure:**

```
customer-site/
├── astro.config.mjs            ← LOCKED (agency-owned)
├── package.json                ← LOCKED (agency-owned)
├── package-lock.json           ← LOCKED
├── backend/
│   ├── models.yaml             ← Data collection definitions (AI-editable)
│   └── email-templates/        ← Notification templates (AI-editable)
├── src/
│   ├── content/
│   │   ├── config.ts           ← Astro collection schemas (AI-editable)
│   │   ├── blog/               ← Markdown blog posts
│   │   ├── services/           ← YAML service listings
│   │   └── team/               ← YAML team bios
│   ├── layouts/
│   │   └── Base.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── about.astro
│   │   ├── blog/
│   │   │   └── [...slug].astro
│   │   └── api/
│   │       └── [collection]/   ← Auto-generated CRUD routes
│   ├── components/
│   ├── styles/
│   └── lib/launchpod/            ← Embedded library (db, validation, CRUD)
└── public/
    └── assets/                 ← Images, fonts, files
```

Note: the `data/` directory (SQLite database and uploads) lives outside the git repo at `sites/{name}/data/`. The site server's database path is configured via environment variable.

**The launchpod library** (`src/lib/launchpod/`) is a small module embedded in every customer project. It belongs to the Astro site, not the admin/MCP server. Its responsibilities:

- Reads `backend/models.yaml` at startup. For each collection, ensures a SQLite table exists using the JSON document pattern (columns: `id`, `data` as JSON, `created_at`, `updated_at`). No migrations — schema changes in the YAML only affect validation on writes.
- Provides CRUD logic used by the API route handlers at `src/pages/api/[collection]/`.
- Validates incoming data against field definitions. Supported types: text, email, url, richtext, number, boolean, datetime, select, multiselect, file, list, relation.
- Executes hooks from models.yaml (send email, call webhook) after record creation or update.

The site is fully self-contained. Delete the admin/MCP server and the site keeps running. Edit it by hand, rebuild, restart — it's just an Astro project with a small embedded data layer.


### 3. Caddy (Reverse Proxy)

Caddy handles HTTP routing and TLS certificate management. Runs as a systemd service.

**Static routing (configured per site by add-site script):**

- `customer.com` → site server (Astro SSR) on its assigned port
- `admin.customer.com` → admin/MCP server on its assigned port, with SSE-compatible settings (disabled buffering, no read/write timeouts)
- `preview-*.admin.customer.com` → fallback returning 404 "No active preview"

**Dynamic routing (managed at runtime by admin/MCP servers):**

When `start_editing` is called, the admin/MCP server POSTs to Caddy's admin API (localhost:2019) to add a route: `preview-{sessionId}.admin.customer.com` → preview dev server's dynamic port. On session end, it DELETEs the route by ID. No Caddy restart needed.


### 4. Process Management (PM2)

Per customer site, two PM2 processes:

- `site-{name}` — the production Astro SSR server
- `admin-{name}` — the admin/MCP server (Hono + MCP)

Preview dev servers are child processes of the admin/MCP server, not PM2-managed. Spawned on session start, killed on session end.

On publish, the admin/MCP server runs `npm run build` in the site repo and calls `pm2 restart site-{name}`.

---

## Authentication and Authorization

### How customers connect

1. The agency provisions a site and creates the initial admin account (email + password, set during `add-site.sh`).
2. The site owner navigates to `admin.customer.com` and logs in.
3. From the dashboard, they go to the Tokens page and click "Generate Token."
4. They label the token (e.g., "My Claude Desktop") and the system displays it once.
5. The customer copies the token and configures their MCP client with the server URL (`admin.customer.com/sse`) and the token as a bearer auth header.
6. The AI agent authenticates on every request using this token.

### Token mechanics

Tokens are cryptographically random strings (64+ characters). Stored in the database as bcrypt hashes, never in plaintext. On every MCP request: hash the incoming bearer token, query the `tokens` table by hash. Match found → update `last_used_at`, resolve associated user, proceed. No match → reject with 401.

Tokens can be revoked from the dashboard instantly. The next MCP request with a revoked token fails.

### User roles

- **Admin** — full access: manage users, view all data, generate tokens, perform all MCP operations including publishing.
- **Editor** — can generate their own tokens and perform MCP operations (edit files, start previews), but cannot manage other users or publish. An editor's changes require an admin to publish. (The role distinction is optional for the initial build but the schema should support it from the start.)

### Dashboard auth

Standard session-based authentication. Login with email/password, receive a JWT stored in an httpOnly cookie. Sessions expire after a configurable period (e.g., 24 hours). Hono middleware checks the cookie on every dashboard route.

### What the AI agent sees

The AI agent authenticates via bearer token and never interacts with the login flow. It doesn't know about users, roles, or tokens. The admin/MCP server resolves the user behind the scenes for git attribution and audit logging.

---

## The Editing Session Lifecycle

### Starting a Session

The AI agent calls `start_editing`. The admin/MCP server:

1. Verifies the bearer token and resolves the user
2. Creates a git branch named `preview/{sessionId}` off main
3. Creates a git worktree at `sites/{customer}/previews/{sessionId}/` pointing to that branch
4. Symlinks `node_modules` from the main repo into the worktree (avoids full npm install)
5. Spawns `npx astro dev --host 0.0.0.0 --port {randomPort}` as a child process from the worktree
6. POSTs to Caddy's admin API to route `preview-{sessionId}.admin.customer.com` to that port
7. Logs the session start in the audit log and sessions table, attributed to the user
8. Returns the preview URL to the AI agent

From this point, all file tools operate on the worktree, not the main repo.

### Making Changes

The AI reads files to understand the project, then writes changes. Each write goes to the worktree and is auto-committed with the user's name and email as the git author. The Astro dev server hot-reloads — changes appear at the preview URL in near-realtime.

Every tool call is logged in the audit log.

### Publishing

The AI agent calls `publish_changes`. The admin/MCP server:

1. Commits any remaining uncommitted changes in the worktree
2. Checks out main in the main repo
3. Merges the preview branch with `--no-ff`, attributed to the user
4. Runs `npm run build` in the main repo
5. Calls `pm2 restart site-{name}`
6. Kills the preview child process
7. Removes the Caddy preview route
8. Removes the worktree and deletes the branch
9. Updates the session record (outcome: published)

The site's visitor database is untouched — it persists across publishes.

### Discarding

The AI agent calls `discard_changes`. The admin/MCP server:

1. Kills the preview child process
2. Removes the Caddy preview route
3. Force-removes the worktree and deletes the branch
4. Updates the session record (outcome: discarded)

Nothing reaches production.

### Constraints

- One editing session at a time per site.
- Preview data is throwaway. Persistent content goes in git-tracked files.
- If main is updated while a preview is active, merge conflicts are possible on publish. Handle by rebasing the preview branch before merge or warning the AI agent.

---

## File Access Boundaries

**Readable:** Everything in the project except `.git/`, `node_modules/`, `data/`, and `dist/`.

**Writable directories:**

- `src/pages/` — Astro page templates
- `src/content/` — Markdown, YAML content files, content collection config
- `src/components/` — Reusable UI components
- `src/layouts/` — Layout templates
- `src/styles/` — CSS
- `public/assets/` — Images, fonts, static files
- `backend/` — models.yaml and email templates

**Locked (never writable):**

- `astro.config.mjs`, `package.json`, `package-lock.json`, `tsconfig.json` — agency-owned config
- `node_modules/`, `.git/`, `data/`, `dist/` — infrastructure directories

Path validation includes `../` traversal prevention.

---

## Data Model: models.yaml

Defines runtime data collections for visitor-generated data. Owner content lives as files in `src/content/`.

Each collection has:

**Fields** — typed definitions with validation. Types: text, email, url, richtext, number, boolean, datetime, select (with options), multiselect, file, list, relation. Support for required, default values, max length, min/max, and unique constraints.

**Access rules** — per-operation (create, list, read, update, delete), each set to `public` or `admin`.

**Hooks** — fixed action types triggered after record creation or update: send email (from a template) and call webhook. No arbitrary code.

Database uses SQLite with JSON document pattern. Adding or removing fields requires no migration — the YAML defines validation, not schema. Old records keep their shape, new records get the new shape.

---

## Infrastructure Layout

```
/srv/launchpod/
├── admin-server/                    ← Admin/MCP server (shared code)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 ← Hono app (dashboard routes + MCP SSE)
│       ├── config.ts                ← Path validation, locked/writable dirs
│       ├── session.ts               ← Git, worktree, preview, Caddy mgmt
│       ├── auth.ts                  ← Password hashing, JWT, token validation
│       ├── db.ts                    ← System database (admin.db) management
│       ├── tools/
│       │   ├── files.ts             ← list_files, read_file, write_file, delete_file
│       │   └── session.ts           ← start_editing, publish, discard, status
│       └── dashboard/
│           ├── routes.ts            ← Hono routes for dashboard pages
│           ├── views/               ← Server-rendered HTML (Hono JSX)
│           │   ├── login.tsx
│           │   ├── home.tsx
│           │   ├── users.tsx
│           │   ├── tokens.tsx
│           │   ├── data.tsx
│           │   └── audit.tsx
│           └── static/              ← CSS, client-side JS for dashboard
├── site-template/                   ← Template Astro project
│   ├── astro.config.mjs
│   ├── package.json
│   ├── backend/
│   │   └── models.yaml
│   └── src/
│       ├── content/
│       ├── layouts/
│       ├── pages/
│       ├── components/
│       ├── styles/
│       └── lib/launchpod/             ← Embedded library (db, validation, CRUD)
├── sites/
│   ├── acme/
│   │   ├── repo/                    ← Git repo (the Astro project)
│   │   ├── previews/                ← Worktrees for active editing sessions
│   │   └── data/
│   │       ├── site.db              ← Visitor data (owned by site server)
│   │       ├── admin.db             ← System data (owned by admin/MCP server)
│   │       └── uploads/             ← Visitor file uploads
│   └── bakery/
│       ├── repo/
│       ├── previews/
│       └── data/
├── caddy/
│   └── Caddyfile
├── scripts/
│   └── add-site.sh
└── setup.sh
```

The admin/MCP server code is shared — each customer's PM2 process runs the same built code with different environment variables (`SITE_DIR`, `SITE_DOMAIN`, `ADMIN_PORT`, `ADMIN_DB_PATH`, `SITE_DB_PATH`).

Port allocation: site servers start at 4000+. Admin/MCP servers start at 3100+. Preview dev servers use random ports in the 5000–9000 range.

The `data/` directory lives outside the git repo. Both databases and uploads persist there, independent of code deployments.

---

## Setup and Provisioning

### Initial VPS Setup

`setup.sh` installs on a fresh Ubuntu VPS: Node.js 22, PM2 (with systemd startup), Caddy (from official APT repo), Git. It installs the admin/MCP server's npm dependencies, compiles the TypeScript, and copies the base Caddyfile.

### Adding a Customer Site

`scripts/add-site.sh` takes: site name, domain, admin email, admin password. It:

1. Copies `site-template/` into `sites/{name}/repo/`
2. Creates `sites/{name}/data/` for databases and uploads
3. Initializes a git repo in `repo/` and makes the initial commit
4. Runs `npm install` and `npm run build` in the repo
5. Initializes `admin.db` with system tables (users, tokens, audit_log, sessions) and seeds the initial admin user with the provided credentials
6. Appends Caddy blocks: `customer.com` → site port, `admin.customer.com` → admin port (SSE-compatible), `preview-*.admin.customer.com` → fallback 404
7. Reloads Caddy
8. Starts PM2 processes: `site-{name}` and `admin-{name}`
9. Saves PM2 process list

After this: site live at `customer.com`, dashboard at `admin.customer.com`, MCP at `admin.customer.com/sse`.

### DNS Requirements

Per customer domain:

- A record: `customer.com` → VPS IP
- A record: `admin.customer.com` → VPS IP
- Wildcard A record: `*.admin.customer.com` → VPS IP (for preview subdomains)

---

## What Needs to Be Built

The prototype includes file tools, session management, Caddy integration, and path validation. The following needs to be completed:

### Admin/MCP Server — Auth System

Password hashing with bcrypt. JWT creation and validation for dashboard sessions (httpOnly cookies). Token generation: cryptographically random 64-character strings, stored as bcrypt hashes. Token validation middleware for MCP routes: hash incoming bearer token, look up in `tokens` table, resolve user. Token revocation (set `revoked_at`, immediately effective). Login/logout endpoints. Middleware on all dashboard routes checking the session cookie. Middleware on all MCP routes checking the bearer token. Initial admin user seeding as part of the add-site script.

### Admin/MCP Server — Dashboard UI

Server-rendered HTML pages using Hono's JSX support, served from the admin/MCP server. Minimal client-side JavaScript — only what's needed for interactive elements like confirmation dialogs, copy-to-clipboard for tokens, and table sorting/filtering.

Pages needed: Login (email/password form). Home (status overview, recent audit entries). Users (table of users, invite form, role dropdown, deactivate toggle — admin only). Tokens (table of current user's tokens with labels and last-used, generate button that shows token once, revoke button). Data (reads `backend/models.yaml` from the site repo to discover collections, reads `site.db` to display records — sortable tables with pagination and filtering, inline status updates, CSV export). Audit log (filterable list of tool calls: user, action, detail, timestamp). Session history (past sessions: user, start time, file count, outcome).

Styling: keep it simple and functional. A utility CSS approach (Tailwind via CDN, or a small custom stylesheet) is fine. This is an internal tool, not a marketing site.

### Admin/MCP Server — Audit Logging

Every MCP tool call logged to `audit_log`: user_id, tool name, parameters (file path, commit message), timestamp. Session lifecycle events (start, publish, discard) logged as well. Dashboard displays this as a filterable, paginated timeline.

### Admin/MCP Server — Git Author Attribution

Git commits during editing sessions should use the authenticated user's name and email from the `users` table as the git author, not a generic "launchpod" identity. Set via `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` environment variables on the child process, or via `-c user.name=... -c user.email=...` flags on git commands.

### Admin/MCP Server — Session Timeout

Auto-kill preview sessions after a configurable inactivity period (default 30 minutes). Track last tool call timestamp per session. Run a periodic check (setInterval) that cleans up expired sessions: kill dev server, remove Caddy route, remove worktree, delete branch, log the timeout.

### Admin/MCP Server — Build Error Handling

When `publish_changes` triggers `npm run build` and it fails (the AI wrote invalid code): revert the merge (`git reset --hard` to the pre-merge commit), return the build error output to the AI agent so it can fix the issue, and keep the preview session open so the AI can make corrections and try again.

### Admin/MCP Server — Graceful Shutdown

On SIGTERM: clean up any active preview session (kill dev server, remove Caddy route, remove worktree) before exiting. Prevents orphaned preview processes and stale Caddy routes.

### launchpod Library (embedded in site)

Wire in the `yaml` npm package (replace placeholder parser). Complete validation for all field types. Build the hooks engine: read `on_create`/`on_update` from models.yaml, send emails via SMTP or transactional API (Resend, Postmark), POST to webhook URLs. Implement access control on API routes: the `admin` level should require an auth header. Decide how the admin dashboard authenticates to the site's API: either the admin/MCP server reads `site.db` directly (simpler), or it proxies through the site's API with a shared internal secret.

### Site Template

Flesh out the template into a proper starting point: base layout with clean default design, homepage, about page, blog listing page and dynamic post route wired to Astro content collections, contact page with a form posting to the CRUD API, global styles, default content collection config (blog, services at minimum). Design for AI-editability: clear file organization, consistent patterns, well-commented markup.

### Multi-Tenancy Considerations (future)

The architecture runs one admin/MCP server process per customer. This works well for dozens of sites on a single VPS. For larger scale, consider: a shared admin/MCP server routing by auth token to the correct site directory, resource limits per preview, monitoring and alerting for process health and disk usage, and a management dashboard for the agency to oversee all sites.

---

## Key Design Decisions and Rationale

**Two independent processes with clean separation:** The site is a normal Astro project that works without the management layer. You can ditch launchpod and manage the site manually. This makes debugging easier (is it a site problem or a management problem?), reduces coupling, and means the agency's investment in the site template isn't locked into the launchpod platform.

**Hono + TypeScript for the admin/MCP server:** Hono is lightweight, handles both HTTP routes and SSE streaming well, and its JSX support means the dashboard can be server-rendered without introducing a client-side framework build step. TypeScript provides type safety for the tool definitions and database operations. The MCP TypeScript SDK is first-party and well-maintained. The entire project is JavaScript/TypeScript — no language context-switching.

**MCP as the interface, not a custom chat UI:** The agency doesn't build or maintain a frontend for AI interaction. Customers use whatever MCP client they prefer. Future-proof: better agents and clients emerge, launchpod benefits automatically.

**Astro as the site framework:** File-based routing, built-in content collections with validation, SSR support for dynamic API routes, simple enough for AI agents to work with reliably. Builds to a predictable output — the AI can't introduce unexpected runtime complexity.

**Auth via admin dashboard, tokens for MCP:** Customers manage their own access. No manual token distribution by the agency. Per-user tokens enable audit logging and git attribution. Revocation is instant.

**Git for version control, invisible to the customer:** Every change is tracked. The agency can review, roll back, or audit. The customer never sees git. Worktree-based previews mean production is never at risk during editing.

**SQLite with JSON documents for visitor data:** No migrations. The YAML config defines validation, not schema. Adding a field is a config change. Critical because the AI agent modifies the data model — it should never reason about migration safety.

**Child processes for previews, not containers:** Simpler, faster to start, no Docker dependency. The tradeoff is less isolation, but acceptable for a managed platform where the agency controls the template and the AI operates within enforced boundaries.

**Locked files and writable directory restrictions:** The AI cannot modify build config, install packages, or touch databases directly. It works within the content and presentation layer. This prevents the most dangerous failure modes while giving the AI enough freedom for meaningful changes.

**data/ directory outside the git repo:** Databases and uploads persist independently of code deployments. A publish never risks overwriting visitor data. The site server and admin server each own their own database file in this directory.

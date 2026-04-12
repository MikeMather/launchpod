# LaunchPod

**AI-powered website management platform for dev agencies.**

LaunchPod enables agencies to give non-technical clients an AI interface to manage their websites. Clients use any MCP-compatible AI agent (Claude Desktop, Claude.ai, Cursor) to request changes in plain language. The AI reads files, makes edits, shows previews, and publishes — all without the client knowing git, servers, or code.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Creating a Site](#creating-a-site)
- [How It Works](#how-it-works)
- [Environment Variables](#environment-variables)
- [Technology Stack](#technology-stack)
- [Contributing](#contributing)

---

## Overview

### Key Features

- **MCP Protocol Integration** — Clients connect via any MCP-compatible AI agent
- **Two-Process Architecture** — Site server (Astro SSR) and Admin/MCP server (Hono + MCP SDK) run independently
- **Git-Based Workflow** — All changes tracked via git, with worktree-based preview sessions
- **Admin Dashboard** — Web UI for user management, token generation, data viewing, and audit logs
- **Zero-Downtime Previews** — AI creates isolated preview environments with unique URLs
- **Fine-Grained Access Control** — Per-user MCP tokens with role-based permissions
- **SQLite Data Layer** — Separate databases for system data and visitor data

### What Makes LaunchPod Different

1. **Site Independence** — The customer's website is a standard Astro project that works without the management layer
2. **No Custom Chat UI** — Uses the MCP protocol; customers bring their own AI client
3. **Agency Control** — Locked config files, enforced directory boundaries, audit logging
4. **Future-Proof** — Better AI agents emerge, LaunchPod benefits automatically

---

## Architecture

LaunchPod uses a **two-process architecture** with complete separation between the customer site and the management layer:

### 1. Site Server (Astro SSR)
- **Purpose:** Serves the public-facing website
- **Tech:** Astro SSR with Node.js adapter
- **Database:** `data/site.db` (visitor data: forms, signups, etc.)
- **Knowledge:** Zero awareness of MCP, git, tokens, or the admin layer
- **Port:** 4000+ (auto-assigned per site)

### 2. Admin/MCP Server (Hono + MCP SDK)
- **Purpose:** Management plane with two interfaces:
  - **Admin Dashboard** — Web UI for account management
  - **MCP Endpoint** — AI agent interface at `/mcp`
- **Tech:** TypeScript, Hono HTTP framework, MCP SDK, Better-SQLite3
- **Database:** `data/admin.db` (users, tokens, sessions, audit logs)
- **Access:** Filesystem access to site's git repo
- **Port:** 3100+ (auto-assigned per site)

### Communication
- Share **nothing except the filesystem**
- Admin server reads/writes site repo files
- Admin server reads (but doesn't write) `site.db` for data viewer
- Preview sessions use git worktrees + separate Astro dev servers

---

## Prerequisites

- **Bun** 1.0+ (JavaScript runtime and package manager)
- **Node.js** 22+ (for site server runtime in production)
- **Git** 2.35+
- **PM2** (process manager for production)
- **Caddy** 2.0+ (reverse proxy with automatic HTTPS)
- **Ubuntu** 22.04+ (or similar Linux distro)

### Installing Bun

If you haven't installed Bun yet:

```bash
curl -fsSL https://bun.sh/install | bash
```

Add Bun to your PATH (if not already done):

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

---

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url> /srv/launchpod
cd /srv/launchpod
```

### 2. Install Admin Server Dependencies

```bash
cd admin-server
bun install
```

### 3. Install Site Template Dependencies

```bash
cd ../site-template
bun install
```

### 4. Run Setup Script (Production Only)

For production VPS setup:

```bash
cd /srv/launchpod
bash setup.sh
```

This installs system dependencies (Node.js, PM2, Caddy, Git) and prepares the environment.

---

## Development Workflow

### Option 1: Standalone Development (No Provisioned Site)

**Start Admin Server in Dev Mode:**

```bash
cd /srv/launchpod/admin-server
bun run dev
```

Server runs at `http://localhost:3100` (default).

**Start Site Template in Dev Mode:**

```bash
cd /srv/launchpod/site-template
bun run dev
```

Site runs at `http://localhost:4321` (Astro default).

### Option 2: Full Stack Development (With Provisioned Site)

Create a local test site:

```bash
cd /srv/launchpod
bash scripts/add-site.sh \
  --name devtest \
  --domain devtest.local \
  --admin-email admin@devtest.local \
  --admin-password devpass123 \
  --site-port 4000 \
  --admin-port 3100
```

This provisions a complete site with:
- Git repo at `sites/devtest/repo/`
- Databases at `sites/devtest/data/`
- PM2 processes: `site-devtest` and `admin-devtest`
- Caddy reverse proxy configuration

**View Running Sites:**

```bash
pm2 list
pm2 logs admin-devtest
pm2 logs site-devtest
```

**Access the Dashboard:**

Navigate to `http://localhost:3100` (or your configured admin port).

---

## Project Structure

```
/srv/launchpod/
├── admin-server/                    # Admin/MCP server (shared across all sites)
│   ├── src/
│   │   ├── index.ts                 # Hono app entry point
│   │   ├── config.ts                # Path validation, environment config
│   │   ├── db.ts                    # System database management
│   │   ├── auth.ts                  # JWT, bcrypt, token validation
│   │   ├── session.ts               # Git worktree, preview, Caddy mgmt
│   │   ├── mcp.ts                   # MCP SSE transport setup
│   │   ├── tools/
│   │   │   ├── files.ts             # MCP tools: list, read, write, delete
│   │   │   └── session.ts           # MCP tools: start, publish, discard
│   │   └── dashboard/
│   │       ├── routes.tsx           # Dashboard HTTP routes
│   │       └── views/               # Server-rendered JSX views
│   │           ├── login.tsx
│   │           ├── home.tsx
│   │           ├── tokens.tsx
│   │           └── ...
│   ├── package.json
│   └── tsconfig.json
│
├── site-template/                   # Template Astro project
│   ├── src/
│   │   ├── content/                 # Content collections (blog, services, etc.)
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── components/
│   │   └── lib/launchpod/           # Embedded library (db, CRUD, validation)
│   ├── backend/
│   │   ├── models.yaml              # Visitor data collection definitions
│   │   └── email-templates/
│   ├── public/
│   ├── astro.config.mjs
│   ├── package.json
│   └── tsconfig.json
│
├── sites/                           # Customer sites (created via add-site.sh)
│   ├── {name}/
│   │   ├── repo/                    # Git repo (copy of site-template)
│   │   ├── data/
│   │   │   ├── admin.db             # System database
│   │   │   ├── site.db              # Visitor data database
│   │   │   └── uploads/             # User-uploaded files
│   │   ├── previews/                # Git worktrees for editing sessions
│   │   └── ecosystem.config.cjs     # PM2 config for this site
│
├── scripts/
│   ├── add-site.sh                  # Provision new customer site
│   ├── remove-site.sh               # Remove a site
│   └── seed-db.js                   # Seed admin database with initial user
│
├── caddy/
│   └── Caddyfile.base               # Base Caddy config
│
├── setup.sh                         # VPS initial setup script
├── PROJECT.md                       # Detailed architecture documentation
├── TASKS.md                         # Development task tracker
└── README.md                        # This file
```

---

## Creating a Site

### Manual Provisioning

```bash
bash scripts/add-site.sh \
  --name mysite \
  --domain mysite.com \
  --admin-email admin@mysite.com \
  --admin-password 'securepassword123' \
  --site-port 4000 \
  --admin-port 3100
```

**Arguments:**
- `--name` — Site identifier (alphanumeric, hyphens, underscores)
- `--domain` — Primary domain (e.g., `example.com`)
- `--admin-email` — Initial admin user email
- `--admin-password` — Initial admin user password (min 8 characters)
- `--site-port` — (Optional) Site server port, auto-assigned if omitted
- `--admin-port` — (Optional) Admin server port, auto-assigned if omitted

### What Happens

1. **Directory Structure** — Creates `sites/{name}/repo`, `data`, `previews`
2. **Template Copy** — Copies `site-template/` to `repo/`
3. **Git Init** — Initializes git repo with initial commit
4. **Dependencies** — Runs `bun install` and `bun run build`
5. **Database Seed** — Creates `admin.db` with initial user account
6. **Caddy Config** — Appends reverse proxy blocks to Caddyfile
7. **PM2 Start** — Launches `site-{name}` and `admin-{name}` processes

### DNS Requirements

Before provisioning, configure DNS:

- **A record:** `mysite.com` → VPS IP
- **A record:** `admin.mysite.com` → VPS IP
- **Wildcard A record:** `*.admin.mysite.com` → VPS IP (for previews)

---

## How It Works

### Customer Workflow

1. **Login** — Customer navigates to `admin.mysite.com` and logs in
2. **Generate Token** — From the Tokens page, generates an MCP token
3. **Configure AI Agent** — Adds MCP server config to Claude Desktop/Cursor:
   - **Server URL:** `https://admin.mysite.com/mcp`
   - **Auth:** Bearer token
4. **Request Changes** — Customer asks the AI: "Add a new blog post about our latest product"
5. **AI Workflow:**
   - Calls `start_editing` → Creates git branch + worktree, spawns preview server
   - Calls `list_files`, `read_file` → Understands project structure
   - Calls `write_file` → Creates new blog post markdown file
   - Returns preview URL → Customer reviews changes live
   - Customer approves → Calls `publish_changes` → Merges to main, rebuilds, restarts production
6. **Live Update** — Site updates at `mysite.com` within seconds

### Editing Session Lifecycle

**Start Session (`start_editing`):**
1. Authenticate bearer token → Resolve user
2. Create git branch: `preview/{sessionId}`
3. Create git worktree at `sites/{name}/previews/{sessionId}/`
4. Symlink `node_modules` to avoid re-install
5. Spawn Astro dev server on random port (5000–9000)
6. POST to Caddy API: Route `preview-{sessionId}.admin.mysite.com` to dev server
7. Log session start in audit log
8. Return preview URL to AI

**Make Changes:**
- AI calls `write_file` → File written to worktree
- Auto-committed to preview branch with user attribution
- Astro dev server hot-reloads → Changes visible instantly at preview URL

**Publish (`publish_changes`):**
1. Commit any uncommitted changes
2. Merge preview branch into `main` (no fast-forward)
3. Run `bun run build` in main repo
4. If build succeeds → Restart PM2 process `site-{name}`
5. If build fails → Revert merge, return error to AI, keep preview open
6. Kill preview dev server, remove Caddy route, delete worktree

**Discard (`discard_changes`):**
1. Kill preview dev server
2. Remove Caddy route
3. Force-delete worktree and branch
4. Update session record: `outcome = 'discarded'`

---

## Environment Variables

### Admin/MCP Server

Set per site via PM2 ecosystem config:

| Variable | Description | Example |
|----------|-------------|---------|
| `SITE_DIR` | Path to site's git repo | `/srv/launchpod/sites/mysite/repo` |
| `SITE_DOMAIN` | Primary domain | `mysite.com` |
| `ADMIN_PORT` | Admin server port | `3100` |
| `ADMIN_DB_PATH` | System database path | `/srv/launchpod/sites/mysite/data/admin.db` |
| `SITE_DB_PATH` | Visitor database path | `/srv/launchpod/sites/mysite/data/site.db` |
| `SITE_NAME` | Site identifier | `mysite` |
| `JWT_SECRET` | Secret for dashboard sessions | (random 64-char hex) |
| `NODE_ENV` | Environment | `production` or `development` |

### Site Server

| Variable | Description | Example |
|----------|-------------|---------|
| `HOST` | Bind address | `127.0.0.1` |
| `PORT` | Site server port | `4000` |
| `SITE_DB_PATH` | Visitor database path | `/srv/launchpod/sites/mysite/data/site.db` |
| `NODE_ENV` | Environment | `production` |

---

## Technology Stack

### Admin/MCP Server
- **Runtime:** Bun (development), Node.js (production)
- **HTTP Framework:** [Hono](https://hono.dev/) — Fast, lightweight, supports SSE
- **MCP SDK:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Database:** [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Auth:** bcrypt (password hashing), jsonwebtoken (JWT sessions)
- **Rendering:** Hono JSX (server-rendered HTML)

### Site Server
- **Framework:** [Astro](https://astro.build/) 6.x (SSR mode)
- **Adapter:** @astrojs/node
- **Data Layer:** Custom embedded library (`src/lib/launchpod/`)
- **Database:** SQLite with JSON document pattern
- **Content:** Markdown + YAML with Astro content collections

### Infrastructure
- **Process Manager:** PM2
- **Reverse Proxy:** Caddy 2.x
- **Version Control:** Git (with worktrees for previews)

---

## Development Commands

### Admin Server

```bash
cd admin-server

# Install dependencies
bun install

# Run in development mode (auto-reload)
bun run dev

# Build for production
bun run build

# Start production build
bun run start
```

### Site Template

```bash
cd site-template

# Install dependencies
bun install

# Run dev server (port 4321)
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview
```

### Site Management

```bash
# Add a new site
bash scripts/add-site.sh --name mysite --domain mysite.com \
  --admin-email admin@example.com --admin-password password123

# Remove a site
bash scripts/remove-site.sh --name mysite

# View PM2 processes
pm2 list

# View logs
pm2 logs admin-mysite
pm2 logs site-mysite

# Restart a site
pm2 restart site-mysite
pm2 restart admin-mysite
```

---

## File Access Boundaries

The MCP endpoint enforces strict path validation to prevent the AI from modifying critical files.

### Readable Directories
Everything except:
- `.git/`
- `node_modules/`
- `data/`
- `dist/`

### Writable Directories
- `src/pages/` — Page templates
- `src/content/` — Content collections (blog, services, etc.)
- `src/components/` — UI components
- `src/layouts/` — Layout templates
- `src/styles/` — CSS files
- `public/assets/` — Static files (images, fonts)
- `backend/` — models.yaml and email templates

### Locked (Never Writable)
- `astro.config.mjs`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `node_modules/`
- `.git/`
- `data/`
- `dist/`

Path traversal (`../`) is blocked.

---

## Database Schema

### System Database (`admin.db`)

**users**
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'editor',  -- 'admin' or 'editor'
  created_at INTEGER NOT NULL,
  deactivated_at INTEGER
);
```

**tokens**
```sql
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**audit_log**
```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**sessions**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  preview_url TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,  -- 'published' or 'discarded'
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Visitor Database (`site.db`)

Dynamic schema based on `backend/models.yaml`. Each collection becomes a table with:

```sql
CREATE TABLE {collection_name} (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,  -- JSON document
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## Contributing

### Development Principles

1. **Maintain Process Independence** — Site server must work without admin layer
2. **Enforce Path Restrictions** — Never allow AI to modify locked files
3. **Audit Everything** — Log all MCP tool calls with user attribution
4. **Git Commits** — Attribute to authenticated user, not "launchpod"
5. **Build Validation** — On publish, revert merge if build fails

### Code Style

- **TypeScript** everywhere
- **Explicit types** preferred over inference
- **Functional patterns** where practical
- **Error handling** — Always return descriptive errors to AI agent

### Testing

Currently manual testing. Future: automated integration tests for MCP tools.

---

## Support & Documentation

- **Detailed Architecture:** See [PROJECT.md](PROJECT.md)
- **Task Tracker:** See [TASKS.md](TASKS.md)
- **MCP Protocol:** https://modelcontextprotocol.io/

---

## License

[Add your license here]

---

**Built with Bun, Hono, Astro, and the Model Context Protocol.**

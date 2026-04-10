# launchpod — Task Breakdown

This document breaks the project into concrete, actionable tasks organized by workstream. Tasks are ordered by dependency — within each workstream, later tasks generally depend on earlier ones. Cross-workstream dependencies are noted where they exist.

---

## Workstream 1: Admin/MCP Server — Project Scaffolding

### 1.1 Initialize the TypeScript + Hono project

Set up the `admin-server/` directory with a TypeScript project. Configure the tsconfig for Node.js with ESM modules. Add Hono, `@modelcontextprotocol/sdk`, `better-sqlite3`, and their type definitions as dependencies. Set up a build step (tsc or tsup) that compiles to a `dist/` directory. Add a dev script with watch mode for local development. Verify the project compiles and a basic Hono server starts and responds to a health check request.

### 1.2 Define the environment variable contract

Document and implement the configuration module that reads environment variables. The server needs: `SITE_DIR` (path to the customer's git repo), `SITE_DOMAIN` (the customer's domain), `ADMIN_PORT` (port this server listens on), `ADMIN_DB_PATH` (path to admin.db), `SITE_DB_PATH` (path to site.db), and `CADDY_ADMIN_URL` (Caddy's admin API endpoint, defaults to `http://localhost:2019`). Validate that required variables are present on startup and fail fast with clear error messages if not.

### 1.3 Set up the path validation module

Implement the config/path validation logic. Define the lists of writable directories, locked files, and locked directories. Implement the `validatePath` function that normalizes a path, resolves it relative to the site directory, prevents traversal attacks, checks against locked paths, and optionally enforces the writable directory restriction. This module is used by all file tools.

### 1.4 Wire up the Hono HTTP server with route groups

Set up the Hono app with separate route groups for: dashboard pages (`/` and `/admin/*`), dashboard API (`/admin/api/*`), MCP SSE transport (`/sse` and `/messages`), and health check (`/health`). At this stage, routes can return placeholder responses. The goal is to establish the routing structure that all subsequent work plugs into.

---

## Workstream 2: Admin/MCP Server — System Database

### 2.1 Initialize the system database module

Create the `db.ts` module that opens or creates `admin.db` using `better-sqlite3`. On first run, create the four tables: `users` (id, email, name, password_hash, role, created_at, deactivated_at), `tokens` (id, user_id, token_hash, label, created_at, last_used_at, revoked_at), `audit_log` (id, user_id, action, detail, created_at), and `sessions` (id, user_id, branch, preview_url, started_at, ended_at, outcome). Use `IF NOT EXISTS` so the initialization is idempotent.

### 2.2 Implement user CRUD operations

Write functions for: creating a user (hash password with bcrypt, insert row), finding a user by email, finding a user by id, listing all users, updating a user's role, deactivating a user (set `deactivated_at`). These are called by the auth system and the dashboard's user management page.

### 2.3 Implement token operations

Write functions for: generating a token (create a cryptographically random 64-character string, hash it with bcrypt, store the hash along with user_id and label, return the plaintext token), validating a token (hash the incoming string, query by hash, check `revoked_at` is null, update `last_used_at`, return the associated user), revoking a token (set `revoked_at` to now), and listing tokens for a user (return label, created_at, last_used_at — never return the hash).

Note on bcrypt and token lookup: bcrypt produces different hashes for the same input, so you cannot query by `token_hash = bcrypt(input)`. Instead, use a fast hash (SHA-256) for the stored token hash (since tokens are already high-entropy random strings, unlike passwords) and bcrypt only for user passwords. Alternatively, store a prefix of the token in cleartext for lookup and use a constant-time comparison on the full hash. Decide on the approach during implementation.

### 2.4 Implement audit log operations

Write functions for: logging an action (insert user_id, action name, detail string, timestamp), querying the log with filters (by user, by action type, by date range) and pagination. Keep the detail field flexible — it stores the file path for file operations, the commit message for publishes, etc.

### 2.5 Implement session record operations

Write functions for: creating a session record (insert user_id, branch, preview_url, started_at), ending a session (set ended_at and outcome), and listing past sessions with pagination. These are for the dashboard's session history view; the in-memory session state for the active preview is managed separately by the session manager.

---

## Workstream 3: Admin/MCP Server — Authentication

### 3.1 Implement password auth and JWT sessions

Build the auth module. It needs: a function to verify a password against a bcrypt hash, a function to create a JWT containing the user id and role (signed with a secret from an environment variable or generated on first run and persisted), a function to verify and decode a JWT, and a function to extract a JWT from an httpOnly cookie. Configure JWT expiration (default 24 hours, configurable).

### 3.2 Build the login and logout endpoints

Create POST `/admin/api/login` that accepts email and password, verifies credentials, creates a JWT, and sets it as an httpOnly secure cookie. Create POST `/admin/api/logout` that clears the cookie. Handle error cases: wrong email, wrong password, deactivated user. Redirect to the dashboard home on success.

### 3.3 Build the dashboard auth middleware

Create Hono middleware that runs on all `/admin/*` routes (except the login page and login API endpoint). It extracts the JWT from the cookie, verifies it, looks up the user, and attaches the user object to the Hono context. If the JWT is missing, invalid, or expired, redirect to the login page. If the user has been deactivated since the JWT was issued, reject.

### 3.4 Build the MCP token auth middleware

Create Hono middleware that runs on the `/sse` and `/messages` routes. It extracts the bearer token from the `Authorization` header, validates it against the tokens table (using the approach decided in task 2.3), and attaches the resolved user to the request context. If the token is missing, invalid, or revoked, return 401. Update the token's `last_used_at` on successful validation.

### 3.5 Implement admin-only route protection

Create middleware or a utility that checks the authenticated user's role. Apply it to routes that require admin access: user management pages and endpoints. Editors should see a 403 or be redirected if they try to access admin-only pages.

---

## Workstream 4: Admin/MCP Server — MCP Tools

Depends on: Workstream 1 (project scaffolding), Workstream 3 (token auth middleware).

### 4.1 Set up the MCP server and SSE transport

Initialize the MCP server using `@modelcontextprotocol/sdk`. Wire it into the Hono app so that `GET /sse` establishes the SSE stream and `POST /messages` receives tool call messages. Handle connection lifecycle: track active transports by session ID, clean up on disconnect. Pass the authenticated user (resolved by the token middleware) through to the tool handlers so every tool call has access to the user context.

### 4.2 Implement `list_files`

Accept an optional relative path and a depth parameter. Resolve the path against the current working directory (worktree if a session is active, main repo otherwise). Build a text tree view of the directory, filtering out `.git`, `node_modules`, `data`, and `dist`. Sort entries with directories first. Return the tree as text content.

### 4.3 Implement `read_file`

Accept a relative path. Validate it using the path validation module (read access — not locked directories). Resolve against the working directory. Check the file exists and is not a directory. Return the file contents as text. Handle errors: file not found, path is a directory, path outside project.

### 4.4 Implement `write_file`

Accept a relative path and content string. Validate the path requires writable access (must be in an allowed directory, must not be a locked file). Resolve against the working directory. Create parent directories if needed. Write the content. If an editing session is active, stage and commit the change to the preview branch with the authenticated user as the git author. Log the action to the audit log. Return confirmation with the file path and byte count.

### 4.5 Implement `delete_file`

Accept a relative path. Same validation as write. Unlink the file. Auto-commit if in a session. Log to audit. Return confirmation.

### 4.6 Implement `get_site_status`

Return the site's domain URL, file counts for key directories (pages, content, components), and whether an editing session is currently active. Does not require an active session.

### 4.7 Integrate audit logging into all tools

Ensure every tool call writes to the audit log with the resolved user id, the tool name, and a detail string (the file path for file tools, the session ID for session tools, the commit message for publish). This should be a wrapper or middleware around all tool handlers rather than duplicated in each one.

---

## Workstream 5: Admin/MCP Server — Session Management

Depends on: Workstream 4 (file tools, because file tools need to know the working directory).

### 5.1 Implement the session manager

Build the session manager class that tracks the active editing session (one at a time). It holds: session ID, branch name, worktree path, preview port, preview child process reference, preview URL, the user who started it, start time, and last activity timestamp. Expose `getWorkingDir()` that returns the worktree path if a session is active, otherwise the main repo path. This is called by all file tools to determine where to read/write.

### 5.2 Implement `start_editing`

Reject if a session is already active. Generate a session ID. Create a git branch `preview/{sessionId}` off main. Create a git worktree at the previews directory. Symlink `node_modules` from the main repo into the worktree. Create a `data/` directory in the worktree. Spawn `npx astro dev` as a child process on a random port in the 5000–9000 range, running from the worktree. Capture stdout/stderr from the child process for logging. POST to Caddy's admin API to add a route for `preview-{sessionId}.admin.{domain}` pointing to the preview port. Record the session in the database. Log to audit. Return the preview URL.

Handle failure at each step: if the Caddy route fails, kill the child process and clean up the worktree and branch. If the child process fails to start, clean up the worktree and branch. Always leave a clean state on failure.

### 5.3 Implement git operations with user attribution

Build the git helper functions used by the session manager and file tools. These wrap `execSync` calls to git. When committing during an editing session, set the author to the authenticated user's name and email (from the users table). Use `git -c user.name="..." -c user.email="..."` flags on commit commands. Implement: branch creation, worktree add/remove, stage all changes, commit with message and author, checkout, merge with `--no-ff`, branch deletion, and reset to a specific commit (for build failure recovery).

### 5.4 Implement `publish_changes`

Reject if no session is active. Stage and commit any remaining changes in the worktree. Record the pre-merge commit hash of main (needed for rollback if build fails). Checkout main. Merge the preview branch with `--no-ff` and attribute the merge to the user. Run `npm run build` in the main repo with a timeout. If the build succeeds: call `pm2 restart site-{name}`, clean up the preview (kill child process, remove Caddy route, remove worktree, delete branch), update the session record to "published", log to audit. If the build fails: reset main to the pre-merge commit hash, return the build error output to the AI agent, keep the preview session alive so the AI can fix the issue.

### 5.5 Implement `discard_changes`

Reject if no session is active. Kill the preview child process. Remove the Caddy route. Force-remove the worktree. Delete the branch. Checkout main. Update the session record to "discarded". Log to audit.

### 5.6 Implement `get_session_status` and `get_preview_url`

Return the current session state: active or not, session ID, preview URL, start time, the user who started it. `get_preview_url` is a convenience that just returns the URL.

### 5.7 Implement Caddy route management

Build functions that interact with Caddy's admin API. Add route: POST to `/config/apps/http/servers/srv0/routes` with a JSON payload containing the route ID, host match, and reverse proxy upstream with disabled buffering (for hot-reload SSE). Remove route: DELETE to `/id/preview-{sessionId}`. Handle failures gracefully — if Caddy is unreachable, log a warning but don't crash. The preview will still work via direct port access for debugging.

### 5.8 Implement session timeout

Track `lastActivityAt` on the session object, updated on every tool call. Set up a periodic check (every 60 seconds) that compares `lastActivityAt` to the current time. If the inactivity threshold is exceeded (configurable, default 30 minutes), run the full discard cleanup. Log the timeout event to the audit log with a note that it was an automatic timeout, not a user-initiated discard.

### 5.9 Implement graceful shutdown

Register a SIGTERM handler. When received: if a session is active, run the full discard cleanup (kill child, remove Caddy route, remove worktree, delete branch). Then exit. Also clean up any active SSE transports. This prevents orphaned preview processes and stale Caddy routes when PM2 restarts the admin server.

---

## Workstream 6: Admin/MCP Server — Dashboard UI

Depends on: Workstream 2 (database), Workstream 3 (auth).

### 6.1 Set up the dashboard layout and styling

Create a base HTML layout template in Hono JSX. Include a navigation sidebar or top bar with links to: Home, Users, Tokens, Data, Audit Log, Sessions. Show the logged-in user's name and a logout button. Set up styling — either Tailwind via CDN or a small hand-written CSS file served from the static directory. The design should be clean and functional, not fancy. Every dashboard page renders inside this layout.

### 6.2 Build the login page

A standalone page (no layout sidebar) with an email and password form. Submits to the login endpoint. Displays error messages for invalid credentials. Redirects to the dashboard home on success.

### 6.3 Build the dashboard home page

Shows a status overview: the site's live URL (as a clickable link), last publish time (from the sessions table), whether an editing session is currently active (and if so, who started it and the preview URL), and the 10 most recent audit log entries in a compact list.

### 6.4 Build the users page (admin only)

A table listing all users: email, name, role, created date, status (active/deactivated). An "Invite User" form that accepts email, name, and role, and creates a new user with a generated temporary password (displayed once) or sends an invite email. A dropdown or toggle to change a user's role. A button to deactivate/reactivate a user. Only accessible to admin-role users. Editors see a 403 or redirect.

### 6.5 Build the tokens page

Shows a table of the current user's tokens: label, created date, last used date, and a "Revoke" button per row. A "Generate Token" button that opens a form for the token label, calls the token generation endpoint, and displays the plaintext token exactly once with a copy-to-clipboard button and a warning that it won't be shown again. After the user dismisses the dialog, only the label and metadata are visible.

### 6.6 Build the data viewer page

This page reads the site's `backend/models.yaml` from the repo directory (using the filesystem, not the site's API) to discover what collections exist and what fields they have. It also reads the site's `data/site.db` to query records.

Display a collection selector (tabs or dropdown) listing all collections from models.yaml. For each collection, show a paginated table with columns derived from the field definitions. Support sorting by column and basic filtering (at minimum, filter by select/status fields). Each row should be expandable or clickable to show the full record. For collections with a `status` field, allow inline updates (e.g., marking a contact submission as "read" — this writes directly to site.db). Include a "Download CSV" button that exports the current collection's records.

Note: this page reads site.db directly rather than going through the site's API. This is simpler and avoids needing an internal auth mechanism between the admin server and the site server.

### 6.7 Build the audit log page

A paginated, filterable list of audit log entries. Each entry shows: timestamp, user name, action (tool name), and detail. Filters: by user (dropdown), by action type (dropdown), by date range. Default to showing the most recent entries first.

### 6.8 Build the session history page

A paginated list of past editing sessions. Each entry shows: user name, start time, end time, outcome (published/discarded/timed out), and number of audit log entries associated with that session (as a rough proxy for "number of changes"). Clicking a session could expand to show the audit log entries for that session.

---

## Workstream 7: Site Template — Astro Project

This workstream can proceed in parallel with the admin/MCP server work.

### 7.1 Scaffold the Astro project

Initialize a new Astro project with SSR mode and the Node.js adapter. Configure the locked files: `astro.config.mjs` (SSR mode, node adapter, host/port from env vars), `package.json` (with Astro, the node adapter, `better-sqlite3`, and the `yaml` package as dependencies), and `tsconfig.json`. Set up the directory structure: `src/pages/`, `src/content/`, `src/components/`, `src/layouts/`, `src/styles/`, `src/lib/launchpod/`, `backend/`, `public/assets/`. Add a `.gitignore` that excludes `node_modules/`, `dist/`, and `data/`.

### 7.2 Create the base layout

Build `src/layouts/Base.astro` — a full HTML layout with a head (meta tags, title, link to global stylesheet) and a body with a header, main content slot, and footer. The header should include a site title/logo area and a navigation bar. The footer should have basic info. Keep it clean, semantic, and well-commented so AI agents can easily understand and modify it.

### 7.3 Create global styles

Set up `src/styles/global.css` with sensible defaults: CSS reset or normalize, typography scale, color custom properties, basic responsive layout utilities. The style should be clean and neutral — the agency will customize it per customer. Avoid using a CSS framework that would complicate AI editing; plain CSS with custom properties is most AI-friendly.

### 7.4 Build the homepage

Create `src/pages/index.astro`. Include a hero section, a services overview (pulling from the services content collection), a recent blog posts section (pulling from the blog content collection), and a contact CTA. Use the base layout. All sections should be clearly marked with comments explaining what they are and how to modify them.

### 7.5 Build the about page

Create `src/pages/about.astro`. A simple content page with a heading, body text, and optionally a team section (pulling from a team content collection). Demonstrate the pattern of a static page that an AI agent would modify by editing the Astro template directly.

### 7.6 Set up Astro content collections

Create `src/content/config.ts` with schemas for at least: `blog` (type: content — markdown files with frontmatter for title, slug, date, author, featured_image, published, description, tags), `services` (type: data — YAML files with title, description, price, image, sort_order), and `team` (type: data — YAML files with name, role, bio, photo, sort_order). Add sample content files: two or three blog posts as markdown, two or three services as YAML, and two team members as YAML.

### 7.7 Build the blog listing page

Create `src/pages/blog/index.astro`. Query the blog content collection, filter to published posts, sort by date descending, and render a list of post cards with title, date, description, and a link to the full post. Use the base layout.

### 7.8 Build the dynamic blog post page

Create `src/pages/blog/[...slug].astro`. Fetch a single blog post by slug from the content collection. Render the full markdown content with the title, date, author, and featured image. Handle 404 if the slug doesn't match any post. Use the base layout.

### 7.9 Build the contact page

Create `src/pages/contact.astro`. Include a contact form with fields for name, email, and message. The form submits via JavaScript `fetch` to `/api/contact_submissions` (the auto-generated CRUD endpoint). Show a success message on submission. This page demonstrates the pattern of a frontend form connected to the launchpod data layer.

---

## Workstream 8: launchpod Library (Embedded in Site)

### 8.1 Implement the YAML parser integration

Replace the placeholder YAML parser in `src/lib/launchpod/yaml.ts` with the `yaml` npm package. Export `parse` and `stringify` functions. Write a loader function that reads `backend/models.yaml` from disk, parses it, and returns the typed config object. Handle the case where models.yaml doesn't exist (return empty collections).

### 8.2 Implement the database initialization module

Create `src/lib/launchpod/db.ts`. On first call, open the SQLite database at the path from the `SITE_DB_PATH` environment variable (or default to `data/site.db`). Enable WAL mode. Read the parsed models.yaml. For each collection, execute `CREATE TABLE IF NOT EXISTS` with the JSON document schema (id, data, created_at, updated_at). For fields marked `unique`, create unique indexes on `json_extract(data, '$.fieldName')`. This runs on every startup and is idempotent.

### 8.3 Implement the validation module

Create `src/lib/launchpod/validation.ts`. Given a record (object) and a collection's field definitions from models.yaml, validate: required fields are present and non-empty, text/richtext/email/url fields are strings, email fields contain @, url fields parse as valid URLs, numbers are numbers within min/max, booleans are booleans, select values are in the allowed options list, datetime values parse as valid dates. Return an array of error strings (empty if valid). Apply defaults for missing fields that have a default defined.

### 8.4 Implement the CRUD operations module

Create `src/lib/launchpod/crud.ts`. Implement: `listRecords` (query with json_extract for filtering, sorting, pagination — returns items array plus total/pages metadata), `getRecord` (by id), `createRecord` (validate, apply defaults, generate id, insert), `updateRecord` (read existing, merge, validate, update), `deleteRecord` (delete by id, return boolean). All functions take the collection name and use the database module. Parse the JSON `data` column on read, stringify on write.

### 8.5 Wire up the CRUD API routes

Implement the catch-all Astro API routes at `src/pages/api/[collection]/index.ts` (handles GET for list and POST for create) and `src/pages/api/[collection]/[id].ts` (handles GET for single record, PATCH for update, DELETE for delete). Each route: looks up the collection in models.yaml, returns 404 if not found, checks access rules (public vs admin — for now, skip admin auth and just check the rule exists), calls the appropriate CRUD function, and returns JSON responses with appropriate status codes.

### 8.6 Implement the hooks engine

Create `src/lib/launchpod/hooks.ts`. After `createRecord` or `updateRecord` succeeds, read the collection's `on_create` or `on_update` hooks from models.yaml. For each hook: if the action is `email`, load the template from `backend/email-templates/{template}.html`, substitute variables (`{{ record.fieldName }}`), and send via an SMTP transport or a transactional email API (Resend, Postmark — the provider is configured via environment variable). If the action is `webhook`, make a POST request to the configured URL with the record as the JSON body. Hooks execute asynchronously — don't block the API response. Log hook failures to stderr but don't fail the request.

### 8.7 Implement access control for admin-level API routes

For collections with `admin` access rules, the API route should check for an `Authorization` header with a valid token. Decide the mechanism: either the admin/MCP server passes a shared internal secret when it proxies requests, or (simpler, since the admin dashboard reads site.db directly) the admin-level API routes are only called by visitors with special access. For the initial build, it's acceptable to leave admin-level routes protected by a simple shared secret in an environment variable, with the expectation that these routes are primarily for the admin dashboard's data viewer to update records (like marking submissions as read).

---

## Workstream 9: Infrastructure Scripts

### 9.1 Write the VPS setup script

`setup.sh` should: detect the OS (Ubuntu 22.04+), install Node.js 22 via nodesource, install PM2 globally and configure it for systemd startup, install Caddy from the official APT repository, install git if not present, create the `/srv/launchpod/` directory structure, install npm dependencies for the admin server, compile the admin server TypeScript, copy the base Caddyfile to `/etc/caddy/Caddyfile`, and start Caddy. Include error handling and idempotency (running the script twice should be safe).

### 9.2 Write the base Caddyfile

The base Caddyfile should enable Caddy's admin API on `localhost:2019` (not `0.0.0.0`), set the ACME email for Let's Encrypt, and include a comment indicating where per-site blocks will be appended. No site-specific configuration at this point.

### 9.3 Write the add-site script

`scripts/add-site.sh` should accept arguments: `--name`, `--domain`, `--admin-email`, `--admin-password`, and optional `--site-port` and `--admin-port`. It should:

1. Validate inputs (name is alphanumeric, domain looks valid, email looks valid, password meets minimum length).
2. Check that `sites/{name}/` doesn't already exist.
3. Copy `site-template/` to `sites/{name}/repo/`.
4. Create `sites/{name}/data/` and `sites/{name}/previews/`.
5. Initialize a git repo in `repo/`, make the initial commit.
6. Run `npm install` and `npm run build` in `repo/`.
7. Auto-assign ports if not specified (scan existing sites to find the next available).
8. Run a database initialization script or command that creates `admin.db` in `sites/{name}/data/`, creates the system tables, and inserts the initial admin user with the hashed password.
9. Append three Caddy blocks to the Caddyfile: the production domain (reverse proxy to site port with gzip), the admin subdomain (reverse proxy to admin port with SSE-compatible settings), and the preview wildcard fallback (404 response).
10. Reload Caddy via `systemctl reload caddy`.
11. Start two PM2 processes with the correct environment variables.
12. Save the PM2 process list.
13. Print the site URL, admin URL, and MCP endpoint URL.

### 9.4 Write a remove-site script

`scripts/remove-site.sh` should accept `--name` and: stop and delete both PM2 processes for the site, remove the Caddy configuration blocks for the site's domain (this requires either searching and deleting from the Caddyfile or maintaining a separate include file per site), reload Caddy, and optionally delete the site directory (with a confirmation flag like `--delete-data`). This script is less critical for launch but important for maintenance.

### 9.5 Write a database seed utility

A small script or module (can be a Node.js script that the add-site script calls) that initializes `admin.db`: creates the four system tables and inserts the initial admin user. Takes admin email and password as arguments. This should be runnable independently for debugging or resetting a site's admin database.

---

## Workstream 10: Integration and End-to-End Testing

### 10.1 Manual end-to-end test: site provisioning

Run the setup script on a fresh VPS (or a local VM). Run the add-site script. Verify: the site is reachable at the configured domain, the admin dashboard is reachable at the admin subdomain, the MCP health endpoint returns OK, Caddy is serving TLS correctly, PM2 shows both processes running.

### 10.2 Manual end-to-end test: dashboard auth flow

Log into the admin dashboard with the seeded credentials. Verify the dashboard home loads with site status. Navigate to the tokens page. Generate a token. Verify it displays once. Copy it. Navigate to the users page (should be visible since you're admin). Create a second user. Log out. Log in as the second user. Verify they can see the tokens page but not the users page (if editor role). Revoke a token and verify the MCP connection with that token fails.

### 10.3 Manual end-to-end test: MCP editing flow

Connect an MCP client (Claude Desktop or a test client) to the admin server's SSE endpoint using the generated token. Call `list_files` — verify it returns the project structure. Call `read_file` on a page. Call `start_editing` — verify a preview URL is returned and the preview site loads in a browser. Call `write_file` to modify a page — verify the change appears at the preview URL. Call `publish_changes` — verify the production site updates. Call `start_editing` again, make a change, then call `discard_changes` — verify the production site is unchanged.

### 10.4 Manual end-to-end test: path validation

Through MCP, attempt to write to a locked file (e.g., `astro.config.mjs`). Verify it's rejected. Attempt to write to a path outside the project (e.g., `../../etc/passwd`). Verify it's rejected. Attempt to write to `node_modules/`. Verify it's rejected. Attempt to read from `data/`. Verify it's rejected. Attempt to write to a valid path like `src/pages/test.astro`. Verify it succeeds.

### 10.5 Manual end-to-end test: data viewer

Submit a form on the live site (e.g., a contact form). Log into the admin dashboard. Navigate to the data viewer. Verify the submission appears in the contact_submissions collection. Mark it as read. Verify the status updates. Export as CSV. Verify the CSV contains the correct data.

### 10.6 Manual end-to-end test: build failure recovery

Through MCP, start an editing session. Write intentionally broken Astro code to a page (e.g., unclosed tags that fail the build). Call `publish_changes`. Verify the build error is returned to the AI agent. Verify the production site is unchanged (the merge was reverted). Verify the preview session is still active. Fix the broken code via another `write_file`. Call `publish_changes` again. Verify it succeeds this time.

### 10.7 Manual end-to-end test: session timeout

Start an editing session. Wait for the timeout period (set it to a short value like 2 minutes for testing). Verify the preview process is killed, the Caddy route is removed, the worktree is cleaned up, and the session record shows "timed out". Verify the audit log shows the timeout event.

---

## Workstream 11: Documentation

### 11.1 Write the agency setup guide

Step-by-step instructions for an agency to: provision a VPS, run the setup script, point a customer's domain DNS records, run the add-site script, and verify everything works. Include the DNS requirements (A record for domain, A record for admin subdomain, wildcard A record for preview subdomains). Cover common issues: DNS propagation delays, firewall rules for ports 80/443, and Caddy TLS provisioning.

### 11.2 Write the customer onboarding guide

A non-technical guide for the agency to share with customers: how to log into the admin dashboard, how to generate an MCP token, how to configure their MCP client (with screenshots or step-by-step for Claude Desktop since that's the most likely client), and what to expect when they start chatting with the AI about their site. This should be written for someone who doesn't know what MCP, git, or SSE are.

### 11.3 Write the AI agent system prompt guide

Documentation for the agency on how to configure the system prompt or instructions for the AI agent that connects via MCP. The system prompt should tell the AI: what kind of project this is (Astro SSR), the directory structure conventions, that blog posts go in `src/content/blog/` as markdown, that pages go in `src/pages/`, that styles are in `src/styles/global.css`, the workflow (call `start_editing` before making changes, preview, then `publish_changes`), and any constraints (don't modify locked files, all images go in `public/assets/`). This prompt is what makes the AI effective at managing the site within the established boundaries.

### 11.4 Write the site template customization guide

Instructions for the agency's developers on how to customize the site template for a specific customer: how to modify the base layout, how to add new content collections, how to add new data collections in models.yaml, how to create new page templates, and how to style the site. Include guidance on keeping things AI-friendly: consistent naming, comments in templates, and avoiding overly complex component hierarchies.

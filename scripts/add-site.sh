#!/usr/bin/env bash
set -euo pipefail

# ── LaunchPod — Setup Site ───────────────────────────────────────────────
#
# Copies site-template to site/, configures Caddy, starts PM2 processes,
# initializes git repo, and seeds the admin database.
#
# Usage:
#   bash scripts/add-site.sh [--site-name NAME] [--domain DOMAIN] [--git-remote URL]
#
# If flags are omitted, the script prompts interactively.
# ───────────────────────────────────────────────────────────────────────────

export PATH="$HOME/.bun/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHPOD_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_DIR="${LAUNCHPOD_DIR}/site-template"
SITE_DIR="${LAUNCHPOD_DIR}/site"
ADMIN_SERVER_DIR="${LAUNCHPOD_DIR}/admin-server"
DATA_DIR="${LAUNCHPOD_DIR}/data"
PREVIEWS_DIR="${LAUNCHPOD_DIR}/previews"
CADDYFILE="${LAUNCHPOD_DIR}/caddy/Caddyfile"
SEED_SCRIPT="${ADMIN_SERVER_DIR}/seed.ts"

# ── Helpers ────────────────────────────────────────────────────────────────

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m  ✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠ $*\033[0m"; }
fail() { echo -e "\033[1;31m  ✗ $*\033[0m" >&2; exit 1; }

# ── Interactive prompts ────────────────────────────────────────────────────

read_input() {
  local prompt="$1"
  local default="$2"
  local result=""

  if [[ -n "$default" ]]; then
    read -rp "${prompt} [${default}]: " result
    result="${result:-$default}"
  else
    read -rp "${prompt}: " result
  fi
  echo "$result"
}

SITE_NAME="${SITE_NAME:-}"
DOMAIN="${DOMAIN:-}"
GIT_REMOTE="${GIT_REMOTE:-}"

if [[ -z "${SITE_NAME}" ]]; then
  SITE_NAME=$(read_input "Site name (identifier, e.g. mysite)" "")
fi
if [[ -z "${DOMAIN}" ]]; then
  DOMAIN=$(read_input "Site domain (e.g. mysite.com)" "")
fi
if [[ -z "${GIT_REMOTE}" ]]; then
  GIT_REMOTE=$(read_input "Git remote URL (for pushing site changes)" "")
fi

# ── Validate inputs ────────────────────────────────────────────────────────

log "Validating inputs..."

if [[ -z "${SITE_NAME}" ]]; then
  fail "Site name is required"
fi
if [[ ! "${SITE_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  fail "Site name must be alphanumeric (with optional hyphens/underscores)"
fi

if [[ -z "${DOMAIN}" ]]; then
  fail "Site domain is required"
fi
if [[ ! "${DOMAIN}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
  fail "Invalid domain: ${DOMAIN}"
fi

ok "Site name: ${SITE_NAME}"
ok "Domain: ${DOMAIN}"
if [[ -n "${GIT_REMOTE}" ]]; then
  ok "Git remote: ${GIT_REMOTE}"
fi

# -- install dependencies

apt get update
apt install -y git unzip caddy

# bun
curl -fsSL https://bun.com/install | bash

# pm2
bun install -g pm2

# nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

\. "$HOME/.nvm/nvm.sh"

nvm install 24

# ── Copy site template ────────────────────────────────────────────────────

if [[ -d "${SITE_DIR}/.git" ]]; then
  warn "site/ already exists and is a git repo — skipping template copy"
else
  log "Copying site template..."
  if [[ ! -d "${TEMPLATE_DIR}/src" ]]; then
    fail "Site template not found at ${TEMPLATE_DIR}"
  fi

  mkdir -p "${SITE_DIR}"
  rsync -a --exclude='node_modules' --exclude='dist' --exclude='.git' \
    "${TEMPLATE_DIR}/" "${SITE_DIR}/"
  ok "Template copied to site/"
fi

# ── Ensure required directories exist ─────────────────────────────────────

mkdir -p "${DATA_DIR}"
mkdir -p "${PREVIEWS_DIR}"

# -- install dependencies for admin server

log "Installing admin server dependencies..."
cd "${ADMIN_SERVER_DIR}"
bun install
bun run build
ok "Admin server dependencies installed."

# ── Install dependencies ──────────────────────────────────────────────────

log "Installing site dependencies..."
cd "${SITE_DIR}"
bun install
ok "Dependencies installed."

log "Building site..."
bun run build
ok "Site built successfully."

# ── Initialize git repo ──────────────────────────────────────────────────

log "Initializing git repository..."
cd "${SITE_DIR}"

if [[ ! -d ".git" ]]; then
  git init -b main
  git add -A
  git commit -m "Initial commit from LaunchPod site template"
  ok "Git repo initialized with initial commit."
else
  ok "Git repo already exists."
fi

if [[ -n "${GIT_REMOTE}" ]]; then
  if ! git remote get-url origin &>/dev/null; then
    git remote add origin "${GIT_REMOTE}"
    ok "Git remote 'origin' added: ${GIT_REMOTE}"
  else
    current_remote=$(git remote get-url origin)
    if [[ "${current_remote}" != "${GIT_REMOTE}" ]]; then
      git remote set-url origin "${GIT_REMOTE}"
      ok "Git remote 'origin' updated to: ${GIT_REMOTE}"
    else
      ok "Git remote 'origin' already set to: ${GIT_REMOTE}"
    fi
  fi

  log "Pushing to remote..."
  git push -u origin main 2>&1
  ok "Pushed to origin/main."
fi

# ── Seed the admin database ──────────────────────────────────────────────

ADMIN_DB_PATH="${DATA_DIR}/admin.db"
SITE_DB_PATH="${DATA_DIR}/site.db"

log "Checking for existing admin database..."
if [[ -f "${ADMIN_DB_PATH}" ]]; then
  ok "Admin database already exists — skipping seed."
else
  log "Seeding admin database..."
  if [[ ! -f "${SEED_SCRIPT}" ]]; then
    fail "Seed script not found at ${SEED_SCRIPT}"
  fi

  ADMIN_EMAIL=$(read_input "Admin email" "admin@localhost")
  ADMIN_PASSWORD=$(read_input "Admin password (min 8 chars)" "admin")

  export ADMIN_DB_PATH="${ADMIN_DB_PATH}"
  cd "${ADMIN_SERVER_DIR}"
  bun run "${SEED_SCRIPT}" "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" "Admin"
  ok "Admin database seeded with user: ${ADMIN_EMAIL}"
fi

# ── Generate JWT secret ──────────────────────────────────────────────────

JWT_SECRET_FILE="${DATA_DIR}/jwt-secret.txt"
if [[ -f "${JWT_SECRET_FILE}" ]]; then
  JWT_SECRET=$(cat "${JWT_SECRET_FILE}")
  ok "Reusing existing JWT secret."
else
  JWT_SECRET=$(openssl rand -hex 32)
  echo "${JWT_SECRET}" > "${JWT_SECRET_FILE}"
  ok "JWT secret generated."
fi

# ── Configure Caddy ───────────────────────────────────────────────────────

log "Configuring Caddy reverse proxy..."

SITE_PORT=4000
ADMIN_PORT=3100
MCP_AUTH_PROXY_PORT=3200

cat > "${CADDYFILE}" <<CADDYEOF
# ── LaunchPod Caddyfile ────────────────────────────────────────────────
#
# Managed by LaunchPod add-site.sh.
# Preview routes are added dynamically by the admin server via the Caddy API.
#

{
	admin localhost:2019
	email your-email@example.com
}

# ── Site: ${SITE_NAME} ───────────────────────────────────────────────

${DOMAIN} {
	encode gzip
	reverse_proxy localhost:${SITE_PORT}
}

admin.${DOMAIN} {
	encode gzip
	reverse_proxy localhost:${ADMIN_PORT}
}

mcp.${DOMAIN} {
  encode gzip
  reverse_proxy localhost:${MCP_AUTH_PROXY_PORT}
}
CADDYEOF

ok "Caddyfile written to ${CADDYFILE}"

# ── Reload/restart Caddy ──────────────────────────────────────────────────

log "Restarting Caddy..."
if command -v systemctl &>/dev/null && systemctl is-active --quiet caddy; then
  caddy reload --config "${CADDYFILE}" --adapter caddyfile 2>/dev/null || {
    systemctl restart caddy
    ok "Caddy restarted."
  }
elif command -v caddy &>/dev/null; then
  systemctl restart caddy 2>/dev/null || {
    warn "Could not restart Caddy via systemctl. Start it manually:"
    echo "    caddy run --config ${CADDYFILE}"
  }
else
  warn "Caddy not installed. Install it and run:"
  echo "    caddy run --config ${CADDYFILE}"
fi

# ── Start PM2 processes ──────────────────────────────────────────────────

log "Starting PM2 processes..."

SITE_ECOSYSTEM="${LAUNCHPOD_DIR}/ecosystem.config.cjs"
cat > "${SITE_ECOSYSTEM}" <<ECOEOF
module.exports = {
  apps: [
    {
      name: "site-${SITE_NAME}",
      interpreter: "bun",
      script: "${SITE_DIR}/dist/server/entry.mjs",
      cwd: "${SITE_DIR}",
      watch: ['dist'],
      env: {
        HOST: "0.0.0.0",
        PORT: "${SITE_PORT}",
        SITE_DB_PATH: "${SITE_DB_PATH}",
        NODE_ENV: "production"
      }
    },
    {
      name: "admin-${SITE_NAME}",
      interpreter: "bun",
      script: "${ADMIN_SERVER_DIR}/src/index.tsx",
      cwd: "${ADMIN_SERVER_DIR}",
      env: {
        SITE_DIR: "${SITE_DIR}",
        PREVIEWS_DIR: "${PREVIEWS_DIR}",
        SITE_DOMAIN: "${DOMAIN}",
        ADMIN_PORT: "${ADMIN_PORT}",
        ADMIN_DB_PATH: "${ADMIN_DB_PATH}",
        SITE_DB_PATH: "${SITE_DB_PATH}",
        JWT_SECRET: "${JWT_SECRET}",
        NODE_ENV: "production"
      }
    },
    {
      name: "mcp-auth-proxy",
      script: "${LAUNCHPOD_DIR}/mcp-auth-proxy --external-url https://admin.${DOMAIN} --no-auto-tls --listen ':${MCP_AUTH_PROXY_PORT}' 'http://localhost:${ADMIN_PORT}'",
      cwd: "${LAUNCHPOD_DIR}",
      env: {
        PASSWORD: "password"
      }
    }
  ]
};
ECOEOF

pm2 delete "site-${SITE_NAME}" 2>/dev/null || true
pm2 delete "admin-${SITE_NAME}" 2>/dev/null || true

pm2 start "${SITE_ECOSYSTEM}"
ok "PM2 processes started: site-${SITE_NAME}, admin-${SITE_NAME}"

pm2 save
ok "PM2 process list saved."

# ── Summary ───────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Site setup complete!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "  Site name  : ${SITE_NAME}"
echo "  Site URL   : https://${DOMAIN}"
echo "  Admin URL  : https://admin.${DOMAIN}"
echo "  MCP endpoint: https://admin.${DOMAIN}/mcp"
echo "  Site dir   : ${SITE_DIR}"
echo "  Git remote : ${GIT_REMOTE:-none}"
echo ""
echo "  PM2 processes:"
echo "    site-${SITE_NAME}  → localhost:${SITE_PORT}"
echo "    admin-${SITE_NAME} → localhost:${ADMIN_PORT}"
echo ""

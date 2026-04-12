#!/usr/bin/env bash
set -euo pipefail

# ── LaunchPod — Add Customer Site ──────────────────────────────────────────
#
# Provisions a new customer site: copies template, sets up git, builds,
# configures Caddy reverse proxy, and starts PM2 processes.
#
# Usage:
#   bash add-site.sh \
#     --name mysite \
#     --domain mysite.com \
#     --admin-email admin@mysite.com \
#     --admin-password 'secretpass' \
#     [--site-port 4000] \
#     [--admin-port 3100]
# ───────────────────────────────────────────────────────────────────────────

# Ensure bun is in PATH
export PATH="$HOME/.bun/bin:$PATH"

# Get the directory where this script is located, then go up one level to get LAUNCHPOD_DIR
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHPOD_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SITES_DIR="${LAUNCHPOD_DIR}/sites"
TEMPLATE_DIR="${LAUNCHPOD_DIR}/site-template"
ADMIN_SERVER_DIR="${LAUNCHPOD_DIR}/admin-server"
CADDYFILE="/etc/caddy/Caddyfile"
SEED_SCRIPT="${ADMIN_SERVER_DIR}/seed.ts"

# ── Helpers ────────────────────────────────────────────────────────────────

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m  ✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠ $*\033[0m"; }
fail() { echo -e "\033[1;31m  ✗ $*\033[0m" >&2; exit 1; }

# ── Parse arguments ───────────────────────────────────────────────────────

SITE_NAME=""
DOMAIN=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
SITE_PORT=""
ADMIN_PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      SITE_NAME="$2"; shift 2 ;;
    --domain)
      DOMAIN="$2"; shift 2 ;;
    --admin-email)
      ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-password)
      ADMIN_PASSWORD="$2"; shift 2 ;;
    --site-port)
      SITE_PORT="$2"; shift 2 ;;
    --admin-port)
      ADMIN_PORT="$2"; shift 2 ;;
    *)
      fail "Unknown argument: $1" ;;
  esac
done

# ── Validate inputs ───────────────────────────────────────────────────────

log "Validating inputs..."

if [[ -z "${SITE_NAME}" ]]; then
  fail "--name is required"
fi
if [[ ! "${SITE_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  fail "Site name must be alphanumeric (with optional hyphens/underscores), got: ${SITE_NAME}"
fi

if [[ -z "${DOMAIN}" ]]; then
  fail "--domain is required"
fi
if [[ ! "${DOMAIN}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
  fail "Invalid domain: ${DOMAIN}"
fi

if [[ -z "${ADMIN_EMAIL}" ]]; then
  fail "--admin-email is required"
fi
if [[ ! "${ADMIN_EMAIL}" =~ @ ]]; then
  fail "Invalid email (must contain @): ${ADMIN_EMAIL}"
fi

if [[ -z "${ADMIN_PASSWORD}" ]]; then
  fail "--admin-password is required"
fi
if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
  fail "Password must be at least 8 characters"
fi

ok "Inputs validated: name=${SITE_NAME}, domain=${DOMAIN}"

# ── Check site doesn't already exist ──────────────────────────────────────

SITE_DIR="${SITES_DIR}/${SITE_NAME}"
if [[ -d "${SITE_DIR}" ]]; then
  fail "Site directory already exists: ${SITE_DIR}"
fi

# ── Auto-assign ports if not specified ─────────────────────────────────────

find_next_port() {
  local base_port="$1"
  local port="${base_port}"

  # Scan existing site configs and PM2 processes for used ports
  while true; do
    # Check if port is in use by any PM2 process env or in the Caddyfile
    if grep -q ":${port}" "${CADDYFILE}" 2>/dev/null; then
      port=$((port + 1))
      continue
    fi
    # Check if port is actively listening
    if ss -tlnp 2>/dev/null | grep -q ":${port} " 2>/dev/null; then
      port=$((port + 1))
      continue
    fi
    break
  done
  echo "${port}"
}

if [[ -z "${SITE_PORT}" ]]; then
  SITE_PORT=$(find_next_port 4000)
  ok "Auto-assigned site port: ${SITE_PORT}"
fi

if [[ -z "${ADMIN_PORT}" ]]; then
  ADMIN_PORT=$(find_next_port 3100)
  # Make sure admin port != site port
  if [[ "${ADMIN_PORT}" -eq "${SITE_PORT}" ]]; then
    ADMIN_PORT=$((ADMIN_PORT + 1))
  fi
  ok "Auto-assigned admin port: ${ADMIN_PORT}"
fi

# ── Copy site template ────────────────────────────────────────────────────

log "Creating site directory structure..."
mkdir -p "${SITE_DIR}"/{repo,data,previews}

log "Copying site template..."
if [[ ! -d "${TEMPLATE_DIR}/src" ]]; then
  fail "Site template not found at ${TEMPLATE_DIR}. Run setup.sh first."
fi
rsync -a --exclude='node_modules' --exclude='dist' --exclude='.git' \
  "${TEMPLATE_DIR}/" "${SITE_DIR}/repo/"
ok "Template copied to ${SITE_DIR}/repo/"

# ── Initialize git repo ──────────────────────────────────────────────────

log "Initializing git repository..."
cd "${SITE_DIR}/repo"
git init -b main
git add -A
git commit -m "Initial commit from LaunchPod template"
ok "Git repo initialized with initial commit."

# ── Install dependencies and build ────────────────────────────────────────

log "Installing site dependencies..."
cd "${SITE_DIR}/repo"
bun install
ok "Dependencies installed."

log "Building site..."
bun run build
ok "Site built successfully."

# ── Seed the admin database ──────────────────────────────────────────────

ADMIN_DB_PATH="${SITE_DIR}/data/admin.db"
SITE_DB_PATH="${SITE_DIR}/data/site.db"

log "Seeding admin database..."
if [[ ! -f "${SEED_SCRIPT}" ]]; then
  fail "Seed script not found at ${SEED_SCRIPT}. Run setup.sh first."
fi

# Set environment variable for seed script to find the database
export ADMIN_DB_PATH="${ADMIN_DB_PATH}"
cd "${ADMIN_SERVER_DIR}"
bun run "${SEED_SCRIPT}" "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}" "Admin"
ok "Admin database seeded with user: ${ADMIN_EMAIL}"

# ── Generate JWT secret ──────────────────────────────────────────────────

JWT_SECRET=$(openssl rand -hex 32)

# ── Append Caddy configuration ────────────────────────────────────────────

log "Configuring Caddy reverse proxy..."

CADDY_BLOCK=$(cat <<CADDYEOF

# ── Site: ${SITE_NAME} ──────────────────────────────────────────
# LAUNCHPOD_SITE_START:${SITE_NAME}

${DOMAIN} {
	encode gzip
	reverse_proxy localhost:${SITE_PORT}
}

admin.${DOMAIN} {
	encode gzip
	reverse_proxy localhost:${ADMIN_PORT} {
		flush_interval -1
	}
}

preview-*.admin.${DOMAIN} {
	respond "No active preview" 404
}

# LAUNCHPOD_SITE_END:${SITE_NAME}
CADDYEOF
)

echo "${CADDY_BLOCK}" >> "${CADDYFILE}"
ok "Caddy blocks appended for ${DOMAIN}"

# ── Reload Caddy ──────────────────────────────────────────────────────────

log "Reloading Caddy..."
if systemctl is-active --quiet caddy; then
  caddy reload --config "${CADDYFILE}" --adapter caddyfile
  ok "Caddy reloaded."
else
  systemctl start caddy
  ok "Caddy started."
fi

# ── Start PM2 processes ──────────────────────────────────────────────────

log "Starting PM2 processes..."

# Use an ecosystem file for proper env var support
SITE_ECOSYSTEM="${SITE_DIR}/ecosystem.config.cjs"
cat > "${SITE_ECOSYSTEM}" <<ECOEOF
module.exports = {
  apps: [
    {
      name: "site-${SITE_NAME}",
      script: "${SITE_DIR}/repo/dist/server/entry.mjs",
      cwd: "${SITE_DIR}/repo",
      env: {
        HOST: "127.0.0.1",
        PORT: "${SITE_PORT}",
        SITE_DB_PATH: "${SITE_DB_PATH}",
        NODE_ENV: "production"
      }
    },
    {
      name: "admin-${SITE_NAME}",
      script: "${ADMIN_SERVER_DIR}/dist/index.js",
      cwd: "${ADMIN_SERVER_DIR}",
      env: {
        SITE_DIR: "${SITE_DIR}/repo",
        SITE_DOMAIN: "${DOMAIN}",
        ADMIN_PORT: "${ADMIN_PORT}",
        ADMIN_DB_PATH: "${ADMIN_DB_PATH}",
        SITE_DB_PATH: "${SITE_DB_PATH}",
        SITE_NAME: "${SITE_NAME}",
        JWT_SECRET: "${JWT_SECRET}",
        NODE_ENV: "production"
      }
    }
  ]
};
ECOEOF

# Delete any previously running instances
pm2 delete "site-${SITE_NAME}" 2>/dev/null || true
pm2 delete "admin-${SITE_NAME}" 2>/dev/null || true

# Start from ecosystem file
pm2 start "${SITE_ECOSYSTEM}"
ok "PM2 processes started: site-${SITE_NAME}, admin-${SITE_NAME}"

# ── Save PM2 process list ─────────────────────────────────────────────────

log "Saving PM2 process list..."
pm2 save
ok "PM2 process list saved."

# ── Summary ───────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Site provisioned successfully!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "  Site name  : ${SITE_NAME}"
echo "  Site URL   : https://${DOMAIN}"
echo "  Admin URL  : https://admin.${DOMAIN}"
echo "  MCP endpoint: https://admin.${DOMAIN}/mcp"
echo ""
echo "  Site port  : ${SITE_PORT}"
echo "  Admin port : ${ADMIN_PORT}"
echo "  Site dir   : ${SITE_DIR}"
echo ""
echo "  Admin login: ${ADMIN_EMAIL}"
echo ""
echo "  PM2 processes:"
echo "    site-${SITE_NAME}  → localhost:${SITE_PORT}"
echo "    admin-${SITE_NAME} → localhost:${ADMIN_PORT}"
echo ""

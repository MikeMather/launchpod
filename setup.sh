#!/usr/bin/env bash
set -euo pipefail

# ── LaunchPod VPS Setup Script ─────────────────────────────────────────────
# Sets up a fresh Ubuntu 22.04+ server with Node.js 22, PM2, Caddy, and
# the LaunchPod admin-server.
#
# Usage:  sudo bash setup.sh
# ───────────────────────────────────────────────────────────────────────────

LAUNCHPOD_DIR="/srv/launchpod"

# ── Helpers ────────────────────────────────────────────────────────────────

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m  ✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠ $*\033[0m"; }
fail() { echo -e "\033[1;31m  ✗ $*\033[0m" >&2; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  fail "This script must be run as root (use sudo)."
fi

log "Checking Ubuntu version..."
if [[ ! -f /etc/os-release ]]; then
  fail "Cannot detect OS. This script requires Ubuntu 22.04+."
fi
source /etc/os-release
if [[ "${ID}" != "ubuntu" ]]; then
  fail "This script requires Ubuntu. Detected: ${ID}"
fi
MAJOR_VERSION="${VERSION_ID%%.*}"
if [[ "${MAJOR_VERSION}" -lt 22 ]]; then
  fail "Ubuntu 22.04+ required. Detected: ${VERSION_ID}"
fi
ok "Ubuntu ${VERSION_ID} detected."

# ── Install Node.js 22 via NodeSource ──────────────────────────────────────

log "Installing Node.js 22..."
if command -v node &>/dev/null && node --version | grep -q "^v22"; then
  ok "Node.js 22 already installed: $(node --version)"
else
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/nodesource.gpg ]]; then
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  fi
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
  ok "Node.js installed: $(node --version)"
fi

# ── Install PM2 ───────────────────────────────────────────────────────────

log "Installing PM2..."
if command -v pm2 &>/dev/null; then
  ok "PM2 already installed: $(pm2 --version)"
else
  npm install -g pm2
  ok "PM2 installed: $(pm2 --version)"
fi

log "Configuring PM2 systemd startup..."
pm2 startup systemd -u root --hp /root 2>/dev/null || true
ok "PM2 startup configured."

# ── Install Caddy ─────────────────────────────────────────────────────────

log "Installing Caddy..."
if command -v caddy &>/dev/null; then
  ok "Caddy already installed: $(caddy version)"
else
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  if [[ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  fi
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
  ok "Caddy installed: $(caddy version)"
fi

# ── Install git ───────────────────────────────────────────────────────────

log "Checking git..."
if command -v git &>/dev/null; then
  ok "git already installed: $(git --version)"
else
  apt-get install -y -qq git
  ok "git installed: $(git --version)"
fi

# ── Create directory structure ─────────────────────────────────────────────

log "Creating LaunchPod directory structure..."
mkdir -p "${LAUNCHPOD_DIR}"/{admin-server,site-template,sites,scripts,caddy}
ok "Directory structure created at ${LAUNCHPOD_DIR}/"

# ── Copy project files ────────────────────────────────────────────────────
# Assumes this script is run from the project root (where admin-server/ and
# site-template/ live), OR that they've already been deployed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log "Deploying admin-server..."
if [[ -d "${SCRIPT_DIR}/admin-server/src" ]]; then
  rsync -a --delete --exclude='node_modules' --exclude='dist' \
    "${SCRIPT_DIR}/admin-server/" "${LAUNCHPOD_DIR}/admin-server/"
  ok "admin-server source copied."
else
  warn "admin-server source not found in ${SCRIPT_DIR}. Skipping copy."
fi

log "Deploying site-template..."
if [[ -d "${SCRIPT_DIR}/site-template/src" ]]; then
  rsync -a --delete --exclude='node_modules' --exclude='dist' --exclude='.git' \
    "${SCRIPT_DIR}/site-template/" "${LAUNCHPOD_DIR}/site-template/"
  ok "site-template copied."
else
  warn "site-template not found in ${SCRIPT_DIR}. Skipping copy."
fi

log "Deploying scripts..."
if [[ -d "${SCRIPT_DIR}/scripts" ]]; then
  cp -a "${SCRIPT_DIR}/scripts/"* "${LAUNCHPOD_DIR}/scripts/"
  chmod +x "${LAUNCHPOD_DIR}/scripts/"*.sh 2>/dev/null || true
  ok "Scripts copied."
fi

# ── Install admin-server npm dependencies ──────────────────────────────────

log "Installing admin-server dependencies..."
cd "${LAUNCHPOD_DIR}/admin-server"
npm install --omit=dev
ok "admin-server dependencies installed."

# ── Compile admin-server TypeScript ────────────────────────────────────────

log "Building admin-server..."
npm run build
ok "admin-server compiled to dist/."

# ── Copy base Caddyfile ───────────────────────────────────────────────────

log "Setting up Caddy configuration..."
CADDYFILE="/etc/caddy/Caddyfile"
if [[ -f "${SCRIPT_DIR}/caddy/Caddyfile" ]]; then
  cp "${SCRIPT_DIR}/caddy/Caddyfile" "${CADDYFILE}"
  ok "Caddyfile installed at ${CADDYFILE}"
elif [[ -f "${LAUNCHPOD_DIR}/caddy/Caddyfile" ]]; then
  cp "${LAUNCHPOD_DIR}/caddy/Caddyfile" "${CADDYFILE}"
  ok "Caddyfile installed at ${CADDYFILE}"
else
  warn "No base Caddyfile found. Using existing Caddy config."
fi

# ── Start / reload Caddy ──────────────────────────────────────────────────

log "Starting Caddy..."
systemctl enable caddy 2>/dev/null || true
if systemctl is-active --quiet caddy; then
  caddy reload --config "${CADDYFILE}" --adapter caddyfile 2>/dev/null || systemctl reload caddy
  ok "Caddy reloaded."
else
  systemctl start caddy
  ok "Caddy started."
fi

# ── Done ──────────────────────────────────────────────────────────────────

echo ""
log "LaunchPod VPS setup complete!"
echo "  Node.js : $(node --version)"
echo "  PM2     : $(pm2 --version)"
echo "  Caddy   : $(caddy version)"
echo "  Base dir: ${LAUNCHPOD_DIR}"
echo ""
echo "Next steps:"
echo "  1. Edit /etc/caddy/Caddyfile and set your ACME email"
echo "  2. Add a site:  bash ${LAUNCHPOD_DIR}/scripts/add-site.sh --name mysite --domain example.com --admin-email admin@example.com --admin-password changeme"
echo ""

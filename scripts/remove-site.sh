#!/usr/bin/env bash
set -euo pipefail

# ── LaunchPod — Remove Customer Site ───────────────────────────────────────
#
# Stops PM2 processes, removes Caddy config blocks, and optionally deletes
# the site directory.
#
# Usage:
#   bash remove-site.sh --name mysite [--delete-data]
# ───────────────────────────────────────────────────────────────────────────

LAUNCHPOD_DIR="/srv/launchpod"
SITES_DIR="${LAUNCHPOD_DIR}/sites"
CADDYFILE="/etc/caddy/Caddyfile"

# ── Helpers ────────────────────────────────────────────────────────────────

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m  ✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠ $*\033[0m"; }
fail() { echo -e "\033[1;31m  ✗ $*\033[0m" >&2; exit 1; }

# ── Parse arguments ───────────────────────────────────────────────────────

SITE_NAME=""
DELETE_DATA=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      SITE_NAME="$2"; shift 2 ;;
    --delete-data)
      DELETE_DATA=true; shift ;;
    *)
      fail "Unknown argument: $1" ;;
  esac
done

if [[ -z "${SITE_NAME}" ]]; then
  fail "--name is required"
fi

SITE_DIR="${SITES_DIR}/${SITE_NAME}"

log "Removing site: ${SITE_NAME}"

# ── Stop and delete PM2 processes ─────────────────────────────────────────

log "Stopping PM2 processes..."

if pm2 describe "site-${SITE_NAME}" &>/dev/null; then
  pm2 stop "site-${SITE_NAME}" 2>/dev/null || true
  pm2 delete "site-${SITE_NAME}"
  ok "Stopped and deleted: site-${SITE_NAME}"
else
  warn "PM2 process site-${SITE_NAME} not found (already removed?)"
fi

if pm2 describe "admin-${SITE_NAME}" &>/dev/null; then
  pm2 stop "admin-${SITE_NAME}" 2>/dev/null || true
  pm2 delete "admin-${SITE_NAME}"
  ok "Stopped and deleted: admin-${SITE_NAME}"
else
  warn "PM2 process admin-${SITE_NAME} not found (already removed?)"
fi

# ── Remove Caddy config blocks ────────────────────────────────────────────

log "Removing Caddy configuration for ${SITE_NAME}..."

if grep -q "LAUNCHPOD_SITE_START:${SITE_NAME}" "${CADDYFILE}" 2>/dev/null; then
  # Remove everything between the start and end markers (inclusive)
  sed -i "/# LAUNCHPOD_SITE_START:${SITE_NAME}/,/# LAUNCHPOD_SITE_END:${SITE_NAME}/d" "${CADDYFILE}"
  # Also remove the comment line above the marker
  sed -i "/# ── Site: ${SITE_NAME}/d" "${CADDYFILE}"
  # Clean up any resulting blank lines (collapse multiple blanks to one)
  sed -i '/^$/N;/^\n$/d' "${CADDYFILE}"
  ok "Caddy config blocks removed."
else
  warn "No Caddy config blocks found for ${SITE_NAME}."
fi

# ── Reload Caddy ──────────────────────────────────────────────────────────

log "Reloading Caddy..."
if systemctl is-active --quiet caddy; then
  caddy reload --config "${CADDYFILE}" --adapter caddyfile 2>/dev/null || systemctl reload caddy
  ok "Caddy reloaded."
else
  warn "Caddy is not running."
fi

# ── Delete site data ──────────────────────────────────────────────────────

if [[ "${DELETE_DATA}" == true ]]; then
  log "Deleting site directory..."
  if [[ -d "${SITE_DIR}" ]]; then
    rm -rf "${SITE_DIR}"
    ok "Deleted: ${SITE_DIR}"
  else
    warn "Site directory not found: ${SITE_DIR}"
  fi
else
  log "Site data preserved at ${SITE_DIR}"
  echo "  Use --delete-data to remove it."
fi

# ── Save PM2 process list ─────────────────────────────────────────────────

log "Saving PM2 process list..."
pm2 save
ok "PM2 process list saved."

# ── Done ──────────────────────────────────────────────────────────────────

echo ""
ok "Site ${SITE_NAME} removed successfully."
echo ""

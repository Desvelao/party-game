#!/bin/sh
# Dev entrypoint: make sure node_modules matches package.json, then run the command.
# Runs as the unprivileged `node` user, so everything it creates is owned by the host user.
set -e
cd /app

export HOME=/tmp
export npm_config_cache=/tmp/.npm
export npm_config_update_notifier=false

stamp=node_modules/.package.json.sha1
want=$(sha1sum package.json | cut -d' ' -f1)

current() { [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$want" ]; }

if ! current; then
  mkdir -p node_modules 2>/dev/null || true
  if [ ! -w node_modules ]; then
    echo "[dev] node_modules is not writable by the container user ($(id -un))." >&2
    echo "[dev] It is probably root-owned from an older setup. Fix once with:" >&2
    echo "[dev]   sudo rm -rf node_modules dist && docker compose up" >&2
    exit 1
  fi
  # server/client/loadtest may start together: only one installs, the others wait
  (
    flock 9
    if ! current; then
      echo "[dev] installing dependencies (package.json changed)..."
      npm install --no-audit --no-fund
      echo "$want" > "$stamp"
    fi
  ) 9>node_modules/.install.lock
fi

# HTTPS in dev: TLS_SELF_SIGNED=1 docker compose up (see docs/manual/https.md)
TLS_DIR="${TLS_DIR:-/certs}"
. /app/docker/tls-selfsigned.sh

exec "$@"

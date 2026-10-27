#!/bin/sh
# Production entrypoint: optionally create a self-signed certificate (TLS_SELF_SIGNED=1), then start the server.
set -e
. /app/docker/tls-selfsigned.sh
exec "$@"

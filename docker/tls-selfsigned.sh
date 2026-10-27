#!/bin/sh
# Sourced by the entrypoints. When TLS_SELF_SIGNED is 1/true/yes and TLS_CERT / TLS_KEY are not set,
# create (once) a self-signed certificate in $TLS_DIR and point TLS_CERT / TLS_KEY at it. A pair that
# already exists in $TLS_DIR is reused, so the certificate survives restarts when the directory is a volume.
# TLS_HOSTNAME (default: localhost) is the name, plus any extra names/IPs in TLS_ALT_NAMES (comma separated,
# e.g. "192.168.1.20,party.local"), the certificate is valid for.
case "${TLS_SELF_SIGNED:-}" in
  1|true|yes|on)
    if [ -z "${TLS_CERT:-}" ] && [ -z "${TLS_KEY:-}" ]; then
      dir="${TLS_DIR:-/app/certs}"
      if [ ! -s "$dir/cert.pem" ] || [ ! -s "$dir/key.pem" ]; then
        if [ ! -w "$dir" ]; then
          echo "[tls] $dir is not writable by $(id -un): cannot create a self-signed certificate there." >&2
          exit 1
        fi
        host="${TLS_HOSTNAME:-localhost}"
        san="DNS:localhost,IP:127.0.0.1"
        for n in $host $(echo "${TLS_ALT_NAMES:-}" | tr ',' ' '); do
          case "$n" in
            *[!0-9.]*) san="$san,DNS:$n" ;;
            *) san="$san,IP:$n" ;;
          esac
        done
        echo "[tls] creating a self-signed certificate for $host in $dir"
        openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=$host" -addext "subjectAltName=$san" \
          -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
        chmod 600 "$dir/key.pem"
      fi
      export TLS_CERT="$dir/cert.pem" TLS_KEY="$dir/key.pem"
    fi
    ;;
esac

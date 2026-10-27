#!/bin/sh
# deb: $1 = configure ($2 = previous version on an upgrade); rpm: $1 = number of installed copies (1 = first install)
set -e
if ! getent passwd party-game >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/party-game --no-create-home --shell /usr/sbin/nologin party-game
fi
install -d -o party-game -g party-game -m 750 /var/lib/party-game
fresh=0
case "$1" in
  configure) if [ -z "${2:-}" ]; then fresh=1; fi ;;
  1) fresh=1 ;;
esac
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload || true
  if [ "$fresh" = 1 ]; then
    systemctl enable party-game.service >/dev/null 2>&1 || true
    echo "party-game installed. Start it with: sudo systemctl start party-game"
  else
    systemctl try-restart party-game.service || true
  fi
fi

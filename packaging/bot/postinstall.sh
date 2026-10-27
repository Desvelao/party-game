#!/bin/sh
# deb: $1 = configure ($2 = previous version on an upgrade); rpm: $1 = number of installed copies (1 = first install)
set -e
if ! getent passwd party-game-bot >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/party-game-bot --no-create-home --shell /usr/sbin/nologin party-game-bot
fi
install -d -o party-game-bot -g party-game-bot -m 750 /var/lib/party-game-bot
fresh=0
case "$1" in
  configure) if [ -z "${2:-}" ]; then fresh=1; fi ;;
  1) fresh=1 ;;
esac
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload || true
  if [ "$fresh" = 1 ]; then
    systemctl enable party-game-bot.service >/dev/null 2>&1 || true
    echo "party-game-bot installed. Set ADMIN_TOKEN in /etc/default/party-game-bot, then start it with: sudo systemctl start party-game-bot"
  else
    systemctl try-restart party-game-bot.service || true
  fi
fi

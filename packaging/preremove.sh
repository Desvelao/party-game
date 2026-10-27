#!/bin/sh
# deb: $1 = remove|upgrade; rpm: $1 = 0 when the last copy is removed. Stop only on a real removal.
set -e
case "$1" in
  remove|0)
    if [ -d /run/systemd/system ]; then
      systemctl stop party-game.service || true
      systemctl disable party-game.service >/dev/null 2>&1 || true
    fi
    ;;
esac

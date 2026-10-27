#!/bin/sh
# The data in /var/lib/party-game-bot (settings, audit log, reports, game packs) and the party-game-bot user are kept on purpose.
if [ -d /run/systemd/system ]; then systemctl daemon-reload || true; fi
exit 0

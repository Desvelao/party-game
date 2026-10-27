#!/bin/sh
# The data in /var/lib/party-game and the party-game user are kept on purpose (player profiles).
if [ -d /run/systemd/system ]; then systemctl daemon-reload || true; fi
exit 0

# Troubleshooting

## Players

| What you see | Why | What to do |
|---|---|---|
| "Room not found" / "Room XXXX no longer exists" | wrong code, or the room was closed or the server restarted | check the 4 letters; create a new room |
| "The room is full" | the room reached its player limit | ask the host to raise **Max players**, or watch and join in the next lobby |
| "A match is already running" | the match started before you joined | you are placed as a spectator; choose **Join as player** in the next lobby |
| "The host closed this room to new players" | the host locked the room | ask the host to choose **Unlock room** |
| "This room needs a password" / "Wrong password" | the room is protected | ask the host for the password |
| "The host removed you from the room" | the host kicked you | you cannot rejoin that room with the same profile; ask the host or join another room |
| "You have been banned from this server" (with a reason) | an operator banned you or your address | contact the server operator; the message says how many minutes are left, if timed |
| "The server is full - try again later" | the server hit its room limit | wait for a room to finish |
| "Too many connections from your network" | too many open tabs or devices share your address | close other tabs and try again |
| "You are sending too many messages - reload the page" | the connection was cut for flooding the server | reload the page |
| "The connection took too long to join a room" | you connected but did not join in time | try again |
| "You are already in this room on another device or tab" | your profile already has a seat there | use that device, or leave it first |
| "Your game is out of date - reload the page" | the server was updated | reload the page |
| **Connection lost - reconnecting...** | the network dropped | wait, or choose **Leave**; your seat is held for about a minute |
| "Disconnected - the server restarted or is unreachable" | the server restarted | create or join a new room |
| "Cannot reach the game server" | no connection at all | check the address and your Wi-Fi |
| Keys do nothing | the page has no focus, or a key was rebound | click the game; **Settings > Controls > Reset to defaults** |
| Sound is off | browsers need a tap first | click or press a key once |
| Profile code "not valid or current" | typo, or a transfer code older than 5 minutes or already used | copy the code again, or request a new transfer code |

## Operators

| Problem | Cause | Fix |
|---|---|---|
| Admin page says unauthorised | no or wrong token | set `ADMIN_TOKEN`, enter the same value; in Docker a token is required |
| Admin page locked for a minute | ten wrong tokens | wait a minute, then enter the right token |
| Server will not start and names a key | invalid value in the config file | run `npm run config:check -- -c <file>` and fix the named key |
| "SQLite driver unavailable on this platform" | the board has no SQLite build (arm/v6, for example Pi Zero W) | use `storage.store: json` |
| Profiles empty after switching to SQLite | data was not migrated | stop the game, run the migrate tool, see [Configuration](configuration.md#profile-storage) |
| Most games are missing; the log says `needs character model "blob"` | the `characters` plugin is not loaded | add `characters` to `plugins.enabled` / `PLUGINS` (or use `all`), see [Installing plugins](installing-plugins.md) |
| Port already in use | another program uses the port | change `PORT` / `server.port` |
| Players behind a proxy all share one address; a ban hits everyone | the proxy address is used | set `TRUST_PROXY=1` behind your own proxy, and prefer profile bans |
| Game stutters, `/stats` shows overruns | the hardware cannot hold the tick rate | lower `TICK_RATE`, `MAX_ROOMS` or `MAX_PLAYERS`, see [Performance profiles](performance-profiles.md) |
| Browser warns about the certificate, or the server stops naming `TLS` | self-signed certificate, or only one of `server.tlsCert` / `server.tlsKey` is set | see [HTTPS](https.md#if-something-is-wrong) |
| Browser never connects behind a proxy | websocket upgrade not forwarded | forward `Upgrade` and `Connection` headers |
| Rooms vanished after an update | only open lobbies are saved across a restart (not rooms in a match, nor rooms with a password, nor players), and only for `game.roomRestoreSeconds` | announce restarts with `npm run admin -- broadcast` first; players of a restored lobby join again with the same code |

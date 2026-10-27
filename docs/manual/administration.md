# Administration

The server has operator tools for running a live game: see and close rooms, kick and ban, edit profiles, change
limits without a restart, switch games off and look at history and health. There are three ways to use them:

| Way | How |
|---|---|
| Web page | `http://<server-address>:8080/admin` (works on a phone) |
| Command line | `npm run admin -- <command>` (Linux package: `party-game-admin <command>`, see [Deployment](deployment.md#production-with-the-linux-package)) |
| HTTP | `/api/admin/*` with `Authorization: Bearer <token>`, see [../admin-api.md](../admin-api.md) |

## Getting in

1. Set a token: `ADMIN_TOKEN=<long random string>` (or `server.adminToken` in the config file).
2. Open `/admin` and enter the token.
3. For the command line export it once:

   ```bash
   export ADMIN_URL=http://pi.local:8080 ADMIN_TOKEN=<token>
   npm run admin -- whoami
   ```

Without a token only programs on the server machine itself are accepted, and never inside Docker. Always set a
token in a container. Ten wrong tokens in a minute lock that address out for the rest of the minute. In the
development stack the token is `dev-stats`.

## The admin page

| Tab | Use it to |
|---|---|
| Rooms | broadcast to everyone; per room see players, rename, kick, ban; see player reports |
| Maintenance | start or stop maintenance mode with a message, send or schedule announcements (optionally pinned as a banner), and remove them |
| Console | with console mode on: see the TV's pairing PIN and room, change the PIN, or unpair every phone |
| Profiles | search, rename, reset stats, delete, hide from the leaderboard |
| Config | change limits live (see below) |
| Games | switch games or variants off, set the default value of their options |
| Plugins | see the installed plugins and open the page of those that have one (the bots dashboard at `/plugins/bots/`, the progression list at `/plugins/progression/`) |
| Playlists | publish ready-made playlists for hosts |
| Bans | list and lift bans |
| History | recent matches and leaderboards (match history and the health charts are hidden when `server.adminInsights` is `false`; see [Configuration](configuration.md)) |
| Audit | every admin action, with CSV export |
| Health | host CPU, memory, load, temperature, ping and tick-loop charts |

## Everyday tasks

| Task | Command |
|---|---|
| List rooms | `npm run admin -- rooms` |
| Tell a room something | `npm run admin -- notice ABCD "Pizza is here"` |
| Tell every room | `npm run admin -- broadcast "Server restarts in 5 minutes"` |
| Stop new rooms before maintenance | `npm run admin -- maintenance on "Back at 8 pm"` |
| Stop new rooms, then shut down when the last room ends | `npm run admin -- maintenance on --exit` |
| Open the server again | `npm run admin -- maintenance off` |
| Announce something to everyone | `npm run admin -- announce "Closing in 10 minutes" --in 600 --pin` |
| Close or lock a room | `npm run admin -- close ABCD` / `npm run admin -- lock ABCD` |
| Remove a player | `npm run admin -- kick ABCD 3f9a1c --reason "spam"` |
| Ban a player for an hour | `npm run admin -- kick ABCD 3f9a1c --ban --reason "spam" --minutes 60` |
| See and lift bans | `npm run admin -- bans` / `npm run admin -- unban --profile <id>` |
| Change a limit now | `npm run admin -- config set maxRooms=6` |
| Change the server name now | `npm run admin -- config set "brandName=Bonk Night"` |
| Return to the configured value | `npm run admin -- config unset maxRooms` |
| Turn a game off | `npm run admin -- catalog disable box-bonanza` |
| Default option for a variant | `npm run admin -- defaults set jungle-bonanza timeLimit=120` |
| Back up profiles | `npm run admin -- export profiles-backup.json` |
| Server health | `npm run admin -- status` |

Players removed or banned are told the reason you gave and, for a timed ban, how long is left. A ban by IP also
blocks everyone behind that address (a shared Wi-Fi), so prefer banning the profile.

### Maintenance and announcements

You can do all of this from the **Maintenance** tab of the admin page, or with the commands below:

1. Open the **Maintenance** tab.
2. To close the server for maintenance, type a message (optional), tick **Shut down when the last room ends** if you want that, and click **Start maintenance mode**. Click **Stop maintenance mode** to open it again.
3. To announce something, type it under **Announce**, optionally fill in **Send in (minutes)** and **Banner stays (minutes)**, tick **Pin as a banner** to keep it on screen for everyone, and click **Send**.
4. Waiting and pinned announcements are listed below; click **Remove** to take one back. **Clear everything** also leaves maintenance mode.
5. Under **Recently sent** are the announcements players can reread. Click **Remove** to take one out, or **Clear recent** to empty the list.

**Maintenance mode** lets matches finish before you restart or stop the server. While it is on:

- Nobody can create a new room: they see "The server is closing for maintenance - new rooms are not available right now".
- Rooms that already exist keep working, and people can still join them, so running matches finish.
- A banner at the top of the screen tells players the server is closing. It shows your message, or a standard one if you gave none. Players can close the banner.

With `--exit` the server also shuts down by itself once the last room has closed. Idle lobbies close on their own after the idle time you configured, so it empties by itself. Start it again afterwards (your container or service manager normally does this).

An **announcement** is a message shown to everyone who is connected as a pop-up for a few seconds. These options go after the message:

- `--in SECONDS` sends it later (for example `--in 600` for ten minutes from now).
- `--pin` also keeps it as a banner for everyone, including people who connect later. `--for SECONDS` takes the banner down after that time; without it the banner stays until you remove it.

Players can reread pinned and recent announcements from **Announcements** in the menu. See the list with `npm run admin -- maintenance`, remove one with `npm run admin -- maintenance remove <id>`, and clear everything with `npm run admin -- maintenance clear`. To take announcements out of what players can reread, use `npm run admin -- maintenance clear-recent <id>` for one, or `npm run admin -- maintenance clear-recent` for all of them. The banner and schedule survive a restart. Players who are only in the menu see a pinned announcement when they open or reload the page; the pop-up reaches those who are in a room.

In the built image the same tool is `node dist/admin.js <command>`.

## Settings you can change live

In the **Config** tab (or `config set`) these apply at once and persist across restarts: rooms, players and
spectators per room, idle room time and its warning (`idleWarnSeconds`), how long an idle host keeps the role (`hostIdleSeconds`), reconnect grace, connections per
address, join timeout, and the branding name and welcome message.
Port, tick rate, network rate, profile and storage need a restart: change them in the config file or environment.

## Monitoring pages

| Path | What it shows |
|---|---|
| `/status` | public and minimal: rooms, clients, uptime, version |
| `/rooms` | open rooms |
| `/api/rooms` | public, rate limited: only lobbies whose host ticked **List this room publicly** (JSON `{rooms: [{code, game, players, maxPlayers, passwordProtected}]}`) |
| `/stats` | JSON with rates, rooms, clients, tick-loop timing and process CPU/RAM |
| `/metrics` | Prometheus format; needs the Prometheus plugin turned on (`plugins.prometheus.enabled`) and the admin token |

## Where the admin data lives

In the data folder (`data/`, or the `party-game-data` volume): bans, live settings, maintenance mode and announcements, disabled games, option
defaults, playlists, match history and the audit log. Include it in your backups.

### Player progression (progression plugin)

1. Open the **Plugins** tab and choose **Open** next to Progression (or go to `/plugins/progression/`), then sign in with the same admin token.
2. The page lists each player's profile id, level, XP, matches, wins, best streak and achievements, highest level first.
3. Choose **Reset** next to a player to forget their progress (their profile and statistics stay).

From the command line: `npm run admin -- progression [--limit N]`, `progression-show <id>` and `progression-reset <id>`.
The list shows profile ids; use `npm run admin -- profile <id>` to see the name.

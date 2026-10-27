# Deployment

How to run the game for real: a container with Docker Compose or a Linux package with a systemd service, a place for the player data and, optionally, a reverse proxy.

## Production with Docker Compose

1. Create a `.env` file next to `docker-compose.prod.yml`. Every key is optional except `IMAGE` (unless you build
   locally):

   ```bash
   IMAGE=ghcr.io/<owner>/<repo>   # the image to run
   TAG=latest                     # pin a release such as 0.1.0 for repeatable deploys
   PORT=8080                      # port on the host
   PROFILE=NORMAL                 # LOW_POWER | NORMAL | HIGH
   ADMIN_TOKEN=<long random string>
   PROFILE_STORE=sqlite           # json (default) | sqlite
   # TRUST_PROXY=1                # only behind a reverse proxy you control
   ```

   Create a token with `openssl rand -hex 24`. Without `ADMIN_TOKEN` nobody can use the admin tools from
   inside Docker (see [Administration](administration.md)).
2. Start: `docker compose -f docker-compose.prod.yml up -d` (add `--build` to build from this checkout).
3. Check: `docker compose -f docker-compose.prod.yml ps` shows `healthy`, and
   `curl http://localhost:8080/stats` answers.
4. Players join at `http://<host>:<PORT>/`.

## Production with the Linux package

The deb and rpm packages ([Installation](installation.md#option-3-linux-package-deb-rpm-or-tarball)) set the server up as a
service called `party-game` that runs as its own `party-game` user.

| What | Where |
|---|---|
| Settings file (YAML, see [Configuration](configuration.md)) | `/etc/party-game/config.yaml` |
| Settings as environment variables (`PORT`, `ADMIN_TOKEN`, `PROFILE`...) | `/etc/default/party-game` |
| Player profiles, installed games and plugins | `/var/lib/party-game` |
| The program and its own Node.js | `/opt/party-game` |
| Every key with its default | `/usr/share/doc/party-game/config.example.yaml` |

Both settings files are empty on purpose: the server runs with its defaults. A value in the YAML file wins over the
same setting in `/etc/default/party-game`.

**Change a setting**

1. Edit `/etc/party-game/config.yaml` (for example `performance:` then `  profile: LOW_POWER`), or remove the `#` in front
   of a line in `/etc/default/party-game`.
2. Check the file: `party-game-config-check`. It reports a mistake in one line.
3. Restart: `sudo systemctl restart party-game`. Rooms live in memory, so a restart closes them.

**Everyday commands**

| You want to | Run |
|---|---|
| Start, stop, restart | `sudo systemctl start party-game`, `stop`, `restart` |
| Stop it starting at boot | `sudo systemctl disable party-game` |
| See the log | `journalctl -u party-game -f` |
| Check the server is up | `curl http://localhost:8080/stats` |

The service cannot listen on ports below 1024. Keep the port at `8080` and put a [reverse proxy](#behind-a-reverse-proxy)
in front if you want port 80 or 443.

**Commands that come with the package**

The package adds these commands. Each one is the same tool as the matching `npm run` command in the other manuals, without needing Node.js or the source code.

| Command | What it does | More |
|---|---|---|
| `party-game-server` | starts the server (the service runs this) | [Configuration](configuration.md) |
| `party-game-admin` | rooms, bans, announcements, maintenance | [Administration](administration.md) |
| `party-game-config-check` | checks your settings and lists the games and plugins that would load | [Configuration](configuration.md) |
| `party-game-games` | list, install and remove game packs | [Installing games](installing-games.md) |
| `party-game-plugins` | list, install and remove plugins | [Installing plugins](installing-plugins.md) |
| `party-game-migrate-profiles` | copy player profiles from one storage type to another | [Player data and backups](#player-data-and-backups) |
| `party-game-loadtest` | simulate many players to test the machine | [Performance profiles](performance-profiles.md) |

Run the ones that change data as the service user, so the files keep the right owner, for example
`sudo -u party-game party-game-games install my-game-1.0.0.pgpack`, then restart the service.
`party-game-admin` talks to the running server at `http://127.0.0.1:8080`: on the same computer it works without a
token. If you changed the port or set `ADMIN_TOKEN`, add `--url http://127.0.0.1:<port>` and `--token <your token>`.

**Upgrade and roll back**: install the newer deb or rpm over the old one; the service restarts by itself and your
settings and data stay. To go back, install the older package file again.

**Back up**: stop the service (`sudo systemctl stop party-game`), copy `/var/lib/party-game`, start it again.
Removing the package (`sudo apt remove party-game` or `sudo dnf remove party-game`) keeps that folder and your
settings files, so a later install finds your players again.

## Bot players (optional)

Hosts can fill a room with AI players, choose their level and add single bots (see [Hosting a room](hosts.md#room-controls)).
This is the **bots plugin**, which comes with the image. It is off until you allow it.

**Bots inside the game server (the simple way).** Add to your `.env` file and start again:

```bash
BOTS_ALLOW_FILL=1
# BOTS_DEFAULT_LEVEL=normal   # easy | normal | hard | expert | semigod | random
# BOTS_MAX=4                  # most bots at once (default by PROFILE: 2, 8 or 16)
# BOTS_DECISION_HZ=10         # how often a bot decides; lower is lighter on small machines
```

Nothing else runs. Sign in as admin and open `http://<host>:<PORT>/plugins/bots/` (the same admin token as the other admin
tools) to see the bots, why a room has none, and to pause, stop or add bots and change the settings that apply. The
**Plugins** tab of the admin page links to it. Switch parts off with `BOTS_DASHBOARD=0`, `BOTS_API=0` (also turns the
dashboard off), `BOTS_LIVE_CONFIG=0` or `BOTS_AUDIT=0`; `BOTS_METRICS=1` adds Prometheus metrics at `/api/bots/prometheus`.
Rooms that rotate through every game get no bots unless you set `BOTS_MIXED=always`.

On a small machine such as a Raspberry Pi Zero, keep `PROFILE=LOW_POWER`, which allows two bots.
To leave the plugin out of the image completely, build with `--build-arg BUILD_PLUGINS=none`; to keep it installed but
not loaded, set `PLUGINS=none`. More about plugins: [Installing plugins](installing-plugins.md).

**Bots in a separate bot server (for a bigger machine, a dashboard and metrics).** The bot server plays the bots and has
a dashboard. It runs next to the game and is off unless you ask for it.

1. Add to your `.env` file (create tokens with `openssl rand -hex 24`):

   ```bash
   BOTS_ALLOW_FILL=1
   BOTS_MODE=external
   BOTS_TOKEN=<a long random string>          # shared by the game and the bot server
   BOT_ADMIN_TOKEN=<another long random string>   # password of the bot server's dashboard
   # BOT_IMAGE=ghcr.io/<owner>/<repo>-bot   # the bot image to run
   # BOT_PORT=8090                          # port on the host
   # BOT_LEVEL=normal                       # level for rooms that did not ask for one
   # BOT_MAX_BOTS=8                         # bots playing at the same time
   ```

   Without `BOT_ADMIN_TOKEN` the bot server refuses to start.
2. Start both: `docker compose -f docker-compose.prod.yml --profile bot up -d` (add `--build` to build from this
   checkout).
3. Open `http://<host>:8090/` and sign in with the dashboard token.

**Bot server as a Linux package (deb, rpm or tarball).** The Releases page has the bot server as its own package, next to the
game server's: `party-game-bot_<version>_<name>.deb`, `party-game-bot-<version>-1.<name>.rpm` and
`party-game-bot-<version>-linux-<name>.tar.gz` (`<name>` as in [Installation](installation.md)). It can be installed on the same
computer as the game or on another one.

1. Install it: `sudo apt install ./party-game-bot_<version>_<name>.deb` (or `sudo dnf install ./party-game-bot-<version>-1.<name>.rpm`).
2. Open `/etc/default/party-game-bot` and set `ADMIN_TOKEN` (the dashboard password; without it the bot server only accepts
   requests from its own computer). If the game is on another computer or needs the bots token, also set `GAME_SERVER_URL`
   and `GAME_SERVER_BOT_TOKEN` (the game's `BOTS_TOKEN`).
3. Start it: `sudo systemctl start party-game-bot`. It also starts by itself when the computer boots.
4. Check it: `party-game-bot --check` lists every setting; `curl http://localhost:8090/healthz` answers `{"ok":true,...}`.

Other settings go in `/etc/party-game/bot-server.yaml` (see `/usr/share/doc/party-game-bot/config.example.yaml`); its data
(settings changed in the dashboard, audit log, reports, installed game packs) is in `/var/lib/party-game-bot`.
The tarball runs the same with `ADMIN_TOKEN=<password> ./bin/party-game-bot` and keeps its data in its own `data/` folder.

The **bare** flavor (`party-game-bot-bare...`) has no built-in game AI: install the `.pgpack` of each game you want bots
for with `sudo -u party-game-bot party-game-bot-games install <game>.pgpack`, then restart the bot server. With the container
image (`<image>-bot:<version>-bare`) run `docker exec <bot container> node dist/games.js install /app/data/<game>.pgpack --yes`
and restart it. Install only one flavor: the deb or rpm of one replaces the other.

If the game uses HTTPS, set `GAME_SERVER_URL=https://game:8080` in `.env`. With a self-signed certificate also set
`BOT_TLS_INSECURE=0`. The dashboard and the other bot settings are described in [`bot/README.md`](../../bot/README.md).

## Party box (own Wi-Fi, no internet needed)

You can turn a Raspberry Pi or mini PC into a plug-in party box that makes its own Wi-Fi, starts the game by itself and
sends phones straight to it. Follow [the party box guide](../party-box.md).

## Upgrade and roll back

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The image already includes the games that come with the server. To add more, or to start from a server with none, see [Installing games](installing-games.md#with-docker).

To roll back, set `TAG` to the previous version and run `up -d` again. The `party-game-data` volume survives both.
Running rooms are closed by the restart.

## Player data and backups

Profiles and statistics live in the `party-game-data` volume (`/app/data`). Keep it between upgrades. Back it up with:

```bash
docker run --rm -v party-game-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/party-game-data.tgz -C /data .
```

To switch from the default JSON store to SQLite, see [Configuration](configuration.md#profile-storage).

## Configuration in a file

Besides environment variables, mount a YAML file: uncomment the `./config.yaml:/etc/party-game/config.yaml:ro` line
in `docker-compose.prod.yml`. Values in the file win over environment variables. Start from `config.example.yaml`.

## Behind a reverse proxy

1. Forward WebSocket upgrades (`Upgrade` and `Connection` headers) to the same port as normal requests.
2. Set `TRUST_PROXY=1` so bans and rate limits see the real client address. Only do this when the proxy is
   yours and appends the client address to `X-Forwarded-For`.
3. Set an `ADMIN_TOKEN`.

## HTTPS

To serve the game over HTTPS directly (without a proxy), set `TLS_SELF_SIGNED=1` or your own certificate files, see
[HTTPS](https.md). The compose file keeps certificates in the `party-game-certs` volume.

## Security of the container

The container runs as an unprivileged user, has a health check on `/stats`, uses a read-only root file system and drops
all capabilities. Only `/app/data` is writable.

## Moving an image without a registry

To build on one machine and run on another with no registry in between, follow
[../deploy-image-transfer.md](../deploy-image-transfer.md).

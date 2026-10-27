# Installation

You can run the server in a container (recommended), from a Linux package that carries its own Node.js, or directly with Node.js.

## Requirements

| | Container | Linux package | Node.js |
|---|---|---|---|
| Software | Docker with Compose | Linux with systemd (no Node.js needed) | Node.js 18 or newer, npm |
| Network | one TCP port (default `8080`) reachable from the players' devices | same | same |
| Disk | a volume for player profiles (`/app/data`) | `/var/lib/party-game` | a writable `data/` folder |

The server is light: it runs on boards as small as a Raspberry Pi Zero W. Pick a
[performance profile](performance-profiles.md) that fits your hardware.

## Option 1: published container image

1. Run the image (replace `<owner>/<repo>` with the repository that publishes it):

   ```bash
   docker run -d --name party-game --init -p 8080:8080 -v party-game-data:/app/data \
     -e PROFILE=LOW_POWER ghcr.io/<owner>/<repo>:latest
   ```

   This image has every game and plugin. For a blank server, use `ghcr.io/<owner>/<repo>:latest-bare` and install
   the games and plugins you want from the `.pgpack` files of the release
   (see [Installing games](installing-games.md)).
2. Check it: `curl http://localhost:8080/stats` returns JSON.
3. Players open `http://<server-address>:8080/`.

For a permanent setup with a `.env` file, upgrades and backups use the compose file described in
[Deployment](deployment.md).

## Option 2: build and run from source

```bash
npm install
npm run build
PROFILE=LOW_POWER PORT=80 npm start
```

The server serves the game and the websocket on the same port. It needs write access to `DATA_DIR`
(default `./data`) for player profiles. To use a configuration file:
`npm start -- -c ./config.yaml` (see [Configuration](configuration.md)).

## Option 3: Linux package (deb, rpm or tarball)

The packages on the project's Releases page already contain Node.js and everything the server needs, so you
install nothing else. There is one for each kind of computer:

| `uname -m` says | Computer | Package name ends with |
|---|---|---|
| `x86_64` | PC, mini PC, regular server | `amd64` (`x86_64` for the rpm) |
| `aarch64` | Raspberry Pi 3/4/5 with a 64-bit system, other ARM64 boards | `arm64` (`aarch64` for the rpm) |
| `armv7l` | Raspberry Pi 2/3/4 with a 32-bit system | `armv7` (`armv7hl` for the rpm) |
| `armv6l` | Raspberry Pi Zero W and Pi 1 | `armv6` (`armv6hl` for the rpm) |

Each package comes in two flavors. The normal one has every game and plugin. The **bare** one (`-bare` in the
name, for example `party-game-bare_<version>_amd64.deb`) has none: choose it when you want to pick the games and
plugins yourself. The `.pgpack` files on the Releases page are the games and plugins; install them as described in
[Installing games](installing-games.md) and [Installing plugins](installing-plugins.md). Install only one of the two
flavors: the deb or rpm of one replaces the other.

The bot server (AI players for a bigger machine, see [Deployment](deployment.md)) is a separate package with the same
names, flavors and computers: `party-game-bot...`.

On the Pi Zero W package the SQLite profile store is not available; the default `json` store works as usual.

**Debian, Ubuntu and Raspberry Pi OS (deb)**

1. Download `party-game_<version>_<name>.deb` for your computer from Releases.
2. Install it: `sudo apt install ./party-game_<version>_<name>.deb`
3. Start the server: `sudo systemctl start party-game`. It also starts by itself when the computer boots.

**Fedora, RHEL and similar (rpm)**

1. Download `party-game-<version>-1.<name>.rpm` for your computer from Releases.
2. Install it: `sudo dnf install ./party-game-<version>-1.<name>.rpm`
3. Start the server: `sudo systemctl start party-game`.

Then check it: `curl http://localhost:8080/stats` returns JSON, and players open `http://<server-address>:8080/`.
To see what the server says, run `journalctl -u party-game -f`.
Settings, data and the extra commands that come with the package are described in [Deployment](deployment.md).

**Tarball (any Linux, no systemd needed)**

1. Download `party-game-<version>-linux-<name>.tar.gz` from Releases.
2. Unpack it and enter the folder:

   ```bash
   tar xzf party-game-<version>-linux-<name>.tar.gz
   cd party-game-<version>-linux-<name>
   ```
3. Start the server:

   ```bash
   PROFILE=LOW_POWER PORT=8080 ./bin/party-game-server
   ```

The tarball keeps player profiles in its own `data/` folder. The same folder has the other commands
(`bin/party-game-admin` and so on). Use the `.sha256` file next to any download to check it:
`sha256sum -c <file>.sha256`.

## Try it on a development machine

```bash
docker compose up
```

The game is at `http://localhost:5173` (on a phone: `http://<your-LAN-address>:5173`), server statistics at
`http://localhost:8080/stats`, and the admin page at `http://localhost:5173/admin` with the token `dev-stats`.
Source changes reload automatically.

## First check

| Address | You should see |
|---|---|
| `/` | the menu with the nickname field |
| `/status` | rooms, clients, uptime and version |
| `/stats` | JSON with tick-loop timing and counters |

## Updating

- Container: pull the new image and recreate (see [Deployment](deployment.md)). The data volume is kept.
- Linux package: install the new deb or rpm over the old one (same command as the first time). Your settings and
  `/var/lib/party-game` are kept and the service restarts by itself.
- Tarball: unpack the new one next to the old one, copy the old `data/` folder into it, restart.
- Source: update the files, run `npm install && npm run build`, restart. Rooms live in memory, so a restart
  closes them; player profiles survive.

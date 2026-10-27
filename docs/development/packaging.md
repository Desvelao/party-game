# Native Linux packages

Every release carries self-contained packages, so an operator does not need Node.js or Docker:

| File | For |
|---|---|
| `party-game-<version>-linux-<arch>.tar.gz` | any Linux, unpack and run `bin/party-game-server` |
| `party-game_<version>_<arch>.deb` | Debian, Ubuntu, Raspberry Pi OS |
| `party-game-<version>-1.<rpm arch>.rpm` | Fedora, RHEL and similar |

Each of them also comes in a **bare** flavor with no games and no plugins (core only), built from a dist made with
`GAMES=none BUILD_PLUGINS=none`: `party-game-<version>-linux-<arch>-bare.tar.gz`, `party-game-bare_<version>_<arch>.deb` and
`party-game-bare-<version>-1.<rpm arch>.rpm`. Build it with `FLAVOR=bare DIST_DIR=<bare dist> packaging/build-package.sh <arch>`.
The deb/rpm are a separate package (`party-game-bare`) that conflicts with and replaces `party-game`, since both install
under `/opt/party-game`. The games and plugins of the full build are attached to the release as `.pgpack` files (with
`SHA256SUMS-packs.txt`), so a bare install adds them with `party-game-games install` and `party-game-plugins install`.

The standalone bot server is packaged the same way, with `PRODUCT=bot` (`packaging/bot/` holds its launcher, systemd unit,
config, environment file and install scripts): `party-game-bot-<version>-linux-<arch>.tar.gz`, `party-game-bot_<version>_<arch>.deb`
and `party-game-bot-<version>-1.<rpm arch>.rpm`, and the `-bare` ones (`party-game-bot-bare...`, conflicting with and replacing
`party-game-bot`). Its dist comes from `npm run build:bot` (`scripts/build-bot.mjs`): `BOT_GAMES=all` compiles the AI of every
built-in game in (full), `BOT_GAMES=none` does not (bare: the AIs come from the game packs in `BOT_GAMES_DIR`, which the
launcher points at `<data dir>/games`, where `party-game-bot-games install <pack>.pgpack` puts them). It installs next to the
game server (`/opt/party-game-bot`, user and service `party-game-bot`, data in `/var/lib/party-game-bot`, config
`/etc/party-game/bot-server.yaml`, environment `/etc/default/party-game-bot`) and has no native module, so one `npm ci
--omit=dev --omit=optional` serves every architecture. `ADMIN_TOKEN` is not set by default: the service is enabled but
the postinstall message tells to set it before starting.

`<arch>` is `amd64`, `arm64`, `armv7` or `armv6` (Raspberry Pi Zero W / Pi 1). The rpm names are `x86_64`, `aarch64`,
`armv7hl` and `armv6hl`. Each file has a `.sha256` next to it. The user-facing description is in
`docs/manual/installation.md` and `docs/manual/deployment.md`.

## What is in a package

```
/opt/party-game/            (the tarball folder has the same layout)
  bin/node                  the official Node.js binary (BUNDLED_NODE_VERSION, 22.x like the Dockerfile)
  bin/party-game-<tool>     sh launchers, from packaging/launcher.sh.in
  dist/                     npm run build output (client, server, tools, games, plugins)
  node_modules/             production dependencies only (ws, yaml, better-sqlite3 when it can be built)
  launcher.conf             deb/rpm only: DATA_DIR=/var/lib/party-game
/usr/bin/party-game-<tool>  symlinks to the launchers (deb/rpm)
/etc/party-game/config.yaml, /etc/default/party-game    conffiles (kept on upgrade), empty on purpose
/usr/lib/systemd/system/party-game.service
/usr/share/doc/party-game/  config.example.yaml and LICENSE (the tarball folder has both at its top)
/var/lib/party-game/        created by the postinstall script, owned by the `party-game` user
```

Tools: `server`, `admin`, `config-check`, `loadtest`, `migrate-profiles`, `games`, `plugins`, each running `dist/<tool>.js`
(the files `npm run build:server` and `build:tools` make). `gamepack` and `balance` are not shipped: they need tsx and
esbuild. A new tool in `build:tools` gets one entry in `TOOLS` in `packaging/build-package.sh`, which also
checks that the file exists in `dist/`.

**Launchers.** All defaults of the server are relative to the working directory, so the launcher exports absolute
`STATIC_DIR`, `BUNDLED_GAMES_DIR`, `BUNDLED_PLUGINS_DIR`, `DATA_DIR` and `SQLITE_PATH` (only when the caller has not set
them) and runs the bundled Node on `dist/<tool>.js`. It does not `cd`, so relative file arguments such as
`party-game-games install ./pack.pgpack` keep working. The service sets `WorkingDirectory=/opt/party-game`.

**Config.** A value in the YAML file overrides the environment, so the packaged `config.yaml` has no active keys
(copying `config.example.yaml` in would override the launcher's absolute paths with relative defaults).

**Service.** `packaging/party-game.service` runs `party-game-server` as `party-game` with `NoNewPrivileges`,
`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices` and only `/var/lib/party-game` writable.
It uses options that old systemd versions (Debian 10) understand. Ports below 1024 are not possible on purpose.
`packaging/postinstall.sh` creates the user and the data folder, enables the service on a first install (it
does not start it) and restarts it on an upgrade; `preremove.sh` stops and disables it on a real removal;
the data and the user stay after a removal.

## Build locally

```bash
npm ci && npm run build
packaging/build-package.sh amd64            # tar deb rpm; or name the formats: packaging/build-package.sh amd64 tar
```

Output is in `build/packages/` (git-ignored). deb and rpm need [nfpm](https://nfpm.goreleaser.com) (`NFPM=...` to point
at the command; without it only `tar` works).
The maintainer and license in the deb/rpm come from `author` and `license` in `package.json` (MIT, Desvelao); set
`PACKAGE_MAINTAINER`, `PACKAGE_LICENSE` or `PACKAGE_HOMEPAGE` to override them (CI sets the homepage to the repository).
Check the result with `dpkg-deb -I build/packages/*.deb` and `rpm -qip build/packages/*.rpm`. The script downloads and checks the Node.js tarball into `build/cache/`.

`node_modules` contains a native module, so it must be installed for the target architecture. Without
`NODE_MODULES_FROM` the script runs `npm ci --omit=dev` when the target is the machine's own architecture, and otherwise
installs without scripts, which leaves out better-sqlite3 (the server then only has the `json` store). CI builds the
real thing for each architecture inside a `node:22-bookworm` container under QEMU and passes the folder in.

To try a package without touching your own installation, use a throwaway container, for example
`docker run --rm -v "$PWD/build/packages:/pkg:ro" debian:12 sh -c 'apt-get update && apt-get install -y /pkg/party-game_*_amd64.deb'`.

## CI

`.github/workflows/packages.yml` follows `docker-image.yml`: it runs on a `v*` tag and on `workflow_dispatch`.

1. `build`: checks that the tag matches `package.json`, then `npm run build` once (the output is the same JavaScript for every
   architecture) and shares `dist/`.
2. `package` (matrix `amd64`, `arm64`, `armv7`, `armv6`): installs nfpm, builds the production dependencies for the
   architecture and runs `packaging/build-package.sh`.
3. `smoke`: installs the amd64 deb in a Debian container and the rpm in a Fedora one, runs the launchers, starts the
   server and probes `/stats`, `/` and `/status?format=json`, repeats it with the SQLite store, and runs the tarball from
   another folder.
4. `publish` (tags, or a `tag` given to a manual run): attaches the files to the GitHub release. `release.yml` only runs
   `npm run check` and creates the release with notes; whichever workflow gets there first creates it, the other adds to it.

The arm packages are built but not run in CI (the smoke test is amd64 only).

## armv6 (Raspberry Pi Zero W)

The official Node.js releases have no armv6 binary, so that package uses the `armv6l` build from
`unofficial-builds.nodejs.org` (the version must exist there; the checksum is verified like the others). There is no Debian
Node image for armv6 either, so that package is built without better-sqlite3 and only supports the `json` profile store.
The deb has the `armhf` architecture, which is what Raspberry Pi OS uses on every Pi, and an armv7 deb has the same
architecture, so the file names carry `armv6` and `armv7` to tell them apart; install the one that matches `uname -m`.

## Changing the Node.js version

Set `BUNDLED_NODE_VERSION` (default in `packaging/build-package.sh`). Keep it equal to the Dockerfile's major version: the
better-sqlite3 binary is built for that Node ABI.

## Releasing a version

1. Set the new version in `package.json` and `package-lock.json` (`npm version <x.y.z> --no-git-tag-version`), and in `CORE_VERSION`
   (`src/core/shared/constants.ts`; `constants.test.ts` fails if they differ). Bundled plugins and packs follow the core version.
2. Move the notes in `CHANGELOG.md` from Unreleased to the new version with its date.
3. Run `npm run check`, commit, and tag `v<x.y.z>` (`git tag v0.1.0 && git push --tags`).
4. The three workflows run on the tag: `release.yml` creates the GitHub release, `docker-image.yml` pushes the image to
   `ghcr.io`, and `packages.yml` attaches the tar.gz, deb and rpm files (full and bare, for the game server and for the bot server) and the `.pgpack` files; `docker-image.yml` pushes both the full image
   and the bare one (tags with a `-bare` suffix), and the same two for the bot server (`<image>-bot`, built with `BOT_GAMES=all|none`). Each one fails if the tag differs from `package.json`.

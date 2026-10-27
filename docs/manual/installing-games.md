# Installing games

Games come as **packs**: a single `.pgpack` file made by a game's author. You can add a pack to a server, list what
is installed and remove a pack, all without rebuilding anything. The games that come with the server are packs too.

A pack runs on your server with the same permissions as the server itself. Only install packs from authors you
trust. The installer shows the pack's author and a fingerprint (sha256) so you can compare it with the one the
author published.

## Where games live

| Folder | What is in it | Setting |
|---|---|---|
| `dist/games` | The games built into this version of the server. | `gamePacks.bundledDir` |
| `games` inside the data folder (`data/games`) | The games you install. They survive updates and are backed up with the data folder. | `gamePacks.dir` |

If the same game is in both folders, the newer version is used (yours, if the versions are equal). See
[Configuration](configuration.md) for the settings.

## Install a game

1. Put the `.pgpack` file on the server.
2. Run the install command with the file name (from a Docker setup, run it inside the container, see below):

   ```bash
   npm run games -- install orb-grab-0.1.0.pgpack
   ```

3. Check the author and fingerprint shown, then type `y` to confirm. Add `--yes` to skip the question in scripts.
4. Restart the server. The game now shows up when a host creates a room.

Installing a newer version of an installed game upgrades it. To go back to the same or an older version add
`--force`.

## See what is installed

```bash
npm run games -- list
```

The table shows each game's id, version and where it comes from. **bundled** games come with the server,
**installed** games are yours. If a game exists in both places the older copy is shown as **overridden**. For the
full details of one game or of a file you have not installed yet:

```bash
npm run games -- info orb-grab
npm run games -- info orb-grab-0.1.0.pgpack
```

## Remove a game

1. Run:

   ```bash
   npm run games -- uninstall orb-grab
   ```

2. Restart the server.

Removing a game does not touch player profiles. Rooms are not kept across a restart, so no room is left holding
the game.

If your configuration file still mentions the game under `games.defaults` or `games.playlists`, the server refuses
to start and names the unknown game: remove those lines from the file first (see
[Configuration](configuration.md)). Playlists and option defaults you saved in the admin panel that mention the
game are ignored, and are dropped from the saved list the next time you change it.

## With the Linux package

The deb and rpm packages have the same command under the name `party-game-games`. Installed games go to
`/var/lib/party-game/games` and survive updates. Run it as the service user and restart the service afterwards:

```bash
sudo -u party-game party-game-games install orb-grab-0.1.0.pgpack
sudo systemctl restart party-game
```

The `.pgpack` files of every game are on the Releases page, next to the packages (the tarball needs no `sudo`:
run `bin/party-game-games install <file>` from the unpacked folder). Use them to fill a bare install. Most games need
the `characters` plugin as well (see [Installing plugins](installing-plugins.md)).

## With Docker

The commands are inside the image as `node dist/games.js`. Installed games are stored in the data volume, so they
survive `docker compose up` after an update:

```bash
docker compose cp orb-grab-0.1.0.pgpack game:/app/data/
docker compose exec game node dist/games.js install /app/data/orb-grab-0.1.0.pgpack --yes
docker compose restart game
```

`game` is the service name in `docker-compose.prod.yml`; use the one in your own compose file if it differs.

## When there are no games

A server with no games installed still starts: players can join and gather in a lobby, but when the host taps
**Start game** they see **No games are installed on this server**. The server prints `no games installed` when it
starts. Install at least one game, or build the server with
its normal games (`npm run build`).

## If a game does not appear

- The server skips a pack that is damaged, was built for a different server version, or has the same id as another
  game, and prints one line saying why when it starts.
- A game draws its players with a character model that another game or a plugin provides. When none provides it, the
  server prints `skipped game <id>: needs character model "<model>", which no installed game or plugin provides`.
  Install or enable what provides it (for the games that come with the server, the `characters` plugin: check
  `plugins.enabled`). `npm run games -- info <id>` shows the model a game needs on its `character:` line.
- `npm run config:check` lists the games the server would load and reports a game that cannot be loaded.
- Run `npm run games -- list` to check the file really is in the folder the server reads.

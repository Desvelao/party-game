# Installing plugins

A plugin adds a feature to the server without changing the game itself. Six ship with the server:

| Plugin | What it adds |
|---|---|
| `characters` | the Blob character that Tank Wars, Spring Showdown, Sprint Smash, Box Bonanza, Crazy Logs and Rumble Cards draw players with. **Keep it**: without it those games are not offered |
| `bots` | AI players for a room |
| `leaderboard` | the **Top** page: the public ranking of players (set how many are listed with `plugins.leaderboard.top`) |
| `transfer` | the **Show QR / transfer code** button in your profile, to move it to another device |
| `progression` | the **Progress** block in your profile: level and XP, win streak, achievements and your best place in each game |
| `prometheus` | `GET /metrics` for Prometheus (off until you set `plugins.prometheus.enabled` / `METRICS_ENABLED`) |

To keep a small server light, list only the ones you want in `plugins.enabled` (for example `PLUGINS=characters,bots`). Plugins are installed like games, and the server reads them when it starts.

## Where plugins live

| Folder | Holds | Setting |
|---|---|---|
| `dist/plugins` | plugins that come with this version | `plugins.bundledDir` / `BUNDLED_PLUGINS_DIR` |
| `plugins` in the data folder | plugins you install | `plugins.dir` / `PLUGINS_DIR` |

If the same plugin is in both, the higher version is used; with the same version, yours wins.

## Choose which plugins load

Set `plugins.enabled` in the configuration file, or the `PLUGINS` variable, to `all` (the default), `none`, or a list
of plugin ids such as `characters,bots`. A plugin that is not listed is not loaded at all. A game that draws its players
with a character from a plugin you leave out is skipped (see [Installing games](installing-games.md#if-a-game-does-not-appear)).

A plugin has its own settings in the file, under `plugins:` and its id (for the bots plugin: `plugins.bots`, see
[Configuration](configuration.md)). A wrong value stops the server with a message, like any other setting.

## Install, list and remove

1. Get the plugin pack (a `.pgpack` file) from its author.
2. Install it: `npm run plugins -- install my-plugin-1.0.0.pgpack`. The command shows the author and a checksum and asks
   for confirmation, because a plugin runs on the server with the same permissions as the server. Only install plugins
   from authors you trust. Add `--yes` to skip the question.
3. See what is installed: `npm run plugins -- list`. Remove one with `npm run plugins -- uninstall <id>`.
4. Restart the server.

In Docker, run the same commands inside the container with `node dist/plugins.js`, for example:

```bash
docker compose cp my-plugin-1.0.0.pgpack game:/app/data/
docker compose exec game node dist/plugins.js install /app/data/my-plugin-1.0.0.pgpack --yes
docker compose restart game
```

Installed plugins live in the data volume, so they survive image updates.

## With the Linux package

The deb and rpm packages have the same command under the name `party-game-plugins`. Installed plugins go to
`/var/lib/party-game/plugins`. Run it as the service user and restart the service afterwards:

```bash
sudo -u party-game party-game-plugins install my-plugin-1.0.0.pgpack
sudo systemctl restart party-game
```

The `.pgpack` files of the bundled plugins (for example `characters`) are on the Releases page. Use them to fill a
bare install.

## If a plugin does not load

The server skips a plugin that is damaged, built for another server version, needs a plugin that is missing, or fails to
start, and writes the reason in its log. `npm run config:check` lists the plugins that would load.

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). While the version is `0.x`, minor releases may contain breaking changes.

## [Unreleased]

### Added
- The standalone bot server is released like the game server: native packages (tar.gz, deb, rpm; `party-game-bot...`) for amd64, arm64, armv7 and armv6, and container images (`<image>-bot`), each in a full and a bare flavor. The bare one has no built-in game AI; the game packs (`.pgpack`) bring it (`party-game-bot-games install`).

## [0.1.0] - 2026-10-27

First public release.

### Added
- Server-authoritative multiplayer party game for browsers: rooms with a 4-letter code, phones as controllers, spectator watch links.
- Eight game families with 27 variants and host-adjustable options, played singly, in order, mixed or as a custom playlist.
- Installable game packs (`src/games`) and plugins (`src/plugins`): characters, bots, Prometheus metrics, profile transfer, leaderboard, progression.
- AI players with five difficulty levels.
- Server-side profiles (name, colour, character, stats, language) with no accounts.
- Admin operations through the CLI, the HTTP API and the `/admin` page.
- Interface in English, Spanish, French, German, Portuguese and Italian.
- Docker images, and native Linux packages (tar.gz, deb, rpm) for amd64, arm64, armv7 and armv6.
- Low-power profile for Raspberry Pi Zero W class hardware.

[0.1.0]: https://github.com/OWNER/REPO/releases/tag/v0.1.0

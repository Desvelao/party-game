# Bonk Arena Party: manual

Bonk Arena Party is a party game for browsers. One device (a PC, a mini PC or a Raspberry Pi) runs the
server; everyone else joins from a phone, tablet or computer by typing a 4-letter room code. Phones act as the
controller, and anyone can also watch a match on a bigger screen.

## Quick start

1. Start the server (see [Installation](installation.md)): `docker compose up` for a quick try.
2. Open `http://<server-address>:8080/` on a phone or computer.
3. Type a nickname and choose **Create room**.
4. Friends open the same address and type the room code, or open the invite link you copy from the lobby.
5. Everybody taps **I'm ready!**, the host taps **Start game**.

## Where to look

| You are... | Read |
|---|---|
| A player joining a friend's room | [Playing](players.md), then [Your profile](profiles.md) |
| The person who creates a room | [Hosting a room](hosts.md), [Games](games.md) |
| Setting up the server (Docker, or a deb/rpm/tarball package) | [Installation](installation.md), [Deployment](deployment.md) |
| Serving the game over HTTPS | [HTTPS](https.md) |
| Making a plug-in party box with its own Wi-Fi | [Party box](../party-box.md) |
| Installing the game as an app on a phone or computer | [Install as an app](install-app.md) |
| Adding or removing games | [Installing games](installing-games.md) |
| Adding or removing plugins (such as the bots) | [Installing plugins](installing-plugins.md) |
| Tuning or running the server | [Configuration](configuration.md), [Performance profiles](performance-profiles.md), [Administration](administration.md) |
| Stuck | [Troubleshooting](troubleshooting.md) |

For the admin HTTP API see [../admin-api.md](../admin-api.md); for moving an image to a server without a registry see
[../deploy-image-transfer.md](../deploy-image-transfer.md). Developers: [../../README.md](../../README.md) and
[../../AGENTS.md](../../AGENTS.md).

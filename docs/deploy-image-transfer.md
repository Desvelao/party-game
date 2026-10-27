# Deploy a prebuilt image to another server (no registry)

Build the production image locally, ship it as a tarball, and run it on the
target server with `docker-compose.prod.yml`.

## 1. Build locally

```bash
# Add --platform linux/arm64 (etc.) if the target server is not amd64
docker build --platform linux/amd64 -t party-game:0.1.0 -t party-game:latest .
```

The build packs every game under `src/games/` into the image (`dist/games`), so the checkout you build from must
contain `src/games/`. For a blank server with no games (to fill later, see step 7), add `--build-arg GAMES=none`.

## 2. Smoke test locally

Uses a standalone container so it does not touch any running compose stack.

```bash
docker run -d --rm --name pg-verify -p 18080:8080 party-game:0.1.0
curl -fs localhost:18080/stats
curl -fsI localhost:18080/ | head -1
# the games must be in the image: expect crazy-logs, rumble-cards and tank-wars
curl -fs localhost:18080/games/index.json | grep -o '"id":"[a-z-]*","version"'
docker exec pg-verify ls dist/games
docker logs pg-verify 2>&1 | grep -i 'no games installed' && echo "WARNING: image has no games"
docker stop pg-verify
```

## 3. Export and transfer

```bash
docker save party-game:0.1.0 | gzip > party-game-0.1.0.tar.gz
ssh user@SERVER 'mkdir -p ~/party-game'
scp party-game-0.1.0.tar.gz docker-compose.prod.yml user@SERVER:~/party-game/
# optional: scp config.example.yaml user@SERVER:~/party-game/config.yaml
```

## 4. Deploy on the server

Requires Docker and the compose plugin.

```bash
cd ~/party-game
gunzip -c party-game-0.1.0.tar.gz | docker load

cat > .env <<EOF
IMAGE=party-game
TAG=0.1.0
PORT=8080
PROFILE=NORMAL
PROFILE_STORE=sqlite
ADMIN_TOKEN=$(openssl rand -hex 24)
# TRUST_PROXY=1   # only when behind nginx/Caddy
EOF
chmod 600 .env

docker compose -f docker-compose.prod.yml up -d --no-build
```

`--no-build` makes compose use the loaded image instead of trying to build
from source, which is not present on the server.

If you copied `config.yaml`, uncomment the `./config.yaml:/etc/party-game/config.yaml:ro`
volume in `docker-compose.prod.yml`; the server reads that path by default.

## 5. Verify

```bash
docker compose -f docker-compose.prod.yml ps        # STATUS should become "healthy"
curl -fs localhost:8080/stats                       # use the PORT from .env
curl -fs localhost:8080/games/index.json | grep -o '"id":"[a-z-]*","version"'
docker compose -f docker-compose.prod.yml logs --tail 50   # no "no games installed" line
```

Then open `http://SERVER:8080` in a browser (allow port 8080 in the firewall
for this initial test).

## 6. Operations

**Upgrade:** repeat steps 1-3 with a new tag, `docker load` it on the server,
set `TAG` in `.env`, and run `docker compose -f docker-compose.prod.yml up -d --no-build`.

**Rollback:** set `TAG` back to the previous version and run the same `up -d`.

**Backup data** (volume `party-game-data`: profiles, plus games installed with step 7):

```bash
docker run --rm -v party-game-data:/d -v "$PWD":/b alpine \
  tar czf /b/party-game-data.tgz -C /d .
```

**Beyond the initial test:** put nginx or Caddy with TLS in front, forward the
`Upgrade` and `Connection` headers for `/ws`, bind the app to loopback, and set
`TRUST_PROXY=1`.

## 7. Add games to a blank server (optional)

Games installed this way live in the data volume (`/app/data/games`), so they survive upgrades. Copy the pack
to the server, then:

```bash
docker compose -f docker-compose.prod.yml cp orb-grab-0.1.0.pgpack game:/app/data/
docker compose -f docker-compose.prod.yml exec game node dist/games.js install /app/data/orb-grab-0.1.0.pgpack --yes
docker compose -f docker-compose.prod.yml restart game
```

See [Installing games](../manual/installing-games.md) for details.

# Rumble Cards

A game pack for the party game server.

```sh
npm run gamepack -- build .         # bundle server + client into rumble-cards-<version>.pgpack
npm run gamepack -- validate .      # play it headless with bots and check the rules a pack must follow
npm run games -- install rumble-cards-0.1.0.pgpack
```

Edit `game.json` (name, options, guide, Spanish texts), `server/index.ts` (the simulation) and
`client/index.ts` (the drawing). See `docs/development/game-packs.md` for the full contract.

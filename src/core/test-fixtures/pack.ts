/** A tiny but complete game pack for tests: players race a counter, first input wins. */
import { PACK_API_VERSION, type GameManifest } from '../shared';
import { sha256, type PackFiles } from '../server/plugins/pack';

export const FIXTURE_SERVER = `
export default {
  createMinigame(playableId, options) {
    const limit = Number(options.limit ?? 3);
    let players = [];
    let t = 0;
    const score = new Map();
    return {
      id: playableId,
      name: 'Fixture Game',
      init(p) { players = p.map((x) => x.id); for (const id of players) score.set(id, 0); },
      handleInput(id, input) { if (input.a1 && score.has(id)) score.set(id, score.get(id) + 1); },
      removePlayer(id) { score.delete(id); },
      addPlayer(p) { if (players.includes(p.id)) score.set(p.id, 0); },
      getStats() { return Object.fromEntries(players.map((id) => [id, { score: score.get(id) ?? 0 }])); },
      update(dt) { t += dt; },
      getState() { return { kind: 'ext:fixture-game', t, limit, players: players.map((id) => ({ id, score: score.get(id) ?? 0 })) }; },
      drainEvents() { return []; },
      isFinished() { return t >= limit; },
      getPlacements() {
        const ranked = [...players].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
        return ranked.map((id, i) => ({ id, place: i + 1 }));
      },
    };
  },
};
`;

export const FIXTURE_CLIENT = `export default { kinds: ['ext:fixture-game'], createRenderer() { return { render() {} }; } };`;

export function fixtureManifest(files: PackFiles, over: Partial<GameManifest> = {}): GameManifest {
  const guide = { objective: { en: 'Press the button.', es: 'Pulsa el botón.' }, rules: [{ en: 'Be quick.', es: 'Sé rápido.' }] };
  return {
    id: 'fixture-game',
    name: 'Fixture Game',
    version: '1.0.0',
    apiVersion: PACK_API_VERSION,
    author: 'tests',
    license: 'MIT',
    description: 'A game for tests.',
    catalog: {
      id: 'fixture-game',
      name: 'Fixture Game',
      description: 'Press the button faster than the others.',
      action: 'act',
      guide,
      options: [{ id: 'limit', label: 'Length', description: 'Seconds the round lasts.', type: 'number', default: 3, min: 1, max: 60, unit: 's' }],
      variants: [],
    },
    locales: { es: { 'Press the button faster than the others.': 'Pulsa el botón más rápido que los demás.' } },
    files: Object.fromEntries([...files].filter(([n]) => n === 'server.mjs' || n === 'client.mjs').map(([n, d]) => [n, sha256(d)])),
    ...over,
  };
}

/** Files of a valid pack; `over` patches the manifest (and may re-point `catalog`). */
export function fixturePack(over: Partial<GameManifest> = {}, server = FIXTURE_SERVER): PackFiles {
  const files: PackFiles = new Map([
    ['server.mjs', Buffer.from(server)],
    ['client.mjs', Buffer.from(FIXTURE_CLIENT)],
  ]);
  files.set('game.json', Buffer.from(JSON.stringify(fixtureManifest(files, over), null, 2)));
  return files;
}

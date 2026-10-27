import { pathToFileURL } from 'node:url';
import { publishedSettings, type PublishedSetting } from '../shared';
import { registerSourceCatalogs } from '../server/plugins/sourceGames';

function allowed(s: PublishedSetting): string {
  if (s.type === 'boolean') return 'true | false';
  if (s.type === 'choice') return (s.choices ?? []).map((c) => c.value).join(' | ');
  const range = `${s.min ?? ''}–${s.max ?? ''}`;
  return `${range}${s.step ? `, step ${s.step}` : ''}${s.unit ? `, ${s.unit}` : ''}`;
}

/**
 * The `games:` section of config.example.yaml, generated from the published settings so it
 * lists every game and variant option with its allowed values and built-in default.
 */
export function renderGamesExample(): string {
  const lines = [
    'games:                        # defaults of the options a host can change per game / variant',
    '  # A game id applies to all its variants; a variant id overrides its game. Values set in the',
    '  # admin panel win over this file. Out-of-range values or unknown ids stop the server at startup.',
    '  defaults:',
  ];
  for (const g of publishedSettings()) {
    if (g.settings.length === 0) continue;
    lines.push('', `    # ${g.name}${g.target === g.game ? ' (every variant)' : ''}`, `    # ${g.target}:`);
    for (const s of g.settings) {
      const value = typeof s.default === 'string' ? JSON.stringify(s.default) : String(s.default);
      lines.push(`    #   ${`${s.id}: ${value}`.padEnd(26)} # ${s.label}: ${allowed(s)}`);
    }
  }
  lines.push(
    '',
    '  # Ready-made playlists hosts can load in the playlist builder (marked with a star). Playlists',
    '  # edited or removed in the admin panel replace the ones written here. 1-10 rounds each, at most 20',
    '  # playlists; name up to 24 characters; id (optional, default: the name as a slug) up to 12 of a-z 0-9 - _',
    '  # Each round is a concrete game and variant (ids as under defaults above) and optional options.',
    '  # playlists:',
    '  #   - id: quick',
    '  #     name: Quick party',
    '  #     rounds:',
    '  #       - game: box-bonanza',
    '  #         variant: jungle-bonanza',
    '  #         options: { timeLimit: 60 }',
    '  #       - game: ballistix',
    '  #         variant: smashball',
  );
  return lines.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // the example lists the games that ship with the server: read them from src/games/
  registerSourceCatalogs();
  process.stdout.write(renderGamesExample());
}

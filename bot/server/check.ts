// `npm run bot:server -- --check`: the effective configuration and where each value came from (secrets masked).
import { validateConfig } from './config';
import type { Loaded } from './config';
import { MAPS, SETTINGS, getAt, key } from './settings';

export function describeConfig(l: Loaded): string[] {
  const out = [l.file ? `config file: ${l.file.path} (${l.file.source})` : 'config file: none (environment and defaults only)', ''];
  for (const d of SETTINGS) {
    const k = key(d.path);
    const raw = getAt(l.cfg, d.path);
    const value = d.secret ? (raw ? '(set)' : '(unset)') : JSON.stringify(raw);
    out.push(`${k.padEnd(28)} ${value.padEnd(30)} ${l.sources.get(k)}${d.live ? '' : '  (restart to change)'}`);
  }
  for (const m of MAPS) {
    const k = key(m.path);
    out.push(`${k.padEnd(28)} ${JSON.stringify(getAt(l.cfg, m.path)).padEnd(30)} ${l.sources.get(k)}`);
  }
  return out;
}

/** Prints the report and returns the process exit code. */
export function checkConfig(l: Loaded): number {
  for (const line of describeConfig(l)) console.log(line);
  for (const w of l.warnings) console.warn(`warning: ${w}`);
  const errors = validateConfig(l.cfg);
  for (const e of errors) console.error(`error: ${e}`);
  if (!errors.length) console.log('\nconfiguration OK');
  return errors.length ? 1 : 0;
}

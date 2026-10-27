/**
 * Copy player profiles from one storage driver to another, using the configured settings
 * of each (storage.json.dataDir, storage.sqlite.path, ...). Safe to run repeatedly.
 *
 *   npm run profiles:migrate -- --from json --to sqlite [-c config.yaml]
 */
import { loadConfig } from '../server/config';
import { ConfigError, loadConfigFile, resolveConfigPath } from '../server/configFile';
import { createProfileRepository, isMigratable } from '../server/profiles';

const STORES = ['json', 'sqlite', 'memory'] as const;
type Store = (typeof STORES)[number];

function parse(argv: string[]): { from: Store; to: Store; config?: string } {
  const out: { from?: string; to?: string; config?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith('-')) throw new ConfigError(`${a} needs a value`, 2);
      return v;
    };
    if (a === '--from') out.from = next();
    else if (a === '--to') out.to = next();
    else if (a === '-c' || a === '--config') out.config = next();
    else throw new ConfigError(`unknown argument "${a}"`, 2);
  }
  const ok = (v?: string): v is Store => !!v && (STORES as readonly string[]).includes(v);
  if (!ok(out.from) || !ok(out.to)) throw new ConfigError(`usage: profiles:migrate --from <${STORES.join('|')}> --to <${STORES.join('|')}> [-c config.yaml]`, 2);
  if (out.from === out.to) throw new ConfigError('--from and --to must differ', 2);
  return { from: out.from, to: out.to, config: out.config };
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const resolved = resolveConfigPath({ config: args.config });
  const base = loadConfig(resolved ? loadConfigFile(resolved.path) : {});

  const source = createProfileRepository({ ...base, profileStore: args.from });
  const target = createProfileRepository({ ...base, profileStore: args.to });
  if (!isMigratable(source) || !isMigratable(target)) throw new ConfigError('both drivers must support migration');
  await source.init?.();
  await target.init?.();
  try {
    const records = await source.entries();
    let n = 0;
    for (const [id, rec] of records) {
      await target.importRecord(id, rec);
      n++;
    }
    console.log(`[party-game] migrated ${n} profile(s) from ${args.from} to ${args.to}`);
  } finally {
    await source.close();
    await target.close();
  }
}

main().catch((err) => {
  console.error(`[party-game] ${err instanceof ConfigError ? err.message : err}`);
  process.exit(err instanceof ConfigError ? err.exitCode : 1);
});

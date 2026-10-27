import { join } from 'node:path';
import type { ServerConfig } from '../config';
import { JsonProfileRepository } from './JsonProfileRepository';
import { MemoryProfileRepository } from './MemoryProfileRepository';
import type { ProfileRepository } from './ProfileRepository';
import { SqliteProfileRepository } from './SqliteProfileRepository';

export * from './profile';
export type { AdminRepository, MigratableRepository, ProfileRepository } from './ProfileRepository';
export { ProfileLimitError, isAdminRepository, isMigratable } from './ProfileRepository';
export { JsonProfileRepository } from './JsonProfileRepository';
export { MemoryProfileRepository } from './MemoryProfileRepository';
export { SqliteProfileRepository, SqliteUnavailableError } from './SqliteProfileRepository';

type StoreConfig = Pick<ServerConfig, 'profileStore' | 'dataDir' | 'sqlitePath' | 'sqliteBusyTimeoutMs' | 'maxProfiles'>;

/**
 * Pick the store from config (`storage.store`). Another database backend is one more case here
 * plus a class implementing ProfileRepository. The caller awaits `init()` before serving.
 */
export function createProfileRepository(cfg: StoreConfig): ProfileRepository {
  switch (cfg.profileStore) {
    case 'memory':
      return new MemoryProfileRepository(cfg.maxProfiles);
    case 'sqlite':
      return new SqliteProfileRepository({ path: cfg.sqlitePath, busyTimeoutMs: cfg.sqliteBusyTimeoutMs, maxProfiles: cfg.maxProfiles });
    case 'json':
    default:
      return new JsonProfileRepository(join(cfg.dataDir, 'profiles.json'), cfg.maxProfiles);
  }
}

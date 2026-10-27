import type { ProfilePatch, ProfileRecord, ResultDelta } from './profile';

/** Thrown by `upsert`/`recordResult` when a new profile would exceed the store's capacity. */
export class ProfileLimitError extends Error {
  constructor() {
    super('profile limit reached');
  }
}

/**
 * Persistence for player profiles. Callers depend only on this interface, so the
 * file store can be replaced by a database without touching rooms or the HTTP API.
 *
 * `id` is an opaque storage key (see `profileIdOf`); implementations must treat it as a
 * string and must not assume anything about its shape. All methods are async on purpose.
 * Pure record logic (sanitizing, stat merging) lives in `./profile` and should be reused.
 */
export interface ProfileRepository {
  get(id: string): Promise<ProfileRecord | null>;
  /** Merge the editable fields (name/color/looks/avatar); creates the record when missing. */
  upsert(id: string, patch: ProfilePatch): Promise<ProfileRecord>;
  /** Add a finished game / match to the stats (creates the record when missing). */
  recordResult(id: string, delta: ResultDelta): Promise<void>;
  /** Open connections / create the schema. Awaited once at startup so misconfiguration fails fast. */
  init?(): Promise<void>;
  /** Flush pending writes and release resources. */
  close(): Promise<void>;
}

/** Optional capability used by the `profiles:migrate` tool to copy data between drivers. */
export interface MigratableRepository extends ProfileRepository {
  entries(): Promise<[string, ProfileRecord][]>;
  /** Insert or fully replace one record (already-validated data, stats included). */
  importRecord(id: string, record: ProfileRecord): Promise<void>;
}

/** Operator capability: removing records. Listing and counting go through `entries()`. */
export interface AdminRepository extends MigratableRepository {
  /** True when a record existed. */
  delete(id: string): Promise<boolean>;
}

export function isAdminRepository(r: ProfileRepository): r is AdminRepository {
  return isMigratable(r) && typeof (r as AdminRepository).delete === 'function';
}

export function isMigratable(r: ProfileRepository): r is MigratableRepository {
  return typeof (r as MigratableRepository).entries === 'function' && typeof (r as MigratableRepository).importRecord === 'function';
}

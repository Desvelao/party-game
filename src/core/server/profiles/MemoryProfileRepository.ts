import { applyPatch, applyResult, newRecord, type ProfilePatch, type ProfileRecord, type ResultDelta } from './profile';
import { ProfileLimitError, type AdminRepository } from './ProfileRepository';

export class MemoryProfileRepository implements AdminRepository {
  protected records = new Map<string, ProfileRecord>();

  constructor(
    protected readonly maxProfiles = 10_000,
    protected readonly clock: () => number = Date.now,
  ) {}

  async get(id: string): Promise<ProfileRecord | null> {
    return this.records.get(id) ?? null;
  }

  async upsert(id: string, patch: ProfilePatch): Promise<ProfileRecord> {
    const now = this.clock();
    const cur = this.records.get(id);
    if (!cur && this.records.size >= this.maxProfiles) throw new ProfileLimitError();
    const next = cur ? applyPatch(cur, patch, now) : newRecord(now, patch);
    this.records.set(id, next);
    this.changed();
    return next;
  }

  async recordResult(id: string, delta: ResultDelta): Promise<void> {
    const now = this.clock();
    let cur = this.records.get(id);
    if (!cur) {
      if (this.records.size >= this.maxProfiles) throw new ProfileLimitError();
      cur = newRecord(now, { name: delta.name });
    }
    this.records.set(id, applyResult(cur, delta, now));
    this.changed();
  }

  async entries(): Promise<[string, ProfileRecord][]> {
    return [...this.records];
  }

  async importRecord(id: string, record: ProfileRecord): Promise<void> {
    if (!this.records.has(id) && this.records.size >= this.maxProfiles) throw new ProfileLimitError();
    this.records.set(id, record);
    this.changed();
  }

  async delete(id: string): Promise<boolean> {
    const had = this.records.delete(id);
    if (had) this.changed();
    return had;
  }

  async close(): Promise<void> {}

  /** hook for subclasses that persist */
  protected changed(): void {}
}

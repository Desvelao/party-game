// Small helpers for game AIs (a pack's `ai`): the human-like handicaps every bot level is built from, and button
// timing. Stateful per bot, allocation-light (they run in the game server's loop).

/**
 * Reaction time: keeps the recent views of the world and hands out the newest one that is at least `delayMs` old
 * (the oldest it has when none is). Views must carry `recvMs`, the time the snapshot arrived.
 */
export class ReactionBuffer<T extends { recvMs: number }> {
  private items: T[] = [];

  constructor(private readonly size = 40) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.size) this.items.shift();
  }

  get latest(): T | null {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }

  at(nowMs: number, delayMs: number): T | null {
    if (!this.items.length) return null;
    if (delayMs <= 0) return this.items[this.items.length - 1];
    let w = this.items[0];
    for (const c of this.items) if (c.recvMs <= nowMs - delayMs) w = c;
    return w;
  }

  clear(): void {
    this.items.length = 0;
  }
}

/** Attention lapses: `rate` per second on average, each one freezing the bot for 300-600 ms. */
export class Lapses {
  private until = 0;
  private last = 0;
  count = 0;

  constructor(private readonly rng: () => number) {}

  /** true while the bot is "not paying attention" */
  active(nowMs: number, rate: number): boolean {
    const dtS = Math.min(0.1, Math.max(0, (nowMs - this.last) / 1000));
    this.last = nowMs;
    if (rate > 0 && nowMs >= this.until && this.rng() < rate * dtS) {
      this.until = nowMs + 300 + this.rng() * 300;
      this.count++;
    }
    return nowMs < this.until;
  }
}

/**
 * A button the game reads on its press edge. The host only sends an input when it changes, so a press has to be
 * held long enough to reach the server (`holdMs`) and released long enough before the next one (`gapMs`).
 */
export class EdgeButton {
  private downUntil = 0;
  private upUntil = 0;
  presses = 0;

  constructor(private readonly holdMs = 70, private readonly gapMs = 70) {}

  /** ask for a press now; returns false while the previous one is still down or the release gap runs */
  press(nowMs: number): boolean {
    if (nowMs < this.upUntil) return false;
    this.downUntil = nowMs + this.holdMs;
    this.upUntil = this.downUntil + this.gapMs;
    this.presses++;
    return true;
  }

  /** the button state to send now */
  down(nowMs: number): boolean {
    return nowMs < this.downUntil;
  }

  /** a press may be asked for */
  ready(nowMs: number): boolean {
    return nowMs >= this.upUntil;
  }
}

/** Gaussian-ish noise in [-1, 1] (sum of two uniforms), for aim and timing errors. */
export const jitter = (rng: () => number): number => rng() + rng() - 1;

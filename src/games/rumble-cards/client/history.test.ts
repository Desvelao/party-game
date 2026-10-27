import { describe, expect, it } from 'vitest';
import { CARDS } from '../shared/cards';
import { PlayLog } from './history';

const idx = (n: string) => CARDS.findIndex((c) => c.name === n);

describe('PlayLog', () => {
  it('a play collects the hits, blocks and heals it caused, per player', () => {
    const log = new PlayLog();
    log.add({ kind: 'ext:play', id: 'a', c: idx('Pounce'), tg: 'b' });
    log.add({ kind: 'ext:block', id: 'b', n: 1, hp: 10, sh: 1 });
    log.add({ kind: 'hit', id: 'b', n: 1, hp: 9, sh: 0 });
    expect(log.entries()).toHaveLength(1);
    const e = log.entries()[0];
    expect(e).toMatchObject({ kind: 'play', p: 'a', tg: 'b' });
    expect(e.changes.b).toMatchObject({ hp: -1, sh: -1, hpNow: 9, shNow: 0 });
  });

  it('a hit-everyone card lists every victim, a Defense card the caster\'s gain', () => {
    const log = new PlayLog();
    log.add({ kind: 'ext:play', id: 'a', c: idx('Quake'), tg: '' });
    log.add({ kind: 'hit', id: 'b', n: 1, hp: 9, sh: 0 });
    log.add({ kind: 'hit', id: 'c', n: 1, hp: 4, sh: 0 });
    expect(Object.keys(log.entries()[0].changes)).toEqual(['b', 'c']);
    log.add({ kind: 'ext:play', id: 'b', c: idx('Burrow Wall'), tg: '' });
    log.add({ kind: 'ext:guard', id: 'b' });
    expect(log.entries()[1].changes.b.sh).toBe(2);
  });

  it('heals, destroyed Defense and knock-outs belong to the play that caused them', () => {
    const log = new PlayLog();
    log.add({ kind: 'ext:play', id: 'a', c: idx('Shatter'), tg: 'b' });
    log.add({ kind: 'hit', id: 'b', n: 1, hp: 0, sh: 0 });
    log.add({ kind: 'ext:break', id: 'b' });
    log.add({ kind: 'eliminated', id: 'b' });
    expect(log.entries()[0].changes.b).toMatchObject({ hp: -1, broke: 1, out: true });
    log.add({ kind: 'ext:play', id: 'a', c: idx('Nap'), tg: '' });
    log.add({ kind: 'heal', id: 'a', n: 1, hp: 8 });
    expect(log.entries()[1].changes.a).toMatchObject({ hp: 1, hpNow: 8 });
  });

  it('discards are entries of their own, and events of other kinds are ignored', () => {
    const log = new PlayLog();
    log.add({ kind: 'throw', id: 'a' });
    log.add({ kind: 'hit', id: 'a', n: 1 }); // nothing played yet
    expect(log.entries()).toHaveLength(0);
    log.add({ kind: 'ext:discard', id: 'a', c: idx('Zap'), auto: true });
    expect(log.entries()[0]).toMatchObject({ kind: 'discard', p: 'a', auto: true });
    log.add({ kind: 'hit', id: 'a', n: 1 }); // after a discard: not part of it
    expect(Object.keys(log.entries()[0].changes)).toHaveLength(0);
  });

  it('keeps the last 40, tells subscribers, and starts over on reset', () => {
    const log = new PlayLog();
    let calls = 0;
    const off = log.subscribe(() => calls++);
    for (let i = 0; i < 45; i++) log.add({ kind: 'ext:play', id: 'a', c: 0, tg: '' });
    expect(log.entries()).toHaveLength(40);
    expect(log.entries()[39].n).toBe(45);
    expect(calls).toBe(45);
    off();
    log.reset();
    expect(log.entries()).toHaveLength(0);
    expect(calls).toBe(45);
    log.add({ kind: 'ext:play', id: 'a', c: 0, tg: '' });
    expect(log.entries()[0].n).toBe(1);
  });
});

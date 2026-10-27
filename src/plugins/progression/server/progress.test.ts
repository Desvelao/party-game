import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, applyEvent, emptyProgress, levelFromXp, reviveProgress, viewOf, xpForLevel } from './progress';

const round = (id: string, place: number) => ({ game: { id, place, points: 0 } });
const match = (won: boolean, players = 3, place = won ? 1 : 2) => ({ match: { score: 0, won, players, place } });

describe('levels', () => {
  it('rises with XP and agrees with xpForLevel', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    for (let n = 1; n < 40; n++) {
      expect(levelFromXp(xpForLevel(n))).toBe(n);
      expect(levelFromXp(xpForLevel(n + 1) - 1)).toBe(n);
    }
  });
  it('viewOf gives the bar numbers', () => {
    const v = viewOf({ ...emptyProgress(), xp: 80 });
    expect(v).toMatchObject({ level: 2, into: 30, need: 100 });
  });
});

describe('applyEvent', () => {
  it('gives round XP by place and keeps the best (lowest) place per game', () => {
    const p = emptyProgress();
    applyEvent(p, round('tank', 3), 1);
    applyEvent(p, round('tank', 1), 2);
    applyEvent(p, round('tank', 2), 3);
    expect(p.bests).toEqual({ tank: 1 });
    expect(p.rounds).toBe(3);
    expect(p.xp).toBe(5 + 3 + (5 + 10) + (5 + 6));
  });

  it('counts a win streak, resets it on a lost match and ignores solo play', () => {
    const p = emptyProgress();
    applyEvent(p, match(true), 1);
    applyEvent(p, match(true), 2);
    expect(p).toMatchObject({ streak: 2, bestStreak: 2, wins: 2, matches: 2 });
    applyEvent(p, match(false, 1, 1), 3); // alone: not a loss
    expect(p.streak).toBe(2);
    applyEvent(p, match(false), 4);
    expect(p).toMatchObject({ streak: 0, bestStreak: 2, matches: 4 });
  });

  it('unlocks each achievement once and reports it', () => {
    const p = emptyProgress();
    expect(applyEvent(p, match(true), 10)).toEqual(['first-match', 'first-win']);
    expect(applyEvent(p, match(true), 11)).toEqual([]);
    expect(p.achievements['first-win']).toBe(10);
    for (let i = 0; i < 5; i++) applyEvent(p, round(`g${i}`, 1), 12);
    expect(p.achievements['games-5']).toBe(12);
  });

  it('has unique achievement ids', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('reviveProgress', () => {
  it('keeps good data and drops junk', () => {
    const p = reviveProgress({ xp: 12.7, wins: -3, streak: 'x', bests: { a: 2, b: 0, c: 'z' }, achievements: { 'first-win': 5, nope: 1 } });
    expect(p).toMatchObject({ xp: 12, wins: 0, streak: 0, bests: { a: 2 }, achievements: { 'first-win': 5 } });
    expect(reviveProgress(null)).toEqual(emptyProgress());
  });
});

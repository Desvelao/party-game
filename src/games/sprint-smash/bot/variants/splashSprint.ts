// Splash Sprint: the centre hub has 6 ports; tubes leave them (all six, or one) and sweep the track while out (ext > 0.3 hurts),
// the hub turning against the lap direction at rodSpeed; the second button (a2) jumps (JUMP_TIME in the air, then JUMP_COOLDOWN). In the air rods, missiles and bumps miss.
// The bot jumps when a rod (with `jumpRods`) or a missile will reach it within the time a jump covers.
//
// Measured (5 laps, 30 rounds, seats swapped): semigod jumping vs not 30-0; hard (150 ms reaction, jumps late) 14-16.
// Before the game fix of 2026-10 a rod carried a hit craft along at its own speed, and jumping lost 0-8.
import { circleBar } from '../../../../core/shared/kit/collision';
import { DASH_CX, DASH_CY, DASH_ROD_HALF, DASH_ROD_LEN, JUMP_COOLDOWN, JUMP_TIME, MISSILE_R, MISSILE_SPEED, PLAYER_R, ROD_HIT, polar } from '../physics';
import type { Decision } from '../policy/types';
import type { World } from '../world';
import type { Rules, VariantAdapter } from './types';

export const create = (rules: Rules): VariantAdapter => {
  let jumpedAt = -Infinity;
  return {
    rules,
    refine(w: World, d: Decision, P: Record<string, number>, nowMs: number, rng: () => number): void {
      const me = w.me;
      if (!me || me.stun || me.air > 0 || me.fall || nowMs - jumpedAt < (JUMP_TIME + JUMP_COOLDOWN) * 1000 || P.dodge <= 0) return;
      const rods = w.state.rods;
      let threat = false;
      // where we will be in the next 0.25 s, along our heading
      for (const t of [0.08, 0.16, 0.25]) {
        const x = me.x + Math.cos(me.f) * me.speed * t;
        const y = me.y + Math.sin(me.f) * me.speed * t;
        if (P.jumpRods && rods) {
          // the hub turns against the lap direction; tube k points at a + k * 60 deg
          const a = rods.a - (w.rodSpeed ?? rules.rodSpeed) * t;
          for (let k = 0; k < rods.tubes.length; k++) {
            if (rods.tubes[k] > ROD_HIT && circleBar(x, y, PLAYER_R + 4, DASH_CX, DASH_CY, a + (k * Math.PI * 2) / rods.tubes.length, DASH_ROD_LEN * rods.tubes[k], DASH_ROD_HALF).hit) threat = true;
          }
        }
        for (const m of w.missiles) {
          const pa = polar(x, y);
          const ma = m.a + (MISSILE_SPEED / m.r) * t;
          if (Math.abs(m.r - pa.r) < MISSILE_R && Math.abs(Math.atan2(Math.sin(ma - pa.a), Math.cos(ma - pa.a))) * m.r < MISSILE_R) threat = true;
        }
      }
      if (threat && rng() < 0.4 + 0.6 * P.dodge) {
        jumpedAt = nowMs;
        d.press = true;
        d.mode = 'jump';
      }
    },
  };
};

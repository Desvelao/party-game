// Constants and option parsing of __NAME__. Keep them here so the bot (if the pack gets one) imports them instead of copying.
export const WORLD = 1000;
export const SPEED = 320;
export const PLAYER_R = 24;
export const ORB_R = 16;

/** Host options with their defaults. A timed "every" option would add a `<name>Variance` companion (see AGENTS.md of the repo). */
export function readOptions(options: Record<string, number | boolean | string>): { limit: number; orbCount: number } {
  return { limit: Number(options.timeLimit ?? 30), orbCount: Number(options.orbs ?? 5) };
}

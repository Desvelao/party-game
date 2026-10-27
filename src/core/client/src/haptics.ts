/** Short vibrations for the local player's hits and eliminations (phones that support it). */
const PATTERNS = { hit: 40, eliminated: [80, 40, 160] } as const;

export function vibrate(kind: keyof typeof PATTERNS, enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(PATTERNS[kind] as number | number[]);
  } catch {
    /* unsupported or blocked: no feedback */
  }
}

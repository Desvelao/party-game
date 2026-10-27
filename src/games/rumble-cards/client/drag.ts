// Pure helpers of the card drag (Controller.ts), kept apart so they can be tested without a browser.

/** pointer movement (px) before a press on a card is a drag or a scroll rather than a tap */
export const DRAG_START_PX = 6;

export type DragMode = 'undecided' | 'scroll' | 'drag';

/** A clearly sideways move scrolls the hand; any other move picks the card up. */
export function dragMode(dx: number, dy: number): DragMode {
  if (Math.hypot(dx, dy) < DRAG_START_PX) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'scroll' : 'drag';
}

/** Degrees a lifted card leans with its sideways movement, at most 8 either way. */
export function tilt(dx: number): number {
  return Math.max(-8, Math.min(8, dx / 12));
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Limit a move of `box` by (dx, dy) so the card stays inside a vw x vh window. */
export function clampToScreen(box: Box, dx: number, dy: number, vw: number, vh: number): { dx: number; dy: number } {
  const x = Math.min(Math.max(box.left + dx, 0), Math.max(0, vw - box.width));
  const y = Math.min(Math.max(box.top + dy, 0), Math.max(0, vh - box.height));
  return { dx: x - box.left, dy: y - box.top };
}

import type Phaser from 'phaser';
import type { ModelLook } from '../../../shared';
import { characterShapes } from '../plugins/characters';

/**
 * Draw a player's character (the shapes of `model` with their `look`) on a Phaser Graphics.
 * Same shapes as the profile preview. `color` is the resolved 0xRRGGBB colour.
 */
export function drawCharacter(
  g: Phaser.GameObjects.Graphics,
  model: string | undefined,
  look: ModelLook,
  color: number,
  x: number,
  y: number,
  r: number,
  facing: number,
  isMe: boolean,
): void {
  const shapes = characterShapes(model, look, color, r, facing);
  shapes.forEach((s, i) => {
    g.fillStyle(s.fill, 1);
    if (s.k === 'circle') g.fillCircle(x + s.x, y + s.y, s.r);
    else g.fillPoints(toPoints(s.pts, x, y), true);
    if (i === 0) {
      // outline of the body: white for the local player
      g.lineStyle(Math.max(3, r * (isMe ? 0.14 : 0.1)), isMe ? 0xffffff : 0x1b1033, 1);
      if (s.k === 'circle') g.strokeCircle(x + s.x, y + s.y, s.r);
      else g.strokePoints(toPoints(s.pts, x, y), true, true);
    }
  });
}

function toPoints(pts: number[], x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push({ x: x + pts[i], y: y + pts[i + 1] });
  return out;
}

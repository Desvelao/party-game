import { PALETTE, avatarModel, lookOf, type Looks, type ModelLook } from '../../../shared';
import { characterShapes, ensureModel } from '../plugins/characters';

/** Paint a character of `model` on a 2D canvas, from the same shapes the game scenes draw. */
export function paintCharacter(canvas: HTMLCanvasElement, model: string | undefined, look: ModelLook, color: number, facing = 0): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width;
  const r = size * 0.3;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
  for (const s of characterShapes(model, look, PALETTE[color % PALETTE.length], r, facing)) {
    ctx.fillStyle = css(s.fill);
    ctx.beginPath();
    if (s.k === 'circle') ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    else {
      ctx.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}

/** Paint a player's avatar: their chosen model (else the first installed one) with their look of it; a plain body when there is none. */
export function paintAvatar(canvas: HTMLCanvasElement, looks: Looks | undefined, avatar: string | undefined, color: number): void {
  const model = avatarModel(avatar);
  const paint = () => paintCharacter(canvas, model?.id, model ? lookOf(looks, model) : {}, color);
  paint();
  // a model of a game pack is drawn once that game's code is loaded
  if (model?.owner.kind === 'game') void ensureModel(model.id).then(paint);
}

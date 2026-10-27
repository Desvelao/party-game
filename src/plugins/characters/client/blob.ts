// The Blob character: a round body plus face and accessory slots (the slots and their options are in plugin.json).
import type { ModelLook, Shape } from '../../../core/shared/kit/looks';
import { shapePen } from '../../../core/shared/kit/shapes';

/** Hair colours, in the order of the `hairColor` options (their `swatch`). */
export const HAIR_COLORS = [0x3b2314, 0x151515, 0xe8c15a, 0xc4501b, 0xf2f2f2, 0x4f8bff];

const DARK = 0x151515;
const WHITE = 0xffffff;

export function blobShapes(look: ModelLook, color: number, r: number, facing: number): Shape[] {
  const { circle, poly, rect, regular } = shapePen(r, facing);
  const s: Shape[] = [];
  const hairFill = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0];

  // body
  if (look.body === 1) s.push(regular(8, 1, color, Math.PI / 8));
  else if (look.body === 2) s.push(regular(4, 1.18, color, Math.PI / 4));
  else s.push(circle(0, 0, 1, color));

  // hair sits under the face features
  switch (look.hair) {
    case 1:
      s.push(circle(-0.3, 0, 0.78, hairFill));
      break;
    case 2:
      s.push(rect(-0.9, -0.16, 0.5, 0.16, hairFill));
      break;
    case 3:
      for (const v of [-0.55, 0, 0.55]) s.push(poly(hairFill, -0.2, v - 0.28, -0.2, v + 0.28, -1.2, v));
      break;
    case 4:
      s.push(circle(-0.35, 0, 1.0, hairFill));
      break;
  }

  // face
  const eyeU = 0.42;
  switch (look.eyes) {
    case 1:
      for (const v of [-0.38, 0.38]) {
        s.push(circle(eyeU, v, 0.3, WHITE), circle(eyeU + 0.08, v, 0.14, DARK));
      }
      break;
    case 2:
      for (const v of [-0.38, 0.38]) s.push(rect(eyeU - 0.05, v - 0.2, eyeU + 0.05, v + 0.2, DARK));
      break;
    case 3:
      s.push(poly(DARK, eyeU - 0.15, -0.6, eyeU + 0.12, -0.2, eyeU - 0.05, -0.15));
      s.push(poly(DARK, eyeU - 0.15, 0.6, eyeU + 0.12, 0.2, eyeU - 0.05, 0.15));
      break;
    default:
      for (const v of [-0.36, 0.36]) s.push(circle(eyeU, v, 0.17, DARK));
  }
  switch (look.mouth) {
    case 1:
      s.push(rect(0.62, -0.22, 0.7, 0.22, DARK));
      break;
    case 2:
      s.push(circle(0.64, 0, 0.14, DARK));
      break;
    case 3:
      s.push(rect(0.52, -0.42, 0.66, 0.42, hairFill));
      break;
  }

  // accessories on top
  if (look.glasses === 1) {
    for (const v of [-0.38, 0.38]) s.push(circle(eyeU, v, 0.31, DARK), circle(eyeU, v, 0.2, 0xcfeaff));
    s.push(rect(eyeU - 0.03, -0.1, eyeU + 0.03, 0.1, DARK));
  } else if (look.glasses === 2) {
    s.push(rect(eyeU - 0.16, -0.7, eyeU + 0.16, 0.7, DARK));
  }
  switch (look.hat) {
    case 1:
      s.push(circle(-0.1, 0, 0.7, 0xe23b3b), rect(0.4, -0.55, 0.95, 0.55, 0xb02a2a));
      break;
    case 2:
      s.push(circle(-0.05, 0, 0.8, 0x222222), circle(-0.05, 0, 0.5, 0x3a3a3a));
      break;
    case 3:
      s.push(regular(5, 0.6, 0xffd23f, 0), circle(0, 0, 0.18, 0xff4f8b));
      break;
  }
  return s;
}

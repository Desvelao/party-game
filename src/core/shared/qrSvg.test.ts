import { describe, expect, it } from 'vitest';
import { qrSvgMarkup } from './qrSvg';

describe('qrSvgMarkup', () => {
  it('draws a standalone svg', () => {
    const s = qrSvgMarkup('http://partygame.local/room/ABCD')!;
    expect(s.startsWith('<svg xmlns=')).toBe(true);
    expect(s).toContain('<path d="M');
  });
  it('is null when the text does not fit', () => {
    expect(qrSvgMarkup('x'.repeat(400))).toBeNull();
  });
});

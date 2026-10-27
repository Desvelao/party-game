/** Board colours of the field; a variant not listed here plays on the default (purple) board. */
export interface FieldPalette {
  /** playing surface */
  surface: number;
  /** centre cross and circle, corner outlines */
  lines: number;
  linesAlpha: number;
  /** border, and the deck edge shown while the platform warps */
  border: number;
  /** corner launchers and the deck edge */
  deck: number;
  /** shading of a dropped corner */
  shade: number;
}

const DEFAULT: FieldPalette = { surface: 0x7a5cd6, lines: 0x9d82ff, linesAlpha: 0.5, border: 0x5b3fa8, deck: 0x3b2a73, shade: 0x1b1033 };

const PALETTES: Record<string, FieldPalette> = {
  'sand-orb': { surface: 0xd9951f, lines: 0xffcf6b, linesAlpha: 0.5, border: 0x9a5f0c, deck: 0x7a4a0a, shade: 0x3a2204 },
  'pulse-ball': { surface: 0x6ec6f0, lines: 0xcdeeff, linesAlpha: 0.5, border: 0x2f86b8, deck: 0x1f5f87, shade: 0x0d2c42 },
  'cloud-orbs': { surface: 0xc9cfd6, lines: 0xf2f4f7, linesAlpha: 0.6, border: 0x8a929c, deck: 0x626a75, shade: 0x2c3138 },
};

export const paletteFor = (variant: string | undefined): FieldPalette => (variant && PALETTES[variant]) || DEFAULT;

import type Phaser from 'phaser';

/** What a renderer may ask of the scene that owns it. */
export interface RenderHost {
  /** the shared graphics object (cleared every frame by the scene) */
  readonly g: Phaser.GameObjects.Graphics;
  /** a floating name label for a player (created on first use) */
  label(id: string): Phaser.GameObjects.Text;
}

/** Visual feedback helpers handed to event handlers. */
export interface Fx {
  burst(x: number, y: number, tint: number, count: number, speed: number): void;
  shake(durationMs: number, intensity: number): void;
}

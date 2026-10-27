import Phaser from 'phaser';
import {
  WORLD_SIZE,
  type GameEvent,
  type GameState,
} from '../../../shared';
import { sfx } from '../audio/sfx';
import { shakeScale, t } from '../../../shared';
import { prefersReducedMotion } from '../motion';
import { session } from '../session';
import type { Fx, RenderHost } from './host';
import { rankingOf, SpectatorHud } from './spectate';
import type { ClientGamePlugin, GameRenderer } from '../plugins/api';
import { context, pluginForKind, setBigTextSink } from '../plugins/registry';

interface Snapshot {
  at: number;
  state: GameState;
  phase: 'countdown' | 'playing';
  countdown: number;
}

const CENTER = WORLD_SIZE / 2;

/** whole seconds left in the round, never negative */
function timeLeft(state: { limit: number; t: number }): number {
  return Math.max(0, Math.ceil(state.limit - state.t));
}

/**
 * Owns what every minigame shares: snapshot interpolation, the camera, name
 * labels, particles, the HUD and the countdown. The core has no game of its own:
 * drawing, the status line, standings and sound cues are delegated to the plugin
 * of the pack that owns the snapshot's `kind` (see plugins/api.ts).
 */

export class GameScene extends Phaser.Scene {
  private gfx!: Phaser.GameObjects.Graphics;
  private snaps: Snapshot[] = [];
  private delayMs = 100;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private bigText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private lastLeft = -1;
  private lastCountdown = -1;
  private active = false;
  /** spectator follow camera: id of the followed player, '' = whole arena */
  private followId = '';
  private specHud: SpectatorHud | null = null;

  /** renderers of installed game packs, by state kind (created on first use) */
  private readonly packRenderers = new Map<string, GameRenderer>();

  private readonly host: RenderHost = {
    g: undefined as unknown as Phaser.GameObjects.Graphics, // set in create()
    label: (id) => this.labels.get(id) ?? this.makeLabel(id),
  };

  private readonly fx: Fx = {
    burst: (x, y, tint, n, speed) => this.burst(x, y, tint, n, speed),
    shake: (ms, intensity) => this.shakeCamera(ms, intensity),
  };

  constructor() {
    super('Game');
  }

  create(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff).fillCircle(8, 8, 8).generateTexture('dot', 16, 16);
    g.destroy();

    this.gfx = this.add.graphics();
    (this.host as { g: Phaser.GameObjects.Graphics }).g = this.gfx;
    this.bigText = this.add
      .text(CENTER, CENTER, '', { fontFamily: 'ui-rounded, system-ui, sans-serif', fontSize: '150px', fontStyle: '900', color: '#ffd23f', stroke: '#2b1a00', strokeThickness: 14 })
      .setOrigin(0.5)
      .setDepth(50);
    this.infoText = this.add
      .text(CENTER, 28, '', { fontFamily: 'ui-rounded, system-ui, sans-serif', fontSize: '30px', fontStyle: '800', color: '#fff7e6', stroke: '#1b1033', strokeThickness: 6 })
      .setOrigin(0.5, 0)
      .setDepth(50);
    setBigTextSink((text) => {
      this.bigText.setText(text).setAlpha(1);
      this.tweens.add({ targets: this.bigText, alpha: 0, duration: 900, onComplete: () => this.bigText.setText('').setAlpha(1) });
    });
    this.scale.on('resize', this.fit, this);
    this.fit();
    this.specHud = new SpectatorHud(
      (dir) => this.stepFollow(dir),
      () => (this.followId = ''),
    );
  }

  /** Cycle the followed player: overview -> each player -> overview. */
  private stepFollow(dir: -1 | 1): void {
    const ids = session.players.filter((p) => p.connected).map((p) => p.id);
    if (ids.length === 0) return void (this.followId = '');
    const i = ids.indexOf(this.followId);
    if (i < 0) this.followId = dir > 0 ? ids[0] : ids[ids.length - 1];
    else {
      const n = i + dir;
      this.followId = n < 0 || n >= ids.length ? '' : ids[n];
    }
  }

  /** Keep the square world fully visible and centred. */
  private fit(): void {
    const { width, height } = this.scale;
    const cam = this.cameras.main;
    cam.setZoom(Math.min(width, height) / WORLD_SIZE);
    cam.centerOn(CENTER, CENTER);
  }

  /** Called when a new minigame starts (and when returning to the lobby). */
  reset(active: boolean, netRate = 20): void {
    this.active = active;
    this.followId = '';
    this.specHud?.show(active && session.spectator);
    this.snaps = [];
    this.packRenderers.forEach((r) => r.reset?.());
    this.labels.forEach((l) => l.destroy());
    this.labels.clear();
    this.lastCountdown = -1;
    this.bigText.setText('');
    this.infoText.setText('');
    // two network intervals + a little jitter margin
    this.delayMs = Math.max(60, (2 / netRate) * 1000 + 20);
  }

  pushSnapshot(snap: Omit<Snapshot, 'at'>): void {
    this.snaps.push({ ...snap, at: performance.now() });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  /** Core feedback for events every minigame/variant shares, then variant views. */
  handleEvents(events: GameEvent[]): void {
    const gameKind = this.snaps[this.snaps.length - 1]?.state.kind;
    const plugin = pluginForKind(gameKind ?? '');
    for (const e of events) {
      const color = session.colorOf(e.id);
      if (plugin?.event?.(e, this.fx, context)) continue;
      switch (e.kind) {
        case 'dash':
          sfx.play('dash');
          this.burst(e.x, e.y, color, 6, 160);
          break;
        case 'bump':
          sfx.play('bump');
          this.burst(e.x, e.y, 0xffffff, 8, 220);
          this.shakeCamera(90, 0.004);
          break;
        case 'spawn':
          sfx.play('spawn');
          this.burst(e.x, e.y, 0xffd23f, 6, 180);
          break;
        case 'goal':
          sfx.play('goal');
          this.burst(e.x, e.y, 0xff3b3b, 18, 300);
          this.shakeCamera(160, 0.007);
          break;
        case 'hit':
          sfx.play('click');
          this.burst(e.x, e.y, 0xffffff, 4, 140);
          break;
        case 'smash':
          sfx.play('boost');
          this.burst(e.x, e.y, 0xffd23f, 12, 300);
          this.shakeCamera(70, 0.004);
          break;
        case 'pickup':
          sfx.play('powerup');
          this.burst(e.x, e.y, 0xffd23f, 10, 220);
          break;
        case 'splash':
          sfx.play('splash');
          this.burst(e.x, e.y, 0x7fd8ff, 14, 240);
          break;
        case 'jet':
          sfx.play('splash');
          this.burst(e.x, e.y, 0xbfe8ff, 18, 300);
          this.shakeCamera(90, 0.004);
          break;
        case 'bolt':
          sfx.play('hazard');
          this.burst(e.x, e.y, 0xfff08a, 12, 260);
          this.shakeCamera(100, 0.004);
          break;
        case 'throw':
        case 'kick':
          sfx.play('dash');
          this.burst(e.x, e.y, 0xffffff, 5, 160);
          break;
        case 'explode':
          sfx.play('explode');
          this.burst(e.x, e.y, 0xff7a1a, 26, 380);
          this.shakeCamera(200, 0.009);
          break;
        case 'heal':
          sfx.play('heal');
          this.burst(e.x, e.y, 0x7bff7b, 10, 200);
          break;
        case 'crack':
          sfx.play('click');
          this.burst(e.x, e.y, 0xb98a52, 8, 200);
          break;
        case 'bank':
          sfx.play('win');
          this.burst(e.x, e.y, color, 20, 300);
          break;
        case 'fill':
          sfx.play('click');
          this.burst(e.x, e.y, color, 12, 240);
          break;
        case 'zap':
        case 'rocket':
          sfx.play('dash');
          this.burst(e.x, e.y, 0xfff08a, 8, 220);
          break;
        case 'stun':
          sfx.play('bump');
          this.burst(e.x, e.y, 0xffd23f, 8, 180);
          this.shakeCamera(80, 0.004);
          break;
        case 'wipe':
          sfx.play('hazard');
          this.burst(e.x, e.y, 0xff3b3b, 16, 260);
          break;
        case 'tnt':
          sfx.play('explode');
          this.burst(e.x, e.y, 0xff7a1a, 20, 320);
          this.shakeCamera(160, 0.007);
          break;
        case 'boom':
          sfx.play('explode');
          this.burst(e.x, e.y, 0xff7a1a, 22, 340);
          this.shakeCamera(180, 0.008);
          break;
        case 'eliminated':
          sfx.play('eliminated');
          this.packRenderers.forEach((r) => r.markFallen?.(e.id));
          if (session.spectator) this.specHud?.pushFeed(t('spectate.eliminated', { name: session.players.find((p) => p.id === e.id)?.name ?? '' }));
          this.burst(e.x, e.y, color, 24, 340);
          this.shakeCamera(180, 0.008);
          break;
      }
    }
  }

  private burst(x: number, y: number, tint: number, n: number, speed: number): void {
    const em = this.add.particles(x, y, 'dot', {
      speed: { min: speed * 0.3, max: speed },
      lifespan: 450,
      scale: { start: 0.9, end: 0 },
      tint,
      emitting: false,
    });
    em.setDepth(20);
    em.explode(n);
    this.time.delayedCall(600, () => em.destroy());
  }

  update(): void {
    const g = this.gfx;
    g.clear();
    this.drawBackdrop(g);
    if (!this.active || this.snaps.length === 0) return;

    const latest = this.snaps[this.snaps.length - 1];
    const rt = performance.now() - this.delayMs;
    let a = this.snaps[0];
    let b = this.snaps[0];
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].at <= rt) {
        a = this.snaps[i];
        b = this.snaps[Math.min(i + 1, this.snaps.length - 1)];
        break;
      }
    }
    const span = b.at - a.at;
    const alpha = span > 0 ? Phaser.Math.Clamp((rt - a.at) / span, 0, 1) : 1;

    // snapshots of one round always share a kind
    const pack = pluginForKind(latest.state.kind);
    if (pack) {
      this.rendererOf(latest.state.kind, pack).render(this.host, a.state, b.state, latest.state, alpha);
    } // else: the game's code is still loading, so only the backdrop shows
    // the marker option can change mid-round: keep player name labels in step with it
    for (const [id, label] of this.labels) {
      if (!session.players.some((p) => p.id === id)) continue;
      const text = session.labelOf(id);
      if (label.text !== text) label.setText(text);
    }
    this.drawHud(latest);
    if (session.spectator) this.updateSpectate(latest.state);
  }

  private rendererOf(kind: string, plugin: ClientGamePlugin): GameRenderer {
    let r = this.packRenderers.get(kind);
    if (!r) this.packRenderers.set(kind, (r = plugin.createRenderer(context)));
    return r;
  }

  /** Live ranking plus the follow camera (zoomed on the followed player's label, which every renderer keeps on its entity). */
  private updateSpectate(state: GameState): void {
    this.specHud?.show(true);
    this.specHud?.setRanking(rankingOf(state), this.followId);
    const cam = this.cameras.main;
    const target = this.followId ? this.labels.get(this.followId) : undefined;
    if (!target) {
      if (this.followId) this.followId = '';
      return void this.fit();
    }
    const base = Math.min(this.scale.width, this.scale.height) / WORLD_SIZE;
    cam.setZoom(Phaser.Math.Linear(cam.zoom, base * 2, 0.15));
    cam.centerOn(Phaser.Math.Linear(cam.midPoint.x, target.x, 0.2), Phaser.Math.Linear(cam.midPoint.y, target.y + 20, 0.2));
  }

  /** Camera shake scaled by the player's motion setting (0 = none). */
  private shakeCamera(ms: number, intensity: number): void {
    const k = shakeScale(session.access.motion, prefersReducedMotion());
    if (k > 0) this.cameras.main.shake(ms, intensity * k);
  }

  private makeLabel(id: string): Phaser.GameObjects.Text {
    const label = this.add
      .text(0, 0, session.labelOf(id), { fontFamily: 'ui-rounded, system-ui, sans-serif', fontSize: '20px', fontStyle: '800', color: '#ffffff', stroke: '#1b1033', strokeThickness: 5 })
      .setOrigin(0.5, 1)
      .setDepth(30);
    this.labels.set(id, label);
    return label;
  }

  private drawBackdrop(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x1b1033, 1).fillRect(-2000, -2000, 5000, 5000);
    g.lineStyle(2, 0x2c1b52, 1);
    for (let i = 0; i <= WORLD_SIZE; i += 100) {
      g.lineBetween(i, 0, i, WORLD_SIZE).lineBetween(0, i, WORLD_SIZE, i);
    }
  }

  private drawHud(s: Snapshot): void {
    let status = pluginForKind(s.state.kind)?.hud?.(s.state, context) ?? '';
    if (s.phase === 'playing' && 'limit' in s.state && typeof s.state.limit === 'number') {
      const left = timeLeft({ limit: s.state.limit, t: s.state.t });
      if (left !== this.lastLeft) {
        if (left > 0 && left <= 5) sfx.play('tick');
        else if (left === 0 && this.lastLeft > 0) sfx.play('timeup');
        this.lastLeft = left;
      }
    } else if (s.phase !== 'playing') {
      this.lastLeft = -1;
    }
    // changes that have no server event (laps, warnings) are detected by the game's own client code
    pluginForKind(s.state.kind)?.cue?.(s.state, s.phase, context);
    if (session.spectator) status = `${t('hud.watching')}  -  ${status}`;
    this.infoText.setText(s.phase === 'playing' ? status : session.spectator ? t('hud.starting') : t('hud.getReady'));

    if (s.phase === 'countdown') {
      const n = Math.ceil(s.countdown);
      if (n !== this.lastCountdown && n > 0) {
        this.lastCountdown = n;
        sfx.play('tick');
      }
      this.bigText.setText(n > 0 ? String(n) : t('hud.go'));
    } else {
      if (this.lastCountdown !== 0) {
        this.lastCountdown = 0;
        sfx.play('go');
        this.bigText.setText(t('hud.go'));
        this.tweens.add({ targets: this.bigText, alpha: 0, duration: 700, onComplete: () => this.bigText.setText('').setAlpha(1) });
      }
    }
  }
}

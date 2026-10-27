/**
 * Tiny WebAudio synth so the game has feedback without shipping audio files.
 * Replace the bodies with sample playback / music later; callers stay the same.
 */
import { loadMuted, saveMuted } from './mute';
import { sanitizeSound, type SoundStep } from './recipe';
import { defaultAudioPrefs, type AudioPrefs } from '../../../shared';

export type SfxName =
  | 'tick' | 'go' | 'dash' | 'bump' | 'hazard' | 'eliminated' | 'win' | 'click' | 'splash'
  | 'goal' | 'explode' | 'heal' | 'spawn' | 'powerup' | 'lose' | 'alert' | 'join' | 'start' | 'timeup' | 'boost' | 'hop' | 'cannon' | 'warn' | 'lap';

class Sfx {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = loadMuted();
  private blocked = false;
  /** volume levels 0..100; the gains below follow them once the context exists */
  private volumes: AudioPrefs = defaultAudioPrefs();
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  /** Called once when a sound was wanted but the browser has not let audio start yet (needs a click or key). */
  onBlocked: (() => void) | null = null;

  isMuted(): boolean {
    return this.muted;
  }

  /** Set the master / effects / music levels (0..100 each); applies at once and to later sounds. */
  setVolumes(v: AudioPrefs): void {
    this.volumes = v;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (this.masterGain) this.masterGain.gain.value = this.volumes.master / 100;
    if (this.sfxGain) this.sfxGain.gain.value = this.volumes.sfx / 100;
    if (this.musicGain) this.musicGain.gain.value = this.volumes.music / 100;
  }

  /** master -> destination, with one bus each for effects and music (created with the context). */
  private buses(ctx: AudioContext): { sfx: GainNode; music: GainNode } {
    if (!this.masterGain || this.masterGain.context !== ctx) {
      this.masterGain = ctx.createGain();
      this.sfxGain = ctx.createGain();
      this.musicGain = ctx.createGain();
      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);
      this.applyVolumes();
    }
    return { sfx: this.sfxGain!, music: this.musicGain! };
  }

  /** The node background music plugs into (follows the master and music levels). */
  musicBus(ctx: AudioContext): AudioNode {
    return this.buses(ctx).music;
  }

  private muteListeners = new Set<() => void>();

  /** Subscribe to mute changes (returns an unsubscribe function). */
  onMuteChange(cb: () => void): () => void {
    this.muteListeners.add(cb);
    return () => this.muteListeners.delete(cb);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    saveMuted(m);
    for (const cb of this.muteListeners) cb();
    // silence anything already scheduled (win jingle etc.) by suspending; unmuting resumes
    try {
      if (m) void this.ctx?.suspend();
      else this.resume();
    } catch {
      /* audio unavailable */
    }
  }

  /** Cheap and idempotent: resumes a suspended context if one exists (never creates one). */
  resume(): void {
    try {
      if (!this.muted && this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
    } catch {
      /* audio unavailable */
    }
  }

  /** True once a sound was requested while audio could not play (no context yet, or still suspended). */
  isBlocked(): boolean {
    return this.blocked;
  }

  /** The context to schedule on, nudging a non-running one to resume; null when muted or not created yet. */
  private ready(): AudioContext | null {
    if (this.muted) return null;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      try {
        if (ctx) void ctx.resume();
      } catch {
        /* audio unavailable */
      }
      if (!ctx || ctx.state !== 'running') {
        if (!this.blocked) {
          this.blocked = true;
          this.onBlocked?.();
        }
      }
    }
    return ctx;
  }

  /** The running context for background music; null while muted, not created or still suspended. */
  audioContext(): AudioContext | null {
    return !this.muted && this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** Must be called from a user gesture (any click / key press / touch) so browsers allow audio. */
  unlock(): void {
    try {
      this.ctx ??= new AudioContext();
      if (!this.muted && this.ctx.state !== 'running') void this.ctx.resume();
      if (this.ctx.state === 'running') this.blocked = false;
    } catch {
      /* audio unavailable */
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.buses(ctx).sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** One-shot white noise through a lowpass that sweeps `from` -> `to` Hz, fading out over `dur`. */
  private noise(dur: number, gain: number, from: number, to: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    if (!this.noiseBuf) {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.buses(ctx).sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** start times (ms) of the latest recipes, to drop a flood of them */
  private recipes: number[] = [];

  /** Play a game pack's own sound (see recipe.ts): the steps are checked and limited first, then played like any effect. */
  recipe(steps: SoundStep[]): void {
    const now = performance.now();
    this.recipes = this.recipes.filter((t) => now - t < 200);
    if (this.recipes.length >= 12) return;
    this.recipes.push(now);
    for (const s of sanitizeSound(steps)) {
      if (s.k === 'tone') this.tone(s.f, s.d, s.type ?? 'sine', s.g ?? 0.1, s.to, s.at ?? 0);
      else this.noise(s.d, s.g ?? 0.1, s.from, s.to, s.at ?? 0);
    }
  }

  play(name: SfxName): void {
    switch (name) {
      case 'tick': return this.tone(520, 0.12, 'square', 0.08);
      case 'go': return this.tone(880, 0.35, 'square', 0.1, 1320);
      case 'dash': return this.tone(300, 0.15, 'sawtooth', 0.07, 900);
      case 'bump': return this.tone(160, 0.12, 'triangle', 0.18, 60);
      case 'hazard': return this.tone(220, 0.2, 'sawtooth', 0.12, 80);
      case 'eliminated': return this.tone(500, 0.5, 'sine', 0.15, 70);
      case 'click': return this.tone(700, 0.05, 'square', 0.05);
      case 'splash':
        // a rush of water, the plunk of the body going in, then a couple of droplets
        this.noise(0.45, 0.22, 3000, 400);
        this.tone(220, 0.18, 'sine', 0.14, 70);
        this.tone(700, 0.06, 'sine', 0.05, 1100, 0.08);
        this.tone(520, 0.07, 'sine', 0.04, 900, 0.16);
        return;
      case 'goal':
        this.tone(400, 0.12, 'sawtooth', 0.12, 200);
        this.tone(200, 0.3, 'sawtooth', 0.12, 70, 0.1);
        return;
      case 'explode':
        this.noise(0.5, 0.3, 2400, 120);
        this.tone(110, 0.35, 'sawtooth', 0.14, 40);
        return;
      case 'heal':
        [660, 880].forEach((f, i) => this.tone(f, 0.12, 'sine', 0.1, f * 1.2, i * 0.08));
        return;
      case 'spawn': return this.tone(400, 0.1, 'triangle', 0.08, 800);
      case 'powerup':
        [600, 800, 1000].forEach((f, i) => this.tone(f, 0.07, 'square', 0.06, undefined, i * 0.05));
        return;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.12, undefined, i * 0.16));
        return;
      case 'alert':
        this.tone(880, 0.08, 'square', 0.07);
        this.tone(880, 0.08, 'square', 0.07, undefined, 0.14);
        return;
      case 'join': return this.tone(600, 0.1, 'sine', 0.08, 900);
      case 'start':
        [392, 523, 659].forEach((f, i) => this.tone(f, 0.15, 'square', 0.08, undefined, i * 0.09));
        return;
      case 'timeup':
        this.tone(300, 0.5, 'sawtooth', 0.12, 150);
        return;
      case 'boost':
        this.noise(0.18, 0.18, 4000, 800);
        this.tone(250, 0.18, 'sawtooth', 0.1, 1000);
        return;
      case 'hop': return this.tone(350, 0.12, 'sine', 0.1, 700);
      case 'cannon':
        this.noise(0.25, 0.25, 1800, 200);
        this.tone(140, 0.2, 'square', 0.12, 50);
        return;
      case 'warn':
        [0, 0.18].forEach((d) => this.tone(740, 0.12, 'square', 0.07, 520, d));
        return;
      case 'lap':
        [784, 1047].forEach((f, i) => this.tone(f, 0.12, 'square', 0.08, undefined, i * 0.1));
        return;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'square', 0.09, undefined, i * 0.12));
    }
  }
}

export const sfx = new Sfx();

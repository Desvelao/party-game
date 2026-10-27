/**
 * Procedural background music: a short looping pattern per game family, synthesized on the same
 * AudioContext as the sound effects (no audio files). Tracks are plain data (see audio/tracks/);
 * a game family without a track simply has no music.
 */
import { gameIdOf } from '../../../shared';
import { sfx } from './sfx';

/** MIDI note numbers per 16th/8th step; null = rest. */
export type Pattern = (number | null)[];

export interface MusicTrack {
  /** beats per minute; one step is an eighth note */
  bpm: number;
  /** all patterns have the same length (the loop) */
  bass: Pattern;
  melody: Pattern;
  /** steps (indexes) that carry a kick / snare / closed hat */
  kick: number[];
  snare: number[];
  hat: number[];
  /** overall loudness of this track, 0..1 */
  gain: number;
  /** oscillator shapes of the two voices (default: triangle bass, square lead) */
  bassWave?: OscillatorType;
  leadWave?: OscillatorType;
}

/** Tracks by game family id (the catalog game id, e.g. `spring-showdown`), added by the game packs. */
export const TRACKS: Record<string, MusicTrack> = {
};

const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const LOOKAHEAD_S = 0.3;
const TICK_MS = 80;

class Music {
  private current = '';
  private track: MusicTrack | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextAt = 0;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Play the track of the game family that owns `playableId` (idempotent while it is already playing). */
  playFor(playableId: string): void {
    const family = gameIdOf(playableId) || playableId;
    const track = TRACKS[family];
    if (!track) return this.stop();
    if (this.current === family && this.timer) return;
    this.stop();
    this.current = family;
    this.track = track;
    this.step = 0;
    this.nextAt = 0;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.current = '';
    this.track = null;
    try {
      this.master?.disconnect();
    } catch {
      /* already gone */
    }
    this.master = null;
  }

  isPlaying(): boolean {
    return this.timer !== null;
  }

  private schedule(): void {
    const track = this.track;
    const ctx = sfx.audioContext();
    if (!track || !ctx) {
      this.nextAt = 0; // muted or not unlocked yet: pick the beat up again from "now" when audible
      return;
    }
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = 0.35 * track.gain;
      this.master.connect(sfx.musicBus(ctx));
    }
    const stepSec = 60 / track.bpm / 2;
    const len = track.bass.length;
    if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.05;
    while (this.nextAt < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(ctx, track, this.step % len, this.nextAt, stepSec);
      this.step = (this.step + 1) % len;
      this.nextAt += stepSec;
    }
  }

  private playStep(ctx: AudioContext, t: MusicTrack, i: number, at: number, stepSec: number): void {
    const bass = t.bass[i];
    if (bass != null) this.note(ctx, midiToHz(bass), at, stepSec * 1.7, t.bassWave ?? 'triangle', 0.5);
    const lead = t.melody[i];
    if (lead != null) this.note(ctx, midiToHz(lead), at, stepSec * 0.9, t.leadWave ?? 'square', 0.16);
    if (t.kick.includes(i)) this.kick(ctx, at);
    if (t.snare.includes(i)) this.noise(ctx, at, 0.12, 1800, 0.35);
    if (t.hat.includes(i)) this.noise(ctx, at, 0.04, 7000, 0.12);
  }

  private note(ctx: AudioContext, hz: number, at: number, dur: number, type: OscillatorType, gain: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private kick(ctx: AudioContext, at: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.14);
    g.gain.setValueAtTime(0.9, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    osc.connect(g).connect(this.master!);
    osc.start(at);
    osc.stop(at + 0.2);
  }

  private noise(ctx: AudioContext, at: number, dur: number, highpassHz: number, gain: number): void {
    if (!this.noiseBuf || this.noiseBuf.sampleRate !== ctx.sampleRate) {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let k = 0; k < data.length; k++) data[k] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpassHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}

export const music = new Music();

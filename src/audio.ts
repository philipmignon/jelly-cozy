// Jelly Tank sound: everything is synthesised with the Web Audio API (no files).
// Graph:  sfx ─────────────────────────┐
//         ambience beds/pad/bubbles → murk lowpass → amb ─┤
//         music: keys/bass/drums → tape-wow delay → tone LP → murk LP → duck → night level → fade → bus (0.18) ─┴→ compressor → master (0.35) → out
// Nothing touches window/AudioContext at module load, so this imports cleanly in Node/Vitest.

export type SoundName =
  | "feed" | "plop" | "eat" | "pet" | "tap" | "clean" | "cleaned"
  | "lampOn" | "lampOff" | "pulse" | "grow" | "unlock" | "buy" | "ui"
  | "pour" | "scrub" | "pickup" | "putdown" | "switch" | "shutter" | "chime";

export interface TankAudio {
  /** Call from the first user gesture (pointerdown). Creates/resumes the AudioContext, starts ambience. Idempotent. */
  unlock(): void;
  /** One-shots. Cheap to call many times per second: rate-limited and voice-capped internally. */
  play(name: SoundName): void;
  /** 0..1 eased by the caller; crossfades ambience between day and night character. */
  setNight(amount: number): void;
  /** 0..1, how murky the water is: muffles ambience (lowpass) as it rises. */
  setMurk(amount: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Lo-fi music bed on/off (persisted, default off). Fades in ~2 s, out ~1.5 s. Silent while muted. */
  setMusic(on: boolean): void;
  readonly music: boolean;
}

// ---------------------------------------------------------------- pure helpers (unit-tested)

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const MASTER_GAIN = 0.35;
export const MUTE_KEY = "jellytank:muted";

/** Ambience lowpass cutoff (Hz) for a murk level: exponential 9 kHz (clear) → 420 Hz (filthy). */
export function murkCutoff(murk: number): number {
  return 9000 * Math.pow(420 / 9000, clamp01(murk));
}

/** Equal-power crossfade weights for the day and night ambience layers. */
export function nightMix(night: number): { day: number; night: number } {
  const n = clamp01(night) * Math.PI * 0.5;
  return { day: Math.cos(n), night: Math.sin(n) };
}

/** Milliseconds until the next bubble trickle; nights are slower. r is a 0..1 random. */
export function bubbleDelayMs(night: number, r: number): number {
  const n = clamp01(night);
  return lerp(2500, 6000, n) + clamp01(r) * lerp(4000, 7000, n);
}

/** Per-sound minimum gap between triggers and how long one instance rings (seconds). */
export const SOUND_SPEC: Record<SoundName, { gap: number; len: number }> = {
  feed: { gap: 0.25, len: 0.3 }, plop: { gap: 0.035, len: 0.1 }, eat: { gap: 0.08, len: 0.25 },
  pet: { gap: 0.25, len: 1.0 }, tap: { gap: 0.06, len: 0.15 }, clean: { gap: 1.2, len: 1.7 },
  cleaned: { gap: 0.5, len: 0.5 }, lampOn: { gap: 0.15, len: 1.6 }, lampOff: { gap: 0.15, len: 1.6 },
  pulse: { gap: 0.6, len: 0.85 }, grow: { gap: 1.0, len: 1.5 }, unlock: { gap: 0.8, len: 1.3 },
  buy: { gap: 0.15, len: 0.45 }, ui: { gap: 0.04, len: 0.1 },
  pour: { gap: 0.09, len: 0.25 }, scrub: { gap: 0.11, len: 0.2 }, pickup: { gap: 0.1, len: 0.2 },
  putdown: { gap: 0.1, len: 0.2 }, switch: { gap: 0.08, len: 0.12 }, shutter: { gap: 0.3, len: 0.15 },
  chime: { gap: 0.6, len: 1.4 },
};

/** Debounce + voice cap. admit() returns false if the sound fired too recently or too many are ringing. */
export function createGate(maxVoices = 12, spec: Record<string, { gap: number; len: number }> = SOUND_SPEC) {
  const last = new Map<string, number>();
  let ends: number[] = [];
  return {
    admit(name: string, now: number): boolean {
      const s = spec[name];
      if (!s) return false;
      ends = ends.filter((e) => e > now);
      if (ends.length >= maxVoices) return false;
      const l = last.get(name);
      if (l !== undefined && now - l < s.gap) return false;
      last.set(name, now);
      ends.push(now + s.len);
      return true;
    },
    get active() { return ends.length; },
  };
}

// ---------------------------------------------------------------- music helpers (unit-tested)

export const MUSIC_KEY = "jellytank:music";
/** Music bus level relative to the master bus: well under the ambience and one-shots. */
export const MUSIC_GAIN = 0.18;
/** How far ahead (in bars) the scheduler keeps the audio clock filled. */
export const MUSIC_LOOKAHEAD_BARS = 2;

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" → 69, "Bb1" → 34, "F#3" → 54. Throws on anything else. */
export function noteToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const pc = m ? NOTE_PC[m[1] ?? ""] : undefined;
  if (!m || pc === undefined) throw new Error(`bad note name: ${name}`);
  return pc + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

/** Equal-tempered frequency, A4 = 440 Hz. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface Chord { readonly name: string; readonly bass: number; readonly notes: readonly number[] }

const chord = (name: string, bass: string, notes: string[]): Chord =>
  ({ name, bass: noteToMidi(bass), notes: notes.map(noteToMidi) });

/**
 * Eight bars, one chord each, C major with a borrowed Bbmaj9 for a dreamy lift in bar 7.
 * Rootless mid-register voicings that move by step, so the change of chord feels like a slow tide.
 */
export const PROGRESSION: readonly Chord[] = [
  chord("Fmaj9", "F2", ["A3", "C4", "E4", "G4"]),
  chord("Em7", "E2", ["G3", "B3", "D4", "E4"]),
  chord("Dm9", "D2", ["F3", "A3", "C4", "E4"]),
  chord("Cmaj9", "C2", ["E3", "G3", "B3", "D4"]),
  chord("Fmaj9", "F2", ["A3", "C4", "E4", "G4"]),
  chord("Em7", "E2", ["G3", "B3", "D4", "E4"]),
  chord("Bbmaj9", "Bb1", ["F3", "A3", "C4", "D4"]),
  chord("Am7", "A1", ["G3", "A3", "C4", "E4"]),
];

/** The chord for a bar index; wraps both ways so the loop is seamless. */
export function chordAt(bar: number): Chord {
  const n = PROGRESSION.length, i = ((Math.floor(bar) % n) + n) % n;
  return PROGRESSION[i] ?? PROGRESSION[0]!;
}

/** C major pentatonic (C D E G A) pitch classes. */
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];

/**
 * Melody notes allowed over a chord, ascending MIDI in [lo, hi]: pentatonic notes, minus any that sit
 * a semitone above a chord tone without being one (the b9 rub, e.g. C over Em7).
 */
export function melodyPool(c: Chord, lo = 64, hi = 81): number[] {
  const pcs = new Set([c.bass, ...c.notes].map((m) => ((m % 12) + 12) % 12));
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) {
    const pc = m % 12;
    if (!PENTATONIC.includes(pc)) continue;
    if (!pcs.has(pc) && pcs.has((pc + 11) % 12)) continue;
    out.push(m);
  }
  return out;
}

/** Tempo for a night amount: 72 BPM by day, easing to 63 at night. */
export function musicTempo(night: number): number {
  return lerp(72, 63, clamp01(night));
}

/** Seconds per 4/4 bar at a tempo. */
export function barSeconds(bpm: number): number {
  return 240 / bpm;
}

/** Music tone lowpass (Hz): 3.2 kHz by day, closing to 1 kHz at night. Keeps the bed from ever turning bright. */
export function musicCutoff(night: number): number {
  return 3200 * Math.pow(1000 / 3200, clamp01(night));
}

/** Electric-piano lowpass centre (Hz), before its slow wobble: 1.8 kHz by day, 800 Hz at night. */
const keysCutoff = (night: number) => 1800 * Math.pow(800 / 1800, clamp01(night));

const smooth01 = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

/** Quiet nights: the music bed's level, 1 by day easing to 0.62 at night (on top of the darker filters). */
export function musicNightLevel(night: number): number {
  return lerp(1, 0.62, smooth01(night));
}

/** The chance a bar is played the sparse night way (one long chord, no re-strike or pickup): 0 by day, 1 at night. */
export function calmChance(night: number): number {
  return smooth01((clamp01(night) - 0.15) / 0.7);
}

/** The chance the top voice of the chord is played: all four notes by day, often only three at night. */
export function topVoiceChance(night: number): number {
  return lerp(1, 0.4, smooth01(night));
}

/** Seconds the music takes to follow a change of night (time constant): slow, so day and night crossfade. */
export const MUSIC_NIGHT_GLIDE = 1.4;

/** Beat level 0..1: full by day, gone past night 0.6. */
export function drumMix(night: number): number {
  return clamp01((0.6 - clamp01(night)) / 0.4);
}

// ---------------------------------------------------------------- engine

type Ctor = typeof AudioContext;

function readMuted(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
function writeMuted(m: boolean): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* private mode */ }
}
function readMusic(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(MUSIC_KEY) === "1"; } catch { return false; }
}
function writeMusic(on: boolean): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(MUSIC_KEY, on ? "1" : "0"); } catch { /* private mode */ }
}

/** One scheduled sound: its sources (all stop together) and every node to disconnect afterwards. */
interface Voice { srcs: AudioScheduledSourceNode[]; chain: AudioNode[] }
/** One "music on" run: the scheduler's clock and every voice it has scheduled that hasn't ended. */
interface Session {
  next: number;          // audio-clock time of the next unscheduled bar
  bar: number;           // index of that bar
  mel: number;           // last melody note (MIDI), for a stepwise random walk
  voices: Set<Voice>;
  pump: ReturnType<typeof setTimeout> | null;
  stop: ReturnType<typeof setTimeout> | null; // pending teardown after a fade-out
}

export function createTankAudio(): TankAudio {
  let c: AudioContext | null = null;
  let master: GainNode, comp: DynamicsCompressorNode, sfx: GainNode, amb: GainNode, murkLP: BiquadFilterNode;
  let dayBed: GainNode, nightBed: GainNode, dayPad: GainNode, nightPad: GainNode, bubbles: GainNode;
  let white: AudioBuffer;
  let muted = readMuted();
  let night = 0, murk = 0;
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  const gate = createGate();
  let music = readMusic();
  let session: Session | null = null;
  // music bus (built lazily the first time music plays)
  let mBus: GainNode | null = null;
  let mFade: GainNode, mDuck: GainNode, mNight: GainNode, mMurk: BiquadFilterNode, mTone: BiquadFilterNode;
  let mKeys: BiquadFilterNode, mWobble: GainNode, mBass: GainNode, mDrums: GainNode, mCrackle: GainNode;
  let crackleBuf: AudioBuffer;

  const live = () => c !== null && c.state === "running";

  // --- building blocks -------------------------------------------------------

  /** Attack to peak, then exponential fall to silence over `d`. */
  function env(p: AudioParam, t: number, a: number, peak: number, d: number) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  /** Disconnect a chain once its source finishes so one-shots don't leak nodes. */
  function reap(src: AudioScheduledSourceNode, chain: AudioNode[]) {
    src.onended = () => { for (const n of chain) n.disconnect(); };
  }
  function filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = c!.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }

  interface Tone { f: number; f2?: number; glide?: number; type?: OscillatorType; at?: number; a?: number; d: number; g: number; lp?: number; out?: AudioNode }
  /** One oscillator with an envelope, optional pitch glide and lowpass. */
  function tone(o: Tone) {
    const t = c!.currentTime + (o.at ?? 0), a = o.a ?? 0.004;
    const osc = c!.createOscillator(), g = c!.createGain();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide ?? o.d));
    env(g.gain, t, a, o.g, o.d);
    osc.connect(g);
    const chain: AudioNode[] = [osc, g];
    let head: AudioNode = g;
    if (o.lp !== undefined) { const lp = filter("lowpass", o.lp); g.connect(lp); chain.push(lp); head = lp; }
    head.connect(o.out ?? sfx);
    osc.start(t); osc.stop(t + a + o.d + 0.05);
    reap(osc, chain);
  }

  interface Noise { type: BiquadFilterType; f: number; f2?: number; q?: number; at?: number; a?: number; d: number; g: number; out?: AudioNode }
  /** A slice of white noise through one filter (optionally sweeping). */
  function noise(o: Noise) {
    const t = c!.currentTime + (o.at ?? 0), a = o.a ?? 0.002;
    const src = c!.createBufferSource(), bq = filter(o.type, o.f, o.q ?? 1), g = c!.createGain();
    src.buffer = white;
    bq.frequency.setValueAtTime(o.f, t);
    if (o.f2 !== undefined) bq.frequency.exponentialRampToValueAtTime(o.f2, t + a + o.d);
    env(g.gain, t, a, o.g, o.d);
    src.connect(bq).connect(g).connect(o.out ?? sfx);
    src.start(t, Math.random() * (white.duration - 2));
    src.stop(t + a + o.d + 0.05);
    reap(src, [src, bq, g]);
  }

  /** Lamp swell: soft detuned triangles whose pitch and brightness glide together. */
  function padSwell(freqs: number[], fromMul: number, lpFrom: number, lpTo: number, peak: number) {
    const t = c!.currentTime + 0.03, lp = filter("lowpass", lpFrom), g = c!.createGain();
    lp.frequency.setValueAtTime(lpFrom, t);
    lp.frequency.exponentialRampToValueAtTime(lpTo, t + 0.6);
    env(g.gain, t, 0.35, peak, 1.2);
    lp.connect(g).connect(sfx);
    const chain: AudioNode[] = [lp, g];
    let osc: OscillatorNode | null = null;
    for (const [i, f] of freqs.entries()) {
      osc = c!.createOscillator();
      osc.type = "triangle"; osc.detune.value = i % 2 ? 5 : -5;
      osc.frequency.setValueAtTime(f * fromMul, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.5);
      osc.connect(lp); osc.start(t); osc.stop(t + 1.65);
      chain.push(osc);
    }
    if (osc) reap(osc, chain);
  }

  /** A little bell: sine fundamental + quieter inharmonic partial that dies faster. */
  function bell(f: number, at: number, g: number, d: number) {
    tone({ f, at, a: 0.003, d, g, lp: 5000 });
    tone({ f: f * 2.76, at, a: 0.002, d: d * 0.4, g: g * 0.22, lp: 5000 });
  }

  /** Lamp switch click: a highpassed noise tick plus a tiny sine knock. */
  function click(hp: number) {
    noise({ type: "highpass", f: hp, d: 0.012, g: 0.07 });
    tone({ f: hp * 0.7, d: 0.018, g: 0.025 });
  }

  // --- one-shot recipes -------------------------------------------------------

  const jitter = (s: number) => 1 + (Math.random() - 0.5) * s;

  const recipes: Record<SoundName, () => void> = {
    // Tin shaker: 2-3 taps, each a bandpassed noise grain with two rattle grains behind it and a faint metal tick.
    feed() {
      const taps = Math.random() < 0.4 ? 2 : 3;
      for (let i = 0; i < taps; i++) {
        const at = i * 0.085 + Math.random() * 0.012;
        noise({ type: "bandpass", f: 3000 * jitter(0.3), q: 1.6, at, d: 0.035, g: 0.09 });
        noise({ type: "bandpass", f: 4200, q: 2, at: at + 0.007, d: 0.02, g: 0.035 });
        noise({ type: "bandpass", f: 2400, q: 2, at: at + 0.016, d: 0.02, g: 0.025 });
        tone({ f: 1750 * jitter(0.1), type: "triangle", at, d: 0.02, g: 0.012 });
      }
    },
    // Flake on the surface: a tiny high sine that chirps upward, like a droplet.
    plop() {
      const f = 1300 * jitter(0.25);
      tone({ f, f2: f * 1.8, glide: 0.045, d: 0.07, g: 0.045 });
    },
    // Jelly catches food: two soft rising sine bloops, the second higher and quieter, lowpassed.
    eat() {
      const k = jitter(0.12);
      tone({ f: 320 * k, f2: 700 * k, glide: 0.11, d: 0.16, g: 0.14, lp: 1800 });
      tone({ f: 480 * k, f2: 900 * k, glide: 0.08, at: 0.07, d: 0.12, g: 0.07, lp: 1800 });
    },
    // Affection: two warm triangle notes (C5 then E5) over a quiet 110 Hz purr amplitude-wobbled at ~24 Hz.
    pet() {
      tone({ f: 523.25, type: "triangle", a: 0.015, d: 0.7, g: 0.07, lp: 2000 });
      tone({ f: 659.25, type: "triangle", at: 0.14, a: 0.015, d: 0.85, g: 0.07, lp: 2000 });
      const t = c!.currentTime, purr = c!.createOscillator(), lfo = c!.createOscillator();
      const depth = c!.createGain(), am = c!.createGain(), g = c!.createGain(), lp = filter("lowpass", 420);
      purr.type = "triangle"; purr.frequency.value = 110;
      lfo.frequency.value = 24; depth.gain.value = 0.5; am.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      env(g.gain, t, 0.12, 0.05, 0.6);
      purr.connect(am).connect(lp).connect(g).connect(sfx);
      for (const o of [purr, lfo]) { o.start(t); o.stop(t + 0.8); }
      reap(purr, [purr, lfo, depth, am, lp, g]);
    },
    // Tapping the water: muted glassy droplet, sine blip plus a faint triangle overtone, lowpassed.
    tap() {
      const f = 1050 * jitter(0.2);
      tone({ f, f2: f * 1.3, glide: 0.03, d: 0.12, g: 0.07, lp: 2600 });
      tone({ f: f * 2.75, type: "triangle", d: 0.05, g: 0.012, lp: 2600 });
    },
    // Sponge: bandpassed noise swishing back and forth over 1.6 s, with three quiet rubbery squeaks.
    clean() {
      const t = c!.currentTime, src = c!.createBufferSource(), bp = filter("bandpass", 700, 1.2), g = c!.createGain();
      src.buffer = white;
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(1600, t + 0.5);
      bp.frequency.exponentialRampToValueAtTime(800, t + 1.05);
      bp.frequency.exponentialRampToValueAtTime(1500, t + 1.6);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.2);
      g.gain.linearRampToValueAtTime(0.045, t + 1.25);
      g.gain.linearRampToValueAtTime(0, t + 1.6);
      src.connect(bp).connect(g).connect(sfx);
      src.start(t, Math.random() * 1.5); src.stop(t + 1.65);
      reap(src, [src, bp, g]);
      for (const at of [0.45, 1.0, 1.5]) {
        const f = 1300 * jitter(0.15);
        tone({ f, f2: f * 1.25, glide: 0.07, type: "triangle", at, a: 0.01, d: 0.1, g: 0.02, lp: 2400 });
      }
    },
    // Sweep done: three quick high sine pings (E6, G#6, B6).
    cleaned() {
      [1318.5, 1661.2, 1975.5].forEach((f, i) => tone({ f, at: i * 0.05, d: 0.32, g: 0.035 }));
    },
    // Switch click, then a C4+G4 triangle pad that glides up and opens its filter.
    lampOn() { click(2500); padSwell([261.63, 392], 0.94, 350, 1600, 0.05); },
    // Lower click, then the same pad gliding down while its filter closes.
    lampOff() { click(1800); padSwell([261.63, 392], 1.08, 1400, 300, 0.045); },
    // Swim pulse: a slow-attack lowpass noise breath, routed through the murky ambience bus.
    pulse() { noise({ type: "bandpass", f: 240, f2: 520, q: 0.7, a: 0.25, d: 0.55, g: 0.035, out: murkLP }); },
    // New growth stage: F4-A4-C5-F5 triangle arpeggio, lowpassed, with a sine an octave under the first note.
    grow() {
      [349.23, 440, 523.25, 698.46].forEach((f, i) =>
        tone({ f, type: "triangle", at: i * 0.12, a: 0.01, d: 0.9, g: 0.06, lp: 2200 }));
      tone({ f: 174.61, a: 0.02, d: 1.0, g: 0.05 });
    },
    // Unlock: five rising pentatonic bells (G5..G6), fast and twinkly.
    unlock() {
      [783.99, 880, 1046.5, 1174.66, 1567.98].forEach((f, i) => bell(f, i * 0.065, 0.045, 0.7));
    },
    // Coin clink: two soft bell hits, D6 then G6.
    buy() { bell(1174.66, 0, 0.06, 0.25); bell(1567.98, 0.085, 0.05, 0.3); },
    // Wooden tok: a falling sine knock plus a short bandpassed noise transient.
    ui() {
      tone({ f: 600, f2: 420, glide: 0.03, d: 0.07, g: 0.11 });
      noise({ type: "bandpass", f: 1500, q: 3, d: 0.02, g: 0.04 });
    },
    // Flakes off the can: a few tiny high grains, like a shaker held low, and one soft plink.
    pour() {
      for (let i = 0; i < 3; i++) noise({ type: "bandpass", f: 4200 * jitter(0.3), q: 4, at: i * 0.035 + Math.random() * 0.01, d: 0.018, g: 0.022 });
      tone({ f: 1900 * jitter(0.2), at: 0.05, d: 0.05, g: 0.012 });
    },
    // Sponge on glass: a rubbery squeak (a sine wobbling up) over a short wet swish.
    scrub() {
      const f = 1050 * jitter(0.25);
      tone({ f, f2: f * 1.35, glide: 0.08, type: "triangle", d: 0.09, g: 0.018, lp: 2600 });
      noise({ type: "bandpass", f: 2200 * jitter(0.2), q: 1.4, d: 0.11, g: 0.03 });
    },
    // Lifting the can or sponge off the wooden shelf: a soft knock that rises.
    pickup() {
      tone({ f: 210, f2: 320, glide: 0.06, d: 0.08, g: 0.07, lp: 1200 });
      noise({ type: "lowpass", f: 900, d: 0.02, g: 0.035 });
    },
    // Setting it back down: the same knock, falling, a little heavier.
    putdown() {
      tone({ f: 260, f2: 150, glide: 0.07, d: 0.09, g: 0.08, lp: 1000 });
      noise({ type: "lowpass", f: 700, d: 0.025, g: 0.045 });
    },
    // The brass light switch: a crisp two-part snap.
    switch() {
      click(3600);
      noise({ type: "highpass", f: 2400, at: 0.025, d: 0.01, g: 0.04 });
    },
    // Photo: a soft camera shutter, a bandpassed open tick then a lower, rounder close.
    shutter() {
      noise({ type: "bandpass", f: 3200, q: 1.5, d: 0.018, g: 0.06 });
      noise({ type: "bandpass", f: 1500, q: 1.2, at: 0.06, d: 0.03, g: 0.05 });
      tone({ f: 420, f2: 300, glide: 0.03, at: 0.06, d: 0.04, g: 0.035, lp: 1400 });
    },
    // v16 a find (sea glass or a shell): a soft glassy chime, three quiet bells drifting down (E6, B5, G#5), slow to fade.
    chime() {
      [1318.5, 987.77, 830.61].forEach((f, i) => bell(f * jitter(0.01), i * 0.11, 0.032 - i * 0.006, 1.1));
    },
  };

  // --- ambience -----------------------------------------------------------------

  /** One bubble trickle: 2-5 quick rising sine bloops. Then schedule the next with a setTimeout chain. */
  function trickle() {
    bubbleTimer = null;
    if (live() && !muted) {
      const n = 2 + Math.floor(Math.random() * 4), low = lerp(1, 0.75, night);
      let at = 0;
      for (let i = 0; i < n; i++) {
        const f = (500 + Math.random() * 600) * low;
        tone({ f, f2: f * 1.6, glide: 0.06, at, d: 0.08, g: 0.035, out: bubbles });
        at += 0.06 + Math.random() * 0.08;
      }
    }
    bubbleTimer = setTimeout(trickle, bubbleDelayMs(night, Math.random()));
  }

  /** Brown-ish noise that loops seamlessly (drift removed so the ends meet). */
  function brownBuffer(seconds: number): AudioBuffer {
    const len = Math.floor(c!.sampleRate * seconds), buf = c!.createBuffer(1, len, c!.sampleRate), d = buf.getChannelData(0);
    let y = 0, first = 0;
    for (let i = 0; i < len; i++) { y = y * 0.995 + (Math.random() * 2 - 1) * 0.06; d[i] = y; if (i === 0) first = y; }
    const drift = y - first;
    for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) - (drift * i) / (len - 1);
    return buf;
  }

  function loopOsc(type: OscillatorType, f: number, detune: number, out: AudioNode) {
    const o = c!.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    o.connect(out); o.start();
  }
  /** Slow LFO added onto an AudioParam. */
  function lfo(rate: number, depth: number, param: AudioParam) {
    const o = c!.createOscillator(), g = c!.createGain();
    o.frequency.value = rate; g.gain.value = depth;
    o.connect(g).connect(param); o.start();
  }

  function build() {
    const ac = c!;
    white = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;

    master = ac.createGain(); master.gain.value = muted ? 0 : MASTER_GAIN;
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.25;
    comp.connect(master).connect(ac.destination);
    sfx = ac.createGain(); sfx.connect(comp);
    amb = ac.createGain(); amb.gain.value = 0; amb.connect(comp);
    amb.gain.setTargetAtTime(1, ac.currentTime, 1.2); // fade ambience in over a few seconds
    murkLP = filter("lowpass", murkCutoff(murk), 0.5); murkLP.connect(amb);

    // Water hum: one looping brown-noise source split into a brighter day bed and a darker, quieter night bed.
    const bed = ac.createBufferSource();
    bed.buffer = brownBuffer(6); bed.loop = true;
    dayBed = ac.createGain(); nightBed = ac.createGain();
    const hum = ac.createGain(); hum.connect(murkLP);
    lfo(0.06, 0.15, hum.gain); // slow ±15% swell, like distant water moving
    bed.connect(filter("lowpass", 650)).connect(dayBed).connect(hum);
    bed.connect(filter("lowpass", 240)).connect(nightBed).connect(hum);
    bed.start();

    // Pad: detuned triangles through a lowpass that breathes on a slow LFO. Day C3+G3, night G2+D3.
    const padLP = filter("lowpass", 520, 0.6);
    lfo(0.05, 160, padLP.frequency);
    padLP.connect(murkLP);
    dayPad = ac.createGain(); nightPad = ac.createGain();
    dayPad.connect(padLP); nightPad.connect(padLP);
    loopOsc("triangle", 130.81, -7, dayPad); loopOsc("triangle", 196, 6, dayPad); loopOsc("sine", 261.63, 3, dayPad);
    loopOsc("triangle", 98, -6, nightPad); loopOsc("triangle", 146.83, 7, nightPad);

    bubbles = ac.createGain(); bubbles.connect(murkLP);
    applyNight(true);

    document.addEventListener("visibilitychange", () => {
      if (!c) return;
      if (document.hidden) void c.suspend().catch(() => {});
      else void c.resume().catch(() => {});
    });
    trickle();
    if (music) startMusic();
  }

  function applyNight(now = false) {
    if (!c) return;
    const m = nightMix(night), t = c.currentTime, k = now ? 0.01 : 0.25;
    dayBed.gain.setTargetAtTime(0.09 * m.day, t, k);
    nightBed.gain.setTargetAtTime(0.06 * m.night, t, k);
    dayPad.gain.setTargetAtTime(0.03 * m.day, t, k);
    nightPad.gain.setTargetAtTime(0.026 * m.night, t, k);
    bubbles.gain.setTargetAtTime(lerp(1, 0.55, night), t, k);
    applyMusicNight(now);
  }

  // --- music ----------------------------------------------------------------------
  // A lookahead scheduler: a setTimeout pump keeps ~2 bars of notes queued on the audio clock, one bar at a
  // time, each bar's start = previous start + its length (so no drift, and a tempo change is seamless).
  // Every note disconnects its nodes when it ends; turning music off fades the bus, then stops whatever is queued.

  /** Vinyl crackle: sparse clicks with the odd louder pop over a whisper of hiss. Loops with no audible seam. */
  function crackleBuffer(seconds: number): AudioBuffer {
    const sr = c!.sampleRate, len = Math.floor(sr * seconds), buf = c!.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.01;
    for (let k = Math.floor(seconds * 12); k > 0; k--) {
      const at = Math.floor(Math.random() * (len - 16)), w = 2 + Math.floor(Math.random() * 6);
      const amp = (Math.random() < 0.07 ? 0.8 : 0.15 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < w; j++) d[at + j] = (d[at + j] ?? 0) + amp * Math.exp(-j / 1.6) * (j % 2 ? -0.6 : 1);
    }
    return buf;
  }

  function ensureMusicBus() {
    if (mBus) return;
    const ac = c!;
    mBus = ac.createGain(); mBus.gain.value = MUSIC_GAIN;
    mFade = ac.createGain(); mFade.gain.value = 0;
    mDuck = ac.createGain();
    mNight = ac.createGain(); mNight.gain.value = musicNightLevel(night); // quiet nights: the whole bed sits lower
    mTone = filter("lowpass", musicCutoff(night), 0.5);
    mMurk = filter("lowpass", murkCutoff(murk), 0.5);
    // Tape wow: a short delay line whose delay time drifts, which bends the pitch of everything through it.
    const wow = ac.createDelay(0.05);
    wow.delayTime.value = 0.012;
    lfo(0.5, 0.0008, wow.delayTime); // wow, about ±4 cents
    lfo(0.11, 0.0025, wow.delayTime); // slower drift, about ±3 cents
    wow.connect(mTone).connect(mMurk).connect(mDuck).connect(mNight).connect(mFade).connect(mBus).connect(comp);

    // Electric piano lowpass with a slow wobble on its cutoff.
    mKeys = filter("lowpass", keysCutoff(night), 0.9);
    const wob = ac.createOscillator();
    wob.frequency.value = 0.13;
    mWobble = ac.createGain();
    wob.connect(mWobble).connect(mKeys.frequency); wob.start();
    mKeys.connect(wow);
    mBass = ac.createGain(); mBass.connect(filter("lowpass", 360, 0.6)).connect(wow);
    mDrums = ac.createGain(); mDrums.connect(filter("lowpass", 3800, 0.5)).connect(wow);
    // Crackle skips the wow (it's the record, not the tape) but still darkens with murk.
    mCrackle = ac.createGain();
    mCrackle.connect(filter("highpass", 900, 0.5)).connect(mMurk);
    crackleBuf = crackleBuffer(5);
    applyMusicNight(true);
  }

  /** Night darkens the bed: lower tone and piano cutoffs, a lazier wobble, the beat faded out, quieter crackle. */
  function applyMusicNight(now = false) {
    if (!c || !mBus) return;
    const t = c.currentTime, k = now ? 0.01 : MUSIC_NIGHT_GLIDE; // a slow glide: day and night crossfade
    mNight.gain.setTargetAtTime(musicNightLevel(night), t, k);
    mTone.frequency.setTargetAtTime(musicCutoff(night), t, k);
    mKeys.frequency.setTargetAtTime(keysCutoff(night), t, k);
    mWobble.gain.setTargetAtTime(lerp(320, 110, night), t, k);
    mDrums.gain.setTargetAtTime(drumMix(night), t, k);
    mCrackle.gain.setTargetAtTime(lerp(0.2, 0.13, night), t, k);
  }

  function track(s: Session, srcs: AudioScheduledSourceNode[], chain: AudioNode[]) {
    const v: Voice = { srcs, chain };
    s.voices.add(v);
    srcs[0]!.onended = () => { for (const n of chain) n.disconnect(); s.voices.delete(v); };
  }

  /**
   * Electric piano: a sine carrier FM'd by a 1:1 sine whose index dies away (the warm bark), plus a soft
   * sine tine two octaves up that rings briefly. Fast initial decay, then a long tail over `len`.
   */
  function key(s: Session, midi: number, t: number, vel: number, len: number) {
    const ac = c!, f = midiToHz(midi);
    const car = ac.createOscillator(), mod = ac.createOscillator(), idx = ac.createGain();
    const tine = ac.createOscillator(), tg = ac.createGain(), amp = ac.createGain();
    car.frequency.value = f; mod.frequency.value = f; mod.detune.value = 4; tine.frequency.value = f * 4;
    idx.gain.setValueAtTime(f * 1.3 * vel, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.06, t + 0.7);
    const peak = 0.07 * vel;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, len));
    env(tg.gain, t, 0.002, 0.016 * vel, 0.35);
    mod.connect(idx).connect(car.frequency);
    car.connect(amp); tine.connect(tg).connect(amp);
    amp.connect(mKeys);
    const end = t + Math.max(0.6, len) + 0.05;
    for (const o of [car, mod, tine]) { o.start(t); o.stop(end); }
    track(s, [car, mod, tine], [car, mod, idx, tine, tg, amp]);
  }

  /** Round bass: sine + triangle at the same pitch, into a 360 Hz lowpass. */
  function bassNote(s: Session, midi: number, t: number, vel: number, len: number) {
    const ac = c!, f = midiToHz(midi), sine = ac.createOscillator(), tri = ac.createOscillator(), amp = ac.createGain();
    sine.frequency.value = f; tri.type = "triangle"; tri.frequency.value = f;
    const peak = 0.3 * vel;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.025);
    amp.gain.exponentialRampToValueAtTime(peak * 0.45, t + 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, len));
    sine.connect(amp); tri.connect(amp); amp.connect(mBass);
    for (const o of [sine, tri]) { o.start(t); o.stop(t + Math.max(0.6, len) + 0.05); }
    track(s, [sine, tri], [sine, tri, amp]);
  }

  /** Muffled kick: a sine thump falling 105 → 44 Hz. */
  function kick(s: Session, t: number, vel: number) {
    const o = c!.createOscillator(), g = c!.createGain();
    o.frequency.setValueAtTime(105, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.14);
    env(g.gain, t, 0.004, 0.42 * vel, 0.3);
    o.connect(g).connect(mDrums);
    o.start(t); o.stop(t + 0.36);
    track(s, [o], [o, g]);
  }

  /** A brush: a slice of white noise through a soft bandpass with a slow-ish (swishy) attack. */
  function brush(s: Session, t: number, g: number, d: number, f: number, q: number, a = 0.012) {
    const src = c!.createBufferSource(), bp = filter("bandpass", f, q), amp = c!.createGain();
    src.buffer = white;
    env(amp.gain, t, a, g, d);
    src.connect(bp).connect(amp).connect(mDrums);
    src.start(t, Math.random() * (white.duration - 1)); src.stop(t + a + d + 0.05);
    track(s, [src], [src, bp, amp]);
  }

  /** One bar at `t0`. Day: strum + re-strike, bass with a pickup, brushed beat. Night: one long chord, more air. */
  function scheduleBar(s: Session, t0: number, bpm: number) {
    // quiet nights: bar by bar the sparse way gets likelier as night falls (no hard switch), so dusk crossfades
    const beat = 60 / bpm, ch = chordAt(s.bar), n = night, calm = Math.random() < calmChance(n), sw = beat * 0.08;
    const h = () => (Math.random() - 0.5) * 0.016; // ±8 ms of human
    const v = (x: number) => x * (0.88 + Math.random() * 0.24) * lerp(1, 0.85, n);

    // Keys: a slow upward strum on the one (at night often without its top voice); by day a softer re-strike of
    // the upper notes on the and of 3.
    const top = Math.random() < topVoiceChance(n);
    ch.notes.forEach((m, i) => (top || i < ch.notes.length - 1) && key(s, m, t0 + i * 0.018 + h(), v(1), beat * (calm ? 5.5 : 4.2)));
    if (!calm && Math.random() < 0.8) {
      ch.notes.slice(1).forEach((m, i) => key(s, m, t0 + 2.5 * beat + sw + i * 0.012 + h(), v(0.45), beat * 1.6));
    } else if (calm && Math.random() < 0.3) {
      ch.notes.slice(2).forEach((m, i) => key(s, m, t0 + 3 * beat + i * 0.03 + h(), v(0.3), beat * 2.5));
    }

    // Bass: root on the one; by day sometimes a fifth or octave pickup on the and of 3.
    bassNote(s, ch.bass, t0 + h(), v(1), beat * (calm ? 3.8 : 2.4));
    if (!calm && Math.random() < 0.55) {
      bassNote(s, ch.bass + (Math.random() < 0.5 ? 7 : 12), t0 + 2.5 * beat + sw + h(), v(0.55), beat * 1.2);
    }

    // Brushed beat (dropped at night): kick on 1 (and maybe the and of 3), brush snare on 2 and 4, soft swung 8ths.
    if (drumMix(n) > 0.01) {
      kick(s, t0 + h(), v(1));
      if (Math.random() < 0.6) kick(s, t0 + 2.5 * beat + sw + h(), v(0.55));
      for (const b of [1, 3]) {
        brush(s, t0 + b * beat + 0.012 + h(), v(0.12), 0.2, 1700, 0.6); // laid back a hair
        brush(s, t0 + b * beat + 0.03 + h(), v(0.035), 0.32, 900, 0.5, 0.04);
      }
      for (let i = 0; i < 8; i++) {
        if (Math.random() < 0.85) brush(s, t0 + i * 0.5 * beat + (i % 2 ? sw : 0) + h(), v(i % 2 ? 0.014 : 0.022), 0.045, 3400, 0.9, 0.006);
      }
    }

    // Melody: now and then a pentatonic note or two, walking by step from the last one.
    if (Math.random() < lerp(0.4, 0.16, n)) {
      const pool = melodyPool(ch);
      if (pool.length) {
        let i = 0;
        for (let j = 1; j < pool.length; j++) if (Math.abs(pool[j]! - s.mel) < Math.abs(pool[i]! - s.mel)) i = j;
        let pos = 1 + Math.floor(Math.random() * 3) * 0.5; // beat 2, its and, or 3
        const count = calm ? 1 : Math.random() < 0.4 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const step = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)] ?? 1;
          i = Math.min(pool.length - 1, Math.max(0, i + step));
          const m = pool[i]!;
          key(s, m, t0 + pos * beat + (pos % 1 ? sw : 0) + h(), v(calm ? 0.6 : 0.75), beat * (calm ? 4 : 2.5));
          s.mel = m;
          pos += Math.random() < 0.5 ? 0.5 : 1;
        }
      }
    }
  }

  /** Top up the queue to MUSIC_LOOKAHEAD_BARS ahead of the audio clock, then check again shortly. */
  function pump(s: Session) {
    s.pump = null;
    if (session !== s || !c) return;
    const now = c.currentTime, bpm = musicTempo(night), bar = barSeconds(bpm);
    if (s.next < now + 0.03) s.next = now + 0.08; // stalled past the queue: pick the beat back up, don't cram
    while (s.next < now + MUSIC_LOOKAHEAD_BARS * bar) {
      try { scheduleBar(s, s.next, bpm); } catch { /* skip a bar rather than break */ }
      s.next += bar;
      s.bar++;
    }
    s.pump = setTimeout(() => pump(s), 400);
  }

  /** Ramp the on/off fade from wherever it is now; returns when it lands. */
  function fadeTo(to: number, secs: number): number {
    const p = mFade.gain, t = c!.currentTime, from = p.value;
    const end = t + Math.max(0.05, secs * Math.abs(to - from));
    p.cancelScheduledValues(t);
    p.setValueAtTime(from, t);
    p.linearRampToValueAtTime(to, end);
    return end;
  }

  function startMusic() {
    if (!c) return;
    ensureMusicBus();
    if (session) {
      // Still fading out: keep the same run going.
      if (session.stop) { clearTimeout(session.stop); session.stop = null; }
    } else {
      const t = c.currentTime + 0.1, s: Session = { next: t, bar: 0, mel: 72, voices: new Set(), pump: null, stop: null };
      session = s;
      const crackle = c.createBufferSource();
      crackle.buffer = crackleBuf; crackle.loop = true;
      crackle.connect(mCrackle);
      crackle.start(t, Math.random() * 4);
      track(s, [crackle], [crackle]);
      pump(s);
    }
    fadeTo(1, 2);
  }

  function stopMusic() {
    const s = session;
    if (!c || !s) return;
    const end = fadeTo(0, 1.5);
    const check = () => {
      s.stop = null;
      if (session !== s) return;
      // If the tab was hidden the audio clock paused mid-fade; wait for it to really finish.
      if (c!.currentTime < end) { s.stop = setTimeout(check, 250); return; }
      endSession(s);
    };
    if (s.stop) clearTimeout(s.stop);
    s.stop = setTimeout(check, (end - c.currentTime) * 1000 + 50);
  }

  /** Stop and disconnect everything this run queued (the fade is already at zero). */
  function endSession(s: Session) {
    if (s.pump) clearTimeout(s.pump);
    if (s.stop) clearTimeout(s.stop);
    s.pump = s.stop = null;
    const t = c!.currentTime;
    for (const v of s.voices) {
      for (const src of v.srcs) { src.onended = null; try { src.stop(t); } catch { /* already stopped */ } }
      for (const node of v.chain) node.disconnect();
    }
    s.voices.clear();
    if (session === s) session = null;
  }

  /** Dip the music ~30% for ~0.4 s so a one-shot reads clearly over it. */
  function duck() {
    if (!c || !session) return;
    const p = mDuck.gain, t = c.currentTime;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0.7, t, 0.03);
    p.setTargetAtTime(1, t + 0.4, 0.18);
  }

  // --- public API ---------------------------------------------------------------

  return {
    unlock() {
      if (c) {
        if (c.state === "suspended" && !document.hidden) void c.resume().catch(() => {});
        return;
      }
      if (typeof window === "undefined") return;
      const AC: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!AC) return;
      try { c = new AC(); } catch { c = null; return; }
      build();
      void c.resume().catch(() => {});
    },
    play(name) {
      if (!live() || muted) return;
      if (!gate.admit(name, c!.currentTime)) return;
      try { recipes[name](); duck(); } catch { /* never let a sound break the game */ }
    },
    setNight(amount) {
      const n = clamp01(amount);
      if (Math.abs(n - night) < 0.002) return;
      night = n;
      applyNight();
    },
    setMurk(amount) {
      const m = clamp01(amount);
      if (Math.abs(m - murk) < 0.002) return;
      murk = m;
      if (c) murkLP.frequency.setTargetAtTime(murkCutoff(murk), c.currentTime, 0.3);
      if (c && mBus) mMurk.frequency.setTargetAtTime(murkCutoff(murk), c.currentTime, 0.3);
    },
    setMuted(m) {
      muted = m;
      writeMuted(m);
      if (c) master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, c.currentTime, 0.08);
    },
    get muted() { return muted; },
    setMusic(on) {
      music = on;
      writeMusic(on);
      if (!c) return; // starts in build() on the first unlock if still on
      try { if (on) startMusic(); else stopMusic(); } catch { /* never let music break the game */ }
    },
    get music() { return music; },
  };
}

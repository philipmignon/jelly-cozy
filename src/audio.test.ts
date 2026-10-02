import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MUSIC_KEY, PENTATONIC, PROGRESSION, SOUND_SPEC, barSeconds, bubbleDelayMs, chordAt, createGate, createTankAudio,
  drumMix, melodyPool, midiToHz, murkCutoff, musicCutoff, musicTempo, nightMix, noteToMidi,
} from "./audio";

describe("audio helpers", () => {
  it("murk closes the lowpass monotonically from 9 kHz to 420 Hz", () => {
    expect(murkCutoff(0)).toBeCloseTo(9000);
    expect(murkCutoff(1)).toBeCloseTo(420);
    expect(murkCutoff(0.5)).toBeLessThan(murkCutoff(0.4));
    expect(murkCutoff(-3)).toBeCloseTo(9000);
    expect(murkCutoff(Number.NaN)).toBeCloseTo(9000);
  });

  it("night crossfade is equal-power", () => {
    for (const n of [0, 0.25, 0.5, 0.9, 1]) {
      const m = nightMix(n);
      expect(m.day ** 2 + m.night ** 2).toBeCloseTo(1);
    }
    expect(nightMix(0)).toEqual({ day: 1, night: 0 });
    expect(nightMix(1).day).toBeCloseTo(0);
  });

  it("bubbles come slower at night", () => {
    expect(bubbleDelayMs(0, 0)).toBe(2500);
    expect(bubbleDelayMs(1, 1)).toBe(13000);
    expect(bubbleDelayMs(1, 0.5)).toBeGreaterThan(bubbleDelayMs(0, 0.5));
  });
});

describe("gate", () => {
  it("debounces repeats of one sound inside its gap", () => {
    const g = createGate();
    expect(g.admit("plop", 0)).toBe(true);
    expect(g.admit("plop", 0.01)).toBe(false);
    expect(g.admit("plop", SOUND_SPEC.plop.gap + 0.001)).toBe(true);
    expect(g.admit("eat", 0.01)).toBe(true); // other sounds unaffected
  });

  it("caps concurrent voices and frees them when they finish", () => {
    const g = createGate(3);
    expect(g.admit("ui", 0)).toBe(true);
    expect(g.admit("tap", 0)).toBe(true);
    expect(g.admit("buy", 0)).toBe(true);
    expect(g.admit("eat", 0)).toBe(false);
    expect(g.admit("eat", 0.5)).toBe(true); // ui/tap/buy have rung out
  });

  it("rejects unknown names", () => {
    expect(createGate().admit("nope", 0)).toBe(false);
  });

  it("does not let a spammed sound pile up", () => {
    const g = createGate();
    let n = 0;
    for (let t = 0; t < 1; t += 1 / 120) if (g.admit("pulse", t)) n++;
    expect(n).toBe(2);
  });
});

describe("createTankAudio outside a browser", () => {
  it("is inert and never throws without window/AudioContext", () => {
    const a = createTankAudio();
    expect(() => {
      a.unlock();
      a.play("feed");
      a.setNight(0.7);
      a.setMurk(2);
      a.setMuted(true);
    }).not.toThrow();
    expect(a.muted).toBe(true);
  });
});

describe("music helpers", () => {
  it("names notes and tunes them to A440", () => {
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("Bb1")).toBe(34);
    expect(noteToMidi("F#3")).toBe(54);
    expect(() => noteToMidi("H2")).toThrow();
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(57)).toBeCloseTo(220);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
  });

  it("the progression is eight four-note bars that loop", () => {
    expect(PROGRESSION.map((c) => c.name)).toEqual(["Fmaj9", "Em7", "Dm9", "Cmaj9", "Fmaj9", "Em7", "Bbmaj9", "Am7"]);
    for (const c of PROGRESSION) {
      expect(c.notes).toHaveLength(4);
      expect([...c.notes].sort((a, b) => a - b)).toEqual(c.notes); // voiced low to high
      expect(c.bass).toBeLessThan(c.notes[0]!);
      // warm register: bass 50-90 Hz, voicing between E3 and G4, nothing shrill
      expect(midiToHz(c.bass)).toBeGreaterThan(50);
      expect(midiToHz(c.bass)).toBeLessThan(90);
      for (const m of c.notes) { expect(m).toBeGreaterThanOrEqual(52); expect(m).toBeLessThanOrEqual(67); }
    }
    expect(chordAt(0)).toBe(PROGRESSION[0]);
    expect(chordAt(8)).toBe(PROGRESSION[0]);
    expect(chordAt(-1)).toBe(PROGRESSION[7]);
    expect(chordAt(13)).toBe(PROGRESSION[5]);
  });

  it("voicings move by small steps, including the wrap back to bar 1", () => {
    for (let b = 0; b < PROGRESSION.length; b++) {
      const a = chordAt(b).notes, z = chordAt(b + 1).notes;
      a.forEach((m, i) => expect(Math.abs(m - z[i]!)).toBeLessThanOrEqual(5));
    }
  });

  it("chord spellings match their names", () => {
    const pcs = (ms: readonly number[]) => [...new Set(ms.map((m) => m % 12))].sort((a, b) => a - b);
    const byName: Record<string, number[]> = {
      Fmaj9: [0, 4, 5, 7, 9], Em7: [2, 4, 7, 11], Dm9: [0, 2, 4, 5, 9], Cmaj9: [0, 2, 4, 7, 11],
      Bbmaj9: [0, 2, 5, 9, 10], Am7: [0, 4, 7, 9],
    };
    for (const c of PROGRESSION) expect(pcs([c.bass, ...c.notes])).toEqual(byName[c.name]);
  });

  it("melody pool is pentatonic, in range, and avoids the b9 rub", () => {
    for (const c of PROGRESSION) {
      const pool = melodyPool(c);
      expect(pool.length).toBeGreaterThanOrEqual(6);
      for (const m of pool) {
        expect(PENTATONIC).toContain(m % 12);
        expect(m).toBeGreaterThanOrEqual(64);
        expect(m).toBeLessThanOrEqual(81);
      }
    }
    const em7 = PROGRESSION[1]!;
    expect(melodyPool(em7).some((m) => m % 12 === 0)).toBe(false); // no C over Em7's B
    expect(melodyPool(PROGRESSION[0]!).some((m) => m % 12 === 0)).toBe(true); // C is fine over Fmaj9
  });

  it("night slows the tempo, darkens the tone and drops the beat", () => {
    expect(musicTempo(0)).toBe(72);
    expect(musicTempo(1)).toBe(63);
    expect(barSeconds(72)).toBeCloseTo(3.333, 3);
    expect(barSeconds(musicTempo(1))).toBeGreaterThan(barSeconds(musicTempo(0)));
    expect(musicCutoff(0)).toBeCloseTo(3200);
    expect(musicCutoff(1)).toBeCloseTo(1000);
    expect(musicCutoff(0.7)).toBeLessThan(musicCutoff(0.3));
    expect(drumMix(0)).toBe(1);
    expect(drumMix(0.2)).toBeCloseTo(1);
    expect(drumMix(0.4)).toBeCloseTo(0.5);
    expect(drumMix(0.6)).toBe(0);
    expect(drumMix(1)).toBe(0);
  });
});

describe("music flag", () => {
  const mockStorage = () => {
    const m = new Map<string, string>();
    const ls = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    };
    vi.stubGlobal("localStorage", ls);
    return m;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it("defaults off", () => {
    mockStorage();
    expect(createTankAudio().music).toBe(false);
  });

  it("persists through the storage key", () => {
    const store = mockStorage();
    const a = createTankAudio();
    a.setMusic(true);
    expect(a.music).toBe(true);
    expect(store.get(MUSIC_KEY)).toBe("1");
    expect(createTankAudio().music).toBe(true);
    a.setMusic(false);
    expect(store.get(MUSIC_KEY)).toBe("0");
    expect(createTankAudio().music).toBe(false);
  });

  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    const a = createTankAudio();
    expect(a.music).toBe(false);
    expect(() => a.setMusic(true)).not.toThrow();
    expect(a.music).toBe(true);
  });

  it("setMusic is inert and never throws without an AudioContext", () => {
    mockStorage();
    const a = createTankAudio();
    expect(() => {
      a.setMusic(true);
      a.unlock();
      a.play("buy");
      a.setNight(1);
      a.setMurk(0.5);
      a.setMuted(true);
      a.setMusic(false);
      a.setMusic(true);
    }).not.toThrow();
    expect(a.music).toBe(true);
  });
});

/**
 * Lamp gels: coloured filters for the tank's lamp (shop items 31 Warm amber, 32 Deep blue, 33 UV). Clear (gel 0)
 * is the bare lamp and always owned. Pure: no DOM, no Rive. sim.ts keeps a GelState in its State; the view writes
 * one-hot gel0..gel3 (the .riv's tint layers), and while the UV gel is on and the lamp lit, uvLight and each
 * jelly's j{s}uv (what fluoresces). A gel only colours the lamp's light: at night with the lamp off it's moonlight.
 *
 * The gel in use is picked from its shop card (buying one puts it in), or by tapping the gel wheel by the light
 * switch, which steps through the owned ones (Clear, then each owned gel, then Clear again).
 */
export const GEL_N = 4;
export const GEL_CLEAR = 0;
export const GEL_WARM = 1;
export const GEL_BLUE = 2;
export const GEL_UV = 3;
export const GEL_NAMES = ["Clear", "Warm amber", "Deep blue", "UV"] as const;

export interface GelState {
  /** owned, index = gel (Clear always) */
  owned: boolean[];
  /** the one on the lamp */
  on: number;
  /** sim time the gel wheel stops looking pressed */
  pressUntil: number;
}

export const newGels = (): GelState => ({ owned: Array.from({ length: GEL_N }, (_, g) => g === GEL_CLEAR), on: GEL_CLEAR, pressUntil: 0 });

/** Saved gels, repaired: Clear always owned, the one on the lamp must be owned (else Clear). */
export function gelsOf(owned: unknown, on: unknown): GelState {
  const g = newGels();
  if (Array.isArray(owned)) for (let i = 1; i < GEL_N; i++) g.owned[i] = owned[i] === true;
  const n = typeof on === "number" && Number.isInteger(on) ? on : GEL_CLEAR;
  g.on = n > 0 && n < GEL_N && g.owned[n] ? n : GEL_CLEAR;
  return g;
}

/** The optional save fields: `gels` once one is bought, `gel` while one other than Clear is on. */
export function gelFields(g: GelState): { gels?: boolean[]; gel?: number } {
  return { ...(g.owned.some((o, i) => o && i > 0) ? { gels: [...g.owned] } : {}), ...(g.on !== GEL_CLEAR ? { gel: g.on } : {}) };
}

/** Any gel bought (the wheel by the switch shows)? */
export const anyGel = (g: GelState): boolean => g.owned.some((o, i) => o && i > 0);

/** Put gel n on the lamp if it's owned; returns whether it's on now. */
export function setGel(g: GelState, n: number): boolean {
  if (!Number.isInteger(n) || n < 0 || n >= GEL_N || !g.owned[n]) return false;
  g.on = n;
  return true;
}

/** The next owned gel after the one on (wrapping through Clear); returns it. */
export function nextGel(g: GelState): number {
  for (let d = 1; d <= GEL_N; d++) {
    const n = (g.on + d) % GEL_N;
    if (g.owned[n]) return n;
  }
  return g.on;
}

/** How strongly the UV gel lights the tank: 1 with the lamp fully on, easing out with it (daylight 0..1). */
export const uvLightOf = (g: GelState, daylight: number): number => (g.on === GEL_UV ? Math.round(Math.min(1, Math.max(0, daylight)) * 100) / 100 : 0);

/** The words for the screen reader: "Warm amber gel on the lamp." / "Clear lamp." */
export const gelWords = (n: number): string => (n === GEL_CLEAR ? "Clear lamp: no gel." : `${GEL_NAMES[n] ?? "A"} gel on the lamp.`);

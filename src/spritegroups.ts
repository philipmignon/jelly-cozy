/**
 * Sprite groups: art the tank loads only when it is needed.
 *
 * tools/gen.py ships each species' jelly sprites (group `sp-<species>`) and each event's (`ev-<event>`, e.g. the
 * `hw_` Halloween art) as *referenced* image assets: the .riv carries their records but no bytes, and the PNGs of
 * a group sit together in one file, public/sprites/<group>.json, listed in contract.assetGroups. The host hands
 * the runtime an `assetLoader` that keeps a handle to every referenced asset; when a group's file arrives each
 * PNG is decoded and set on its asset. That works at any time, also after the artboard is already drawing.
 *
 * A jelly whose group is not ready yet is kept hidden (main.ts writes its slot's `on` as 0), so a missing sprite
 * never shows. Other features ask for what they need with `needGroup` / `ensureGroups`.
 */
import contract from "./contract.json";
import { SEASONS, type SeasonId } from "./season";

export interface GroupInfo {
  /** relative to the page */
  file: string;
  /** content hash, added to the URL so a new build never meets an old cached file */
  v: string;
  sprites: number;
  bytes: number;
}

const C = contract as unknown as { assetGroups?: Record<string, GroupInfo>; species?: string[] };
/** Every group this build ships (gen.py writes the list). */
export const GROUPS: Readonly<Record<string, GroupInfo>> = C.assetGroups ?? {};
const SPECIES_KEYS: readonly string[] = C.species ?? [];

/** The group holding species k's jelly art, e.g. "sp-moon". */
export const speciesGroup = (k: number): string => `sp-${SPECIES_KEYS[k] ?? k}`;

/** A seasonal event's group (`ev-halloween`): gen.py's EVENT_GROUPS packs the season's sprite prefix (`hw_`) into it. */
export const eventGroup = (id: SeasonId): string => `ev-${id}`;

/**
 * v16 (pairs): the colours only a pair's baby can have each ship as a group of their own (gen.py's MO_GROUPS packs
 * the sprite prefix `mo_dusk_` into `mo-dusk`, `mo_pearl_` into `mo-pearl`), so a tank without one downloads nothing.
 * Winter's frost morph (3) too, `mo_frost_` into `mo-frost`: with its iced tentacles it's the heaviest morph, so a
 * winter visit loads it only when a frost jelly is in the tank, not for the season's snow and decor.
 */
export const PAIR_MORPH_GROUPS: Readonly<Record<number, string>> = { 3: "mo-frost", 4: "mo-dusk", 5: "mo-pearl" };

/**
 * The group a morph's palettes live in when it isn't the species' own: a seasonal morph (2, ghost) is drawn by
 * its season's art (`hw_<Species><Stage>Ghost*`), so it needs that event's group whether or not the season is on.
 * v16: a pair's colour (4 dusk, 5 pearl) by its own group (PAIR_MORPH_GROUPS).
 */
export function morphGroup(morph: number): string | null {
  const pair = PAIR_MORPH_GROUPS[morph];
  if (pair) return pair;
  const season = SEASONS.find((s) => s.morph !== null && s.morph === morph);
  return season ? eventGroup(season.id) : null;
}

/** What a jelly's art depends on: its species (k) and its morph id (0 none, 1 classic, 2 ghost, 4 dusk, 5 pearl). */
export interface JellyArt {
  k: number;
  morph?: number;
}

/** The groups one jelly needs before it can show whole: its species', plus its morph's if that lives elsewhere. */
export function jellyGroups(j: JellyArt): string[] {
  const m = morphGroup(j.morph ?? 0);
  return m ? [speciesGroup(j.k), m] : [speciesGroup(j.k)];
}

/**
 * The groups a tank needs: every jelly's (species, and a seasonal morph's event art) plus the event showing.
 * `event` is what season.ts's activeSeason(now, search, decorOn) picked (null: none, or decor turned off), so a
 * ghost jelly kept after the season, or with decor off, still brings its art without bringing the decor back.
 */
export function groupsFor(jellies: Iterable<JellyArt>, event: SeasonId | null = null): string[] {
  const out = Array.from(jellies, jellyGroups).flat();
  if (event) out.push(eventGroup(event));
  return [...new Set(out)];
}

/** The group's file URL, relative to `base` (the page). */
export const groupUrl = (g: GroupInfo, base: string): string => new URL(`${g.file}?v=${g.v}`, base).href;

/** Bytes of a base64 string. */
export function fromBase64(b64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (native) return native(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- the loader

/** What the runtime hands the asset loader (an ImageAssetWrapper on the web), and what decodeImage returns. */
export interface ImageAssetLike {
  readonly name: string;
  readonly isImage: boolean;
  setRenderImage(img: never): void;
}
export interface DecodedImage {
  unref(): void;
}

export interface SpriteGroupDeps {
  decode(bytes: Uint8Array): Promise<DecodedImage>;
  fetch(url: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** the page URL group files resolve against */
  base: string;
  /** settles once the .riv is loaded (every referenced asset has reported to the asset loader by then) */
  fileLoaded: Promise<unknown>;
  /** run when the browser is idle (prefetch) */
  idle?: (fn: () => void) => void;
}

export interface SpriteGroups {
  /** Rive's `assetLoader`: claims the referenced (byte-less) images; everything else loads as embedded. */
  assetLoader(asset: ImageAssetLike, bytes: Uint8Array): boolean;
  /** Fetch and install these groups (unknown names count as ready). Rejects if a fetch fails; call again to retry. */
  ensureGroups(names: readonly string[]): Promise<void>;
  /** True once the group's art is on its assets (or the build has no such group). */
  isReady(name: string): boolean;
  /** Like ensureGroups but quiet, and at most one retry every few seconds after a failure (safe to call every frame). */
  want(names: readonly string[]): void;
  /** Download these when the browser is idle, without decoding them (that waits for ensureGroups / want). */
  prefetch(names: readonly string[]): void;
}

const RETRY_MS = 5000;

export function createSpriteGroups(deps: SpriteGroupDeps): SpriteGroups {
  const handles = new Map<string, ImageAssetLike>();
  const loads = new Map<string, Promise<void>>();
  const ready = new Set<string>();
  const failedAt = new Map<string, number>();
  const idle = deps.idle ?? ((fn) => setTimeout(fn, 1500));

  // downloading and decoding are separate steps: a prefetch only downloads (decoding a few hundred images is
  // real main-thread work, so it waits until a jelly of the species actually turns up)
  const fetched = new Map<string, Promise<Record<string, string>>>();
  const download = (name: string, info: GroupInfo): Promise<Record<string, string>> => {
    let p = fetched.get(name);
    if (!p) {
      p = deps
        .fetch(groupUrl(info, deps.base))
        .then(async (res) => {
          if (!res.ok) throw new Error(`sprite group ${name}: HTTP ${res.status}`);
          return ((await res.json()) as { sprites?: Record<string, string> }).sprites ?? {};
        })
        .catch((err: unknown) => {
          fetched.delete(name); // a later call retries
          failedAt.set(name, Date.now());
          throw err;
        });
      fetched.set(name, p);
    }
    return p;
  };

  const install = async (name: string, info: GroupInfo): Promise<void> => {
    const sprites = await download(name, info);
    await deps.fileLoaded;
    await Promise.all(
      Object.entries(sprites).map(async ([sprite, b64]) => {
        const asset = handles.get(sprite);
        if (!asset) return; // not in this .riv (a stale file): nothing to draw it
        const img = await deps.decode(fromBase64(b64));
        asset.setRenderImage(img as never);
        img.unref(); // the asset holds its own reference
      }),
    );
    ready.add(name);
    fetched.delete(name); // the assets hold the art now
  };

  const ensureOne = (name: string): Promise<void> => {
    const info = GROUPS[name];
    if (!info || ready.has(name)) return Promise.resolve();
    let p = loads.get(name);
    if (!p) {
      p = install(name, info).finally(() => {
        if (!ready.has(name)) loads.delete(name); // failed: a later call retries
      });
      loads.set(name, p);
    }
    return p;
  };
  const cooling = (name: string) => Date.now() - (failedAt.get(name) ?? -Infinity) < RETRY_MS;

  const groups: SpriteGroups = {
    assetLoader(asset, bytes) {
      if (!asset.isImage || bytes.length > 0) return false;
      handles.set(asset.name, asset);
      return true;
    },
    ensureGroups: (names) => Promise.all(names.map(ensureOne)).then(() => undefined),
    isReady: (name) => !GROUPS[name] || ready.has(name),
    want(names) {
      for (const n of names) {
        if (groups.isReady(n) || loads.has(n) || cooling(n)) continue;
        ensureOne(n).catch(() => {});
      }
    },
    prefetch(names) {
      idle(() => {
        for (const n of names) {
          const info = GROUPS[n];
          if (info && !ready.has(n) && !cooling(n)) download(n, info).catch(() => {});
        }
      });
    },
  };
  return groups;
}

// ---------------------------------------------------------------- the page's loader, for other features

let active: SpriteGroups | null = null;

/** main.ts installs the page's loader once the .riv is being loaded. */
export function useSpriteGroups(g: SpriteGroups): void {
  active = g;
}

/** Load these groups (e.g. ["ev-halloween"]); resolves once their art is drawable. */
export const ensureGroups = (names: readonly string[]): Promise<void> => active?.ensureGroups(names) ?? Promise.resolve();
/** Load one group; resolves once its art is drawable. */
export const needGroup = (name: string): Promise<void> => ensureGroups([name]);
/** Whether a group's art is drawable now (true for a group this build doesn't ship). */
export const groupReady = (name: string): boolean => active?.isReady(name) ?? !GROUPS[name];

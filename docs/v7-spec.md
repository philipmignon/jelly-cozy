# Jelly Tank v7: journal, colour morphs, visitors, tank share codes, lo-fi music

Philip picked these on 2026-10-02. Everything in v2–v6 still holds. Units: artboard (720×1284), positions snapped to 3.

Ownership: **art + logic agent** = `tools/gen.py` (+ `rive/`, `src/contract.json`, `src/journal-art.json`), `src/sim.ts`, `src/species.ts`, `src/helpers.ts`, `src/names.ts`, `src/camera.ts`, `src/sim.test.ts`. **music agent** = `src/audio.ts`, `src/audio.test.ts`. **host (lead)** = `src/main.ts`, `src/overlay.ts`, `src/hud.ts`, `src/gestures.ts`, new `src/journal.ts` / `src/share.ts` UI modules, `index.html`, `src/loader.html`, `tools/*.mjs`.

## 1. Jelly journal
A pixel-book overlay (host, HTML) with a page per species (9): a portrait, the species name, a real fact (host writes the facts), "first raised" date, how many you've raised, the first one's name, and whether you've seen its colour morph. Species never raised show as a dark silhouette with "???".

Logic: track per species `{ seen: boolean (ever owned at any stage), raised: number (reached adult), firstAdultAt: number | null (epoch ms), firstName: string | null, morphSeen: boolean }`. Export `journal(s): JournalEntry[]` (index = species k). Persist it in the save. A save migration fills it from the jellies currently in the tank (adults count as raised, with firstAdultAt = load time).

Art: gen.py writes `src/journal-art.json`: `{ "<k>": "data:image/png;base64,...", "<k>m": "...morph...", "<k>s": "...silhouette..." }` for k = 0..8, each the **adult, healthy (or morph) palette, frame 0, tentacles neutral**, composited (body over tentacles), at logical resolution (the host scales it up with `image-rendering: pixelated`). Trim to the art's bounds.

## 2. Colour morphs
Rarely a new jelly is a morph, a rare colourway of its species. **1 in 10** chance for babies and for bought polyps (`?fast=1` doesn't change it); the morph is fixed for life and saved per jelly (`morph: boolean`).

Morph colourways (real-world inspired where possible):
| k | species | morph |
|---|---|---|
| 0 | moon | golden moon (warm gold bell, amber clover) |
| 1 | blue blubber | midnight blubber (near-black navy, gold spots) |
| 2 | upside-down | albino (white-pink bell, pale aqua spots) |
| 3 | comb | gold comb (amber body, the comb rows still rainbow) |
| 4 | fried egg | strawberry (pink-red yolk) |
| 5 | sea nettle | pastel nettle (lavender with pale stripes) |
| 6 | crystal | sapphire crystal (blue glass, blue photophores) |
| 7 | flower hat | neon (electric tips, violet bell) |
| 8 | lion's mane | blue lion's mane (Cyanea lamarckii: blue-violet bell, pale blue mane) |

Art: a fourth palette group **`Morph`** per stage, bound to `j{s}morph` (0/1). The logic writes `j{s}healthy = 0` and `j{s}morph = 1` for a morph that's neither pale nor flushed; pale and flush still override as now. Morph art for juvenile and adult is required. For polyp and ephyra, morphs may reuse the healthy art (or have their own, if the .riv budget allows). Morph tentacles may stay the species' normal colours unless that reads wrong (lion's mane: the mane should go pale blue). A morph also gets a faint sparkle (the glow halo tinted gold/white is enough).

## 3. Visitors
Every 3–6 minutes (± randomness; never while the shop is open), one visitor appears for 30–60 s, then leaves. Tapping a visitor gives a small reward once per visit (+5 to +10 dollars, a sparkle and a pop) and it leaves a little early, happily.
- **Sea turtle**: swims slowly across the tank at mid depth (world coordinates, drawn in the World/WorldMid layers at factor 1 so taps line up), front flippers paddling (4 frames).
- **Seahorse**: drifts in and curls its tail around a kelp stalk in view, bobbing (2–4 frames), facing left or right.
- **Mini diver** (a Dave the Diver nod): a tiny pixel diver in a yellow suit on the inside of the front glass, wiping it with a sponge. Murk drops a little while it's there (4 frames, wiping).
Props per visitor: `turtleOn turtleX turtleY turtleSX turtleF0..3`, `horseOn horseX horseY horseSX horseF0..3`, `diverOn diverX diverY diverSX diverF0..3` (world coordinates). Logic: `tap()` checks visitors before jellies and returns `"visitor"`; events `visitorArrived {kind}`, `visitorTapped {kind, amount, x, y}` (x, y in world coordinates), `visitorLeft {kind}`. Export `VISITORS` names. Bigger tanks: visitors appear somewhere in the current view (so the player sees them).

## 4. Tank share code
Logic: `exportTank(s): string`, a compact, URL-safe text code of the tank (jellies with species/stage/morph/name, decor + positions, helpers, tier, dollars excluded) that fits in a message (aim ≤ 400 characters; compress by packing fields, then base64url). Also `importTank(code: string): Save | null`: validates and returns a Save for **read-only viewing** (the host shows it without persisting; a badge says whose tank it is is out of scope). Round-trips exactly; rejects garbage.

## 5. Lo-fi music
Music agent: add an optional music bed to `src/audio.ts`: `setMusic(on: boolean)`, `readonly music: boolean` (persisted in localStorage `jellytank:music`, default off), a soft lo-fi loop synthesised with Web Audio (warm Rhodes-like chords on a slow progression, a gentle bass, a soft brushed beat or none, a little vinyl crackle), ~70–80 BPM, sitting under the existing ambience, ducked a little when one-shots play. It must loop seamlessly and schedule ahead with the audio clock (no setInterval drift), stop cleanly, respect mute, and suspend with the tab.

## Host UI (lead)
Hood buttons next to the mute button: **journal** (book icon), **share** (opens a small panel: "Copy tank code" and "Visit a tank" with a paste field), **music** (note icon). A visited tank is shown read-only with a banner and a "Back to my tank" button.

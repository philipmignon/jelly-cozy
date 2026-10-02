# Jelly Tank v5: bigger tanks you swipe across

Philip chose (2026-10-01): **wider tanks with swipe-to-pan**, **two upgrades**. This extends v2–v4; everything there holds unless changed here. Units: artboard (720×1284), positions snapped to 3.

Ownership: **art** = `tools/gen.py` (+ `rive/`, `src/contract.json`). **logic** = `src/sim.ts`, `src/species.ts`, `src/helpers.ts`, `src/names.ts`, `src/sim.test.ts`. **host** = `src/main.ts`, `src/gestures.ts`, `src/overlay.ts`, `src/hud.ts`, `index.html`, `tools/*.mjs` (the lead).

## Tiers
| tier | name | world width | jellies max | price | unlocks |
|---|---|---|---|---|---|
| 0 | Small | 720 | 3 | (start) | today's tank |
| 1 | Medium | 1080 | 5 | 150 | a new stretch of reef on the right: a coral garden / seagrass meadow with its own rocks, 1 more polyp anchor at least, more sand to walk |
| 2 | Large | 1440 | 7 | 400 (needs Medium) | the far right becomes a **glowing cave**: a dark rock arch with bioluminescent dots and anemones that glow at night, plus anchors/settle spots |

## World vs screen
- The artboard stays 720×1284. The scene that pans lives in a **`World` Node whose x is bound to `camX`** (≤ 0; the camera offset, e.g. −360 shows world x 360..1080). Everything inside it uses **world coordinates** (x from 0 to 1440).
- **Fixed on screen (outside World):** the hood strip with the counter and mute button area, the cabinet with meters and buttons, the shop panel, the sponge sweep, and the screen-space overlays (night, murk, vignette, glass streaks). They cover the viewport, not the world.
- **Inside World, drawn 1440 wide:** water background, far silhouettes, fish schools, fog, mid rocks/kelp, light shafts, sand, caustics, reef/corals/chest, kelp, bubbles, snow, decor, food, jellies, ripple, helpers, sparkle fx, the pearl, algae.
- **Tank walls:** the left glass wall sits at world x 0 (as now). The **right wall is a Node whose x is bound to `wallX`** (= world width of the current tier: 720 / 1080 / 1440). The camera never shows past the wall (logic clamps camX to `[-(worldW − 720), 0]`), so scenery drawn beyond the current wall is never visible.
- **Pan hints:** `panL` / `panR` (0..1): small chevrons at the left/right edges of the water, shown when there's more tank that way (fixed on screen).

## Jelly slots
Slots grow from 3 to **7** (`j0..j6`, same per-slot props as today). More polyp anchors and settle spots in the new zones: export `polypAnchors` (≥ 7 points across the world, each tagged with the tier that makes it available) and `settleSpots` (≥ 5, tier-tagged). Helpers and decor roam/move across the whole current width; `OPEN_SAND` becomes a per-tier list of open-sand ranges.

## Shop
A fourth tab **TANK** (`tab3`, `shopTab3`, `tab3Y`) with items **11 MEDIUM TANK (150)** and **12 LARGE TANK (400)**; the large card shows `lock12` until medium is owned (a "NEEDS MEDIUM" note in the art when locked for that reason is a plus). Props `own11 own12 lock11 lock12`, triggers `buy11 buy12`. After buying, the wall slides out to the new width (logic animates `wallX` over ~1.2 s) and the camera eases to show the new space; fx sparkle.

## Input (host)
A horizontal drag on the water pans the camera (with a little inertia), unless it starts as a long-press on a decoration or jelly. Taps and long-presses convert screen → world by subtracting camX. A two-finger gesture isn't needed.

## Logic API additions
- `s.tier`, `worldW(s)`, `camX` in the view, `panBy(s, dxArtboard)`, `flingCam(s, vxArtboardPerSec)` (inertia decays in step), `camTo(s, worldX)` (ease), and `screenToWorld(s, x)` / `worldToScreen(s, x)`.
- All sim positions are world coordinates. `feed` drops flakes around the **centre of the current view** (or over the hungriest stuck jelly, as now).
- `buy(11|12)`: tier upgrades; `"needsMedium"` result for 12 before 11.
- Save v5: `tier`, `cam`. Migration from v4: tier 0, cam 0.

## Contract additions (gen.py → contract.json)
`tiers: [{ worldW, maxJellies, price }]`, `polypAnchors: [{x, y, tier}]`, `settleSpots: [{x, tier}]`, `openSand: [{x0, x1, tier}]`, `decorRange: [{x0, x1, tier}]` (or a rule), `shopCards` for 13 items + `shopTabs` for 4 tabs, plus the new props in `props`.

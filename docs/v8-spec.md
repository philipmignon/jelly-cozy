# Jelly Tank v8: hands-on feeding and scrubbing

Philip (2026-10-02): food and cleaning become **items you pick up** instead of one-shot buttons.
1. **Food**: tap Feed to pick up the food can; then tap or drag in the water to sprinkle flakes *where you want them*. Tap Feed again (or pick up the sponge) to put it down.
2. **Scrub**: tap Clean to pick up the sponge; dirty spots show on the glass, and you rub over them to clean them.

Everything in v2–v7 holds unless changed here. Units: artboard (720×1284), positions snapped to 3.

Ownership: **art + logic agent** = `tools/gen.py` (+ `rive/`, `src/contract.json`, `public/jellytank.riv`), `src/sim.ts`, `src/species.ts`, `src/helpers.ts`, `src/visitors.ts`, `src/tankcode.ts`, `src/names.ts`, `src/camera.ts`, `src/sim.test.ts`. **host (lead)** = `src/main.ts`, `src/gestures.ts`, `src/overlay.ts`, `src/hud.ts`, `src/journal.ts`, `src/share.ts`, `src/audio.ts`, `index.html`, `src/loader.html`, `tools/*.mjs`.

## Tools
- `s.tool: "none" | "food" | "sponge"`. `setTool(s, tool)`; the Feed button toggles food, Clean toggles sponge (the host calls `setTool`). The shop opening, a jelly close-up, or visiting puts the tool down.
- Buttons show it: while a tool is held, its button stays pressed (`b0y`/`b1y` = P) and glows. New props `toolFood`, `toolSponge` (0/1) drive a soft highlight/outline on the Feed/Clean button art.
- **Held-item cursor (Rive, screen space, drawn above the tank and below the hood/cabinet):** the food can (`canX canY canO`, frames `canF0` upright / `canF1` tipped and pouring, with a few falling flakes in the pouring frame) and the sponge (`spongeX spongeY spongeO`, frames `spongeF0`/`spongeF1` squished while scrubbing, with suds). The logic writes them from `setCursor(s, screenX, screenY, down: boolean, visible: boolean)` (screen = artboard units). Offset the art so the pointer sits at the can's spout / the sponge's centre. The old sweeping sponge (`wipeX`/`wipeO`) is retired: remove it from the art and the props.

## Food
- `sprinkle(s, worldX, worldY): number`: drops 1–2 flakes around the point (±12 px), clamped inside the water (below the surface, above the sand), returns how many. The flake pool grows to **16** (`food0..15`); when full, sprinkling does nothing (the host may play a soft "empty" tap). Flakes sink and get eaten as now; jellies target food as now. Earned dollars for meals stay.
- `feed(s)` stays for the demo and tests, but the buttons no longer call it.
- Rate: the host sprinkles on tap and every ~110 ms while dragging; the logic additionally caps it at ~10 flakes per second.

## Dirty spots
- The front glass gets **dirt spots**: up to **12** (`spot0..11`), each `{x, y, dirt 0..1, variant}` in **world** coordinates on the glass (anywhere in the water area of the current tier, not under the hood or below the sand line).
- New spots appear over time (one every ~90–150 s while there are fewer than 12, faster when food rots) and grow from faint to full over ~5 minutes. Food left rotting on the sand (the existing spoil rule) starts or feeds a spot near the bottom at its x instead of adding murk directly.
- **Murk is derived:** `murk = clamp(sum(dirt) / 6)`. The water bar, the murk overlay, away summaries and the snail floor keep working from it. The old algae layers (`algae0..2`) are replaced by the spots: remove them from art and props.
- `scrubAt(s, worldX, worldY, distancePx): number`: rubbing reduces the dirt of spots within ~55 px of the point in proportion to the distance moved (a spot at full dirt takes about 1.5–2 s of steady scrubbing). Returns how much dirt came off. When a spot that had dirt ≥ 0.4 reaches 0: event `spotCleaned {x, y}` (world), sparkle fx there, **+1 dollar** (an `earned` with x, y). The old `clean()` sweep and its +3 stay only for the demo/tests.
- Snail: heads for the dirtiest spot and cleans it slowly while it sits on it (it's what keeps the tank "lightly cloudy" now). The diver visitor cleans spots near it. Time away: spots appear and grow as if time passed (capped), and the snail cleans during it.
- View per spot: `spot{i}x spot{i}y` (world), `spot{i}o` (opacity = a curve of dirt, so faint spots still read), and variant frames `spot{i}v0..2` (one-hot: three shapes of grime: a green algae bloom, a brown smear, a speckle cluster). Art: draw them as pixel art in the WorldGlass layer (with the snail), each ~30–45 logical px, organic and readable; they should look like something you want to wipe off.
- Save version bump: spots saved; older saves start with a few spots matching their murk.

## Tests (logic)
Sprinkle places flakes where asked, clamps, and respects the pool and rate cap; tools toggle and drop when the shop opens; murk follows the spots; scrubbing clears a spot in ~1.5–2 s of motion, pays +1 once, fires `spotCleaned`; spots spawn and grow and cap at 12; rotting food feeds a spot near its x; the snail and diver clean; away time; save migration; the view writes exactly `K.props`.

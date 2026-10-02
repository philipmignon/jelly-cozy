# Jelly Tank v2: growth, species, shop

Decided with Philip (2026-10-01): **the tank holds up to 3 jellies**; **care earns sand dollars, spent in a shop** on new polyps and decorations.

This file is the contract between the art (`tools/gen.py` → `rive/tank.rml`, `src/contract.json`) and the logic (`src/sim.ts`). Names here are final; if one side needs a change, raise it, don't drift.

## Units
Artboard 720×1284, logical 240×428, P=3. Everything the host writes is in **artboard units**, positions snapped to multiples of 3. Opacity props are 0..1. "One-hot" means exactly one of the group is 1 and the rest are 0.

## Species (k)
| k | id | name in shop | look | movement |
|---|---|---|---|---|
| 0 | moon | (starter, not sold) | existing pink moon jelly | drifting pulses (current behaviour) |
| 1 | blubber | BLUE BLUBBER | chunky deep blue/indigo bell with a white rim and lighter spots; 8 short, thick, frilly oral arms (cauliflower-like, blue/white); no thin tentacles | faster, punchier pulses; a bit restless |
| 2 | upside | UPSIDE-DOWN | Cassiopea: once settled, a flat olive/khaki bell **lying on the sand, bell down**, with branching frilly arms waving **upward**, white/blue spots, pale green tips | ephyra swims; **juvenile and adult settle on the sand** at a home spot and pulse slowly in place; they eat food that lands within reach |
| 3 | comb | COMB JELLY | ctenophore: clear oval/egg body (glassy, faint), **8 comb rows of rainbow pixels that shimmer**, two long fine trailing tentacles | **no pulse**: glides slowly and smoothly; the shimmer cycles continuously |

## Stages (g)
| g | stage | art | behaviour |
|---|---|---|---|
| 0 | polyp | small stalk (~10×18 logical) with a crown of tiny tentacles, tinted per species; sways | **fixed** to a rock anchor; eats food within reach; food within ~120 px drifts gently toward it |
| 1 | ephyra | tiny 8-armed star (~16 logical across), tinted per species | twitchy, quick little pulses; swims |
| 2 | juvenile | the species' adult art at ~0.6 size (drawn at that size, not scaled) | species movement |
| 3 | adult | full size | species movement |

Growth points, cumulative thresholds: ephyra **4**, juvenile **12**, adult **30**. +1 per meal eaten; +1 per 60 s of good care (that jelly's fullness > 0.3 and tank murk < 0.6); time away accrues good-care points capped at 8 per absence. `?fast=1` in the URL multiplies growth ×20 (debug).

## Economy
Sand dollars (`dollars`). Earn: meal +1; clean when murk > 0.3 +3; pet +1 (20 s cooldown per jelly); reaching ephyra/juvenile +5 each; reaching adult +20. New save starts with **one moon polyp and 0 dollars**. A v1 save migrates to **one adult moon jelly**, keeping its fullness/affection/murk/night, and 10 dollars as a welcome gift.

## Shop items (i)
| i | item | price | kind | notes |
|---|---|---|---|---|
| 0 | BLUE BLUBBER polyp | 40 | polyp k=1 | locked when the tank already has 3 jellies |
| 1 | UPSIDE-DOWN polyp | 70 | polyp k=2 | same |
| 2 | COMB JELLY polyp | 110 | polyp k=3 | same |
| 3 | CASTLE | 25 | decor 0 | |
| 4 | ANCHOR | 20 | decor 1 | |
| 5 | DIVE HELMET | 35 | decor 2 | a little homage: brass diving helmet half-buried |
| 6 | GIANT CLAM | 30 | decor 3 | opens and closes slowly (Rive timeline); a pearl inside |
| 7 | GLOW CORAL | 45 | decor 4 | mushroom coral that glows at night |
Decorations are bought once and appear at fixed spots the art chooses. Polyps can be bought repeatedly while there's room.

## View model (`Tank`) — numbers the host writes
Global (existing, unchanged): `nightShade daylight sunO moonO murkShade algae0 algae1 algae2 food{i}x food{i}y food{i}o (i<10) rx ry rs ro wipeX wipeO barFood barWater barMood b0y b1y b2y`.
- Meters now mean: `barFood` = the **hungriest** jelly's fullness, `barWater` = 1 − murk, `barMood` = average mood.
- New 4th cabinet button: `b3y` (press offset, like the others).

Per jelly slot s ∈ {0,1,2}:
- `j{s}on` — slot visible (0/1)
- `j{s}x`, `j{s}y` — slot origin. Origin convention: **swimmers** = centre of the bell rim (as now); **polyp** = base of the stalk on the rock; **settled upside-down** = centre of the bell's underside resting on the sand; **comb** = centre of the body.
- `j{s}k0..k3` — species one-hot
- `j{s}g0..g3` — stage one-hot
- `j{s}bf0..bf3` — body frame one-hot (pulse frames for jellies; sway frames for polyps; comb-row shimmer phase for comb)
- `j{s}tf0..tf3` — tentacle/arm frame one-hot
- `j{s}healthy`, `j{s}pale`, `j{s}flush` — palette layers (as now; flush is drawn over the others)
- `j{s}glow` — soft halo (screen blend), as now

Effects: `fxX fxY fxS fxO` — a sparkle burst (growth, purchase), positioned/scaled/faded by the host like the ripple.

Sand dollars counter (in the hood strip, top of the screen): `cd0..cd3` digit positions (0 = ones), each with one-hot glyphs `cd{p}n0..cd{p}n9`; leading zeros hidden (all glyphs 0 for that position). Max 9999.

Shop:
- `shopY` — y of the shop panel Node. Closed = 1500 (off the artboard, so its listeners can't be hit); open = 0. The host slides it.
- `own{i}` (i<8) — "owned" badge (decor already bought). `lock{i}` — dim/locked overlay (can't afford, tank full for polyps, or owned decor).

Triggers (one per button): `feed clean lamp` (existing), `shop` (4th cabinet button), `shopClose`, `buy0..buy7`.

## Fixed points the logic needs (art must match; gen.py exports them in contract.json)
- `polypAnchors`: 3 rock-top points, artboard units, base of stalk: approximately (90,933), (156,966), (666,969). Gen.py exports the exact values under `contract.polypAnchors`.
- `settleSpots`: 3 sand x positions for settled upside-down jellies: x ≈ 240, 384, 570 (y = sandTop at that x).
- `bodies[k][g]`: `{ "halfW": n, "top": n, "reach": n }` per species and stage, artboard units, relative to the slot origin: half body width, how far the body extends above the origin (positive number), how far tentacles reach below (positive). The sim uses these for hit tests, catch zones and bounds.
- `shopOpenY` / `shopClosedY`: 0 / 1500.

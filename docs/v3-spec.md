# Jelly Tank v3: helpers, names, babies, daily pearl, arranging decor

Philip asked for all five (2026-10-01). This extends `docs/v2-spec.md`; everything there still holds unless changed here. Units: artboard (720×1284), positions snapped to 3, opacity 0..1, one-hot = exactly one is 1.

Ownership: **art** = `tools/gen.py` (+ generated `rive/`, `src/contract.json`). **logic** = `src/sim.ts`, `src/species.ts`, `src/sim.test.ts`. **host** = `src/main.ts`, `index.html`, `tools/e2e.mjs`, `tools/page.mjs` (the lead). Don't edit another side's files.

## 1. Tank helpers (shop tab "HELPERS")
Bought once each, then live in the tank permanently.

| i | item | price | job |
|---|---|---|---|
| 8 | SNAIL | 30 | crawls slowly over the front glass (anywhere in the water area, drawn in front of jellies and behind the glass streaks), heading toward algae; while owned, murk rises ~40% slower and the algae level it sits on clears faster |
| 9 | CLEANER SHRIMP | 40 | walks along the sand; goes to food resting on the sand and eats it (no fullness for jellies, but it never turns into murk) |
| 10 | HERMIT CRAB | 50 | wanders the sand slowly; every 4–8 minutes it stops and digs, then turns up a sand dollar: +5 dollars with a sparkle |

View props (art binds, logic writes):
- Snail: `snailOn snailX snailY snailSX` (scaleX ±1, faces travel direction; art faces right at +1), crawl frames `snailF0 snailF1`. Origin = centre of the shell.
- Shrimp: `shrimpOn shrimpX shrimpY shrimpSX`, frames `shrimpF0..shrimpF3` (0-1 walk, 2-3 pick/eat). Origin = bottom-centre, standing on the sand.
- Crab: `crabOn crabX crabY crabSX`, frames `crabF0..crabF3` (0-1 walk, 2-3 dig). Origin = bottom-centre on the sand.
- Shop: items 8–10 get `own8..own10`, `lock8..lock10`, triggers `buy8..buy10`.

## 2. Shop tabs
The shop now has three tabs: **JELLIES** (items 0–2), **DECOR** (3–7), **HELPERS** (8–10). Tab buttons fire triggers `tab0 tab1 tab2`. Props: `shopTab0..shopTab2` (one-hot, the highlighted tab button) and `tab0Y tab1Y tab2Y`: the y offset of each tab's card group, **0 when active, 3000 when inactive** (moved away, not faded, so hidden cards can't be clicked). The logic opens the shop on tab 0.

## 3. Arranging decorations
Long-press an owned decoration (host gesture: ~450 ms without moving more than 12 px), drag it along the sand, release to drop. The decoration follows the finger's x; its y follows the sand top. Props `dec{n}x`, `dec{n}y` (n<5) bind the decoration Node's x and y (origin = bottom-centre of the art, on the sand). The default positions are where gen.py places them today. A lifted decoration gets `dec{n}lift` = 1 (art: draw it raised 6 px with a soft shadow under it, or a subtle outline; 0 = resting).

## 4. Names and the jelly card (host-drawn HTML overlay, no art)
Every jelly gets a name when it's born (random from a cozy list; the logic owns the list). Long-press a jelly to open its card: name (editable, max 12 characters), species, stage, age in days, fullness and happiness bars. A normal tap still pets, and petting shows the name as a little tag above the jelly for ~1.5 s (host overlay). The card is HTML styled like the game (cream panel, dark wood border, a pixel font).

## 5. Jelly babies
An **adult** whose mood stays above 0.7 builds up "content time". Every 10 minutes of it (scaled by the growth multiplier), if the tank has a free slot and a free polyp anchor, it releases a polyp **of its own species** at a free anchor: sparkle, event `baby`. If the tank is full, the timer just holds at 10 minutes until there is room.

## 6. Daily pearl
While the giant clam (decor 3) is owned, a pearl appears in it once per local calendar day. Tap it to collect: +15 dollars, sparkle, event `pearl`. Prop `pearl` (0/1) shows it. The pearl Node is a child of the clam's Node, so it follows the clam when the clam is moved. It should have a soft glow so it reads as tappable even when the clam is mid-close.

## Contract additions (gen.py → contract.json)
- `decor[n] = { name, x, y, w, h }`: default base point (bottom-centre, artboard) and the hit-box size (box spans x−w/2..x+w/2, y−h..y).
- `pearl = { dx, dy, r }`: the pearl centre relative to the clam's base point, plus a tap radius.
- `shopCards[i]` for all 11 items: the card rect when its tab is active. `shopTabs[t]` tab-button rects. `shopClose` (as now).
- `helpers`: the y of the sand walk line for shrimp/crab isn't needed (they use `sandTop`), but export `snailSize {w,h}`, `shrimpSize`, `crabSize` for hit tests.
- `props` lists every numeric prop (as now).

## Logic API additions
- `tap(s, x, y)` returns `"pearl" | "pet" | "call" | null`; the pearl is checked first.
- `jellyAt(s, x, y): number` (slot, or −1). `decorAt(s, x, y): number` (owned decor index, or −1).
- `liftDecor(s, n)`, `moveDecor(s, n, x)` (clamps inside the glass; y = sand top under it), `dropDecor(s)`.
- `jellyInfo(s, slot): { name, k, g, ageDays, fullness, mood } | null`, `renameJelly(s, slot, name)` (trimmed, 1–12 characters, otherwise ignored).
- `setTab(s, t)`.
- `buy(s, i)` handles 8–10 (`"owned"` if already bought).
- Events from `step()`: add `baby` (slot), `dug` (amount), `shrimpAte`, `pearlReady` (once, when a new day's pearl appears).
- Time: the sim keeps its own wall clock (`s.clock`, epoch ms) advanced by dt from the save's time, so "today" comes from `new Date(s.clock)` in local time.
- **Save v3**: adds per jelly `name`, `born` (epoch ms), `content` (seconds); tank-wide `helpers: boolean[3]`, `decorX: number[5]`, `pearlDay: string` (YYYY-MM-DD of the last collect). v2 → v3 migration: names assigned, `born` = now, default decor x, no helpers, pearl available today.

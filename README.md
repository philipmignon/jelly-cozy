# Jelly Tank

A pixel-art jellyfish aquarium for the web (this repo: jelly-cozy). Live at https://philipmignon.github.io/jelly-cozy/.

`tools/gen.py` draws the art in code: it paints every sprite pixel by pixel and writes a Rive RML file, which the Rive CLI compiles to `public/jellytank.riv`. A TypeScript host (`src/`) runs the simulation and drives the Rive view model through the Rive web runtime (`@rive-app/webgl2`).

## The game

- **Growth.** Every jelly starts as a polyp on a rock and grows through ephyra and juvenile to adult. A jelly grows while it's fed, its glass is clean and it gets some attention. It keeps growing while you're away, up to a cap, and a note tells you what changed.
- **Species.** Nine kinds: moon, blue blubber, upside-down, comb, fried egg, sea nettle, crystal, flower hat and lion's mane. Each has its own swim, size and favourite food. Some need the medium or large tank. A jelly may be born in a rare colour.
- **Care.** Pick up the food can on the shelf and tap or drag in the water to sprinkle flakes where you want them. The sponge scrubs dirty spots off the glass. Tap a jelly to pet it, hold it to open its card (name, age, mood, rename, rehome). The tank follows the local time of day, and the light switch changes it early.
- **Shop.** Caring earns sand dollars. They buy polyps, decorations (move them with a long press), helpers (a snail that grazes the glass, a cleaner shrimp, a hermit crab that digs up dollars), two more foods (brine shrimp, plankton), bigger tanks to pan around, and themes (Reef, Kelp Forest, Coral Garden, Arctic).
- **Visitors and the pearl.** A turtle, a seahorse or a diver drops by now and then, and the giant clam grows a pearl each day. Tap either for dollars.
- **Personalities.** Shy jellies hide by the rocks, curious ones come to see what you're holding, sleepy ones pulse slowly and turn in early, and social ones swim with friends.
- **The bubbler.** This decoration sends up a column of bubbles. Jellies and food that drift into it ride to the top.
- **Daily requests.** One or two small jobs a day (feed a species its favourite, scrub spots, tap a visitor...), paid once each.
- **Journal and keepsakes.** The journal records the nine species and their colour morphs. Six milestones (first adult, three kinds, a rare colour, seven days, ten requests, all nine kinds) each give a keepsake the shop doesn't sell: five decorations and the Moonlit Lagoon theme.
- **Seasons.** From 1 October to 2 November the tank gets Halloween decor and a bat visitor, and a jelly born then may come out ghost-pale. The "Seasonal decor" setting turns it off; `?season=halloween` or `?season=none` forces it either way for testing.
- **Photo mode.** "Take a photo" in the settings menu saves a PNG of the glass with a dated caption.
- **Saves and sharing.** Your browser keeps the save. The settings menu can back up and restore a save, and "Share your tank" makes a code that opens a read-only visit of your tank. The synced copy of the page (`pub/jellytank-sync.html`, for a host that provides a shared database and a signed-in user) adds cloud saves across devices, live codes that show a friend's tank as it is now, and a daily gift (a snack or a shell) for friends you visit.
- **Offline.** The GitHub Pages build installs a service worker, so after the first visit the tank opens at once and plays offline. A tank left open shows an "Updated" chip when a new deploy lands.
- **Keyboard and accessibility.** Tab, the arrow keys and Enter move around the tank and press things; F feed, S scrub, L light, B shop, J journal, N card, 1-4 the shelf, [ and ] pan, M mute. Live regions tell a screen reader what happens. "Reduce motion" (or the OS setting) makes the camera jump instead of gliding, snaps the close-up and the shop, and calms the bells' pulse.
- **Battery.** Once the tank has been quiet for a few seconds it draws 30 frames a second instead of every display frame, and a hidden tab draws nothing and suspends the sound. "Battery saver" in the settings keeps the lower rate all the time.

URL options for development: `?fast=1` grows jellies 20 times faster, `?demo=1` opens a demo tank that never touches the real save.

## Run it

```sh
npm install
npm run dev      # play locally
npm run build    # type-check + production build into dist/
```

## Test

```sh
npx tsc --noEmit
npm test         # unit tests (vitest): the sim, saves, requests, keepsakes, sharing, audio, pacing...
```

The browser checks drive headless Chrome (puppeteer-core with the installed Chrome). Each takes its port from an environment variable, so several can run side by side:

| Command | What it checks | Port |
| --- | --- | --- |
| `node tools/e2e.mjs` (`npm run e2e`) | clicks through the dev build: buttons, tools, shop, cards, keyboard play, keepsakes, sharing and gifts, battery pacing | `E2E_PORT` (5198) |
| `node tools/offline.mjs` | the Pages build's service worker: repeat visits, offline play, the update chip | `OFFLINE_PORT` (5197) |
| `node tools/phones.mjs` | screenshots at common phone and tablet sizes into `shots/` | `PHONES_PORT` (5195) |
| `node tools/loadtime.mjs` | time to first frame over fast and slow 4G, for a new and a full tank, with and without the Halloween art; `LOAD_MODE=pages` serves it the way GitHub Pages does | `LOAD_PORT` (5196) |
| `node tools/battery.mjs` | CPU time and frame rate of an idle, a busy and a hidden tank, at full speed and with 4x CPU throttling | `BATTERY_PORT` (5199) |

All but `e2e.mjs` test the built files: run `npm run build && node tools/page.mjs` first.

## Redraw the art

Needs Python 3 and the Rive CLI (`~/.rive/bin/rive`, or set `RIVE`).

```sh
npm run riv:build   # gen.py -> rive/tank.rml + rive/img -> public/jellytank.riv + public/sprites/*.json
npm run riv:shot    # the same, plus a screenshot of the artboard
```

`tools/gen.py` also writes the art/logic contract (`src/contract.json`: view-model props, button rects, layout), which the sim reads. Each species' jelly sprites (and each event's, e.g. the `hw_` Halloween art) are left out of the `.riv` as referenced assets and packed into one file per group in `public/sprites/`. The host fetches a group when the tank needs it (`src/spritegroups.ts`). Commit the regenerated `.riv`, `public/sprites/` and `src/*.json` together.

## Deploy

`.github/workflows/pages.yml` runs the unit tests, builds `dist/` and deploys it to GitHub Pages on every push to `main`, once the repo variable `PAGES_ENABLED` is `true` (Settings → Pages → Source: GitHub Actions); it can also be run by hand from the Actions tab. CI runs no Python or Rive CLI, so the generated files above must be committed.

`vite build` writes `dist/sw.js` from `src/sw.js` with the build's file list, and `src/offline.ts` registers it once the tank is on screen. Only `index.html` opts in (`<meta name="jellytank-sw">`), so the single-file pages and the dev server never run a service worker. The page is network-first, so a deploy shows up on the next load.

`node tools/page.mjs` builds the single-file pages from `dist/`: `pub/jellytank.html` (the `.riv` inlined) and `pub/jellytank-sync.html` (the synced copy), and prints the map of files to publish beside them.

## Layout

- `tools/gen.py`: sprites, layout and the contract (`src/contract.json`)
- `src/sim.ts`: game rules, pure and tested; `view()` writes exactly the contract's props. Helpers, visitors, dirt, motion, traits, requests and keepsakes have modules of their own (`src/helpers.ts`, `visitors.ts`, `dirt.ts`, `motion.ts`, `traits.ts`, `requests.ts`, `keepsakes.ts`); species data is in `src/species.ts`
- `src/main.ts`: host wiring for Rive, gestures, audio, saves and overlays
- `src/pace.ts`: frame pacing (the calm rate, the battery saver, hidden tabs)
- `src/audio.ts`: synthesised sound and music (Web Audio, no sound files)
- `src/keyboard.ts`, `src/a11y.ts`: keyboard play, the screen reader's live regions, and the reduce-motion setting
- `src/hud.ts`, `src/overlay.ts`, `src/journal.ts`, `src/requestnote.ts`, `src/keepnote.ts`: the HTML over the canvas (settings menu, cards and notes, journal)
- `src/share.ts`, `src/tankcode.ts`, `src/cloud.ts`, `src/friends.ts`: share codes, backups, cloud saves, live tanks and gifts
- `src/season.ts`, `src/photo.ts`, `src/spritegroups.ts`: seasons, photo mode, on-demand sprite groups
- `src/sw.js`, `src/offline.ts`: the Pages service worker and its registration
- `tools/`: the browser checks above, and `page.mjs`
- `docs/`: feature specs from earlier versions

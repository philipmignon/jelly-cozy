# Jelly Tank

A pixel-art jellyfish aquarium for the web (this repo: jelly-cozy). Live at https://philipmignon.github.io/jelly-cozy/.

`tools/gen.py` draws the art in code: it paints every sprite pixel by pixel and writes a Rive RML file, which the Rive CLI compiles to `public/jellytank.riv`. A TypeScript host (`src/`) runs the simulation and drives the Rive view model through the Rive web runtime (`@rive-app/webgl2`).

## The game

- **Growth.** Every jelly starts as a polyp on a rock and grows through ephyra and juvenile to adult. A jelly grows while it's fed, its glass is clean and it gets some attention. It keeps growing while you're away, up to a cap, and a note tells you what changed.
- **Species.** Nine kinds: moon, blue blubber, upside-down, comb, fried egg, sea nettle, crystal, flower hat and lion's mane. Each has its own swim, size and favourite food. Some need the medium or large tank. A jelly may be born in a rare colour.
- **Care.** Pick up the food can on the shelf and tap or drag in the water to sprinkle flakes where you want them. The sponge scrubs dirty spots off the glass. Tap a jelly to pet it, hold it to open its card (name, age, mood, rename, rehome). The tank follows the local time of day, and the light switch changes it early.
- **Shop.** Caring earns sand dollars. They buy polyps, decorations (move them with a long press; drop one on the drawer that slides up from the cabinet to put it away, and tap its shop card to bring it back), helpers (a snail that grazes the glass, a cleaner shrimp, a hermit crab that digs up dollars), two more foods (brine shrimp, plankton), bigger tanks to pan around, and themes (Reef, Kelp Forest, Coral Garden, Arctic).
- **Visitors and the pearl.** A turtle, a seahorse or a diver drops by now and then, and the giant clam grows a pearl each day. Tap either for dollars.
- **Night visitors.** Late at night an octopus may peek over a rock, a manta ray's shadow may glide overhead, or a hermit crab may walk in and move into the dive helmet. They leave when the light comes on. The journal's Visitors page logs every kind you've seen, with a count and the date of the first sighting.
- **Personalities.** Shy jellies hide by the rocks, curious ones come to see what you're holding, sleepy ones pulse slowly and turn in early, and social ones swim with friends.
- **The bubbler.** This decoration sends up a column of bubbles. Jellies and food that drift into it ride to the top.
- **Daily requests.** One or two small jobs a day (feed a species its favourite, scrub spots, tap a visitor...), paid once each.
- **Journal and keepsakes.** The journal records the nine species and their colour morphs. Six milestones (first adult, three kinds, a rare colour, seven days, ten requests, all nine kinds) each give a keepsake the shop doesn't sell: five decorations and the Moonlit Lagoon theme.
- **Seasons.** From 1 October to 2 November the tank gets Halloween decor and a bat visitor, and a jelly born then may come out ghost-pale. The "Seasonal decor" setting turns it off; `?season=halloween` or `?season=none` forces it either way for testing.
- **Photo mode and the album.** "Take a photo" in the settings menu saves a PNG of the glass with a dated caption. The journal's Album page keeps the last 12 (in this browser's IndexedDB), to view, save again or delete.
- **The room.** On a wide screen the tank stands in a cozy room: a window whose sky follows the time of day and the season, and a lamp that follows the tank's light switch (click it to flip both). Phones never download it.
- **Saves and sharing.** Your browser keeps the save, and time with the tab hidden counts the same as time away. The settings menu can back up and restore a save, and "Share your tank" makes a code that opens a read-only snapshot of your tank.
- **Offline.** The GitHub Pages build installs a service worker, so after the first visit the tank opens at once and plays offline. A tank left open shows an "Updated" chip when a new deploy lands.
- **Keyboard and accessibility.** Tab, the arrow keys and Enter move around the tank and press things; F feed, S scrub, L light, B shop, J journal, N card, 1-4 the shelf, [ and ] pan, M mute. Live regions tell a screen reader what happens. "Reduce motion" (or the OS setting) makes the camera jump instead of gliding, snaps the close-up and the shop, calms the bells' pulse, and stills the water itself: the caustics, light shafts, bell sheen and parallax.
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

The browser checks drive headless Chrome (puppeteer-core with the installed Chrome). They test the built files in `dist/`, served the way GitHub Pages serves them. Each takes its port from an environment variable, so several can run side by side:

| Command | What it checks | Port |
| --- | --- | --- |
| `npm run e2e` (`node tools/e2e.mjs`) | real presses on the tank, flow by flow: buttons, tools, the shop, cards, decor and the drawer, keyboard play, the journal, keepsakes, the album, share and backup codes, the room, seasons and night visitors, a hidden tab catching up, battery pacing | `E2E_PORT` (5198) |
| `node tools/offline.mjs` | the Pages build's service worker: repeat visits, offline play, the update chip | `OFFLINE_PORT` (5197) |
| `node tools/phones.mjs` | screenshots at common phone and tablet sizes into `shots/`; fails if a phone fetches the room or the settings menu runs off the screen | `PHONES_PORT` (5195) |
| `node tools/loadtime.mjs` | time to first frame over fast and slow 4G, for a new and a full tank, with and without the Halloween art | `LOAD_PORT` (5196) |
| `node tools/battery.mjs` | CPU time and frame rate of an idle, a busy and a hidden tank, at full speed and with 4x CPU throttling | `BATTERY_PORT` (5199) |

`npm run e2e` rebuilds `dist/` first when the sources are newer; the others need `npm run build` first.

### The e2e flows

Each file in `tools/e2e/flows/` is one flow: it opens the tank in a fresh browser context with a save of its own, drives it, and reports its own checks. A flow that throws fails alone. The runner (`tools/e2e.mjs`) runs several flows at once, retries a failed one on a fresh browser, and prints a table. A flow that passes on the retry is FLAKY: the run still exits 0 and names it in a warning. A flow that fails twice fails the run. The runner writes the whole run to `shots/e2e-report.json` and the screenshots to `shots/e2e-*.png`.

```sh
npm run e2e                    # every flow, on this machine's GPU
npm run e2e -- shop keyboard   # just these
npm run e2e:ci                 # what CI runs after `npm run build`: software GL, no build
```

| Variable | Default | |
| --- | --- | --- |
| `E2E_PORT` | 5198 | the static server's port (0 picks a free one) |
| `E2E_WORKERS` | half the CPUs, at most 4 | flows at once, one browser each |
| `E2E_GPU` | the machine's GPU; `swiftshader` when `CI` is set | `swiftshader` for software GL |
| `E2E_BUILD` | rebuild when stale; never in CI | `1` always rebuilds, `0` never does |
| `E2E_FLOW_TIMEOUT` | 150000 (300000 with software GL) | ms one attempt may take |
| `E2E_RETRIES` | 1 | retries for a failed flow |
| `E2E_FLOWS` | all | a comma-separated list of flows |
| `E2E_CHROME` | the installed Google Chrome | a Chrome binary to drive instead |
| `E2E_STATE` | off | `1` writes the tank's state beside each screenshot (`shots/e2e-*.json`) |

The flows drive the tank through a test API, `window.__jt` (`src/testapi.ts`). It loads only when the URL asks for test mode, as a separate chunk that players never download:

- `?test=1` turns it on.
- `?seed=N` seeds every random stream the sim uses (and turns on test mode).
- `?clock=virtual` stops the frame loop: frames come only when the test calls `__jt.advance(ms)`, in fixed steps, and `Date.now()` moves with them. Run the same steps from the same save and you get the same pixels. `?now=` sets where that clock starts.

`__jt` has `ready()`, `idle()`, `advance(ms)`, `frames(n)`, `setTime(ms)`, `passTime(ms)`, `seed(n)`, `place(slot, x, y)`, `spawnVisitor(kind)`, `setNight(on)`, `setSeason(id)`, `addSpot(x, y)`, `spotDirt(i)`, `loadSave(save)`, `state()` and `toClient(x, y)`; `src/testapi.ts` documents each. Most flows run on the virtual clock. The hidden-tab and battery flows run on the real one, since frame timing is what they test.

## Redraw the art

Needs Python 3 and the Rive CLI (`~/.rive/bin/rive`, or set `RIVE`).

```sh
npm run riv:build   # gen.py -> rive/tank.rml + rive/img -> public/jellytank.riv + public/sprites/*.json
npm run riv:shot    # the same, plus a screenshot of the artboard
```

`tools/gen.py` also writes the art/logic contract (`src/contract.json`: view-model props, button rects, layout), which the sim reads. Each species' jelly sprites (and each event's, e.g. the `hw_` Halloween art) are left out of the `.riv` as referenced assets and packed into one file per group in `public/sprites/`. The host fetches a group when the tank needs it (`src/spritegroups.ts`). Commit the regenerated `.riv`, `public/sprites/` and `src/*.json` together.

## Deploy

GitHub Pages is the game's only home. `.github/workflows/pages.yml` builds `dist/` and deploys it after the Test workflow passes on a push to `main`, once the repo variable `PAGES_ENABLED` is `true` (Settings → Pages → Source: GitHub Actions). You can also start it by hand from the Actions tab; it runs the tests first. CI runs no Python or Rive CLI, so commit the generated files above.

`vite build` writes `dist/sw.js` from `src/sw.js` with the build's file list, and `src/offline.ts` registers it once the tank is on screen (`index.html` opts in with `<meta name="jellytank-sw">`; the dev server never runs it). The page is network-first, so a deploy shows up on the next load. The room's code and art are listed for the worker to cache as they load, not up front, so a phone never fetches them.

## Safety net

`.github/workflows/test.yml` runs on every push and pull request: the merge guard, `tsc`, the unit tests, the build, the byte budgets, then `e2e`, `offline` and `phones` in headless Chrome (SwiftShader for WebGL). A failed run uploads `shots/`; every run uploads `shots/e2e-report.json`. Pages deploys `main` only after it passes.

```sh
npm run guard          # conflict markers, sources emptied or cut by more than 40%, sprite groups that don't match src/contract.json
npm run hooks          # opt-in: a pre-commit hook that runs the guard on what you stage (-- --force replaces another hook)
npm run budget:bytes   # dist/ sizes against tools/budgets.json (CI runs this)
npm run budget         # bytes plus load time and battery on this machine (local only)
npm run test:explore   # the property tests with random seeds, ten times as many runs
```

The guard compares with the merge base of `origin/main` (`--base <ref>` for another). To cut a file on purpose, list it in `tools/guard-allow.txt` or put `Guard-Allow-Shrink: <path>` in the commit message.

`tools/budgets.json` holds the budgets and their tolerances: 10% on bytes, 15% on load time, 25% on an idle tank's CPU (it swung that much between runs here). An idle tank must draw 30 fps, give or take 15%, and a hidden one nothing. Load time and CPU numbers depend on the machine, so reseed them on yours with `node tools/budget.mjs --perf --seed` before you rely on them, and note the machine's load in the commit.

The property tests (`src/*.prop.test.ts`, fast-check) run with a fixed seed so CI gives the same answer every time; `FC_SEED=<n>` replays a failure. `src/clock.test.ts` checks night, Halloween, the daily turnover and time away in seven time zones, across their 2026 DST changes.

## Layout

- `tools/gen.py`: sprites, layout and the contract (`src/contract.json`)
- `src/sim.ts`: game rules, pure and tested; `view()` writes exactly the contract's props. Helpers, visitors, dirt, motion, traits, requests and keepsakes have modules of their own (`src/helpers.ts`, `visitors.ts`, `dirt.ts`, `motion.ts`, `traits.ts`, `requests.ts`, `keepsakes.ts`); species data is in `src/species.ts`
- `src/main.ts`: host wiring for Rive, gestures, audio, saves and overlays
- `src/pace.ts`: frame pacing (the calm rate, the battery saver, hidden tabs)
- `src/audio.ts`: synthesised sound and music (Web Audio, no sound files)
- `src/keyboard.ts`, `src/a11y.ts`: keyboard play, the screen reader's live regions, and the reduce-motion setting
- `src/hud.ts`, `src/overlay.ts`, `src/journal.ts`, `src/requestnote.ts`, `src/keepnote.ts`: the HTML over the canvas (settings menu, cards and notes, journal)
- `src/visitlog.ts`, `src/album.ts`, `src/albumpage.ts`: the journal's Visitors and Album pages
- `src/roomfit.ts`, `src/room.ts`: the room on wide screens (`roomfit.ts` decides; `room.ts` and `public/sprites/room.json` load only then)
- `src/share.ts`, `src/tankcode.ts`: share codes and save backups
- `src/season.ts`, `src/photo.ts`, `src/spritegroups.ts`: seasons, photo mode, on-demand sprite groups
- `src/sw.js`, `src/offline.ts`: the Pages service worker and its registration
- `tools/`: the browser checks above (`tools/e2e/`: the e2e flows and their shared helpers), the merge guard (`guard.mjs`) and the budgets (`budget.mjs`, `budgets.json`)
- `src/testmode.ts`, `src/testapi.ts`: test mode and `window.__jt` (loaded only with `?test=1`, `?seed=` or `?clock=virtual`)
- `docs/`: feature specs from earlier versions

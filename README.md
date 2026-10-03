# Jelly Cozy

A cozy pixel-art aquarium for the web. Raise jellyfish from polyps, feed them by sprinkling food where you want it, scrub the glass, buy decor and helpers with sand dollars, and fill a journal with nine species and their colour morphs.

The art is drawn in code: `tools/gen.py` paints every sprite pixel by pixel and writes a Rive RML file, which the Rive CLI compiles to `public/jellytank.riv`. A TypeScript host (`src/`) runs the simulation and drives the Rive view model.

## Run it

```sh
npm install
npm run dev      # play locally
npm test         # unit tests (vitest)
npm run build    # type-check + production build
```

## Redraw the art

Needs Python 3 and the Rive CLI (`~/.rive/bin/rive`, or set `RIVE`).

```sh
npm run riv:build   # gen.py -> rive/tank.rml + rive/img -> public/jellytank.riv + public/sprites/*.json
```

Each species' jelly sprites (and each event's, e.g. `hw_` Halloween art) are left out of the `.riv` as referenced assets and packed into one file per group in `public/sprites/`. The host fetches a group when a jelly of that species is in the tank (`src/spritegroups.ts`; other code can call `needGroup` / `ensureGroups`). Commit the regenerated `.riv`, `public/sprites/` and `src/*.json` together.

## Deploy

`.github/workflows/pages.yml` builds `dist/` and deploys it to GitHub Pages on every push to `main`. CI runs no Python or Rive CLI, so the generated files above must be committed. Pages has to be enabled in the repo settings (Source: GitHub Actions); on a private repo that needs a paid plan.

The Pages build plays offline and opens instantly on repeat visits: `vite build` writes `dist/sw.js` from `src/sw.js` with the build's file list, and `src/offline.ts` registers it once the tank is on screen. Only `index.html` opts in (`<meta name="jellytank-sw">`), so the claude.ai pages and the dev server never run a service worker. The page itself is network-first, so a deploy shows up on the next load; a tank left open gets a small "Updated / Reload" chip. `node tools/offline.mjs` checks all of this end to end (after `npm run build && node tools/page.mjs`).

## Layout

- `tools/gen.py`: sprites, layout and the art/logic contract (`src/contract.json`)
- `src/sim.ts`: game rules, pure and tested; `view()` writes exactly the contract's props
- `src/main.ts`: host wiring for Rive, gestures, audio, saves and overlays
- `src/keyboard.ts`, `src/a11y.ts`: keyboard play (Tab/arrows/Enter on the tank; F feed, S scrub, L light, B shop, J journal, N card, 1-4 shelf, [ ] pan), the screen reader's live regions, and the reduce-motion setting (`State.reducedMotion`)
- `docs/`: feature specs, one per version
- `src/spritegroups.ts`: loads each species' sprites when the tank needs them
- `tools/e2e.mjs`: headless click-through (puppeteer-core)
- `tools/page.mjs`, `tools/loadtime.mjs`: the single-page build for claude.ai artifacts, and its load timing
- `src/sw.js`, `src/offline.ts`, `tools/offline.mjs`: the Pages service worker, its registration, and its end-to-end check

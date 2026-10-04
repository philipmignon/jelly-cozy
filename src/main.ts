import { Alignment, EventType, Fit, Layout, Rive, RuntimeLoader, decodeImage, type AssetLoadCallback, type ViewModelInstance } from "@rive-app/webgl2";
import wasmUrl from "@rive-app/webgl2/rive.wasm?url";
import rivUrl from "../public/jellytank.riv?url";
import { createTankAudio } from "./audio";
import { attachGestures } from "./gestures";
import { attachKeyboard, type ButtonName, type Keyboard } from "./keyboard";
import { readReducedMotion, writeReducedMotion } from "./a11y";
import { createSettings } from "./hud";
import { createJournal } from "./journal";
import { openAlbum, shrink } from "./album";
import { createAlbumPage } from "./albumpage";
import { createKeepNote, type KeepNoteEntry } from "./keepnote";
import { createCollectionPage } from "./collection";
import { captionDate, capture, flash, photoFilename, savePng, toPng } from "./photo";
import { clearVisit, createBackupPanel, createSharePanel, pendingVisit, showNote, showVisitBar } from "./share";
import { createOverlay, type JellyCardInfo } from "./overlay";
import { createPacer, readBatterySaver, wakes, writeBatterySaver, type Pacer } from "./pace";
import { registerOffline, updateChip } from "./offline";
import { activeSeason, readSeasonDecor, seasonalMorph, writeSeasonDecor } from "./season";
import { createRequestNote, type RequestNote } from "./requestnote";
import { attachRoom, type Room } from "./roomfit";
import { testQuery } from "./testmode";
import type { TestHost } from "./testapi";
import { SPECIES_NAMES, TAB_N, collectionOf, keepsakeOf } from "./species";
import { createSpriteGroups, eventGroup, groupsFor, jellyGroups, speciesGroup, useSpriteGroups } from "./spritegroups";
import {
  K,
  SHOP_ITEMS,
  buy,
  closeShop,
  collection,
  FIND_ITEMS,
  FIND_SETS,
  createState,
  decorAt,
  dropDecor,
  geomOf,
  isShopOpen,
  camMoving,
  canRehome,
  hasTool,
  isFoodTool,
  scrubAt,
  setCursor,
  setEvent,
  sprinkle,
  toggleTool,
  demoSave,
  catchUp,
  exportTank,
  feed,
  importTank,
  journal,
  keepsakes,
  keepsakesAtLoad,
  MILESTONES,
  flingCam,
  inShopView,
  scrollShop,
  focusJelly,
  unfocus,
  worldToScreenY,
  moveDecorScreen,
  panBy,
  screenToWorld,
  worldToScreen,
  viewSpan,
  jellyAt,
  jellyInfo,
  loadGame,
  rehome,
  rehomeInfo,
  liftDecor,
  openShop,
  pearlCentre,
  renameJelly,
  requests,
  MORPH_CLASSIC,
  MORPH_GHOST,
  setReducedMotion,
  TRAIT_PHRASES,
  setTab,
  step,
  syncClock,
  tap,
  toSave,
  toggleLamp,
  view,
  visitorLog,
  THEME_NAMES,
  type BuyResult,
  type State,
} from "./sim";

const SAVE_KEY = "jellytank:v5";
const OLD_SAVE_KEYS = ["jellytank:v3", "jellytank:v2", "jellytank:v1"];

const SPECIES: readonly string[] = SPECIES_NAMES;
const STAGES = ["Polyp", "Baby (ephyra)", "Juvenile", "Adult"];

function readSave(): string | null {
  try {
    for (const key of [SAVE_KEY, ...OLD_SAVE_KEYS]) {
      const raw = localStorage.getItem(key);
      if (raw) return raw;
    }
  } catch {
    /* private mode: start fresh */
  }
  return null;
}

/** The demo tank (?demo=1) is for recording clips: it never touches the real save. */
const DEMO = new URLSearchParams(location.search).get("demo") === "1";
/** Visiting a friend's tank from a share code (a frozen snapshot): like the demo, nothing is saved. */
const VISIT_CODE = DEMO ? null : pendingVisit();
const VISIT_SAVE = VISIT_CODE ? importTank(VISIT_CODE) : null;
const READ_ONLY = DEMO || VISIT_SAVE !== null;
const TIPS_KEY = "jellytank:tips";
/** Test mode (?test=1, ?seed=N, ?clock=virtual: src/testmode.ts), null in normal play. */
const TEST_Q = testQuery(location.search);

/** Set while a restored save is being written: the reload's own pagehide save must not overwrite it. */
let savesSuspended = false;

/** The save lives in this browser's localStorage (back it up with a save code from the settings menu). */
function persist(s: State): void {
  if (READ_ONLY || savesSuspended) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave(s, Date.now())));
  } catch {
    /* ignore */
  }
}

/** Writes only the values that changed since the last frame. The logic speaks flat names; a jelly slot's
 *  (j3k5) lives in that slot's nested Jelly instance, at the path j3/k5 (contract `nested`). */
function makeWriter(vmi: ViewModelInstance) {
  const last = new Map<string, number>();
  const handles = new Map<string, ReturnType<ViewModelInstance["number"]>>();
  const slotProp = /^j([0-6])(.+)$/;
  for (const name of K.props) {
    const m = slotProp.exec(name);
    const h = vmi.number(m ? `j${m[1]}/${m[2]}` : name);
    if (h) handles.set(name, h);
  }
  return (v: Record<string, number>) => {
    for (const [name, value] of Object.entries(v)) {
      if (last.get(name) === value) continue;
      const h = handles.get(name);
      if (!h) continue;
      h.value = value;
      last.set(name, value);
    }
  };
}

/** A short buzz on phones that support it (ignored elsewhere and wherever the frame refuses it). */
function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed here */
  }
}

/** Fit.Contain + center: the artboard's scale and offset inside the canvas. */
function fit(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / K.W, r.height / K.H);
  return { r, s, ox: (r.width - K.W * s) / 2, oy: (r.height - K.H * s) / 2 };
}
function toArtboard(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const { r, s, ox, oy } = fit(canvas);
  return { x: (clientX - r.left - ox) / s, y: (clientY - r.top - oy) / s };
}
function artToClient(canvas: HTMLCanvasElement, x: number, y: number) {
  const { r, s, ox, oy } = fit(canvas);
  return { x: r.left + ox + x * s, y: r.top + oy + y * s };
}

async function main() {
  RuntimeLoader.setWasmUrl(wasmUrl);
  void RuntimeLoader.awaitInstance(); // start fetching + compiling the engine before anything else
  // tests only: window.__jt, seeded randomness, the virtual clock (src/testapi.ts, a chunk normal play never loads)
  const T: TestHost | null = TEST_Q ? (await import("./testapi")).createTestHost(TEST_Q) : null;
  const canvas = document.getElementById("tank") as HTMLCanvasElement;
  const growthMultiplier = new URLSearchParams(location.search).get("fast") === "1" ? 20 : 1;
  const raw = READ_ONLY ? null : readSave();
  const loaded = VISIT_SAVE
    ? { save: VISIT_SAVE, away: null }
    : DEMO
      ? { save: demoSave(Date.now()), away: null }
      : loadGame(raw, Date.now(), { growthMultiplier });
  // daily requests and seasonal (ghost) births only in the player's own tank: not the demo, not someone else's
  const state = createState(loaded.save, T ? T.rand : Math.random, {
    ...(T?.seed != null ? { seed: T.seed } : {}),
    growthMultiplier: DEMO ? 1 : growthMultiplier,
    requests: !READ_ONLY,
    keepsakes: !READ_ONLY, // v13: milestones only count (and keepsakes only unlock) in the player's own tank
    finds: !READ_ONLY, // v16: sea glass and shells only turn up in the player's own tank
    ...(READ_ONLY ? {} : { seasonalMorph: (now: number) => seasonalMorph(now, location.search) }),
  });
  const audio = createTankAudio();
  const overlay = createOverlay();
  // v14: the journal's Visitors page (the visitor log) and the photo Album (IndexedDB; null where storage is blocked)
  const albumPage = createAlbumPage(openAlbum, savePng);
  // v16: the Collection drawer (sea glass and shells), after the Keepsakes
  const collectionPage = createCollectionPage(() => collection(state));
  const book = createJournal(() => journal(state), () => keepsakes(state), { visitors: () => visitorLog(state), album: albumPage, collection: collectionPage });
  // v13: keepsake notes wait their turn: after the away note, never over a tip or another note.
  // Milestones an older save already reached on load arrive as one summary (one entry in the queue).
  const keepNote = createKeepNote((place) => book.open(place === "collection" ? "collection" : "keepsakes"));
  const keepQueue: KeepNoteEntry[][] = [];
  const keepEntries = (ms: number[]): KeepNoteEntry[] =>
    ms.flatMap((m) => (MILESTONES[m] ? [{ m, note: MILESTONES[m].note, title: MILESTONES[m].title, reward: MILESTONES[m].reward }] : []));
  let keepReady = false;
  let keepShowing = false;
  const showKeeps = async () => {
    if (keepShowing || !keepReady) return;
    keepShowing = true;
    while (keepQueue.length) {
      if (overlay.busy || book.isOpen || sharePanel.isOpen) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      const entries = keepQueue.shift()!;
      if (!entries.length) continue;
      audio.play("unlock");
      buzz([20, 40, 20]);
      await keepNote.show(entries);
    }
    keepShowing = false;
  };
  const loadedKeeps = keepsakesAtLoad(state);
  if (loadedKeeps.length) {
    keepQueue.push(keepEntries(loadedKeeps));
    persist(state); // their rewards are in: keep them even if the page closes before the next autosave
  }
  const sharePanel = createSharePanel(
    () => exportTank(state),
    (code) => importTank(code) !== null,
  );
  (window as unknown as { __tank: State }).__tank = state;

  // species (and event) art arrives in groups: fetch what this tank shows now, alongside the .riv
  let fileLoaded = () => {};
  const groups = createSpriteGroups({
    decode: decodeImage,
    fetch: (url) => fetch(url),
    base: document.baseURI,
    fileLoaded: new Promise<void>((r) => (fileLoaded = r)),
    idle: (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 2000)),
  });
  useSpriteGroups(groups);
  (window as unknown as { __spriteGroups: typeof groups }).__spriteGroups = groups; // for tools/loadtime.mjs
  // seasonal events (Halloween...): the local calendar, ?season= for testing, and the "Seasonal decor" setting
  const store = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  let seasonDecor = readSeasonDecor(store);
  // reduce motion: the player's choice, else the OS's. One flag for the sim (State.reducedMotion, which other
  // features read) and one for the HTML (:root[data-jt-reduce-motion]).
  const osCalm = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduceMotion = false;
  const applyMotion = (on: boolean) => {
    reduceMotion = on;
    setReducedMotion(state, on);
    document.documentElement.toggleAttribute("data-jt-reduce-motion", on);
  };
  applyMotion(readReducedMotion(store, !!osCalm?.matches));
  osCalm?.addEventListener?.("change", () => applyMotion(readReducedMotion(store, osCalm.matches))); // unless the player chose
  /** the event the calendar, ?season= and the decor setting ask for (its art may still be on the way) */
  const wantedEvent = () => (T && T.season !== undefined ? T.season : activeSeason(Date.now(), location.search, seasonDecor)?.id ?? null);
  /** the jellies' groups (species, and a ghost's event art) plus the wanted event's; `near` = only those on screen */
  const tankGroups = (near = Infinity) => {
    const { x0, x1 } = viewSpan(state);
    const js = state.slots.flatMap((j) => (j && j.x > x0 - near && j.x < x1 + near ? [{ k: j.k, morph: j.morph }] : []));
    return groupsFor(js, wantedEvent());
  };
  /** species the shop would sell this tank right now: worth having before they're bought */
  const affordableGroups = () =>
    SHOP_ITEMS.flatMap((it) => (it.kind === "polyp" && state.dollars >= it.price && (it.needTier ?? 0) <= state.tier ? [speciesGroup(it.k)] : []));
  // the loading screen waits for the art of the jellies on screen (or for it to fail); the rest follows after
  let groupsSettled = false;
  void groups
    .ensureGroups(tankGroups(120))
    .catch((err: unknown) => console.warn(err))
    .finally(() => (groupsSettled = true));
  /** when a group that a jelly was hidden for arrived: that jelly fades in rather than popping */
  const hiddenFor = new Set<string>();
  const arrivedAt = new Map<string, number>();
  const FADE_IN_MS = 400;

  /** show the wanted event once its art is in (decor and its visitors both draw from it); until then, none */
  const applySeason = () => {
    const id = wantedEvent();
    if (id && !groups.isReady(eventGroup(id))) {
      setEvent(state, null);
      void groups.ensureGroups([eventGroup(id)]).then(applySeason, () => {}); // a failed fetch retries on the next tick
      return;
    }
    setEvent(state, id);
  };
  applySeason();
  setInterval(applySeason, 60_000); // a tab left open over midnight picks up the new day

  const rive = await new Promise<Rive>((resolve, reject) => {
    const r: Rive = new Rive({
      canvas,
      src: rivUrl,
      artboard: "Tank",
      stateMachines: "Tank",
      autoplay: true,
      autoBind: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      assetLoader: groups.assetLoader as unknown as AssetLoadCallback,
      onLoad: () => {
        fileLoaded();
        r.resizeDrawingSurfaceToCanvas();
        resolve(r);
      },
      onLoadError: () => reject(new Error("jellytank.riv failed to load")),
    });
  });
  new ResizeObserver(() => rive.resizeDrawingSurfaceToCanvas()).observe(canvas);

  // frames come from our own loop (src/pace.ts): every display frame while something is happening, 30 a
  // second once the tank has been quiet a few seconds, or always with the battery saver on. Any input wakes it.
  const realPacer = () =>
    createPacer(rive, {
      raf: (cb) => requestAnimationFrame(cb),
      caf: (id) => cancelAnimationFrame(id),
      now: () => performance.now(),
      reduced: () => reduceMotion,
    });
  const pacer = T ? T.pacer(rive, realPacer) : realPacer(); // a virtual clock draws only when the test asks
  pacer.saver = readBatterySaver(store);
  for (const type of ["pointerdown", "pointermove", "wheel", "keydown"] as const) window.addEventListener(type, () => pacer.wake(), { capture: true, passive: true });
  pacer.start();
  (window as unknown as { __pace: Pacer }).__pace = pacer; // for tools/battery.mjs and the e2e

  const vmi = rive.viewModelInstance;
  if (!vmi) throw new Error("Tank view model not bound");
  const write = makeWriter(vmi);
  const on = (name: string, cb: () => void) => vmi.trigger(name)?.on(cb);
  const client = (x: number, y: number) => artToClient(canvas, x, y);
  /** world coordinates (inside the panning World node) -> client */
  const wclient = (x: number, y: number) => client(worldToScreen(state, x), worldToScreenY(state, y));

  /** Where above a jelly's body to float things (tags, pops). */
  const aboveJelly = (slot: number) => {
    const j = state.slots[slot];
    if (!j) return null;
    return wclient(j.x, j.y - geomOf(j.k, j.g).body.top - 12);
  };
  const cardInfo = (slot: number): JellyCardInfo | null => {
    const i = jellyInfo(state, slot);
    const morph = i?.morph === MORPH_CLASSIC ? " · rare colour" : i?.morph === MORPH_GHOST ? " · ghost colour" : "";
    return i && { name: i.name, species: `${SPECIES[i.k] ?? ""}${morph}`, stage: STAGES[i.g] ?? "", ageDays: i.ageDays, fullness: i.fullness, mood: i.mood, trait: TRAIT_PHRASES[i.trait], rehome: rehomeInfo(state, slot) };
  };

  // ---------------------------------------------------------------- buttons in the .riv

  // what each button does (the keyboard presses them too: src/keyboard.ts). Escape puts the held item down there.
  const press: Record<ButtonName, () => void> = {
    // Feed and Clean pick up the food can / the sponge (and put it down again)
    feed: () => audio.play(toggleTool(state, "food") === "food" ? "pickup" : "putdown"),
    clean: () => audio.play(toggleTool(state, "sponge") === "sponge" ? "pickup" : "putdown"),
    shrimp: () => {
      if (hasTool(state, "shrimp")) audio.play(toggleTool(state, "shrimp") === "shrimp" ? "pickup" : "putdown");
    },
    plankton: () => {
      if (hasTool(state, "plankton")) audio.play(toggleTool(state, "plankton") === "plankton" ? "pickup" : "putdown");
    },
    lamp: () => {
      toggleLamp(state);
      audio.play("switch");
      audio.play(state.nightTarget ? "lampOff" : "lampOn");
      buzz(8);
      persist(state);
    },
    shop: () => {
      overlay.closeCard();
      groups.prefetch(affordableGroups()); // downloaded now, decoded when one is bought
      openShop(state);
      audio.play("ui");
    },
    shopClose: () => {
      closeShop(state);
      audio.play("ui");
    },
  };
  // v15: a decoration carried down to the drawer is let go over the shelf: Rive still clicks what's under the
  // finger, so the cabinet's buttons ignore presses while one is carried and just after
  let dragging = -1; // the decoration being carried (gestures below)
  let dragEndedAt = -Infinity;
  const carrying = () => dragging >= 0 || performance.now() - dragEndedAt < 400;
  for (const name of Object.keys(press) as ButtonName[]) on(name, () => carrying() || press[name]());
  // v16: the jar in the hood opens the journal on the Collection (not in a read-only tank: it isn't shown there)
  on("finds", () => {
    if (READ_ONLY || carrying() || isShopOpen(state) || book.isOpen) return;
    overlay.closeCard();
    audio.play("ui");
    book.open("collection");
  });
  Array.from({ length: TAB_N }, (_, t) => t).forEach((t) =>
    on(`tab${t}`, () => {
      if (!isShopOpen(state)) return;
      setTab(state, t);
      audio.play("ui");
    }),
  );
  // Rive fires every click target under the pointer, including cards scrolled out of the list's
  // window, and a drag that ends on a card. Only a still press inside the visible window buys.
  // judged when the finger goes down: by the time Rive's triggers arrive, a tab tap may already have switched tabs
  let pressInList = true;
  let scrolled = false;
  canvas.addEventListener("pointerdown", (e) => {
    pressInList = inShopView(state, toArtboard(canvas, e.clientX, e.clientY).y);
    scrolled = false;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!isShopOpen(state)) return;
      e.preventDefault();
      scrollShop(state, -e.deltaY * 0.6);
    },
    { passive: false },
  );
  /** Buy shop item i (a card tapped, or Enter on it): the sound, and the save. */
  const buyItem = (i: number): BuyResult | null => {
    if (!isShopOpen(state)) return null;
    const r = buy(state, i);
    if (r === "bought") {
      audio.play("buy");
      persist(state);
    } else if (r === "keepsake") {
      // v13: not for sale: the card's tag says how it's earned
      audio.play("ui");
      const m = MILESTONES[keepsakeOf(SHOP_ITEMS[i])];
      const c = (K.shopCards as unknown as ({ x: number; y: number; w: number } | null)[] | undefined)?.[i];
      if (m && c) {
        const at = client(c.x + c.w / 2, c.y + 30 - state.shopScroll);
        overlay.nameTag(`Keepsake: ${m.title}`, at.x, at.y);
      }
    } else if (r === "collection") {
      // v16: a collection set's reward: the card's tag says which set leaves it
      audio.play("ui");
      const st = FIND_SETS[collectionOf(SHOP_ITEMS[i])];
      const c = (K.shopCards as unknown as ({ x: number; y: number; w: number } | null)[] | undefined)?.[i];
      if (st && c) {
        const at = client(c.x + c.w / 2, c.y + 30 - state.shopScroll);
        overlay.nameTag(`Collection: ${st.title}`, at.x, at.y);
      }
    } else if (r === "selected") {
      audio.play("ui"); // an owned theme picked again
      persist(state);
    } else if (r === "putAway" || r === "placed") {
      // v15: an owned decoration's card puts it in the drawer, or takes it out to where there's room
      audio.play(r === "putAway" ? "putdown" : "pickup");
      persist(state);
    } else {
      audio.play("ui");
    }
    return r;
  };
  SHOP_ITEMS.forEach((_, i) =>
    on(`buy${i}`, () => {
      if (scrolled || !pressInList) return;
      buyItem(i);
    }),
  );

  // ---------------------------------------------------------------- gestures in the water

  let settings: { readonly isOpen: boolean } | null = null;
  let backupOpen = () => false; // set once the backup panel exists
  let reqNote: RequestNote | null = null; // v12: today's requests (none in read-only tanks)
  let menuWasOpen = false; // the press that closes the menu (or the requests note) shouldn't also pet, pour or pan
  canvas.addEventListener("pointerdown", () => (menuWasOpen = !!settings?.isOpen || !!reqNote?.isOpen), true);
  const inTank = (y: number) =>
    y < K.cabTop && !isShopOpen(state) && !overlay.busy && overlay.cardSlot === null && !book.isOpen && !sharePanel.isOpen && !backupOpen() && !reqNote?.isOpen && !keepNote.isOpen && !menuWasOpen;
  // the held tool: a press in the water sprinkles or scrubs instead of petting/panning
  const SPRINKLE_MS = 110;
  let lastPour = 0;
  let toolAt = { x: 0, y: 0 };
  const useTool = (x: number, y: number, first: boolean) => {
    const now = performance.now();
    if (isFoodTool(state.tool)) {
      if (!first && now - lastPour < SPRINKLE_MS) return;
      lastPour = now;
      const n = sprinkle(state, screenToWorld(state, x), y);
      if (n > 0) {
        audio.play("pour");
        setTimeout(() => audio.play("plop"), 260);
      }
    } else if (state.tool === "sponge") {
      const d = first ? 0 : Math.hypot(x - toolAt.x, y - toolAt.y);
      if (scrubAt(state, screenToWorld(state, x), y, d) > 0) audio.play("scrub");
    }
    toolAt = { x, y };
  };
  /** A jelly was petted: its sound, a buzz and its name tag. */
  const petted = (slot: number) => {
    audio.play("pet");
    buzz(12);
    const at = aboveJelly(slot);
    const name = jellyInfo(state, slot)?.name;
    if (at && name) overlay.nameTag(name, at.x, at.y, slot);
  };
  /** A tap in the water at a WORLD point (a finger, or the keyboard on the pearl or a visitor). */
  const tapWorld = (x: number, y: number) => {
    const slot = jellyAt(state, x, y);
    const r = tap(state, x, y);
    if (r === "pearl" || r === "visitor") {
      audio.play("unlock");
      buzz([20, 40, 20]);
      persist(state);
    } else if (r === "pet") {
      if (slot >= 0) petted(slot);
    } else if (r === "call") {
      audio.play("tap");
    }
  };
  /** Open a jelly's card, the camera closing in on it (a long-press, or N on the keyboard). */
  const openCardFor = (slot: number) => {
    const info = cardInfo(slot);
    if (!info) return;
    audio.play("ui");
    focusJelly(state, slot);
    overlay.openCard(slot, info, {
      closed: () => unfocus(state),
      rename: (name) => {
        if (renameJelly(state, slot, name)) persist(state);
      },
      rehome: () => {
        if (!canRehome(state, slot)) return;
        const at = aboveJelly(slot);
        const r = rehome(state, slot);
        if (!r) return;
        audio.play("unlock");
        if (at) overlay.nameTag(`Bye, ${r.name}!`, at.x, at.y);
        persist(state);
      },
    });
  };
  const toolWater = (y: number) => y < K.cabTop && !isShopOpen(state) && !overlay.busy && !book.isOpen && !sharePanel.isOpen && !backupOpen() && !reqNote?.isOpen && !keepNote.isOpen && !menuWasOpen;

  attachGestures(canvas, (cx, cy) => toArtboard(canvas, cx, cy), {
    toolDown(x, y) {
      if (state.tool === "none" || !toolWater(y)) return false;
      setCursor(state, x, y, true, true);
      useTool(x, y, true);
      return true;
    },
    toolMove(x, y) {
      // the held item follows the pointer anywhere (over the cabinet too); it only works in the water
      const inside = toolWater(y);
      setCursor(state, x, y, inside, true);
      if (inside) useTool(x, y, false);
    },
    toolUp() {
      setCursor(state, toolAt.x, toolAt.y, false, true);
    },
    hover(x, y, inside) {
      if (state.tool !== "none") setCursor(state, x, y, false, inside);
    },
    down() {
      audio.unlock();
      if (camMoving(state)) panBy(state, 0); // a touch catches a fling
    },
    panStart: (_x, y) => inTank(y),
    vpanStart: () => isShopOpen(state),
    vpan: (dy) => {
      scrolled = true;
      scrollShop(state, dy);
    },
    pan: (dx) => panBy(state, dx),
    panEnd: (vx) => flingCam(state, vx),
    tap(sx, y) {
      if (overlay.cardSlot !== null && y < K.cabTop) {
        overlay.closeCard(); // a tap on the water puts the card away
        return;
      }
      if (!inTank(y)) return;
      tapWorld(screenToWorld(state, sx), y);
    },
    longPress(sx, y) {
      if (!inTank(y)) return false;
      const x = screenToWorld(state, sx);
      const n = decorAt(state, x, y);
      if (n >= 0 && liftDecor(state, n)) {
        dragging = n;
        audio.play("ui");
        return true;
      }
      const slot = jellyAt(state, x, y);
      if (slot >= 0) openCardFor(slot);
      return false;
    },
    drag(x, y) {
      if (dragging < 0) return;
      const wasHot = state.drawer.hot;
      moveDecorScreen(state, dragging, x, y);
      if (state.drawer.hot && !wasHot) buzz(8); // over the drawer: a let-go now puts it away
    },
    drop() {
      if (dragging < 0) return;
      const r = dropDecor(state);
      dragging = -1;
      dragEndedAt = performance.now();
      audio.play(r === "stored" ? "putdown" : "buy");
      persist(state);
    },
  });
  const backupPanel = createBackupPanel(
    () => JSON.stringify(toSave(state, Date.now())),
    (json) => {
      savesSuspended = true;
      try {
        localStorage.setItem(SAVE_KEY, json);
      } catch {
        savesSuspended = false;
        return; // no storage: nothing to restore into
      }
      clearVisit();
      location.reload();
    },
  );
  backupOpen = () => backupPanel.isOpen;
  const settingsUi = createSettings(audio, canvas, client, {
    journal: () => book.open(),
    share: () => sharePanel.open(),
    backup: () => backupPanel.open("backup"),
    restore: () => backupPanel.open("restore"),
    photo: () => void takePhoto(),
    reduceMotion: {
      get: () => reduceMotion,
      set: (on) => {
        writeReducedMotion(store, on);
        applyMotion(on);
      },
    },
    seasonDecor: {
      get: () => seasonDecor,
      set: (on) => {
        seasonDecor = on;
        writeSeasonDecor(store, on);
        applySeason();
      },
    },
    batterySaver: {
      get: () => pacer.saver,
      set: (on) => {
        pacer.saver = on;
        writeBatterySaver(store, on);
      },
    },
  });
  settings = settingsUi;
  if (VISIT_SAVE) showVisitBar();

  // ---------------------------------------------------------------- photo mode

  /** For the photo frame: the pan hints and the held item stay out of the picture. */
  const PHOTO_HIDE = { panL: 0, panR: 0, canO: 0, jarO: 0, bottleO: 0, spongeO: 0 };
  let photoHide = false;
  let photoBusy = false;
  /** n frames drawn (not display frames: at the calm rate only every other one is) */
  const frames = (n: number) =>
    T?.virtual ? T.frames(n) : new Promise<void>((resolve) => {
      const until = pacer.drawn + n;
      const f = () => (pacer.drawn >= until ? resolve() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    });
  /** v14: keep a half-size copy in the album, with the date, the theme and the jellies in shot (or in the tank). */
  const keepPhoto = async (shot: HTMLCanvasElement, now: number) => {
    const album = await openAlbum();
    if (!album) return;
    const img = await shrink(shot);
    if (!img) return;
    const { x0, x1 } = viewSpan(state);
    const all = state.slots.flatMap((j) => (j ? [j] : []));
    const inShot = all.filter((j) => j.x > x0 && j.x < x1);
    await album.add({ at: now, theme: THEME_NAMES[state.theme] ?? THEME_NAMES[0], names: (inShot.length ? inShot : all).map((j) => j.name) }, img);
  };
  const takePhoto = async () => {
    if (photoBusy) return;
    photoBusy = true;
    try {
      overlay.closeCard();
      if (isShopOpen(state)) {
        closeShop(state);
        await new Promise((r) => setTimeout(r, 700)); // let the shop slide away
      }
      await document.fonts?.load(`16px "Silkscreen"`).catch(() => undefined);
      photoHide = true;
      await frames(3); // view-model writes land a frame late
      // the glass only: below the hood's HUD, above the cabinet's shelf and buttons
      const { r, s, ox, oy } = fit(canvas);
      const k = canvas.width / r.width;
      const crop = { x: ox * k, y: (oy + K.waterTop * s) * k, w: K.W * s * k, h: (K.cabTop - K.waterTop) * s * k };
      const now = Date.now();
      const shot = capture(rive, canvas, crop, { left: READ_ONLY && !DEMO ? "A FRIEND'S TANK" : "JELLY TANK", right: captionDate(now) });
      photoHide = false;
      flash();
      audio.play("shutter");
      buzz(18);
      const kept = READ_ONLY ? null : keepPhoto(shot, now); // v14: into the album too (not the demo's, not a friend's tank)
      const blob = await toPng(shot);
      const saved = blob ? await savePng(blob, photoFilename(now)) : "failed";
      await kept;
      if (saved === "failed") showNote("The photo couldn't be saved here.");
    } finally {
      photoHide = false;
      photoBusy = false;
    }
  };

  if (!READ_ONLY) {
    reqNote = createRequestNote(canvas, client, { opened: () => (settingsUi.close(), audio.play("ui")) });
    reqNote.update(requests(state)?.items ?? null);
  }

  // keyboard play and the screen reader's view of the tank
  const kb: Keyboard = attachKeyboard({
    state,
    canvas,
    client,
    // v13: a keepsake note, and the "updated" chip while focus is on it
    busy: () =>
      overlay.busy || overlay.cardSlot !== null || book.isOpen || albumPage.viewing || sharePanel.isOpen || backupPanel.isOpen || !!reqNote?.isOpen || settingsUi.isOpen || keepNote.isOpen || !!updateChip()?.contains(document.activeElement),
    audio,
    press: (name) => press[name](),
    tapWorld,
    petted,
    openCard: (slot) => {
      if (!isShopOpen(state)) openCardFor(slot);
    },
    buy: buyItem,
    journal: book,
  });

  // ---------------------------------------------------------------- the frame loop

  // "unlock" chime the first time each shop item becomes affordable this session
  const affordable = new Set(SHOP_ITEMS.flatMap((it, i) => (state.dollars >= it.price ? [i] : [])));
  const cleanBtn = (K.buttons as unknown as { name: string; x: number; y: number; w: number; h: number }[] | undefined)?.find((b) => b.name === "clean");

  /** After the first frame: the away note, any keepsake notes, then the first-run tips (once per browser). */
  const intro = async () => {
    const lines = loaded.away?.lines ?? [];
    if (lines.length) await overlay.awayNote(lines);
    keepReady = true;
    await showKeeps();
    await tips();
  };
  const tips = async () => {
    let seen = READ_ONLY;
    try {
      seen ||= localStorage.getItem(TIPS_KEY) === "1";
    } catch {
      /* no storage: show them */
    }
    if (seen) return;
    const first = state.slots.findIndex(Boolean);
    const j = first >= 0 ? state.slots[first] : null;
    const name = first >= 0 ? jellyInfo(state, first)?.name ?? "your jelly" : "your jelly";
    const btn = (n: string) => {
      const b = (K.buttons as unknown as { name: string; x: number; y: number; w: number }[] | undefined)?.find((x) => x.name === n);
      return b ? () => client(b.x + b.w / 2, b.y) : () => null;
    };
    await overlay.tips([
      {
        text: j && j.g === 0
          ? `This is ${name}, a jelly that starts life as a tiny polyp on this rock. Feed it and it grows.`
          : `This is ${name}. Tap to pet it. Hold it to see its card.`,
        target: () => (first >= 0 ? aboveJelly(first) : null),
      },
      { text: "Tap the food can on the shelf to pick it up, then tap or drag in the water to sprinkle flakes there. The sponge scrubs dirty spots off the glass. New foods you buy appear on the shelf too.", target: btn("feed") },
      { text: "The tank follows the time of day. Flip the light switch to change it early.", target: btn("lamp") },
      { text: "Caring earns sand dollars. Spend them here on new jellies, decorations and helpers.", target: btn("shop") },
    ]);
    try {
      localStorage.setItem(TIPS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  let last = performance.now();
  let hiddenAt = Date.now(); // v15: when the tab was last hidden (catchUp counts from here)
  let loadedFrame = false;
  let room: Room | null = null; // v15: the room beside the tank on wide screens
  let cardTick = 0;
  let reqTick = 0;
  rive.on(EventType.Advance, (e) => {
    if (T?.virtual && T.frameDt(e) === 0) return; // a virtual clock's redraw (a resize, the photo): no time passed
    if (!loadedFrame && groupsSettled) {
      loadedFrame = true;
      groups.prefetch(affordableGroups());
      const el = document.getElementById("loading");
      el?.classList.add("done");
      setTimeout(() => el?.remove(), 600);
      void intro();
      registerOffline(() => client(K.W / 2, K.waterTop + 14)); // GitHub Pages only: offline play, instant repeat visits
      // v15: on a wide screen the tank stands in a room; its code and art load now, and only if the screen is wide
      room = attachRoom({
        box: () => {
          const a = client(0, 0);
          const b = client(K.W, K.H);
          return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        },
        lit: () => !state.nightTarget,
        season: () => state.event,
        toggle: press.lamp,
      });
    }
    overlay.placeTip();
    kb.frame();
    const now = T ? T.frameNow() : performance.now();
    const dt = T?.virtual ? T.frameDt(e) : Math.min(0.1, (now - last) / 1000);
    last = now;

    let lastKind = "";
    for (const e of step(state, dt)) {
      if (wakes(e)) pacer.wake();
      kb.event(e);
      switch (e.type) {
        case "ate":
          audio.play("eat");
          if ((e as { fav?: boolean }).fav) setTimeout(() => audio.play("pet"), 120); // a favourite: a happier munch
          break;
        case "pulse":
          audio.play("pulse");
          break;
        case "spotCleaned":
          audio.play("cleaned");
          buzz(15);
          break;
        case "cleaned":
          audio.play("cleaned");
          break;
        case "grew":
        case "baby":
          audio.play("grow");
          buzz([30, 50, 30]);
          persist(state);
          break;
        case "dug":
          audio.play("buy");
          break;
        case "upgraded":
          audio.play("buy");
          persist(state);
          break;
        case "revealed":
          audio.play("unlock");
          if (e.x !== undefined && e.y !== undefined) {
            const at = wclient(e.x, e.y);
            overlay.nameTag("More room!", at.x, at.y);
          }
          break;
        case "rehomed":
          audio.play("grow");
          break;
        case "shrimpAte":
          audio.play("plop");
          break;
        case "rode":
          // v13: a jelly rode the bubbler to the top: a soft pop where you can see it
          if (e.seen) audio.play("plop");
          break;
        case "found": {
          // v16: sea glass or a shell rises from where it was found and flies to the jar: a soft chime; a new kind
          // gets its name over the spot
          audio.play("chime");
          buzz(10);
          const it = FIND_ITEMS[e.find ?? -1];
          if (it && e.first && e.x !== undefined && e.y !== undefined) {
            const at = wclient(e.x, e.y - 120);
            overlay.nameTag(`New: ${it.name}`, at.x, at.y);
          }
          persist(state);
          break;
        }
        case "setDone": {
          // v16: a set is complete: its decoration is in (with a sparkle); a note once the find has landed in the jar
          const st = FIND_SETS[e.set ?? -1];
          if (st) {
            const entry: KeepNoteEntry = { m: -1, note: st.note, title: st.title, reward: st.reward, art: `sgr${e.set}`, heading: "Set complete!", place: "collection" };
            setTimeout(() => {
              keepQueue.push([entry]);
              void showKeeps();
            }, reduceMotion ? 1600 : 2500);
          }
          persist(state);
          break;
        }
        case "themed":
          audio.play("unlock");
          persist(state);
          break;
        case "keepsake":
          // v13: a milestone reached in play: its keepsake is already in (with a sparkle); a note says so
          if (e.keepsake !== undefined) keepQueue.push(keepEntries([e.keepsake]));
          persist(state);
          void showKeeps();
          break;
        case "requestDone":
          // v12: a daily request finished: a chime, the note bobs, and its "+N" (the next event) floats under it
          audio.play("unlock");
          buzz([20, 40, 20]);
          reqNote?.update(requests(state)?.items ?? null);
          if (e.request !== undefined) reqNote?.celebrate(e.request);
          persist(state);
          break;
        case "visitorArrived":
          audio.play("cleaned");
          break;
        case "pearlReady":
          audio.play("cleaned");
          break;
        case "earned": {
          // float a "+N" over whatever earned it
          let at: { x: number; y: number } | null = null;
          if (e.x !== undefined && e.y !== undefined) at = wclient(e.x, e.y - 40);
          else if (lastKind === "dug") at = wclient(state.crab.x, state.crab.y - 40);
          else if (lastKind === "requestDone" && reqNote) at = reqNote.anchor();
          else if (lastKind === "pearl") {
            const p = pearlCentre(state);
            at = wclient(p.x, p.y - 20);
          } else if (e.slot !== undefined) at = aboveJelly(e.slot);
          else if (cleanBtn) at = client(cleanBtn.x + cleanBtn.w / 2, cleanBtn.y - 10);
          if (at && e.amount) overlay.pop(`+${e.amount}`, at.x, at.y);
          break;
        }
      }
      lastKind = e.type;
    }
    pacer.frame(state); // food in the water, the camera moving, a visitor...: the full rate
    SHOP_ITEMS.forEach((it, i) => {
      if (!affordable.has(i) && state.dollars >= it.price) {
        affordable.add(i);
        audio.play("unlock");
      }
    });
    canvas.style.cursor = state.tool === "none" ? "" : "none"; // the held item is the cursor
    const v = view(state);
    // a jelly whose art hasn't arrived stays hidden until it has (off screen at load, a new species, a visit)
    if (groupsSettled) groups.want(tankGroups());
    state.slots.forEach((j, s) => {
      if (!j) return;
      const need = jellyGroups(j); // its species' art, and a ghost's event art (morph 2: ev-halloween)
      const missing = need.filter((g) => !groups.isReady(g));
      if (missing.length) {
        for (const g of missing) hiddenFor.add(g);
        v[`j${s}on`] = 0;
        return;
      }
      let t = Infinity; // since the last of its groups arrived
      for (const g of need) if (hiddenFor.has(g)) t = Math.min(t, now - (arrivedAt.get(g) ?? arrivedAt.set(g, now).get(g)!));
      if (t < FADE_IN_MS) v[`j${s}on`] = Math.round((t / FADE_IN_MS) * 20) / 20;
    });
    if (photoHide) Object.assign(v, PHOTO_HIDE);
    write(v);
    audio.setNight(v.nightShade ?? 0);
    room?.sync();
    audio.setMurk(state.murk);
    if (overlay.cardSlot !== null && (cardTick = (cardTick + 1) % 15) === 0) overlay.updateCard(cardInfo(overlay.cardSlot));
    // v12: the note follows the requests' progress (and a new day's list after midnight)
    if (reqNote && (reqTick = (reqTick + 1) % 12) === 0) reqNote.update(requests(state)?.items ?? null);
  });

  T?.attach({
    state,
    rive,
    saveKey: SAVE_KEY,
    suspendSaves: () => (savesSuspended = true),
    groups,
    tankGroups: () => tankGroups(),
    applySeason,
    loaded: () => loadedFrame,
    groupsSettled: () => groupsSettled,
    fading: () => {
      const now = T.frameNow();
      return state.slots.some((j) => j && jellyGroups(j).some((g) => !groups.isReady(g) || (hiddenFor.has(g) && (!arrivedAt.has(g) || now - arrivedAt.get(g)! < FADE_IN_MS))));
    },
    client,
    wclient,
  });

  // not while hidden: nothing changes then (no frames, no steps), and hiding saved already
  setInterval(() => document.hidden || persist(state), 5000);
  document.addEventListener("visibilitychange", () => {
    // hidden: no frames and no steps (the audio suspends itself, src/audio.ts)
    if (document.hidden) {
      pacer.stop();
      hiddenAt = Math.max(state.clock, Date.now());
      persist(state);
      return;
    }
    // back: the time hidden counts like time away (sim catchUp: hunger, growth, dirt, with the same "while you
    // were away" note a reload would show), the clock catches up (day or night, the day's pearl and requests);
    // everything that moves picks up where it was, the first step one frame long rather than the time away
    const now = Date.now();
    const away = READ_ONLY ? (syncClock(state, now), null) : catchUp(state, hiddenAt, now);
    hiddenAt = now;
    last = performance.now();
    applySeason();
    pacer.wake();
    pacer.start();
    if (away) {
      persist(state);
      void (async () => {
        // never over another away note or a tip (that one's promise would never settle): after it
        while (overlay.busy) await new Promise((r) => setTimeout(r, 400));
        await overlay.awayNote(away.lines);
      })();
    }
  });
  window.addEventListener("pagehide", () => persist(state));
}

main().catch((err) => {
  console.error(err);
  document.body.dataset.error = String(err);
  const msg = document.querySelector("#loading .msg");
  if (msg) {
    msg.setAttribute("data-error", "");
    msg.textContent = "The tank couldn't load. Reload the page to try again.";
  }
});

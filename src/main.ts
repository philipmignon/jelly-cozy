import { Alignment, EventType, Fit, Layout, Rive, RuntimeLoader, type ViewModelInstance } from "@rive-app/webgl2";
import wasmUrl from "@rive-app/webgl2/rive.wasm?url";
import rivUrl from "../public/jellytank.riv?url";
import { createTankAudio } from "./audio";
import { attachGestures } from "./gestures";
import { createSettings } from "./hud";
import { createJournal } from "./journal";
import { connectCloud, savedAt, type CloudSync } from "./cloud";
import { SHELL_DOLLARS, connectFriends, giftLines, liveId, type Friends, type Gift } from "./friends";
import { captionDate, capture, downloadsCapability, flash, photoFilename, savePng, toPng } from "./photo";
import { clearVisit, createBackupPanel, createSharePanel, noteAfterReload, pendingVisit, showNote, showVisitBar, takeNote } from "./share";
import { createOverlay, type JellyCardInfo } from "./overlay";
import { activeSeason, readSeasonDecor, writeSeasonDecor } from "./season";
import { SPECIES_NAMES, TAB_N } from "./species";
import {
  K,
  SHOP_ITEMS,
  buy,
  closeShop,
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
  setTool,
  sprinkle,
  toggleTool,
  demoSave,
  earn,
  exportTank,
  feed,
  importTank,
  journal,
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
  jellyAt,
  jellyInfo,
  loadGame,
  rehome,
  rehomeInfo,
  liftDecor,
  openShop,
  pearlCentre,
  renameJelly,
  setTab,
  step,
  syncClock,
  tap,
  toSave,
  toggleLamp,
  view,
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
/** Visiting a friend's tank from a share code: like the demo, nothing is saved. */
const VISIT_CODE = DEMO ? null : pendingVisit();
/** On the synced copy, a live code names a friend whose tank is read from the db as it is now. */
const LIVE_ID = liveId(VISIT_CODE);
const VISIT_SAVE = VISIT_CODE && !LIVE_ID ? importTank(VISIT_CODE) : null;
const READ_ONLY = DEMO || VISIT_SAVE !== null || LIVE_ID !== null;
const TIPS_KEY = "jellytank:tips";

/** Set while a restored save is being written: the reload's own pagehide save must not overwrite it. */
let savesSuspended = false;

/** The synced copy's cloud save (null on the main link, or when the viewer can't use it). */
let cloud: CloudSync | null = null;
/** The `lastSeen` of the newest save this page wrote or loaded (to spot another device's newer one). */
let mySaveAt = 0;
/** The synced copy's live tank and gifts (null on the main link, signed out, or without a db). */
let friends: Friends | null = null;

function persist(s: State, cloudNow = false): void {
  if (READ_ONLY || savesSuspended) return;
  const now = Date.now();
  const json = JSON.stringify(toSave(s, now));
  mySaveAt = now;
  try {
    localStorage.setItem(SAVE_KEY, json);
  } catch {
    /* ignore */
  }
  cloud?.save(json, now, cloudNow);
  if (friends) {
    try {
      friends.publish(exportTank(s), now, cloudNow);
    } catch {
      /* a layout the share code can't hold: keep the last one published */
    }
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

/** A hosted build can carry the .riv in the page as base64 (window.__JELLYTANK_RIV_B64): no second request, no .riv MIME type needed. */
function embeddedRiv(): ArrayBuffer | null {
  const b64 = (window as unknown as { __JELLYTANK_RIV_B64?: string }).__JELLYTANK_RIV_B64;
  if (typeof b64 !== "string" || !b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function main() {
  RuntimeLoader.setWasmUrl(wasmUrl);
  void RuntimeLoader.awaitInstance(); // start fetching + compiling the engine before anything else
  const canvas = document.getElementById("tank") as HTMLCanvasElement;
  const growthMultiplier = new URLSearchParams(location.search).get("fast") === "1" ? 20 : 1;
  void downloadsCapability(); // ask once, early: the photo button shouldn't wait on it
  // the synced copy's live tank and gifts; a live visit needs them to read the friend's tank
  const friendsReady = DEMO || VISIT_SAVE ? Promise.resolve(null) : connectFriends();
  // the synced copy reads the cloud save first (the loading screen covers the wait); the newer copy wins
  let raw = READ_ONLY ? null : readSave();
  if (!READ_ONLY) {
    cloud = await connectCloud();
    if (cloud?.initial && savedAt(cloud.initial.json) > savedAt(raw)) {
      raw = cloud.initial.json;
      try {
        localStorage.setItem(SAVE_KEY, raw);
      } catch {
        /* ignore */
      }
    }
    mySaveAt = savedAt(raw);
  }
  friends = await friendsReady;
  // a live visit reads the friend's tank as it is now; if it can't, back to your own tank with a note
  const liveSave = LIVE_ID ? await friends?.tank(LIVE_ID).then((t) => (t ? importTank(t.code) : null)) : null;
  if (LIVE_ID && !liveSave) {
    clearVisit();
    noteAfterReload(
      friends
        ? "That tank isn't shared yet. Your friend needs to open this page once, signed in."
        : "Live codes open on the synced copy of Jelly Tank, signed in.",
    );
    location.reload();
    return;
  }
  // gifts friends left: claimed (marked) now, applied once the tank is up
  const giftsReady: Promise<Gift[]> = friends && !READ_ONLY ? friends.claim() : Promise.resolve([]);
  const visitSave = VISIT_SAVE ?? liveSave ?? null;
  const loaded = visitSave
    ? { save: visitSave, away: null }
    : DEMO
      ? { save: demoSave(Date.now()), away: null }
      : loadGame(raw, Date.now(), { growthMultiplier });
  const state = createState(loaded.save, Math.random, { growthMultiplier: DEMO ? 1 : growthMultiplier });
  const audio = createTankAudio();
  const overlay = createOverlay();
  const book = createJournal(() => journal(state));
  const sharePanel = createSharePanel(
    () => exportTank(state),
    (code) => importTank(code) !== null || (friends !== null && liveId(code) !== null),
    friends?.code,
  );
  (window as unknown as { __tank: State }).__tank = state;

  // seasonal events (Halloween...): the local calendar, ?season= for testing, and the "Seasonal decor" setting
  const store = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  let seasonDecor = readSeasonDecor(store);
  const applySeason = () => setEvent(state, activeSeason(Date.now(), location.search, seasonDecor)?.id ?? null);
  applySeason();
  setInterval(applySeason, 60_000); // a tab left open over midnight picks up the new day

  const embedded = embeddedRiv();
  const rive = await new Promise<Rive>((resolve, reject) => {
    const r: Rive = new Rive({
      canvas,
      ...(embedded ? { buffer: embedded } : { src: rivUrl }),
      artboard: "Tank",
      stateMachines: "Tank",
      autoplay: true,
      autoBind: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => {
        r.resizeDrawingSurfaceToCanvas();
        resolve(r);
      },
      onLoadError: () => reject(new Error("jellytank.riv failed to load")),
    });
  });
  new ResizeObserver(() => rive.resizeDrawingSurfaceToCanvas()).observe(canvas);

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
    return i && { name: i.name, species: `${SPECIES[i.k] ?? ""}${i.morph ? " · rare colour" : ""}`, stage: STAGES[i.g] ?? "", ageDays: i.ageDays, fullness: i.fullness, mood: i.mood, rehome: rehomeInfo(state, slot) };
  };

  // ---------------------------------------------------------------- buttons in the .riv

  // Feed and Clean pick up the food can / the sponge (and put it down again)
  on("feed", () => {
    audio.play(toggleTool(state, "food") === "food" ? "pickup" : "putdown");
  });
  on("clean", () => {
    audio.play(toggleTool(state, "sponge") === "sponge" ? "pickup" : "putdown");
  });
  on("shrimp", () => {
    if (hasTool(state, "shrimp")) audio.play(toggleTool(state, "shrimp") === "shrimp" ? "pickup" : "putdown");
  });
  on("plankton", () => {
    if (hasTool(state, "plankton")) audio.play(toggleTool(state, "plankton") === "plankton" ? "pickup" : "putdown");
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.tool !== "none") setTool(state, "none");
  });
  on("lamp", () => {
    toggleLamp(state);
    audio.play("switch");
    audio.play(state.nightTarget ? "lampOff" : "lampOn");
    buzz(8);
    persist(state);
  });
  on("shop", () => {
    overlay.closeCard();
    openShop(state);
    audio.play("ui");
  });
  on("shopClose", () => {
    closeShop(state);
    audio.play("ui");
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
  SHOP_ITEMS.forEach((_, i) =>
    on(`buy${i}`, () => {
      if (!isShopOpen(state)) return;
      if (scrolled || !pressInList) return;
      const r = buy(state, i);
      if (r === "bought") {
        audio.play("buy");
        persist(state);
      } else if (r === "selected") {
        audio.play("ui"); // an owned theme picked again
        persist(state);
      } else {
        audio.play("ui");
      }
    }),
  );

  // ---------------------------------------------------------------- gestures in the water

  let dragging = -1;
  let settings: { readonly isOpen: boolean } | null = null;
  let backupOpen = () => false; // set once the backup panel exists
  let menuWasOpen = false; // the press that closes the menu shouldn't also pet, pour or pan
  canvas.addEventListener("pointerdown", () => (menuWasOpen = !!settings?.isOpen), true);
  const inTank = (y: number) =>
    y < K.cabTop && !isShopOpen(state) && !overlay.busy && overlay.cardSlot === null && !book.isOpen && !sharePanel.isOpen && !backupOpen() && !menuWasOpen;
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
  const toolWater = (y: number) => y < K.cabTop && !isShopOpen(state) && !overlay.busy && !book.isOpen && !sharePanel.isOpen && !backupOpen() && !menuWasOpen;

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
      const x = screenToWorld(state, sx);
      const slot = jellyAt(state, x, y);
      const r = tap(state, x, y);
      if (r === "pearl" || r === "visitor") {
        audio.play("unlock");
        buzz([20, 40, 20]);
        persist(state);
      } else if (r === "pet") {
        audio.play("pet");
        buzz(12);
        const at = slot >= 0 ? aboveJelly(slot) : null;
        const name = slot >= 0 ? jellyInfo(state, slot)?.name : null;
        if (at && name) overlay.nameTag(name, at.x, at.y, slot);
      } else if (r === "call") {
        audio.play("tap");
      }
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
      const info = slot >= 0 ? cardInfo(slot) : null;
      if (info) {
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
      }
      return false;
    },
    drag(x) {
      if (dragging >= 0) moveDecorScreen(state, dragging, x);
    },
    drop() {
      if (dragging < 0) return;
      dropDecor(state);
      dragging = -1;
      audio.play("buy");
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
    seasonDecor: {
      get: () => seasonDecor,
      set: (on) => {
        seasonDecor = on;
        writeSeasonDecor(store, on);
        applySeason();
      },
    },
  });
  settings = settingsUi;
  if (VISIT_SAVE) showVisitBar();
  if (LIVE_ID && friends) {
    const f = friends;
    showVisitBar({
      async state() {
        if (LIVE_ID === f.me || !f.canGift) return "hidden";
        return (await f.gaveToday(LIVE_ID)) ? "given" : "ready";
      },
      async give(kind) {
        audio.unlock();
        const r = await f.give(LIVE_ID, kind);
        if (r === "given") {
          audio.play("buy");
          buzz(12);
        } else {
          audio.play("ui");
        }
        return r;
      },
    });
  }
  const note = takeNote();
  if (note) showNote(note);

  // ---------------------------------------------------------------- friends' gifts

  /** Apply claimed gifts through the sim (shells pay now, snacks drop food once the note is read); returns the note lines. */
  const applyGifts = async (gifts: Gift[]) => {
    const shells = gifts.filter((g) => g.kind === "shell").length;
    if (shells) earn(state, shells * SHELL_DOLLARS, []);
    persist(state, true);
    const names = friends ? await friends.names([...new Set(gifts.map((g) => g.from))]) : {};
    return { lines: giftLines(gifts, (id) => names[id] ?? ""), snacks: gifts.length - shells };
  };
  /** A free meal per snack (up to three pinches, a beat apart). */
  const serveSnacks = (n: number) => {
    for (let i = 0; i < Math.min(3, n); i++) {
      setTimeout(() => {
        if (feed(state) > 0) audio.play("feed");
      }, 400 + i * 900);
    }
  };

  // ---------------------------------------------------------------- photo mode

  /** For the photo frame: the pan hints and the held item stay out of the picture. */
  const PHOTO_HIDE = { panL: 0, panR: 0, canO: 0, jarO: 0, bottleO: 0, spongeO: 0 };
  let photoHide = false;
  let photoBusy = false;
  const frames = (n: number) =>
    new Promise<void>((resolve) => {
      const f = () => (--n <= 0 ? resolve() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    });
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
      const blob = await toPng(shot);
      const saved = blob ? await savePng(blob, photoFilename(now)) : "failed";
      if (saved === "failed") showNote("The photo couldn't be saved here.");
    } finally {
      photoHide = false;
      photoBusy = false;
    }
  };

  // ---------------------------------------------------------------- the frame loop

  // "unlock" chime the first time each shop item becomes affordable this session
  const affordable = new Set(SHOP_ITEMS.flatMap((it, i) => (state.dollars >= it.price ? [i] : [])));
  const cleanBtn = (K.buttons as unknown as { name: string; x: number; y: number; w: number; h: number }[] | undefined)?.find((b) => b.name === "clean");

  /**
   * After the first frame: the away note (with any gifts friends left), then the first-run tips
   * (once per browser). Gifts that take longer to arrive get a note of their own afterwards.
   */
  const intro = async () => {
    const early = await Promise.race([giftsReady, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
    const gift = early?.length ? await applyGifts(early) : null;
    const lines = [...(loaded.away?.lines ?? []), ...(gift?.lines ?? [])];
    if (lines.length) await overlay.awayNote(lines);
    if (gift) serveSnacks(gift.snacks);
    await tips();
    if (early === null) {
      const late = await giftsReady;
      if (!late.length) return;
      const g = await applyGifts(late);
      await overlay.awayNote(g.lines);
      serveSnacks(g.snacks);
    }
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
  let loadedFrame = false;
  let cardTick = 0;
  rive.on(EventType.Advance, () => {
    if (!loadedFrame) {
      loadedFrame = true;
      const el = document.getElementById("loading");
      el?.classList.add("done");
      setTimeout(() => el?.remove(), 600);
      void intro();
    }
    overlay.placeTip();
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    let lastKind = "";
    for (const e of step(state, dt)) {
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
        case "themed":
          audio.play("unlock");
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
    SHOP_ITEMS.forEach((it, i) => {
      if (!affordable.has(i) && state.dollars >= it.price) {
        affordable.add(i);
        audio.play("unlock");
      }
    });
    canvas.style.cursor = state.tool === "none" ? "" : "none"; // the held item is the cursor
    const v = view(state);
    if (photoHide) Object.assign(v, PHOTO_HIDE);
    write(v);
    audio.setNight(v.nightShade ?? 0);
    audio.setMurk(state.murk);
    if (overlay.cardSlot !== null && (cardTick = (cardTick + 1) % 15) === 0) overlay.updateCard(cardInfo(overlay.cardSlot));
  });

  setInterval(() => persist(state), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persist(state, true); // hand the cloud the latest straight away
      return;
    }
    syncClock(state, Date.now());
    applySeason();
    // back on this device: did another one save a newer tank meanwhile?
    void cloud?.check().then((c) => {
      if (c && c.at > mySaveAt + 1000) offerNewer(c.json);
    });
  });
  /** Another device saved a newer tank: offer it rather than overwrite either copy. */
  const offerNewer = (json: string) => {
    if (document.querySelector(".jt-newer")) return;
    const bar = document.createElement("div");
    bar.className = "jt-visit-bar jt-newer";
    bar.setAttribute("role", "status");
    bar.innerHTML = `<span>A newer tank was saved on another device</span><button type="button">Load it</button>`;
    bar.querySelector("button")!.addEventListener("click", () => {
      savesSuspended = true;
      try {
        localStorage.setItem(SAVE_KEY, json);
      } catch {
        savesSuspended = false;
        return;
      }
      location.reload();
    });
    document.body.append(bar);
  };
  if (cloud) {
    const c = cloud;
    const label = () =>
      c.status === "saving" ? "Cloud save: saving…" : c.status === "offline" ? "Cloud save: offline, saved on this device" : "Cloud save: synced";
    settingsUi.setStatus(label());
    c.onStatus(() => settingsUi.setStatus(label()));
  }
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

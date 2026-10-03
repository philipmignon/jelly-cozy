/**
 * Keyboard play and the screen reader's view of the tank (src/a11y.ts has the rules; this wires them up).
 *
 * The canvas takes focus (Tab reaches it like any control). Inside it Tab walks the jellies, the pearl, a
 * visitor and the shelf; arrows jump to the nearest of them that way; past the last, Tab moves on to the
 * request note and the gear. A ring in HTML follows the focused thing over the canvas. Letter keys work from
 * anywhere that isn't a text field: F feeds, S scrubs, L the light, B the shop, J the journal, N a jelly's
 * card, [ and ] look along a wide tank, 1-4 pick up a shelf item, Escape puts it down. M stays the menu's mute.
 *
 * Two polite live regions: one says what has focus as it moves (straight away, it's the player's doing), the
 * other the tank's moments, throttled (createAnnouncer).
 */
import {
  HOLD_KEYS,
  createAnnouncer,
  describeJelly,
  eventWords,
  focusOrder,
  isTyping,
  keyAction,
  nearestInDirection,
  sameTarget,
  stepFocus,
  type Announcer,
  type DescribeInfo,
  type KeyAction,
  type SayEvent,
  type Target,
} from "./a11y";
import { COMB, JUVENILE, TAB_ITEMS, keepsakeOf } from "./species";
import { MILESTONES } from "./keepsakes";
import { SCRUB_STEP_MAX } from "./dirt";
import {
  K,
  SHOP_ITEMS,
  SHOP_SCROLLS,
  THEME_NAMES,
  TRAIT_PHRASES,
  camTo,
  geomOf,
  hasTool,
  isFoodTool,
  isShopOpen,
  jellyCentre,
  jellyInfo,
  pearlCentre,
  pearlShowing,
  petJelly,
  screenToWorld,
  scrollShop,
  scrubAt,
  setCursor,
  setTab,
  setTool,
  shopY,
  sprinkle,
  spots,
  view,
  visitorInfo,
  worldToScreen,
  worldToScreenY,
  type BuyResult,
  type State,
  type Tool,
} from "./sim";

/** The .riv's buttons the keyboard can press (contract `buttons`), plus closing the shop. */
export type ButtonName = "feed" | "clean" | "shrimp" | "plankton" | "lamp" | "shop" | "shopClose";

export interface KeyboardHost {
  state: State;
  canvas: HTMLCanvasElement;
  /** artboard -> client coordinates */
  client(x: number, y: number): { x: number; y: number };
  /** a card, tip, note or panel is up (not the shop): the tank's keys wait */
  busy(): boolean;
  audio: { play(name: never): void; unlock(): void };
  /** do what that .riv button does (sounds included) */
  press(name: ButtonName): void;
  /** a tap in the water at a WORLD point: the pearl, a visitor */
  tapWorld(x: number, y: number): void;
  /** the jelly in `slot` was just petted from the keyboard: the sound and its name tag */
  petted(slot: number): void;
  openCard(slot: number): void;
  /** buy shop item i as a tap on its card would (sounds, saving); null when the shop isn't open */
  buy(i: number): BuyResult | null;
  journal: { readonly isOpen: boolean; open(): void; close(): void };
}

export interface Keyboard {
  /** call every frame: the ring follows its target, queued lines go out */
  frame(): void;
  /** a sim event: said out loud if it's one worth hearing */
  event(e: SayEvent): void;
  /** say a line in the moments region (throttled) */
  say(text: string, low?: boolean): void;
  readonly target: Target | null;
}

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-a11y-sr {
  position: fixed; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
#tank:focus { outline: none; }
.jt-a11y-ring {
  position: fixed; z-index: 4; pointer-events: none; box-sizing: border-box;
  border: 3px solid #ffcf4a; border-radius: 10px;
  box-shadow: 0 0 0 2px #2b1712, inset 0 0 0 2px #2b1712;
}
.jt-a11y-ring[hidden] { display: none; }
.jt-a11y-ring-label {
  position: absolute; left: 50%; bottom: 100%; transform: translate(-50%, -6px); white-space: nowrap;
  font: 11px/1 ${FONT}; letter-spacing: 0.04em; text-transform: uppercase;
  color: #2b1712; background: #ffcf4a; border: 2px solid #2b1712; border-radius: 4px; padding: 3px 6px 4px;
}
.jt-a11y-ring.below .jt-a11y-ring-label { bottom: auto; top: 100%; transform: translate(-50%, 6px); }
.jt-a11y-ring-label:empty { display: none; }
.jt-a11y-keys {
  position: fixed; z-index: 4; left: 50%; transform: translate(-50%, -100%); max-width: calc(100vw - 32px); box-sizing: border-box;
  font: 10px/1.5 ${FONT}; text-transform: uppercase; text-align: center; color: #f1e2c4;
  background: #23253a; border: 2px solid #6c7194; border-radius: 6px; padding: 6px 10px; pointer-events: none;
}
.jt-a11y-keys[hidden] { display: none; }
/* reduce motion (the settings toggle, which starts from the OS setting): the HTML's motion, quietened */
:root[data-jt-reduce-motion] .jt-photo-flash { display: none; }
:root[data-jt-reduce-motion] .jt-req-btn.bob { animation: none; }
:root[data-jt-reduce-motion] .jt-rotate .phone { animation: none; }
:root[data-jt-reduce-motion] .jt-tag { animation: jt-a11y-fade 1.6s linear forwards; transform: translate(-50%, -100%); }
:root[data-jt-reduce-motion] .jt-pop { animation: jt-a11y-fade 1.2s linear forwards; transform: translate(-50%, -60%); }
:root[data-jt-reduce-motion] .jt-req-done { animation: jt-a11y-fade 2.4s linear forwards; transform: translate(-50%, 0); }
@keyframes jt-a11y-fade { 0% { opacity: 0; } 8%, 80% { opacity: 1; } 100% { opacity: 0; } }
`;

const BUTTON_LABEL: Record<string, string> = {
  lamp: "Light switch",
  feed: "Food can",
  shrimp: "Brine shrimp jar",
  plankton: "Plankton bottle",
  clean: "Sponge",
  shop: "Shop",
};
/** The shelf button that picks up each tool. */
const BUTTON_OF: Record<Exclude<Tool, "none">, ButtonName> = { food: "feed", sponge: "clean", shrimp: "shrimp", plankton: "plankton" };
const TOOL_WORDS: Record<Exclude<Tool, "none">, string> = { food: "Food can", sponge: "Sponge", shrimp: "Brine shrimp jar", plankton: "Plankton bottle" };

type Rect = { x0: number; y0: number; x1: number; y1: number };
const BUTTONS = (K.buttons as unknown as { name: string; x: number; y: number; w: number; h: number }[] | undefined) ?? [];
const CARDS = (K as unknown as { shopCards?: { x: number; y: number; w: number; h: number; tab: number }[] }).shopCards ?? [];
const TABS = (K as unknown as { shopTabs?: { name: string }[] }).shopTabs ?? [];
/** Every shop card in Tab order: tab by tab, each tab's cards as TAB_ITEMS lists them (reading order). */
const SHOP_ORDER = TAB_ITEMS.flat();

const titleCase = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);
const dollars = (n: number) => `${n} sand dollar${n === 1 ? "" : "s"}`;

export function attachKeyboard(h: KeyboardHost): Keyboard {
  const { state, canvas } = h;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const play = (name: string) => h.audio.play(name as never);

  // ---------------------------------------------------------------- the canvas, the regions, the ring

  const region = (id: string) => {
    const r = document.createElement("div");
    r.className = "jt-a11y-sr";
    r.id = id;
    r.setAttribute("aria-live", "polite");
    r.setAttribute("aria-atomic", "true");
    document.body.append(r);
    return r;
  };
  const focusLive = region("jt-a11y-focus");
  const moments = region("jt-a11y-live");
  /** Repeating the same words wouldn't be read again: alternate a trailing no-break space. */
  const write = (r: HTMLElement, text: string) => {
    r.textContent = r.textContent === text ? `${text}\u00a0` : text;
  };
  const tell = (text: string) => write(focusLive, text);
  const announcer: Announcer = createAnnouncer({ now: () => performance.now(), write: (t) => write(moments, t) });

  const help = document.createElement("div");
  help.className = "jt-a11y-sr";
  help.id = "jt-a11y-help";
  help.textContent =
    "Tab moves between the jellies, the pearl, visitors and the shelf, and arrows jump to the nearest one that way. " +
    "Enter pets a jelly or presses a button, N opens a jelly's card. F feeds, S scrubs the glass, 1 to 4 pick up the foods and the sponge, " +
    "L flips the light, B opens the shop, J the journal, the square brackets look left and right, M mutes, Escape puts things down. " +
    "In the shop, Enter on a decoration you own puts it away, or places it again.";
  document.body.append(help);
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "aquarium");
  canvas.setAttribute("aria-describedby", help.id);

  const ring = document.createElement("div");
  ring.className = "jt-a11y-ring";
  ring.hidden = true;
  ring.setAttribute("aria-hidden", "true");
  const ringLabel = document.createElement("span");
  ringLabel.className = "jt-a11y-ring-label";
  ring.append(ringLabel);
  const keys = document.createElement("div");
  keys.className = "jt-a11y-keys";
  keys.hidden = true;
  keys.setAttribute("aria-hidden", "true");
  keys.textContent = "Tab: next · Enter: pet · N: card · F: feed · S: scrub · L: light · B: shop · J: journal";
  document.body.append(ring, keys);

  let target: Target | null = null;
  /** the last input was a key (a press hides the ring until the next key) */
  let keyed = false;
  let keysShown = false;
  let shopSel = SHOP_ORDER[0] ?? 0;
  let lastFood: Tool = "food";
  let release: ReturnType<typeof setTimeout> | null = null;
  let jellyN = -1;

  window.addEventListener("pointerdown", () => (keyed = false), true);
  canvas.addEventListener("focus", () => {
    if (!keyed) return;
    tell(target ? describe(target) : "Jelly tank. Tab to the first jelly.");
  });
  canvas.addEventListener("blur", () => (keys.hidden = true));

  // ---------------------------------------------------------------- what can be focused, where it is

  const order = () =>
    focusOrder({
      jellies: state.slots.flatMap((j, slot) => (j ? [{ slot, x: j.x }] : [])),
      pearl: pearlShowing(state),
      visitor: (visitorInfo(state)?.on ?? 0) > 0.5,
      buttons: BUTTONS.filter((b) => b.name !== "shrimp" && b.name !== "plankton" ? true : hasTool(state, b.name as Tool)),
    });

  /** The target's box in artboard (screen) coordinates. */
  const rectOf = (t: Target): Rect | null => {
    if (t.kind === "jelly") {
      const j = state.slots[t.slot];
      if (!j) return null;
      // the tap box (sim.ts hit())
      const b = geomOf(j.k, j.g).body;
      const halfW = Math.max(b.halfW + 2, 30);
      const top = Math.max(b.top + 5, 30);
      const below = j.k === COMB && j.g >= JUVENILE ? b.top : 10;
      return { x0: worldToScreen(state, j.x - halfW), x1: worldToScreen(state, j.x + halfW), y0: worldToScreenY(state, j.y - top), y1: worldToScreenY(state, j.y + below) };
    }
    if (t.kind === "pearl") {
      if (!pearlShowing(state)) return null;
      const p = pearlCentre(state);
      return { x0: worldToScreen(state, p.x - 30), x1: worldToScreen(state, p.x + 30), y0: worldToScreenY(state, p.y - 30), y1: worldToScreenY(state, p.y + 30) };
    }
    if (t.kind === "visitor") {
      const v = visitorInfo(state);
      if (!v || v.on <= 0.5) return null;
      return { x0: worldToScreen(state, v.x - 54), x1: worldToScreen(state, v.x + 54), y0: worldToScreenY(state, v.y - 48), y1: worldToScreenY(state, v.y + 48) };
    }
    const b = BUTTONS.find((x) => x.name === t.name);
    return b ? { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } : null;
  };
  const centreOf = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

  /** The shop card's box on screen, or null when it's scrolled out of the list's window. */
  const cardRect = (i: number): Rect | null => {
    const c = CARDS[i];
    if (!c) return null;
    const w = SHOP_SCROLLS[c.tab];
    const scroll = w && c.tab === state.tab ? state.shopScroll : 0;
    if (w && (c.y - scroll < w.viewTop - 1 || c.y + c.h - scroll > w.viewBottom + 1)) return null;
    // the list's window slides with the shop
    const dy = shopY(state) - scroll;
    return { x0: c.x, y0: c.y + dy, x1: c.x + c.w, y1: c.y + c.h + dy };
  };

  // ---------------------------------------------------------------- words

  const jellyWords = (slot: number) => {
    const i = jellyInfo(state, slot);
    // v13: its personality, as the card says it ("shy — hides by the rocks")
    return i ? describeJelly({ ...i, trait: TRAIT_PHRASES[i.trait] } as DescribeInfo) : "";
  };
  const describe = (t: Target): string => {
    if (t.kind === "jelly") return jellyWords(t.slot);
    if (t.kind === "pearl") return "Today's pearl, in the clam. Enter to collect it.";
    if (t.kind === "visitor") {
      const v = visitorInfo(state);
      return v ? `${/^[aeiou]/i.test(v.name) ? "An" : "A"} ${v.name}, visiting. Enter to say hello.` : "";
    }
    const label = BUTTON_LABEL[t.name] ?? t.name;
    if (t.name === "lamp") return `${label}, ${state.nightTarget ? "night" : "day"}.`;
    if (t.name === "shop") return `${label}. You have ${dollars(state.dollars)}.`;
    const tool = (Object.keys(BUTTON_OF) as Exclude<Tool, "none">[]).find((k) => BUTTON_OF[k] === t.name);
    return `${label}${tool && state.tool === tool ? ", in hand" : ""}.`;
  };
  const shortLabel = (t: Target): string =>
    t.kind === "jelly" ? jellyInfo(state, t.slot)?.name ?? "" : t.kind === "pearl" ? "Pearl" : t.kind === "visitor" ? visitorInfo(state)?.name ?? "" : BUTTON_LABEL[t.name] ?? "";

  const cardWords = (i: number, withTab: boolean): string => {
    const it = SHOP_ITEMS[i];
    if (!it) return "";
    const v = view(state);
    // v15: an owned decoration's card says where it is and what Enter does with it
    const decor = it.kind === "decor" && state.owned[it.d] ? (state.stored[it.d] ? "put away, Enter places it" : "in the tank, Enter puts it away") : "";
    const status = decor || (v[`use${i}`] ? "in use" : v[`own${i}`] ? "owned" : v[`lock${i}`] ? "not available yet" : "");
    const tab = CARDS[i]?.tab ?? 0;
    const list = TAB_ITEMS[tab] ?? [];
    const head = withTab ? `${titleCase(TABS[tab]?.name ?? "")} tab. ` : "";
    return `${head}${titleCase(it.name)}, ${it.price ? dollars(it.price) : "free"}${status ? `, ${status}` : ""}. ${list.indexOf(i) + 1} of ${list.length}.`;
  };
  const buyWords = (i: number, r: BuyResult | null): string => {
    const it = SHOP_ITEMS[i];
    const name = titleCase(it?.name ?? "");
    switch (r) {
      case "bought":
        return `Bought ${name}. ${dollars(state.dollars)} left.`;
      case "selected":
        return `${name} theme on.`;
      case "putAway":
        return `${name} put away. Enter places it again.`;
      case "placed":
        return `${name} placed in the tank.`;
      case "cantAfford":
        return `Not enough sand dollars: ${name} costs ${it?.price ?? 0}, you have ${state.dollars}.`;
      case "tankFull":
        return "The tank is full. Rehome a jelly or get a bigger tank.";
      case "owned":
        return it?.kind === "theme" ? `${name} is already in use.` : `${name} is already yours.`;
      case "needsMedium":
        return "That needs the medium tank first.";
      case "needsLarge":
        return "That needs the large tank first.";
      case "keepsake": {
        const m = MILESTONES[keepsakeOf(it)];
        return m ? `${name} is a keepsake, not for sale. To earn it: ${m.title.toLowerCase()}.` : `${name} is a keepsake.`;
      }
    }
    return "";
  };

  // ---------------------------------------------------------------- moving the focus

  /** Keep a world thing in view: an eased pan (a jump with reduce motion) if it's near or past an edge. */
  const showWorldX = (x: number) => {
    const sx = worldToScreen(state, x);
    if (sx < K.glassL + 50 || sx > K.glassR - 50) camTo(state, x);
  };
  const setTarget = (t: Target | null, speak = true) => {
    target = t;
    if (!t) return;
    if (t.kind === "jelly") {
      const j = state.slots[t.slot];
      if (j) showWorldX(j.x);
    } else if (t.kind === "pearl") showWorldX(pearlCentre(state).x);
    if (speak) tell(describe(t));
  };
  /** Where food and the sponge aim (WORLD): the focused jelly, else the middle of the view. */
  const aim = (): { x: number; y: number } => {
    if (target?.kind === "jelly") {
      const j = state.slots[target.slot];
      if (j) return { x: j.x, y: j.y - geomOf(j.k, j.g).body.top - 40 };
    }
    return { x: screenToWorld(state, K.W / 2), y: 320 };
  };
  /** The screen x of a world x once any camera move under way has landed (the held item waits there). */
  const screenXAfter = (x: number) => x + (state.cam.ease ? state.cam.ease.to : state.cam.x);
  const showHeld = (sx: number, sy: number) => {
    setCursor(state, sx, sy, true, true);
    if (release) clearTimeout(release);
    release = setTimeout(() => setCursor(state, sx, sy, false, true), 240);
  };

  // ---------------------------------------------------------------- actions

  const pick = (tool: Exclude<Tool, "none">) => {
    if (!hasTool(state, tool)) {
      tell(`${TOOL_WORDS[tool]} isn't on the shelf yet. The shop sells it.`);
      return;
    }
    h.press(BUTTON_OF[tool]);
    if (isFoodTool(tool)) lastFood = tool;
    if (state.tool === tool) {
      const a = aim();
      setCursor(state, screenXAfter(a.x), Math.max(K.waterTop + 30, a.y), false, true);
    }
    tell(state.tool === tool ? `${TOOL_WORDS[tool]} in hand.` : `${TOOL_WORDS[tool]} put down.`);
  };

  const feed = () => {
    if (!isFoodTool(state.tool)) h.press(BUTTON_OF[hasTool(state, lastFood) && lastFood !== "none" ? (lastFood as Exclude<Tool, "none">) : "food"]);
    if (!isFoodTool(state.tool)) return; // the hand is refused (a card's close-up)
    const a = aim();
    const y = Math.min(Math.max(a.y, K.waterTop + 30), K.cabTop - 80);
    showHeld(screenXAfter(a.x), y);
    if (sprinkle(state, a.x, y) > 0) {
      play("pour");
      setTimeout(() => play("plop"), 260);
    }
  };

  const scrub = () => {
    if (state.tool !== "sponge") h.press("clean");
    if (state.tool !== "sponge") return;
    const a = aim();
    const from = target?.kind === "jelly" ? jellyCentre(state, target.slot) ?? a : a;
    const span = { x0: screenToWorld(state, K.glassL), x1: screenToWorld(state, K.glassR) };
    // the nearest dirty spot, one on screen before any off it
    const best = spots(state)
      .map((sp) => ({ sp, d: Math.hypot(sp.x - from.x, sp.y - from.y) + (sp.x < span.x0 || sp.x > span.x1 ? 1e5 : 0) }))
      .sort((p, q) => p.d - q.d)[0]?.sp;
    if (!best) {
      tell("The glass is clean.");
      return;
    }
    showWorldX(best.x);
    showHeld(screenXAfter(best.x), best.y);
    const got = scrubAt(state, best.x, best.y, SCRUB_STEP_MAX) + scrubAt(state, best.x, best.y, SCRUB_STEP_MAX);
    if (got > 0) play("scrub");
    if (!spots(state).some((sp) => sp.i === best.i)) tell("Spot cleaned.");
  };

  const selectCard = (i: number, withTab = false) => {
    const c = CARDS[i];
    if (!c) return;
    if (c.tab !== state.tab) {
      setTab(state, c.tab);
      play("ui");
      withTab = true;
    }
    shopSel = i;
    const w = SHOP_SCROLLS[c.tab];
    if (w) {
      // scroll the tab's list (JELLIES; v13 DECOR and TANK too) so the card is inside its window
      const want = Math.min(Math.max(state.shopScroll, c.y + c.h - w.viewBottom), c.y - w.viewTop);
      const to = Math.min(Math.max(want, 0), w.max);
      scrollShop(state, state.shopScroll - to);
    }
    tell(cardWords(i, withTab));
  };

  const shopAct = (a: KeyAction) => {
    const list = TAB_ITEMS[state.tab] ?? [];
    if (!list.includes(shopSel)) shopSel = list[0] ?? shopSel;
    if (a.kind === "shopMove") {
      const pts = list.map((i) => ({ x: (CARDS[i]?.x ?? 0) + (CARDS[i]?.w ?? 0) / 2, y: (CARDS[i]?.y ?? 0) + (CARDS[i]?.h ?? 0) / 2 }));
      const at = list.indexOf(shopSel);
      const n = nearestInDirection(pts[at] ?? { x: 0, y: 0 }, pts, a.dx, a.dy, at);
      if (n >= 0) selectCard(list[n]!);
      else if (a.dx !== 0) {
        // off the side of the tab: on to the next tab's first card (the last one's, going left)
        const t = state.tab + a.dx;
        const next = TAB_ITEMS[t];
        if (next?.length) selectCard((a.dx > 0 ? next[0] : next[next.length - 1])!);
      }
    } else if (a.kind === "shopStep") {
      const k = SHOP_ORDER.indexOf(shopSel);
      selectCard(SHOP_ORDER[(k + a.d + SHOP_ORDER.length) % SHOP_ORDER.length]!);
    } else if (a.kind === "shopTab") {
      const next = TAB_ITEMS[(state.tab + a.d + TAB_ITEMS.length) % TAB_ITEMS.length];
      if (next?.length) selectCard(next[0]!);
    } else if (a.kind === "buy") {
      tell(buyWords(shopSel, h.buy(shopSel)));
    }
  };

  const act = (a: KeyAction): boolean => {
    switch (a.kind) {
      case "next":
      case "prev": {
        const t = stepFocus(order(), target, a.kind === "next" ? 1 : -1);
        setTarget(t);
        return t !== null; // null: let the browser's Tab carry focus out of the canvas
      }
      case "move": {
        const ts = order();
        const rs = ts.map((t) => rectOf(t));
        const pts = rs.map((r) => (r ? centreOf(r) : { x: NaN, y: NaN }));
        const at = target ? ts.findIndex((t) => sameTarget(t, target)) : -1;
        const from = at >= 0 ? pts[at]! : { x: K.W / 2, y: (K.waterTop + K.cabTop) / 2 };
        const n = nearestInDirection(from, pts, a.dx, a.dy, at);
        if (n >= 0) setTarget(ts[n]!);
        else if (at < 0 && ts.length) setTarget(ts[0]!);
        return true;
      }
      case "activate": {
        if (!target) {
          setTarget(order()[0] ?? null);
          return true;
        }
        const t = target;
        if (t.kind === "jelly") {
          if (petJelly(state, t.slot)) h.petted(t.slot);
        } else if (t.kind === "pearl") {
          const p = pearlCentre(state);
          h.tapWorld(p.x, p.y);
        } else if (t.kind === "visitor") {
          const v = visitorInfo(state);
          if (v) h.tapWorld(v.x, v.y);
        } else {
          const tool = (Object.keys(BUTTON_OF) as Exclude<Tool, "none">[]).find((k) => BUTTON_OF[k] === t.name);
          if (tool) {
            pick(tool);
            return true;
          }
          h.press(t.name as ButtonName);
          if (t.name === "shop") {
            selectCard(TAB_ITEMS[0]?.[0] ?? 0, true);
            return true;
          }
          tell(describe(t));
        }
        return true;
      }
      case "card":
        if (target?.kind === "jelly" && state.slots[target.slot]) h.openCard(target.slot);
        else tell("Tab to a jelly first, then press N for its card.");
        return true;
      case "feed":
        feed();
        return true;
      case "scrub":
        scrub();
        return true;
      case "lamp":
        h.press("lamp");
        tell(state.nightTarget ? "Lights off: night." : "Lights on: day.");
        return true;
      case "shop":
        if (isShopOpen(state)) {
          h.press("shopClose");
          tell("Shop closed.");
        } else {
          h.press("shop");
          if (!isShopOpen(state)) return true;
          if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
          selectCard(TAB_ITEMS[0]?.[0] ?? 0, true);
        }
        return true;
      case "journal":
        if (h.journal.isOpen) h.journal.close();
        else h.journal.open();
        return true;
      case "pan":
        camTo(state, screenToWorld(state, K.W / 2) + a.dir * (K.W / 2));
        return true;
      case "hold":
        pick(HOLD_KEYS[a.n] ?? "food");
        return true;
      case "escape":
        if (state.tool !== "none") {
          setTool(state, "none");
          play("putdown");
          return true;
        }
        return false;
      default:
        shopAct(a);
        return true;
    }
  };

  window.addEventListener("keydown", (e) => {
    if (isTyping(e.target)) return;
    keyed = true;
    const onCanvas = document.activeElement === canvas;
    if (h.busy()) {
      // a panel has the keys; J still puts the journal away
      if (h.journal.isOpen && (e.key === "j" || e.key === "J") && !e.ctrlKey && !e.metaKey && !e.altKey) h.journal.close();
      return;
    }
    const a = keyAction(e, { onCanvas, shopOpen: isShopOpen(state) });
    if (!a) return;
    h.audio.unlock();
    if (onCanvas && !keysShown) {
      keysShown = true;
      // just above the cabinet, clear of the shelf
      keys.style.top = `${h.client(K.W / 2, K.cabTop - 12).y}px`;
      keys.hidden = false;
      setTimeout(() => (keys.hidden = true), 8000);
    }
    if (act(a)) e.preventDefault();
  });

  // ---------------------------------------------------------------- every frame

  const place = () => {
    const open = isShopOpen(state);
    const show = keyed && document.activeElement === canvas && !h.busy();
    let r: Rect | null = null;
    let label = "";
    if (show && open) {
      r = cardRect(shopSel);
    } else if (show && target) {
      r = rectOf(target);
      label = r ? shortLabel(target) : "";
    }
    if (show && !open && !target) r = { x0: K.glassL + 6, y0: K.waterTop + 6, x1: K.glassR - 6, y1: K.cabTop - 6 };
    if (!r || r.x1 < 0 || r.x0 > K.W) {
      ring.hidden = true;
      return;
    }
    const a = h.client(Math.max(r.x0, 2), r.y0);
    const b = h.client(Math.min(r.x1, K.W - 2), r.y1);
    Object.assign(ring.style, { left: `${a.x - 4}px`, top: `${a.y - 4}px`, width: `${b.x - a.x + 8}px`, height: `${b.y - a.y + 8}px` });
    ring.classList.toggle("below", a.y < 60);
    if (ringLabel.textContent !== label) ringLabel.textContent = label;
    ring.hidden = false;
  };

  return {
    frame() {
      // a target that's gone (the pearl taken, a visitor left, a jelly rehomed) lets go
      if (target && !rectOf(target)) target = null;
      place();
      announcer.flush();
      const n = state.slots.filter(Boolean).length;
      if (n !== jellyN) {
        jellyN = n;
        canvas.setAttribute("aria-label", `Jelly Tank: an aquarium with ${n} ${n === 1 ? "jelly" : "jellies"}`);
      }
    },
    event(e) {
      const w = eventWords(
        e,
        (slot) => {
          const i = jellyInfo(state, slot);
          return i && { name: i.name, k: i.k, g: i.g };
        },
        (n) => THEME_NAMES[n] ?? "New",
      );
      if (w) announcer.say(w.text, w.low);
    },
    say: (text, low) => announcer.say(text, low),
    get target() {
      return target;
    },
  };
}

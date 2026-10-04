/**
 * Accessibility, mostly without the DOM: which key does what, the order Tab walks the tank in, arrow-key
 * neighbours, how a jelly is described out loud, what the screen reader hears when something happens (and
 * how often), and where the reduce-motion setting is kept. src/keyboard.ts wires these to the page; the
 * HTML panels use focusReturn() to hand focus back when they close.
 */
import { SPECIES_NAMES } from "./species";
import { MILESTONES } from "./keepsakes";
import { FIND_ITEMS, FIND_SETS } from "./finds";
import { VISITORS, VISITOR_NAMES, nightVisitor } from "./visitors";
import { gelWords } from "./gels";
import { settingWords, settledWords } from "./temperature";

// ---------------------------------------------------------------- keys

/** Just what the key map reads of a KeyboardEvent. */
export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export type KeyAction =
  | { kind: "next" } // Tab: the next thing in the tank (or out of it, past the last)
  | { kind: "prev" } // Shift+Tab
  | { kind: "move"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 } // arrows: the nearest thing that way
  | { kind: "activate" } // Enter / Space: pet the jelly, take the pearl, greet the visitor, press the button
  | { kind: "card" } // N / Shift+Enter: the focused jelly's card
  | { kind: "feed" } // F: pick up food and sprinkle over the focused jelly (or the middle of the view)
  | { kind: "scrub" } // S: the sponge on the nearest dirty spot
  | { kind: "lamp" } // L
  | { kind: "shop" } // B: open the shop, or close it
  | { kind: "journal" } // J
  | { kind: "pan"; dir: -1 | 1 } // [ and ]: look left / right
  | { kind: "hold"; n: number } // 1-4: the can, the shrimp jar, the plankton bottle, the sponge
  | { kind: "escape" } // put down what's in hand, close the shop
  | { kind: "gel" } // ---- lamp gels ---- G: the next gel on the lamp
  | { kind: "heater" } // ---- temperature ---- H: the heater on or off
  | { kind: "chiller" } // ---- temperature ---- C: the chiller on or off
  // the shop, while it's open
  | { kind: "shopMove"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: "shopStep"; d: -1 | 1 } // Tab / Shift+Tab: the next card, on into the next tab
  | { kind: "shopTab"; d: -1 | 1 } // PageUp / PageDown
  | { kind: "buy" };

/** Shelf items for the number keys, in shelf order (the hand items left to right, then the sponge). */
export const HOLD_KEYS = ["food", "shrimp", "plankton", "sponge"] as const;

const ARROWS: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * What a key press asks for. `onCanvas`: the tank has keyboard focus (Tab, arrows, Enter and Space only act
 * then; elsewhere they belong to the focused button). `shopOpen`: the arrows, Tab, Enter and Space walk and
 * buy the shop's cards instead, and only B and Escape of the letters still work. Keys with Ctrl, Cmd or Alt
 * held are the browser's. M (mute) is the settings menu's and isn't mapped here.
 */
export function keyAction(e: KeyLike, ctx: { onCanvas: boolean; shopOpen: boolean }): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key;
  const arrow = ARROWS[k];
  if (ctx.shopOpen) {
    if (k === "Escape" || k === "b" || k === "B") return { kind: "shop" };
    if (!ctx.onCanvas) return null;
    if (arrow) return { kind: "shopMove", dx: arrow[0], dy: arrow[1] };
    if (k === "Tab") return { kind: "shopStep", d: e.shiftKey ? -1 : 1 };
    if (k === "PageUp" || k === "PageDown") return { kind: "shopTab", d: k === "PageUp" ? -1 : 1 };
    if (k === "Enter" || k === " ") return { kind: "buy" };
    return null;
  }
  if (ctx.onCanvas) {
    if (k === "Tab") return { kind: e.shiftKey ? "prev" : "next" };
    if (arrow) return { kind: "move", dx: arrow[0], dy: arrow[1] };
    if (k === "Enter") return { kind: e.shiftKey ? "card" : "activate" };
    if (k === " ") return { kind: "activate" };
  }
  switch (k.length === 1 ? k.toLowerCase() : k) {
    case "f":
      return { kind: "feed" };
    case "s":
      return { kind: "scrub" };
    case "l":
      return { kind: "lamp" };
    case "b":
      return { kind: "shop" };
    case "j":
      return { kind: "journal" };
    case "n":
      return { kind: "card" };
    case "[":
      return { kind: "pan", dir: -1 };
    case "]":
      return { kind: "pan", dir: 1 };
    case "1":
    case "2":
    case "3":
    case "4":
      return { kind: "hold", n: Number(k) - 1 };
    case "Escape":
      return { kind: "escape" };
    case "g": // ---- lamp gels ----
      return { kind: "gel" };
    case "h": // ---- temperature ----
      return { kind: "heater" };
    case "c":
      return { kind: "chiller" };
  }
  return null;
}

/** Typing in a field (a jelly's name, a share code): every key is the field's. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!t) return false;
  const tag = String(t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
}

// ---------------------------------------------------------------- focus inside the tank

/** Something in the canvas the keyboard can land on. Buttons are the .riv's (contract `buttons` names). */
export type Target = { kind: "jelly"; slot: number } | { kind: "pearl" } | { kind: "visitor" } | { kind: "button"; name: string };

export const sameTarget = (a: Target | null, b: Target | null): boolean =>
  !!a && !!b && a.kind === b.kind && (a.kind !== "jelly" || a.slot === (b as { slot: number }).slot) && (a.kind !== "button" || a.name === (b as { name: string }).name);

/**
 * The order Tab walks: the jellies left to right through the whole tank (the camera follows), then today's
 * pearl, a visiting animal, and the shelf left to right (light switch, foods, sponge, shop). The request note
 * and the gear come after the canvas in the page, so one more Tab reaches them.
 */
export function focusOrder(t: {
  jellies: readonly { slot: number; x: number }[];
  pearl: boolean;
  visitor: boolean;
  buttons: readonly { name: string; x: number }[];
}): Target[] {
  const js = [...t.jellies].sort((a, b) => a.x - b.x || a.slot - b.slot);
  const bs = [...t.buttons].sort((a, b) => a.x - b.x);
  return [
    ...js.map((j): Target => ({ kind: "jelly", slot: j.slot })),
    ...(t.pearl ? [{ kind: "pearl" } as Target] : []),
    ...(t.visitor ? [{ kind: "visitor" } as Target] : []),
    ...bs.map((b): Target => ({ kind: "button", name: b.name })),
  ];
}

/**
 * Tab from `current` (d = 1) or back (d = -1). From nothing it starts at the first (or last); past either end
 * it returns null: focus leaves the canvas for the page's next (or previous) control. A current target that
 * has gone (a rehomed jelly) starts over.
 */
export function stepFocus(order: readonly Target[], current: Target | null, d: 1 | -1): Target | null {
  if (!order.length) return null;
  const i = current ? order.findIndex((t) => sameTarget(t, current)) : -1;
  if (i < 0) return (d > 0 ? order[0] : order[order.length - 1]) ?? null;
  return order[i + d] ?? null;
}

/**
 * The nearest point in direction (dx, dy) from `from`, or -1. Only points ahead count (within 60 degrees of
 * the arrow); the distance across the arrow weighs double, so Right picks the jelly beside you over one far
 * below and only a little to the right.
 */
export function nearestInDirection(from: { x: number; y: number }, points: readonly { x: number; y: number }[], dx: number, dy: number, skip = -1): number {
  let best = -1;
  let bestScore = Infinity;
  points.forEach((p, i) => {
    if (i === skip) return;
    const vx = p.x - from.x;
    const vy = p.y - from.y;
    const along = vx * dx + vy * dy;
    const across = Math.abs(vx * dy - vy * dx);
    if (along <= 0.5 || across > along * 1.75) return;
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// ---------------------------------------------------------------- words

const SPECIES_WORDS = SPECIES_NAMES.map((n) => n.toLowerCase());

/** "moon jelly polyp", "baby blue blubber", "juvenile comb jelly", "adult lion's mane" */
export function jellyKind(k: number, g: number): string {
  const sp = SPECIES_WORDS[k] ?? "jelly";
  return g <= 0 ? `${sp} polyp` : g === 1 ? `baby ${sp}` : g === 2 ? `juvenile ${sp}` : `adult ${sp}`;
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

export const fullnessWord = (f: number) => (f >= 0.75 ? "full" : f >= 0.4 ? "fed" : f >= 0.15 ? "hungry" : "very hungry");
export const moodWord = (m: number) => (m >= 0.7 ? "happy" : m >= 0.4 ? "content" : "glum");

/** What jellyInfo gives (plus a personality, once jellies have one: `trait` or `personality`). */
export interface DescribeInfo {
  name: string;
  k: number;
  g: number;
  fullness: number;
  mood: number;
  morph?: number;
  trait?: unknown;
  personality?: unknown;
  /** v16: its mate's name when it's paired */
  mate?: string | null;
}

/** v16: each colour morph as said (0 none: nothing). */
const COLOUR_SAID: Readonly<Record<number, string>> = { 1: "rare colour", 2: "ghost colour", 4: "dusk colour", 5: "pearl colour" };

/** "Muffin, juvenile moon jelly, full, happy, shy" */
export function describeJelly(i: DescribeInfo): string {
  const trait = [i.trait, i.personality].find((t): t is string => typeof t === "string" && t.trim() !== "");
  const colour = COLOUR_SAID[i.morph ?? 0] ?? "";
  const mate = i.mate ? `paired with ${i.mate}` : "";
  return [i.name, jellyKind(i.k, i.g), colour, fullnessWord(i.fullness), moodWord(i.mood), trait?.toLowerCase(), mate].filter(Boolean).join(", ");
}

/** A sim event worth saying out loud, as the step gives it (sim.ts SimEvent). */
export interface SayEvent {
  type: string;
  slot?: number;
  stage?: number;
  amount?: number;
  kind?: string;
  fav?: boolean;
  theme?: number;
  /** v13 "keepsake": the milestone (index into MILESTONES) */
  keepsake?: number;
  /** v13 "rode": the bubbler was on screen */
  seen?: boolean;
  /** v14 "visitorArrived": the first time this kind ever came; v16 "found": the first of its kind */
  first?: boolean;
  /** ---- lamp gels ---- "gel": the gel now on the lamp */
  gel?: number;
  /** ---- temperature ---- "thermo": the unit (1 heater, -1 chiller); "thermo", "settled": the setting, the water's °C */
  dir?: number;
  /** "thermo", "settled": the temperature setting; v16 "setDone": which find set (FIND_SETS) */
  set?: number;
  temp?: number;
  /** v16 "found": which find (FIND_ITEMS) */
  find?: number;
  /** v16 "baby": the parent's slot, and the other parent's for a pair's baby; "paired": the new pair's second jelly */
  parent?: number;
  mate?: number;
}

/** v14: how each night visitor's arrival is said (they're rare: worth a line of their own). */
const NIGHT_ARRIVALS: Record<string, string> = {
  octopus: "An octopus is peeking over a rock.",
  manta: "A manta ray is gliding past overhead.",
  hermit: "A hermit crab is out on the sand.",
};

/** v13: what a keepsake unlock says: the last sentence of its note ("A little lighthouse washed up for you."). */
export function keepsakeWords(m: number): string | null {
  const note = MILESTONES[m]?.note;
  if (!note) return null;
  const parts = note.split(/(?<=\.)\s+/);
  return parts[parts.length - 1] ?? note;
}

/**
 * The words for a sim event, and whether it's a "low" one (said only now and then: meals, spots), or null for
 * events nobody needs to hear (pulses, every sand dollar). `jelly(slot)` gives that jelly's name and kind.
 */
export function eventWords(
  e: SayEvent,
  jelly: (slot: number) => { name: string; k: number; g: number } | null,
  themeName: (n: number) => string = (n) => `Theme ${n}`,
): { text: string; low: boolean } | null {
  const j = e.slot !== undefined ? jelly(e.slot) : null;
  const plus = (n: number | undefined) => (n ? `+${n} sand dollar${n === 1 ? "" : "s"}` : "");
  switch (e.type) {
    case "ate":
      return j ? { text: `${j.name} ate${e.fav ? " a favourite" : ""}.`, low: true } : null;
    case "grew": {
      if (!j) return null;
      const kind = jellyKind(j.k, j.g);
      return { text: j.g === 1 ? `${j.name} budded into ${article(kind)} ${kind}.` : `${j.name} grew into ${article(kind)} ${kind}.`, low: false };
    }
    case "baby": {
      if (!j) return null;
      // v16: a pair's baby names both parents
      const pa = e.mate !== undefined && e.parent !== undefined ? jelly(e.parent) : null;
      const pb = pa && e.mate !== undefined ? jelly(e.mate) : null;
      const from = pa && pb ? ` to ${pa.name} and ${pb.name}` : "";
      return { text: `A new jelly was born${from}: ${j.name}, ${article(jellyKind(j.k, j.g))} ${jellyKind(j.k, j.g)}.`, low: false };
    }
    case "paired": {
      const m = e.mate !== undefined ? jelly(e.mate) : null;
      return j && m ? { text: `${j.name} and ${m.name} are a pair now.`, low: false } : null;
    }
    case "pearlReady":
      return { text: "The pearl is ready.", low: false };
    case "pearl":
      return { text: `Pearl collected: ${plus(e.amount)}.`, low: false };
    case "visitorArrived": {
      const k = e.kind ? (VISITORS as readonly string[]).indexOf(e.kind) : -1;
      const text = k >= 0 && nightVisitor(k)
        ? NIGHT_ARRIVALS[e.kind!] ?? `${article(VISITOR_NAMES[k]!) === "an" ? "An" : "A"} ${VISITOR_NAMES[k]} is visiting.`
        : `${e.kind ? `${article(e.kind) === "an" ? "An" : "A"} ${e.kind}` : "A visitor"} is visiting.`;
      // v14: a first sighting is new in the journal's visitor log
      return { text: e.first && k >= 0 ? `${text} New in your visitor log.` : text, low: false };
    }
    case "visitorTapped": {
      const k = e.kind ? (VISITORS as readonly string[]).indexOf(e.kind) : -1;
      const name = k >= 0 && nightVisitor(k) ? VISITOR_NAMES[k] : e.kind;
      return e.amount ? { text: `You greeted the ${name ?? "visitor"}: ${plus(e.amount)}.`, low: false } : null;
    }
    case "requestDone":
      return { text: `Request done${e.amount ? `: ${plus(e.amount)}` : ""}.`, low: false };
    case "spotCleaned":
      return { text: "Spot cleaned: +1 sand dollar.", low: true };
    case "upgraded":
      return { text: "The tank is bigger now.", low: false };
    case "themed":
      return { text: `${themeName(e.theme ?? 0)} theme on.`, low: false };
    case "dug":
      return { text: `The crab dug up treasure: ${plus(e.amount)}.`, low: true };
    case "keepsake": {
      const text = e.keepsake !== undefined ? keepsakeWords(e.keepsake) : null;
      return text ? { text, low: false } : null;
    }
    case "rode":
      // only a ride you could see (the bubbler on screen), and now and then: rides are frequent
      return j && e.seen ? { text: `${j.name} rode the bubbler.`, low: true } : null;
    case "gel": // ---- lamp gels ----
      return { text: gelWords(e.gel ?? 0), low: false };
    case "thermo": // ---- temperature ----
      return e.dir ? { text: settingWords(e.dir, e.set ?? 0), low: false } : null;
    case "settled":
      return e.temp !== undefined ? { text: settledWords(e.set ?? 0, e.temp), low: false } : null;
    case "found": {
      // v16: sea glass or a shell turned up and went in the jar
      const it = FIND_ITEMS[e.find ?? -1];
      if (!it) return null;
      const name = `${it.set === 0 ? "piece of " : ""}${it.name.toLowerCase()}`; // "a piece of red sea glass"
      return e.first
        ? { text: `You found ${article(name)} ${name}! New in your collection.`, low: false }
        : { text: `You found another ${name}${e.amount ? `: ${plus(e.amount)}` : ""}.`, low: false };
    }
    case "setDone": {
      const st = FIND_SETS[e.set ?? -1];
      return st ? { text: `${st.title} complete! ${st.reward.charAt(0).toUpperCase()}${st.reward.slice(1)} is in your tank.`, low: false } : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- the live region, throttled

export interface Announcer {
  /** Queue a line. Low lines (meals) are dropped unless the room has been quiet a while. */
  say(text: string, low?: boolean): void;
  /** Speak what's queued if enough time has passed (call it every frame). */
  flush(): void;
}

/**
 * Lines go out at most every `gapMs`, up to `batch` joined at once (anything more is dropped: the screen
 * reader shouldn't narrate a feeding frenzy). A low line is said only when nothing else is waiting and no
 * other low line went out in the last `lowGapMs`. The same line twice in a row while queued is said once.
 */
export function createAnnouncer(o: { now(): number; write(text: string): void; gapMs?: number; lowGapMs?: number; batch?: number }): Announcer {
  const gap = o.gapMs ?? 2500;
  const lowGap = o.lowGapMs ?? 20_000;
  const batch = o.batch ?? 3;
  let queue: string[] = [];
  let lastWrite = -Infinity;
  let lastLow = -Infinity;
  const flush = () => {
    const now = o.now();
    if (!queue.length || now - lastWrite < gap) return;
    o.write(queue.slice(0, batch).join(" "));
    queue = [];
    lastWrite = now;
  };
  return {
    say(text, low = false) {
      if (!text) return;
      const now = o.now();
      if (low) {
        if (queue.length || now - lastLow < lowGap || now - lastWrite < gap) return;
        lastLow = now;
      }
      if (!queue.includes(text)) queue.push(text);
      if (queue.length > batch) queue = queue.slice(0, batch);
      flush();
    },
    flush,
  };
}

// ---------------------------------------------------------------- reduce motion, stored

export const REDUCE_MOTION_KEY = "jellytank:reduceMotion";

/** The saved choice ("1" / "0"), else the OS's prefers-reduced-motion. Storage that throws counts as unsaved. */
export function readReducedMotion(store: Pick<Storage, "getItem"> | null, osPrefers: boolean): boolean {
  try {
    const v = store?.getItem(REDUCE_MOTION_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* no storage: follow the OS */
  }
  return osPrefers;
}

export function writeReducedMotion(store: Pick<Storage, "setItem"> | null, on: boolean): void {
  try {
    store?.setItem(REDUCE_MOTION_KEY, on ? "1" : "0");
  } catch {
    /* no storage: it lasts this visit */
  }
}

// ---------------------------------------------------------------- dialogs

/**
 * Focus for an HTML dialog (a card, the journal, a share panel). opened() remembers what had focus; closed()
 * gives it back, if focus was inside the dialog or nowhere (it may have moved on by itself). A control that
 * has since gone or is hidden (a menu item) hands it to the tank canvas instead.
 */
export function focusReturn(panel: HTMLElement): { opened(): void; closed(): void } {
  let back: HTMLElement | null = null;
  return {
    opened() {
      const a = document.activeElement;
      if (a instanceof HTMLElement && !panel.contains(a) && a !== document.body) back = a;
    },
    closed() {
      const a = document.activeElement;
      const was = back;
      back = null;
      if (a && a !== document.body && !panel.contains(a)) return;
      const to = was && was.isConnected && was.getClientRects().length > 0 ? was : document.getElementById("tank");
      to?.focus({ preventScroll: true });
    },
  };
}

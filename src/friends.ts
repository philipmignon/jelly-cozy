/**
 * Friends on the synced copy (window.__JELLYTANK_SYNC): live visits and gifts.
 *
 * Live tanks: each signed-in player's tank share code is published to `tanks/<id>` as
 * `{ code, at }`, throttled like the cloud save and only when the code changed. A live visit
 * code (`JTLIVE1.<id>`) names a friend's id; opening it reads their tank as it is now.
 *
 * Gifts: a gift lives in the GIVER's own document, `gifts/<giverId>` =
 * `{ to: [recipientId...], sent: { <recipientId>: [{ kind, at }...] } }`. The db rules can't say
 * "anyone may create here, only the recipient may read or delete": a prefix rule's write level is
 * never below its read level, and it governs every sibling's subtree at once. Keyed by giver,
 * the `gifts/{self}` rule proves who sent each gift (nobody can forge one from someone else or
 * delete someone else's), and the recipient finds theirs with one `array-contains` query.
 * The recipient can't delete the giver's document, so a claim is marked in the recipient's
 * private `data/users/<id>/gifts` as the newest gift time claimed per giver; the giver prunes
 * old entries whenever they give again.
 *
 * Nothing in a gift is trusted beyond its kind (one of GIFT_KINDS) and its time: the recipient
 * takes at most one gift per giver per day, at most MAX_CLAIM per open, and never a gift dated
 * in the future.
 */
import { dayKey } from "./sim";

export const LIVE_PREFIX = "JTLIVE1.";
export const GIFT_KINDS = ["snack", "shell"] as const;
export type GiftKind = (typeof GIFT_KINDS)[number];
/** Sand dollars in a shell. */
export const SHELL_DOLLARS = 5;
/** Gifts applied per open, all givers together. */
export const MAX_CLAIM = 10;
/** Gifts the giver's document keeps per friend (one a day: a week's worth). */
const KEEP_PER_FRIEND = 7;
/** Older gifts drop out of the giver's document when they next give. */
const KEEP_MS = 14 * 86_400_000;
/** Friends a giver's document keeps, newest gifts first. */
const MAX_FRIENDS = 60;
/** A gift's clock may run a little ahead of the recipient's; further ahead is junk. */
const SKEW_MS = 10 * 60_000;

const WRITE_EVERY = 20_000;
const CONNECT_TIMEOUT = 4_000;

// ---------------------------------------------------------------- codes

/** A path segment the db accepts (and nothing that could reach another path). */
const SEGMENT = /^[A-Za-z0-9_~:@+-][A-Za-z0-9_.~:@+-]{0,199}$/;

export const liveCode = (id: string) => LIVE_PREFIX + id;

/** The friend's id in a live visit code, or null if it isn't one. */
export function liveId(code: string | null | undefined): string | null {
  const c = (code ?? "").trim();
  if (!c.startsWith(LIVE_PREFIX)) return null;
  const id = c.slice(LIVE_PREFIX.length);
  return SEGMENT.test(id) ? id : null;
}

// ---------------------------------------------------------------- gift bookkeeping (pure)

export interface Gift {
  from: string;
  kind: GiftKind;
  at: number;
}
export interface SentGift {
  kind: GiftKind;
  at: number;
}
export interface GiverDoc {
  to: string[];
  sent: Record<string, SentGift[]>;
}

const isKind = (k: unknown): k is GiftKind => (GIFT_KINDS as readonly unknown[]).includes(k);

/** The valid gifts in an untrusted list (anything else is dropped). */
function sentList(v: unknown): SentGift[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((g) => {
    const o = g as { kind?: unknown; at?: unknown } | null;
    return o && isKind(o.kind) && typeof o.at === "number" && Number.isFinite(o.at) ? [{ kind: o.kind, at: o.at }] : [];
  });
}

/** A giver's document as written, tidied (bad entries dropped). */
export function readGiverDoc(data: Record<string, unknown> | undefined): GiverDoc {
  const sent: Record<string, SentGift[]> = {};
  const raw = data?.sent;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [to, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!SEGMENT.test(to)) continue;
      const l = sentList(list);
      if (l.length) sent[to] = l;
    }
  }
  return { to: Object.keys(sent), sent };
}

/** Already gave `to` a gift today (the giver's local day)? */
export const gaveToday = (doc: GiverDoc, to: string, now: number) => (doc.sent[to] ?? []).some((g) => dayKey(g.at) === dayKey(now));

/**
 * The giver's document with one more gift for `to`, or null when one was already given today.
 * Drops gifts older than two weeks, keeps a week's worth per friend and the 60 friends given to most recently.
 */
export function addGift(doc: GiverDoc, to: string, kind: GiftKind, now: number): GiverDoc | null {
  if (gaveToday(doc, to, now)) return null;
  const sent: Record<string, SentGift[]> = {};
  for (const [id, list] of Object.entries(doc.sent)) {
    const keep = list.filter((g) => now - g.at < KEEP_MS);
    if (keep.length) sent[id] = keep;
  }
  sent[to] = [...(sent[to] ?? []), { kind, at: now }].slice(-KEEP_PER_FRIEND);
  const newest = (id: string) => Math.max(...sent[id]!.map((g) => g.at));
  const ids = Object.keys(sent).sort((a, b) => newest(b) - newest(a)).slice(0, MAX_FRIENDS);
  const out: Record<string, SentGift[]> = {};
  for (const id of ids) out[id] = sent[id]!;
  return { to: ids, sent: out };
}

/**
 * The gifts waiting for `me` in the givers' documents, and the claim marks to store once they're
 * applied. `seen` maps a giver to the newest gift time already claimed from them. Per giver: only
 * gifts newer than that, never from the future, never from me, one per (recipient-local) day.
 * At most MAX_CLAIM in all, oldest first; gifts past the cap stay for the next open.
 */
export function pendingGifts(
  givers: { id: string; data: Record<string, unknown> | undefined }[],
  me: string,
  seen: Record<string, number>,
  now: number,
): { gifts: Gift[]; seen: Record<string, number> } {
  const all: Gift[] = [];
  for (const g of givers) {
    if (g.id === me || !SEGMENT.test(g.id)) continue;
    const since = seen[g.id] ?? 0;
    const days = new Set<string>();
    const list = readGiverDoc(g.data).sent[me] ?? [];
    for (const s of [...list].sort((a, b) => a.at - b.at)) {
      if (s.at <= since || s.at > now + SKEW_MS) continue;
      const d = dayKey(s.at);
      if (days.has(d)) continue;
      days.add(d);
      all.push({ from: g.id, kind: s.kind, at: s.at });
    }
  }
  const gifts = all.sort((a, b) => a.at - b.at).slice(0, MAX_CLAIM);
  const next = { ...seen };
  for (const g of gifts) next[g.from] = Math.max(next[g.from] ?? 0, g.at);
  return { gifts, seen: next };
}

/** The claim marks in the recipient's private document (junk dropped). */
export function readSeen(data: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const raw = data?.seen;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
      if (SEGMENT.test(id) && typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
  }
  return out;
}

/** The cozy note lines for gifts just claimed. `who` names a giver ("" when unknown). */
export function giftLines(gifts: Gift[], who: (id: string) => string = () => ""): string[] {
  const lines: string[] = [];
  const name = (list: Gift[], one: string, many: string) => {
    const ids = [...new Set(list.map((g) => g.from))];
    return ids.length === 1 ? who(ids[0]!) || one : many;
  };
  const shells = gifts.filter((g) => g.kind === "shell");
  const snacks = gifts.filter((g) => g.kind === "snack");
  if (shells.length === 1) lines.push(`${name(shells, "A friend", "Friends")} left you a shell! +${SHELL_DOLLARS}`);
  else if (shells.length > 1) lines.push(`${name(shells, "A friend", "Friends")} left you ${shells.length} shells! +${shells.length * SHELL_DOLLARS}`);
  if (snacks.length === 1) lines.push(`${name(snacks, "A friend", "Friends")} left a snack. Your jellies get a free meal.`);
  else if (snacks.length > 1) lines.push(`${name(snacks, "A friend", "Friends")} left ${snacks.length} snacks. Your jellies get a feast.`);
  return lines;
}

// ---------------------------------------------------------------- the db

interface Snap {
  exists: boolean;
  id?: string;
  data(): Record<string, unknown> | undefined;
}
interface DocRef {
  get(): Promise<Snap>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface QueryLike {
  where(field: string, op: string, value: unknown): QueryLike;
  get(): Promise<{ docs: Snap[] }>;
}
interface DbLike {
  doc(path: string): DocRef;
  collection(path: string): QueryLike;
}
interface UserLike {
  id(): Promise<string | null>;
  can?(name: string): Promise<boolean | null>;
  profiles?(ids: string[]): Promise<Record<string, { name: string }>>;
}
interface ClaudeLike {
  use(name: string): Promise<unknown>;
}

/** A write the rules refused: db rejects it `invalid_argument` (there is no permission-denied code). */
const refused = (e: unknown) => (e as { code?: unknown } | null)?.code === "invalid_argument";

export type GiveResult = "given" | "already" | "self" | "denied" | "offline";

export interface Friends {
  /** This viewer's id (opaque, scoped to this artifact). */
  readonly me: string;
  /** This viewer's live visit code. */
  readonly code: string;
  /** False when the platform says this viewer can't write shared data (gifting is hidden then). */
  readonly canGift: boolean;
  /** Queue this tank's share code for `tanks/<me>`; written on the next window, only when it changed. */
  publish(code: string, at: number, now?: boolean): void;
  /** A friend's live tank, or null (no such tank, not readable, or offline). */
  tank(id: string): Promise<{ code: string; at: number } | null>;
  /** Did I already leave `to` a gift today? (null: couldn't tell) */
  gaveToday(to: string, now?: number): Promise<boolean | null>;
  give(to: string, kind: GiftKind, now?: number): Promise<GiveResult>;
  /** Claim the gifts waiting for me: marks them claimed first, so a failed mark applies nothing. */
  claim(now?: number): Promise<Gift[]>;
  /** A giver's display name ("" unless the artifact grants the profile scope). */
  names(ids: string[]): Promise<Record<string, string>>;
}

const isSync = () => (window as unknown as { __JELLYTANK_SYNC?: boolean }).__JELLYTANK_SYNC === true;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Connect on the synced copy for a signed-in viewer; null otherwise (the features hide). */
export async function connectFriends(): Promise<Friends | null> {
  if (!isSync()) return null;
  const claude = (window as unknown as { claude?: ClaudeLike }).claude;
  if (!claude?.use) return null;
  const [dbNs, userNs] = (await withTimeout(Promise.all([claude.use("db"), claude.use("user")]), CONNECT_TIMEOUT)) ?? [null, null];
  if (!dbNs || !userNs) return null;
  const db = dbNs as DbLike;
  const user = userNs as UserLike;
  const me = await withTimeout(user.id(), CONNECT_TIMEOUT);
  if (!me || !SEGMENT.test(me)) return null;
  const can = typeof user.can === "function" ? await withTimeout(user.can("data.write"), CONNECT_TIMEOUT).catch(() => null) : null;
  let writable = can !== false;

  const tankRef = db.doc(`tanks/${me}`);
  const giverRef = db.doc(`gifts/${me}`);
  const seenRef = db.doc(`data/users/${me}/gifts`);

  // ---- publishing my tank: one write at a time, at most once a window, only on change
  let written: string | null = null;
  let pending: { code: string; at: number } | null = null;
  let writing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = 0;
  const ready = tankRef.get().then(
    (s) => {
      const c = s.exists ? s.data()?.code : undefined;
      written = typeof c === "string" ? c : null;
    },
    () => undefined,
  );
  const flush = async () => {
    timer = null;
    await ready;
    if (writing || !pending || !writable) return;
    const next = pending;
    pending = null;
    if (next.code === written) return;
    writing = true;
    try {
      await tankRef.set({ code: next.code, at: next.at });
      written = next.code;
    } catch (e) {
      if (refused(e)) writable = false; // a view-only visitor: stop trying for this visit
      else pending ??= next;
    } finally {
      writing = false;
      lastWrite = Date.now();
      if (pending) schedule();
    }
  };
  const schedule = (now = false) => {
    if (timer) {
      if (!now) return;
      clearTimeout(timer);
    }
    timer = setTimeout(() => void flush(), now ? 0 : Math.max(0, WRITE_EVERY - (Date.now() - lastWrite)));
  };

  const myGifts = async () => readGiverDoc((await giverRef.get()).data());

  return {
    me,
    code: liveCode(me),
    get canGift() {
      return writable;
    },
    publish(code, at, now = false) {
      if (!writable || (code === written && !pending)) return;
      pending = { code, at };
      schedule(now);
    },
    async tank(id) {
      if (!SEGMENT.test(id)) return null;
      try {
        const s = await db.doc(`tanks/${id}`).get();
        const d = s.exists ? s.data() : undefined;
        return d && typeof d.code === "string" ? { code: d.code, at: typeof d.at === "number" ? d.at : 0 } : null;
      } catch {
        return null;
      }
    },
    async gaveToday(to, now = Date.now()) {
      try {
        return gaveToday(await myGifts(), to, now);
      } catch {
        return null;
      }
    },
    async give(to, kind, now = Date.now()) {
      if (to === me) return "self";
      if (!SEGMENT.test(to) || !isKind(kind)) return "offline";
      if (!writable) return "denied";
      let doc: GiverDoc;
      try {
        doc = await myGifts();
      } catch {
        return "offline";
      }
      const next = addGift(doc, to, kind, now);
      if (!next) return "already";
      try {
        await giverRef.set({ to: next.to, sent: next.sent });
        return "given";
      } catch (e) {
        if (refused(e)) {
          writable = false;
          return "denied";
        }
        return "offline";
      }
    },
    async claim(now = Date.now()) {
      try {
        const [q, s] = await Promise.all([db.collection("gifts").where("to", "array-contains", me).get(), seenRef.get()]);
        const givers = q.docs.map((d) => ({ id: d.id ?? "", data: d.data() }));
        const { gifts, seen } = pendingGifts(givers, me, readSeen(s.data()), now);
        if (!gifts.length) return [];
        await seenRef.set({ seen }); // mark first: if this fails nothing is applied, and the gifts wait
        return gifts;
      } catch {
        return [];
      }
    },
    async names(ids) {
      const out: Record<string, string> = {};
      try {
        const ps = typeof user.profiles === "function" ? await user.profiles(ids) : {};
        for (const id of ids) out[id] = ps[id]?.name ?? "";
      } catch {
        /* names are a nicety */
      }
      return out;
    },
  };
}

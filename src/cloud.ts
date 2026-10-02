/**
 * Cloud saves for the synced copy of the game (window.__JELLYTANK_SYNC).
 *
 * Each signed-in viewer's tank lives in their private db document
 * `data/users/<id>/save` as `{ json, at }`. The local save stays the working
 * copy; the cloud gets a write at most every WRITE_EVERY ms (and when the
 * tab hides), only when the save actually changed, one write at a time.
 * Whichever copy is newer wins at load (by `at`, the save's lastSeen).
 */

const WRITE_EVERY = 20_000;
const CONNECT_TIMEOUT = 4_000;

export type CloudStatus = "connecting" | "synced" | "saving" | "offline" | "signedOut";

interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface DbLike {
  doc(path: string): DocRef;
}
interface UserLike {
  id(): Promise<string | null>;
}
interface ClaudeLike {
  use(name: string): Promise<unknown>;
}

export interface CloudSave {
  json: string;
  at: number;
}

export interface CloudSync {
  /** The cloud copy at connect time (null: none yet). */
  readonly initial: CloudSave | null;
  /** Queue the current save; written on the next window (or now, with `now`). */
  save(json: string, at: number, now?: boolean): void;
  /** Re-read the cloud copy (another device may have saved since). */
  check(): Promise<CloudSave | null>;
  readonly status: CloudStatus;
  readonly lastSyncedAt: number | null;
  onStatus(fn: (s: CloudStatus) => void): void;
}

const isSync = () => (window as unknown as { __JELLYTANK_SYNC?: boolean }).__JELLYTANK_SYNC === true;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

function parse(snap: { exists: boolean; data(): Record<string, unknown> | undefined }): CloudSave | null {
  if (!snap.exists) return null;
  const d = snap.data();
  return d && typeof d.json === "string" && typeof d.at === "number" ? { json: d.json, at: d.at } : null;
}

/** Connect when this page is the synced copy; null otherwise, or when the viewer can't use cloud saves. */
export async function connectCloud(): Promise<CloudSync | null> {
  if (!isSync()) return null;
  const claude = (window as unknown as { claude?: ClaudeLike }).claude;
  if (!claude?.use) return null;
  const [db, user] = (await withTimeout(Promise.all([claude.use("db"), claude.use("user")]), CONNECT_TIMEOUT)) ?? [null, null];
  if (!db || !user) return null;
  const id = await withTimeout((user as UserLike).id(), CONNECT_TIMEOUT);
  if (!id) return null; // signed out: no private subtree, play locally
  const ref = (db as DbLike).doc(`data/users/${id}/save`);

  let status: CloudStatus = "connecting";
  let lastSyncedAt: number | null = null;
  const listeners: ((s: CloudStatus) => void)[] = [];
  const setStatus = (s: CloudStatus) => {
    status = s;
    for (const fn of listeners) fn(s);
  };

  let initial: CloudSave | null = null;
  try {
    initial = parse(await ref.get());
    setStatus("synced");
  } catch {
    setStatus("offline");
  }

  let pending: CloudSave | null = null;
  let written = initial?.json ?? "";
  let writing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = 0;

  const flush = async () => {
    timer = null;
    if (writing || !pending) return;
    const next = pending;
    pending = null;
    if (next.json === written) return;
    writing = true;
    setStatus("saving");
    try {
      await ref.set({ json: next.json, at: next.at });
      written = next.json;
      lastSyncedAt = Date.now();
      setStatus("synced");
    } catch {
      pending ??= next; // keep it for the next window
      setStatus("offline");
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
    const wait = now ? 0 : Math.max(0, WRITE_EVERY - (Date.now() - lastWrite));
    timer = setTimeout(() => void flush(), wait);
  };

  return {
    initial,
    save(json, at, now = false) {
      if (json === written && !pending) return;
      pending = { json, at };
      schedule(now);
    },
    async check() {
      try {
        const c = parse(await ref.get());
        if (status === "offline") setStatus("synced");
        return c;
      } catch {
        setStatus("offline");
        return null;
      }
    },
    get status() {
      return status;
    },
    get lastSyncedAt() {
      return lastSyncedAt;
    },
    onStatus(fn) {
      listeners.push(fn);
    },
  };
}

/** The `at` (lastSeen) inside a save JSON, or 0. */
export function savedAt(json: string | null): number {
  if (!json) return 0;
  try {
    const v = (JSON.parse(json) as { lastSeen?: unknown }).lastSeen;
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

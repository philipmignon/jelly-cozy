/**
 * Test mode: what the browser checks (tools/e2e/) ask of the page through its URL. In normal play none of these
 * parameters is there, testQuery() returns null, and nothing changes: main.ts only then loads the test API
 * (src/testapi.ts), a chunk of its own that a player's browser never fetches and the service worker never caches.
 *
 *   ?test=1          window.__jt, the test API (src/testapi.ts)
 *   ?seed=N          every random stream the sim uses starts from N (implies test=1)
 *   ?clock=virtual   frames come only when the test asks (__jt.advance), in fixed steps; Date.now() is a virtual
 *                    clock that moves with them, so a scene renders the same every run (implies test=1)
 *   ?now=T           the page clock's start, epoch ms or an ISO date (default: the real time; with a virtual
 *                    clock, VIRTUAL_EPOCH)
 */
export interface TestQuery {
  seed: number | null;
  virtual: boolean;
  now: number | null;
}

/** A virtual clock's default start: a June noon (local time), a day with no season and no night. */
export const VIRTUAL_EPOCH = new Date(2026, 5, 15, 12, 0, 0).getTime();

export function testQuery(search: string): TestQuery | null {
  const q = new URLSearchParams(search);
  const seedRaw = q.get("seed");
  const seed = seedRaw !== null && seedRaw.trim() !== "" && Number.isFinite(Number(seedRaw)) ? Math.floor(Number(seedRaw)) : null;
  const virtual = q.get("clock") === "virtual";
  if (q.get("test") !== "1" && seed === null && !virtual) return null;
  const nowRaw = q.get("now");
  let now: number | null = null;
  if (nowRaw) {
    const n = /^\d+$/.test(nowRaw) ? Number(nowRaw) : Date.parse(nowRaw);
    if (Number.isFinite(n)) now = n;
  }
  return { seed, virtual, now };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CLAIM, SHELL_DOLLARS, addGift, connectFriends, giftLines, liveCode, liveId, pendingGifts, readGiverDoc, type GiverDoc } from "./friends";

// ---------------------------------------------------------------- a fake db that enforces rules

type Level = "view" | "interact" | "admin" | "owner";
const RANK: Record<Level, number> = { view: 0, interact: 1, admin: 2, owner: 3 };
interface Rule {
  path: string;
  read?: Level;
  write?: Level;
}

/** The rules the synced artifact is published with (see the report / friends.ts). */
const RULES: Rule[] = [
  { path: "tanks", read: "view", write: "owner" },
  { path: "tanks/{self}", write: "interact" },
  { path: "gifts", read: "view", write: "owner" },
  { path: "gifts/{self}", write: "interact" },
];

/**
 * The access a viewer has at a path, after db.d.ts: the root defaults to read view / write interact;
 * the deepest matching rule sets each action; a `{self}` segment matches only the viewer's own id;
 * a sibling's subtree under a `{self}` prefix (data/users by default) is closed unless a rule at the
 * prefix opens it; the owner meets every level but not `{self}` privacy.
 */
function allowed(path: string, action: "read" | "write", me: string, level: Level, rules: Rule[]): boolean {
  const segs = path.split("/");
  const all: Rule[] = [{ path: "data/users/{self}", write: "interact" }, ...rules];
  let need: Level = action === "read" ? "view" : "interact";
  let depth = -1;
  for (const r of all) {
    const rs = r.path ? r.path.split("/") : [];
    if (rs.length > segs.length) continue;
    if (!rs.every((s, i) => (s === "{self}" ? segs[i] === me : s === segs[i]))) continue;
    const lvl = r[action];
    if (lvl && rs.length > depth) {
      need = lvl;
      depth = rs.length;
    }
  }
  // a sibling's {self} subtree: closed unless a rule sits exactly at the prefix
  for (const r of all) {
    if (!r.path.endsWith("/{self}")) continue;
    const prefix = r.path.slice(0, -"/{self}".length);
    const ps = prefix.split("/");
    const under = segs.length > ps.length && ps.every((s, i) => s === segs[i]);
    if (under && segs[ps.length] !== me && !all.some((x) => x.path === prefix)) return false;
  }
  return RANK[level] >= RANK[need];
}

function makeStore(rules: Rule[] = RULES) {
  const docs = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  let failNext = 0;
  const viewer = (id: string | null, level: Level, opts: { sync?: boolean; can?: boolean | null; db?: boolean } = {}) => {
    const snap = (path: string, me: string) => {
      const ok = allowed(path, "read", me, level, rules) && docs.has(path);
      const d = docs.get(path);
      return { exists: ok, id: path.split("/").pop()!, data: () => (ok ? structuredClone(d) : undefined) };
    };
    const me = id ?? "";
    const db = {
      doc: (path: string) => ({
        get: async () => snap(path, me),
        set: async (d: Record<string, unknown>) => {
          if (failNext > 0) {
            failNext--;
            throw { code: "unavailable", message: "down" };
          }
          if (!id || !allowed(path, "write", me, level, rules)) throw { code: "invalid_argument", message: "denied" };
          writes.push(path);
          docs.set(path, structuredClone(d));
        },
      }),
      collection: (path: string) => {
        const filters: [string, string, unknown][] = [];
        const q = {
          where(field: string, op: string, value: unknown) {
            filters.push([field, op, value]);
            return q;
          },
          async get() {
            const depth = path.split("/").length + 1;
            const hits = [...docs.keys()]
              .filter((p) => p.startsWith(`${path}/`) && p.split("/").length === depth)
              .map((p) => snap(p, me))
              .filter((s) => s.exists)
              .filter((s) =>
                filters.every(([f, op, v]) => op === "array-contains" && Array.isArray(s.data()?.[f]) && (s.data()![f] as unknown[]).includes(v)),
              );
            return { docs: hits };
          },
        };
        return q;
      },
    };
    const user = { id: async () => id, can: async () => (opts.can === undefined ? null : opts.can) };
    (globalThis as unknown as { window: unknown }).window = {
      __JELLYTANK_SYNC: opts.sync ?? true,
      claude: { use: async (n: string) => (n === "db" ? (opts.db === false ? null : db) : n === "user" ? user : null) },
    };
  };
  return { docs, writes, viewer, failWrites: (n: number) => (failNext = n) };
}

const DAY = 86_400_000;
const NOON = new Date(2026, 9, 2, 12).getTime();

// ---------------------------------------------------------------- pure parts

describe("live codes", () => {
  it("round-trip an id and refuse anything that isn't one", () => {
    expect(liveId(liveCode("u_abc-123"))).toBe("u_abc-123");
    expect(liveId(`  ${liveCode("u_x")}\n`)).toBe("u_x");
    expect(liveId("u_abc")).toBeNull();
    expect(liveId("JTLIVE1.")).toBeNull();
    expect(liveId("JTLIVE1.a/b")).toBeNull(); // can't reach another path
    expect(liveId("JTLIVE1...")).toBeNull();
    expect(liveId("JTLIVE1.a b")).toBeNull();
    expect(liveId(null)).toBeNull();
  });
});

describe("gift bookkeeping", () => {
  const empty: GiverDoc = { to: [], sent: {} };

  it("one gift a day per friend; any number of friends", () => {
    const a = addGift(empty, "u_b", "shell", NOON)!;
    expect(a).toEqual({ to: ["u_b"], sent: { u_b: [{ kind: "shell", at: NOON }] } });
    expect(addGift(a, "u_b", "snack", NOON + 3_600_000)).toBeNull();
    const b = addGift(a, "u_c", "snack", NOON + 1)!;
    expect(b.to.sort()).toEqual(["u_b", "u_c"]);
    expect(addGift(b, "u_b", "snack", NOON + DAY)!.sent.u_b).toHaveLength(2);
  });

  it("keeps a week per friend and drops gifts older than two weeks", () => {
    let d: GiverDoc = empty;
    for (let i = 0; i < 10; i++) d = addGift(d, "u_b", "shell", NOON + i * DAY)!;
    expect(d.sent.u_b).toHaveLength(7);
    d = addGift(d, "u_c", "snack", NOON + 30 * DAY)!;
    expect(d.to).toEqual(["u_c"]);
  });

  it("claims only valid, new, past gifts: one per giver per day, capped, never from yourself", () => {
    const givers = [
      { id: "u_b", data: { sent: { u_me: [{ kind: "shell", at: NOON - DAY }, { kind: "snack", at: NOON - DAY + 60_000 }, { kind: "snack", at: NOON }] } } },
      { id: "u_c", data: { sent: { u_me: [{ kind: "gold", at: NOON }, { kind: "shell", at: "soon" }, { kind: "shell", at: NOON + 7 * DAY }, null, 5] } } },
      { id: "u_me", data: { sent: { u_me: [{ kind: "shell", at: NOON }] } } },
      { id: "u_d", data: { sent: "junk" } },
      { id: "u_e", data: undefined },
      { id: "u_f", data: { sent: { u_other: [{ kind: "shell", at: NOON }] } } },
    ];
    const { gifts, seen } = pendingGifts(givers, "u_me", {}, NOON + 1000);
    expect(gifts).toEqual([
      { from: "u_b", kind: "shell", at: NOON - DAY },
      { from: "u_b", kind: "snack", at: NOON },
    ]);
    expect(seen).toEqual({ u_b: NOON });
    // claimed once: nothing the second time
    expect(pendingGifts(givers, "u_me", seen, NOON + 2000).gifts).toEqual([]);
  });

  it("caps a claim at MAX_CLAIM and leaves the rest for the next open", () => {
    const givers = Array.from({ length: MAX_CLAIM + 4 }, (_, i) => ({ id: `u_${i}`, data: { sent: { u_me: [{ kind: "shell", at: NOON - i }] } } }));
    const first = pendingGifts(givers, "u_me", {}, NOON);
    expect(first.gifts).toHaveLength(MAX_CLAIM);
    const second = pendingGifts(givers, "u_me", first.seen, NOON);
    expect(second.gifts).toHaveLength(4);
  });

  it("tidies a giver document as read", () => {
    expect(readGiverDoc({ to: ["u_x"], sent: { u_b: [{ kind: "shell", at: 1 }, { kind: "bomb", at: 2 }], "a/b": [{ kind: "shell", at: 1 }] } })).toEqual({
      to: ["u_b"],
      sent: { u_b: [{ kind: "shell", at: 1 }] },
    });
  });

  it("writes cozy notes", () => {
    expect(giftLines([{ from: "u_b", kind: "shell", at: 1 }])).toEqual([`A friend left you a shell! +${SHELL_DOLLARS}`]);
    expect(giftLines([{ from: "u_b", kind: "shell", at: 1 }], () => "Sam")).toEqual([`Sam left you a shell! +${SHELL_DOLLARS}`]);
    expect(
      giftLines([
        { from: "u_b", kind: "shell", at: 1 },
        { from: "u_c", kind: "shell", at: 2 },
        { from: "u_c", kind: "snack", at: 3 },
      ]),
    ).toEqual([`Friends left you 2 shells! +${2 * SHELL_DOLLARS}`, "A friend left a snack. Your jellies get a free meal."]);
  });
});

// ---------------------------------------------------------------- against the rules

describe("friends on the synced copy", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOON }));
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("stays off on the main link, signed out, and without a db", async () => {
    const st = makeStore();
    st.viewer("u_a", "interact", { sync: false });
    expect(await connectFriends()).toBeNull();
    st.viewer(null, "interact");
    expect(await connectFriends()).toBeNull();
    st.viewer("u_a", "interact", { db: false });
    expect(await connectFriends()).toBeNull();
  });

  it("publishes my tank only when it changed, and a viewer reads it", async () => {
    const st = makeStore();
    st.viewer("u_a", "interact");
    const a = (await connectFriends())!;
    expect(a.code).toBe(liveCode("u_a"));
    a.publish("CODE1", NOON, true);
    await vi.advanceTimersByTimeAsync(0);
    a.publish("CODE1", NOON + 5);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(st.writes.filter((p) => p === "tanks/u_a")).toHaveLength(1);
    a.publish("CODE2", NOON + 6);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(st.docs.get("tanks/u_a")).toEqual({ code: "CODE2", at: NOON + 6 });

    st.viewer("u_b", "view"); // a Viewer reads live tanks
    const b = (await connectFriends())!;
    expect(await b.tank("u_a")).toEqual({ code: "CODE2", at: NOON + 6 });
    expect(await b.tank("u_nobody")).toBeNull();
    expect(await b.tank("../x")).toBeNull();
  });

  it("a view-only visitor can look but not write: publishing stops, giving reports denied", async () => {
    const st = makeStore();
    st.viewer("u_v", "view");
    const v = (await connectFriends())!;
    v.publish("CODE", NOON, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(st.docs.has("tanks/u_v")).toBe(false);
    v.publish("CODE2", NOON, true); // stopped trying
    await vi.advanceTimersByTimeAsync(0);
    expect(v.canGift).toBe(false);
    expect(await v.give("u_a", "shell")).toBe("denied");
  });

  it("hides gifting up front when the platform says the viewer can't write", async () => {
    const st = makeStore();
    st.viewer("u_v", "view", { can: false });
    const v = (await connectFriends())!;
    expect(v.canGift).toBe(false);
    expect(await v.give("u_a", "snack")).toBe("denied");
  });

  it("a friend gives once a day; the recipient claims once; nobody can forge or read what isn't theirs", async () => {
    const st = makeStore();
    st.viewer("u_b", "admin"); // an Editor
    const b = (await connectFriends())!;
    expect(await b.give("u_b", "shell")).toBe("self");
    expect(await b.gaveToday("u_a")).toBe(false);
    expect(await b.give("u_a", "shell")).toBe("given");
    expect(await b.gaveToday("u_a")).toBe(true);
    expect(await b.give("u_a", "snack")).toBe("already");
    st.viewer("u_c", "interact"); // a Contributor
    const c = (await connectFriends())!;
    expect(await c.give("u_a", "snack")).toBe("given");

    // the recipient claims both, once
    st.viewer("u_a", "interact");
    const a = (await connectFriends())!;
    const got = await a.claim();
    expect(got.map((g) => [g.from, g.kind]).sort()).toEqual([
      ["u_b", "shell"],
      ["u_c", "snack"],
    ]);
    expect(await a.claim()).toEqual([]);
    vi.setSystemTime(NOON + DAY);
    st.viewer("u_b", "admin");
    expect(await (await connectFriends())!.give("u_a", "shell")).toBe("given");
    st.viewer("u_a", "interact");
    expect((await (await connectFriends())!.claim()).map((g) => g.kind)).toEqual(["shell"]);

    // forging: c can't write a gift into b's document, a tank for a, or a's claim marks
    st.viewer("u_c", "interact");
    const forge = (globalThis as unknown as { window: { claude: { use(n: string): Promise<any> } } }).window.claude;
    const db = await forge.use("db");
    await expect(db.doc("gifts/u_b").set({ to: ["u_a"], sent: { u_a: [{ kind: "shell", at: NOON }] } })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(db.doc("tanks/u_a").set({ code: "X", at: 1 })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(db.doc("data/users/u_a/gifts").set({ seen: {} })).rejects.toMatchObject({ code: "invalid_argument" });
    expect((await db.doc("data/users/u_a/gifts").get()).exists).toBe(false); // and can't read them
    // the owner can tidy anyone's tank or gifts
    st.viewer("u_a", "owner");
    const owner = await (globalThis as unknown as { window: { claude: { use(n: string): Promise<any> } } }).window.claude.use("db");
    await expect(owner.doc("gifts/u_b").set({ to: [], sent: {} })).resolves.toBeUndefined();
  });

  it("applies nothing when the claim can't be marked, and the gifts wait for next time", async () => {
    const st = makeStore();
    st.viewer("u_b", "interact");
    await (await connectFriends())!.give("u_a", "shell");
    st.viewer("u_a", "interact");
    const a = (await connectFriends())!;
    st.failWrites(1);
    expect(await a.claim()).toEqual([]);
    expect(await a.claim()).toHaveLength(1);
  });

  it("a give that can't reach the db says so", async () => {
    const st = makeStore();
    st.viewer("u_b", "interact");
    const b = (await connectFriends())!;
    st.failWrites(1);
    expect(await b.give("u_a", "shell")).toBe("offline");
    expect(await b.give("u_a", "shell")).toBe("given");
  });
});

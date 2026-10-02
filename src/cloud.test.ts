import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectCloud, savedAt } from "./cloud";

/** A fake viewer: window.claude with a db holding one document per path, and a user id. */
function fakeViewer(opts: { sync?: boolean; id?: string | null; doc?: { json: string; at: number }; failWrites?: number } = {}) {
  const store = new Map<string, Record<string, unknown>>();
  if (opts.doc) store.set(`data/users/${opts.id ?? "u1"}/save`, opts.doc);
  let fails = opts.failWrites ?? 0;
  const writes: Record<string, unknown>[] = [];
  const db = {
    doc: (path: string) => ({
      get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
      set: async (d: Record<string, unknown>) => {
        if (fails > 0) {
          fails--;
          throw { code: "unavailable", message: "down" };
        }
        writes.push(d);
        store.set(path, d);
      },
    }),
  };
  const user = { id: async () => (opts.id === undefined ? "u1" : opts.id) };
  (globalThis as unknown as { window: unknown }).window = {
    __JELLYTANK_SYNC: opts.sync ?? true,
    claude: { use: async (n: string) => (n === "db" ? db : n === "user" ? user : null) },
  };
  return { store, writes };
}

describe("cloud saves (the synced copy)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("stays off on the main link and for signed-out viewers", async () => {
    fakeViewer({ sync: false });
    expect(await connectCloud()).toBeNull();
    fakeViewer({ id: null });
    expect(await connectCloud()).toBeNull();
  });

  it("reads the cloud copy at connect", async () => {
    fakeViewer({ doc: { json: '{"v":8,"lastSeen":500}', at: 500 } });
    const c = await connectCloud();
    expect(c?.initial).toEqual({ json: '{"v":8,"lastSeen":500}', at: 500 });
    expect(c?.status).toBe("synced");
  });

  it("writes at most once per window, skips unchanged saves, and flushes straight away when asked", async () => {
    const { writes } = fakeViewer();
    const c = (await connectCloud())!;
    c.save('{"a":1}', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    c.save('{"a":2}', 2);
    c.save('{"a":3}', 3);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writes).toHaveLength(1); // still inside the 20 s window
    await vi.advanceTimersByTimeAsync(16_000);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({ json: '{"a":3}', at: 3 }); // only the latest goes up
    c.save('{"a":3}', 4);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writes).toHaveLength(2); // unchanged: no write
    c.save('{"a":4}', 5, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(3);
  });

  it("keeps a failed write for the next window and reports offline meanwhile", async () => {
    const { writes } = fakeViewer({ failWrites: 1 });
    const c = (await connectCloud())!;
    c.save('{"a":1}', 1, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(21_000);
    expect(writes).toHaveLength(1);
    expect(c.status).toBe("synced");
  });

  it("reads lastSeen out of a save", () => {
    expect(savedAt('{"lastSeen":123}')).toBe(123);
    expect(savedAt("nope")).toBe(0);
    expect(savedAt(null)).toBe(0);
  });
});

/**
 * Click-through smoke test: the real dev build in headless Chrome, real mouse
 * presses on the .riv's buttons, checks on window.__tank after each one.
 * The only check that a control still reaches the host once the .riv changes.
 *
 *   npm run e2e        (needs Google Chrome; screenshots land in shots/e2e-*.png)
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const K = JSON.parse(readFileSync(new URL("../src/contract.json", import.meta.url)));
const PORT = Number(process.env.E2E_PORT ?? 5198);
const VIEW = { width: 480, height: 856 };
const S = Math.min(VIEW.width / K.W, VIEW.height / K.H);
const OX = (VIEW.width - K.W * S) / 2;
const OY = (VIEW.height - K.H * S) / 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(new URL("../shots/", import.meta.url), { recursive: true });

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};

const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const button = (name) => centre(K.buttons.find((b) => b.name === name));

function startServer() {
  return new Promise((resolve, reject) => {
    // a deps cache of its own (vite.config.ts): another worktree's dev server re-optimizing the shared one reloads this page
    const env = { ...process.env, JT_VITE_CACHE_DIR: join(tmpdir(), `jellytank-vite-e2e-${PORT}`) };
    const p = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], env });
    p.stdout.on("data", (d) => String(d).includes("Local") && resolve(p));
    p.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

/**
 * The synced copy as the artifact runs it: window.__JELLYTANK_SYNC and a fake window.claude (db + user)
 * injected before the page loads. The fake db lives in localStorage, so it outlasts reloads, and the
 * signed-in user is whoever localStorage.__fakeUser names: players take turns in one fresh profile.
 * It refuses writes outside the writer's own tanks/<id>, gifts/<id> and data/users/<id>, as the rules do.
 */
function fakeClaude() {
  window.__JELLYTANK_SYNC = true;
  const load = () => JSON.parse(localStorage.getItem("__fakedb") || "{}");
  const store = (d) => localStorage.setItem("__fakedb", JSON.stringify(d));
  const me = () => localStorage.getItem("__fakeUser");
  const own = (path) => {
    const s = path.split("/");
    return s[0] === "tanks" || s[0] === "gifts" ? s[1] === me() : s[0] === "data" && s[2] === me();
  };
  const readable = (path) => path.split("/")[0] !== "data" || path.split("/")[2] === me();
  const snap = (path) => {
    const d = load()[path];
    const ok = d !== undefined && readable(path);
    return { exists: ok, id: path.split("/").pop(), data: () => (ok ? d : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const db = {
    doc: (path) => ({
      id: path.split("/").pop(),
      path,
      get: async () => snap(path),
      set: async (data) => {
        if (!own(path)) throw { code: "invalid_argument", message: "write refused" };
        const d = load();
        d[path] = JSON.parse(JSON.stringify(data));
        store(d);
      },
    }),
    collection: (path) => {
      const filters = [];
      const q = {
        where(field, _op, value) {
          filters.push([field, value]);
          return q;
        },
        async get() {
          const n = path.split("/").length + 1;
          const docs = Object.keys(load())
            .filter((p) => p.startsWith(`${path}/`) && p.split("/").length === n)
            .map(snap)
            .filter((s) => s.exists && filters.every(([f, v]) => Array.isArray(s.data()[f]) && s.data()[f].includes(v)));
          return { docs, size: docs.length, empty: !docs.length };
        },
      };
      return q;
    },
  };
  const user = { id: async () => me(), can: async () => true };
  window.claude = { use: async (n) => (n === "db" ? db : n === "user" ? user : null) };
}

/** Navigations here wait for the DOM only (window.__tank says when the tank is up), not for web fonts. */
const DCL = { waitUntil: "domcontentloaded" };

// ---------------------------------------------------------------- waits on the tank's state (every flow uses these)

// Rive takes a press on its next frame and fires the trigger as it advances, so after a click wait for a
// few frames (sim time moves at most 0.1 s a frame: 0.3 s of it is 3+ frames), not just a fixed time
const framesOn = (page, n) =>
  page.evaluate(() => window.__tank.t).then((t0) => page.waitForFunction((t) => window.__tank.t >= t, { timeout: 15000 }, t0 + 0.1 * n)).catch(() => {});
// the shop has finished sliding up (sim time, so a slow frame rate doesn't leave the tabs mid-slide)
const shopUpOn = (page) =>
  page.waitForFunction(() => { const t = window.__tank; return t.shop.open && t.t - t.shop.t0 > 0.45; }, { timeout: 8000 }).then(() => sleep(150), () => {});
// ...and has finished sliding away: taps in the water are ignored until it is out of the way (sim time again:
// under load a frame can be 300 ms, and the slide is 0.35 s of sim time at no more than 0.1 s a frame)
const shopDownOn = (page) =>
  page.waitForFunction(() => { const t = window.__tank; return !t.shop.open && t.t - t.shop.t0 > 0.4; }, { timeout: 8000 }).then(() => true, () => false);
// a tab's cards are laid out (and hit-tested) a frame or two after the state flips: wait 3+ frames (sim time
// moves at most 0.1 s a frame, so 0.3 s of it is at least three) as well as 400 ms
const laidOutOn = (page) => Promise.all([sleep(400), framesOn(page, 3)]);
/** wait for a condition in the page; true/false rather than throwing */
const until = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, { timeout }, arg).then(() => true, () => false);

/**
 * v13 keepsakes: a save one step short of a milestone (two kinds raised, a blubber juvenile one meal from adult),
 * the step completed in the tank (feed it), the note, the reward, the journal's Keepsakes page, no second unlock
 * on reload; then an older save that already reached four milestones gets them in one summary note; then the
 * shop's DECOR tab scrolls to the keepsake cards and a locked one says how it's earned.
 */
async function keepsakeFlow(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const app = `http://localhost:${PORT}/`;
  /** write a save without the tank running (its pagehide save would overwrite it), then open the tank */
  const inject = async (save) => {
    await page.goto(`${app}src/contract.json`, DCL);
    await page.evaluate((json) => {
      localStorage.setItem("jellytank:tips", "1");
      localStorage.setItem("jellytank:v5", json);
    }, JSON.stringify(save));
    await page.goto(app, DCL);
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 20000 });
  };
  const now = Date.now();
  const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const jelly = (k, g, extra = {}) => ({ k, g, gp: [0, 4, 12, 30][g], care: 0, fullness: 0.8, affection: 0.5, anchor: -1, spot: -1, name: ["Mochi", "Tofu", "Bloop"][k % 3], born: now, content: 0, morph: 0, ...extra });
  const entry = (raised) => ({ seen: true, raised, firstAdultAt: raised ? now : null, firstName: raised ? "Mochi" : null, morphSeen: 0 });
  const blank = { seen: false, raised: 0, firstAdultAt: null, firstName: null, morphSeen: 0 };
  const base = { v: 11, dollars: 0, murk: 0, spots: [], night: false, lamp: null, helpers: [false, false, false], pearlDay: "", lastSeen: now, tier: 0, cam: 0,
                 foods: [true, false, false], themes: [true, false, false, false, false], theme: 0 };
  const noteText = () => page.evaluate(() => { const n = document.querySelector(".jt-keep-note"); return n && !n.hidden ? n.textContent : ""; });

  // one meal short of three kinds raised: the moon and the fried egg are raised, the blubber needs one more growth point
  await inject({
    ...base,
    slots: [jelly(0, 3), jelly(4, 3), jelly(1, 2, { gp: 29, fullness: 0.4 }), null, null, null, null],
    owned: [false, false, false, false, false, true, false, false, false, false, false],
    journal: [entry(1), entry(0), blank, blank, entry(1), blank, blank, blank, blank],
    keep: { earned: 1, days: 1, lastDay: day(now), requests: 0 },
  });
  // nothing should show: give it the time a note would take to come up (wall clock and sim time)
  const settle = () => Promise.all([sleep(1500), framesOn(page, 10)]);
  await settle();
  check("keepsakes: nothing new at load, nothing shown", (await noteText()) === "" && (await page.evaluate(() => window.__tank.owned[6] === false)));
  const S1 = Math.min(VIEW.width / K.W, VIEW.height / K.H);
  const ox = (VIEW.width - K.W * S1) / 2;
  const oy = (VIEW.height - K.H * S1) / 2;
  const btn = K.buttons.find((b) => b.name === "feed");
  await page.mouse.click(ox + (btn.x + btn.w / 2) * S1, oy + (btn.y + btn.h / 2) * S1);
  await page.waitForFunction(() => window.__tank.tool === "food", { timeout: 3000 }).catch(() => {});
  let grew = false;
  for (let i = 0; i < 12 && !grew; i++) {
    const j = await page.evaluate(() => ({ x: window.__tank.slots[2].x + window.__tank.cam.x, y: window.__tank.slots[2].y }));
    await page.mouse.click(ox + (j.x + (i % 2 ? 15 : -15)) * S1, oy + (j.y - 70) * S1);
    grew = await page.waitForFunction(() => window.__tank.slots[2]?.g === 3, { timeout: 1500 }).then(() => true, () => false);
  }
  check("keepsakes: feeding the blubber raises a third kind", grew);
  const shown = await page.waitForSelector(".jt-keep-note:not([hidden])", { timeout: 8000 }).then(() => true, () => false);
  const text = await noteText();
  const state = await page.evaluate(() => ({ owned: window.__tank.owned[6], earned: window.__tank.keep.earned }));
  check("keepsakes: the unlock note says a lighthouse washed up, and it's in the tank", shown && /lighthouse/i.test(text) && state.owned && state.earned === 3, `${text} ${JSON.stringify(state)}`);
  await page.screenshot({ path: "shots/e2e-keep-note.png" });
  const saved = await page.waitForFunction(() => (JSON.parse(localStorage.getItem("jellytank:v5") || "{}").keep?.earned ?? 0) === 3, { timeout: 3000 }).then(() => true, () => false);
  check("keepsakes: the unlock is saved", saved);
  // "See journal" opens the book on the Keepsakes page: two done, the rest with their progress
  if (shown) await page.click(".jt-keep-note button:not(.ok)");
  await until(page, () => !document.querySelector(".jt-book").hidden && !document.querySelector(".jt-keep-page").hidden, null, 5000);
  const page_ = await page.evaluate(() => ({
    open: !document.querySelector(".jt-book").hidden && !document.querySelector(".jt-keep-page").hidden,
    done: document.querySelectorAll(".jt-keep-row.done").length,
    counts: [...document.querySelectorAll(".jt-keep-count")].map((e) => e.textContent),
  }));
  check("keepsakes: the journal's Keepsakes page shows each milestone's progress", page_.open && page_.done === 2 && page_.counts.join(" ") === "✓ ✓ 0/1 1/7 0/10 3/9", JSON.stringify(page_));
  await page.screenshot({ path: "shots/e2e-keep-journal.png" });
  await page.keyboard.press("Escape");
  // a reload doesn't unlock it again
  await page.reload(DCL);
  await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 20000 });
  await settle();
  check("keepsakes: no second unlock after a reload", (await noteText()) === "" && (await page.evaluate(() => window.__tank.owned[6] && window.__tank.keep.earned === 3)));

  // an older save (v10: no keep field, five decorations) that already reached four milestones: one summary note,
  // every reward in
  await inject({
    ...base,
    v: 10,
    slots: [jelly(0, 3, { morph: 1 }), null, null, null, null, null, null],
    owned: [true, false, false, false, false],
    journal: Array.from({ length: 9 }, (_, k) => ({ ...entry(1), morphSeen: k === 0 ? 1 : 0 })),
  });
  const sum = await page.waitForSelector(".jt-keep-note:not([hidden])", { timeout: 8000 }).then(() => true, () => false);
  const rows = await page.evaluate(() => document.querySelectorAll(".jt-keep-note .jt-keep-sum li").length);
  const got = await page.evaluate(() => ({ decor: window.__tank.owned.slice(5, 8).every(Boolean), lagoon: window.__tank.themes[4] }));
  check("keepsakes: an older save gets one summary note for all it had reached", sum && rows === 4 && /keepsakes for you/i.test(await noteText()) && got.decor && got.lagoon, `${rows} ${JSON.stringify(got)}`);
  await page.screenshot({ path: "shots/e2e-keep-summary.png" });
  if (sum) await page.click(".jt-keep-note .ok");
  await until(page, () => document.querySelector(".jt-keep-note").hidden, null, 3000);
  await settle();
  check("keepsakes: just the one note", (await noteText()) === "");

  // the shop: DECOR scrolls down to the keepsakes; a locked one says how it's earned
  const shopBtn = K.buttons.find((b) => b.name === "shop");
  await page.mouse.click(ox + (shopBtn.x + shopBtn.w / 2) * S1, oy + (shopBtn.y + shopBtn.h / 2) * S1);
  await shopUpOn(page);
  const tab = K.shopTabs[1];
  await page.mouse.click(ox + (tab.x + tab.w / 2) * S1, oy + (tab.y + tab.h / 2) * S1);
  await until(page, () => window.__tank.tab === 1).then(() => laidOutOn(page));
  await page.mouse.move(ox + 360 * S1, oy + 600 * S1);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: 200 });
    await sleep(60);
  }
  // the wheel's scroll eases in over a few frames: wait until it has stopped moving
  let scroll = -1;
  for (let i = 0; i < 20; i++) {
    await framesOn(page, 2);
    const now_ = await page.evaluate(() => window.__tank.shopScroll);
    if (now_ === scroll) break;
    scroll = now_;
  }
  check("keepsakes: the DECOR tab scrolls to them", scroll > 0, `scroll=${scroll}`);
  await laidOutOn(page);
  const card = K.shopCards[29];
  await page.mouse.click(ox + (card.x + card.w / 2) * S1, oy + (card.y + card.h / 2 - scroll) * S1);
  await until(page, () => /keepsake:/i.test([...document.querySelectorAll(".jt-tag")].map((t) => t.textContent).join(" ")), null, 5000);
  const tag = await page.evaluate(() => [...document.querySelectorAll(".jt-tag")].map((t) => t.textContent).join(" "));
  check("keepsakes: a locked keepsake card says how it's earned, and isn't sold", /keepsake: finish 10 daily requests/i.test(tag) && (await page.evaluate(() => !window.__tank.owned[9])), tag);
  await page.screenshot({ path: "shots/e2e-keep-shop.png" });
  check("keepsakes: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Live visits and gifts on the synced copy: A publishes, B visits A's live tank and leaves a shell, A claims it. */
async function friendsFlow(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(fakeClaude);
  const as = async (user) => {
    await page.evaluate((u) => {
      localStorage.setItem("__fakeUser", u);
      localStorage.setItem("jellytank:tips", "1");
    }, user);
    await page.reload(DCL);
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
  };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem("__fakedb") || "{}"));
  await page.goto(`http://localhost:${PORT}/`, DCL);
  await as("u_a");

  // A's tank goes up as a live tank, and A's share panel offers the live code
  const published = await page.waitForFunction(() => (JSON.parse(localStorage.getItem("__fakedb") || "{}")["tanks/u_a"] || {}).code, { timeout: 8000 }).then(() => true, () => false);
  check("sync: my tank is published live", published);
  await page.click(".jt-gear");
  await page.click(".jt-menu-share");
  await sleep(150);
  const liveCode = await page.evaluate(() => document.querySelector(".jt-gift-live")?.textContent ?? "");
  check("sync: the share panel offers a live code", liveCode === "JTLIVE1.u_a", liveCode);
  await page.click(".jt-share .x");

  // B pastes it: A's tank, read-only, with a gift button
  await as("u_b");
  await page.click(".jt-gear");
  await page.click(".jt-menu-share");
  await page.evaluate((c) => { document.querySelector("#jt-visit-code").value = c; }, liveCode);
  await Promise.all([page.waitForNavigation(DCL), page.click(".jt-share .go")]);
  await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
  const giftBtn = await page.waitForSelector(".jt-gift-open:not([hidden])", { timeout: 5000 }).then(() => true, () => false);
  check("sync: a live visit shows the gift button", giftBtn && (await page.evaluate(() => !!document.querySelector(".jt-visit-bar"))));
  await page.click(".jt-gift-open");
  await page.click(".jt-gift-shell");
  await page.waitForFunction(() => /Gift left/.test(document.querySelector(".jt-gift-note")?.textContent ?? ""), { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: "shots/e2e-11-gift.png" });
  const gifts = (await db())["gifts/u_b"];
  check("sync: the shell is left in B's gift document for A", gifts?.to?.includes("u_a") && gifts.sent.u_a?.[0]?.kind === "shell", JSON.stringify(gifts));
  check("sync: one gift a day", await page.evaluate(() => document.querySelector(".jt-gift-open").disabled));
  await Promise.all([page.waitForNavigation(DCL), page.click(".jt-visit-bar .back")]);
  await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });

  // A opens their tank: the shell is claimed once, with a note
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("jellytank:v5")).dollars);
  await as("u_a");
  const noted = await page.waitForFunction(() => /left you a shell/.test(document.querySelector(".jt-away:not([hidden])")?.textContent ?? ""), { timeout: 8000 }).then(() => true, () => false);
  await page.screenshot({ path: "shots/e2e-12-gift-claimed.png" });
  const after = await page.evaluate(() => window.__tank.dollars);
  check("sync: the recipient gets the gift note and +5", noted && after >= before + 5, `${before} -> ${after}`);
  check("sync: the claim is marked", ((await db())["data/users/u_a/gifts"]?.seen ?? {}).u_b > 0);
  await page.click("#jt-away-ok");
  await as("u_a");
  await sleep(3000);
  check("sync: a gift is claimed only once", !(await page.evaluate(() => /shell/.test(document.querySelector(".jt-away:not([hidden])")?.textContent ?? ""))));
  check("sync: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Keyboard only: Tab onto the tank, pet, feed with F, the journal with J/Escape, buy with B + arrows + Enter; the live region; reduce motion. */
async function keyboardFlow(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`, DCL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("jellytank:tips", "1");
  });
  await page.reload(DCL);
  await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
  /** press a key, then let the tank take it: a couple of frames of sim time (or wait on a state with `until`) */
  const key = async (k) => {
    await page.keyboard.press(k);
    await framesOn(page, 2);
  };
  const live = (id) => page.evaluate((i) => document.getElementById(i)?.textContent ?? "", id);
  const hears = (id, re) => until(page, ([i, src]) => new RegExp(src).test(document.getElementById(i)?.textContent ?? ""), [id, re.source], 5000);

  const label = await page.evaluate(() => ({ role: document.getElementById("tank").getAttribute("role"), label: document.getElementById("tank").getAttribute("aria-label") ?? "" }));
  check("kb: the tank canvas is labelled for screen readers", label.role === "application" && /1 jelly/.test(label.label), JSON.stringify(label));
  await key("Tab");
  check("kb: Tab reaches the tank", await page.evaluate(() => document.activeElement?.id === "tank"));
  await key("Tab");
  await until(page, () => !document.querySelector(".jt-a11y-ring").hidden && document.querySelector(".jt-a11y-ring-label").textContent !== "", null, 5000);
  const ring = await page.evaluate(() => ({ shown: !document.querySelector(".jt-a11y-ring").hidden, label: document.querySelector(".jt-a11y-ring-label").textContent, name: window.__tank.slots[0].name }));
  const said = await live("jt-a11y-focus");
  check("kb: Tab lands on the jelly, ringed and described", ring.shown && ring.label === ring.name && said.startsWith(`${ring.name}, moon jelly polyp`), `${JSON.stringify(ring)} "${said}"`);
  // v13: the description ends with its personality, as the card words it
  check("kb: the jelly's description includes its personality", /, (shy|curious|sleepy|social) — /.test(said), said);
  await page.screenshot({ path: "shots/e2e-13-kb-focus.png" });

  const aff0 = await page.evaluate(() => window.__tank.slots[0].affection);
  await key("Enter");
  await until(page, (a) => window.__tank.slots[0].affection > a && document.querySelectorAll(".jt-tag").length > 0, aff0, 5000);
  const pet = await page.evaluate(() => ({ aff: window.__tank.slots[0].affection, tags: document.querySelectorAll(".jt-tag").length }));
  check("kb: Enter pets it", pet.aff > aff0 && pet.tags === 1, `${aff0} -> ${JSON.stringify(pet)}`);

  await key("f");
  await until(page, () => window.__tank.tool === "food" && window.__tank.food.some((f) => f.state !== "off"), null, 5000);
  const fed = await page.evaluate(() => ({ tool: window.__tank.tool, food: window.__tank.food.filter((f) => f.state !== "off").length }));
  check("kb: F picks up the can and sprinkles", fed.tool === "food" && fed.food > 0, JSON.stringify(fed));
  await key("Escape");
  check("kb: Escape puts the can down", await until(page, () => window.__tank.tool === "none", null, 5000));

  await key("j");
  await until(page, () => !document.querySelector(".jt-book").hidden, null, 5000);
  const book = await page.evaluate(() => ({ open: !document.querySelector(".jt-book").hidden, inside: document.querySelector(".jt-book").contains(document.activeElement) }));
  check("kb: J opens the journal with focus inside it", book.open && book.inside, JSON.stringify(book));
  await key("Escape");
  await until(page, () => document.querySelector(".jt-book").hidden && document.activeElement?.id === "tank", null, 5000);
  const back = await page.evaluate(() => ({ open: !document.querySelector(".jt-book").hidden, focus: document.activeElement?.id }));
  check("kb: Escape closes it and focus returns to the tank", !back.open && back.focus === "tank", JSON.stringify(back));

  await page.evaluate(() => { window.__tank.dollars = 300; });
  await key("b");
  await shopUpOn(page);
  await hears("jt-a11y-focus", /Blue blubber/);
  const shop = await page.evaluate(() => ({ open: window.__tank.shop.open, ring: !document.querySelector(".jt-a11y-ring").hidden }));
  const card = await live("jt-a11y-focus");
  check("kb: B opens the shop on its first card", shop.open && shop.ring && /Blue blubber, 40 sand dollars/.test(card), `${JSON.stringify(shop)} "${card}"`);
  await key("ArrowRight");
  await hears("jt-a11y-focus", /Fried egg/);
  const right = await live("jt-a11y-focus");
  await key("ArrowLeft");
  await hears("jt-a11y-focus", /Blue blubber/);
  check("kb: arrows walk the cards", /Fried egg/.test(right) && /Blue blubber/.test(await live("jt-a11y-focus")), right);
  await page.screenshot({ path: "shots/e2e-14-kb-shop.png" });
  await key("Enter");
  await until(page, () => window.__tank.slots.filter(Boolean).length === 2, null, 5000);
  await hears("jt-a11y-focus", /Bought Blue blubber/);
  const bought = await page.evaluate(() => ({ n: window.__tank.slots.filter(Boolean).length, dollars: window.__tank.dollars }));
  check("kb: Enter buys it", bought.n === 2 && bought.dollars === 260 && /Bought Blue blubber/.test(await live("jt-a11y-focus")), JSON.stringify(bought));
  await key("Escape");
  check("kb: Escape closes the shop", await shopDownOn(page));

  // the moments region: the pearl showing up is announced
  await page.evaluate(() => {
    window.__tank.owned[3] = true;
    window.__tank.pearlDay = "";
  });
  const heard = await page.waitForFunction(() => /The pearl is ready/.test(document.getElementById("jt-a11y-live")?.textContent ?? ""), { timeout: 6000 }).then(() => true, () => false);
  const region = await page.evaluate(() => { const r = document.getElementById("jt-a11y-live"); return { live: r?.getAttribute("aria-live"), text: r?.textContent }; });
  check("kb: the live region says the pearl is ready", heard && region.live === "polite", JSON.stringify(region));

  // reduce motion, from the settings menu: one flag in the sim, one on the page, kept
  check("reduce motion is off when the OS doesn't ask for it", !(await page.evaluate(() => window.__tank.reducedMotion)));
  await page.click(".jt-gear");
  await page.click(".jt-menu-motion");
  const rm = await page.evaluate(() => ({
    sim: window.__tank.reducedMotion,
    root: document.documentElement.hasAttribute("data-jt-reduce-motion"),
    stored: localStorage.getItem("jellytank:reduceMotion"),
    checked: document.querySelector(".jt-menu-motion").getAttribute("aria-checked"),
  }));
  check("the reduce motion toggle sets the flag and remembers it", rm.sim && rm.root && rm.stored === "1" && rm.checked === "true", JSON.stringify(rm));
  await key("Escape");
  await page.reload(DCL);
  await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
  check("reduce motion survives a reload", await page.evaluate(() => window.__tank.reducedMotion));
  check("kb: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/?fast=1`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });

    const st = () => page.evaluate(() => {
      const s = window.__tank;
      return {
        night: s.nightTarget, dollars: s.dollars, murk: s.murk, shop: s.shop.open, owned: s.owned.slice(),
        slots: s.slots.map((j) => j && { k: j.k, g: j.g, x: Math.round(j.x), y: Math.round(j.y), fullness: +j.fullness.toFixed(2) }),
        food: s.food.filter((f) => f.state !== "off").length, wipe: !!s.wipe,
      };
    });
    const frames = (n) => framesOn(page, n);
    const click = async (ax, ay) => {
      await page.mouse.click(OX + ax * S, OY + ay * S);
      await Promise.all([sleep(250), frames(3)]);
    };
    const tapWater = async (wx, wy) => {
      const cam = await page.evaluate(() => window.__tank.cam.x);
      await page.mouse.click(OX + (wx + cam) * S, OY + wy * S);
      await sleep(140);
    };
    const shot = (name) => page.screenshot({ path: `shots/e2e-${name}.png` });
    const shopUp = () => shopUpOn(page);
    const shopDown = () => shopDownOn(page);
    const laidOut = () => laidOutOn(page);

    // first-run tips: four bubbles, each with a Next / Got it button
    await page.waitForSelector(".jt-tip:not([hidden])", { timeout: 8000 }).catch(() => {});
    await shot("0-tip");
    let tipsSeen = 0;
    while (await page.evaluate(() => !document.querySelector(".jt-tip").hidden)) {
      await page.click("#jt-tip-next");
      await sleep(150);
      if (++tipsSeen > 6) break;
    }
    check("first-run tips show once and dismiss", tipsSeen === 4, `tips=${tipsSeen}`);

    let s = await st();
    check("new game: one moon polyp, 0 dollars", s.slots[0]?.k === 0 && s.slots[0]?.g === 0 && !s.slots[1] && s.dollars === 0, JSON.stringify(s.slots[0]));
    await shot("1-start");

    const night0 = (await st()).night;
    await click(...button("lamp"));
    await sleep(1500);
    s = await st();
    check("lamp flips day/night", s.night === !night0, `${night0} -> ${s.night}`);
    await shot("2-lamp");
    await click(...button("lamp"));
    s = await st();
    check("lamp flips back", s.night === night0);

    // v12 daily requests: the note in the hood opens a short list; finishing one pays through earn
    const reqShown = await page.waitForFunction(() => { const b = document.querySelector(".jt-req-btn"); return b && !b.hidden; }, { timeout: 8000 }).then(() => true, () => false);
    check("the requests note is pinned in the hood", reqShown);
    await page.click(".jt-req-btn");
    await sleep(200);
    const reqList = await page.evaluate(() => ({
      open: !document.querySelector(".jt-req-panel").hidden,
      items: [...document.querySelectorAll(".jt-req-item")].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
      sim: window.__tank.requests?.items.length ?? 0,
    }));
    check("tapping the note opens today's requests", reqList.open && reqList.items.length >= 1 && reqList.items.length <= 2 && reqList.items.length === reqList.sim, JSON.stringify(reqList.items));
    await shot("11-requests");
    // while it's open the tank doesn't take taps: a press on the water just closes it
    const polypAt = await page.evaluate(() => ({ x: window.__tank.slots[0].x, y: window.__tank.slots[0].y }));
    const aff0 = await page.evaluate(() => window.__tank.slots[0].affection);
    await tapWater(polypAt.x, polypAt.y - 30);
    const afterBlocked = await page.evaluate(() => ({ open: !document.querySelector(".jt-req-panel").hidden, aff: window.__tank.slots[0].affection }));
    check("a tap outside closes the note without petting", !afterBlocked.open && afterBlocked.aff <= aff0 + 1e-6, JSON.stringify(afterBlocked));
    // swap in a "pet twice" request and finish it
    await page.evaluate(() => { window.__tank.requests.items = [{ kind: "pet", target: -1, n: 2, progress: 0, done: false }]; });
    await sleep(400);
    const dReq = (await st()).dollars;
    for (let k = 0; k < 2; k++) {
      await tapWater(polypAt.x, polypAt.y - 30);
      await sleep(150);
    }
    const reqDone = await page.waitForFunction(() => window.__tank.requests.items[0].done, { timeout: 8000 }).then(() => true, () => false);
    await page.waitForSelector(".jt-req-done", { timeout: 5000 }).catch(() => {}); // the bubble comes with the next frame's events
    const reqUi = await page.evaluate(() => ({ bubble: !!document.querySelector(".jt-req-done"), badge: document.querySelector(".jt-req-badge").textContent }));
    check("petting finishes a request: it pays +5 once, the note says so", reqDone && (await st()).dollars >= dReq + 5 && reqUi.bubble && reqUi.badge === "✓", `${dReq} -> ${(await st()).dollars} ${JSON.stringify(reqUi)}`);
    await page.click(".jt-req-btn");
    await sleep(200);
    check("a finished request shows its check and 2/2", await page.evaluate(() => { const li = document.querySelector(".jt-req-item"); return li.classList.contains("done") && /2\/2/.test(li.textContent); }));
    await shot("11b-request-done");
    await page.click(".jt-req-x");
    const dPaid = (await st()).dollars;
    await tapWater(polypAt.x, polypAt.y - 30);
    await sleep(300);
    check("and isn't paid twice", (await st()).dollars <= dPaid + 1);

    // Feed picks up the food can; taps in the water sprinkle flakes right there
    await click(...button("feed"));
    const pickedUp = await page.waitForFunction(() => window.__tank.tool === "food", { timeout: 8000 }).then(() => true, () => false);
    check("feed picks up the food can", pickedUp);
    const polyp = await page.evaluate(() => ({ x: window.__tank.slots[0].x, y: window.__tank.slots[0].y }));
    await tapWater(polyp.x, polyp.y - 120);
    s = await st();
    check("tapping the water sprinkles food", s.food > 0, `food=${s.food}`);
    await shot("1b-pouring");
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      await tapWater(polyp.x + (i % 2 ? 20 : -20), polyp.y - 120);
    }
    await click(...button("feed"));
    const putDown = await page.waitForFunction(() => window.__tank.tool === "none", { timeout: 8000 }).then(() => true, () => false);
    check("feed again puts the can down", putDown);
    // growth runs on sim time, which a slow frame rate stretches (at most 0.1 s a frame): wait for it, up to 20 s
    await page.waitForFunction(() => window.__tank.slots[0]?.g >= 1 && window.__tank.dollars > 0, { timeout: 20000 }).catch(() => {});
    s = await st();
    check("polyp grew past polyp stage (fast mode)", (s.slots[0]?.g ?? 0) >= 1, `stage=${s.slots[0]?.g}`);
    check("care earned dollars", s.dollars > 0, `dollars=${s.dollars}`);
    await shot("3-fed");
    // v13: the first adult leaves a keepsake (the message in a bottle): a note, and the bottle in the tank
    const grown = await page.waitForFunction(() => window.__tank.slots[0]?.g === 3, { timeout: 20000 }).then(() => true, () => false);
    const keptNote = grown && (await page.waitForSelector(".jt-keep-note:not([hidden])", { timeout: 8000 }).then(() => true, () => false));
    const keptText = keptNote ? await page.evaluate(() => document.querySelector(".jt-keep-note").textContent) : "";
    const kept = await page.evaluate(() => window.__tank.owned[5] === true && (window.__tank.keep.earned & 1) === 1);
    check("the first adult leaves a keepsake: a note and the bottle", keptNote && /bottle/i.test(keptText) && kept, `${grown} ${kept} ${keptText}`);
    await shot("3b-keepsake");
    if (keptNote) await page.click(".jt-keep-note .ok");
    await sleep(200);
    // the rest of this run reaches more milestones (the journal check gives a jelly a ghost colour); a player would
    // close those notes, so this page closes them as they come (keepsakeFlow checks them one by one)
    await page.evaluate(() => setInterval(() => document.querySelector(".jt-keep-note:not([hidden]) .ok")?.click(), 150));

    await page.evaluate(() => { window.__tank.dollars = 300; });
    await click(...button("shop"));
    await shopUp();
    s = await st();
    check("shop opens", s.shop === true);
    await shot("4-shop");

    const tabBtn = (t) => centre(K.shopTabs[t]);
    // the JELLIES list scrolls: drag it up, check nothing was bought, then tap a tab while scrolled
    const d0s = (await st()).dollars;
    const c4 = centre(K.shopCards[16]);
    await page.mouse.move(OX + c4[0] * S, OY + c4[1] * S);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(OX + c4[0] * S, OY + (c4[1] - k * 20) * S);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(300);
    const sc = await page.evaluate(() => window.__tank.shopScroll);
    check("dragging the jellies list scrolls it", sc > 0, `scroll=${sc}`);
    await shot("4b-scrolled");
    check("a scroll-drag buys nothing", (await st()).dollars === d0s);
    await click(...tabBtn(1));
    await page.waitForFunction(() => window.__tank.tab === 1, { timeout: 8000 }).then(laidOut);
    await click(...tabBtn(0));
    await page.waitForFunction(() => window.__tank.tab === 0, { timeout: 8000 }).then(laidOut);
    check("tapping tabs while scrolled buys nothing", (await st()).dollars === d0s && (await st()).slots.filter(Boolean).length === 1);
    await click(...centre(K.shopCards[0]));
    s = await st();
    check("buy blue blubber polyp", s.slots.filter(Boolean).length === 2 && s.slots.some((j) => j && j.k === 1), JSON.stringify(s.slots));
    await click(...tabBtn(1));
    await page.waitForFunction(() => window.__tank.tab === 1, { timeout: 8000 }).then(laidOut).catch(() => {});
    check("decor tab", (await page.evaluate(() => window.__tank.tab)) === 1);
    await click(...centre(K.shopCards[4]));
    s = await st();
    check("buy anchor", s.owned[1] === true, JSON.stringify(s.owned));
    await click(...centre(K.shopCards[6]));
    s = await st();
    check("buy giant clam", s.owned[3] === true);
    const before = s.dollars;
    await click(...centre(K.shopCards[4]));
    s = await st();
    check("owned decor can't be bought twice", s.dollars === before);
    // v13: the bubbler (item 24, decoration 10) follows the sold decorations on the DECOR tab
    await page.evaluate(() => { window.__tank.dollars = Math.max(window.__tank.dollars, 300); });
    await click(...centre(K.shopCards[24]));
    check("buy the bubbler (decoration 10)", await until(page, () => window.__tank.owned[10] === true, null, 5000), JSON.stringify((await st()).owned));
    await shot("5-bought");
    await click(...tabBtn(2));
    await page.waitForFunction(() => window.__tank.tab === 2, { timeout: 8000 }).then(laidOut).catch(() => {});
    for (const i of [8, 9, 10]) await click(...centre(K.shopCards[i]));
    check("buy snail, shrimp, crab", (await page.evaluate(() => window.__tank.helpers.slice())).every(Boolean));
    await shot("5a-helpers");
    const blubbers = () => page.evaluate(() => window.__tank.slots.filter((j) => j && j.k === 1).length);
    const b0 = await blubbers();
    await click(...centre(K.shopCards[0]));
    check("tab 0 cards can't be clicked from tab 2", (await blubbers()) === b0); // (babies may be born meanwhile: count blubbers, not jellies)

    await click(...centre(K.shopClose));
    await sleep(600);
    s = await st();
    check("the X closes the shop", s.shop === false);
    await shopDown();
    s = await st();

    // daily pearl in the clam
    const clam = K.decor[3];
    const d0 = s.dollars;
    const scene = () => page.evaluate(() => {
      const t = window.__tank;
      const v = t.visit;
      return { visit: v ? { kind: v.kind, x: Math.round(v.x), y: Math.round(v.y), on: +v.on.toFixed(2) } : null, shopSlid: +(t.t - t.shop.t0).toFixed(2), tool: t.tool, card: !!document.querySelector(".jt-card:not([hidden])") };
    });
    const pearlScene = await scene();
    await click(clam.x + K.pearl.dx, clam.y + K.pearl.dy);
    s = await st();
    const pearlGone = await page.evaluate(() => !window.__tank.pearlWas && window.__tank.pearlDay !== "");
    // +15 for the pearl; a jelly finishing a meal in the same moment can add +1
    check("tap the pearl: +15", s.dollars >= d0 + 15 && s.dollars <= d0 + 17 && pearlGone, `${d0} -> ${s.dollars}${pearlGone ? "" : ` ${JSON.stringify(pearlScene)}`}`);

    // long-press the anchor and drag it along the sand
    const anchor = K.decor[1];
    const ax0 = await page.evaluate(() => window.__tank.decorX[1]);
    await page.mouse.move(OX + anchor.x * S, OY + (anchor.y - anchor.h / 2) * S);
    await page.mouse.down();
    // hold until it lifts (a long-press is decided on the frame after LONG_MS, so under load that is later)
    await page.waitForFunction(() => window.__tank.lifted === 1, { timeout: 8000 }).catch(() => {});
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(OX + (anchor.x + k * 22) * S, OY + (anchor.y - anchor.h / 2) * S);
      await sleep(30);
    }
    await shot("5c-dragging");
    await page.mouse.up();
    await sleep(200);
    const ax1 = await page.evaluate(() => window.__tank.decorX[1]);
    check("drag moves the anchor", ax1 > ax0 + 100, `${ax0} -> ${ax1}`);

    // long-press a jelly: its card opens; rename it
    const jj = await page.evaluate(() => { const j = window.__tank.slots[0]; return { x: j.x, y: j.y }; });
    const jy = await page.evaluate(() => { const s = window.__tank; return s.slots[0].g === 0 ? -30 : -40; });
    await page.mouse.move(OX + jj.x * S, OY + (jj.y + jy) * S);
    await page.mouse.down();
    await page.waitForFunction(() => !document.querySelector(".jt-card").hidden, { timeout: 8000 }).catch(() => {}); // hold until it opens
    await page.mouse.up();
    await sleep(200);
    const cardOpen = await page.evaluate(() => !document.querySelector(".jt-card").hidden);
    check("long-press opens the jelly card", cardOpen);
    // v13: the card has its personality line
    const trait = await page.evaluate(() => { const t = document.querySelector(".jt-card .jt-trait"); return t && !t.hidden ? t.textContent : ""; });
    check("the card says the jelly's personality", /^(Shy|Curious|Sleepy|Social) — /.test(trait), trait);
    if (cardOpen) {
      await page.click("#jt-name");
      await page.evaluate(() => document.querySelector("#jt-name").select());
      await page.keyboard.type("Pudding");
      await page.keyboard.press("Enter");
      await shot("5d-card");
      await page.click(".jt-close");
      const nm = await page.evaluate(() => window.__tank.slots[0].name);
      check("rename sticks", nm === "Pudding", nm);
    }

    // tank upgrade: buy MEDIUM on the TANK tab, the wall slides out, then swipe to pan
    await page.evaluate(() => { window.__tank.dollars = 600; });
    await click(...button("shop"));
    await shopUp();
    await click(...centre(K.shopTabs[3]));
    await page.waitForFunction(() => window.__tank.tab === 3, { timeout: 8000 }).then(laidOut).catch(() => {});
    await click(...centre(K.shopCards[12]));
    check("large needs medium first", (await page.evaluate(() => window.__tank.tier)) === 0);
    await click(...centre(K.shopCards[11]));
    await sleep(3200);
    const up = await page.evaluate(() => ({ tier: window.__tank.tier, shop: window.__tank.shop.open }));
    check("buy medium tank", up.tier === 1 && !up.shop, JSON.stringify(up));
    await shot("7-medium");

    // supplies: buy brine shrimp, pick the jar off the shelf, pour; then buy and apply a theme
    await page.evaluate(() => { window.__tank.dollars = Math.max(window.__tank.dollars, 600); });
    await click(...button("shop"));
    await shopUp();
    await click(...centre(K.shopTabs[2]));
    await page.waitForFunction(() => window.__tank.tab === 2, { timeout: 8000 }).then(laidOut).catch(() => {});
    await click(...centre(K.shopCards[18]));
    check("buy brine shrimp", await page.evaluate(() => window.__tank.foods[1] === true));
    await click(...centre(K.shopTabs[3]));
    await page.waitForFunction(() => window.__tank.tab === 3, { timeout: 8000 }).then(laidOut).catch(() => {});
    await click(...centre(K.shopCards[21]));
    const themed = await page.waitForFunction(() => window.__tank.theme === 1, { timeout: 4000 }).then(() => true, () => false);
    check("buying Kelp Forest applies it", themed, String(await page.evaluate(() => window.__tank.theme)));
    await sleep(1200);
    await shot("7b-kelp-theme");
    if (await page.evaluate(() => window.__tank.shop.open)) await click(...centre(K.shopClose));
    await shopDown(); // the panel slides over the shelf on its way out
    await sleep(150);
    await click(...button("shrimp"));
    const jar = await page.waitForFunction(() => window.__tank.tool === "shrimp", { timeout: 8000 }).then(() => true, () => false);
    check("the shrimp jar comes off the shelf", jar);
    await tapWater(360 - (await page.evaluate(() => window.__tank.cam.x)), 400);
    const shrimpIn = await page.evaluate(() => window.__tank.food.some((f) => f.state !== "off" && f.kind === 1));
    check("the jar pours brine shrimp", shrimpIn);
    await click(...button("shrimp"));
    const camAt = () => page.evaluate(() => window.__tank.cam?.x ?? null);
    const cam0 = await camAt();
    await page.mouse.move(OX + 120 * S, OY + 500 * S);
    await page.mouse.down();
    for (let k = 1; k <= 12; k++) {
      await page.mouse.move(OX + (120 + k * 40) * S, OY + 500 * S);
      await sleep(16);
    }
    await page.mouse.up();
    await sleep(1200);
    const after = await camAt();
    check("swipe pans the camera", cam0 !== null && after !== null && after !== cam0, `${cam0} -> ${after}`);
    await shot("8-panned");

    // hood: journal, music, share + visit
    await page.click(".jt-gear");
    check("settings opens its menu", await page.evaluate(() => !document.querySelector(".jt-menu").hidden));
    await shot("8b-settings");
    await page.click(".jt-menu-journal");
    await sleep(200);
    const bookOpen = await page.evaluate(() => !document.querySelector(".jt-book").hidden);
    const firstPage = await page.evaluate(() => document.querySelector(".jt-book-name").textContent);
    check("journal opens on the moon jelly", bookOpen && /moon/i.test(firstPage), `${bookOpen} ${firstPage}`);
    await page.click(".jt-book .next");
    const secondPage = await page.evaluate(() => document.querySelector(".jt-book-name").textContent);
    check("journal pages turn (blubber owned)", /blubber/i.test(secondPage), secondPage);
    // v12: the morph rows: classic and ghost, "???" until raised
    const rows = await page.evaluate(() => [...document.querySelectorAll(".jt-book-morph")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
    const seenBits = await page.evaluate(() => window.__tank.journal[1].morphSeen); // a blubber baby may have been the rare colour
    check("journal lists both morphs, unknown as ???", rows.length === 2 && rows.every((r, i) => /\?\?\?/.test(r) === !(seenBits & (1 << i))), JSON.stringify(rows));
    await page.click(".jt-book .prev");
    await page.evaluate(() => { window.__tank.journal[0].morphSeen |= 2; });
    await page.click(".jt-book .next");
    await page.click(".jt-book .prev");
    const ghostRow = await page.evaluate(() => { const r = document.querySelector(".jt-book-morph.ghost"); return { found: r.classList.contains("found"), text: r.textContent }; });
    check("a raised ghost morph shows in the journal", ghostRow.found && /ghost moon/i.test(ghostRow.text), JSON.stringify(ghostRow));
    await page.click(".jt-book .next");
    await shot("9-journal");
    await page.click(".jt-book-x");
    await page.click(".jt-gear");
    const m0 = await page.evaluate(() => document.querySelector(".jt-menu-music").getAttribute("aria-checked"));
    await page.click(".jt-menu-music");
    const m1 = await page.evaluate(() => document.querySelector(".jt-menu-music").getAttribute("aria-checked"));
    check("the menu stays open after a toggle", await page.evaluate(() => !document.querySelector(".jt-menu").hidden));
    check("music button toggles", m0 !== m1, `${m0} -> ${m1}`);

    // photo mode: no window.claude here, so the PNG goes out through an <a download> link; catch its blob
    await page.evaluate(() => {
      window.__photoHref = null;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__photoHref = this.href;
      };
    });
    await page.click(".jt-menu-photo");
    const gotPhoto = await page.waitForFunction(() => window.__photoHref, { timeout: 20000 }).then(() => true, () => false);
    const photo = gotPhoto
      ? await page.evaluate(async () => {
          const blob = await (await fetch(window.__photoHref)).blob();
          const bmp = await createImageBitmap(blob);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d");
          ctx.drawImage(bmp, 0, 0);
          const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          const colours = new Set();
          let lit = 0;
          for (let i = 0; i < px.length; i += 4 * 97) {
            colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
            if (px[i] + px[i + 1] + px[i + 2] > 120) lit++;
          }
          const b64 = await new Promise((r) => {
            const fr = new FileReader();
            fr.onload = () => r(String(fr.result).split(",")[1]);
            fr.readAsDataURL(blob);
          });
          return { type: blob.type, w: bmp.width, h: bmp.height, colours: colours.size, lit, b64 };
        })
      : null;
    if (photo) {
      writeFileSync(new URL("../shots/e2e-8c-photo.png", import.meta.url), Buffer.from(photo.b64, "base64"));
      delete photo.b64;
    }
    check(
      "take a photo: a portrait, non-blank PNG",
      !!photo && photo.type === "image/png" && photo.h > photo.w && photo.w > 300 && photo.colours > 200 && photo.lit > 200,
      JSON.stringify(photo),
    );
    await page.click(".jt-gear");
    await page.click(".jt-menu-share");
    await sleep(150);
    const code = await page.evaluate(() => document.querySelector("#jt-my-code").value);
    check("share code is made", code.length > 8 && code.length < 400, `len=${code.length}`);
    await page.type("#jt-visit-code", "not-a-tank");
    await page.click(".jt-share .go");
    const err = await page.evaluate(() => document.querySelector(".jt-share .err").textContent);
    check("a bad code is refused", err.length > 0, err);
    await page.click(".jt-share .x");

    // Clean picks up the sponge; rubbing a dirty spot scrubs it off for +1
    const spot = await page.evaluate(() => {
      const t = window.__tank;
      const cam = t.cam.x;
      const sp = { x: 360 - cam, y: 520, dirt: 1, v: 0, peak: 1 };
      t.spots[0] = sp;
      window.__spot = sp; // checked by identity: once it's gone a new spot can take slot 0 (one appears every 90-150 s)
      return { x: sp.x, y: sp.y };
    });
    const spotDirt = () => page.evaluate(() => (window.__tank.spots.includes(window.__spot) ? window.__spot.dirt : 0));
    const dSpot = (await st()).dollars;
    await click(...button("clean"));
    check("clean picks up the sponge", await page.waitForFunction(() => window.__tank.tool === "sponge", { timeout: 8000 }).then(() => true, () => false));
    const cam2 = await page.evaluate(() => window.__tank.cam.x);
    const sx = OX + (spot.x + cam2) * S, sy = OY + spot.y * S;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // rub until the spot is clean (each move is ~25 px of rubbing; a full spot takes ~1050 px, so ~45 moves),
    // checking as it goes: under load a move can take 200 ms, and rubbing on long after it's gone is pointless
    for (let k = 0; k < 440; k++) {
      await page.mouse.move(sx + Math.sin(k * 0.9) * 40 * S, sy + Math.cos(k * 0.7) * 16 * S);
      await sleep(16);
      if (k % 20 === 19 && (await spotDirt()) < 0.05) break;
    }
    await shot("6b-scrubbing");
    await page.mouse.up();
    await sleep(300);
    const left = await spotDirt();
    check("scrubbing clears the spot", left < 0.05, `dirt=${left.toFixed(2)}`);
    check("a scrubbed spot pays +1", (await st()).dollars >= dSpot + 1, `${dSpot} -> ${(await st()).dollars}`);
    await click(...button("clean"));

    const j = s.slots.find((x) => x && x.g > 0) ?? s.slots[0];
    const petScene = await scene();
    const petLog = [];
    for (let k = 0; k < 4; k++) {
      // aim where the jelly is now (one round trip: it swims, and under load a round trip can span frames)
      const at = await page.evaluate(() => { const x = window.__tank.slots[0]; return { x: x.x, y: x.y, g: x.g, w: x.wiggleT0, t: window.__tank.t, cam: window.__tank.cam.x }; });
      await page.mouse.click(OX + (at.x + at.cam) * S, OY + (at.y - 40) * S); // the bell sits above the rim origin
      await sleep(140);
      petLog.push({ ...(await page.evaluate(() => { const x = window.__tank.slots[0]; return { x2: Math.round(x.x), y2: Math.round(x.y), w2: x.wiggleT0, t2: window.__tank.t, tags: document.querySelectorAll(".jt-tag").length, tool: window.__tank.tool, card: !document.querySelector(".jt-card").hidden, visit: window.__tank.visit && window.__tank.visit.kind }; })), x: Math.round(at.x), y: Math.round(at.y), g: at.g, w: at.w, t: at.t, cam: at.cam });
    }
    const tagsShown = await page.evaluate(() => document.querySelectorAll(".jt-tag").length);
    check("petting again doesn't stack name tags", tagsShown === 1, `tags=${tagsShown}${tagsShown === 1 ? "" : ` ${JSON.stringify(petScene)} ${JSON.stringify(petLog)}`}`);
    await sleep(300);
    s = await st();
    await sleep(12000);
    await shot("6-later");

    // back up the save, spend some dollars, restore the backup: the dollars come back
    await page.click(".jt-gear");
    await page.click(".jt-menu-backup");
    const saveCode = await page.evaluate(() => document.querySelector("#jt-save-code").value);
    const savedDollars = (await st()).dollars;
    check("backup makes a save code", saveCode.startsWith("JTSAVE1."), `len=${saveCode.length}`);
    await page.click(".jt-share:not([hidden]) .x");
    await page.evaluate(() => { window.__tank.dollars = 3; });
    await page.click(".jt-gear");
    await page.click(".jt-menu-restore");
    await page.evaluate((c) => { const a = document.querySelector("#jt-save-code"); a.value = c; }, saveCode);
    await page.click(".jt-share:not([hidden]) .act");
    await Promise.all([page.waitForNavigation(), page.click(".jt-share:not([hidden]) .act")]);
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
    const restored = (await st()).dollars;
    check("restore brings the save back", restored >= savedDollars, `${savedDollars} -> ${restored}`);

    // visit our own tank's code read-only, then come back
    const myCode = await page.evaluate(() => { document.querySelector(".jt-share") && 0; return null; });
    await page.click(".jt-gear");
    await page.click(".jt-menu-share");
    await sleep(150);
    const visitCode = await page.evaluate(() => document.querySelector("#jt-my-code").value);
    await page.evaluate((c) => { document.querySelector("#jt-visit-code").value = c; }, visitCode);
    await Promise.all([page.waitForNavigation(), page.click(".jt-share .go")]);
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
    const bar = await page.evaluate(() => !!document.querySelector(".jt-visit-bar"));
    check("visiting shows the read-only banner", bar);
    check("no requests note in someone else's tank", await page.evaluate(() => !document.querySelector(".jt-req-btn:not([hidden])") && window.__tank.requestsOn === false));
    await shot("10-visiting");
    await Promise.all([page.waitForNavigation(), page.click(".jt-visit-bar .back")]);
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
    check("back to my tank", !(await page.evaluate(() => !!document.querySelector(".jt-visit-bar"))));
    check("no page errors", errors.length === 0, errors.join(" | "));

    await page.close(); // one swiftshader tank at a time
    await keyboardFlow(browser);
    await keepsakeFlow(browser);
    await friendsFlow(browser);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

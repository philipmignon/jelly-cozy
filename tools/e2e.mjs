/**
 * Click-through smoke test: the real dev build in headless Chrome, real mouse
 * presses on the .riv's buttons, checks on window.__tank after each one.
 * The only check that a control still reaches the host once the .riv changes.
 *
 *   npm run e2e        (needs Google Chrome; screenshots land in shots/e2e-*.png)
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const K = JSON.parse(readFileSync(new URL("../src/contract.json", import.meta.url)));
const PORT = Number(process.env.E2E_PORT) || 5198;
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
    const p = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
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
    const click = async (ax, ay) => {
      await page.mouse.click(OX + ax * S, OY + ay * S);
      await sleep(250);
    };
    const tapWater = async (wx, wy) => {
      const cam = await page.evaluate(() => window.__tank.cam.x);
      await page.mouse.click(OX + (wx + cam) * S, OY + wy * S);
      await sleep(140);
    };
    const shot = (name) => page.screenshot({ path: `shots/e2e-${name}.png` });

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

    // Feed picks up the food can; taps in the water sprinkle flakes right there
    await click(...button("feed"));
    const pickedUp = await page.waitForFunction(() => window.__tank.tool === "food", { timeout: 3000 }).then(() => true, () => false);
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
    const putDown = await page.waitForFunction(() => window.__tank.tool === "none", { timeout: 3000 }).then(() => true, () => false);
    check("feed again puts the can down", putDown);
    await sleep(4000);
    s = await st();
    check("polyp grew past polyp stage (fast mode)", (s.slots[0]?.g ?? 0) >= 1, `stage=${s.slots[0]?.g}`);
    check("care earned dollars", s.dollars > 0, `dollars=${s.dollars}`);
    await shot("3-fed");

    await page.evaluate(() => { window.__tank.dollars = 300; });
    await click(...button("shop"));
    await sleep(700);
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
    await page.waitForFunction(() => window.__tank.tab === 1, { timeout: 3000 }).then(() => sleep(400));
    await click(...tabBtn(0));
    await page.waitForFunction(() => window.__tank.tab === 0, { timeout: 3000 }).then(() => sleep(400));
    check("tapping tabs while scrolled buys nothing", (await st()).dollars === d0s && (await st()).slots.filter(Boolean).length === 1);
    await click(...centre(K.shopCards[0]));
    s = await st();
    check("buy blue blubber polyp", s.slots.filter(Boolean).length === 2 && s.slots.some((j) => j && j.k === 1), JSON.stringify(s.slots));
    await click(...tabBtn(1));
    await page.waitForFunction(() => window.__tank.tab === 1, { timeout: 3000 }).then(() => sleep(400)).catch(() => {});
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
    await shot("5-bought");
    await click(...tabBtn(2));
    await page.waitForFunction(() => window.__tank.tab === 2, { timeout: 3000 }).then(() => sleep(400)).catch(() => {});
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

    // daily pearl in the clam
    const clam = K.decor[3];
    const d0 = s.dollars;
    await click(clam.x + K.pearl.dx, clam.y + K.pearl.dy);
    s = await st();
    const pearlGone = await page.evaluate(() => !window.__tank.pearlWas && window.__tank.pearlDay !== "");
    // +15 for the pearl; a jelly finishing a meal in the same moment can add +1
    check("tap the pearl: +15", s.dollars >= d0 + 15 && s.dollars <= d0 + 17 && pearlGone, `${d0} -> ${s.dollars}`);

    // long-press the anchor and drag it along the sand
    const anchor = K.decor[1];
    const ax0 = await page.evaluate(() => window.__tank.decorX[1]);
    await page.mouse.move(OX + anchor.x * S, OY + (anchor.y - anchor.h / 2) * S);
    await page.mouse.down();
    await sleep(650);
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
    await sleep(650);
    await page.mouse.up();
    await sleep(200);
    const cardOpen = await page.evaluate(() => !document.querySelector(".jt-card").hidden);
    check("long-press opens the jelly card", cardOpen);
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
    await sleep(600);
    await click(...centre(K.shopTabs[3]));
    await page.waitForFunction(() => window.__tank.tab === 3, { timeout: 3000 }).then(() => sleep(400)).catch(() => {});
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
    await sleep(600);
    await click(...centre(K.shopTabs[2]));
    await page.waitForFunction(() => window.__tank.tab === 2, { timeout: 3000 }).then(() => sleep(400)).catch(() => {});
    await click(...centre(K.shopCards[18]));
    check("buy brine shrimp", await page.evaluate(() => window.__tank.foods[1] === true));
    await click(...centre(K.shopTabs[3]));
    await page.waitForFunction(() => window.__tank.tab === 3, { timeout: 3000 }).then(() => sleep(400)).catch(() => {});
    await click(...centre(K.shopCards[21]));
    const themed = await page.waitForFunction(() => window.__tank.theme === 1, { timeout: 4000 }).then(() => true, () => false);
    check("buying Kelp Forest applies it", themed, String(await page.evaluate(() => window.__tank.theme)));
    await sleep(1200);
    await shot("7b-kelp-theme");
    if (await page.evaluate(() => window.__tank.shop.open)) await click(...centre(K.shopClose));
    await sleep(500);
    await click(...button("shrimp"));
    const jar = await page.waitForFunction(() => window.__tank.tool === "shrimp", { timeout: 3000 }).then(() => true, () => false);
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
    const gotPhoto = await page.waitForFunction(() => window.__photoHref, { timeout: 5000 }).then(() => true, () => false);
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
      return { x: sp.x, y: sp.y };
    });
    const dSpot = (await st()).dollars;
    await click(...button("clean"));
    check("clean picks up the sponge", (await page.evaluate(() => window.__tank.tool)) === "sponge");
    const cam2 = await page.evaluate(() => window.__tank.cam.x);
    const sx = OX + (spot.x + cam2) * S, sy = OY + spot.y * S;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let k = 0; k < 220; k++) {
      await page.mouse.move(sx + Math.sin(k * 0.9) * 40 * S, sy + Math.cos(k * 0.7) * 16 * S);
      await sleep(16);
    }
    await shot("6b-scrubbing");
    await page.mouse.up();
    await sleep(300);
    const left = await page.evaluate(() => window.__tank.spots[0]?.dirt ?? 0);
    check("scrubbing clears the spot", left < 0.05, `dirt=${left.toFixed(2)}`);
    check("a scrubbed spot pays +1", (await st()).dollars >= dSpot + 1, `${dSpot} -> ${(await st()).dollars}`);
    await click(...button("clean"));

    const j = s.slots.find((x) => x && x.g > 0) ?? s.slots[0];
    for (let k = 0; k < 4; k++) {
      const at = await page.evaluate(() => { const x = window.__tank.slots[0]; return { x: x.x, y: x.y }; });
      await tapWater(at.x, at.y - 40); // the bell sits above the rim origin
    }
    const tagsShown = await page.evaluate(() => document.querySelectorAll(".jt-tag").length);
    check("petting again doesn't stack name tags", tagsShown === 1, `tags=${tagsShown}`);
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
    await shot("10-visiting");
    await Promise.all([page.waitForNavigation(), page.click(".jt-visit-bar .back")]);
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
    check("back to my tank", !(await page.evaluate(() => !!document.querySelector(".jt-visit-bar"))));
    check("no page errors", errors.length === 0, errors.join(" | "));

    await page.close(); // one swiftshader tank at a time
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

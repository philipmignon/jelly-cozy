/**
 * Click-through smoke test: the real dev build in headless Chrome, real mouse
 * presses on the .riv's buttons, checks on window.__tank after each one.
 * The only check that a control still reaches the host once the .riv changes.
 *
 *   npm run e2e        (needs Google Chrome; screenshots land in shots/e2e-*.png)
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const K = JSON.parse(readFileSync(new URL("../src/contract.json", import.meta.url)));
const PORT = 5198;
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
    await Promise.all([page.waitForNavigation(), page.click(".jt-visit-bar button")]);
    await page.waitForFunction(() => window.__tank && window.__tank.t > 0.5, { timeout: 15000 });
    check("back to my tank", !(await page.evaluate(() => !!document.querySelector(".jt-visit-bar"))));
    check("no page errors", errors.length === 0, errors.join(" | "));
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

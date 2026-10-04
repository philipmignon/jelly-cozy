/**
 * Decorations: the clam's daily pearl (+15); a long-press lifts the anchor and drags it along the sand; carried
 * down onto the drawer that slides up from the cabinet it's put away (nothing on the shelf under the finger is
 * picked up), and its shop card places it back.
 */
import { K, jelly, save, sleep } from "../lib.mjs";

/** where decoration n's base sits at world x (sim decorY): on the sand there */
const decorBase = (n, x) => {
  const d = K.decor[n];
  const sand = (v) => K.sandTop[Math.floor(v / K.P)] ?? 960;
  return Math.min(Math.max(K.waterBot, d.y), Math.round((sand(x) + d.y - sand(d.x)) / K.P) * K.P);
};

export const flow = {
  name: "decor",
  async run(t) {
    const owned = Array.from({ length: 11 }, (_, n) => n === 1 || n === 3); // the anchor and the giant clam
    await t.open({ save: save({ slots: [jelly(0, 3)], owned, dollars: 20 }) });
    const { page } = t;
    const st = () => t.st();

    // the daily pearl in the clam
    let s = await st();
    const d0 = s.dollars;
    const cx = s.decorX[3];
    await t.tapWorld(cx + K.pearl.dx, decorBase(3, cx) + K.pearl.dy);
    await t.advance(100);
    s = await st();
    const gone = !s.pearlWas && s.pearlDay !== "";
    // +15 for the pearl; a jelly finishing a meal in the same moment can add +1
    t.check("tap the pearl: +15", s.dollars >= d0 + 15 && s.dollars <= d0 + 17 && gone, `${d0} -> ${s.dollars} ${gone}`);

    // long-press the anchor and drag it along the sand
    const anchor = K.decor[1];
    const ax0 = s.decorX[1];
    const ay = decorBase(1, ax0) - anchor.h / 2;
    await page.mouse.move(...(await t.world(ax0, ay)));
    await page.mouse.down();
    // a long-press is decided on the frame after LONG_MS (real time: the gesture's own timer)
    await t.until(() => window.__tank.lifted === 1, null, { timeout: 8000 });
    const [px, py] = await t.world(ax0, ay);
    const { s: k } = t.fit;
    for (let i = 1; i <= 10; i++) await page.mouse.move(px + i * 22 * k, py);
    await t.advance(100);
    await t.shot("5c-dragging");
    await page.mouse.up();
    await t.advance(100);
    const ax1 = (await st()).decorX[1];
    t.check("drag moves the anchor", ax1 > ax0 + 100, `${ax0} -> ${ax1}`);
    await t.idle();

    // v15: carry it down onto the drawer: it's put away, and nothing on the shelf under the finger is picked up
    const ay2 = decorBase(1, ax1) - anchor.h / 2;
    const [qx, qy] = await t.world(ax1, ay2);
    await page.mouse.move(qx, qy);
    await page.mouse.down();
    await t.until(() => window.__tank.lifted === 1, null, { timeout: 8000 });
    const [dx, dy] = t.art(K.store.x + K.store.w / 2, K.store.y + 30);
    for (let i = 1; i <= 8; i++) await page.mouse.move(qx + ((dx - qx) * i) / 8, qy + ((dy - qy) * i) / 8);
    const hot = await t.until(() => window.__tank.drawer.hot && window.__tank.drawer.e > 0.9, null, { pump: true, timeout: 5000 });
    await t.shot("5d-drawer");
    await page.mouse.up();
    await t.advance(100);
    s = await st();
    t.check("dropping a decoration on the drawer puts it away (and presses nothing on the shelf)", hot && s.stored[1] === true && s.lifted === -1 && s.tool === "none",
      JSON.stringify({ hot, drawer: s.drawer, stored: s.stored[1], tool: s.tool }));
    await t.idle();

    // its card places it again where there's room. (The cabinet's buttons ignore presses for 400 ms of real time
    // after a drop, as Rive clicks whatever was under the finger: wait that out before pressing Shop.)
    await sleep(450);
    await t.openShop();
    if ((await st()).tab !== 1) await t.showTab(1);
    await t.click(...t.card(4));
    s = await st();
    t.check("its card places it back in the tank", s.stored[1] === false && s.owned[1] === true);
    await t.closeShop();
    t.noErrors();
  },
};

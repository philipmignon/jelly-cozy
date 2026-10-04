/**
 * Reference screenshots, the tank itself: a new day tank, the full tank, night with a night visitor, Halloween
 * night, reduce motion, the drawer while carrying a decoration, a phone and a small phone. Each scene is compared
 * pixel by pixel with tools/e2e/reference/<set>/<scene>.png (scenes.mjs, visual.mjs); `npm run e2e:update-refs`
 * re-renders them.
 */
import { K, jelly, save } from "../lib.mjs";
import { PHONE, SMALL, done, everyday, full, halloween, snap } from "../scenes.mjs";

/** where decoration n's base sits at world x (as flows/decor.mjs works it out) */
const decorBase = (n, x) => {
  const d = K.decor[n];
  const sand = (v) => K.sandTop[Math.floor(v / K.P)] ?? 960;
  return Math.min(Math.max(K.waterBot, d.y), Math.round((sand(x) + d.y - sand(d.x)) / K.P) * K.P);
};

export const flow = {
  name: "visual-tank",
  async run(t) {
    // a new game, day: one moon polyp in the small tank
    await t.open();
    await t.advance(2000);
    await snap(t, "day-new");
    await done(t);

    // the full tank: seven species, every decoration, the keepsakes, the bubbler, the helpers
    await t.open({ save: full() });
    // all seven in the view (the large tank is twice the screen's width): spread over the water, then a moment's swim
    await t.eval(() => [[130, 330], [360, 250], [590, 330], [180, 590], [430, 520], [620, 650], [330, 800]].forEach(([x, y], i) => window.__jt.place(i, x, y)));
    await t.advance(1500);
    const s = await t.st();
    t.check("visual: the full tank has 7 jellies and 11 decorations", s.slots.filter(Boolean).length === 7 && s.owned.every(Boolean), JSON.stringify({ n: s.slots.filter(Boolean).length, owned: s.owned }));
    await snap(t, "full-tank");
    await done(t);

    // night: the light off, the octopus visiting
    await t.open({ save: everyday() });
    await t.eval(() => window.__jt.setNight(true));
    await t.idle();
    const came = await t.eval(() => window.__jt.spawnVisitor("octopus"));
    await t.advance(4000);
    t.check("visual: the octopus came in at night", came && (await t.st()).visit?.kind === 4);
    await snap(t, "night-visitor");
    await done(t);

    // Halloween night: the pumpkins, the bat hanging from the hood, a ghost moon
    await t.open({ save: halloween() });
    await t.eval(() => window.__jt.setSeason("halloween"));
    await t.eval(() => window.__jt.setNight(true));
    await t.idle();
    const bat = await t.eval(() => window.__jt.spawnVisitor("bat"));
    await t.advance(6000);
    const h = await t.st();
    t.check("visual: Halloween night with the bat", bat && h.event === "halloween" && h.visit?.kind === 3 && h.nightTarget, JSON.stringify({ bat, event: h.event, visit: h.visit?.kind }));
    await snap(t, "halloween-night");
    await done(t);

    // reduce motion (calm): the same everyday tank with the setting on
    await t.open({ save: everyday(), storage: { "jellytank:reduceMotion": "1" } });
    await t.advance(2000);
    t.check("visual: reduce motion is on", await t.eval(() => window.__tank.reducedMotion === true));
    await snap(t, "calm");
    await done(t);

    // carrying the anchor down onto the drawer (as flows/decor.mjs): the drawer up, hot, the anchor over it
    await t.open({ save: save({ slots: [jelly(0, 3)], owned: Array.from({ length: 11 }, (_, n) => n === 1 || n === 3), dollars: 20 }) });
    const { page } = t;
    const ax = (await t.st()).decorX[1];
    const [qx, qy] = await t.world(ax, decorBase(1, ax) - K.decor[1].h / 2);
    await page.mouse.move(qx, qy);
    await page.mouse.down();
    const lifted = await t.until(() => window.__tank.lifted === 1, null, { timeout: 8000 }); // real time: the long-press timer
    const [dx, dy] = t.art(K.store.x + K.store.w / 2, K.store.y + 30);
    for (let i = 1; i <= 8; i++) await page.mouse.move(qx + ((dx - qx) * i) / 8, qy + ((dy - qy) * i) / 8);
    const hot = await t.until(() => window.__tank.drawer.hot && window.__tank.drawer.e === 1, null, { pump: true, timeout: 5000 });
    t.check("visual: carrying the anchor over the open drawer", lifted && hot);
    await snap(t, "drawer-carrying", undefined, { settle: false });
    await page.mouse.up();
    await done(t);

    // phones: the everyday tank at 390x844 and at 360x640
    await t.open({ save: everyday(), view: PHONE });
    await t.advance(2000);
    await snap(t, "phone-390x844");
    await done(t);
    await t.open({ save: everyday(), view: SMALL });
    await t.advance(2000);
    await snap(t, "small-360x640");
    await done(t);
    t.noErrors();
  },
};

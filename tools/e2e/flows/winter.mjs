/**
 * Winter, through the test API: the season forced on (its art fetched, the event showing) with a frost moon, a frost
 * lion's mane and a plain fried egg in the tank; the penguin zips in, is logged, and a tap greets it (sand dollars);
 * winter at night (the frost creeps further in); then the room on a wide screen, raining at dusk and snowing on a
 * winter night (?weather= forces it), with its weather layer over the window.
 */
import { NOW, blank, dayKey, entry, jelly, save } from "../lib.mjs";

const WIDE = { width: 1440, height: 900 };
const winterSave = () =>
  save({
    slots: [jelly(0, 3, { name: "Mochi", morph: 3 }), jelly(8, 2, { name: "Pip", morph: 3 }), jelly(4, 3, { name: "Tofu" })],
    journal: [entry(1, { morphSeen: 4 }), blank(), blank(), blank(), entry(1), blank(), blank(), blank(), entry(0, { morphSeen: 4 })],
    owned: [false, false, false, true, false, false, false, false, false, false, false],
    keep: { earned: 0b101, days: 1, lastDay: dayKey(NOW), requests: 0 },
    dollars: 30,
  });

export const flow = {
  name: "winter",
  async run(t) {
    await t.open({ save: winterSave() });
    const { page } = t;
    await page.evaluate(() => window.__jt.setSeason("winter"));
    await t.advance(500);
    let s = await t.st();
    const ready = await page.evaluate(() => window.__spriteGroups.isReady("ev-winter"));
    t.check("winter: forced on, its art in, the event showing", s.event === "winter" && ready, JSON.stringify({ event: s.event, ready }));
    t.check("winter: the frost jellies keep their morph (3)", s.slots[0]?.morph === 3 && s.slots[1]?.morph === 3, JSON.stringify(s.slots.map((j) => j?.morph)));
    await t.idle();
    await t.shot("winter-day");

    // the penguin
    const came = await page.evaluate(() => window.__jt.spawnVisitor("penguin"));
    await t.advance(3000);
    s = await t.st();
    t.check("winter: the penguin zips in and the visitor log notes it", came && s.visit?.kind === 7 && s.visitorsSeen.penguin?.n === 1, JSON.stringify({ came, visit: s.visit?.kind, seen: s.visitorsSeen.penguin }));
    await t.shot("winter-penguin");
    const before = s.dollars;
    await t.tapWorld(s.visit.x, s.visit.y);
    await t.advance(500);
    s = await t.st();
    t.check("winter: a tap greets the penguin with sand dollars", s.dollars > before && s.visit?.happy === true, JSON.stringify({ before, after: s.dollars, happy: s.visit?.happy }));
    let gone = false;
    for (let i = 0; i < 12 && !gone; i++) {
      await t.advance(1000);
      gone = (await t.st()).visit === null;
    }
    t.check("winter: greeted, it zips off", gone);

    // winter at night
    await page.evaluate(() => window.__jt.setNight(true));
    await t.idle();
    s = await t.st();
    t.check("winter: night by the light switch", s.nightTarget === true && s.event === "winter");
    await t.shot("winter-night");

    // the room, raining at dusk (no season), then snowing on a winter night
    for (const [name, query, want] of [["room-rain", { sky: "dusk", weather: "rain" }, "rain"], ["room-snow", { sky: "night", season: "winter", weather: "snow" }, "snow"]]) {
      await t.open({ view: WIDE, query });
      const shown = await t.until(() => {
        const r = document.querySelector(".jt-room.jt-room-on");
        return !!r && r.querySelectorAll(".jt-room-scene canvas").length === 4 && !!r.querySelector(".jt-room-weather");
      }, null, { timeout: 15_000, pump: true });
      const w = await t.page.evaluate(() => document.querySelector(".jt-room")?.dataset.weather);
      t.check(`winter: ${name}: the room shows the weather layer over its window`, shown && w === want, JSON.stringify({ shown, w }));
      await t.advance(1500);
      await new Promise((r) => setTimeout(r, 400)); // the weather layer draws on real time (10 fps)
      await t.shot(name);
    }
    // a clear evening: no weather layer (the three canvases as before)
    await t.open({ view: WIDE, query: { sky: "dusk", weather: "none" } });
    const clear = await t.until(() => {
      const r = document.querySelector(".jt-room.jt-room-on");
      return !!r && r.querySelectorAll(".jt-room-scene canvas").length === 3 && r.dataset.weather === "none";
    }, null, { timeout: 15_000, pump: true });
    t.check("winter: a clear evening has no weather layer", clear);
    t.noErrors();
  },
};

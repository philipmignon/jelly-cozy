/**
 * Seasons and night visitors, through the test API: Halloween forced on (its art fetched, the event showing), night
 * by the light switch, a night visitor (the octopus) coming in and logged, leaving when the light comes on; then
 * no season at all.
 */
import { jelly, save } from "../lib.mjs";

export const flow = {
  name: "seasons",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3), jelly(2, 3)], dollars: 10 }) });
    const { page } = t;

    await page.evaluate(() => window.__jt.setSeason("halloween"));
    await t.advance(100);
    let s = await t.st();
    t.check("seasons: Halloween forced on shows its event", s.event === "halloween", String(s.event));
    await t.idle();
    await t.shot("season-halloween");

    await page.evaluate(() => window.__jt.setNight(true));
    await t.idle();
    s = await t.st();
    t.check("seasons: night by the light switch", s.nightTarget === true && s.night > 0.999, JSON.stringify({ target: s.nightTarget, night: s.night }));
    const came = await page.evaluate(() => window.__jt.spawnVisitor("octopus"));
    await t.advance(3000);
    s = await t.st();
    t.check("night visitors: the octopus comes in and the visitor log notes it", came && s.visit?.kind === 4 && s.visitorsSeen.octopus?.n === 1, JSON.stringify({ came, visit: s.visit?.kind, seen: s.visitorsSeen }));
    await t.shot("night-octopus");

    await page.evaluate(() => window.__jt.setNight(false));
    let left = false;
    for (let i = 0; i < 40 && !left; i++) {
      await t.advance(1000);
      left = (await t.st()).visit === null;
    }
    t.check("night visitors: the light coming on sends the octopus away", left);

    await page.evaluate(() => window.__jt.setSeason(null));
    await t.advance(100);
    t.check("seasons: no season when none is wanted", (await t.st()).event === null);
    t.noErrors();
  },
};

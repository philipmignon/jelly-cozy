/**
 * v15: time in a hidden tab counts like time away. The tab is hidden (another tab brought to the front), the
 * page's clock jumps an hour (__jt.passTime), the tab comes back: the jelly is hungrier and the "while you were
 * away" note shows. Real clock: hidden tabs and frames are what's under test.
 */
import { sleep } from "../lib.mjs";

export const flow = {
  name: "hidden",
  async run(t) {
    await t.open({ virtual: false, query: { season: "none" } });
    const { page } = t;
    const before = await page.evaluate(() => ({ full: window.__tank.slots.find(Boolean).fullness, note: !document.querySelector(".jt-away")?.hidden }));

    const other = await t.ctx.newPage();
    await other.bringToFront();
    const hidden = await t.until(() => document.hidden, null, { timeout: 5000 });
    t.check("hidden tab: the page is hidden behind another tab", hidden);
    const drawn0 = await page.evaluate(() => window.__pace.drawn);
    await sleep(500); // real time passing with nothing drawn is the behaviour under test
    const drawn1 = await page.evaluate(() => window.__pace.drawn);
    t.check("hidden tab: no frames drawn while hidden", drawn1 === drawn0, `${drawn0} -> ${drawn1}`);
    await page.evaluate(() => window.__jt.passTime(3_600_000)); // an hour passes
    await page.bringToFront();
    await other.close();
    await t.until(() => !document.hidden, null, { timeout: 5000 });
    const noted = await t.until(() => !document.querySelector(".jt-away").hidden && document.querySelectorAll(".jt-away li").length > 0, null, { timeout: 8000 });
    const after = await page.evaluate(() => ({ full: window.__tank.slots.find(Boolean).fullness, lines: [...document.querySelectorAll(".jt-away li")].map((l) => l.textContent) }));
    await t.shot("hidden-away");
    t.check("hidden tab: an hour hidden leaves the jelly hungrier", after.full < before.full - 0.05, `${before.full.toFixed(3)} -> ${after.full.toFixed(3)}`);
    t.check("hidden tab: the away note shows, as after a reload", !before.note && noted, JSON.stringify(after.lines));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jellytank:v5")));
    t.check("hidden tab: the caught-up tank is saved", saved && Math.abs(saved.slots.find(Boolean).fullness - after.full) < 0.02, JSON.stringify(saved?.slots?.find(Boolean)?.fullness));
    await page.click("#jt-away-ok");
    const run0 = await page.evaluate(() => ({ t: window.__tank.t, drawn: window.__pace.drawn }));
    const ran = await t.until((r) => window.__tank.t > r.t + 0.3 && window.__pace.drawn >= r.drawn + 3, run0, { timeout: 8000 });
    t.check("hidden tab: the tank runs again", ran, JSON.stringify(run0));
    t.noErrors();
  },
};

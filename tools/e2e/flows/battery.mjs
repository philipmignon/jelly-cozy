/**
 * Battery (src/pace.ts): a quiet tank drops to the calm rate and any input brings the full rate back; a hidden
 * tab draws and steps nothing, and on return the clock catches up while what moves picks up where it was; the
 * "Battery saver" setting keeps the calm rate and is remembered. Real clock: frame rates are what's under test.
 */
import { VIEW, sleep } from "../lib.mjs";

export const flow = {
  name: "battery",
  async run(t) {
    await t.open({ virtual: false, query: { season: "none" } });
    const { page } = t;
    const calm = await t.until(() => window.__pace.calm, null, { timeout: 20_000 });
    const rate = await page.evaluate(() => new Promise((r) => { const d0 = window.__pace.drawn; setTimeout(() => r(window.__pace.drawn - d0), 1000); }));
    t.check("battery: a quiet tank goes calm, about 30 frames a second at most", calm && rate <= 32, `calm=${calm} drawn in 1 s=${rate}`);
    await page.mouse.move(VIEW.width / 2, VIEW.height / 3);
    t.check("battery: input brings the full rate back", !(await page.evaluate(() => window.__pace.calm)));

    // hidden: nothing drawn, nothing stepped; back: no time-away step, the clock caught up, the camera where it was
    const other = await t.ctx.newPage();
    await other.bringToFront();
    const hid = await t.until(() => document.hidden, null, { timeout: 5000 });
    const before = await page.evaluate(() => ({ drawn: window.__pace.drawn, t: window.__tank.t, cam: window.__tank.cam.x }));
    await sleep(1500); // real time passing with nothing drawn is the behaviour under test
    const during = await page.evaluate(() => ({ drawn: window.__pace.drawn, t: window.__tank.t }));
    t.check("battery: a hidden tab draws and steps nothing", hid && during.drawn === before.drawn && during.t === before.t, JSON.stringify({ hid, before, during }));
    // the sim's clock an hour behind the page's, as if it had been away an hour
    await page.evaluate(() => window.__jt.setTime(Date.now() - 3_600_000, { page: false }));
    await page.bringToFront();
    await other.close();
    await t.until((x) => window.__tank.t > x, before.t, { timeout: 5000 });
    const back = await page.evaluate(() => ({ t: window.__tank.t, cam: window.__tank.cam.x, lag: Date.now() - window.__tank.clock }));
    t.check(
      "battery: back from hidden, the first step is a frame, not the time away; the clock caught up; the camera stayed",
      back.t - before.t < 0.25 && Math.abs(back.lag) < 2000 && back.cam === before.cam,
      JSON.stringify({ step: +(back.t - before.t).toFixed(3), lag: back.lag, cam: [before.cam, back.cam] }),
    );

    // the setting: the calm rate even right after input, and remembered
    await page.click(".jt-gear");
    await page.click(".jt-menu-battery");
    const saver = await page.evaluate(() => ({
      on: window.__pace.saver,
      calm: window.__pace.calm,
      stored: localStorage.getItem("jellytank:battery"),
      checked: document.querySelector(".jt-menu-battery").getAttribute("aria-checked"),
    }));
    t.check("battery: the saver setting keeps the calm rate, even just after input", saver.on && saver.calm && saver.stored === "1" && saver.checked === "true", JSON.stringify(saver));
    await page.keyboard.press("Escape");
    await t.reload();
    t.check("battery: the saver setting survives a reload", await page.evaluate(() => window.__pace.saver && window.__pace.calm));
    t.noErrors();
  },
};

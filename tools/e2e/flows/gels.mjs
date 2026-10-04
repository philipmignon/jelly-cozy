/**
 * Lamp gels: the warm gel bought from the TANK tab goes on the lamp (the shop slides shut), the wheel by the light
 * switch and the G key step through the owned ones (announced), a reload keeps it; each gel by day, and UV with a
 * crystal and a comb jelly fluorescing (and the glow coral and the jelly lantern), then the same tank at night.
 */
import { K, jelly, save } from "../lib.mjs";

// crystal, comb, and a juvenile moon (two kinds raised: no "three kinds" keepsake note over the flow)
const SLOTS = [jelly(6, 3), jelly(3, 3), jelly(0, 2)];
const ALL = [true, true, true, true];
const owned = () => Array.from({ length: 11 }, (_, n) => n === 4 || n === 7); // the glow coral and the jelly lantern

export const flow = {
  name: "gels",
  async run(t) {
    const st = () => t.st();
    const place = () =>
      t.page.evaluate(() => {
        window.__jt.place(0, 230, 470);
        window.__jt.place(1, 470, 330);
        window.__jt.place(2, 500, 640);
      });
    const live = () => t.page.evaluate(() => document.getElementById("jt-a11y-live")?.textContent ?? "");

    await t.open({ save: save({ slots: SLOTS, dollars: 600, owned: owned() }) });
    await place();
    await t.idle();
    await t.shot("gel-clear");
    let s = await st();
    t.check("gels: a tank starts with the clear lamp and no gel wheel", s.gels.on === 0 && s.gels.owned.slice(1).every((o) => !o));

    // buy the warm gel: the TANK tab scrolls down to the gels
    await t.openShop();
    await t.showTab(3);
    await t.page.mouse.move(...t.art(360, 600));
    for (let i = 0; i < 8; i++) await t.page.mouse.wheel({ deltaY: 200 });
    await t.advance(200);
    const scroll = (await st()).shopScroll;
    t.check("gels: the TANK tab scrolls to them", scroll > 0, `scroll=${scroll}`);
    await t.shot("gel-shop");
    const card = K.shopCards[31];
    await t.click(card.x + card.w / 2, card.y + card.h / 2 - scroll);
    s = await st();
    t.check("gels: buying the warm gel puts it on the lamp", s.gels.on === 1 && s.gels.owned[1] === true && s.dollars === 600 - 60, `on=${s.gels.on} dollars=${s.dollars}`);
    t.check("gels: the shop slides shut so the light shows", !s.shop.open);
    await place();
    await t.idle();
    await t.shot("gel-warm");

    // the wheel above the light switch steps through what's owned; so does G
    await t.press("gel");
    t.check("gels: the wheel by the switch takes it off again", (await st()).gels.on === 0);
    await t.key("g");
    t.check("gels: G puts the next one on", (await st()).gels.on === 1);
    const said = await t.until(() => /gel on the lamp/i.test(document.getElementById("jt-a11y-live")?.textContent ?? ""), null, { timeout: 5000, pump: true });
    t.check("gels: the change is announced", said, await live());
    await t.reload();
    t.check("gels: a reload keeps the gel on the lamp", (await st()).gels.on === 1);

    // each gel by day (the CLI can't show the species art: this is the real look)
    await t.open({ save: save({ slots: SLOTS, gels: ALL, gel: 2, owned: owned() }) });
    await place();
    await t.idle();
    await t.shot("gel-blue");
    await t.open({ save: save({ slots: SLOTS, gels: ALL, gel: 3, owned: owned() }) });
    await place();
    await t.idle();
    s = await st();
    t.check("gels: UV is on, by day", s.gels.on === 3 && !s.nightTarget);
    await t.shot("gel-uv");
    // the lamp off at night: moonlight as ever, nothing fluoresces
    await t.page.evaluate(() => window.__jt.setNight(true));
    await t.idle();
    await t.shot("gel-uv-night");
    t.check("gels: the gel stays on the lamp through the night", (await st()).gels.on === 3);
    t.noErrors();
  },
};

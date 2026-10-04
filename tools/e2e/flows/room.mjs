/**
 * v15 the room: on a 1440x900 screen the tank stands in a room (Halloween dusk forced, so the pumpkin and the moon
 * are in); its lamp follows the tank's light switch both ways (the switch on the cabinet, and a click on the lamp);
 * narrowing the window to a phone's hides it, widening brings it back.
 */
import { K } from "../lib.mjs";

const WIDE = { width: 1440, height: 900 };

export const flow = {
  name: "room",
  async run(t) {
    await t.open({ view: WIDE, query: { sky: "dusk", season: "halloween" } });
    const { page } = t;
    const shown = await t.until(() => {
      const r = document.querySelector(".jt-room.jt-room-on");
      return !!r && r.querySelectorAll(".jt-room-scene canvas").length === 3;
    }, null, { timeout: 15_000, pump: true });
    const room = () =>
      page.evaluate(() => {
        const r = document.querySelector(".jt-room");
        const art = r?.querySelector(".jt-room-art")?.getBoundingClientRect();
        return { ...(r ? { ...r.dataset } : {}), on: !!r?.classList.contains("jt-room-on"), night: window.__tank.nightTarget, art: art && [Math.round(art.left), Math.round(art.right)], vw: innerWidth };
      });
    let r = await room();
    t.check("room: a wide screen shows the room around the tank", shown && r.art[0] <= 0 && r.art[1] >= r.vw, JSON.stringify(r));
    t.check("room: the window shows the forced time of day and the season's things", r.sky === "dusk" && r.season === "halloween", JSON.stringify(r));
    t.check("room: its lamp matches the tank's light", r.lamp === (r.night ? "off" : "on"), JSON.stringify(r));
    await t.idle();
    await t.shot("room-dusk");

    // the switch on the cabinet flips the tank's light, and the room's lamp with it
    const night0 = r.night;
    const lamp = K.buttons.find((b) => b.name === "lamp");
    await t.click(lamp.x + lamp.w / 2, lamp.y + lamp.h / 2);
    const flipped = await t.until((n) => window.__tank.nightTarget === !n && document.querySelector(".jt-room").dataset.lamp === (n ? "on" : "off"), night0, { pump: true });
    t.check("room: the tank's light switch turns the room's lamp", flipped, JSON.stringify(await room()));
    await t.idle(); // the fade
    await t.shot("room-switched");
    // and the room's lamp is a light switch too
    await page.click(".jt-room-lamp");
    const back = await t.until((n) => window.__tank.nightTarget === n && document.querySelector(".jt-room").dataset.lamp === (n ? "off" : "on"), night0, { pump: true });
    t.check("room: clicking the room's lamp flips the tank's light back", back, JSON.stringify(await room()));
    t.check("room: it is decoration: the pointer goes through to the tank", await page.evaluate(() => getComputedStyle(document.querySelector(".jt-room")).pointerEvents === "none"));

    // narrowed to a phone's width: the room goes; widened again, it's back
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    t.view = { width: 390, height: 844 };
    t.check("room: a phone-sized window hides it", await t.until(() => !document.querySelector(".jt-room").classList.contains("jt-room-shown") && document.querySelector(".jt-room-lamp").offsetParent === null, null, { timeout: 5000, pump: true }));
    await page.setViewport({ ...WIDE, deviceScaleFactor: 1 });
    t.view = WIDE;
    t.check("room: widening again brings it back", await t.until(() => document.querySelector(".jt-room").classList.contains("jt-room-on"), null, { timeout: 5000, pump: true }));
    t.noErrors();
  },
};

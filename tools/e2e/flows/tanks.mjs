/**
 * The TANK tab: Large needs Medium first; buying Medium closes the shop and slides the wall out; a theme (Kelp
 * Forest) applies when bought; a swipe pans the wider tank.
 */
import { jelly, save } from "../lib.mjs";

export const flow = {
  name: "tanks",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3), jelly(1, 2)], dollars: 1200 }) });
    const { page } = t;
    const st = () => t.st();

    await t.openShop();
    await t.showTab(3);
    await t.click(...t.card(12));
    t.check("large needs medium first", (await st()).tier === 0);
    await t.click(...t.card(11));
    await t.advance(3200);
    let s = await st();
    t.check("buy medium tank", s.tier === 1 && !s.shop.open, JSON.stringify({ tier: s.tier, shop: s.shop.open }));
    await t.idle();
    await t.shot("7-medium");

    // a theme: bought on the TANK tab, applied at once
    await t.openShop();
    await t.showTab(3);
    await t.click(...t.card(21));
    s = await st();
    t.check("buying Kelp Forest applies it", s.theme === 1, String(s.theme));
    await t.advance(1200);
    await t.shot("7b-kelp-theme");
    if ((await st()).shop.open) await t.closeShop();
    await t.idle();

    // swipe to pan the medium tank
    const cam0 = (await st()).cam.x;
    await page.mouse.move(...t.art(120, 500));
    await page.mouse.down();
    for (let k = 1; k <= 12; k++) await page.mouse.move(...t.art(120 + k * 40, 500));
    await page.mouse.up();
    await t.advance(1200);
    const cam1 = (await st()).cam.x;
    t.check("swipe pans the camera", cam1 !== cam0, `${cam0} -> ${cam1}`);
    await t.idle();
    await t.shot("8-panned");
    t.noErrors();
  },
};

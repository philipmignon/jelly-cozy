/**
 * The shop with real presses on the .riv's cards: the JELLIES list scrolls (a scroll-drag buys nothing, nor do
 * tab taps while scrolled), buying a jelly, decorations (an owned one's card puts it away and places it again,
 * never charged twice), the bubbler, the helpers; a hidden tab's cards can't be pressed; the X closes it.
 */
import { K, jelly, save } from "../lib.mjs";

export const flow = {
  name: "shop",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3)], dollars: 1000 }) });
    const { page } = t;
    const st = () => t.st();

    await t.openShop();
    t.check("shop opens", (await st()).shop.open === true);
    await t.shot("4-shop");

    // the JELLIES list scrolls: drag it up, check nothing was bought, then tap a tab while scrolled
    const d0 = (await st()).dollars;
    const [cx, cy] = t.card(16);
    await page.mouse.move(...t.art(cx, cy));
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(...t.art(cx, cy - k * 20));
    await page.mouse.up();
    await t.advance(300);
    const sc = (await st()).shopScroll;
    t.check("dragging the jellies list scrolls it", sc > 0, `scroll=${sc}`);
    await t.shot("4b-scrolled");
    t.check("a scroll-drag buys nothing", (await st()).dollars === d0);
    await t.showTab(1);
    await t.showTab(0);
    let s = await st();
    t.check("tapping tabs while scrolled buys nothing", s.dollars === d0 && s.slots.filter(Boolean).length === 1);

    await t.click(...t.card(0));
    s = await st();
    t.check("buy blue blubber polyp", s.slots.filter(Boolean).length === 2 && s.slots.some((j) => j && j.k === 1), JSON.stringify(s.slots.map((j) => j && j.k)));
    t.check("decor tab", (await t.showTab(1)) && (await st()).tab === 1);
    await t.click(...t.card(4));
    s = await st();
    t.check("buy anchor", s.owned[1] === true, JSON.stringify(s.owned));
    await t.click(...t.card(6));
    s = await st();
    t.check("buy giant clam", s.owned[3] === true);
    const before = s.dollars;
    // v15: an owned decoration's card puts it away (no refund), and a second tap places it again (no charge)
    await t.click(...t.card(4));
    s = await st();
    t.check("tapping an owned decoration's card puts it away", s.stored[1] === true && s.owned[1] === true && s.dollars === before);
    await t.click(...t.card(4));
    s = await st();
    t.check("tapping it again places it, never charged twice", s.stored[1] === false && s.dollars === before && s.shop.open === true);
    // v13: the bubbler (item 24, decoration 10) follows the sold decorations on the DECOR tab
    await t.click(...t.card(24));
    s = await st();
    t.check("buy the bubbler (decoration 10)", s.owned[10] === true, JSON.stringify(s.owned));
    await t.idle();
    await t.shot("5-bought");

    await t.showTab(2);
    for (const i of [8, 9, 10]) await t.click(...t.card(i));
    s = await st();
    t.check("buy snail, shrimp, crab", s.helpers.every(Boolean), JSON.stringify(s.helpers));
    await t.idle();
    await t.shot("5a-helpers");
    const blubbers = async () => (await st()).slots.filter((j) => j && j.k === 1).length;
    const b0 = await blubbers();
    await t.click(...t.card(0));
    t.check("tab 0 cards can't be clicked from tab 2", (await blubbers()) === b0); // (babies may be born meanwhile: count blubbers, not jellies)

    await t.click(K.shopClose.x + K.shopClose.w / 2, K.shopClose.y + K.shopClose.h / 2);
    t.check("the X closes the shop", (await st()).shop.open === false);
    await t.idle();
    t.noErrors();
  },
};

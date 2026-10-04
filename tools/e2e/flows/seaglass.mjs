/**
 * v16 sea glass and shells: a tank one colour short of the sea glass rainbow scrubs a dirty spot (seeded so the
 * scrub turns up the red piece); the find rises from the spot and flies to the jar in the hood, the wind chime
 * appears, a "Set complete!" note opens the journal on the Collection page (keyboard: the arrows move between the
 * drawer's slots); the jar opens the Collection too; a save with both sets has the chime and the grotto in the
 * tank, and a reload awards nothing twice; the demo has no jar and finds nothing.
 */
import { K, NOW, dayKey, jelly, save } from "../lib.mjs";

/** __jt.seed(n): the first scrub of a spot is a find, and with four colours found and a dry spell it's the red (sgsim) */
const RED_SEED = 406;
const noRequests = { day: dayKey(NOW), items: [] }; // no sea-glass request today: it would tip the pick
const glass4 = { n: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0], sets: 0, day: "", today: 0, dry: 9 };

export const flow = {
  name: "seaglass",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3)], dollars: 10, finds: glass4, requests: noRequests }) });
    const { page } = t;
    const noteOpen = () => page.evaluate(() => { const n = document.querySelector(".jt-keep-note"); return n && !n.hidden ? n.textContent : ""; });
    let s = await t.st();
    t.check("seaglass: the jar is in the hood of your own tank", s.findsOn === true);

    // a dirty spot mid-view, scrubbed off with the sponge
    const wx = 360 - s.cam.x;
    const spot = await t.eval((x) => window.__jt.addSpot(x, 560, 1), wx);
    await t.eval((n) => window.__jt.seed(n), RED_SEED);
    await t.press("clean");
    const [sx, sy] = await t.world(wx, 560);
    const { s: k } = t.fit;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let n = 0; n < 440; n++) {
      await page.mouse.move(sx + Math.sin(n * 0.9) * 40 * k, sy + Math.cos(n * 0.7) * 16 * k);
      if (n % 20 === 19 && (await t.eval((j) => window.__jt.spotDirt(j), spot)) < 0.05) break;
    }
    await page.mouse.up();
    await t.press("clean"); // put the sponge down so the shots show the find, not the cursor
    s = await t.st();
    t.check("seaglass: scrubbing the spot off turned up the red sea glass", s.find?.item === 4 && s.finds?.n[4] === 1, JSON.stringify({ find: s.find, n: s.finds?.n }));
    await t.advance(500);
    await t.shot("sg-find-rising");
    s = await t.st();
    t.check("seaglass: the last colour completes the rainbow: the wind chime hangs in the tank", s.owned[11] === true && s.finds.sets === 1);
    await t.advance(2000);
    t.check("seaglass: the find has landed in the jar", (await t.st()).find === null);
    const noted = await t.until(() => !document.querySelector(".jt-keep-note")?.hidden, null, { timeout: 8000, pump: true });
    const text = await noteOpen();
    t.check("seaglass: a note says the set is complete", noted && /set complete/i.test(text) && /wind chime/i.test(text), text);
    t.check("seaglass: the find and the set are saved", await t.until(() => (JSON.parse(localStorage.getItem("jellytank:v5") || "{}").finds?.sets ?? 0) === 1, null, { timeout: 3000 }));

    // "See journal" opens the Collection: five sea glass found, the set done; the arrows move between the slots
    if (noted) await page.click(".jt-keep-note button:not(.ok)");
    const opened = await t.until(() => !document.querySelector(".jt-book").hidden && !document.querySelector(".jt-col-page").hidden, null, { timeout: 5000 });
    const col = await page.evaluate(() => ({
      found: document.querySelectorAll(".jt-col-slot.found").length,
      slots: document.querySelectorAll(".jt-col-slot").length,
      done: document.querySelectorAll(".jt-col-sets .jt-keep-row.done").length,
      count: document.querySelector(".jt-book-count").textContent,
    }));
    t.check("seaglass: the Collection page shows the drawer and the sets", opened && col.found === 5 && col.slots === 10 && col.done === 1 && /5 of 10 kinds/.test(col.count), JSON.stringify(col));
    await t.idle();
    await t.shot("sg-collection");
    await page.focus(".jt-col-slot[tabindex='0']");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const kb = await page.evaluate(() => ({
      focused: document.activeElement?.getAttribute("aria-label"),
      said: document.querySelector(".jt-col-said").textContent,
      still: !document.querySelector(".jt-col-page").hidden,
    }));
    t.check("seaglass: the arrow keys move between the slots without turning the page", kb.still && kb.focused === "Unknown find" && /not found yet/i.test(kb.said), JSON.stringify(kb));
    await page.keyboard.press("Escape");
    t.check("seaglass: Escape closes the journal", await t.until(() => document.querySelector(".jt-book").hidden, null, { timeout: 3000 }));

    // the jar in the hood opens the Collection
    const jar = K.seaGlass.jar;
    await t.click(jar.x, jar.y);
    t.check("seaglass: tapping the jar opens the Collection", await t.until(() => !document.querySelector(".jt-book").hidden && !document.querySelector(".jt-col-page").hidden, null, { timeout: 5000, pump: true }));
    await page.keyboard.press("Escape");

    // a reload awards nothing twice
    await t.reload();
    await t.advance(1500);
    s = await t.st();
    t.check("seaglass: after a reload, no second award", s.owned[11] && s.finds.sets === 1 && (await noteOpen()) === "");

    // the shop's DECOR tab, scrolled to the end: the chime's card is IN TANK, the grotto's locked and says how it's earned
    await t.openShop();
    await t.showTab(1);
    await page.mouse.move(...t.art(360, 600));
    for (let i = 0; i < 10; i++) await page.mouse.wheel({ deltaY: 200 });
    await t.advance(300);
    const scroll = (await t.st()).shopScroll;
    const d0 = (await t.st()).dollars;
    const card = K.shopCards[37];
    await t.click(card.x + card.w / 2, card.y + card.h / 2 - scroll);
    await t.until(() => /collection:/i.test([...document.querySelectorAll(".jt-tag")].map((e) => e.textContent).join(" ")), null, { timeout: 5000, pump: true });
    const tag = await page.evaluate(() => [...document.querySelectorAll(".jt-tag")].map((e) => e.textContent).join(" "));
    s = await t.st();
    t.check("seaglass: the grotto's card is locked and names its set; nothing is sold", /collection: shell shelf/i.test(tag) && !s.owned[12] && s.dollars === d0, `${tag} ${s.dollars}`);
    await t.idle();
    await t.shot("sg-shop");
    await t.closeShop();

    // both sets done: the chime and the grotto, both in the tank
    const all = { n: [2, 1, 3, 1, 1, 2, 1, 1, 1, 1], sets: 3, day: "", today: 0, dry: 0 };
    await t.loadSave(save({ slots: [jelly(0, 3)], finds: all, requests: noRequests }));
    await t.idle();
    s = await t.st();
    t.check("seaglass: both set rewards are in the tank", s.owned[11] && s.owned[12] && !s.stored?.[11] && !s.stored?.[12]);
    await t.advance(300);
    await t.shot("sg-rewards");

    // the demo (read-only): no jar, nothing found
    await t.open({ query: { demo: 1 } });
    s = await t.st();
    const v = await t.eval(() => window.__tank.findsOn);
    t.check("seaglass: the demo has no jar and finds nothing", v === false && !s.finds);
    t.noErrors();
  },
};

/**
 * Keyboard only: Tab onto the tank and its jelly (ringed, described with its personality), Enter pets, F feeds and
 * Escape puts the can down, J opens the journal and Escape brings focus back, B opens the shop on its first card,
 * arrows walk the cards, Enter buys, Escape closes it; the live region says the pearl is ready; reduce motion from
 * the settings menu is one flag in the sim and one on the page, and it's remembered.
 */
import { DAY, NOW, dayKey, jelly, save } from "../lib.mjs";

export const flow = {
  name: "keyboard",
  async run(t) {
    // a moon polyp, 300 dollars, the giant clam with today's pearl already taken (tomorrow's comes mid-flow)
    const owned = Array.from({ length: 11 }, (_, n) => n === 3);
    await t.open({ save: save({ slots: [jelly(0, 0, { name: "Mochi" })], dollars: 300, owned, pearlDay: dayKey(NOW) }) });
    const { page } = t;
    const live = (id) => page.evaluate((i) => document.getElementById(i)?.textContent ?? "", id);
    const hears = (id, re) => t.until(([i, src]) => new RegExp(src).test(document.getElementById(i)?.textContent ?? ""), [id, re.source], { timeout: 5000, pump: true });

    const label = await page.evaluate(() => ({ role: document.getElementById("tank").getAttribute("role"), label: document.getElementById("tank").getAttribute("aria-label") ?? "" }));
    t.check("kb: the tank canvas is labelled for screen readers", label.role === "application" && /1 jelly/.test(label.label), JSON.stringify(label));
    await t.key("Tab");
    t.check("kb: Tab reaches the tank", await page.evaluate(() => document.activeElement?.id === "tank"));
    await t.key("Tab");
    await t.until(() => !document.querySelector(".jt-a11y-ring:not(.jt-nur-ring)").hidden && document.querySelector(".jt-a11y-ring:not(.jt-nur-ring) .jt-a11y-ring-label").textContent !== "", null, { timeout: 5000, pump: true });
    const ring = await page.evaluate(() => ({ shown: !document.querySelector(".jt-a11y-ring:not(.jt-nur-ring)").hidden, label: document.querySelector(".jt-a11y-ring:not(.jt-nur-ring) .jt-a11y-ring-label").textContent, name: window.__tank.slots[0].name }));
    const said = await live("jt-a11y-focus");
    t.check("kb: Tab lands on the jelly, ringed and described", ring.shown && ring.label === ring.name && said.startsWith(`${ring.name}, moon jelly polyp`), `${JSON.stringify(ring)} "${said}"`);
    // v13: the description ends with its personality, as the card words it
    t.check("kb: the jelly's description includes its personality", /, (shy|curious|sleepy|social) — /.test(said), said);
    await t.idle();
    await t.shot("13-kb-focus");

    const aff0 = (await t.st()).slots[0].affection;
    await t.key("Enter");
    await t.until((a) => window.__tank.slots[0].affection > a && document.querySelectorAll(".jt-tag").length > 0, aff0, { timeout: 5000, pump: true });
    const pet = await page.evaluate(() => ({ aff: window.__tank.slots[0].affection, tags: document.querySelectorAll(".jt-tag").length }));
    t.check("kb: Enter pets it", pet.aff > aff0 && pet.tags === 1, `${aff0} -> ${JSON.stringify(pet)}`);

    await t.key("f");
    await t.until(() => window.__tank.tool === "food" && window.__tank.food.some((f) => f.state !== "off"), null, { timeout: 5000, pump: true });
    const fed = await page.evaluate(() => ({ tool: window.__tank.tool, food: window.__tank.food.filter((f) => f.state !== "off").length }));
    t.check("kb: F picks up the can and sprinkles", fed.tool === "food" && fed.food > 0, JSON.stringify(fed));
    await t.key("Escape");
    t.check("kb: Escape puts the can down", await t.until(() => window.__tank.tool === "none", null, { timeout: 5000, pump: true }));
    // the flakes eaten or gone, so the dollars hold still until the purchase below (meals pay)
    for (let i = 0; i < 90 && (await t.st()).food.some((f) => f.state !== "off"); i++) await t.advance(1000);

    await t.key("j");
    await t.until(() => !document.querySelector(".jt-book").hidden, null, { timeout: 5000 });
    const book = await page.evaluate(() => ({ open: !document.querySelector(".jt-book").hidden, inside: document.querySelector(".jt-book").contains(document.activeElement) }));
    t.check("kb: J opens the journal with focus inside it", book.open && book.inside, JSON.stringify(book));
    await t.key("Escape");
    await t.until(() => document.querySelector(".jt-book").hidden && document.activeElement?.id === "tank", null, { timeout: 5000 });
    const back = await page.evaluate(() => ({ open: !document.querySelector(".jt-book").hidden, focus: document.activeElement?.id }));
    t.check("kb: Escape closes it and focus returns to the tank", !back.open && back.focus === "tank", JSON.stringify(back));

    await t.key("b");
    await t.idle();
    await hears("jt-a11y-focus", /Blue blubber/);
    const shop = await page.evaluate(() => ({ open: window.__tank.shop.open, ring: !document.querySelector(".jt-a11y-ring:not(.jt-nur-ring)").hidden }));
    const card = await live("jt-a11y-focus");
    t.check("kb: B opens the shop on its first card", shop.open && shop.ring && /Blue blubber, 40 sand dollars/.test(card), `${JSON.stringify(shop)} "${card}"`);
    await t.key("ArrowRight");
    await hears("jt-a11y-focus", /Fried egg/);
    const right = await live("jt-a11y-focus");
    await t.key("ArrowLeft");
    await hears("jt-a11y-focus", /Blue blubber/);
    t.check("kb: arrows walk the cards", /Fried egg/.test(right) && /Blue blubber/.test(await live("jt-a11y-focus")), right);
    await t.idle();
    await t.shot("14-kb-shop");
    // the jelly bought here must come plain: a rare colour earns the "Spot a rare colour" keepsake, whose note takes
    // focus, and the Escape below would (rightly) close the note rather than the shop. Its morph rolls see 0.5.
    await page.evaluate(() => {
      const s = window.__tank;
      const r = s.rand;
      s.rand = () => 0.5;
      window.__restoreRand = () => (s.rand = r);
    });
    const dollars0 = (await t.st()).dollars;
    await t.key("Enter");
    await t.until(() => window.__tank.slots.filter(Boolean).length === 2, null, { timeout: 5000, pump: true });
    await page.evaluate(() => window.__restoreRand());
    t.check("kb: the bought jelly came plain (no keepsake note over the shop)", await page.evaluate(() => window.__tank.slots.filter(Boolean).every((j) => j.morph === 0) && !!document.querySelector(".jt-keep-note")?.hidden));
    await hears("jt-a11y-focus", /Bought Blue blubber/);
    const bought = await page.evaluate(() => ({ n: window.__tank.slots.filter(Boolean).length, dollars: window.__tank.dollars }));
    t.check("kb: Enter buys it", bought.n === 2 && bought.dollars === dollars0 - 40 && /Bought Blue blubber/.test(await live("jt-a11y-focus")), JSON.stringify({ ...bought, dollars0 }));
    await t.key("Escape");
    await t.idle();
    const shut = await page.evaluate(() => !window.__tank.shop.open);
    t.check("kb: Escape closes the shop", shut);

    // the moments region: tomorrow's pearl showing up is announced
    await page.evaluate((ms) => window.__jt.setTime(ms), NOW + DAY);
    const heard = await t.until(() => /The pearl is ready/.test(document.getElementById("jt-a11y-live")?.textContent ?? ""), null, { timeout: 6000, pump: true });
    const region = await page.evaluate(() => { const r = document.getElementById("jt-a11y-live"); return { live: r?.getAttribute("aria-live"), text: r?.textContent }; });
    t.check("kb: the live region says the pearl is ready", heard && region.live === "polite", JSON.stringify(region));

    // reduce motion, from the settings menu: one flag in the sim, one on the page, kept
    t.check("reduce motion is off when the OS doesn't ask for it", !(await page.evaluate(() => window.__tank.reducedMotion)));
    await page.click(".jt-gear");
    await page.click(".jt-menu-motion");
    const rm = await page.evaluate(() => ({
      sim: window.__tank.reducedMotion,
      root: document.documentElement.hasAttribute("data-jt-reduce-motion"),
      stored: localStorage.getItem("jellytank:reduceMotion"),
      checked: document.querySelector(".jt-menu-motion").getAttribute("aria-checked"),
    }));
    t.check("the reduce motion toggle sets the flag and remembers it", rm.sim && rm.root && rm.stored === "1" && rm.checked === "true", JSON.stringify(rm));
    await t.key("Escape");
    await t.reload();
    t.check("reduce motion survives a reload", await page.evaluate(() => window.__tank.reducedMotion));
    t.noErrors();
  },
};

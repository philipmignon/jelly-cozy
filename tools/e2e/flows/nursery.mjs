/**
 * ---- nursery ---- The nursery bowl: bought on the TANK tab, it hangs from the hood; a baby born into a full tank goes
 * there; tapped, the bowl zooms open with its strip of little ones; food sprinkled in it is eaten; a long-press opens
 * a little one's card (Move to tank waits for room); one grown enough waits "ready" while the tank is full and moves
 * in by itself once there's room. Keyboard: U opens it, Tab walks its little ones, Escape closes it and focus comes
 * back. A save keeps it; a phone shows the open bowl with its strip.
 */
import { createRequire } from "node:module";
import { K, jelly, save } from "../lib.mjs";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const N = K.nursery;
const NO_DECOR = Array.from({ length: 11 }, () => false);

export const flow = {
  name: "nursery",
  async run(t) {
    // a full small tank (3 of 3): a happy adult moon about to have a baby, a juvenile blubber, a fried-egg polyp
    const full = save({
      slots: [
        jelly(0, 3, { name: "Mochi", fullness: 0.95, affection: 0.95, content: 597 }),
        jelly(1, 2, { name: "Tofu" }),
        jelly(4, 0, { name: "Pip", anchor: 0 }),
      ],
      dollars: 400,
      owned: NO_DECOR,
    });
    await t.open({ save: full });
    const { page } = t;
    const st = () => t.st();
    const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden; }, sel);

    // buy it: TANK tab, the NURSERY card
    t.check("nursery: not there before it's bought", (await st()).nursery === null);
    await t.openShop();
    await t.showTab(3);
    await t.click(...t.card(N.item));
    let s = await st();
    t.check("nursery: bought on the TANK tab", s.nursery !== null && s.dollars === 400 - 120, JSON.stringify({ n: !!s.nursery, d: s.dollars }));
    await t.closeShop();

    // a baby born while the tank is full goes to the nursery
    await t.advance(4000);
    s = await st();
    const kids = s.nursery?.slots.filter(Boolean) ?? [];
    t.check("nursery: a baby born into a full tank goes to the nursery", kids.length === 1 && kids[0].g === 0 && kids[0].k === 0 && s.slots.filter(Boolean).length === 3,
      JSON.stringify({ kids: kids.map((j) => [j.k, j.g]), tank: s.slots.filter(Boolean).length }));
    await t.idle();
    await t.shot("nursery-1-closed");

    // tap the hanging bowl: it zooms open, its strip lists the little one
    const icon = [N.icon.x + N.icon.w / 2, N.icon.y + N.icon.h / 2];
    await t.click(...icon);
    await t.idle();
    s = await st();
    const strip = await page.evaluate(() => [...document.querySelectorAll(".jt-nur-jelly")].map((b) => b.getAttribute("aria-label")));
    t.check("nursery: a tap on the bowl opens it, with its strip", s.nursery.open && s.nursery.e === 1 && (await visible("#jt-nursery")) && strip.length === 1, JSON.stringify({ open: s.nursery.open, e: s.nursery.e, strip }));
    await t.shot("nursery-2-open");
    // its strip passes axe-core (serious and critical findings fail, as in the a11y flow)
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
    const bad = await page.evaluate(async () => {
      const r = await window.axe.run({ include: [["#jt-nursery"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] });
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    });
    t.check("nursery: its strip has no serious or critical axe findings", bad.length === 0, bad.join(" | "));

    // the food can works in the bowl: sprinkle over the polyp, it eats
    const baby = s.nursery.slots.findIndex(Boolean);
    const a = N.anchors[s.nursery.slots[baby].anchor];
    const full0 = s.nursery.slots[baby].fullness;
    await t.press("feed");
    for (let k = 0; k < 3; k++) {
      const [x, y] = t.art(N.cx + a.x, N.cy + a.y - 90);
      await page.mouse.click(x, y);
      await t.advance(150);
    }
    await t.advance(6000);
    s = await st();
    t.check("nursery: food sprinkled in the bowl is eaten there", s.nursery.slots[baby].fullness > full0, `${full0} -> ${s.nursery.slots[baby].fullness}`);
    await t.key("Escape"); // the can goes down; the bowl stays open
    t.check("nursery: Escape puts the can down first", (await st()).tool === "none" && (await st()).nursery.open);

    // a long-press on the little one (a polyp still, or budded and swimming): its card, Move to tank waiting for room
    const j = (await st()).nursery.slots[baby];
    const [px, py] = t.art(N.cx + j.x, N.cy + j.y - (j.g === 0 ? 27 : 0));
    await page.mouse.move(px, py);
    await page.mouse.down();
    await t.until(() => !document.querySelector(".jt-card").hidden, null, { timeout: 8000 });
    await page.mouse.up();
    const card = await page.evaluate(() => ({ open: !document.querySelector(".jt-card").hidden, move: document.querySelector("#jt-move").textContent, off: document.querySelector("#jt-move").disabled, why: document.querySelector(".jt-move-why").textContent, rehome: !document.querySelector(".jt-rehome-wrap").hidden }));
    t.check("nursery: its card offers Move to tank, waiting while the tank is full", card.open && card.move === "Move to tank" && card.off && /full/i.test(card.why) && !card.rehome, JSON.stringify(card));
    await page.click(".jt-card .jt-close");
    await t.advance(100);

    // grown enough for the tank while it's full: it waits, "ready"
    await t.eval((n) => { const j = window.__tank.nursery.slots[n]; j.gp = 11.5; j.care = 59.9; }, baby);
    await t.advance(3000);
    s = await st();
    t.check("nursery: an ephyra grown enough waits, ready, while the tank is full", s.nursery.slots[baby]?.g === 1 && s.nursery.ready[baby] === true, JSON.stringify({ g: s.nursery.slots[baby]?.g, gp: s.nursery.slots[baby]?.gp, ready: s.nursery.ready }));
    await t.idle();
    await t.shot("nursery-3-ready");

    // keyboard: Escape closes it (focus comes back), U opens it again with focus on the little one
    await t.key("Escape");
    await t.idle();
    s = await st();
    t.check("nursery: Escape closes the bowl and its strip", !s.nursery.open && !(await visible("#jt-nursery")));
    await page.focus("#tank");
    await t.key("u");
    await t.idle();
    const kb = await page.evaluate(() => ({ open: window.__tank.nursery.open, focus: document.activeElement?.className ?? "", label: document.activeElement?.getAttribute("aria-label") ?? "" }));
    t.check("nursery: U opens it, focus on its little one", kb.open && /jt-nur-jelly/.test(kb.focus) && /ready to move/.test(kb.label), JSON.stringify(kb));
    await t.key("Escape");
    await t.idle();
    t.check("nursery: and focus returns to the tank", await page.evaluate(() => document.activeElement?.id === "tank"));

    // room in the tank (Tofu is rehomed from its card): the waiting one moves in by itself and grows up there
    await t.eval(() => window.__jt.place(1, 400, 600));
    const [tx, ty] = await t.world(400, 600 - 30);
    await page.mouse.move(tx, ty);
    await page.mouse.down();
    await t.until(() => !document.querySelector(".jt-card").hidden, null, { timeout: 8000 });
    await page.mouse.up();
    await page.click("#jt-rehome");
    await page.click("#jt-rehome");
    await t.advance(2000);
    s = await st();
    const moved = s.slots.filter(Boolean).map((j) => [j.name, j.g]);
    t.check("nursery: with room, the waiting one moves to the tank and grows into a juvenile", s.nursery.slots.every((j) => !j) && s.slots.filter(Boolean).length === 3 && moved.some(([, g]) => g === 2),
      JSON.stringify({ moved, nursery: s.nursery.slots.map((j) => j && j.name) }));

    // the save keeps the bowl
    await t.loadSave({ ...full, nursery: { slots: [jelly(1, 0, { name: "Kiki", anchor: 1 }), null, jelly(0, 1, { name: "Nemo" }), null] }, slots: full.slots });
    s = await st();
    t.check("nursery: a saved nursery loads with its little ones", s.nursery !== null && s.nursery.slots.filter(Boolean).map((j) => j.name).join() === "Kiki,Nemo");
    // the tank's polyp (Pip) moves in from its card
    const pa = K.polypAnchors[0];
    const [ppx, ppy] = await t.world(pa.x, pa.y - 27);
    await t.page.mouse.move(ppx, ppy);
    await t.page.mouse.down();
    await t.until(() => !document.querySelector(".jt-card").hidden, null, { timeout: 8000 });
    await t.page.mouse.up();
    const mv = await t.page.evaluate(() => ({ text: document.querySelector("#jt-move").textContent, off: document.querySelector("#jt-move").disabled }));
    if (!mv.off) await t.page.click("#jt-move");
    await t.advance(200);
    s = await st();
    t.check("nursery: a tank polyp's card moves it into the nursery", mv.text === "Move to nursery" && s.nursery.slots.some((j) => j?.name === "Pip") && !s.slots.some((j) => j?.name === "Pip"), JSON.stringify(mv));
    t.noErrors();

    // a phone: the open bowl and its strip fit
    await t.open({
      save: save({ ...full, nursery: { slots: [jelly(1, 0, { name: "Kiki", anchor: 1 }), jelly(4, 1, { name: "Nemo" }), jelly(0, 0, { name: "Bo", anchor: 3 }), null] } }),
      view: { width: 390, height: 844 },
    });
    await t.idle();
    await t.shot("nursery-4-phone-closed");
    await t.click(...icon);
    await t.idle();
    const fits = await t.page.evaluate(() => {
      const r = document.querySelector("#jt-nursery").getBoundingClientRect();
      return { open: !document.querySelector("#jt-nursery").hidden, left: r.left, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    t.check("nursery: on a phone the strip fits under the bowl", fits.open && fits.left >= 0 && fits.right <= fits.w && fits.bottom <= fits.h, JSON.stringify(fits));
    await t.shot("nursery-5-phone-open");
    t.noErrors();
  },
};

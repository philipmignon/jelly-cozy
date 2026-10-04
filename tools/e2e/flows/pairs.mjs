/**
 * v16 pairs and colour genetics, through the test API: the two pair-only colours (dusk 4, pearl 5) on three species
 * with their art fetched from their own groups (mo-dusk, mo-pearl), and nothing of theirs fetched for a tank without
 * one; a pair's card ("Paired with ..."), the tiny sparkle a pair shares, the note when a pair's baby is born; the
 * journal's Colours section with all four colours raised.
 */
import { NOW, blank, dayKey, entry, jelly, save } from "../lib.mjs";

const BABY_SECONDS = 600;
/** the first three milestones (first adult, three kinds, a rare colour) already earned: no keepsake note over the flow */
const keep = { earned: 0b111, days: 1, lastDay: dayKey(NOW), requests: 0 };

export const flow = {
  name: "pairs",
  async run(t) {
    // ---- a plain tank fetches neither colour's art
    await t.open({ save: save({ slots: [jelly(0, 3, { name: "Mochi" })] }) });
    let { page } = t;
    const groups0 = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /sprites\/mo-/.test(n)));
    t.check("pairs: a tank without a dusk or pearl jelly downloads neither group", groups0.length === 0, JSON.stringify(groups0));

    // ---- dusk and pearl on three species (moon, sea nettle, fried egg), side by side in the large tank
    const kinds = [0, 5, 4];
    const slots = kinds.flatMap((k, i) => [
      jelly(k, 3, { name: ["Dusky", "Ember", "Plum"][i], morph: 4 }),
      jelly(k, 3, { name: ["Pearl", "Opal", "Nacre"][i], morph: 5 }),
    ]);
    await t.open({ save: save({ slots, tier: 2, keep }) });
    page = t.page;
    const fetched = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /sprites\/mo-/.test(n)).map((n) => n.replace(/^.*sprites\//, "").replace(/\?.*$/, "")));
    t.check("pairs: a dusk and a pearl jelly bring their groups", fetched.includes("mo-dusk.json") && fetched.includes("mo-pearl.json"), JSON.stringify(fetched));
    const xs = [150, 360, 570];
    for (let i = 0; i < 3; i++) {
      await t.eval((s, x) => window.__jt.place(s, x, 400), 2 * i, xs[i]);
      await t.eval((s, x) => window.__jt.place(s, x, 720), 2 * i + 1, xs[i]);
    }
    await t.advance(200);
    await t.idle();
    const shown = await t.eval(() => window.__tank.slots.filter(Boolean).map((j) => j.morph));
    t.check("pairs: the six jellies keep their colours (4 dusk, 5 pearl)", JSON.stringify(shown) === JSON.stringify([4, 5, 4, 5, 4, 5]), JSON.stringify(shown));
    await t.shot("pairs-colours");

    // ---- a pair: its card, the sparkle it shares, and the note when its baby is born
    const pairSave = save({
      slots: [
        jelly(0, 3, { name: "Mochi", morph: 1, pair: 1, fullness: 1, affection: 1, content: BABY_SECONDS - 30 }),
        jelly(0, 3, { name: "Pip", morph: 1, pair: 0, fullness: 1, affection: 1 }),
      ],
      tier: 1,
      keep,
    });
    await t.open({ save: pairSave });
    page = t.page;
    let s = await t.st();
    t.check("pairs: a saved pair loads", s.slots[0].pair === 1 && s.slots[1].pair === 0, JSON.stringify([s.slots[0].pair, s.slots[1].pair]));
    // keep them close until the sparkle comes up (one every 11 s for a pair within reach)
    let lit = false;
    for (let i = 0; i < 70 && !lit; i++) {
      await t.eval(() => {
        window.__jt.place(0, 330, 520);
        window.__jt.place(1, 410, 530);
      });
      await t.advance(250);
      lit = (await t.st()).pairFx !== null;
    }
    await t.advance(500); // the sparkle at its brightest (the heart)
    t.check("pairs: a pair close together shares a sparkle", lit);
    await t.shot("pairs-sparkle");

    // the card: long-press Mochi
    await t.eval(() => window.__jt.place(0, 330, 520));
    const [x, y] = await t.world(330, 520 - 40);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await t.until(() => !document.querySelector(".jt-card").hidden, null, { timeout: 8000 });
    await page.mouse.up();
    const pairLine = await page.evaluate(() => { const e = document.querySelector(".jt-card .jt-pair"); return e && !e.hidden ? e.textContent : ""; });
    t.check("pairs: the card says who it's paired with", pairLine === "Paired with Pip", pairLine);
    await t.idle();
    await t.shot("pairs-card");
    await page.click(".jt-close");
    await t.idle();

    // the baby: Mochi's content time fills; the note names both parents
    let note = "";
    for (let i = 0; i < 80 && !note; i++) {
      await t.advance(500);
      note = await page.evaluate(() => [...document.querySelectorAll(".jt-note-bar span")].map((e) => e.textContent).join(" | "));
    }
    s = await t.st();
    const baby = s.slots.findIndex((j, i) => j && i > 1);
    t.check("pairs: a pair's baby is born, and a note names both parents", baby > 1 && /^Mochi and Pip had a baby( — a [a-z-]+ one)?!$/.test(note), JSON.stringify({ baby, note }));
    t.check("pairs: both parents start a new wait", s.slots[0].content < 60 && s.slots[1].content < 60, JSON.stringify([s.slots[0].content, s.slots[1].content]));

    // ---- the journal's Colours section: all four moon colours raised
    const journal = Array.from({ length: 9 }, () => blank());
    journal[0] = entry(2, { morphSeen: 1 | 2 | 8 | 16 });
    journal[5] = entry(1, { morphSeen: 1 });
    await t.open({ save: save({ slots: [jelly(0, 3)], journal, keep, visitorsSeen: { octopus: { n: 1, first: NOW } } }) });
    page = t.page;
    await page.click(".jt-gear");
    await page.click(".jt-menu-journal");
    await t.until(() => !document.querySelector(".jt-book").hidden);
    const rows = await page.evaluate(() => [...document.querySelectorAll(".jt-book-morph")].map((r) => ({ found: r.classList.contains("found"), text: r.textContent.replace(/\s+/g, " ").trim() })));
    t.check("pairs: the journal's Colours section lists rare, ghost, dusk and pearl",
      rows.length === 4 && rows.every((r) => r.found) && /dusk moon/i.test(rows[2].text) && /pearl moon/i.test(rows[3].text) && /rare × rare/.test(rows[2].text) && /rare × ghost/.test(rows[3].text),
      JSON.stringify(rows));
    const heading = await page.evaluate(() => document.querySelector(".jt-book-morphs h4")?.textContent);
    t.check("pairs: the section is called Colours", heading === "Colours", heading);
    await t.idle();
    await t.shot("pairs-journal");
    // a species with only its rare colour: the pair colours are ??? with a hint
    for (let i = 0; i < 5; i++) await page.click(".jt-book .next");
    const nettle = await page.evaluate(() => [...document.querySelectorAll(".jt-book-morph")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
    t.check("pairs: unfound colours are ??? (the pair ones say only a pair's baby has them)", /\?\?\?/.test(nettle[2]) && /only a pair/i.test(nettle[3]) && !/\?\?\?/.test(nettle[0]), JSON.stringify(nettle));
    t.noErrors();
  },
};

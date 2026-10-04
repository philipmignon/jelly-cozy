/**
 * The settings menu and the journal: it opens on the moon jelly, pages turn, the morph rows ("???" until raised; a
 * raised ghost moon shows); the menu stays open after a toggle (music); the Visitors page lists a night visitor's
 * sightings and keeps the unmet ones "???".
 */
import { NOW, blank, entry, jelly, save } from "../lib.mjs";

export const flow = {
  name: "journal",
  async run(t) {
    const journal = Array.from({ length: 9 }, () => blank());
    journal[0] = entry(1, { morphSeen: 2 }); // the moon: raised, and a ghost moon seen (the old flow set this bit mid-run)
    journal[1] = entry(0); // the blubber: seen, not raised
    await t.open({
      save: save({ slots: [jelly(0, 3), jelly(1, 1)], journal, visitorsSeen: { octopus: { n: 2, first: NOW } }, dollars: 30 }),
    });
    const { page } = t;

    await page.click(".jt-gear");
    t.check("settings opens its menu", await page.evaluate(() => !document.querySelector(".jt-menu").hidden));
    await t.idle();
    await t.shot("8b-settings");
    await page.click(".jt-menu-journal");
    await t.until(() => !document.querySelector(".jt-book").hidden);
    const first = await page.evaluate(() => ({ open: !document.querySelector(".jt-book").hidden, name: document.querySelector(".jt-book-name").textContent }));
    t.check("journal opens on the moon jelly", first.open && /moon/i.test(first.name), JSON.stringify(first));
    await page.click(".jt-book .next");
    const second = await page.evaluate(() => document.querySelector(".jt-book-name").textContent);
    t.check("journal pages turn (blubber owned)", /blubber/i.test(second), second);
    // v12: the morph rows: classic, ghost and (winter) frost, "???" until raised
    const rows = await page.evaluate(() => [...document.querySelectorAll(".jt-book-morph")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
    const seen = (await t.st()).journal[1].morphSeen;
    t.check("journal lists every morph, unknown as ???", rows.length === 3 && rows.every((r, i) => /\?\?\?/.test(r) === !(seen & (1 << i))), JSON.stringify(rows));
    await page.click(".jt-book .prev");
    const ghost = await page.evaluate(() => { const r = document.querySelector(".jt-book-morph.ghost"); return { found: r.classList.contains("found"), text: r.textContent }; });
    t.check("a raised ghost morph shows in the journal", ghost.found && /ghost moon/i.test(ghost.text), JSON.stringify(ghost));
    await page.click(".jt-book .next");
    await t.idle();
    await t.shot("9-journal");

    // v14: the visitor log: the Visitors page (just before the Album, the last page)
    await page.evaluate(() => {
      for (let i = 0; i < 30 && document.querySelector(".jt-vlog-page").hidden; i++) document.querySelector(".jt-book .prev").click();
    });
    const today = await page.evaluate(() => {
      const d = new Date(Date.now());
      return `${d.getDate()} ${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()]} ${d.getFullYear()}`;
    });
    const v = await page.evaluate(() => {
      const r = document.querySelector('.jt-vlog-row[data-kind="octopus"]');
      const unmet = document.querySelector('.jt-vlog-row[data-kind="manta"]');
      return { shown: !document.querySelector(".jt-vlog-page").hidden, met: r?.classList.contains("met"), text: r?.textContent, unmet: unmet?.textContent, rows: document.querySelectorAll(".jt-vlog-row").length };
    });
    t.check("visitor log: the octopus row shows times seen and first seen; unmet ones are ???",
      v.shown && v.met && /octopus/i.test(v.text) && /seen 2 times/i.test(v.text) && v.text.includes(today) && /\?\?\?/.test(v.unmet) && v.rows === 8, JSON.stringify({ ...v, today }));
    await t.idle();
    await t.shot("visitors");
    await page.click(".jt-book-x");

    // the menu stays open after a toggle; music turns on and off
    await page.click(".jt-gear");
    const m0 = await page.evaluate(() => document.querySelector(".jt-menu-music").getAttribute("aria-checked"));
    await page.click(".jt-menu-music");
    const m1 = await page.evaluate(() => document.querySelector(".jt-menu-music").getAttribute("aria-checked"));
    t.check("the menu stays open after a toggle", await page.evaluate(() => !document.querySelector(".jt-menu").hidden));
    t.check("music button toggles", m0 !== m1, `${m0} -> ${m1}`);
    t.noErrors();
  },
};

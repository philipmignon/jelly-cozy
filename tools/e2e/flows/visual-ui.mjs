/**
 * Reference screenshots, the panels and the room: the shop on each of its four tabs, the journal (a species page,
 * the keepsakes, the visitor log), and the room around the tank at 1440x900 by day and at Halloween dusk. Compared
 * pixel by pixel with tools/e2e/reference/<set>/<scene>.png (scenes.mjs, visual.mjs).
 */
import { NOW, blank, dayKey, entry, jelly, save } from "../lib.mjs";
import { WIDE, done, everyday, snap } from "../scenes.mjs";

const SHOP_TABS = ["jellies", "decor", "helpers", "tank"];

export const flow = {
  name: "visual-ui",
  async run(t) {
    // the shop, each tab (one page: the tabs in turn, as a player would)
    await t.open({ save: save({ slots: [jelly(0, 3), jelly(4, 3)], owned: Array.from({ length: 11 }, (_, n) => n === 1 || n === 3 || n === 5), dollars: 260 }) });
    await t.openShop();
    for (const [i, tab] of SHOP_TABS.entries()) {
      const shown = i === 0 ? (await t.st()).tab === 0 : await t.showTab(i);
      t.check(`visual: the shop shows its ${tab} tab`, shown && (await t.st()).shop.open);
      await snap(t, `shop-${tab}`);
    }
    await done(t);

    // the journal: the moon's page, the keepsakes, the visitor log
    const journal = Array.from({ length: 9 }, () => blank());
    journal[0] = entry(1, { morphSeen: 2 });
    journal[1] = entry(0);
    journal[4] = entry(1);
    // (the ghost moon seen is the "rare colour" milestone: earned, its lantern in the tank, so no note comes up)
    await t.open({
      save: everyday({
        journal,
        owned: Array.from({ length: 11 }, (_, n) => n === 3 || n === 5 || n === 7),
        keep: { earned: 0b101, days: 3, lastDay: dayKey(NOW), requests: 4 },
        visitorsSeen: { octopus: { n: 2, first: NOW }, turtle: { n: 5, first: NOW - 86_400_000 } },
      }),
    });
    const { page } = t;
    await page.click(".jt-gear");
    await page.click(".jt-menu-journal");
    await t.until(() => !document.querySelector(".jt-book").hidden);
    t.check("visual: the journal opens on the moon jelly", /moon/i.test(await page.evaluate(() => document.querySelector(".jt-book-name").textContent)));
    await snap(t, "journal-species");
    for (const [page_, scene] of [[".jt-keep-page", "journal-keepsakes"], [".jt-vlog-page", "journal-visitors"]]) {
      const found = await page.evaluate((sel) => {
        for (let i = 0; i < 30 && document.querySelector(sel).hidden; i++) document.querySelector(".jt-book .prev").click();
        return !document.querySelector(sel).hidden;
      }, page_);
      t.check(`visual: the journal turns to ${scene.replace("journal-", "its ")}`, found);
      await snap(t, scene);
    }
    await done(t);

    // the room at 1440x900: day, and Halloween dusk (the pumpkin, the moon). The room's art loads on real time:
    // wait for it without stepping the tank
    for (const [scene, query] of [["room-day", { sky: "day" }], ["room-halloween-dusk", { sky: "dusk", season: "halloween" }]]) {
      await t.open({ save: everyday(), view: WIDE, query });
      const shown = await t.until(() => {
        const r = document.querySelector(".jt-room.jt-room-on");
        return !!r && r.querySelectorAll(".jt-room-scene canvas").length === 3;
      }, null, { timeout: 15_000 });
      await t.advance(2000);
      t.check(`visual: ${scene}: the room is up`, shown);
      await snap(t, scene);
      await done(t);
    }
    t.noErrors();
  },
};

/**
 * Codes: "Share your tank" makes a code and refuses a bad one; a save backup restores the dollars spent since;
 * visiting a share code opens a read-only tank (the banner, no requests note) and the way back.
 */
import { jelly, save } from "../lib.mjs";

export const flow = {
  name: "share",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3), jelly(4, 2)], dollars: 120 }) });
    let page = t.page;

    await page.click(".jt-gear");
    await page.click(".jt-menu-share");
    await t.until(() => !document.querySelector(".jt-share").hidden && document.querySelector("#jt-my-code").value.length > 0);
    const code = await page.evaluate(() => document.querySelector("#jt-my-code").value);
    t.check("share code is made", code.length > 8 && code.length < 400, `len=${code.length}`);
    await page.type("#jt-visit-code", "not-a-tank");
    await page.click(".jt-share .go");
    const err = await page.evaluate(() => document.querySelector(".jt-share .err").textContent);
    t.check("a bad code is refused", err.length > 0, err);
    await page.click(".jt-share .x");

    // back up the save, spend some dollars (a blubber from the shop), restore the backup: the dollars come back
    await page.click(".jt-gear");
    await page.click(".jt-menu-backup");
    const saveCode = await page.evaluate(() => document.querySelector("#jt-save-code").value);
    const saved = (await t.st()).dollars;
    t.check("backup makes a save code", saveCode.startsWith("JTSAVE1."), `len=${saveCode.length}`);
    await page.click(".jt-share:not([hidden]) .x");
    await t.openShop();
    await t.click(...t.card(0));
    await t.closeShop();
    const spent = (await t.st()).dollars;
    await page.click(".jt-gear");
    await page.click(".jt-menu-restore");
    await page.evaluate((c) => { document.querySelector("#jt-save-code").value = c; }, saveCode);
    await page.click(".jt-share:not([hidden]) .act"); // the first press asks to be sure
    await t.navigating(() => page.click(".jt-share:not([hidden]) .act"));
    const restored = (await t.st()).dollars;
    t.check("restore brings the save back", spent < saved && restored >= saved, `${saved} -> spent ${spent} -> ${restored}`);

    // visit our own tank's code read-only, then come back
    page = t.page;
    await page.click(".jt-gear");
    await page.click(".jt-menu-share");
    await t.until(() => document.querySelector("#jt-my-code").value.length > 0);
    const visit = await page.evaluate(() => document.querySelector("#jt-my-code").value);
    await page.evaluate((c) => { document.querySelector("#jt-visit-code").value = c; }, visit);
    await t.navigating(() => page.click(".jt-share .go"));
    t.check("visiting shows the read-only banner", await page.evaluate(() => !!document.querySelector(".jt-visit-bar")));
    t.check("no requests note in someone else's tank", await page.evaluate(() => !document.querySelector(".jt-req-btn:not([hidden])") && window.__tank.requestsOn === false));
    await t.idle();
    await t.shot("10-visiting");
    await t.navigating(() => page.click(".jt-visit-bar .back"));
    t.check("back to my tank", !(await page.evaluate(() => !!document.querySelector(".jt-visit-bar"))));
    t.noErrors();
  },
};

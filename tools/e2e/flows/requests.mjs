/**
 * v12 daily requests: the note pinned in the hood opens today's list; while it's open a tap in the water only
 * closes it; petting twice finishes a "pet twice" request, which pays +5 once and shows its check.
 */
import { NOW, dayKey, jelly, save } from "../lib.mjs";

export const flow = {
  name: "requests",
  async run(t) {
    // today's list is one "pet twice" request (the old flow swapped it in after opening the note)
    await t.open({
      save: save({
        slots: [jelly(0, 0, { name: "Mochi" })],
        requests: { day: dayKey(NOW), items: [{ kind: "pet", target: -1, n: 2, progress: 0, done: false }] },
      }),
    });
    const { page } = t;
    t.check("the requests note is pinned in the hood", await t.until(() => { const b = document.querySelector(".jt-req-btn"); return !!b && !b.hidden; }));
    await page.click(".jt-req-btn");
    await t.idle();
    const list = await page.evaluate(() => ({
      open: !document.querySelector(".jt-req-panel").hidden,
      items: [...document.querySelectorAll(".jt-req-item")].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
      sim: window.__tank.requests?.items.length ?? 0,
    }));
    t.check("tapping the note opens today's requests", list.open && list.items.length >= 1 && list.items.length <= 2 && list.items.length === list.sim, JSON.stringify(list.items));
    await t.shot("11-requests");

    // while it's open the tank doesn't take taps: a press on the water just closes it
    const polyp = (await t.st()).slots[0];
    await t.tapWorld(polyp.x, polyp.y - 30);
    await t.advance(50);
    const blocked = await page.evaluate(() => ({ open: !document.querySelector(".jt-req-panel").hidden, aff: window.__tank.slots[0].affection, progress: window.__tank.requests.items[0].progress }));
    t.check("a tap outside closes the note without petting", !blocked.open && blocked.aff <= polyp.affection + 1e-6 && blocked.progress === 0, JSON.stringify(blocked));

    // pet twice: the request is done, +5, the note says so
    const d0 = (await t.st()).dollars;
    for (let k = 0; k < 2; k++) {
      const p = (await t.st()).slots[0];
      await t.tapWorld(p.x, p.y - 30);
      await t.advance(150);
    }
    const done = await t.until(() => window.__tank.requests.items[0].done, null, { pump: true });
    await t.until(() => !!document.querySelector(".jt-req-done"), null, { pump: true, timeout: 5000 }); // the bubble comes with the next frame's events
    const ui = await page.evaluate(() => ({ bubble: !!document.querySelector(".jt-req-done"), badge: document.querySelector(".jt-req-badge").textContent }));
    const d1 = (await t.st()).dollars;
    t.check("petting finishes a request: it pays +5 once, the note says so", done && d1 >= d0 + 5 && ui.bubble && ui.badge === "✓", `${d0} -> ${d1} ${JSON.stringify(ui)}`);
    await page.click(".jt-req-btn");
    await t.idle();
    t.check("a finished request shows its check and 2/2", await page.evaluate(() => { const li = document.querySelector(".jt-req-item"); return li.classList.contains("done") && /2\/2/.test(li.textContent); }));
    await t.shot("11b-request-done");
    await page.click(".jt-req-x");
    const paid = (await t.st()).dollars;
    const p = (await t.st()).slots[0];
    await t.tapWorld(p.x, p.y - 30);
    await t.advance(300);
    t.check("and isn't paid twice", (await t.st()).dollars <= paid + 1, `${paid} -> ${(await t.st()).dollars}`);
    t.noErrors();
  },
};

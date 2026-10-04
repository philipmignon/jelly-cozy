/**
 * A jelly up close: a long-press opens its card (with its personality), a rename sticks; petting it again and
 * again shows one name tag, not a stack.
 */
import { jelly, save } from "../lib.mjs";

export const flow = {
  name: "jelly",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3, { name: "Mochi" }), jelly(1, 2, { name: "Tofu" })], dollars: 50 }) });
    const { page } = t;

    // long-press the jelly: its card opens; rename it
    await t.eval(() => window.__jt.place(0, 360, 520));
    const [x, y] = await t.world(360, 520 - 40);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await t.until(() => !document.querySelector(".jt-card").hidden, null, { timeout: 8000 }); // hold until it opens
    await page.mouse.up();
    const open = await page.evaluate(() => !document.querySelector(".jt-card").hidden);
    t.check("long-press opens the jelly card", open);
    // v13: the card has its personality line
    const trait = await page.evaluate(() => { const e = document.querySelector(".jt-card .jt-trait"); return e && !e.hidden ? e.textContent : ""; });
    t.check("the card says the jelly's personality", /^(Shy|Curious|Sleepy|Social) — /.test(trait), trait);
    if (open) {
      await page.click("#jt-name");
      await page.evaluate(() => document.querySelector("#jt-name").select());
      await page.keyboard.type("Pudding");
      await page.keyboard.press("Enter");
      await t.idle(); // the close-up has eased in
      await t.shot("5d-card");
      await page.click(".jt-close");
      const name = (await t.st()).slots[0].name;
      t.check("rename sticks", name === "Pudding", name);
    } else {
      t.check("rename sticks", false, "no card");
    }
    await t.idle(); // ...and out again

    // petting again doesn't stack name tags: four taps on the bell, aimed where the jelly is each time
    await t.eval(() => window.__jt.place(0, 360, 520));
    for (let k = 0; k < 4; k++) {
      const j = (await t.st()).slots[0];
      await t.tapWorld(j.x, j.y - 40); // the bell sits above the rim origin
      await t.advance(140);
    }
    const tags = await page.evaluate(() => document.querySelectorAll(".jt-tag").length);
    t.check("petting again doesn't stack name tags", tags === 1, `tags=${tags}`);
    await t.advance(12_000);
    await t.idle();
    await t.shot("6-later");
    t.noErrors();
  },
};

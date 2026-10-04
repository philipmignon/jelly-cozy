/**
 * Clean picks up the sponge; rubbing a dirty spot scrubs it off, and a spot scrubbed off a real mess pays +1.
 */
import { jelly, save } from "../lib.mjs";

export const flow = {
  name: "cleaning",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3)], dollars: 10 }) });
    const { page } = t;
    // a full spot in the middle of the view (screen x 360, y 520): __jt.spotDirt reads that spot, not a later one
    // that might take its slot once it's gone
    const s0 = await t.st();
    const wx = 360 - s0.cam.x;
    const i = await t.eval((x) => window.__jt.addSpot(x, 520, 1), wx);
    t.check("cleaning: a dirty spot to scrub", i >= 0, `slot ${i}`);
    const d0 = (await t.st()).dollars;
    await t.press("clean");
    t.check("clean picks up the sponge", (await t.st()).tool === "sponge");
    const [sx, sy] = await t.world(wx, 520);
    const { s: k } = t.fit;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // rub until it's clean (each move is ~25 px of rubbing; a full spot takes ~1050 px, so ~45 moves)
    for (let n = 0; n < 440; n++) {
      await page.mouse.move(sx + Math.sin(n * 0.9) * 40 * k, sy + Math.cos(n * 0.7) * 16 * k);
      if (n === 20) {
        await t.advance(50);
        await t.shot("6b-scrubbing");
      }
      if (n % 20 === 19 && (await t.eval((j) => window.__jt.spotDirt(j), i)) < 0.05) break;
    }
    await page.mouse.up();
    await t.advance(300);
    const left = await t.eval((j) => window.__jt.spotDirt(j), i);
    t.check("scrubbing clears the spot", left < 0.05, `dirt=${left.toFixed(2)}`);
    const d1 = (await t.st()).dollars;
    t.check("a scrubbed spot pays +1", d1 >= d0 + 1, `${d0} -> ${d1}`);
    await t.press("clean");
    t.noErrors();
  },
};

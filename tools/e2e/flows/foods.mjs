/**
 * v11 foods: brine shrimp bought on the SUPPLIES tab; its jar comes off the shelf and pours brine shrimp.
 */
import { jelly, save } from "../lib.mjs";

export const flow = {
  name: "foods",
  async run(t) {
    await t.open({ save: save({ slots: [jelly(0, 3), jelly(1, 2)], dollars: 600 }) });
    const st = () => t.st();

    await t.openShop();
    await t.showTab(2);
    await t.click(...t.card(18));
    t.check("buy brine shrimp", (await st()).foods[1] === true);
    await t.closeShop(); // the panel slides over the shelf on its way out
    await t.press("shrimp");
    t.check("the shrimp jar comes off the shelf", (await st()).tool === "shrimp");
    const [x, y] = t.art(360, 400);
    await t.page.mouse.click(x, y);
    t.check("the jar pours brine shrimp", (await st()).food.some((f) => f.state !== "off" && f.kind === 1));
    await t.advance(600);
    await t.shot("foods-shrimp");
    await t.press("shrimp");
    t.check("the jar goes back on the shelf", (await st()).tool === "none");
    t.noErrors();
  },
};

/**
 * Temperature: the heater bought from the SUPPLIES tab appears on the shelf's back wall; tapping it warms the water
 * (announced) and the hood thermometer follows; a warm-loving jelly's card says it's just right; H and C work from
 * the keyboard (C says there's no chiller yet). On a small phone the thermometer sits clear of the request note and
 * the gear.
 */
import { K, jelly, save } from "../lib.mjs";

export const flow = {
  name: "temperature",
  async run(t) {
    const st = () => t.st();
    const live = () => t.page.evaluate(() => document.getElementById("jt-a11y-live")?.textContent ?? "");

    // upside-down, fried egg, a juvenile moon (two kinds raised: no keepsake note over the flow)
    await t.open({ save: save({ slots: [jelly(2, 3), jelly(4, 3), jelly(0, 2)], dollars: 400 }) });
    await t.openShop();
    await t.showTab(2);
    await t.page.mouse.move(...t.art(360, 600));
    for (let i = 0; i < 6; i++) await t.page.mouse.wheel({ deltaY: 200 });
    await t.advance(200);
    const scroll = (await st()).shopScroll;
    t.check("temperature: the SUPPLIES tab scrolls to the heater", scroll > 0, `scroll=${scroll}`);
    await t.shot("temp-shop");
    const card = K.shopCards[34];
    await t.click(card.x + card.w / 2, card.y + card.h / 2 - scroll);
    let s = await st();
    t.check("temperature: buy the heater", s.climate.heater === true && s.climate.set === 0 && s.dollars === 400 - 90, `dollars=${s.dollars}`);
    await t.closeShop();

    await t.press("heater");
    s = await st();
    t.check("temperature: tapping the heater switches it on", s.climate.set === 1);
    const said = await t.until(() => /heater on/i.test(document.getElementById("jt-a11y-live")?.textContent ?? ""), null, { timeout: 5000, pump: true });
    t.check("temperature: switching it on is announced", said, await live());
    await t.page.evaluate(() => window.__jt.advance(10 * 60_000, 100)); // ten minutes: the water gets there
    s = await st();
    t.check("temperature: the water warms to the setting", Math.abs(s.climate.temp - 27) < 0.5, `temp=${s.climate.temp}`);
    await t.idle();
    await t.shot("temp-warm");

    // the upside-down's card: it likes it warm
    await t.page.focus("#tank");
    await t.key("Tab");
    const target = await t.page.evaluate(() => document.getElementById("jt-a11y-focus")?.textContent ?? "");
    await t.key("n");
    const opened = await t.until(() => !document.querySelector(".jt-card")?.hidden, null, { timeout: 5000, pump: true });
    const line = await t.page.evaluate(() => document.querySelector(".jt-card-temp")?.textContent ?? "");
    t.check("temperature: the card says what water it likes", opened && /^Likes it (warm — just right|cool — a bit warm in here)$/.test(line), `${target} | ${line}`);
    await t.idle();
    await t.shot("temp-card");
    await t.key("Escape");
    await t.page.evaluate(() => document.querySelector(".jt-card .jt-close")?.click());
    await t.idle();

    // keys: H switches the heater off, C says there's no chiller
    await t.key("h");
    t.check("temperature: H switches the heater off", (await st()).climate.set === 0);
    await t.key("c");
    const focusSaid = await t.page.evaluate(() => document.getElementById("jt-a11y-focus")?.textContent ?? "");
    t.check("temperature: C without a chiller says so", /no chiller yet/i.test(focusSaid), focusSaid);

    // a small phone: the hood thermometer is clear of the request note and the gear
    await t.open({ save: save({ slots: [jelly(0, 3)], climate: { heater: true, chiller: true, set: -1, temp: 17 } }), view: { width: 360, height: 640 } });
    await t.idle();
    const th = K.temperature.thermometer;
    const [x0, y0] = t.art(th.x, th.y);
    const [x1, y1] = t.art(th.x1, th.y + th.h);
    const clash = await t.page.evaluate(
      (r) =>
        [".jt-req-btn", ".jt-gear"].flatMap((sel) => {
          const el = document.querySelector(sel);
          if (!el || el.hidden) return [];
          const b = el.getBoundingClientRect();
          return b.left < r.x1 && b.right > r.x0 && b.top < r.y1 && b.bottom > r.y0 ? [`${sel} ${Math.round(b.left)}..${Math.round(b.right)}`] : [];
        }),
      { x0, y0, x1, y1 },
    );
    t.check("temperature: on a 360x640 phone the thermometer is clear of the note and the gear", clash.length === 0, `thermometer ${Math.round(x0)}..${Math.round(x1)}: ${clash.join(", ")}`);
    await t.shot("temp-phone");
    t.noErrors();
  },
};

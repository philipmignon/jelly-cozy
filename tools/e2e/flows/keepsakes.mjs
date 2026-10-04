/**
 * v13 keepsakes: a save one step short of a milestone (two kinds raised, a blubber juvenile one meal from adult),
 * the step completed in the tank (feed it), the note, the reward, the journal's Keepsakes page, no second unlock
 * on reload; then an older save that already reached four milestones gets them in one summary note; then the
 * shop's DECOR tab scrolls to the keepsake cards and a locked one says how it's earned.
 */
import { K, NOW, blank, dayKey, entry, jelly, save, sleep } from "../lib.mjs";

export const flow = {
  name: "keepsakes",
  async run(t) {
    const noteText = () => t.page.evaluate(() => { const n = document.querySelector(".jt-keep-note"); return n && !n.hidden ? n.textContent : ""; });
    /** nothing should show: let the tank run a while (sim time) and give a note the real time it would take */
    const settle = async () => {
      await t.advance(1000);
      await sleep(500);
    };
    const kj = (k, g, extra) => jelly(k, g, { born: NOW, name: ["Mochi", "Tofu", "Bloop"][k % 3], ...extra });

    // one meal short of three kinds raised: the moon and the fried egg are raised, the blubber needs one more growth point
    await t.open({
      save: save({
        slots: [kj(0, 3), kj(4, 3), kj(1, 2, { gp: 29, fullness: 0.4 })],
        owned: [false, false, false, false, false, true, false, false, false, false, false],
        journal: [entry(1), entry(0), blank(), blank(), entry(1), blank(), blank(), blank(), blank()].map((e) => (e.raised ? { ...e, firstAdultAt: NOW } : e)),
        keep: { earned: 1, days: 1, lastDay: dayKey(NOW), requests: 0 },
      }),
    });
    const { page } = t;
    await settle();
    t.check("keepsakes: nothing new at load, nothing shown", (await noteText()) === "" && (await t.st()).owned[6] === false);

    await t.press("feed");
    let grew = false;
    for (let i = 0; i < 12 && !grew; i++) {
      const j = (await t.st()).slots[2];
      await t.tapWorld(j.x + (i % 2 ? 15 : -15), j.y - 70);
      for (let n = 0; n < 6 && !grew; n++) {
        await t.advance(250);
        grew = (await t.st()).slots[2]?.g === 3;
      }
    }
    t.check("keepsakes: feeding the blubber raises a third kind", grew);
    const shown = await t.until(() => !document.querySelector(".jt-keep-note")?.hidden, null, { timeout: 8000, pump: true });
    const text = await noteText();
    let s = await t.st();
    t.check("keepsakes: the unlock note says a lighthouse washed up, and it's in the tank", shown && /lighthouse/i.test(text) && s.owned[6] && s.keep.earned === 3, `${text} ${JSON.stringify({ owned: s.owned[6], earned: s.keep.earned })}`);
    await t.idle();
    await t.shot("keep-note");
    t.check("keepsakes: the unlock is saved", await t.until(() => (JSON.parse(localStorage.getItem("jellytank:v5") || "{}").keep?.earned ?? 0) === 3, null, { timeout: 3000 }));

    // "See journal" opens the book on the Keepsakes page: two done, the rest with their progress
    if (shown) await page.click(".jt-keep-note button:not(.ok)");
    await t.until(() => !document.querySelector(".jt-book").hidden && !document.querySelector(".jt-keep-page").hidden, null, { timeout: 5000 });
    const kp = await page.evaluate(() => ({
      open: !document.querySelector(".jt-book").hidden && !document.querySelector(".jt-keep-page").hidden,
      done: document.querySelectorAll(".jt-keep-row.done").length,
      counts: [...document.querySelectorAll(".jt-keep-count")].map((e) => e.textContent),
    }));
    t.check("keepsakes: the journal's Keepsakes page shows each milestone's progress", kp.open && kp.done === 2 && kp.counts.join(" ") === "✓ ✓ 0/1 1/7 0/10 3/9", JSON.stringify(kp));
    await t.idle();
    await t.shot("keep-journal");
    await page.keyboard.press("Escape");

    // a reload doesn't unlock it again
    await t.reload();
    await settle();
    s = await t.st();
    t.check("keepsakes: no second unlock after a reload", (await noteText()) === "" && s.owned[6] && s.keep.earned === 3);

    // an older save (v10: no keep field, five decorations) that already reached four milestones: one summary note,
    // every reward in
    await t.loadSave({
      ...save({ slots: [kj(0, 3, { morph: 1 })], journal: Array.from({ length: 9 }, (_, k) => ({ ...entry(1), firstAdultAt: NOW, morphSeen: k === 0 ? 1 : 0 })) }),
      v: 10,
      owned: [true, false, false, false, false],
      keep: undefined,
    });
    const sum = await t.until(() => !document.querySelector(".jt-keep-note")?.hidden, null, { timeout: 8000, pump: true });
    const rows = await page.evaluate(() => document.querySelectorAll(".jt-keep-note .jt-keep-sum li").length);
    s = await t.st();
    const got = { decor: s.owned.slice(5, 8).every(Boolean), lagoon: s.themes[4] };
    t.check("keepsakes: an older save gets one summary note for all it had reached", sum && rows === 4 && /keepsakes for you/i.test(await noteText()) && got.decor && got.lagoon, `${rows} ${JSON.stringify(got)}`);
    await t.idle();
    await t.shot("keep-summary");
    if (sum) await page.click(".jt-keep-note .ok");
    await t.until(() => document.querySelector(".jt-keep-note").hidden, null, { timeout: 3000 });
    await settle();
    t.check("keepsakes: just the one note", (await noteText()) === "");

    // the shop: DECOR scrolls down to the keepsakes; a locked one says how it's earned
    await t.openShop();
    await t.showTab(1);
    await page.mouse.move(...t.art(360, 600));
    for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: 200 });
    await t.advance(200);
    const scroll = (await t.st()).shopScroll;
    t.check("keepsakes: the DECOR tab scrolls to them", scroll > 0, `scroll=${scroll}`);
    const card = K.shopCards[29];
    await t.click(card.x + card.w / 2, card.y + card.h / 2 - scroll);
    await t.until(() => /keepsake:/i.test([...document.querySelectorAll(".jt-tag")].map((e) => e.textContent).join(" ")), null, { timeout: 5000, pump: true });
    const tag = await page.evaluate(() => [...document.querySelectorAll(".jt-tag")].map((e) => e.textContent).join(" "));
    t.check("keepsakes: a locked keepsake card says how it's earned, and isn't sold", /keepsake: finish 10 daily requests/i.test(tag) && !(await t.st()).owned[9], tag);
    await t.idle();
    await t.shot("keep-shop");
    t.noErrors();
  },
};

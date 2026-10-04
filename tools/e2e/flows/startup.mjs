/**
 * A new game (fast growth): the first-run tips, nothing of the room on a narrow screen, one moon polyp; the light
 * switch both ways; the food can picked up, sprinkled and put down; the polyp grows, care pays, and the first adult
 * leaves its keepsake (the bottle).
 */
export const flow = {
  name: "startup",
  async run(t) {
    await t.open({ tips: true, query: { fast: "1" } });
    const { page } = t;

    // first-run tips: four bubbles, each with a Next / Got it button
    await t.until(() => !document.querySelector(".jt-tip")?.hidden, null, { pump: true });
    await t.idle();
    await t.shot("0-tip");
    let tipsSeen = 0;
    while (await page.evaluate(() => !document.querySelector(".jt-tip").hidden)) {
      const before = await page.evaluate(() => document.querySelector(".jt-tip-count").textContent);
      await page.click("#jt-tip-next");
      await t.until((b) => document.querySelector(".jt-tip").hidden || document.querySelector(".jt-tip-count").textContent !== b, before);
      if (++tipsSeen > 6) break;
    }
    t.check("first-run tips show once and dismiss", tipsSeen === 4, `tips=${tipsSeen}`);
    const room = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /\/src\/room\.ts|\/assets\/room-[^/]*\.js|\/sprites\/room\.json/.test(u)));
    t.check("a narrow screen fetches nothing of the room", room.length === 0, room.join(" "));

    let s = await t.st();
    const j0 = s.slots[0];
    t.check("new game: one moon polyp, 0 dollars", j0?.k === 0 && j0?.g === 0 && !s.slots[1] && s.dollars === 0, JSON.stringify(j0 && { k: j0.k, g: j0.g }));
    await t.shot("1-start");

    // the light switch: night and back
    const night0 = s.nightTarget;
    await t.press("lamp");
    s = await t.st();
    t.check("lamp flips day/night", s.nightTarget === !night0, `${night0} -> ${s.nightTarget}`);
    await t.idle();
    await t.shot("2-lamp");
    await t.press("lamp");
    s = await t.st();
    t.check("lamp flips back", s.nightTarget === night0);
    await t.idle();

    // Feed picks up the food can; taps in the water sprinkle flakes right there
    await t.press("feed");
    t.check("feed picks up the food can", (await t.st()).tool === "food");
    const polyp = (await t.st()).slots[0];
    await t.tapWorld(polyp.x, polyp.y - 120);
    s = await t.st();
    t.check("tapping the water sprinkles food", s.food.some((f) => f.state !== "off"), `food=${s.food.filter((f) => f.state !== "off").length}`);
    await t.advance(100);
    await t.idle(); // the "+N" pops are HTML, on real time
    await t.shot("1b-pouring");
    for (let i = 0; i < 6; i++) {
      await t.advance(2500);
      await t.tapWorld(polyp.x + (i % 2 ? 20 : -20), polyp.y - 120);
    }
    await t.press("feed");
    t.check("feed again puts the can down", (await t.st()).tool === "none");

    // growth runs on sim time: up to 20 s of it (fast mode)
    for (let i = 0; i < 20; i++) {
      s = await t.st();
      if (s.slots[0]?.g >= 1 && s.dollars > 0) break;
      await t.advance(1000);
    }
    t.check("polyp grew past polyp stage (fast mode)", (s.slots[0]?.g ?? 0) >= 1, `stage=${s.slots[0]?.g}`);
    t.check("care earned dollars", s.dollars > 0, `dollars=${s.dollars}`);
    await t.idle();
    await t.shot("3-fed");

    // v13: the first adult leaves a keepsake (the message in a bottle): a note, and the bottle in the tank
    let grown = false;
    for (let i = 0; i < 40 && !grown; i++) {
      grown = (await t.st()).slots[0]?.g === 3;
      if (!grown) await t.advance(1000);
    }
    const noted = grown && (await t.until(() => !document.querySelector(".jt-keep-note")?.hidden, null, { pump: true }));
    const text = noted ? await page.evaluate(() => document.querySelector(".jt-keep-note").textContent) : "";
    s = await t.st();
    const kept = s.owned[5] === true && (s.keep.earned & 1) === 1;
    t.check("the first adult leaves a keepsake: a note and the bottle", noted && /bottle/i.test(text) && kept, `${grown} ${kept} ${text}`);
    await t.idle();
    await t.shot("3b-keepsake");
    t.noErrors();
  },
};

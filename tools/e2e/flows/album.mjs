/**
 * Photo mode and the album: "Take a photo" saves a portrait PNG of the glass (caught as the <a download> link's
 * blob); the journal's Album page keeps it, one thumbnail dated today; it opens larger with its caption (date,
 * theme, names), Escape closes just the photo, and deleting asks twice.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SHOTS, jelly, save } from "../lib.mjs";

export const flow = {
  name: "album",
  async run(t) {
    // device pixel ratio 2, as the old flow's photo was taken at
    await t.open({ save: save({ slots: [jelly(0, 3, { name: "Mochi" }), jelly(1, 2, { name: "Tofu" })], themes: [true, true, false, false, false], theme: 1, dollars: 30 }), dpr: 2 });
    const { page } = t;

    // the PNG goes out through an <a download> link: catch its blob
    await page.evaluate(() => {
      window.__photoHref = null;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__photoHref = this.href;
      };
    });
    await page.click(".jt-gear");
    await page.click(".jt-menu-photo");
    const got = await t.until(() => !!window.__photoHref, null, { timeout: 20_000 });
    const photo = got
      ? await page.evaluate(async () => {
          const blob = await (await fetch(window.__photoHref)).blob();
          const bmp = await createImageBitmap(blob);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d");
          ctx.drawImage(bmp, 0, 0);
          const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          const colours = new Set();
          let lit = 0;
          for (let i = 0; i < px.length; i += 4 * 97) {
            colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
            if (px[i] + px[i + 1] + px[i + 2] > 120) lit++;
          }
          const b64 = await new Promise((r) => {
            const fr = new FileReader();
            fr.onload = () => r(String(fr.result).split(",")[1]);
            fr.readAsDataURL(blob);
          });
          return { type: blob.type, w: bmp.width, h: bmp.height, colours: colours.size, lit, b64 };
        })
      : null;
    if (photo) {
      writeFileSync(join(SHOTS, "e2e-8c-photo.png"), Buffer.from(photo.b64, "base64"));
      delete photo.b64;
    }
    t.check("take a photo: a portrait, non-blank PNG", !!photo && photo.type === "image/png" && photo.h > photo.w && photo.w > 300 && photo.colours > 200 && photo.lit > 200, JSON.stringify(photo));

    // v14: the album (the journal's last page) keeps it: one thumbnail dated today
    await page.click(".jt-gear");
    await page.click(".jt-menu-journal");
    await t.until(() => !document.querySelector(".jt-book").hidden);
    await page.evaluate(() => {
      for (let i = 0; i < 20 && document.querySelector(".jt-album-page").hidden; i++) document.querySelector(".jt-book .prev").click();
    });
    const today = await page.evaluate(() => {
      const d = new Date(Date.now());
      return `${d.getDate()} ${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()]} ${d.getFullYear()}`;
    });
    const one = await t.until(() => {
      const img = document.querySelector(".jt-album-thumb img");
      return document.querySelectorAll(".jt-album-thumb img").length === 1 && img.complete && img.naturalWidth > 0;
    });
    const thumb = await page.evaluate(() => ({ n: document.querySelectorAll(".jt-album-thumb").length, date: document.querySelector(".jt-album-date")?.textContent, count: document.querySelector(".jt-book-count").textContent }));
    t.check("album: the photo is kept, one thumbnail with today's date", one && thumb.n === 1 && thumb.date === today && /1 of 12/.test(thumb.count), JSON.stringify({ ...thumb, today }));
    await t.idle();
    await t.shot("album");
    await page.click(".jt-album-thumb");
    const viewing = await t.until(() => !document.querySelector(".jt-album-view").hidden && document.querySelector(".jt-album-big").naturalWidth > 0, null, { timeout: 5000 });
    const cap = await page.evaluate(() => ({
      text: document.querySelector(".jt-album-cap").textContent,
      theme: ["Reef", "Kelp Forest", "Coral Garden", "Arctic", "Moonlit Lagoon"][window.__tank.theme],
      names: window.__tank.slots.filter(Boolean).map((j) => j.name),
    }));
    t.check("album: a thumbnail opens larger with its caption (date, theme, names)",
      viewing && cap.text.startsWith(today) && cap.text.includes(` · ${cap.theme} · `) && cap.names.some((n) => cap.text.includes(n)), JSON.stringify(cap));
    await t.idle();
    await t.shot("album-view");
    await page.keyboard.press("Escape");
    const closed = await t.until(() => document.querySelector(".jt-album-view").hidden, null, { timeout: 3000 });
    const after = await page.evaluate(() => ({ book: !document.querySelector(".jt-book").hidden, focus: document.activeElement?.classList.contains("jt-album-thumb") }));
    t.check("album: Escape closes the photo, not the journal, and focus goes back to its thumbnail", closed && after.book && after.focus, JSON.stringify(after));
    await page.click(".jt-album-thumb");
    await t.until(() => !document.querySelector(".jt-album-view").hidden, null, { timeout: 3000 });
    await page.click(".jt-album-del");
    const asked = await page.evaluate(() => ({ open: !document.querySelector(".jt-album-view").hidden, label: document.querySelector(".jt-album-del").textContent, n: document.querySelectorAll(".jt-album-thumb").length }));
    t.check("album: delete asks twice (the first tap only arms it)", asked.open && /again/i.test(asked.label) && asked.n === 1, JSON.stringify(asked));
    await page.click(".jt-album-del");
    t.check("album: the second tap deletes it",
      await t.until(() => document.querySelector(".jt-album-view").hidden && document.querySelectorAll(".jt-album-thumb").length === 0 && /0 of 12/.test(document.querySelector(".jt-book-count").textContent), null, { timeout: 5000 }));
    t.noErrors();
  },
};

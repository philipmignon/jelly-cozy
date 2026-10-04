/**
 * Automated accessibility checks (axe-core) on the HTML around the tank, state by state: the tank idle, the first
 * tip, the settings menu, the shop (its HTML side: the focus ring and the live regions over the canvas), a jelly's
 * card, the journal's pages and the album viewer, the share / backup / restore panels, the requests note, a
 * keepsake note, the room on a wide screen, reduce motion on. Serious and critical violations fail the check;
 * moderate and minor ones are warnings in the report.
 *
 * The tank itself is a canvas (role=application, labelled, kept in step by src/a11y.ts): axe can't see inside it,
 * so the checks cover what's HTML. The room's canvases are decoration (aria-hidden) and are left out.
 */
import { createRequire } from "node:module";
import { NOW, blank, dayKey, entry, jelly, save } from "../lib.mjs";
import { WIDE, everyday } from "../scenes.mjs";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const SERIOUS = new Set(["serious", "critical"]);

/** run axe on the page as it is; serious/critical fail `state`'s check, the rest are warnings */
async function audit(t, state, { exclude = [] } = {}) {
  const { page } = t;
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(
    async (tags, ex) => {
      const r = await window.axe.run({ include: [document], exclude: ex.map((s) => [s]) }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 6).map((n) => `${n.target.join(" ")}: ${(n.failureSummary ?? "").split("\n").slice(1).join(" ").trim().slice(0, 200)}`),
        more: Math.max(0, v.nodes.length - 6),
      }));
    },
    TAGS,
    [".jt-room-scene", ...exclude],
  );
  const bad = found.filter((v) => SERIOUS.has(v.impact));
  // the rest are warnings, one per rule for the whole flow (written at its end), listing the states it came up in
  t.a11y ??= new Map();
  for (const v of found.filter((x) => !SERIOUS.has(x.impact))) {
    const w = t.a11y.get(v.id) ?? { a11y: v.id, impact: v.impact, help: v.help, states: [], nodes: [] };
    w.states.push(state);
    for (const n of v.nodes) if (!w.nodes.includes(n) && w.nodes.length < 8) w.nodes.push(n);
    t.a11y.set(v.id, w);
  }
  return t.check(`a11y: ${state}: no serious or critical violations`, bad.length === 0, JSON.stringify(bad));
}

export const flow = {
  name: "a11y",
  async run(t) {
    // the first tip, then the tank idle
    await t.open({ save: everyday(), tips: true });
    const { page } = t;
    await t.until(() => !document.querySelector(".jt-tip")?.hidden, null, { pump: true });
    await t.idle();
    await audit(t, "first tip");
    while (await page.evaluate(() => !document.querySelector(".jt-tip").hidden)) {
      await page.click("#jt-tip-next");
      await t.advance(50);
    }
    await t.idle();
    await audit(t, "tank idle");

    // the settings menu
    await page.click(".jt-gear");
    await t.idle();
    await audit(t, "settings menu");
    await page.keyboard.press("Escape");

    // the shop, keyboard-opened (the focus ring and the live region describe its first card)
    await page.focus("#tank");
    await t.key("b");
    await t.idle();
    await audit(t, "shop open");
    await t.key("Escape");
    await t.idle();

    // a jelly's card (a long-press on it)
    await t.eval(() => window.__jt.place(0, 360, 520));
    const [x, y] = await t.world(360, 480);
    await page.mouse.move(x, y);
    await page.mouse.down();
    const card = await t.until(() => !document.querySelector(".jt-card").hidden, null, { timeout: 8000 });
    await page.mouse.up();
    await t.idle();
    t.check("a11y: the jelly card opened", card);
    await audit(t, "jelly card");
    await page.click(".jt-close");
    await t.idle();

    // the requests note
    const req = await t.until(() => { const b = document.querySelector(".jt-req-btn"); return !!b && !b.hidden; });
    if (req) {
      await page.click(".jt-req-btn");
      await t.idle();
      await audit(t, "requests note");
      await page.click(".jt-req-x");
    } else t.check("a11y: the requests note is pinned", false);

    // share, backup, restore
    for (const [item, state] of [[".jt-menu-share", "share panel"], [".jt-menu-backup", "backup panel"], [".jt-menu-restore", "restore panel"]]) {
      await page.click(".jt-gear");
      await page.click(item);
      await t.until(() => [...document.querySelectorAll(".jt-share")].some((p) => !p.hidden));
      await t.idle();
      await audit(t, state);
      await page.click(".jt-share:not([hidden]) .x");
    }

    // a photo for the album, then the journal: a species, the keepsakes, the visitors, the album, the photo
    await page.evaluate(() => {
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__photoHref = this.href;
      };
    });
    await page.click(".jt-gear");
    await page.click(".jt-menu-photo");
    t.check("a11y: a photo for the album", await t.until(() => !!window.__photoHref, null, { timeout: 20_000 }));
    await page.click(".jt-gear");
    await page.click(".jt-menu-journal");
    await t.until(() => !document.querySelector(".jt-book").hidden);
    await t.idle();
    await audit(t, "journal: a species");
    for (const [sel, state] of [[".jt-keep-page", "journal: keepsakes"], [".jt-vlog-page", "journal: visitors"], [".jt-album-page", "journal: album"]]) {
      const shown = await page.evaluate((s) => {
        for (let i = 0; i < 30 && document.querySelector(s).hidden; i++) document.querySelector(".jt-book .prev").click();
        return !document.querySelector(s).hidden;
      }, sel);
      await t.idle();
      if (shown) await audit(t, state);
      else t.check(`a11y: ${state} shows`, false);
    }
    const viewing = (await t.until(() => !!document.querySelector(".jt-album-thumb img")?.complete)) && (await page.click(".jt-album-thumb"), await t.until(() => !document.querySelector(".jt-album-view").hidden));
    await t.idle();
    if (viewing) await audit(t, "album viewer");
    else t.check("a11y: the album viewer opens", false);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // back after six hours: the away note; then a keepsake note (an adult in the tank and no milestone yet earned,
    // so the first one comes up after the away note)
    await t.open({ save: save({ slots: [jelly(0, 3)], journal: [entry(1), ...Array.from({ length: 8 }, blank)], keep: { earned: 0, days: 1, lastDay: dayKey(NOW), requests: 0 }, lastSeen: NOW - 6 * 3_600_000 }) });
    const away = await t.until(() => { const b = document.querySelector("#jt-away-ok"); return !!b && b.offsetParent !== null; }, null, { timeout: 8000, pump: true });
    await t.idle();
    if (away) {
      await audit(t, "away note");
      await t.page.click("#jt-away-ok");
    } else t.check("a11y: the away note comes up", false);
    const note = await t.until(() => !document.querySelector(".jt-keep-note")?.hidden, null, { timeout: 8000, pump: true });
    await t.idle();
    if (note) await audit(t, "keepsake note");
    else t.check("a11y: a keepsake note comes up", false);

    // the room on a wide screen, with reduce motion on
    await t.open({ save: everyday(), view: WIDE, query: { sky: "dusk", season: "halloween" }, storage: { "jellytank:reduceMotion": "1" } });
    const room = await t.until(() => !!document.querySelector(".jt-room.jt-room-on"), null, { timeout: 15_000 });
    await t.idle();
    t.check("a11y: the room is up, reduce motion on", room && (await t.eval(() => window.__tank.reducedMotion)));
    await audit(t, "room, reduce motion");
    for (const w of t.a11y?.values() ?? []) t.warn(w);
    t.noErrors();
  },
};

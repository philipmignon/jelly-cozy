/**
 * Share codes: copy your tank as text, or paste a friend's code to visit
 * their tank read-only. The visit happens on a reload: the code waits in
 * sessionStorage, and main.ts starts from it instead of your save.
 */
const VISIT_KEY = "jellytank:visit";
const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;

const CSS = `
.jt-share {
  position: fixed; z-index: 7; left: 50%; top: 40%; transform: translate(-50%, -50%);
  width: min(320px, calc(100vw - 32px)); box-sizing: border-box;
  font: 12px/1.45 ${FONT}; color: #2b1712;
  background: #f1e2c4; border: 3px solid #45261a; border-radius: 10px; padding: 14px 16px 16px;
  box-shadow: inset 0 0 0 3px #d9bf94, 0 4px 0 #2b1712, 0 12px 30px rgba(0, 0, 0, 0.45);
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px;
}
.jt-share[hidden] { display: none; }
.jt-share h2 { margin: 0; font: 15px/1.2 ${FONT}; text-transform: uppercase; color: #693c24; }
.jt-share textarea {
  width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; font: 11px/1.35 ui-monospace, Menlo, monospace;
  color: #2b1712; background: #fffaf0; border: 2px solid #a78560; border-radius: 6px; padding: 6px 8px; word-break: break-all;
}
.jt-share textarea:focus-visible { outline: 2px solid #e09a28; outline-offset: 1px; }
.jt-share .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.jt-share button {
  padding: 6px 12px; font: 12px ${FONT}; text-transform: uppercase; color: #2b1712; cursor: pointer;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px; box-shadow: 0 2px 0 #693c24;
}
.jt-share button:focus-visible { outline: 2px solid #e09a28; outline-offset: 2px; }
.jt-share .x { margin-left: auto; color: #fffaf0; background: #d04a46; border-color: #5a1418; box-shadow: 0 2px 0 #5a1418; }
.jt-share .note { color: #8e5632; font-size: 11px; min-height: 1em; }
.jt-share hr { border: 0; border-top: 2px dashed #d9bf94; margin: 2px 0; width: 100%; }
.jt-visit-bar {
  position: fixed; z-index: 6; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 52px);
  display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px;
  font: 11px ${FONT}; text-transform: uppercase; color: #2b1712;
  background: #fff2c8; border: 2px solid #e09a28; border-radius: 8px; box-shadow: 0 2px 0 #6b3a12;
}
.jt-visit-bar button {
  padding: 4px 10px; font: 11px ${FONT}; text-transform: uppercase; color: #2b1712; cursor: pointer;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px;
}
`;

export function pendingVisit(): string | null {
  try {
    return sessionStorage.getItem(VISIT_KEY);
  } catch {
    return null;
  }
}

function setVisit(code: string | null): void {
  try {
    if (code) sessionStorage.setItem(VISIT_KEY, code);
    else sessionStorage.removeItem(VISIT_KEY);
  } catch {
    /* no storage: visiting can't survive the reload */
  }
}

export interface SharePanel {
  open(): void;
  readonly isOpen: boolean;
}

/**
 * @param exportCode returns this tank's code
 * @param check returns true if a pasted code is a valid tank
 */
export function createSharePanel(exportCode: () => string, check: (code: string) => boolean): SharePanel {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const panel = document.createElement("div");
  panel.className = "jt-share";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Share your tank");
  panel.innerHTML = `
    <div class="row"><h2>Share your tank</h2><button type="button" class="x" aria-label="Close">X</button></div>
    <textarea id="jt-my-code" readonly aria-label="Your tank code"></textarea>
    <div class="row"><button type="button" class="copy">Copy code</button><span class="note copied" aria-live="polite"></span></div>
    <hr>
    <h2>Visit a tank</h2>
    <textarea id="jt-visit-code" aria-label="Paste a tank code" placeholder="Paste a friend's tank code"></textarea>
    <div class="row"><button type="button" class="go">Visit</button><span class="note err" aria-live="polite"></span></div>`;
  document.body.append(panel);
  const $ = <T extends Element>(sel: string) => panel.querySelector(sel) as T;
  const mine = $<HTMLTextAreaElement>("#jt-my-code");
  const theirs = $<HTMLTextAreaElement>("#jt-visit-code");
  const copied = $<HTMLElement>(".copied");
  const err = $<HTMLElement>(".err");

  $<HTMLButtonElement>(".copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mine.value);
      copied.textContent = "Copied";
    } catch {
      mine.focus();
      mine.select(); // the frame refused the clipboard: leave it selected to copy by hand
      copied.textContent = "Selected. Copy it with your keyboard or menu.";
    }
  });
  $<HTMLButtonElement>(".go").addEventListener("click", () => {
    const code = theirs.value.trim();
    if (!check(code)) {
      err.textContent = "That code isn't a tank. Check it was copied in full.";
      return;
    }
    setVisit(code);
    location.reload();
  });
  const close = () => {
    panel.hidden = true;
  };
  $<HTMLButtonElement>(".x").addEventListener("click", close);
  panel.addEventListener("keydown", (e) => {
    e.stopPropagation(); // typing "m" in a code must not mute the sound
    if (e.key === "Escape") close();
  });

  return {
    open() {
      mine.value = exportCode();
      copied.textContent = "";
      err.textContent = "";
      panel.hidden = false;
    },
    get isOpen() {
      return !panel.hidden;
    },
  };
}

/** The read-only banner shown while visiting someone else's tank. */
export function showVisitBar(): void {
  const bar = document.createElement("div");
  bar.className = "jt-visit-bar";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span>Visiting a friend's tank</span><button type="button">Back to my tank</button>`;
  bar.querySelector("button")!.addEventListener("click", () => {
    setVisit(null);
    location.reload();
  });
  document.body.append(bar);
}

// ---------------------------------------------------------------- save backup

const SAVE_PREFIX = "JTSAVE1.";

/** Your whole save (jellies, journal, dollars, decor...) as one copyable code. */
export function encodeSave(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return SAVE_PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The save JSON inside a backup code, or null if it isn't one. */
export function decodeSave(code: string): string | null {
  const c = code.trim();
  if (!c.startsWith(SAVE_PREFIX)) return null;
  try {
    const b64 = c.slice(SAVE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
    const o = JSON.parse(json) as { v?: unknown; slots?: unknown };
    return typeof o.v === "number" && Array.isArray(o.slots) ? json : null;
  } catch {
    return null;
  }
}

export interface BackupPanel {
  open(mode: "backup" | "restore"): void;
  readonly isOpen: boolean;
}

/**
 * @param backup returns the current save as JSON
 * @param restore writes a save JSON as the player's save (then the page reloads)
 */
export function createBackupPanel(backup: () => string, restore: (json: string) => void): BackupPanel {
  const panel = document.createElement("div");
  panel.className = "jt-share";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.innerHTML = `
    <div class="row"><h2 class="title"></h2><button type="button" class="x" aria-label="Close">X</button></div>
    <p class="note intro"></p>
    <textarea id="jt-save-code" aria-label="Save code"></textarea>
    <div class="row"><button type="button" class="act"></button><span class="note msg" aria-live="polite"></span></div>`;
  document.body.append(panel);
  const $ = <T extends Element>(sel: string) => panel.querySelector(sel) as T;
  const area = $<HTMLTextAreaElement>("#jt-save-code");
  const msg = $<HTMLElement>(".msg");
  let mode: "backup" | "restore" = "backup";
  let confirmRestore = false;

  $<HTMLButtonElement>(".act").addEventListener("click", async () => {
    if (mode === "backup") {
      try {
        await navigator.clipboard.writeText(area.value);
        msg.textContent = "Copied. Keep it somewhere safe.";
      } catch {
        area.focus();
        area.select();
        msg.textContent = "Selected. Copy it with your keyboard or menu.";
      }
      return;
    }
    const json = decodeSave(area.value);
    if (!json) {
      msg.textContent = "That isn't a save code. Check it was copied in full.";
      return;
    }
    if (!confirmRestore) {
      // the frame can't show confirm(), so the button asks twice
      confirmRestore = true;
      $<HTMLButtonElement>(".act").textContent = "Replace my tank";
      msg.textContent = "This replaces your current tank. Tap again to restore.";
      return;
    }
    restore(json);
  });
  const close = () => {
    panel.hidden = true;
  };
  $<HTMLButtonElement>(".x").addEventListener("click", close);
  panel.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });

  return {
    open(m) {
      mode = m;
      confirmRestore = false;
      msg.textContent = "";
      $<HTMLElement>(".title").textContent = m === "backup" ? "Back up your save" : "Restore a save";
      panel.setAttribute("aria-label", m === "backup" ? "Back up your save" : "Restore a save");
      $<HTMLElement>(".intro").textContent =
        m === "backup"
          ? "Your tank lives in this browser. Copy this code to bring it back if the browser forgets it."
          : "Paste a save code to load that tank here.";
      $<HTMLButtonElement>(".act").textContent = m === "backup" ? "Copy code" : "Restore";
      area.readOnly = m === "backup";
      area.value = m === "backup" ? encodeSave(backup()) : "";
      panel.hidden = false;
    },
    get isOpen() {
      return !panel.hidden;
    },
  };
}

/** Leave a visited tank (used before a restore reloads into your own). */
export function clearVisit(): void {
  setVisit(null);
}

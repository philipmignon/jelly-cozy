/**
 * Offline play and instant repeat visits on the GitHub Pages build: registers dist/sw.js (built from src/sw.js).
 *
 * Only index.html carries <meta name="jellytank-sw" content="sw.js">, so the claude.ai pages tools/page.mjs
 * writes (which can't use service workers) never register one; nor does the dev server, nor a page with the
 * .riv inlined. When a new build takes over while the tank is open, a small chip offers a reload; nothing
 * reloads by itself. Saves stay in localStorage; the worker never touches them.
 */

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Should this page run the service worker? (exported for the tests) */
export function swUrl(doc: Pick<Document, "querySelector">, win: { __JELLYTANK_RIV_B64?: unknown }, prod: boolean): string | null {
  if (!prod || typeof win.__JELLYTANK_RIV_B64 === "string") return null;
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="jellytank-sw"]');
  return meta?.content || null;
}

/** Same-origin and Google Fonts files the page fetched: on a first visit they came before the worker did. */
function fetchedUrls(): string[] {
  const urls = performance.getEntriesByType("resource").map((e) => e.name);
  return [...new Set(urls)].filter((u) => u.startsWith(location.origin) || u.startsWith("https://fonts.googleapis.com/") || u.startsWith("https://fonts.gstatic.com/"));
}

const activated = (w: ServiceWorker | null): Promise<void> =>
  new Promise((resolve) => {
    if (!w || w.state === "activated" || w.state === "redundant") return resolve();
    w.addEventListener("statechange", () => {
      if (w.state === "activated" || w.state === "redundant") resolve();
    });
  });

const FONT = `"Silkscreen", ui-monospace, Menlo, monospace`;
const CSS = `
.jt-upd {
  position: fixed; z-index: 6; transform: translateX(-50%); display: flex; align-items: center; gap: 6px;
  padding: 4px 4px 4px 10px; font: 10px ${FONT}; text-transform: uppercase; color: #2b1712; white-space: nowrap;
  background: #fff2c8; border: 2px solid #e09a28; border-radius: 8px; box-shadow: 0 2px 0 #6b3a12;
}
.jt-upd button {
  padding: 3px 8px; font: 10px ${FONT}; text-transform: uppercase; color: #2b1712; cursor: pointer;
  background: #fffaf0; border: 2px solid #693c24; border-radius: 6px;
}
.jt-upd .x { padding: 3px 6px; }
.jt-upd button:focus-visible { outline: 2px solid #e09a28; outline-offset: 2px; }
`;

/** A small chip at the top of the water: the update is in, reload when you like (nothing reloads by itself). */
function showUpdated(anchor: () => { x: number; y: number }): void {
  if (document.querySelector(".jt-upd")) return;
  if (!document.getElementById("jt-upd-css")) {
    const style = document.createElement("style");
    style.id = "jt-upd-css";
    style.textContent = CSS;
    document.head.append(style);
  }
  const chip = document.createElement("div");
  chip.className = "jt-upd";
  chip.setAttribute("role", "status");
  chip.innerHTML = `<span>Updated</span><button type="button" class="go">Reload</button><button type="button" class="x" aria-label="Later">×</button>`;
  const place = () => {
    const at = anchor();
    chip.style.left = `${at.x}px`;
    chip.style.top = `${at.y}px`;
  };
  place();
  window.addEventListener("resize", place);
  chip.querySelector(".go")!.addEventListener("click", () => location.reload()); // pagehide saves the tank first
  chip.querySelector(".x")!.addEventListener("click", () => {
    window.removeEventListener("resize", place);
    chip.remove();
  });
  document.body.append(chip);
}

/**
 * Call once the tank is on screen, so the precache doesn't compete with the first load. `anchor` is where the
 * "updated" chip goes (client px, its top centre).
 */
export function registerOffline(anchor: () => { x: number; y: number }): void {
  const url = swUrl(document, window as { __JELLYTANK_RIV_B64?: unknown }, import.meta.env.PROD);
  if (!url) return;
  let sw: ServiceWorkerContainer | undefined;
  try {
    sw = navigator.serviceWorker; // throws in some sandboxed frames
  } catch {
    return;
  }
  if (!sw) return;
  const container = sw;
  const hadController = !!container.controller;
  container.addEventListener("controllerchange", () => {
    if (!hadController) return; // the first visit's worker taking over: nothing changed
    // is the script this page runs part of the build now in charge? (the page is network-first, so an
    // open tab is often already the new build when its worker arrives.) Asked once the new worker has
    // activated: controllerchange comes first, while the old build's cache still exists.
    void activated(container.controller)
      .then(() => caches.match(import.meta.url))
      .then((hit) => hit || showUpdated(anchor))
      .catch(() => undefined);
  });
  container
    .register(url, { scope: "./" })
    .then((reg) => {
      const warm = () => reg.active?.postMessage({ type: "warm", urls: fetchedUrls() });
      void container.ready.then(warm);
      setTimeout(warm, 20_000); // sprite groups prefetched while the worker was installing
      // a tank left open for days still hears about new builds: hourly, and on coming back to the tab
      let checked = Date.now();
      const check = () => {
        if (Date.now() - checked < UPDATE_CHECK_MS / 6) return;
        checked = Date.now();
        void reg.update().catch(() => undefined);
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) check();
      });
    })
    .catch((err: unknown) => console.warn("service worker:", err));
}

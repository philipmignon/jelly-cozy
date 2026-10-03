/*
 * Jelly Tank's service worker: the GitHub Pages build only (src/offline.ts registers it when the page carries
 * <meta name="jellytank-sw">; the claude.ai pages from tools/page.mjs never do, and neither does dev).
 *
 * vite.config.ts writes dist/sw.js from this file, filling in CONFIG below:
 *   { version, precache: [paths relative to the scope], versioned: [sprite group "file?v=hash" paths] }.
 *
 *   the page (navigations)            network first, the cached page when offline or the network stalls
 *   assets/* (hashed), sprites ?v=     cache first (a new build has new names, so nothing goes stale)
 *   icons, manifest, unversioned       cache, refreshed in the background
 *   Google Fonts css + woff2           css refreshed in the background, font files cache first
 *
 * A new build installs at once (skipWaiting) and takes over open pages; the page decides whether to offer a
 * reload (offline.ts). Old caches are deleted on activate, after copying across the sprite groups and fonts
 * the new build still uses, so a tank that worked offline keeps working offline after an update.
 * Saves live in localStorage and are never touched here.
 */
const CONFIG = __JELLYTANK_SW_CONFIG__;
const PREFIX = "jellytank-";
const CACHE = PREFIX + CONFIG.version;
const SCOPE = self.registration.scope;
const abs = (p) => new URL(p, SCOPE).href;
const PAGE = abs("./");
const PRECACHE = CONFIG.precache.map(abs);
/** current sprite groups (with their ?v=): carried over from an old cache on update */
const VERSIONED = new Set(CONFIG.versioned.map(abs));
const FONT_CSS = "https://fonts.googleapis.com";
const FONT_FILES = "https://fonts.gstatic.com";
const isFont = (url) => url.startsWith(FONT_CSS + "/") || url.startsWith(FONT_FILES + "/");
/** how long a navigation waits for the network before the cached page is served */
const PAGE_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const name of await caches.keys()) {
        if (!name.startsWith(PREFIX) || name === CACHE) continue;
        const old = await caches.open(name);
        for (const req of await old.keys()) {
          const keep = VERSIONED.has(req.url) || isFont(req.url);
          if (!keep || (await cache.match(req))) continue;
          const res = await old.match(req);
          if (res) await cache.put(req, res);
        }
        await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * The page asks for what it fetched before this worker controlled it (the first visit) to be cached too:
 * this build's sprite groups and the fonts. (The bundle is precached; a page from an older build may ask for
 * its own files, which must not come back into this build's cache.)
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "warm" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of data.urls) {
        if (typeof url !== "string" || !(VERSIONED.has(url) || isFont(url)) || (await cache.match(url))) continue;
        try {
          const res = await fetch(url, { mode: "cors", credentials: "omit" });
          if (res.ok) await cache.put(url, res);
        } catch {
          /* offline again: the next visit fills it in */
        }
      }
    })(),
  );
});

/** Which strategy serves a GET for this URL (null: not ours, the browser fetches it as usual). */
function route(url) {
  if (url.origin === FONT_FILES) return "cacheFirst";
  if (url.origin === FONT_CSS) return "refresh";
  if (!url.href.startsWith(SCOPE)) return null;
  const path = url.href.slice(SCOPE.length).split(/[?#]/)[0];
  if (path === "" || path === "index.html") return "page";
  if (path === "sw.js") return null;
  if (path.startsWith("assets/") || (path.startsWith("sprites/") && url.searchParams.has("v"))) return "cacheFirst";
  return "refresh";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const how = req.mode === "navigate" ? (route(url) === "page" ? "page" : null) : route(url);
  if (how === "page") event.respondWith(page(req));
  else if (how === "cacheFirst") event.respondWith(cacheFirst(req));
  else if (how === "refresh") event.respondWith(refresh(req, event));
});

const cacheable = (res) => res.ok || res.type === "opaque";

async function page(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) void cache.put(PAGE, res.clone()); // every query string (?season=, ?demo=) shares one page
    return res;
  });
  network.catch(() => undefined); // offline: answered from the cache below
  const cached = await cache.match(PAGE);
  if (!cached) return network;
  // the network wins if it answers in time (so an update arrives on this load); offline or stalled, the cached copy
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    return res && res.ok ? res : cached;
  } catch {
    return cached;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) void cache.put(req, res.clone());
  return res;
}

async function refresh(req, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (cacheable(res)) void cache.put(req, res.clone());
    return res;
  });
  if (!hit) return network;
  event.waitUntil(network.catch(() => undefined));
  return hit;
}

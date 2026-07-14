// public/sw.js — Condo Life service worker (PROJECT_CONTEXT.md §8: PWA).
//
// Registered from index.html ONLY (never the tool pages — see the
// registration script there). Caching strategy, and why:
//
//   /data/*.json and /api/*        → NETWORK-ONLY, never touches the cache.
//     The game polls /data/*.json every 2s for hot-reload (game/data.ts's
//     watchData()) and the tool constellation GETs/PUTs through /api/data/*.
//     Serving anything but a live network response here would silently break
//     tuning/hot-reload and the whole designer-tools workflow — this is the
//     one rule that must never regress.
//
//   everything else (app shell, tool pages, built JS/CSS, models, manifest,
//   icons) → NETWORK-FIRST, falling back to the cache only when the network
//     request fails (offline). A successful response is opportunistically
//     cached for that offline fallback. This is deliberately NOT cache-first:
//     during `npm run dev`, Vite serves game/*.ts through its own dev
//     transform (query-stamped URLs, HMR) and the network is always
//     available — network-first means the cache is simply never consulted in
//     dev, so it cannot interfere with hot module reload or the tools' own
//     live-edit workflow. In production this still gives real offline support
//     without a stale-shell risk, since a fresh deploy is always preferred
//     the instant the network is reachable.
//
// The routing predicate lives in sw-routing.js (pure, headless-tested in
// test/sw-routing.test.mjs) — imported here as an ES module.
import { isDataOrApiPath } from './sw-routing.js';

const CACHE_VERSION = 'condo-life-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept PUT/DELETE (tool saves, map delete)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin requests alone

  if (isDataOrApiPath(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || Response.error())),
  );
});

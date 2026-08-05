// Minimal service worker - enables "Add to Home Screen" install on iOS/Android.
// Caches the app shell only. The server (Supabase) stays the source of truth
// per README §2.4; we do NOT cache API responses.
const CACHE = "expense-shell-v7";
const SHELL = [
  "./index.html", "./app.js", "./categorize.js", "./charts.js",
  "./subscriptions.js", "./discounts.js", "./gemma.js", "./config.js",
  "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never intercept Supabase / cross-origin calls - always hit the network.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== "GET") return;

  // App shell: network-first. Always try to fetch the freshest copy of the
  // file; only serve the cached copy if the network request fails (i.e. the
  // phone is offline). This is what makes code changes (charts.js, app.js,
  // index.html, ...) show up on next reload without a manual force-refresh -
  // previously this was cache-first, so an edited file kept being served
  // stale until the service worker itself happened to change.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Let a waiting worker take over immediately when the page asks it to
// (paired with the auto-reload snippet in index.html).
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
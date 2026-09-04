// Minimal service worker - enables "Add to Home Screen" install on iOS/Android.
// Caches the app shell only. The server (Supabase) stays the source of truth
// per README §2.4; we do NOT cache API responses.
//
// SHELL only pre-warms the cache during install, before the first navigation
// even completes - it is NOT what keeps the app usable offline day to day.
// That is the fetch handler below: app.js is loaded as a real ES module, so
// its entire static-import graph (every app/*.js file it pulls in) is fetched
// by the browser on any single successful online load, and every one of
// those GETs passes through the network-first cache-as-you-go logic below
// regardless of whether it is named here. Confirmed live: after exactly one
// full page load, all 20+ modules were in the cache even though only 6 were
// ever listed in SHELL.
//
// This list had drifted to 6 of the 20+ real modules and nothing noticed,
// because the fetch-handler safety net silently covered for it in the only
// case that matters (a user who has opened the app before). The one gap that
// safety net cannot cover is the FIRST-EVER load being interrupted before the
// module graph finishes fetching (a flaky connection during install) - kept
// current here to close that gap too, not because normal offline use depends
// on it. If it drifts again, that narrow case regresses; ordinary offline use
// after a successful first run does not.
const CACHE = "expense-shell-v10";
const SHELL = [
  "./index.html", "./config.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./app.js", "./accountHistory.js", "./bankNames.js", "./budgets.js",
  "./cashflow.js", "./categorize.js", "./charts.js", "./creditCycle.js",
  "./dates.js",
  "./csvImport.js", "./depreciation.js", "./discounts.js", "./export.js",
  "./gemma.js", "./income.js", "./investments.js", "./wiki.js",
  "./networth.js", "./payoff.js", "./subscriptions.js", "./tickers.js",
  "./tour.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  // Deliberately no self.skipWaiting() here - index.html's "Update available,
  // tap to refresh" toast is the only thing that should promote a waiting
  // worker (via the postMessage("skipWaiting") handler below). Calling it
  // unconditionally on every install - including the very first one, before
  // any tab is "old" - made every page load force a silent, unprompted
  // location.reload() a few hundred ms after startup (clients.claim() below
  // fires controllerchange as soon as this worker activates), which could
  // land mid-interaction (e.g. wiping out an in-progress Pay-liability
  // submission) with no way for the user to see it happen.
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
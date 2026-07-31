/* Dhandho Restaurant — service worker.
   Precache the whole app so it opens with no network at all. The data
   never lived on a server anyway, so "offline" is not a mode here — it
   is just how the app works. */
/* Bump this on every release. A cache-first worker will otherwise happily
   serve yesterday's code to a shop that already installed the app. */
var CACHE = 'dhandho-restaurant-v8';

/* Code must never be a release behind.
   A pure cache-first worker kept serving yesterday's JS until the shop
   opened the app a second time, so a fix pushed at 9pm did not reach the
   counter until the next morning -- and while testing, it silently hid
   changes that had already shipped. Code and markup are now fetched
   network-first with a short leash: if the network does not answer within
   NET_MS (or the phone is offline, where fetch rejects at once), the
   cached copy is served and the till opens as fast as it always did. */
var NET_MS = 1500;
var CODE_RE = /\.(js|html)$|\/$/;
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/glass.css',
  './js/core.js',
  './js/i18n.js',
  './js/cloud-config.js',
  './js/vendor/supabase.js',
  './js/sync.js',
  './js/ui-doctor.js',
  './js/data.js',
  './js/ops.js',
  './js/qr.js',
  './js/demo.js',
  './js/print.js',
  './js/app.js',
  './js/ui-setup.js',
  './js/ui-waiter.js',
  './js/ui-kitchen.js',
  './js/ui-cashier.js',
  './js/ui-owner.js',
  './js/ui-stock.js',
  './js/ui-khata.js',
  /* The v2 engine and the bridge that feeds it. These were missing, so a
     FIRST open with no network fetched them and got index.html back (the
     navigation fallback), which parses as HTML and throws — the Saamaan
     screen and the spine mirror both silently failed on exactly the phone
     that needed them most. The two .wasm files are what SQLite compiles to;
     without them the engine cannot boot at all offline. */
  './js/spine-bridge.js',
  './dhandho-local.js',
  './sql-wasm.wasm',
  './sql-wasm-browser.wasm'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* One bad URL must not fail the whole install. */
      return Promise.all(ASSETS.map(function (u) {
        return c.add(u).catch(function () { return null; });
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  function fromNetwork(req) {
    return fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  }

  /* Code + markup: network-first, but never block the till for long. */
  if (CODE_RE.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(function (hit) {
        var net = fromNetwork(e.request).catch(function () { return null; });
        if (!hit) return net.then(function (r) { return r || caches.match('./index.html'); });
        var timed = new Promise(function (resolve) {
          setTimeout(function () { resolve(null); }, NET_MS);
        });
        return Promise.race([net, timed]).then(function (r) { return r || hit; });
      })
    );
    return;
  }

  /* Everything else (icons, styles, vendor): cache-first, refreshed behind. */
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) {
        fetch(e.request).then(function (res) {
          if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(e.request, res.clone()); });
        }).catch(function () {});
        return hit;
      }
      return fromNetwork(e.request).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});

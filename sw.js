// Service worker: tiene l'app (e pdf.js) in cache per l'uso offline,
// e serve dalla cache le immagini dei Doc scaricate per l'offline.
var V = "spartiti-v2";   // cambiare a ogni pubblicazione per aggiornare l'app sul tablet
var IMG = "spartiti-img";
var SHELL = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest", "icon.svg",
             "pdfjs/pdf.min.js", "pdfjs/pdf.worker.min.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== V && k !== IMG; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// cache subito, aggiornamento in background (stale-while-revalidate)
function swr(req, key) {
  return caches.open(V).then(function (c) {
    return c.match(key || req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && r.ok) c.put(key || req, r.clone());
        return r;
      }).catch(function () { return hit; });
      return hit || net;
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin === location.origin) {
    if (req.mode === "navigate") e.respondWith(swr(req, "index.html"));
    else e.respondWith(swr(req));
  } else if (req.destination === "image") {
    e.respondWith(caches.open(IMG).then(function (c) {
      return c.match(req.url).then(function (hit) { return hit || fetch(req); });
    }));
  }
});

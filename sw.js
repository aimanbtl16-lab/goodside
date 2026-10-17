// Good Side service worker: lets the installed app open even with weak or no signal.
// Always tries the network first (so a new version of the site shows right away), and falls back
// to the last copy kept on the phone. Listings, photos and logins (Supabase) are never cached here.
var CACHE = "goodside-v1";
var CORE = ["/", "/index.html", "/i18n.js", "/api.js", "/config.js", "/listings.js", "/places.js", "/icon-192.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).catch(function () {}));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("/l/") === 0) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok && res.type === "basic") {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === "navigate" ? caches.match("/") : Response.error());
    });
  }));
});

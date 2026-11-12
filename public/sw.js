// Service worker minimal : rend la version web utilisable hors connexion
// après une première visite. Les fichiers versionnés (/assets/) sont servis
// depuis le cache ; la page d'entrée est rafraîchie dès que le réseau répond.
const CACHE = "nautila-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  const put = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
  } else {
    e.respondWith(
      fetch(req)
        .then(put)
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
  }
});

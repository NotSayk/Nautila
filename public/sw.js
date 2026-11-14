// Service worker minimal : rend la version web utilisable hors connexion
// après une première visite. Les fichiers versionnés (/assets/) sont servis
// depuis le cache ; la page d'entrée est rafraîchie dès que le réseau répond.
const ASSETS = "nautila-assets-v2";
const PAGES = "nautila-pages-v2";
const KEEP = [ASSETS, PAGES];
/** Un fichier versionné inutilisé depuis ce délai appartient à une ancienne version : il est supprimé. */
const ASSET_MAX_AGE = 30 * 86_400_000;
/** Un fichier encore utilisé est rafraîchi en cache au bout de ce délai, pour ne pas être pris pour un vieux. */
const ASSET_REFRESH = 7 * 86_400_000;
/** Au-delà, la page d'entrée vient du cache plutôt que d'un réseau qui ne répond pas. */
const NETWORK_TIMEOUT = 4000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(prune)
      .then(() => self.clients.claim()),
  );
});

const age = (res) => Date.now() - (Date.parse(res.headers.get("date") ?? "") || 0);

/** Supprime les fichiers versionnés des anciennes versions de l'application. */
async function prune() {
  const cache = await caches.open(ASSETS);
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (!res || age(res) > ASSET_MAX_AGE) await cache.delete(req);
  }
}

const isHtml = (res) => (res.headers.get("content-type") ?? "").startsWith("text/html");

/**
 * Récupère `req` sur le réseau et garde la réponse si elle est complète (pas 206), de cette
 * origine et du bon genre : jamais une page HTML renvoyée à la place d'un fichier versionné.
 * L'écriture en cache est rattachée à l'événement, pour que le navigateur l'attende.
 */
function fetchAndStore(e, req, cacheName, key, wanted) {
  const done = fetch(req).then((res) => {
    const write =
      res.status === 200 && res.type === "basic" && wanted(res)
        ? caches.open(cacheName).then((c) => c.put(key, res.clone()))
        : Promise.resolve();
    return { res, write };
  });
  e.waitUntil(done.then(({ write }) => write).catch(() => undefined));
  return done.then(({ res }) => res);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) return;
  // Les demandes partielles (lecture d'une vidéo…) vont directement au réseau.
  if (req.headers.has("range")) return;

  if (url.pathname.startsWith("/assets/")) {
    const asset = (res) => !isHtml(res);
    const hit = caches.match(req, { cacheName: ASSETS });
    e.respondWith(hit.then((res) => res ?? fetchAndStore(e, req, ASSETS, req, asset)));
    // Fichier encore utilisé : rafraîchi de temps en temps, pour que le ménage ne le prenne pas pour un vieux.
    e.waitUntil(
      hit
        .then((res) => res && age(res) > ASSET_REFRESH && fetchAndStore(e, req, ASSETS, req, asset))
        .catch(() => undefined),
    );
    return;
  }

  // Page d'entrée et autres fichiers : réseau d'abord, cache si le réseau échoue ou tarde trop.
  const navigate = req.mode === "navigate";
  const key = navigate ? "/" : req;
  const network = fetchAndStore(e, req, PAGES, key, (res) => !navigate || isHtml(res));
  const cached = () => caches.match(key, { cacheName: PAGES });
  e.respondWith(
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (res) => {
        if (!settled && res) {
          settled = true;
          resolve(res);
        }
      };
      const timer = navigate ? setTimeout(() => cached().then(finish), NETWORK_TIMEOUT) : null;
      network.then(
        (res) => {
          clearTimeout(timer);
          finish(res);
        },
        async (err) => {
          clearTimeout(timer);
          const hit = await cached();
          if (hit) finish(hit);
          else if (!settled) reject(err);
        },
      );
    }),
  );
});

// Offline support: the app has no external dependencies, so caching these files is enough for it
// to open without internet after one online visit. Stale-while-revalidate: the cached copy is served
// immediately (fast and offline-proof, also on slow satellite links) and refreshed in the background,
// so a new version is picked up on the next visit.
const CACHE = "cosmiq5-web-v1";
const FILES = ["./", "./index.html", "./logbook.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
    event.respondWith(
        caches.open(CACHE).then(async (cache) => {
            // Page navigations (with or without query string) all map to the cached app page.
            const key = req.mode === "navigate" ? "./index.html" : req;
            const cached = await cache.match(key, { ignoreSearch: true });
            const fresh = fetch(req)
                .then((res) => {
                    if (res.ok) cache.put(key, res.clone());
                    return res;
                })
                .catch(() => cached);
            if (cached) {
                event.waitUntil(fresh.catch(() => {}));
                return cached;
            }
            return fresh;
        }),
    );
});

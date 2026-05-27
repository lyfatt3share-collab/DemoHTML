self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open("pwa-demo-v2").then(cache => {
      return cache.addAll([
        "./",
        "./index.html",
        "./manifest.json"
      ]);
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== "pwa-demo-v2").map(k => caches.delete(k))
      );
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(resp => {
      return resp || fetch(event.request);
    })
  );
});
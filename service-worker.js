
const CACHE_NAME = "arenax-pwa-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192-1.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    for (const file of APP_SHELL) {
      try {
        await cache.add(file);
      } catch (error) {
        console.warn("Cache failed:", file, error);
      }
    }

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key => key.startsWith("arenax-pwa-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);

      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }

      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      return new Response("অফলাইন অবস্থায় পেজটি পাওয়া যাচ্ছে না।", {
        status: 503
      });
    }
  })());
});
      

/**
 * sw.js
 *
 * Service worker. The app is fully offline-capable once installed - there is
 * no backend, so caching the shell is enough.
 *
 * Strategy: cache-first for the app shell (it's versioned by CACHE), with a
 * network revalidation in the background so a new deploy is picked up on the
 * next launch rather than requiring a hard refresh.
 */

// Bump this on every deploy to invalidate the old shell.
const CACHE = 'ccapp-v4';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './dist/bundle.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll rejects the whole install if any single file 404s, so add them
      // individually and tolerate misses.
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Only same-origin GETs are ours to serve
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          // Only cache complete, successful responses
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      // Serve from cache immediately when we have it; refresh in the background
      return cached || network;
    })
  );
});

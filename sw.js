const CACHE_NAME = 'laundry-pos-cache-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// When the service worker is installed, cache the core app files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache and caching app shell files');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

// When the app makes a request for a file, try to serve it from the cache first
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // If we find a match in the cache, return it.
        // If not, fetch it from the network.
        return response || fetch(event.request);
      })
  );
});
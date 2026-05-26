const CACHE_NAME = 'contamax-v1'
const ASSETS = [
  '/contamax/',
  '/contamax/index.html',
  '/contamax/css/styles.css',
  '/contamax/js/app.js',
  '/contamax/js/rrhh.js',
  '/contamax/js/financiamiento.js',
  '/contamax/js/reportes.js',
  '/contamax/manifest.json'
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for app shell
  if (e.request.url.includes('supabase.co') || e.request.url.includes('esm.sh')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    )
  }
})

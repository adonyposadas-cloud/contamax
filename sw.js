const CACHE_NAME = 'contamax-v2'
const ASSETS = [
  '/contamax/',
  '/contamax/index.html',
  '/contamax/css/styles.css',
  '/contamax/manifest.json'
]

self.addEventListener('install', e => {
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
  // Always network first for JS files and API calls
  e.respondWith(
    fetch(e.request).then(res => {
      // Cache successful responses for offline fallback
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone))
      }
      return res
    }).catch(() => caches.match(e.request))
  )
})

const CACHE_NAME = 'contamax-v15'

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
  // Skip non-GET, non-HTTP(S), and API/auth requests
  if (e.request.method !== 'GET') return
  if (!e.request.url.startsWith('http')) return
  if (e.request.url.includes('supabase') || e.request.url.includes('/auth/') || e.request.url.includes('/rest/')) return

  e.respondWith(
    fetch(e.request).then(res => {
      // Only cache same-origin successful responses
      try {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, clone).catch(() => {})
          })
        }
      } catch(err) {}
      return res
    }).catch(() => caches.match(e.request))
  )
})
const V = 'tn-v2.2.0', SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/logic.js', 'js/voice.js', 'js/community.js', 'js/config.js', 'js/mascot.js', 'js/garage.js', 'js/safety.js', 'data/restrictions-northeast.json', 'data/diesel-northeast.geojson', 'data/truck-pois-northeast.geojson', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'tn-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim())));
const MAX_TILES = 8000; let tileCount = 0;
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET') return;
  if (u.hostname === 'tiles.openfreemap.org') { // map tiles/styles/fonts: cache-first w/ background refresh -> map of areas you've driven works offline
    e.respondWith(caches.open('tn-tiles').then(async c => { const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok && tileCount++ < MAX_TILES) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net; })); return;
  }
  if (u.origin === location.origin || u.hostname === 'unpkg.com') // app shell: network-first so updates land, cache fallback offline
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(V).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

const V = 'tn-v3.21.0', SHELL = ['./', 'index.html', 'css/app.css', 'css/tokens.css', 'css/pro.css', 'js/rail.js', 'js/fresh.js', 'js/pro.js', 'js/iconset.js', 'js/app.js', 'js/logic.js', 'js/voice.js', 'js/myvoice.js', 'js/community.js', 'js/config.js', 'js/mascot.js', 'js/garage.js', 'js/safety.js', 'js/trip.js', 'js/extras.js', 'data/eia-diesel.json', 'data/amenities-northeast.geojson', 'js/offline.js', 'js/planner.js', 'js/plannerlogic.js', 'js/hazards.js', 'js/hazlogic.js', 'js/traffic.js', 'js/keys.js', 'js/dispatch-page.js', 'js/fleet.js', 'js/fleetlogic.js', 'js/fleetdriver.js', 'js/trafficlogic.js', 'js/vendor/nostr.js', 'js/link.js', 'js/auth.js', 'js/dispatch.js', 'js/friends.js', 'js/account.js', 'js/cloud.js', 'data/restrictions-northeast.json', 'data/diesel-northeast.geojson', 'data/truck-pois-northeast.geojson', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon.svg', 'privacy.html', 'terms.html', 'terms.html', 'js/privacy.js', 'js/hos.js', 'js/truckroutes.js', 'js/nyctruck.js', 'js/wizard.js', 'js/freight.js', 'js/freightlogic.js', 'js/jobs.js', 'js/jobslogic.js', 'js/growth.js', 'data/nyc-truck-routes.json', 'icons/icon-512.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(err => console.warn('precache miss', u, err))))).then(() => { if (!self.registration.active) return self.skipWaiting(); }))); // one missing file must never break offline. Updates wait: the page activates them only when not navigating (no swap mid-drive)
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'tn-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim())));
const MAX_TILES = 30000; let tileCount = 0;
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

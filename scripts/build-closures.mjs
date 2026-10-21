// Fetch free, keyless official work-zone feeds (WZDx) server-side (they don't allow browser CORS) and publish a compact GeoJSON.
import { writeFileSync } from 'node:fs';
import { wzdxToZones } from '../js/safety.js';
const FEEDS = [{ id: 'NJ', name: 'NJDOT/TRANSCOM via NJIT WZDx', url: 'https://smartworkzones.njit.edu/nj/wzdx' }];
const features = [], sources = [];
for (const f of FEEDS) {
  try { const r = await fetch(f.url, { headers: { 'User-Agent': 'TruckNav/2 (github.com/Ace9x/truckers-gps)' }, signal: AbortSignal.timeout(60000) }); const j = await r.json();
    const z = wzdxToZones(j); sources.push({ ...f, ok: true, count: z.length, updated: j.feed_info?.update_date });
    for (const x of z) features.push({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: x.coords.map(c => [+c[0].toFixed(5), +c[1].toFixed(5)]) }, properties: { closed: x.closed, desc: x.desc.slice(0, 220), roads: x.roads.slice(0, 2), end: x.end, src: f.id } });
  } catch (e) { sources.push({ ...f, ok: false, error: String(e.message || e) }); }
}
writeFileSync('data/closures.geojson', JSON.stringify({ type: 'FeatureCollection', generated: new Date().toISOString(), sources, features }));
console.log(sources);

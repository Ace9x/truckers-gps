// Pure helpers for Driver Deals and featured places. No network and no DOM.
import { haversine } from './logic.js';

export const SEARCH_RADIUS_M = 80467; // about 50 miles, the same "near you" line search already uses
export const ROUTE_POI_M = 1700;
export const DEAL_CATS = [
  { id: 'fuel', label: 'Fuel discount cards' },
  { id: 'insurance', label: 'Truck insurance quotes' },
  { id: 'eld', label: 'ELDs' },
  { id: 'factoring', label: 'Factoring' },
];

export function withUtm(url) {
  if (!url) return '';
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  u.searchParams.set('utm_source', 'rigroute');
  u.searchParams.set('utm_medium', 'deals');
  return u.toString();
}

export function liveFeatured(rows, now = Date.now()) {
  return (rows || []).filter(r => r && r.active !== false && Number.isFinite(+r.lat) && Number.isFinite(+r.lng) && (!r.expires_at || Date.parse(r.expires_at) > now));
}

// Featured places inside the search radius move to the front. Far ones stay in the original order.
export function mergeSearch(results, featured, query, origin, now = Date.now()) {
  const q = String(query || '').trim().toLowerCase();
  const here = origin && Number.isFinite(origin.lon) && Number.isFinite(origin.lat) ? origin : null;
  const near = liveFeatured(featured, now).map(f => ({ ...f, dist: here ? haversine([here.lon, here.lat], [+f.lng, +f.lat]) : Infinity }));
  const close = f => f.dist <= SEARCH_RADIUS_M;
  const tagged = (results || []).map(r => {
    const hit = near.find(f => close(f) && ((Number.isFinite(r.lon) && haversine([r.lon, r.lat], [+f.lng, +f.lat]) < 400) || (q && String(f.name || '').toLowerCase() === String(r.name || '').toLowerCase())));
    return hit ? { ...r, featured: true } : { ...r };
  });
  const have = new Set(tagged.map(r => String(r.name || '').toLowerCase()));
  const extra = near.filter(f => close(f) && q && String(f.name || '').toLowerCase().includes(q) && !have.has(String(f.name || '').toLowerCase()))
    .map(f => ({ name: f.name, sub: f.type || '', lon: +f.lng, lat: +f.lat, dist: f.dist, featured: true, phone: f.phone || '', url: f.url || '' }));
  const boosted = [], rest = [];
  for (const r of [...extra, ...tagged]) (r.featured && (r.dist == null || r.dist <= SEARCH_RADIUS_M) ? boosted : rest).push(r);
  return [...boosted, ...rest];
}

// Tag stops already on the route, and add a featured place as a list row only when it is within the route radius. No map pin.
export function decorateRoutePois(pois, featured, snap, now = Date.now()) {
  const live = liveFeatured(featured, now);
  const tagged = (pois || []).map(p => {
    const hit = live.find(f => haversine([p.lon, p.lat], [+f.lng, +f.lat]) < 350);
    return hit && p.off <= ROUTE_POI_M ? { ...p, featured: true } : p;
  });
  const extras = [];
  for (const f of live) {
    if (typeof snap !== 'function') continue;
    const sn = snap(+f.lng, +f.lat);
    if (!sn || !(sn.dist <= ROUTE_POI_M)) continue;
    if (tagged.some(p => haversine([p.lon, p.lat], [+f.lng, +f.lat]) < 350)) continue;
    extras.push({ noPin: true, featured: true, name: f.name, lon: +f.lng, lat: +f.lat, kind: 'other', off: sn.dist, along: sn.along || 0, tags: {}, phone: f.phone || '', url: f.url || '' });
  }
  const boosted = [], rest = [];
  for (const p of [...tagged, ...extras]) (p.featured ? boosted : rest).push(p);
  return [...boosted, ...rest];
}

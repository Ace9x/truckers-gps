// Long trips and address ranking. Valhalla's public server refuses a path longer than 1,500 km.
// A trip of any length is split into corridor hops and stitched back into one route. No DOM.
import { haversine } from './logic.js';

export const LEG_M = 700000; // straight-line budget per request, so the road distance stays under 1,500 km

export function isDistanceCap(err) {
  return /max(?:imum)? distance|distance limit|exceeds the max/i.test(String(err?.message || err || ''));
}

export function driverRouteMessage(err, online = true) {
  const m = String(err?.message || err || '');
  if (!online) return 'No signal. Routing needs a connection. Try again when you have service.';
  if (/timeout|timed out|abort/i.test(m)) return 'The route is taking too long. Try again.';
  if (/no route|unable to find|no path|no suitable/i.test(m)) return 'No truck route found. Check the address or your truck size, then try again.';
  return 'Could not build a route. Try again.';
}

// Point t of the way from a to b on a great circle. a/b are {lat, lon}.
export function gcPoint(a, b, t) {
  const φ1 = a.lat * Math.PI / 180, λ1 = a.lon * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180, λ2 = b.lon * Math.PI / 180;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2)));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI };
}

// [a, ...waypoints, b]. Each step's straight-line length stays within stepM.
export function corridorPoints(a, b, stepM = LEG_M) {
  const d = haversine([a.lon, a.lat], [b.lon, b.lat]);
  const n = Math.max(1, Math.ceil(d / stepM));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(i === 0 ? { lat: a.lat, lon: a.lon } : i === n ? { lat: b.lat, lon: b.lon } : gcPoint(a, b, i / n));
  return pts;
}

// Join routed legs into one line and one maneuver list. The join drops the arrival of one leg and the departure of the next.
export function stitchRoutes(parts) {
  let line = [], maneuvers = [], length = 0, time = 0;
  for (const p of parts) {
    if (!p?.line?.length) continue;
    const drop = line.length ? 1 : 0;
    const base = line.length ? line.length - 1 : 0;
    let ms = (p.maneuvers || []).map(m => ({
      ...m,
      begin_shape_index: Math.max(0, (m.begin_shape_index || 0) - drop) + base,
      end_shape_index: m.end_shape_index != null ? Math.max(0, m.end_shape_index - drop) + base : undefined,
    }));
    if (line.length) {
      if (maneuvers.length && [4, 5, 6].includes(maneuvers.at(-1).type)) maneuvers.pop();
      if ([1, 2, 3].includes(ms[0]?.type)) ms = ms.slice(1);
    }
    line.push(...p.line.slice(drop));
    maneuvers.push(...ms);
    length += p.length || 0;
    time += p.time || 0;
  }
  return { line, maneuvers, length, time, chained: parts.filter(p => p?.line?.length).length > 1 };
}

const keyOf = p => `${(+p.lat).toFixed(3)},${(+p.lon).toFixed(3)}`;
const STOP = new Set(['street', 'avenue', 'road', 'drive', 'boulevard', 'lane', 'court', 'place', 'the', 'and', 'near']);

function queryTokens(q) {
  return String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w));
}
function oneOff(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n <= 1; }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skip = 0;
  while (i < s.length && j < l.length) { if (s[i] === l[j]) { i++; j++; } else { skip++; j++; if (skip > 1) return false; } }
  return skip + (l.length - j) <= 1;
}
function fuzzyHit(hay, token) {
  if (hay.includes(token)) return true;
  if (token.length < 6) return false;
  return hay.split(/[^a-z0-9]+/).some(w => w.length >= 5 && oneOff(w, token));
}
function nameScore(p, tokens) {
  if (!tokens.length) return 0;
  const hay = `${p.name || ''} ${p.sub || ''} ${p.city || ''} ${p.state || ''}`.toLowerCase();
  return tokens.reduce((n, t) => n + (fuzzyHit(hay, t) ? 1 : 0), 0);
}

// Nearby matches first. Among nearby matches, the address that matches the typed words wins.
// Far matches stay in the list so the driver can still choose them.
export function rankPlaces(list, bias, q = '') {
  const seen = new Set(), out = [], tokens = queryTokens(q);
  for (const p of list || []) {
    if (!p || !Number.isFinite(+p.lat) || !Number.isFinite(+p.lon)) continue;
    const k = keyOf(p); if (seen.has(k)) continue; seen.add(k);
    const dist = Number.isFinite(p.dist) ? p.dist : (bias ? haversine([bias.lon, bias.lat], [+p.lon, +p.lat]) : Infinity);
    out.push({ ...p, lat: +p.lat, lon: +p.lon, dist });
  }
  out.sort((a, b) => {
    const af = a.dist > 80000 ? 1 : 0, bf = b.dist > 80000 ? 1 : 0;
    if (af !== bf) return af - bf;
    if (!af) { const d = nameScore(b, tokens) - nameScore(a, tokens); if (d) return d; }
    return a.dist - b.dist;
  });
  return out;
}

export function milesAway(distM) {
  if (!(distM > 80000)) return '';
  const mi = Math.round(distM / 1609.344);
  return ` · ${mi} mi away`;
}

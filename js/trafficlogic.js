// Pure traffic logic (no DOM): congestion levels, crowd aggregation, route delay, jam alerts, reroute trigger, deep links.
import { haversine, snapToRoute, bearing } from './logic.js';
import { geohash } from './hazlogic.js';
export const MPH = 2.23694, MI = 1609.344;
export const LEVELS = [
  { id: 'free', min: 0.8, color: '#2e7d32', label: 'Free flow' },
  { id: 'slow', min: 0.55, color: '#f9a825', label: 'Slow' },
  { id: 'heavy', min: 0.3, color: '#e53935', label: 'Heavy' },
  { id: 'jam', min: 0, color: '#7f0000', label: 'Stop-and-go' }];
export const level = ratio => LEVELS.find(l => ratio >= l.min) || LEVELS[3];
// Free-flow reference for feeds that give only current speed (NYC DOT): highway names vs. arterials.
export const refMph = name => /\b(I-?\d+|BQE|LIE|CBE|BRP|GCP|HRP|FDR|CIP|VWE|SIE|WSE|NJTP|PKWY|PARKWAY|EXPWY|EXPRESSWAY|BRIDGE|BR\b|TUNNEL|TNB|VNB|GWB|RFK|BQE|MDE|HHP|CVE|BE\b|TBB|XBX)/i.test(name || '') ? 50 : 30;
export const segKey = (lat, lon, heading) => `${geohash(lat, lon, 7)}:${Math.round(((heading ?? 0) % 360 + 360) % 360 / 45) % 8}`;
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Crowd samples {k, mph, ff, lat, lon, h, t, by}. Latest per driver per segment, needs >= minDrivers distinct drivers (privacy + robustness).
export function aggregate(samples, now = Date.now(), { maxAgeMs = 10 * 60e3, minDrivers = 2 } = {}) {
  const by = new Map();
  for (const s of samples) { if (!(now - s.t <= maxAgeMs) || !(s.mph >= 0) || s.mph > 100) continue;
    const g = by.get(s.k) || new Map(); const p = g.get(s.by); if (!p || p.t < s.t) g.set(s.by, s); by.set(s.k, g); }
  const out = {};
  for (const [k, g] of by) { const v = [...g.values()]; if (v.length < minDrivers) continue;
    const mph = median(v.map(x => x.mph)), ff = median(v.map(x => x.ff || 50)), ratio = Math.min(1, mph / ff);
    out[k] = { k, mph, ff, ratio, level: level(ratio).id, n: v.length, t: Math.max(...v.map(x => x.t)), lat: median(v.map(x => x.lat)), lon: median(v.map(x => x.lon)), h: v[0].h }; }
  return out;
}
// Expected (no-traffic) speed per route point from Valhalla maneuvers (m/s).
export function expectedSpeeds(route) { const sp = new Array(route.line.length).fill(route.length / Math.max(1, route.time));
  for (const m of route.maneuvers || []) { const v = m.time > 0 ? (m.length * 1000) / m.time : null; if (!v) continue; for (let i = m.begin_shape_index; i <= Math.min(m.end_shape_index ?? m.begin_shape_index, sp.length - 1); i++) sp[i] = v; }
  return sp; }
// obs: [{lat, lon, mph, ff, src, t, h?}] → per-bin speeds along the route → delay + slowdowns.
export function routeTraffic(route, obs, { from = 0, bin = 250, maxSnap = 35, headingTol = 60 } = {}) {
  const cum = route.cum, L = route.length, exp = expectedSpeeds(route), nb = Math.ceil(L / bin), bins = Array.from({ length: nb }, () => []);
  const C = 0.004, cell = (x, y) => `${Math.floor(x / C)},${Math.floor(y / C)}`, cells = new Set();
  for (const [x, y] of route.line) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.add(cell(x + i * C, y + j * C));
  for (const o of obs) { if (!cells.has(cell(o.lon, o.lat))) continue; const sn = snapToRoute([o.lon, o.lat], route.line, cum, 0); if (sn.dist > maxSnap) continue;
    if (o.h != null) { const i = Math.min(sn.seg, route.line.length - 2), rb = bearing(route.line[i], route.line[i + 1]); const d = Math.abs(((o.h - rb) % 360 + 540) % 360 - 180); if (d > (o.htol || headingTol)) continue; }
    bins[Math.min(nb - 1, Math.floor(sn.along / bin))].push(o); }
  let delay = 0, covered = 0, idx = 0; const slow = [], srcs = new Set(); let newest = 0;
  for (let b = 0; b < nb; b++) { const a0 = b * bin, a1 = Math.min(L, a0 + bin); while (idx < cum.length - 1 && cum[idx + 1] < a0) idx++;
    if (a1 <= from || !bins[b].length) continue; const len = a1 - Math.max(a0, from); covered += len;
    const mph = median(bins[b].map(o => o.mph)), ff = median(bins[b].map(o => o.ff || 50)); bins[b].forEach(o => { srcs.add(o.src); newest = Math.max(newest, o.t || 0); });
    const expV = exp[idx], obsV = Math.max(1, mph / MPH), d = Math.max(0, len / obsV - len / expV), lv = level(Math.min(1, mph / ff)).id;
    delay += d;
    if (lv !== 'free') { const last = slow.at(-1); if (last && a0 - last.end <= bin) { last.end = a1; last.delay += d; last.mphs.push(mph); if (rank(lv) > rank(last.level)) last.level = lv; }
      else slow.push({ start: Math.max(a0, from), end: a1, delay: d, level: lv, mphs: [mph] }); } }
  slow.forEach(s => { s.mph = Math.round(median(s.mphs)); delete s.mphs; });
  return { delay, slowdowns: slow, covered, coverage: L - from > 0 ? covered / (L - from) : 0, sources: [...srcs], newest };
}
const rank = l => ['free', 'slow', 'heavy', 'jam'].indexOf(l);
export function jamText(s, along) { const d = s.start - along, mi = d / MI, min = Math.round(s.delay / 60);
  const what = s.level === 'jam' ? 'Stopped traffic' : s.level === 'heavy' ? 'Heavy traffic' : 'Slow traffic';
  const where = d < 400 ? 'ahead' : `in ${mi < 0.875 ? (Math.round(mi * 4) / 4 || 0.25) + ' miles' : Math.round(mi) + (Math.round(mi) === 1 ? ' mile' : ' miles')}`;
  return `${what} ${where}${min >= 1 ? `, ${min} minute delay` : ''}`; }
// Suggest a reroute only when the current route's delay is big AND an alternative (truck-costed) actually saves time.
export function rerouteDecision(cur, alts, { minDelay = 300, minSave = 180 } = {}) {
  if (!(cur.delay >= minDelay)) return null; const curT = cur.time + cur.delay; let best = null;
  for (const a of alts) { const t = a.time + a.delay; if (curT - t >= minSave && (!best || t < best.total)) best = { ...a, total: t, save: curT - t }; }
  return best; }
export const ageText = ms => ms < 90e3 ? 'live' : ms < 3600e3 ? `${Math.round(ms / 60e3)} min old` : `${(ms / 3600e3).toFixed(1)} h old`;
export const wazeLink = (d) => `https://waze.com/ul?ll=${d.lat.toFixed(6)},${d.lon.toFixed(6)}&navigate=yes`;
export const gmapsLink = (o, d) => `https://www.google.com/maps/dir/?api=1${o ? `&origin=${o.lat.toFixed(6)},${o.lon.toFixed(6)}` : ''}&destination=${d.lat.toFixed(6)},${d.lon.toFixed(6)}&travelmode=driving`;
export const appleLink = (d) => `https://maps.apple.com/?daddr=${d.lat.toFixed(6)},${d.lon.toFixed(6)}&dirflg=d`;
// Parse NYC DOT real-time speeds rows → link features (keyless, data.cityofnewyork.us i4gi-tjb9).
// NYC DOT link_points are often truncated/garbled ("40.7," fragments, swapped or missing pairs). Keep only points inside the
// NYC region, split the polyline wherever consecutive points jump > maxJump metres, and keep pieces with >= 2 points.
export const NYC_BOX = { s: 40.4, n: 41.2, w: -74.4, e: -73.6 };
export function cleanPolyline(pts, maxJump = 300) { const segs = []; let cur = [];
  for (const p of pts) { const prev = cur.at(-1); if (prev && haversine(prev, p) > maxJump) { if (cur.length > 1) segs.push(cur); cur = []; } cur.push(p); }
  if (cur.length > 1) segs.push(cur); return segs; }
export function parseNycDot(rows, { maxJump = 300 } = {}) { return rows.filter(r => r.status !== '-101' && +r.speed > 0 && r.link_points).flatMap(r => {
  const raw = r.link_points.trim().split(/\s+/).map(p => p.split(',')).filter(p => p.length === 2 && p[0] && p[1]).map(p => p.map(Number))
    .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo) && la > NYC_BOX.s && la < NYC_BOX.n && lo > NYC_BOX.w && lo < NYC_BOX.e).map(([la, lo]) => [lo, la]);
  const mph = +r.speed, ff = refMph(r.link_name), dm = /^\S+\s+(N|S|E|W)B?\b/i.exec(r.link_name || ''), dir = dm ? { N: 0, E: 90, S: 180, W: 270 }[dm[1].toUpperCase()] : null, t = Date.parse(r.data_as_of + (/[Z+]/.test(r.data_as_of.slice(19)) ? '' : nyOffset(r.data_as_of)));
  return cleanPolyline(raw, maxJump).map((coords, i) => ({ dir, dirTol: 100, id: r.link_id + (i ? '.' + i : ''), name: r.link_name, mph, ff, ratio: Math.min(1, mph / ff), coords, t, src: 'NYC DOT' }));
}); }
// Drop feed data older than maxAgeMs (stale congestion is worse than none).
export const freshLinks = (links, now = Date.now(), maxAgeMs = 30 * 60e3) => links.filter(l => now - l.t <= maxAgeMs);
const nyOffset = s => { const m = +s.slice(5, 7); return m >= 4 && m <= 10 ? '-04:00' : m === 3 || m === 11 ? '-04:00' : '-05:00'; };
// Densify a link polyline into observation points with headings (for snapping to the route).
export function linkObs(f, step = 120) { const out = [];
  for (let i = 0; i < f.coords.length - 1; i++) { const a = f.coords[i], b = f.coords[i + 1], L = haversine(a, b), h = f.dir !== undefined ? f.dir : bearing(a, b), htol = f.dirTol, n = Math.max(1, Math.round(L / step));
    for (let j = 0; j < n; j++) { const t = j / n; out.push({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, h, htol, mph: f.mph, ff: f.ff, src: f.src, t: f.t }); } }
  return out; }
// HERE Traffic v7 flow (locationReferencing=shape) → link features.
export function parseHere(j, t = Date.now()) { return (j.results || []).flatMap(r => { const cf = r.currentFlow || {}; if (!(cf.speed >= 0) || !(cf.freeFlow > 0)) return [];
  return (r.location?.shape?.links || []).map(l => ({ id: r.location.description, name: r.location.description, mph: cf.speed * MPH, ff: cf.freeFlow * MPH, ratio: Math.min(1, cf.speed / cf.freeFlow), coords: l.points.map(p => [p.lng, p.lat]), t: Date.parse(j.sourceUpdated) || t, src: 'HERE' })); }).filter(f => f.coords.length > 1); }
// TomTom flowSegmentData → link feature.
export function parseTomTom(j, t = Date.now()) { const f = j.flowSegmentData; if (!f || !(f.freeFlowSpeed > 0)) return null;
  return { id: 'tt' + f.coordinates.coordinate[0].latitude, name: 'TomTom segment', mph: f.currentSpeed / 1.609344, ff: f.freeFlowSpeed / 1.609344, ratio: Math.min(1, f.currentSpeed / f.freeFlowSpeed), coords: f.coordinates.coordinate.map(c => [c.longitude, c.latitude]), t, src: 'TomTom', closed: !!f.roadClosure }; }
// ---------- Map-matching (Valhalla trace_attributes, shape_match=map_snap) so traffic is drawn on real road geometry ----------
// Densify a sparse link to ~step-metre points for the matcher (Valhalla advises dense traces, search_radius <= 100 m).
export function densify(coords, step = 100) { const out = [];
  for (let i = 0; i < coords.length - 1; i++) { const a = coords[i], b = coords[i + 1], n = Math.max(1, Math.round(haversine(a, b) / step)); for (let j = 0; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); }
  if (coords.length) out.push(coords.at(-1)); return out; }
export const traceRequest = (coords, costing = 'auto') => ({ shape: densify(coords).map(([lon, lat]) => ({ lon: +lon.toFixed(6), lat: +lat.toFixed(6) })), costing, shape_match: 'map_snap',
  trace_options: { search_radius: 60 }, filters: { attributes: ['shape', 'edge.road_class', 'matched.type'], action: 'include' } });
const CLS_RANK = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, service_other: 7 };
// Valhalla response → { coords, cls } or null when the trace didn't match the road network well.
export function parseTrace(j, decode) { if (!j?.shape) return null; const m = j.matched_points || [];
  const unmatched = m.filter(p => p.type === 'unmatched').length; if (m.length && unmatched / m.length > 0.2) return null;
  const coords = decode(j.shape, 6); if (coords.length < 2) return null;
  for (let i = 1; i < coords.length; i++) if (haversine(coords[i - 1], coords[i]) > 1000) return null; // discontinuity
  const cnt = {}; for (const e of j.edges || []) cnt[e.road_class] = (cnt[e.road_class] || 0) + 1;
  const cls = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || (CLS_RANK[a] ?? 9) - (CLS_RANK[b] ?? 9))[0] || 'unknown';
  return { coords, cls }; }
// Colour the route line itself by congestion (UX P7, code D5): MapLibre line-gradient over line-progress (0..1 of the full route).
export function routeGradient(slowdowns, length, base = '#38bdf8') { if (!slowdowns?.length || !(length > 0)) return null;
  const col = { slow: LEVELS[1].color, heavy: LEVELS[2].color, jam: LEVELS[3].color }, eps = 1e-6, stops = [[0, base]];
  for (const s of [...slowdowns].sort((a, b) => a.start - b.start)) { const p0 = Math.max(0, s.start / length), p1 = Math.min(1, s.end / length), c = col[s.level] || base;
    if (p1 <= p0) continue; const last = stops.at(-1)[0];
    if (p0 - eps > last) stops.push([p0 - eps, base]); stops.push([Math.max(p0, stops.at(-1)[0] + eps), c]); stops.push([Math.max(p1, stops.at(-1)[0] + eps), c]);
    if (p1 + eps < 1) stops.push([p1 + eps, base]); }
  if (stops.at(-1)[0] < 1) stops.push([1, stops.at(-1)[1]]);
  return ['interpolate', ['linear'], ['line-progress'], ...stops.filter(x => x[0] <= 1).flat()]; }

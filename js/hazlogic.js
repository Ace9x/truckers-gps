// Live hazard reports — pure logic (no DOM, no network). Unit-tested in test/hazards.test.js.
const R = 6371008.8, rad = d => d * Math.PI / 180;
export function dist(a, b) { const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon), x = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
export function brg(a, b) { const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat)), x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
const M = 60e3, Hr = 3600e3, D = 24 * Hr;
// type -> icon, label, spoken name, lifetime, dedupe radius (m)
export const HZ = {
  camera:       { icon: '📷', label: 'Speed camera', say: 'Speed camera', ttl: 30 * D, r: 120 },
  accident:     { icon: '💥', label: 'Accident', say: 'Accident', ttl: 2 * Hr, r: 250 },
  construction: { icon: '🚧', label: 'Construction', say: 'Construction', ttl: 24 * Hr, r: 300 },
  police:       { icon: '👮', label: 'Police', say: 'Police', ttl: 1 * Hr, r: 300 },
  debris:       { icon: '🪨', label: 'Object on road', say: 'Object on the road', ttl: 45 * M, r: 150 },
  stalled:      { icon: '🚙', label: 'Stalled vehicle', say: 'Stalled vehicle', ttl: 1 * Hr, r: 150 },
  clearance:    { icon: '⛔', label: 'Low clearance', say: 'Low clearance', ttl: 90 * D, r: 80, avoid: true },
  ice:          { icon: '🧊', label: 'Weather / ice', say: 'Ice or bad weather', ttl: 6 * Hr, r: 800 },
  closed:       { icon: '🛑', label: 'Road closed', say: 'Road closed', ttl: 24 * Hr, r: 200, avoid: true },
  weigh_open:   { icon: '🟢', label: 'Scale open', say: 'Weigh station open', ttl: 3 * Hr, r: 400 },
  weigh_closed: { icon: '🔴', label: 'Scale closed', say: 'Weigh station closed', ttl: 3 * Hr, r: 400 },
  hazard:       { icon: '⚠️', label: 'Other hazard', say: 'Hazard', ttl: 2 * Hr, r: 150 },
};
export const HZ_ORDER = ['accident', 'police', 'camera', 'construction', 'debris', 'stalled', 'clearance', 'ice', 'closed', 'weigh_open', 'weigh_closed', 'hazard'];
export const DOWN_REMOVE = 2;           // 2 distinct "not there" votes remove it
export const RATE = { perType: 60e3, windowMs: 10 * M, maxInWindow: 6 }; // my own limits; also applied to each remote reporter

// "Still there" refreshes the clock: report lives ttl after its newest confirmation (capped at 3× ttl from creation)
export function expiresAt(r) { const ttl = HZ[r.type]?.ttl ?? 2 * Hr; return Math.min((r.lastUp || r.t) + ttl, r.t + 3 * ttl); }
export function alive(r, now = Date.now()) { return !r.removed && (r.downs?.length || 0) < DOWN_REMOVE && now < expiresAt(r); }
// fades from 1.0 to 0.35 over its life
export function opacity(r, now = Date.now()) { const s = r.lastUp || r.t, e = expiresAt(r); if (now >= e) return 0; return +Math.max(0.35, 1 - 0.65 * (now - s) / Math.max(1, e - s)).toFixed(3); }

// an existing live report of the same type close enough to be the same thing
export function findDup(list, rep, now = Date.now()) { const rr = HZ[rep.type]?.r ?? 150; return list.find(x => x.id !== rep.id && x.type === rep.type && alive(x, now) && dist(x, rep) <= rr) || null; }

export function applyVote(r, v) { // v: { by, dir:'up'|'down', t }
  if (!r || v.by === r.by) return r; r.ups ||= []; r.downs ||= [];
  r.ups = r.ups.filter(b => b !== v.by); r.downs = r.downs.filter(b => b !== v.by);
  if (v.dir === 'up') { r.ups.push(v.by); r.lastUp = Math.max(r.lastUp || r.t, v.t); } else r.downs.push(v.by);
  r.up = r.ups.length; r.down = r.downs.length; return r;
}

// Merge an incoming report into the store. Returns {added|merged|dropped}
export function ingest(store, rep, now = Date.now()) {
  if (!HZ[rep.type] || !isFinite(rep.lat) || !isFinite(rep.lon)) return { dropped: 'bad' };
  if (store.some(x => x.id === rep.id)) return { dropped: 'seen' };
  if (!alive(rep, now)) return { dropped: 'expired' };
  const d = findDup(store, rep, now);
  if (d) { if (d.by !== rep.by) applyVote(d, { by: rep.by, dir: 'up', t: rep.t }); (d.alias ||= []).push(rep.id); return { merged: d }; }
  store.push({ ups: [], downs: [], up: 0, down: 0, ...rep }); return { added: rep };
}

export class RateLimiter { constructor(o = RATE) { this.o = o; this.log = new Map(); }
  allow(who, type, now = Date.now()) { const l = (this.log.get(who) || []).filter(e => now - e.t < this.o.windowMs);
    if (l.length >= this.o.maxInWindow || l.some(e => e.type === type && now - e.t < this.o.perType)) { this.log.set(who, l); return false; }
    l.push({ type, t: now }); this.log.set(who, l); return true; } }

// ---- geohash ----
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function geohash(lat, lon, p = 5) { let la = [-90, 90], lo = [-180, 180], h = '', bit = 0, ch = 0, even = true;
  while (h.length < p) { const r = even ? lo : la, v = even ? lon : lat, mid = (r[0] + r[1]) / 2; if (v >= mid) { ch |= 16 >> bit; r[0] = mid; } else r[1] = mid; even = !even;
    if (++bit === 5) { h += B32[ch]; bit = 0; ch = 0; } } return h; }
export function ghDecode(h) { let la = [-90, 90], lo = [-180, 180], even = true;
  for (const c of h) { const n = B32.indexOf(c); for (let i = 4; i >= 0; i--) { const r = even ? lo : la, mid = (r[0] + r[1]) / 2; if ((n >> i) & 1) r[0] = mid; else r[1] = mid; even = !even; } }
  return { lat: (la[0] + la[1]) / 2, lon: (lo[0] + lo[1]) / 2, dLat: la[1] - la[0], dLon: lo[1] - lo[0] }; }
export function ghNeighbors(h) { const c = ghDecode(h), out = new Set();
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) out.add(geohash(Math.max(-89.99, Math.min(89.99, c.lat + a * c.dLat)), ((c.lon + b * c.dLon + 540) % 360) - 180, h.length));
  return [...out]; }
export const AREA_P = 4; // ~39 x 20 km cells; drivers listen to their cell + 8 neighbours

// ---- what's ahead ----
// route: {line,cum,along} using a snap fn; otherwise heading cone from pos
export function ahead(list, { pos, heading, route, snap, now = Date.now(), maxM = 1609 * 1.5, coneDeg = 35, offRouteM = 60 }) {
  const out = [];
  for (const r of list) { if (!alive(r, now)) continue; let d;
    if (route && snap) { const s = snap([r.lon, r.lat], route.line, route.cum); if (s.dist > offRouteM) continue; d = s.along - route.along; if (d < 0) continue; }
    else { d = dist(pos, r); if (d < 30) continue; if (heading != null) { const diff = Math.abs(((brg(pos, r) - heading) + 540) % 360 - 180); if (diff > coneDeg) continue; } }
    if (d <= maxM) out.push({ r, d }); }
  return out.sort((a, b) => a.d - b.d);
}
export function spokenDist(m) { const mi = m / 1609.34; if (mi >= 0.9) return `${Math.round(mi * 2) / 2 === 1 ? '1 mile' : Math.round(mi * 2) / 2 + ' miles'}`; if (mi >= 0.2) return `${(Math.round(mi * 4) / 4).toString().replace(/^0/, '')} mile`.replace('.25 mile', 'a quarter mile').replace('.5 mile', 'half a mile').replace('.75 mile', 'three quarters of a mile'); return `${Math.round(m * 3.281 / 50) * 50} feet`; }
export function alertText(r, m) { return `${HZ[r.type].say} reported ahead in ${spokenDist(m)}`; }

// ---- Abuse checks (trust review) ----
export const MAX_REPORT_M = 2000; // a report must be filed within 2 km of where the reporter actually is
export function tooFar(rep) { return rep.rlat == null || rep.rlon == null || !isFinite(rep.rlat) || !isFinite(rep.rlon) || dist(rep, { lat: rep.rlat, lon: rep.rlon }) > MAX_REPORT_M; }
// New reporters (no report of theirs ever confirmed by someone else) are held: shown as "unconfirmed", never alerted, until another driver confirms.
export function held(r, trusted) { return !r.mine && !(r.up > 0) && !trusted.has(r.by); }
export const FLAG_REASONS = { gone: 'Not there anymore', wrong: 'Wrong location', dup: 'Duplicate', abuse: 'Spam or abusive' };

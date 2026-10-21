// Pure, testable navigation + HOS logic (no DOM).
export const R = 6371008.8;
const rad = d => d * Math.PI / 180;

export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Valhalla encoded polyline, precision 6. Returns [[lon,lat],...]
export function decodePolyline(str, precision = 6) {
  let i = 0, lat = 0, lon = 0; const f = 10 ** precision, out = [];
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lon / f, lat / f]);
  }
  return out;
}

// Project point p onto segment a-b in local equirectangular meters.
function projSeg(p, a, b) {
  const kx = Math.cos(rad(p[1])) * R * Math.PI / 180, ky = R * Math.PI / 180;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return { dist: Math.hypot(x, y), t };
}

// cumulative distance along a line
export function cumulative(line) {
  const c = [0];
  for (let i = 1; i < line.length; i++) c.push(c[i - 1] + haversine(line[i - 1], line[i]));
  return c;
}

// Snap position to route. hint = last segment index (search forward window first for perf/robustness).
export function snapToRoute(p, line, cum, hint = 0) {
  let best = { dist: Infinity, seg: 0, along: 0 };
  const scan = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(line.length - 1, to); i++) {
      const r = projSeg(p, line[i], line[i + 1]);
      if (r.dist < best.dist) best = { dist: r.dist, seg: i, along: cum[i] + r.t * (cum[i + 1] - cum[i]) };
    }
  };
  scan(hint - 5, hint + 400);
  if (best.dist > 100) scan(0, line.length);
  return best;
}

// Off-route detector (Ferrostar-style): fixes worse than minAccuracy never count; N consecutive bad fixes needed.
export class OffRouteDetector {
  constructor({ threshold = 50, needed = 3, minAccuracy = 30 } = {}) { Object.assign(this, { threshold, needed, minAccuracy }); this.count = 0; this.ignored = 0; }
  update(distFromRoute, accuracy = 0) {
    if (accuracy && accuracy > this.minAccuracy) { this.ignored++; return false; } // too fuzzy to judge – hold state
    this.count = distFromRoute > this.threshold + (accuracy || 0) ? this.count + 1 : 0;
    return this.count >= this.needed;
  }
  isOff() { return this.count > 0; }
  reset() { this.count = 0; }
}

// maneuvers: [{begin_shape_index, ...}]; returns index of the NEXT maneuver to perform.
export function currentStep(maneuvers, seg) {
  for (let i = 0; i < maneuvers.length; i++) if (maneuvers[i].begin_shape_index > seg) return i;
  return maneuvers.length - 1;
}

// Voice prompt plan. Highway (fast or exit/ramp): 2 mi, 1 mi, 1/4 mi, then at-turn. City: ~1 min out + at-turn.
const MI = 1609.344;
const EXIT_TYPES = new Set([17, 18, 19, 20, 21, 23, 24, 25]);
export function promptFor(distM, speedMps, spoken, type) {
  const near = Math.max(120, (speedMps || 0) * 8);
  if (distM <= near) { if (spoken.near) return null; spoken.near = true; return 'near'; }
  const hwy = (speedMps || 0) > 17 || EXIT_TYPES.has(type);
  const tiers = hwy ? [['2mi', 2 * MI], ['1mi', MI], ['qmi', 0.25 * MI]] : [['far', Math.max(500, (speedMps || 0) * 60)]];
  let pick = null;
  for (const [k, d] of tiers) if (distM <= d && distM > near * 1.2) pick = k; // tightest tier we're inside
  if (!pick || spoken[pick]) return null;
  for (const [k] of tiers) { spoken[k] = true; if (k === pick) break; } // never speak a bigger tier after a smaller one
  return pick;
}

// Pick "through" via points on the driver's chosen route ahead of `along` so a reroute rejoins THEIR route.
export function rejoinVias(line, cum, along, { ahead = 2500, max = 3 } = {}) {
  const total = cum[cum.length - 1], start = along + ahead; if (start >= total - 1500) return [];
  const out = [], span = (total - 1500 - start) / Math.max(1, max - 1);
  for (let k = 0; k < max; k++) { const d = start + k * span; const i = cum.findIndex(c => c >= d); if (i > 0) out.push(line[i]); if (span <= 0) break; }
  return out;
}

// Small square (meters) around a point, as [[lon,lat],...] ring for Valhalla exclude_polygons
export function squarePolygon(lon, lat, m = 30) {
  const dLat = m / 111320, dLon = m / (111320 * Math.cos(rad(lat)));
  return [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]];
}

// Point at distance d along a line
export function pointAlong(line, cum, d) { const i = cum.findIndex(c => c >= d); if (i <= 0) return i === 0 ? line[0] : line[line.length - 1];
  const t = (d - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]); return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; }

// Rough stop detour: off-route distance there and back at ~25 mph + 2 min to get on/off the highway.
export function detourMinutes(offM) { return Math.max(1, Math.round((2 * offM) / 11.2 / 60 + (offM > 150 ? 2 : 0))); }

// Label route alternatives: why would a driver pick this one?
export function labelAlternatives(routes, car) {
  if (!routes.length) return [];
  const fastest = Math.min(...routes.map(r => r.time)), shortest = Math.min(...routes.map(r => r.length)), turns = Math.min(...routes.map(r => r.maneuvers.length));
  return routes.map((r, i) => {
    const why = [];
    if (r.time === fastest) why.push('Fastest');
    if (r.length === shortest) why.push('Shortest');
    if (r.maneuvers.length === turns) why.push('Fewest turns');
    if (!r.summary?.has_toll && routes.some(x => x.summary?.has_toll)) why.push('No tolls');
    if (r.summary?.has_toll) why.push('Has tolls');
    if (r.summary?.has_ferry) why.push('Ferry');
    const extra = r.time - fastest; if (extra > 60) why.push(`+${Math.round(extra / 60)} min`);
    if (car) { const d = (r.length - car.length) / MI; if (d > 0.3) why.push(`${d.toFixed(d < 10 ? 1 : 0)} mi longer than car route (truck restrictions)`); else why.push('Same as car route'); }
    return why;
  });
}

// Slippy tiles covering a route corridor (for offline prefetch)
export function tilesForLine(line, zooms = [10, 12, 14], padTiles = 1) {
  const set = new Set();
  for (const z of zooms) { const n = 2 ** z;
    const pts = [], src = sampleLine(line, Math.min(line.length, 800)), stepDeg = 180 / n; // densify so no tile gaps
    for (let i = 0; i < src.length; i++) { pts.push(src[i]); if (i + 1 < src.length) { const k = Math.ceil(Math.max(Math.abs(src[i + 1][0] - src[i][0]), Math.abs(src[i + 1][1] - src[i][1])) / stepDeg); for (let j = 1; j < k; j++) pts.push([src[i][0] + (src[i + 1][0] - src[i][0]) * j / k, src[i][1] + (src[i + 1][1] - src[i][1]) * j / k]); } }
    for (const [lon, lat] of pts) {
      const x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n);
      for (let dx = -padTiles; dx <= padTiles; dx++) for (let dy = -padTiles; dy <= padTiles; dy++) set.add(`${z}/${x + dx}/${y + dy}`); } }
  return [...set];
}

export function fmtDist(m, units = 'mi') {
  if (units === 'km') return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  const ft = m * 3.28084; if (ft < 1000) return `${Math.round(ft / 50) * 50} ft`;
  const mi = m / 1609.344; return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}
export function fmtDur(s) {
  s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

// Truck profile (imperial UI) -> Valhalla truck costing options (metric).
export function truckCosting(p) {
  const o = {
    height: +(p.heightFt * 0.3048 + (p.heightIn || 0) * 0.0254).toFixed(2),
    width: +(p.widthFt * 0.3048).toFixed(2),
    length: +(p.lengthFt * 0.3048).toFixed(2),
    weight: +(p.weightLbs * 0.000453592).toFixed(2),
    axle_load: +Math.min(9.07, (p.weightLbs / Math.max(2, p.axles || 5)) * 0.000453592 * 1.25).toFixed(2), // heaviest axle ≈ 1.25× average, capped at 20k lb legal single axle
    axle_count: p.axles || 5,
    hazmat: !!p.hazmat,
    use_tolls: p.avoidTolls ? 0 : 0.5,
    use_highways: 1,
    use_truck_route: 0.8,      // prefer designated truck routes
    low_class_penalty: 60,     // keep big rigs off residential/service roads
    hgv_no_access_penalty: 1e6,
  };
  return o;
}

// ===== Hours of Service helper (US FMCSA property-carrying: 11h drive, 14h window, 30-min break after 8h driving, 10h reset). =====
// events: [{t:ms, s:'off'|'sb'|'on'|'drive'}], chronological. Returns remaining limits at time `now`.
export const H = 3600e3;
export function hosStatus(events, now = Date.now(), opts = {}) {
  const ev = events.filter(e => e.t <= now).sort((a, b) => a.t - b.t);
  // find start of shift: last end of >=10h consecutive off/sleeper
  let shiftStart = null, restStart = null;
  const segs = ev.map((e, i) => ({ s: e.s, a: e.t, b: i + 1 < ev.length ? ev[i + 1].t : now }));
  // merge rest blocks
  let lastResetEnd = -Infinity;
  for (const g of segs) {
    const rest = g.s === 'off' || g.s === 'sb';
    if (rest) { if (restStart === null) restStart = g.a; if (g.b - restStart >= 10 * H) lastResetEnd = g.b; }
    else restStart = null;
  }
  const after = segs.filter(g => g.b > lastResetEnd).map(g => ({ ...g, a: Math.max(g.a, lastResetEnd) }));
  let drive = 0, sinceBreakDrive = 0, breakRun = 0;
  for (const g of after) {
    const d = g.b - g.a;
    if (shiftStart === null && (g.s === 'on' || g.s === 'drive')) shiftStart = g.a;
    if (g.s === 'drive') { drive += d; sinceBreakDrive += d; breakRun = 0; }
    else { breakRun += d; if (breakRun >= 0.5 * H) sinceBreakDrive = 0; }
  }
  const cur = ev.length ? ev[ev.length - 1].s : 'off';
  // 70-hour / 8-day cycle (60/7 if cycle=60) with 34-hour restart
  const cycH = (opts.cycle || 70) * H, days = opts.cycle === 60 ? 7 : 8;
  let lastRestart = -Infinity, rs = null;
  for (const g of segs) { const rest = g.s === 'off' || g.s === 'sb'; if (rest) { if (rs === null) rs = g.a; if (g.b - rs >= 34 * H) lastRestart = g.b; } else rs = null; }
  const from = Math.max(now - days * 24 * H, lastRestart); let onDuty = 0;
  for (const g of segs) if (g.s === 'on' || g.s === 'drive') { const a = Math.max(g.a, from), b = g.b; if (b > a) onDuty += b - a; }
  const cycleLeft = Math.max(0, cycH - onDuty);
  const windowLeft = shiftStart === null ? 14 * H : Math.max(0, shiftStart + 14 * H - now);
  const driveLeftRaw = Math.max(0, Math.min(11 * H - drive, windowLeft));
  const breakLeft = Math.max(0, 8 * H - sinceBreakDrive);
  const driveLeft = Math.min(driveLeftRaw, cycleLeft);
  const warnings = [];
  if (driveLeft <= 0) warnings.push('11-hour driving limit reached'); else if (driveLeft < H) warnings.push('Under 1 hour of driving left');
  if (shiftStart !== null && windowLeft <= 0) warnings.push('14-hour duty window ended'); else if (shiftStart !== null && windowLeft < H) warnings.push('14-hour window closes in under 1 hour');
  if (breakLeft <= 0) warnings.push('30-minute break required now'); else if (breakLeft < 0.5 * H) warnings.push('30-minute break due soon');
  if (cycleLeft <= 0) warnings.push(`${opts.cycle || 70}-hour cycle used up — 34-hour restart needed`); else if (cycleLeft < 3 * H) warnings.push(`Under 3 hours left on your ${opts.cycle || 70}-hour cycle`);
  return { status: cur, cycleLeft, cycleUsed: onDuty, driveUsed: drive, driveLeft, windowLeft, breakLeft, shiftStarted: shiftStart, warnings };
}

// Sample a line to ~n points for Overpass "around" polyline queries.
export function sampleLine(line, n = 80) {
  if (line.length <= n) return line;
  const step = (line.length - 1) / (n - 1), out = [];
  for (let i = 0; i < n; i++) out.push(line[Math.round(i * step)]);
  return out;
}

export function overpassQuery(line, radius = 1500) {
  const pts = sampleLine(line, 70).map(([lo, la]) => `${la.toFixed(5)},${lo.toFixed(5)}`).join(',');
  const a = `(around:${radius},${pts})`;
  return `[out:json][timeout:25];(
nwr["amenity"="fuel"]["hgv"!="no"]${a};
nwr["highway"="rest_area"]${a};
nwr["highway"="services"]${a};
nwr["amenity"="parking"]["hgv"~"yes|designated"]${a};
nwr["amenity"="weighbridge"]${a};
nwr["highway"="weigh_station"]${a};
nwr["hgv"="weigh_station"]${a};
nwr["amenity"="shower"]${a};
nwr["amenity"~"^(restaurant|fast_food)$"](around:350,${pts});
nwr["amenity"="toilets"](around:350,${pts});
);out center tags 700;`;
}

export function classifyPoi(tags = {}) {
  if (tags.amenity === 'weighbridge' || tags.highway === 'weigh_station' || tags.hgv === 'weigh_station') return 'weigh';
  if (tags.highway === 'rest_area') return 'rest';
  if (tags.amenity === 'parking') return 'parking';
  if (tags.highway === 'services') return 'stop';
  if (tags.amenity === 'fuel') return (tags.hgv === 'yes' || tags['fuel:HGV_diesel'] === 'yes' || /pilot|flying j|love'?s|ta |travelcenters|petro|speedway|sapp/i.test(tags.name || tags.brand || '')) ? 'stop' : 'fuel';
  return 'other';
}

// ===== Voice text normalization: make road names sound like a human co-pilot =====
const ABBR = { Tpke: 'Turnpike', Tpk: 'Turnpike', Pkwy: 'Parkway', Expy: 'Expressway', Expwy: 'Expressway', Hwy: 'Highway', Fwy: 'Freeway', Blvd: 'Boulevard',
  Ave: 'Avenue', St: 'Street', Rd: 'Road', Dr: 'Drive', Ln: 'Lane', Ct: 'Court', Pl: 'Place', Sq: 'Square', Br: 'Bridge', Brg: 'Bridge', Tunl: 'Tunnel', Cir: 'Circle',
  Ter: 'Terrace', Hts: 'Heights', Mt: 'Mount', Ft: 'Fort', Svc: 'Service', Rte: 'Route', Rt: 'Route', Ext: 'Extension', Cswy: 'Causeway', Twp: 'Township', Jct: 'Junction' };
const DIRS = { N: 'North', S: 'South', E: 'East', W: 'West', NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest' };
const STATES = { NJ: 'New Jersey', NY: 'New York', PA: 'Pennsylvania', CT: 'Connecticut', MA: 'Massachusetts', DE: 'Delaware', MD: 'Maryland', VA: 'Virginia', RI: 'Rhode Island', VT: 'Vermont', NH: 'New Hampshire', ME: 'Maine', OH: 'Ohio', WV: 'West Virginia', NC: 'North Carolina' };
export function speakable(t) {
  if (!t) return t;
  let s = String(t);
  s = s.replace(/\bInterstate\s+(\d)\s+(\d{2})\b/g, 'Interstate $1$2'); // Valhalla's "Interstate 2 78"
  s = s.replace(/\b(?:I|IH)[- ]?(\d{1,3})\b/g, 'Interstate $1');
  s = s.replace(/\bUS[- ]?(\d{1,3}[A-Z]?)\b/g, 'U.S. Route $1');
  s = s.replace(/\bCR[- ]?(\d{1,4})\b/g, 'County Route $1');
  s = s.replace(/\b(NJ|NY|PA|CT|MA|DE|MD|VA|RI|VT|NH|ME|OH|WV|NC|SR)[- ]?(\d{1,4}[A-Z]?)\b/g, (_, st, n) => (st === 'SR' ? 'State Route' : (STATES[st] + ' Route')) + ' ' + n);
  s = s.replace(/\bNJTP\b|\bNJ Tpke\b/g, 'New Jersey Turnpike');
  s = s.replace(/\b([A-Z][a-z]{1,4})\b/g, (m, w) => ABBR[w] ? ABBR[w] : m);
  s = s.replace(/(^|[\s(\/])(N|S|E|W|NE|NW|SE|SW)(?=[\s.,)\/]|$)/g, (m, pre, d) => pre + DIRS[d]);
  s = s.replace(/(\d)\/(\d)/g, '$1 or $2').replace(/\s{2,}/g, ' ').trim();
  return s;
}

export function encodePolyline(coords, precision = 6) { // [[lon,lat]] -> Valhalla polyline6
  const f = 10 ** precision; let pl = 0, pn = 0, out = '';
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lon, lat] of coords) { const la = Math.round(lat * f), lo = Math.round(lon * f); out += enc(la - pl) + enc(lo - pn); pl = la; pn = lo; }
  return out;
}

// ===== Driver amenities: showers / restrooms / food from real OSM tags (+ chain standard, + nearby amenity nodes, + driver confirmations) =====
export const SHOWER_CHAINS = /pilot|flying j|love'?s|travelcenters|\bta\b|petro|sapp|ambest|am best|kwik ?trip|bucky|iowa 80|roady'?s/i;
export const isHelperAmenity = t => ['restaurant', 'fast_food', 'cafe', 'shower', 'toilets'].includes(t?.amenity) && !t.highway;
export function amenitiesOf(tags = {}, kind = '') {
  const yes = v => v && v !== 'no'; const nm = `${tags.name || ''} ${tags.brand || ''} ${tags.operator || ''}`;
  const chain = (kind === 'stop' || tags.amenity === 'fuel' || tags.highway === 'services') && SHOWER_CHAINS.test(nm);
  const a = { showers: yes(tags.shower) || tags.amenity === 'shower' ? 'tagged' : chain ? 'chain' : null,
    restrooms: yes(tags.toilets) || tags.amenity === 'toilets' ? 'tagged' : (tags.highway === 'rest_area' || tags.highway === 'services') ? 'rest area' : chain ? 'chain' : null,
    food: ['restaurant', 'fast_food', 'cafe'].includes(tags.amenity) || yes(tags.food) || yes(tags.restaurant) ? 'tagged' : chain ? 'chain' : null, foodNames: [] };
  a.restrooms24 = !!a.restrooms && (tags['toilets:opening_hours'] === '24/7' || tags.opening_hours === '24/7');
  return a;
}
// Merge helper amenity elements (shower/toilets/food nodes) within maxM of each stop
export function attachAmenities(pois, helpers, maxM = 250, confirmations = {}) {
  for (const p of pois) { p.amen = amenitiesOf(p.tags, p.kind);
    for (const h of helpers) { if (Math.abs(h.lat - p.lat) > 0.004 || Math.abs(h.lon - p.lon) > 0.005 || haversine([h.lon, h.lat], [p.lon, p.lat]) > maxM) continue;
      const t = h.tags || {}; if (t.amenity === 'shower') p.amen.showers = 'nearby';
      if (t.amenity === 'toilets') { p.amen.restrooms ||= 'nearby'; if (t.opening_hours === '24/7') p.amen.restrooms24 = true; }
      if (['restaurant', 'fast_food', 'cafe'].includes(t.amenity)) { p.amen.food ||= 'nearby'; if (t.name && p.amen.foodNames.length < 3 && !p.amen.foodNames.includes(t.name)) p.amen.foodNames.push(t.name); } }
    const c = confirmations[p.id] || {}; for (const k of ['showers', 'restrooms', 'food']) { if (c[k] === true) p.amen[k] = 'driver-confirmed'; else if (c[k] === false) p.amen[k] = null; } }
  return pois;
}
export function amenityLine(a) { if (!a) return ''; const o = [];
  if (a.showers) o.push('🚿 Showers'); if (a.restrooms) o.push(a.restrooms24 ? '🚻 Restrooms 24h' : '🚻 Restrooms'); if (a.food) o.push('🍔 Food' + (a.foodNames?.length ? ` (${a.foodNames.join(', ')})` : ''));
  return o.join(' · '); }
export function nextWithAmenity(pois, along, key, kinds = ['stop', 'rest', 'parking', 'fuel']) { return pois.filter(p => p.along > along && kinds.includes(p.kind) && p.amen?.[key] && p.off < 1700).sort((a, b) => a.along - b.along)[0] || null; }

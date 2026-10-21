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

// Off-route detector: needs N consecutive fixes beyond threshold (accounts for GPS accuracy).
export class OffRouteDetector {
  constructor({ threshold = 60, needed = 3 } = {}) { this.threshold = threshold; this.needed = needed; this.count = 0; }
  update(distFromRoute, accuracy = 0) {
    const thr = this.threshold + Math.min(accuracy || 0, 100);
    this.count = distFromRoute > thr ? this.count + 1 : 0;
    return this.count >= this.needed;
  }
  reset() { this.count = 0; }
}

// maneuvers: [{begin_shape_index, ...}]; returns index of the NEXT maneuver to perform.
export function currentStep(maneuvers, seg) {
  for (let i = 0; i < maneuvers.length; i++) if (maneuvers[i].begin_shape_index > seg) return i;
  return maneuvers.length - 1;
}

// Voice prompt thresholds (meters) – scale with speed like pro nav units.
export function promptFor(distM, speedMps, spoken) {
  const far = Math.max(800, speedMps * 60), near = Math.max(150, speedMps * 12);
  if (distM <= near && !spoken.near) return 'near';
  if (distM <= far && distM > near * 1.5 && !spoken.far) return 'far';
  return null;
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
    axle_load: +((p.weightLbs / Math.max(2, p.axles || 5)) * 0.000453592).toFixed(2),
    axle_count: p.axles || 5,
    hazmat: !!p.hazmat,
    use_tolls: p.avoidTolls ? 0 : 0.5,
    use_highways: 1,
  };
  return o;
}

// ===== Hours of Service helper (US FMCSA property-carrying: 11h drive, 14h window, 30-min break after 8h driving, 10h reset). =====
// events: [{t:ms, s:'off'|'sb'|'on'|'drive'}], chronological. Returns remaining limits at time `now`.
export const H = 3600e3;
export function hosStatus(events, now = Date.now()) {
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
  const windowLeft = shiftStart === null ? 14 * H : Math.max(0, shiftStart + 14 * H - now);
  const driveLeft = Math.max(0, Math.min(11 * H - drive, windowLeft));
  const breakLeft = Math.max(0, 8 * H - sinceBreakDrive);
  const warnings = [];
  if (driveLeft <= 0) warnings.push('11-hour driving limit reached'); else if (driveLeft < H) warnings.push('Under 1 hour of driving left');
  if (shiftStart !== null && windowLeft <= 0) warnings.push('14-hour duty window ended'); else if (shiftStart !== null && windowLeft < H) warnings.push('14-hour window closes in under 1 hour');
  if (breakLeft <= 0) warnings.push('30-minute break required now'); else if (breakLeft < 0.5 * H) warnings.push('30-minute break due soon');
  return { status: cur, driveUsed: drive, driveLeft, windowLeft, breakLeft, shiftStarted: shiftStart, warnings };
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
);out center tags 300;`;
}

export function classifyPoi(tags = {}) {
  if (tags.amenity === 'weighbridge' || tags.highway === 'weigh_station' || tags.hgv === 'weigh_station') return 'weigh';
  if (tags.highway === 'rest_area') return 'rest';
  if (tags.amenity === 'parking') return 'parking';
  if (tags.highway === 'services') return 'stop';
  if (tags.amenity === 'fuel') return (tags.hgv === 'yes' || tags['fuel:HGV_diesel'] === 'yes' || /pilot|flying j|love'?s|ta |travelcenters|petro|speedway|sapp/i.test(tags.name || tags.brand || '')) ? 'stop' : 'fuel';
  return 'other';
}

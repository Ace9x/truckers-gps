// Weigh-station avoidance. Pure functions: no DOM, no network.
// Data is OpenStreetMap (amenity=weighbridge, highway=weigh_station). Open/closed is never guessed.
import { snapToRoute, pointAlong, squarePolygon, haversine, bearing } from './logic.js';

const MI = 1609.344;

export function isWeighTags(tags = {}) {
  return tags.amenity === 'weighbridge' || tags.highway === 'weigh_station' || tags.hgv === 'weigh_station';
}
// Highway inspection stations, not a CAT scale sitting in a truck-stop lot.
// Unnamed weighbridges count only when they are on the road itself (the extract often leaves the state scale unnamed).
export function avoidableScale(tags = {}, offM = Infinity) {
  if (tags.highway === 'weigh_station' || tags.hgv === 'weigh_station') return offM <= 800;
  if (!isWeighTags(tags)) return false;
  const name = String(tags.name || '');
  if (/cat scale/i.test(name)) return offM <= 70;
  if (/quarry|scale lane/i.test(name)) return false;
  if (/weigh|scale|inspection|contrôle/i.test(name)) return offM <= 800;
  return offM <= 200;
}

// Scales sitting on this route (not a station miles off on another road).
export function scalesOnRoute(pois, line, cum, { maxOffM = 550, minAlong = 600, endPad = 800 } = {}) {
  if (!line?.length || !cum?.length) return [];
  const total = cum[cum.length - 1];
  const hit = [];
  for (const p of pois || []) {
    if (!isWeighTags(p.tags || {})) continue;
    if (p.lon == null || p.lat == null) continue;
    const sn = snapToRoute([p.lon, p.lat], line, cum, 0);
    if (sn.dist > maxOffM || !avoidableScale(p.tags || {}, sn.dist) || sn.along < minAlong || sn.along > total - endPad) continue;
    hit.push({ id: p.id || `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, lon: p.lon, lat: p.lat, name: p.tags?.name || p.name || 'Weigh station', along: sn.along, off: sn.dist });
  }
  hit.sort((a, b) => a.along - b.along);
  const out = [];
  for (const s of hit) { if (out.some(o => Math.abs(o.along - s.along) < 1200 && haversine([o.lon, o.lat], [s.lon, s.lat]) < 1500)) continue; out.push(s); }
  return out;
}

// Squares along the highway from `beforeM` ahead of the scale back to just past it,
// plus one square on the station itself. The router has to leave before the first square.
export function corridorSquares(line, cum, along, { beforeM = 2 * MI, afterM = 0.45 * MI, radiusM = 170, stepM = 500, minFrom = 0, lon = null, lat = null } = {}) {
  const total = cum[cum.length - 1];
  const from = Math.max(minFrom, along - beforeM);
  const to = Math.min(total, along + afterM);
  const polys = [];
  if (to - from >= 400) {
    for (let d = from; d <= to + 1; d += stepM) {
      const p = pointAlong(line, cum, Math.min(d, to));
      polys.push(squarePolygon(p[0], p[1], radiusM));
    }
  }
  if (lon != null && lat != null) polys.push(squarePolygon(lon, lat, 220));
  return polys;
}

function offsetPoint(lon, lat, brgDeg, m) {
  const br = brgDeg * Math.PI / 180;
  return [lon + (m * Math.sin(br)) / (111320 * Math.cos(lat * Math.PI / 180)), lat + (m * Math.cos(br)) / 111320];
}
export function ringPerimeter(ring) { let p = 0; for (let i = 1; i < ring.length; i++) p += haversine(ring[i - 1], ring[i]); return p; }
// One ring around the highway stretch. Valhalla's free server rejects exclude polygons whose circumference totals over 10 km.
export function corridorRing(line, cum, fromM, toM, halfM = 140) {
  const pts = [];
  for (let d = fromM; d <= toM; d += 500) pts.push(pointAlong(line, cum, Math.min(d, toM)));
  const end = pointAlong(line, cum, toM);
  if (!pts.length || haversine(pts.at(-1), end) > 40) pts.push(end);
  if (pts.length < 2) return null;
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const brg = bearing(a, b);
    left.push(offsetPoint(pts[i][0], pts[i][1], brg - 90, halfM));
    right.push(offsetPoint(pts[i][0], pts[i][1], brg + 90, halfM));
  }
  const ring = [...left, ...right.reverse()]; ring.push(ring[0]);
  return ring;
}
export function corridorsFor(scales, line, cum, opts = {}) {
  const polys = []; let used = 0; const budget = 9500;
  for (const s of (scales || []).slice(0, 4)) {
    let before = opts.beforeM ?? 2 * MI, ring = null, peri = Infinity;
    const after = opts.afterM ?? 0.4 * MI, half = opts.halfM ?? 140;
    while (before >= MI) {
      const from = Math.max(opts.minFrom || 0, s.along - before);
      const to = Math.min(cum[cum.length - 1], s.along + after);
      ring = to - from >= 800 ? corridorRing(line, cum, from, to, half) : null;
      peri = ring ? ringPerimeter(ring) : Infinity;
      if (used + peri <= budget) break;
      before -= 350;
    }
    if (ring && peri <= budget - used && before >= MI) { polys.push(ring); used += peri; }
  }
  return polys;
}

// A route still goes through a scale when the station snaps onto it.
export function scalesStillHit(route, scales, maxOffM = 420) {
  if (!route?.line || !scales?.length) return [];
  return scales.filter(s => snapToRoute([s.lon, s.lat], route.line, route.cum, 0).dist <= maxOffM);
}

// NY/CT parkways are no-truck. Garden State is not in that ban. Used to reject a detour that dodged a scale onto a banned road.
const PK = /\b(Saw Mill|Hutchinson|Taconic|Palisades|Belt|Cross Island|Grand Central|Northern State|Southern State|Meadowbrook|Wantagh|Interboro|Jackie Robinson|Mosholu|Henry Hudson|Bronx River|Cross County|Sprain Brook|Merritt|Wilbur Cross)\b.*\b(Parkway|Pkwy)\b|\b(Parkway|Pkwy)\b.*\b(Saw Mill|Hutchinson|Taconic|Palisades|Belt|Merritt)\b/i;
// How far before the scale the avoid-route leaves the through-route. ok when it is at least minBeforeM earlier and the avoid route does not pass the scale.
export function leavesBefore(through, avoid, scale, minBeforeM = 1609) {
  if (!through?.line || !avoid?.line || !scale) return { ok: false, reason: 'missing' };
  const hit = snapToRoute([scale.lon, scale.lat], avoid.line, avoid.cum, 0);
  if (hit.dist < 400) return { ok: false, reason: 'still hits', dist: Math.round(hit.dist), gap: 0 };
  let lastClose = 0;
  for (let i = 0; i < avoid.line.length; i += 4) {
    const sn = snapToRoute(avoid.line[i], through.line, through.cum, 0);
    if (sn.dist < 280 && sn.along < scale.along - 150) lastClose = sn.along;
  }
  const gap = scale.along - lastClose;
  return { ok: gap >= minBeforeM, gap: Math.round(gap), dist: Math.round(hit.dist) };
}

export function usesNoTruckRoad(route) {
  const txt = (route?.maneuvers || []).map(m => [...(m.street_names || []), m.instruction || ''].join(' ')).join(' | ');
  return PK.test(txt);
}

// Pick the fastest scale-free route. A huge detour is offered, not forced.
// huge: more than 20 minutes, or more than 25% and at least 12 minutes, or more than 25 miles.
export function avoidDecision(through, avoid, { delayThrough = 0, delayAvoid = 0 } = {}) {
  if (!through) return { pick: 'none' };
  if (!avoid) return { pick: 'through', reason: 'none', extraMin: null, extraMi: null, huge: false };
  const tSec = through.time + (delayThrough || 0), aSec = avoid.time + (delayAvoid || 0);
  const extraMin = Math.round((aSec - tSec) / 60);
  const extraMi = +((avoid.length - through.length) / MI).toFixed(1);
  const lenRatio = avoid.length / Math.max(1, through.length);
  const huge = extraMin > 20 || (extraMin > 12 && aSec > tSec * 1.25) || extraMi > 25 || (extraMi > 6 && lenRatio > 1.4);
  if (extraMin <= 0) return { pick: 'avoid', reason: 'faster', extraMin, extraMi, huge: false };
  if (huge) return { pick: 'through', reason: 'huge', extraMin, extraMi, huge: true };
  return { pick: 'avoid', reason: 'ok', extraMin, extraMi, huge: false };
}

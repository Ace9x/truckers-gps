// Real truck routes that pass a known scale: through vs avoid. Free Valhalla + OSM extract. No paid APIs.
import fs from 'node:fs';
import { decodePolyline, cumulative, costingOptions, snapToRoute } from '../js/logic.js';
import { scalesOnRoute, corridorsFor, scalesStillHit, leavesBefore, usesNoTruckRoad } from '../js/weighlogic.js';

const j = JSON.parse(fs.readFileSync('data/truck-pois-northeast.geojson', 'utf8'));
const pois = j.features.map(f => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], tags: f.properties, id: f.properties.osm }));
const truck = { vehicle: 'semi', heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, hazmat: false };
const TRIPS = [
  { name: 'I-95 DE→PA (Chester scale)', from: { lat: 39.830, lon: -75.400 }, to: { lat: 39.905, lon: -75.310 } },
  { name: 'I-80 PA→NJ (Knowlton scale)', from: { lat: 40.985, lon: -75.25 }, to: { lat: 40.90, lon: -74.70 } },
  { name: 'I-81 PA Harrisburg→Scranton', from: { lat: 40.26, lon: -76.88 }, to: { lat: 41.41, lon: -75.66 } },
];
function merge(trip) {
  const ln = [], man = [];
  for (const leg of trip.legs) { const pts = decodePolyline(leg.shape); const off = ln.length ? ln.length - 1 : 0;
    const ms = leg.maneuvers.map(m => ({ ...m, begin_shape_index: m.begin_shape_index + off }));
    if (ln.length) pts.shift(); ln.push(...pts); man.push(...ms); }
  return { line: ln, cum: cumulative(ln), maneuvers: man, length: trip.summary.length * 1000, time: trip.summary.time };
}
async function route(from, to, exclude) {
  const body = { locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }], costing: 'truck', units: 'kilometers', costing_options: costingOptions(truck, { from, to }) };
  if (exclude?.length) body.exclude_polygons = exclude;
  const r = await fetch('https://valhalla1.openstreetmap.de/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const js = await r.json(); if (!r.ok || !js.trip) throw new Error(js.error || r.status);
  return merge(js.trip);
}
let fail = 0;
for (const t of TRIPS) {
  const through = await route(t.from, t.to);
  const scales = scalesOnRoute(pois, through.line, through.cum);
  if (!scales.length) {
    let best = null;
    for (const p of pois) {
      if (!/weigh|scale|knowlton|chester/i.test(p.tags?.name || '')) continue;
      const sn = snapToRoute([p.lon, p.lat], through.line, through.cum, 0);
      if (!best || sn.dist < best.dist) best = { name: p.tags.name, dist: Math.round(sn.dist) };
    }
    const via = [...new Set(through.maneuvers.flatMap(m => m.street_names || []))].slice(0, 8);
    console.log('  nearest named', best, 'via', via.join(' / '));
  }
  const ex = corridorsFor(scales, through.line, through.cum);
  let avoid = null, err = '';
  try { avoid = await route(t.from, t.to, ex); } catch (e) { err = e.message; }
  const hit = scalesStillHit(avoid || { line: [], cum: [] }, scales);
  const left = avoid && scales[0] ? leavesBefore(through, avoid, scales[0]) : null;
  const ban = avoid ? usesNoTruckRoad(avoid) : false;
  const ok = scales.length > 0 && avoid && !hit.length && left?.ok && !ban;
  if (!ok) fail++;
  console.log((ok ? 'ok  ' : 'FAIL') + ` ${t.name} scales=${scales.length} (${scales.map(s => s.name).slice(0, 3).join('; ')}) through=${(through.length / 1000).toFixed(1)}km ${Math.round(through.time / 60)}min avoid=${avoid ? (avoid.length / 1000).toFixed(1) + 'km ' + Math.round(avoid.time / 60) + 'min' : 'NONE ' + err} leave=${left ? (left.gap / 1609).toFixed(1) + 'mi before dist=' + left.dist + 'm' : '-'} ban=${ban}`);
}
process.exit(fail ? 1 : 0);

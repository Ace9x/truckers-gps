// Direct Valhalla proof that a coast-to-coast truck route stitches under the 1,500 km cap.
import { corridorPoints, stitchRoutes, LEG_M } from '../js/routelong.js';
import { haversine, cumulative, decodePolyline, costingOptions } from '../js/logic.js';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const truck = { heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, hazmat: false };
async function once(a, b) {
  const body = { locations: [{ lat: a.lat, lon: a.lon, radius: 3000 }, { lat: b.lat, lon: b.lon }], costing: 'truck', units: 'kilometers', costing_options: { truck: costingOptions(truck, { from: a, to: b }).truck || costingOptions(truck, { from: a, to: b }) }, directions_options: { units: 'kilometers' } };
  const co = costingOptions(truck, { from: a, to: b });
  body.costing_options = co;
  const r = await fetch(VALHALLA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.trip) throw new Error(j.error || 'no route');
  const leg = j.trip.legs[0];
  const line = decodePolyline(leg.shape);
  return { line, maneuvers: leg.maneuvers, length: j.trip.summary.length * 1000, time: j.trip.summary.time };
}
async function hop(a, b, depth = 0) {
  try { return await once(a, b); }
  catch (e) {
    if (!/distance/i.test(e.message) || depth > 4) throw e;
    const mid = corridorPoints(a, b, haversine([a.lon, a.lat], [b.lon, b.lat]) / 2)[1];
    return stitchRoutes([await hop(a, mid, depth + 1), await hop(mid, b, depth + 1)]);
  }
}
async function trip(name, from, to) {
  const seq = corridorPoints(from, to, LEG_M);
  const parts = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const d = Math.round(haversine([seq[i].lon, seq[i].lat], [seq[i + 1].lon, seq[i + 1].lat]) / 1000);
    process.stdout.write(`${name} hop ${i + 1}/${seq.length - 1} ${d} km straight... `);
    const t0 = Date.now();
    parts.push(await hop(seq[i], seq[i + 1]));
    console.log(`${Math.round(parts.at(-1).length / 1000)} km road in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const st = stitchRoutes(parts); st.cum = cumulative(st.line);
  console.log(name, { km: Math.round(st.length / 1000), min: Math.round(st.time / 60), turns: st.maneuvers.length, chained: st.chained, hops: parts.length });
  return st;
}
const queens = { lat: 40.7282, lon: -73.7949 };
const la = await trip('Queens-LA', queens, { lat: 34.0522, lon: -118.2437 });
const sea = await trip('Miami-Seattle', { lat: 25.7617, lon: -80.1918 }, { lat: 47.6062, lon: -122.3321 });
if (la.length < 3500e3 || sea.length < 4000e3) process.exit(1);

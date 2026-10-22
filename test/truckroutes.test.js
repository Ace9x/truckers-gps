import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import { buildIndex, nearestRoute, offTruckRoute, inNYC } from '../js/truckroutes.js';
const ix = buildIndex(JSON.parse(readFileSync(new URL('../data/nyc-truck-routes.json', import.meta.url))));
test('real NYC DOT truck-route data loads (Through + Local)', () => { assert.ok(ix.segs.length > 30000); assert.ok(ix.segs.some(s => s.t === 'T') && ix.segs.some(s => s.t === 'L')); });
test('Jerome Ave (Bronx) is a truck route; a quiet residential block is not', () => {
  const j = nearestRoute(ix, -73.90645, 40.85480); assert.ok(j, 'Jerome Ave'); assert.match(j.name, /Jerome/);
  assert.equal(nearestRoute(ix, -73.96680, 40.78530), null, 'inside Central Park, no truck route'); });
test('route check flags off-truck-route stretches inside NYC, exempting origin/destination access', () => {
  const A = [-73.9735, 40.7700], B = [-73.9580, 40.7980], line = [], cum = [0]; for (let i = 0; i <= 200; i++) { line.push([A[0] + (B[0] - A[0]) * i / 200, A[1] + (B[1] - A[1]) * i / 200]); if (i) { const p = line[i - 1], q = line[i]; cum.push(cum.at(-1) + Math.hypot((q[0] - p[0]) * Math.cos(40.78 * Math.PI / 180), q[1] - p[1]) * 111320); } }
  const off = offTruckRoute(ix, line, cum, { exemptM: 200 }); assert.ok(off.length >= 1 && off.some(o => o.len >= 300), 'Central Park diagonal is off truck routes: ' + JSON.stringify(off.map(o => Math.round(o.len))));
  assert.deepEqual(offTruckRoute(ix, line, cum, { exemptM: 1e6 }), [], 'all within the exempt access distance');
  const out = [[-74.6, 40.2], [-74.5, 40.3]]; assert.deepEqual(offTruckRoute(ix, out, [0, 14000], { exemptM: 100 }), [], 'outside NYC never flagged'); });

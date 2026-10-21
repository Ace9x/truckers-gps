import { test } from 'node:test'; import assert from 'node:assert/strict';
import { aggregate, level, segKey, routeTraffic, jamText, rerouteDecision, parseNycDot, linkObs, parseHere, parseTomTom, refMph } from '../js/trafficlogic.js';
import { cumulative } from '../js/logic.js';
const now = 1e12;
test('congestion levels', () => { assert.equal(level(0.95).id, 'free'); assert.equal(level(0.6).id, 'slow'); assert.equal(level(0.4).id, 'heavy'); assert.equal(level(0.1).id, 'jam'); });
test('aggregation: needs 2 distinct drivers, latest per driver, median, expiry', () => {
  const k = segKey(40.8, -73.9, 0); assert.equal(k, segKey(40.80001, -73.90001, 10));
  assert.deepEqual(aggregate([{ k, mph: 10, ff: 50, by: 'a', t: now, lat: 40.8, lon: -73.9 }], now), {}, 'one driver alone never shows');
  const a = aggregate([{ k, mph: 60, ff: 50, by: 'a', t: now - 60e3, lat: 40.8, lon: -73.9 }, { k, mph: 8, ff: 50, by: 'a', t: now, lat: 40.8, lon: -73.9 }, { k, mph: 12, ff: 50, by: 'b', t: now, lat: 40.8, lon: -73.9 }, { k, mph: 5, ff: 50, by: 'c', t: now - 11 * 60e3, lat: 40.8, lon: -73.9 }], now)[k];
  assert.equal(a.n, 2); assert.equal(a.mph, 10); assert.equal(a.level, 'jam');
  assert.equal(aggregate([{ k, mph: 200, by: 'a', t: now }, { k, mph: -1, by: 'b', t: now }], now)[k], undefined, 'garbage rejected'); });
// straight 10 km road north, expected 25 m/s (~56 mph)
const line = Array.from({ length: 101 }, (_, i) => [-74, 40 + i * 0.0009]); const cum = cumulative(line);
const route = { line, cum, length: cum.at(-1), time: cum.at(-1) / 25, maneuvers: [{ begin_shape_index: 0, end_shape_index: 100, length: cum.at(-1) / 1000, time: cum.at(-1) / 25 }] };
const jam = (a0, a1, mph, h = 0) => line.filter((_, i) => cum[i] >= a0 && cum[i] <= a1).map(([lon, lat]) => ({ lon, lat, mph, ff: 55, h, src: 'test', t: now }));
test('delay calc: 2 km at 10 mph on a 56 mph road', () => { const r = routeTraffic(route, jam(4000, 6000, 10));
  const exp = 2000 / (10 / 2.23694) - 2000 / 25; assert.ok(Math.abs(r.delay - exp) < 150, `${r.delay} vs ${exp}`); assert.equal(r.slowdowns.length, 1); assert.equal(r.slowdowns[0].level, 'jam');
  assert.ok(r.slowdowns[0].start >= 3700 && r.slowdowns[0].start <= 4300); });
test('delay ignores opposite direction, off-route, and traffic behind you', () => {
  assert.equal(routeTraffic(route, jam(4000, 6000, 10, 180)).delay, 0, 'southbound jam ignored');
  assert.equal(routeTraffic(route, jam(4000, 6000, 10).map(o => ({ ...o, lon: o.lon + 0.01 }))).delay, 0, 'parallel road ~850 m away ignored');
  assert.equal(routeTraffic(route, jam(1000, 2000, 10), { from: 3000 }).delay, 0, 'jam already passed');
  const r = routeTraffic(route, []); assert.equal(r.sources.length, 0); assert.equal(r.coverage, 0); });
test('jam alert text', () => { assert.equal(jamText({ start: 2 * 1609.344 + 500, delay: 720, level: 'heavy' }, 500), 'Heavy traffic in 2 miles, 12 minute delay');
  assert.match(jamText({ start: 100, delay: 20, level: 'jam' }, 0), /^Stopped traffic ahead$/); });
test('reroute trigger', () => { const cur = { time: 1800, delay: 900 };
  assert.equal(rerouteDecision({ time: 1800, delay: 120 }, [{ time: 1000, delay: 0 }]), null, 'small delay → no suggestion');
  assert.equal(rerouteDecision(cur, [{ time: 2600, delay: 0 }]), null, 'alternative not faster enough');
  const b = rerouteDecision(cur, [{ time: 2400, delay: 0, id: 1 }, { time: 1900, delay: 100, id: 2 }]); assert.equal(b.id, 2); assert.equal(b.save, 700); });
test('feed parsers', () => { const f = parseNycDot([{ link_id: '1', speed: '12.4', status: '0', data_as_of: '2026-10-21T15:47:06.000', link_name: 'BQE N Atlantic Ave', link_points: '40.69,-73.99 40.70,-73.99 40.7' }, { link_id: '2', speed: '0', status: '-101', link_points: '1,2 3,4' }]);
  assert.equal(f.length, 1); assert.equal(f[0].ff, 50); assert.equal(f[0].coords.length, 2); assert.equal(new Date(f[0].t).toISOString(), '2026-10-21T19:47:06.000Z'); assert.ok(linkObs(f[0]).length >= 9);
  assert.equal(refMph('W 57th St'), 30);
  const h = parseHere({ sourceUpdated: '2026-10-21T21:00:00Z', results: [{ location: { description: 'I-95', shape: { links: [{ points: [{ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 }] }] } }, currentFlow: { speed: 10, freeFlow: 25 } }] });
  assert.equal(h[0].ratio, 0.4); assert.equal(h[0].src, 'HERE');
  const t = parseTomTom({ flowSegmentData: { currentSpeed: 40, freeFlowSpeed: 100, coordinates: { coordinate: [{ latitude: 40, longitude: -74 }, { latitude: 40.01, longitude: -74 }] } } }); assert.equal(t.ratio, 0.4); });

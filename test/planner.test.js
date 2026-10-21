import test from 'node:test'; import assert from 'node:assert';
import { optimize, simulate, haversineMatrix, parseCSV, rowsToStops, parsePaste, hm, encodePlan, decodePlan } from '../js/plannerlogic.js';
const depot = { lat: 40.8128, lon: -73.8803, name: 'Hunts Point' };
const pts = [[40.75, -73.99], [40.85, -73.87], [40.70, -73.95], [40.78, -73.84], [40.66, -73.80], [40.88, -73.90], [40.72, -74.05], [40.80, -73.95], [40.69, -74.17], [40.60, -74.00], [40.74, -73.92]];
const stops = pts.map(([lat, lon], i) => ({ lat, lon, name: 'S' + i, service: 300, priority: 2 }));
const nodes = [depot, ...stops], M = haversineMatrix(nodes);
test('optimizer beats naive order (11 stops, heuristic)', () => { const naive = simulate(stops.map((_, i) => i + 1), nodes, M), o = optimize(nodes, M);
  assert.ok(o.drive < naive.drive * 0.85, `${o.drive} vs ${naive.drive}`); assert.equal(new Set(o.order).size, 11); });
test('optimizer exact for small sets beats naive', () => { const n = nodes.slice(0, 7), m = haversineMatrix(n), naive = simulate([1, 2, 3, 4, 5, 6], n, m), o = optimize(n, m); assert.ok(o.cost <= naive.cost); });
test('respects time windows', () => { const n = nodes.slice(0, 8).map((s, i) => ({ ...s })); n[6].tw = [8 * 3600, 8 * 3600 + 40 * 60]; // S5 must be first-ish
  const m = haversineMatrix(n), o = optimize(n, m, { startSec: 8 * 3600 }); assert.equal(o.lateCount, 0); const free = optimize(n.map(s => ({ ...s, tw: null })), m);
  assert.ok(o.order.indexOf(6) <= 1, 'windowed stop early: ' + o.order); });
test('waits for window opening rather than being early', () => { const n = [depot, { ...stops[0], tw: [10 * 3600, 11 * 3600] }], m = haversineMatrix(n), o = optimize(n, m, { startSec: 8 * 3600 }); assert.equal(o.sched[0].start, 10 * 3600); assert.ok(o.wait > 0); });
test('locked first and last stop stay put', () => { const o = optimize(nodes, M, { lockFirst: true, lockLast: true }); assert.equal(o.order[0], 1); assert.equal(o.order.at(-1), 11); });
test('return to start adds the drive home', () => { const a = optimize(nodes, M), b = optimize(nodes, M, { returnToStart: true }); assert.ok(b.drive > a.drive); });
test('CSV import with headers, quotes, windows', () => { const r = rowsToStops(parseCSV('Name,Address,Window Start,Window End,Priority,Service Min,Packages,Notes\n"Acme, Inc",1 Main St Bronx,9:00 AM,11am,high,10,4,"dock 3"\nBob,2 Elm St,,,low,,1,\n'));
  assert.equal(r.length, 2); assert.equal(r[0].name, 'Acme, Inc'); assert.deepEqual(r[0].tw, [9 * 3600, 11 * 3600]); assert.equal(r[0].priority, 1); assert.equal(r[0].service, 600); assert.equal(r[0].packages, 4); assert.equal(r[1].priority, 3); });
test('paste list + hm', () => { assert.equal(parsePaste('1. 10 Main St\n2) 20 Oak Ave\n\n').length, 2); assert.equal(hm('2:30 pm'), 14.5 * 3600); });
test('share encoding round-trips', () => { const p = { name: 'Bronx run', stops: stops.slice(0, 3).map(s => ({ ...s, tw: null, notes: 'é', packages: 2 })) }; const d = decodePlan(encodePlan(p)); assert.equal(d.stops.length, 3); assert.equal(d.stops[0].notes, 'é'); });

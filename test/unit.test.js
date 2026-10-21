import test from 'node:test'; import assert from 'node:assert/strict';
import { haversine, decodePolyline, cumulative, snapToRoute, OffRouteDetector, currentStep, truckCosting, hosStatus, H, fmtDist, classifyPoi, overpassQuery } from '../js/logic.js';

test('haversine NYC→Newark ≈ 16 km', () => { const d = haversine([-73.9857, 40.7484], [-74.1724, 40.7357]); assert.ok(d > 15500 && d < 16500, d); });
test('decodePolyline precision 6', () => { assert.deepEqual(decodePolyline('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI').map(p => p.map(x => +x.toFixed(5))), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]); });
test('snap and off-route', () => {
  const line = [[-74, 40], [-74, 40.01], [-74, 40.02]], cum = cumulative(line);
  const on = snapToRoute([-74.0001, 40.015], line, cum); assert.ok(on.dist < 10); assert.equal(on.seg, 1); assert.ok(Math.abs(on.along - 1668) < 15);
  const off = snapToRoute([-74.003, 40.015], line, cum); assert.ok(off.dist > 200);
  const det = new OffRouteDetector({ threshold: 60, needed: 3 });
  assert.equal(det.update(off.dist), false); assert.equal(det.update(off.dist), false); assert.equal(det.update(off.dist), true);
  det.reset(); det.update(off.dist); assert.equal(det.update(5), false, 'single good fix resets');
});
test('currentStep picks next maneuver', () => { const m = [{ begin_shape_index: 0 }, { begin_shape_index: 10 }, { begin_shape_index: 20 }]; assert.equal(currentStep(m, 0), 1); assert.equal(currentStep(m, 12), 2); assert.equal(currentStep(m, 25), 2); });
test('truckCosting converts imperial', () => { const c = truckCosting({ heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, hazmat: true });
  assert.equal(c.height, 4.11); assert.equal(c.weight, 36.29); assert.equal(c.length, 21.34); assert.equal(c.hazmat, true); assert.equal(c.axle_count, 5); });
test('fmtDist', () => { assert.equal(fmtDist(100), '350 ft'); assert.equal(fmtDist(1609.344 * 2.5), '2.5 mi'); assert.equal(fmtDist(500, 'km'), '500 m'); });
const T0 = Date.UTC(2026, 9, 21, 0);
test('HOS fresh shift', () => { const s = hosStatus([{ t: T0 - 12 * H, s: 'off' }], T0); assert.equal(s.driveLeft, 11 * H); assert.equal(s.windowLeft, 14 * H); });
test('HOS 8h driving requires break; 30m off clears it', () => {
  const ev = [{ t: T0 - 12 * H, s: 'off' }, { t: T0, s: 'on' }, { t: T0 + 0.5 * H, s: 'drive' }];
  let s = hosStatus(ev, T0 + 8.5 * H); assert.equal(s.breakLeft, 0); assert.ok(s.warnings.includes('30-minute break required now'));
  assert.equal(s.driveLeft, 3 * H); assert.equal(s.windowLeft, 5.5 * H);
  ev.push({ t: T0 + 8.5 * H, s: 'off' }, { t: T0 + 9 * H, s: 'drive' });
  s = hosStatus(ev, T0 + 9 * H); assert.equal(s.breakLeft, 8 * H);
});
test('HOS 11h limit and 14h window', () => {
  const ev = [{ t: T0 - 11 * H, s: 'off' }, { t: T0, s: 'drive' }, { t: T0 + 6 * H, s: 'off' }, { t: T0 + 7 * H, s: 'drive' }];
  let s = hosStatus(ev, T0 + 12 * H); assert.equal(s.driveLeft, 0); assert.ok(s.warnings.includes('11-hour driving limit reached'));
  const ev2 = [{ t: T0 - 11 * H, s: 'off' }, { t: T0, s: 'on' }, { t: T0 + 1 * H, s: 'off' }, { t: T0 + 13.5 * H, s: 'drive' }];
  // 12.5h off is a reset → new shift
  s = hosStatus(ev2, T0 + 14 * H); assert.equal(s.windowLeft, 13.5 * H);
  const ev3 = [{ t: T0 - 11 * H, s: 'off' }, { t: T0, s: 'on' }, { t: T0 + 1 * H, s: 'off' }, { t: T0 + 5 * H, s: 'drive' }];
  s = hosStatus(ev3, T0 + 14.2 * H); assert.equal(s.windowLeft, 0); assert.equal(s.driveLeft, 0);
});
test('10h split of off+sleeper counts as reset', () => { const ev = [{ t: T0, s: 'drive' }, { t: T0 + 5 * H, s: 'off' }, { t: T0 + 7 * H, s: 'sb' }, { t: T0 + 15 * H, s: 'drive' }];
  assert.equal(hosStatus(ev, T0 + 16 * H).driveLeft, 10 * H); });
test('POI classify + query', () => { assert.equal(classifyPoi({ amenity: 'fuel', name: "Love's Travel Stop" }), 'stop'); assert.equal(classifyPoi({ amenity: 'weighbridge' }), 'weigh'); assert.equal(classifyPoi({ highway: 'rest_area' }), 'rest');
  assert.match(overpassQuery([[-74, 40], [-74.1, 40.1]]), /around:1500,40\.00000,-74\.00000,40\.10000,-74\.10000/); });

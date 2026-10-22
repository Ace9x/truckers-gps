import test from 'node:test'; import assert from 'node:assert/strict';
import { parkingNow, hosParking, fmtH, expiry, credAlerts } from '../js/jobslogic.js';
const now = Date.parse('2026-10-22T20:00:00Z'), ago = m => new Date(now - m * 60e3).toISOString();
test('parking: newest report within 4h wins, stale ignored', () => { assert.deepEqual(parkingNow([{ status: 'open', t: ago(300) }, { status: 'some', t: ago(40) }, { status: 'full', t: ago(10) }], now), { status: 'full', t: ago(10), ageMin: 10, n: 2 }); assert.equal(parkingNow([{ status: 'open', t: ago(300) }], now), null); });
test('HOS: 2h short → last reachable parking, skipping lots reported full', () => {
  const pois = [{ id: 'a', kind: 'stop', along: 50000 }, { id: 'b', kind: 'rest', along: 150000 }, { id: 'c', kind: 'parking', along: 190000 }, { id: 'd', kind: 'stop', along: 260000 }, { id: 'f', kind: 'fuel', along: 180000 }];
  // 300 km, 4 h remaining, 2 h of driving left → reach 150 km... use 3h left -> 225 km
  const r = hosParking({ pois, along: 0, length: 300000, timeSec: 4 * 3600, driveLeftMs: 3 * 3600e3, status: { c: { status: 'full' } } });
  assert.equal(fmtH(r.shortMs), '1h'); assert.equal(r.pick.id, 'b'); assert.equal(r.skippedFull, 1); assert.ok(Math.abs(r.pick.mi - 93.2) < 0.1);
  assert.equal(hosParking({ pois, along: 0, length: 300000, timeSec: 4 * 3600, driveLeftMs: 5 * 3600e3 }), null, 'enough hours → no warning'); });
test('credential expiry levels and messages', () => { const n = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(expiry('2026-10-22', n).level, 'week'); assert.equal(expiry('2026-10-21', n).level, 'expired'); assert.equal(expiry('2026-11-15', n).level, 'urgent'); assert.equal(expiry('2026-12-15', n).level, 'soon'); assert.equal(expiry('2027-06-01', n).level, 'ok');
  const a = credAlerts({ cdl: '2027-06-01', med: '2026-11-01', twic: '2026-10-20' }, n); assert.deepEqual(a.map(x => x.text), ['DOT medical card expires in 10 days', 'TWIC card expired 2 days ago']); });

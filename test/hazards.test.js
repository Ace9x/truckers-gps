import test from 'node:test'; import assert from 'node:assert/strict';
import { HZ, expiresAt, alive, opacity, findDup, ingest, applyVote, RateLimiter, geohash, ghDecode, ghNeighbors, ahead, alertText, dist } from '../js/hazlogic.js';
const H = 3600e3, T0 = 1_800_000_000_000, P = { lat: 40.75, lon: -73.99 };
const rep = (o) => ({ id: Math.random().toString(36), type: 'accident', lat: P.lat, lon: P.lon, t: T0, by: 'a', ups: [], downs: [], ...o });
test('type-based expiry', () => {
  assert.equal(expiresAt(rep({ type: 'police' })) - T0, 1 * H); assert.equal(expiresAt(rep()) - T0, 2 * H);
  assert.equal(expiresAt(rep({ type: 'construction' })) - T0, 24 * H); assert.equal(expiresAt(rep({ type: 'camera' })) - T0, 30 * 24 * H);
  assert.equal(expiresAt(rep({ type: 'debris' })) - T0, 45 * 60e3);
  assert.ok(alive(rep({ type: 'debris' }), T0 + 44 * 60e3)); assert.ok(!alive(rep({ type: 'debris' }), T0 + 46 * 60e3));
});
test('opacity fades with age', () => { const r = rep(); assert.equal(opacity(r, T0), 1); const m = opacity(r, T0 + H); assert.ok(m < 1 && m > 0.35); assert.equal(opacity(r, T0 + 1.99 * H) >= 0.35, true); assert.equal(opacity(r, T0 + 2 * H), 0); });
test('thumbs up extends, 2 downs remove, reporter cannot self-vote', () => {
  const r = rep(); applyVote(r, { by: 'b', dir: 'up', t: T0 + 1.5 * H }); assert.ok(alive(r, T0 + 3 * H)); assert.equal(opacity(r, T0 + 1.5 * H), 1);
  applyVote(r, { by: 'a', dir: 'down', t: T0 }); assert.equal(r.down, 0);
  applyVote(r, { by: 'c', dir: 'down', t: T0 }); assert.ok(alive(r, T0)); applyVote(r, { by: 'c', dir: 'down', t: T0 }); assert.equal(r.down, 1, 'same voter counted once');
  applyVote(r, { by: 'd', dir: 'down', t: T0 }); assert.ok(!alive(r, T0));
  const c = rep(); for (let i = 0; i < 20; i++) applyVote(c, { by: 'u' + i, dir: 'up', t: T0 + i * H }); assert.ok(!alive(c, T0 + 6.1 * H), 'capped at 3x ttl');
});
test('dedupe nearby same-type reports', () => {
  const s = []; assert.ok(ingest(s, rep({ id: '1' }), T0).added);
  const m = ingest(s, rep({ id: '2', by: 'b', lat: P.lat + 0.001 }), T0 + 60e3); assert.equal(m.merged.id, '1'); assert.equal(s[0].up, 1); assert.equal(s.length, 1);
  assert.ok(ingest(s, rep({ id: '3', type: 'police' }), T0).added, 'different type kept');
  assert.ok(ingest(s, rep({ id: '4', lat: P.lat + 0.01 }), T0).added, '1.1 km away kept');
  assert.equal(ingest(s, rep({ id: '1' }), T0).dropped, 'seen'); assert.equal(ingest(s, rep({ id: '5', t: T0 - 3 * H }), T0).dropped, 'expired');
  assert.equal(findDup(s, rep({ id: 'x', lat: P.lat + 0.0005 }), T0).id, '1');
});
test('rate limiter', () => { const l = new RateLimiter(); assert.ok(l.allow('me', 'police', T0)); assert.ok(!l.allow('me', 'police', T0 + 10e3)); assert.ok(l.allow('me', 'police', T0 + 61e3));
  for (let i = 0; i < 4; i++) assert.ok(l.allow('me', 't' + i, T0 + 62e3 + i)); assert.ok(!l.allow('me', 'zz', T0 + 70e3), '6 per 10 min'); });
test('geohash encode/decode/neighbors', () => {
  assert.equal(geohash(57.64911, 10.40744, 11), 'u4pruydqqvj'); const d = ghDecode('u4pruydqqvj'); assert.ok(Math.abs(d.lat - 57.64911) < 1e-4 && Math.abs(d.lon - 10.40744) < 1e-4);
  const n = ghNeighbors('dr5r'); assert.equal(n.length, 9); assert.ok(n.includes('dr5r') && n.includes('dr72') && n.includes('dr5x'));
  assert.ok(ghNeighbors(geohash(40.80, -73.88, 4)).includes(geohash(40.70, -74.02, 4)), 'Bronx area covers Manhattan');
  assert.ok(!ghNeighbors(geohash(40.80, -73.88, 4)).includes(geohash(39.95, -75.16, 4)), 'NYC does not cover Philadelphia');
});
test('ahead: heading cone and route', () => {
  const pos = { lat: 40.75, lon: -73.99 }, N = rep({ id: 'n', lat: 40.7645 }), S = rep({ id: 's', lat: 40.7355 });
  const a = ahead([N, S], { pos, heading: 0, now: T0 }); assert.deepEqual(a.map(x => x.r.id), ['n']); assert.ok(Math.abs(a[0].d - 1612) < 20);
  assert.equal(ahead([N], { pos, heading: 180, now: T0 }).length, 0);
  assert.equal(alertText(N, 1610), 'Accident reported ahead in 1 mile');
  const snap = (p) => ({ dist: 5, along: dist({ lat: 40.75, lon: -73.99 }, { lat: p[1], lon: p[0] }) * Math.sign(p[1] - 40.75) + 1000 });
  assert.deepEqual(ahead([N, S], { pos, route: { line: [], cum: [], along: 1000 }, snap, now: T0 }).map(x => x.r.id), ['n']);
});

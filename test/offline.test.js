import test from 'node:test'; import assert from 'node:assert/strict';
import { Outbox, memoryStore, isExpired, outboxKey, rejoinGuidance, tilesForBbox, estimateMB, corridorTiles, parseCommand, pickReportType } from '../js/offline.js';
import { cumulative } from '../js/logic.js';
const H = 3600e3, NOW = Date.UTC(2026, 9, 21, 20);

test('outbox dedupes same report id and same voter/report', async () => {
  const ob = new Outbox(memoryStore()); const r = { id: 'r1', type: 'hazard', lat: 40, lon: -74, t: NOW - 60e3 };
  await ob.add('report', r); await ob.add('report', r); assert.equal(await ob.size(), 1);
  await ob.add('vote', { id: 'x', dir: 'up', uid: 'u', t: NOW }); await ob.add('vote', { id: 'x', dir: 'down', uid: 'u', t: NOW + 1 });
  const l = await ob.list(); assert.equal(l.length, 2); assert.equal(l.find(i => i.kind === 'vote').payload.dir, 'down', 'latest vote wins');
  assert.equal(outboxKey('vote', { id: 'x', uid: 'u' }), 'vote:x:u');
});
test('outbox flush keeps original timestamps, sends in order, drops expired', async () => {
  const ob = new Outbox(memoryStore()), sent = [];
  await ob.add('report', { id: 'old-police', type: 'police', t: NOW - 2 * H });   // police TTL 1h → expired
  await ob.add('report', { id: 'b', type: 'hazard', t: NOW - 30 * 60e3 });
  await ob.add('report', { id: 'a', type: 'ice', t: NOW - 60 * 60e3 });
  await ob.add('vote', { id: 'a', dir: 'up', uid: 'me', t: NOW - 13 * H });        // vote > 12h → expired
  const res = await ob.flush(async (k, p) => sent.push([k, p.id, p.t]), NOW);
  assert.deepEqual(res, { sent: 2, dropped: 2, failed: 0 });
  assert.deepEqual(sent, [['report', 'a', NOW - H], ['report', 'b', NOW - 30 * 60e3]], 'oldest first, timestamps unchanged');
  assert.equal(await ob.size(), 0);
});
test('outbox keeps items when network send fails, retries later', async () => {
  const ob = new Outbox(memoryStore()); await ob.add('report', { id: 'z', type: 'hazard', t: NOW });
  let res = await ob.flush(async () => { throw new Error('offline'); }, NOW); assert.equal(res.failed, 1); assert.equal(await ob.size(), 1);
  res = await ob.flush(async () => {}, NOW + 1000); assert.equal(res.sent, 1); assert.equal(await ob.size(), 0);
});
test('restrictions (no TTL) default to 24h in outbox', () => {
  assert.equal(isExpired({ kind: 'report', t: NOW - 23 * H, payload: { type: 'clearance' } }, NOW), false);
  assert.equal(isExpired({ kind: 'report', t: NOW - 25 * H, payload: { type: 'clearance' } }, NOW), true);
});
test('offline rejoin guidance points back to route ahead', () => {
  const line = [[-74, 40], [-74, 40.01], [-74, 40.02]], cum = cumulative(line);
  const g = rejoinGuidance({ lon: -74.003, lat: 40.005 }, line, cum, 500, 0); // 255 m west of route, heading north
  assert.ok(g.offBy > 200 && g.offBy < 300, g.offBy); assert.ok(g.bearing > 0 && g.bearing < 90, 'route is ahead-right (NE)'); assert.equal(g.rel, 'to your right');
  assert.ok(g.point[1] > 40.005, 'aims forward, not backwards');
});
test('region tiles + size estimate', () => {
  const t = tilesForBbox([-74.05, 40.68, -73.85, 40.85], [10, 12, 14]); assert.ok(t.length > 20 && t.length < 400, t.length);
  assert.ok(t.every(k => /^\d+\/\d+\/\d+$/.test(k))); assert.ok(estimateMB(1000) > 20 && estimateMB(1000) < 35);
  const c = corridorTiles([[-73.88, 40.81], [-74.16, 40.69]]); const zs = new Set(c.map(k => +k.split('/')[0]));
  assert.deepEqual([...zs].sort((a, b) => a - b), [6, 8, 10, 11, 12, 13, 14]);
});
test('voice commands', () => {
  assert.deepEqual(parseCommand('Report accident'), { cmd: 'report', type: 'accident' });
  assert.deepEqual(parseCommand('report a speed camera'), { cmd: 'report', type: 'camera' });
  assert.equal(parseCommand('mute').cmd, 'mute'); assert.equal(parseCommand('unmute').cmd, 'unmute');
  assert.equal(parseCommand('where is the next fuel').cmd, 'fuel'); assert.equal(parseCommand('next diesel').cmd, 'fuel');
  assert.equal(parseCommand('how long left').cmd, 'eta'); assert.equal(parseCommand('blah').cmd, null);
  assert.equal(pickReportType('accident', { hazard: {} }), 'hazard'); assert.equal(pickReportType('accident', { accident: {}, hazard: {} }), 'accident');
});
test('live (nostr) events: original created_at kept, expire by hazard TTL', async () => {
  const ob = new Outbox(memoryStore()), sent = [];
  const ev = (id, sec, c) => ({ ev: { id, created_at: sec, content: JSON.stringify(c) }, c });
  await ob.add('nostr', ev('e1', (NOW - 30 * 60e3) / 1000, { a: 'r', type: 'accident' }), NOW - 30 * 60e3);  // accident TTL 2h → send
  await ob.add('nostr', ev('e2', (NOW - 90 * 60e3) / 1000, { a: 'r', type: 'police' }), NOW - 90 * 60e3);    // police TTL 1h → drop
  await ob.add('nostr', ev('e1', (NOW - 30 * 60e3) / 1000, { a: 'r', type: 'accident' }), NOW - 30 * 60e3);  // duplicate → deduped
  const res = await ob.flush(async (k, p) => sent.push(p.ev), NOW);
  assert.deepEqual(res, { sent: 1, dropped: 1, failed: 0 }); assert.equal(sent[0].created_at, (NOW - 30 * 60e3) / 1000);
});

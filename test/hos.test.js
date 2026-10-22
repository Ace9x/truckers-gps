import { test } from 'node:test'; import assert from 'node:assert/strict';
import { hosEngine, planBreaks, shortHaulOk, H, M } from '../js/hos.js';
const T = Date.UTC(2026, 9, 20, 6); const seq = (...p) => { let t = T; return p.map(([s, h]) => { const e = { t, s }; t += h * H; return e; }); };
const at = (...p) => T + p.reduce((a, [, h]) => a + h * H, 0);
test('11-hour driving limit after a 10h reset', () => { const p = [['off', 10], ['drive', 7], ['off', 0.5], ['drive', 4]]; const s = hosEngine(seq(...p), at(...p)); assert.equal(s.driveLeft, 0); assert.match(s.warnings[0], /11-hour/); });
test('14-hour window counts on-duty and breaks', () => { const p = [['off', 10], ['on', 3], ['drive', 5], ['off', 2], ['drive', 2]]; const s = hosEngine(seq(...p), at(...p)); assert.equal(s.windowLeft, 2 * H); assert.equal(s.driveLeft, 2 * H); });
test('window closes before 11h is used', () => { const p = [['off', 10], ['on', 6], ['drive', 8], ['off', 0.5]]; const s = hosEngine(seq(...p), at(...p)); assert.equal(s.windowLeft, 0); assert.equal(s.driveLeft, 0); });
test('30-minute break after 8h driving; any non-driving 30 min resets it', () => {
  let p = [['off', 10], ['drive', 8]]; assert.equal(hosEngine(seq(...p), at(...p)).breakLeft, 0);
  p = [['off', 10], ['drive', 4], ['on', 0.5], ['drive', 4]]; assert.equal(hosEngine(seq(...p), at(...p)).breakLeft, 4 * H);
  p = [['off', 10], ['drive', 4], ['off', 0.25], ['drive', 4]]; assert.equal(hosEngine(seq(...p), at(...p)).breakLeft, 0, '15 min does not count'); });
test('70-hour/8-day cycle and 34-hour restart', () => {
  const ev = []; let t = T; for (let d = 0; d < 6; d++) { ev.push({ t, s: 'drive' }); t += 11 * H; ev.push({ t, s: 'off' }); t += 13 * H; }
  let s = hosEngine(ev, t); assert.equal(s.cycleLeft, 4 * H); assert.ok(s.driveLeft <= 4 * H);
  s = hosEngine(ev, t + 34 * H); assert.equal(s.cycleLeft, 70 * H, '34h restart clears the cycle');
  assert.equal(hosEngine(ev, t, { cycle: 60 }).cycleLeft, 0); });
test('split sleeper 8/2: periods excluded from 14h, recalculated from end of the first', () => {
  const p = [['off', 10], ['drive', 6], ['sb', 8], ['drive', 3], ['off', 2], ['drive', 0]]; const s = hosEngine(seq(...p), at(...p));
  assert.ok(s.split, 'pair found'); assert.equal(s.driveUsed, 3 * H, 'only driving after the 8h berth counts'); assert.equal(s.driveLeft, 8 * H);
  assert.equal(s.windowLeft, 14 * H + 2 * H - 5 * H, 'window from end of berth, 2h off excluded'); });
test('split sleeper 7/3 in either order; 6h berth does not qualify', () => {
  let p = [['off', 10], ['drive', 5], ['off', 3], ['drive', 3], ['sb', 7], ['drive', 1]]; let s = hosEngine(seq(...p), at(...p)); assert.ok(s.split); assert.equal(s.driveUsed, 4 * H);
  p = [['off', 10], ['drive', 5], ['sb', 6], ['drive', 3], ['off', 4], ['drive', 1]]; s = hosEngine(seq(...p), at(...p)); assert.equal(s.split, null); assert.equal(s.driveUsed, 9 * H); });
test('adverse driving conditions add 2h to the 11 and 14', () => { const p = [['off', 10], ['drive', 11]]; assert.equal(hosEngine(seq(...p), at(...p), { adverse: true }).driveLeft, 2 * H); assert.equal(hosEngine(seq(...p), at(...p)).driveLeft, 0); });
test('short-haul: no 30-minute break, eligibility 150 air-mi / 14h', () => { const p = [['off', 10], ['drive', 9]]; assert.equal(hosEngine(seq(...p), at(...p), { shortHaul: true }).breakLeft, Infinity); assert.equal(shortHaulOk(149, 13.5), true); assert.equal(shortHaulOk(151, 10), false); assert.equal(shortHaulOk(100, 14.5), false); });
test('labelled as a planning aid, not an ELD', () => assert.match(hosEngine([], T).label, /not an ELD/));
test('ETA plan inserts required breaks', () => { const st = { breakLeft: 2 * H, driveLeft: 5 * H }; const r = planBreaks(9 * 3600, st);
  assert.deepEqual(r.breaks.map(b => [b.kind, b.atSec / 3600]), [['30min', 2], ['10h', 5.5]]); assert.equal(r.totalSec, 9 * 3600 + 1800 + 36000); assert.deepEqual(planBreaks(3600, { breakLeft: Infinity, driveLeft: 11 * H }).breaks, []); });

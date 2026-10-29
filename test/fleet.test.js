import test from 'node:test'; import assert from 'node:assert/strict';
import { detention, invoiceLines, invoiceCSV, stats, schedule, pinHashHex, VCOST } from '../js/fleetlogic.js';
import { createHash } from 'node:crypto';
const iso = (h, base = Date.parse('2026-10-28T12:00:00Z')) => new Date(base + h * 3600e3).toISOString();
test('detention bills per started 15 min past free time', () => { const d = detention({ arrived_at: iso(0), departed_at: iso(2.6) }, { free_min: 120, rate_hr: 60 }); assert.equal(d.over, 36); assert.equal(d.usd, 45); assert.equal(detention({}, {}).usd, 0); });
test('invoice lines + CSV quoting', () => { const l = { id: 'abcdefgh-1', ref: 'PO, "1"', rate_usd: 800, detention: { free_min: 60, rate_hr: 40 }, stops: [{ kind: 'pickup', address: 'A', arrived_at: iso(0), departed_at: iso(2) }, { kind: 'drop', address: 'B', arrived_at: iso(5), departed_at: iso(5.5) }] };
  const L = invoiceLines([l]); assert.equal(L[0].detention, 40); assert.equal(L[0].total, 840); const csv = invoiceCSV({ number: 'INV-1' }, L); assert.match(csv, /"PO, ""1"""/); assert.match(csv, /Total,,,,,840.00/); });
test('stats: revenue, on-time %', () => { const now = Date.parse('2026-10-29T00:00:00Z'); const mk = (st, appt, arr, rate) => ({ id: Math.random() + '', status: st, rate_usd: rate, created_at: iso(-5), stops: [{ kind: 'pickup' }, { kind: 'drop', appt, arrived_at: arr }] });
  const s = stats([mk('delivered', iso(1), iso(1.2), 500), mk('delivered', iso(1), iso(2), 700), mk('in_transit', null, null, 300)], now); assert.equal(s.revenue, 1200); assert.equal(s.onTimePct, 50); assert.equal(s.active, 1); });
test('schedule picks today (NY) stops sorted', () => { const l = { id: 'x', status: 'accepted', stops: [{ kind: 'pickup', appt: '2026-10-28T18:00:00Z' }, { kind: 'drop', appt: '2026-10-29T15:00:00Z' }] }; const s = schedule([l], new Date('2026-10-28T20:00:00Z')); assert.equal(s.length, 1); assert.equal(s[0].idx, 0); });
test('PIN hash matches the server formula (sha256 hex of rr-pin:id:pin)', async () => { const h = await pinHashHex('id-1', ' 0420 '); assert.equal(h, createHash('sha256').update('rr-pin:id-1:0420').digest('hex')); });
test('vehicle costing', () => { assert.equal(VCOST('car'), 'auto'); assert.equal(VCOST('van'), 'truck'); });

test('schedule includes the next 12 h after late-night (NY) — dispatchers working past midnight', () => { const l = { id: 'y', status: 'accepted', stops: [{ kind: 'pickup', appt: '2026-10-29T05:00:00Z' }, { kind: 'drop', appt: '2026-10-29T20:00:00Z' }] }; assert.equal(schedule([l], new Date('2026-10-29T03:30:00Z')).length, 1); });

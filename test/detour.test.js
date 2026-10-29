import test from 'node:test'; import assert from 'node:assert/strict';
import { truckDetour, DETOUR_K, DETOUR_RELAX } from '../js/logic.js';
const R = (mi, min) => ({ length: mi * 1609.344, time: min * 60 });
test('Hunts Point -> Port Newark (92 mi truck vs 28.6 mi car) is a detour', () => { const d = truckDetour(R(92.1, 108), R(28.6, 43)); assert.equal(d.detour, true); assert.ok(d.ratio > 3); assert.equal(d.extraMi, 63.5); });
test('a normal truck route is not', () => { assert.equal(truckDetour(R(31, 50), R(28.6, 43)).detour, false); });
test('time alone can trigger it', () => { assert.equal(truckDetour(R(30, 90), R(28.6, 43)).detour, true); });
test('threshold is 1.5x and exclusive', () => { assert.equal(DETOUR_K, 1.5); assert.equal(truckDetour(R(15, 15), R(10, 10)).detour, false); assert.equal(truckDetour(R(15.2, 10), R(10, 10)).detour, true); });
test('no car route / tiny trips / bad data -> null', () => { assert.equal(truckDetour(R(5, 5), null), null); assert.equal(truckDetour(R(3, 5), R(0.5, 1)), null); assert.equal(truckDetour(R(3, 5), { length: 5000, time: 0 }), null); });
test('relax pass softens no-truck access, keeps it a penalty', () => { assert.ok(DETOUR_RELAX.hgv_no_access_penalty > 0 && DETOUR_RELAX.hgv_no_access_penalty < 1e6); });

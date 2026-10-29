import test from 'node:test'; import assert from 'node:assert/strict';
globalThis.localStorage ??= { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); } };
const { fold, pinHash, pinOk, newPin } = await import('../js/dispatch.js');
const load = { id: 'L-1', pickup: { address: 'A', lat: 40.8, lon: -73.9 }, drop: { address: 'B', lat: 40.7, lon: -74.1 }, rate: { amount: 100 } };
test('pickup PIN gates Loaded', () => {
  const pin = newPin(); assert.match(pin, /^\d{4}$/); const L = { ...load, pinHash: pinHash(load.id, pin) };
  assert.ok(pinOk(L, pin)); assert.ok(!pinOk(L, pin === '0000' ? '1111' : '0000')); assert.ok(pinOk(load, undefined), 'loads without a PIN still work');
  const base = [{ type: 'load', load: L, t: 1 }, { type: 'response', loadId: 'L-1', action: 'accept', t: 2 }, { type: 'status', loadId: 'L-1', status: 'arrived_pickup', t: 3 }];
  let s = fold([...base, { type: 'status', loadId: 'L-1', status: 'loaded', pin: 'xxxx', t: 4 }])['L-1']; assert.equal(s.state, 'arrived_pickup'); assert.ok(s.pinMissing);
  s = fold([...base, { type: 'status', loadId: 'L-1', status: 'loaded', pin, t: 4 }])['L-1']; assert.equal(s.state, 'loaded'); assert.ok(!s.pinMissing);
});
test('delivered still needs full POD', () => {
  const s = fold([{ type: 'load', load, t: 1 }, { type: 'status', loadId: 'L-1', status: 'delivered', pod: { photo: 'data:image/jpeg;base64,x' }, t: 2 }])['L-1']; assert.ok(s.podMissing); assert.notEqual(s.state, 'delivered');
});

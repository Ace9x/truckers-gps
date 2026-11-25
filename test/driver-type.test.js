import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A driver-type tap used to throw ReferenceError: hosRender is not defined (left over from the hours-log removal) before the confirmation toast.
test('tapping OTR, Local, Owner-Op and Fleet confirms the driver type', () => {
  const src = fs.readFileSync('js/app.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  const types = src.match(/const DRIVER_TYPES = (\{[\s\S]*?\n\});/);
  assert.ok(types, 'DRIVER_TYPES found');
  const DRIVER_TYPES = eval('(' + types[1] + ')');
  const line = src.split('\n').find(l => l.includes("$$('[data-dt]')") && l.includes('onclick'));
  assert.ok(line, 'driver-type click handler found');
  assert.equal(line.includes('hosRender'), false, 'the tap must not call the removed hours log');
  const body = line.match(/b\.onclick = \(\) => \{ (.*) \}\);$/)[1];
  const buttons = [...html.matchAll(/data-dt="(\w+)">([^<]*)</g)].map(m => ({ dataset: { dt: m[1] }, textContent: m[2] }));
  assert.deepEqual(buttons.map(b => b.dataset.dt), ['otr', 'local', 'owner', 'fleet']);
  const toasts = [];
  const S = { truck: {} };
  const fn = new Function('S', 'DRIVER_TYPES', 'fillTruck', 'tf', 'renderDT', 'toast', 'b', body);
  const env = [S, DRIVER_TYPES, () => {}, { dispatchEvent() {} }, () => {}, m => toasts.push(m)];
  for (const b of buttons) {
    assert.doesNotThrow(() => fn(...env, b), b.dataset.dt);
    assert.equal(S.truck.driverType, b.dataset.dt);
    assert.equal(toasts.at(-1), 'Driver type: ' + b.textContent.trim());
  }
  assert.equal(S.truck.weightLbs, 80000);
  assert.equal(S.truck.avoidTolls, false);
  fn(...env, buttons[1]);
  assert.equal(S.truck.weightLbs, 26000);
  assert.equal(S.truck.lengthFt, 34);
  assert.equal(toasts.at(-1).includes('Local'), true);
  assert.equal(html.includes('name="cycle"'), false);
  assert.equal(html.includes('HOS clock'), false);
});

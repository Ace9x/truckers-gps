import test from 'node:test'; import assert from 'node:assert/strict';
import { VEHICLES, vehOf, costingFor, costingOptions, truckUIOn } from '../js/logic.js';
const mk = v => ({ vehicle: v, ...VEHICLES[v].preset });
test('default is semi with full truck costing', () => { assert.equal(vehOf({}), 'semi'); assert.equal(costingFor({}), 'truck'); assert.ok(truckUIOn({})); });
test('car routes with auto costing and no truck options or truck UI', () => { const c = mk('car'); assert.equal(costingFor(c), 'auto'); assert.deepEqual(costingOptions(c), {}); assert.equal(truckUIOn({ ...c, truckUI: true }), false); });
test('vans use truck costing with small dims, no hazmat, truck UI optional', () => { for (const v of ['van', 'reefervan']) { const t = mk(v), o = costingOptions(t).truck;
  assert.equal(costingFor(t), 'truck'); assert.ok(o.height > 2.6 && o.height < 3.0, 'about 9 ft'); assert.ok(o.weight >= 3.8 && o.weight <= 4.6, '8.5–10k lb'); assert.equal(o.hazmat, false);
  assert.equal(truckUIOn(t), false); assert.equal(truckUIOn({ ...t, truckUI: true }), true); } assert.ok(VEHICLES.reefervan.reefer); });
test('box and semi keep truck costing and truck UI', () => { for (const v of ['box', 'semi']) { assert.equal(costingFor(mk(v)), 'truck'); assert.ok(truckUIOn(mk(v))); assert.equal(costingOptions(mk(v)).truck.use_truck_route, 0.8); } });

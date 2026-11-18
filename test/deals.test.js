import test from 'node:test';
import assert from 'node:assert/strict';
import { withUtm, mergeSearch, decorateRoutePois, SEARCH_RADIUS_M } from '../js/dealslogic.js';

test('deal links carry the rigroute source and no invented affiliate id', () => {
  const u = new URL(withUtm('https://example.com/fuel?x=1'));
  assert.equal(u.searchParams.get('utm_source'), 'rigroute');
  assert.equal(u.searchParams.get('utm_medium'), 'deals');
  assert.equal(u.searchParams.get('x'), '1');
  assert.equal([...u.searchParams.keys()].some(k => /aff|partner_id/i.test(k)), false);
  assert.equal(withUtm(''), '');
  assert.equal(withUtm('javascript:alert(1)'), '');
});

test('featured search hits inside the radius sort first, far ones do not', () => {
  const origin = { lon: -73.99, lat: 40.75 };
  const near = { name: 'Pilot Queens', type: 'truck stop', lat: 40.751, lng: -73.991, active: true };
  const far = { name: 'Pilot Texas', type: 'truck stop', lat: 30.27, lng: -97.74, active: true };
  const off = { name: 'Hidden', type: 'shop', lat: 40.75, lng: -73.99, active: false };
  const results = [{ name: 'Crown Heights', lon: -73.94, lat: 40.67, dist: 9000 }, { name: 'Pilot Queens', lon: -73.991, lat: 40.751, dist: 200 }];
  const rows = mergeSearch(results, [far, off, near], 'pilot', origin);
  assert.equal(rows[0].name, 'Pilot Queens');
  assert.equal(rows[0].featured, true);
  assert.equal(rows.some(r => r.name === 'Hidden'), false);
  assert.equal(rows.some(r => r.name === 'Pilot Texas'), false);
  assert.ok(SEARCH_RADIUS_M < haversineMiles(origin, far));
});

test('a featured place on the route is a list row, not a map pin, and a far one is left out', () => {
  const pois = [{ name: 'Rest', lon: 1, lat: 1, off: 100, along: 10, kind: 'rest' }];
  const featured = [
    { name: 'Shop', lat: 2, lng: 2, active: true },
    { name: 'Far shop', lat: 9, lng: 9, active: true },
    { name: 'Old', lat: 1, lng: 1, active: true, expires_at: '2000-01-01T00:00:00Z' },
  ];
  const snap = (lon) => lon === 2 ? { dist: 400, along: 20 } : { dist: 9000, along: 0 };
  const rows = decorateRoutePois(pois, featured, snap, Date.parse('2026-11-18T00:00:00Z'));
  assert.equal(rows[0].name, 'Shop');
  assert.equal(rows[0].featured, true);
  assert.equal(rows[0].noPin, true);
  assert.equal(rows.some(r => r.name === 'Far shop' || r.name === 'Old'), false);
});

function haversineMiles(a, b) {
  const r = 6371008.8, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lng - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

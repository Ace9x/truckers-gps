import test from 'node:test'; import assert from 'node:assert/strict';
import { haversine, decodePolyline, cumulative, snapToRoute, OffRouteDetector, currentStep, truckCosting, hosStatus, H, fmtDist, classifyPoi, overpassQuery } from '../js/logic.js';

test('haversine NYC→Newark ≈ 16 km', () => { const d = haversine([-73.9857, 40.7484], [-74.1724, 40.7357]); assert.ok(d > 15500 && d < 16500, d); });
test('decodePolyline precision 6', () => { assert.deepEqual(decodePolyline('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI').map(p => p.map(x => +x.toFixed(5))), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]); });
test('snap and off-route', () => {
  const line = [[-74, 40], [-74, 40.01], [-74, 40.02]], cum = cumulative(line);
  const on = snapToRoute([-74.0001, 40.015], line, cum); assert.ok(on.dist < 10); assert.equal(on.seg, 1); assert.ok(Math.abs(on.along - 1668) < 15);
  const off = snapToRoute([-74.003, 40.015], line, cum); assert.ok(off.dist > 200);
  const det = new OffRouteDetector({ threshold: 60, needed: 3 });
  assert.equal(det.update(off.dist), false); assert.equal(det.update(off.dist), false); assert.equal(det.update(off.dist), true);
  det.reset(); det.update(off.dist); assert.equal(det.update(5), false, 'single good fix resets');
});
test('currentStep picks next maneuver', () => { const m = [{ begin_shape_index: 0 }, { begin_shape_index: 10 }, { begin_shape_index: 20 }]; assert.equal(currentStep(m, 0), 1); assert.equal(currentStep(m, 12), 2); assert.equal(currentStep(m, 25), 2); });
test('truckCosting converts imperial', () => { const c = truckCosting({ heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, hazmat: true });
  assert.equal(c.height, 4.11); assert.equal(c.weight, 36.29); assert.equal(c.length, 21.34); assert.equal(c.hazmat, true); assert.equal(c.axle_count, 5); });
test('fmtDist', () => { assert.equal(fmtDist(100), '350 ft'); assert.equal(fmtDist(1609.344 * 2.5), '2.5 mi'); assert.equal(fmtDist(500, 'km'), '500 m'); });
const T0 = Date.UTC(2026, 9, 21, 0);
test('HOS fresh shift', () => { const s = hosStatus([{ t: T0 - 12 * H, s: 'off' }], T0); assert.equal(s.driveLeft, 11 * H); assert.equal(s.windowLeft, 14 * H); });
test('HOS 8h driving requires break; 30m off clears it', () => {
  const ev = [{ t: T0 - 12 * H, s: 'off' }, { t: T0, s: 'on' }, { t: T0 + 0.5 * H, s: 'drive' }];
  let s = hosStatus(ev, T0 + 8.5 * H); assert.equal(s.breakLeft, 0); assert.ok(s.warnings.includes('30-minute break required now'));
  assert.equal(s.driveLeft, 3 * H); assert.equal(s.windowLeft, 5.5 * H);
  ev.push({ t: T0 + 8.5 * H, s: 'off' }, { t: T0 + 9 * H, s: 'drive' });
  s = hosStatus(ev, T0 + 9 * H); assert.equal(s.breakLeft, 8 * H);
});
test('HOS 11h limit and 14h window', () => {
  const ev = [{ t: T0 - 11 * H, s: 'off' }, { t: T0, s: 'drive' }, { t: T0 + 6 * H, s: 'off' }, { t: T0 + 7 * H, s: 'drive' }];
  let s = hosStatus(ev, T0 + 12 * H); assert.equal(s.driveLeft, 0); assert.ok(s.warnings.includes('11-hour driving limit reached'));
  const ev2 = [{ t: T0 - 11 * H, s: 'off' }, { t: T0, s: 'on' }, { t: T0 + 1 * H, s: 'off' }, { t: T0 + 13.5 * H, s: 'drive' }];
  // 12.5h off is a reset → new shift
  s = hosStatus(ev2, T0 + 14 * H); assert.equal(s.windowLeft, 13.5 * H);
  const ev3 = [{ t: T0 - 11 * H, s: 'off' }, { t: T0, s: 'on' }, { t: T0 + 1 * H, s: 'off' }, { t: T0 + 5 * H, s: 'drive' }];
  s = hosStatus(ev3, T0 + 14.2 * H); assert.equal(s.windowLeft, 0); assert.equal(s.driveLeft, 0);
});
test('10h split of off+sleeper counts as reset', () => { const ev = [{ t: T0, s: 'drive' }, { t: T0 + 5 * H, s: 'off' }, { t: T0 + 7 * H, s: 'sb' }, { t: T0 + 15 * H, s: 'drive' }];
  assert.equal(hosStatus(ev, T0 + 16 * H).driveLeft, 10 * H); });
test('POI classify + query', () => { assert.equal(classifyPoi({ amenity: 'fuel', name: "Love's Travel Stop" }), 'stop'); assert.equal(classifyPoi({ amenity: 'weighbridge' }), 'weigh'); assert.equal(classifyPoi({ highway: 'rest_area' }), 'rest');
  assert.match(overpassQuery([[-74, 40], [-74.1, 40.1]]), /around:1500,40\.00000,-74\.00000,40\.10000,-74\.10000/); });
import { speakable } from '../js/logic.js';
test('voice normalization', () => {
  const c = [['Take the Interstate 2 78 West ramp.', 'Take the Interstate 278 West ramp.'], ['Turn left onto I 278 W.', 'Turn left onto Interstate 278 West.'], ['Merge onto I-95 S/NJ Tpke', 'Merge onto Interstate 95 South/New Jersey Turnpike'],
    ['Keep right toward US 1/US 9 Truck', 'Keep right toward U.S. Route 1/U.S. Route 9 Truck'], ['Continue on NJ 24.', 'Continue on New Jersey Route 24.'], ['Turn right onto NY-9A', 'Turn right onto New York Route 9A'],
    ['Take exit 13A onto Garden State Pkwy', 'Take exit 13A onto Garden State Parkway'], ['Bruckner Expy', 'Bruckner Expressway'], ['Turn left onto Doremus Ave.', 'Turn left onto Doremus Avenue.'],
    ['Turn right onto 2nd Street.', 'Turn right onto 2nd Street.'], ['Bear right onto CR 508', 'Bear right onto County Route 508'], ['Interstate 87 North', 'Interstate 87 North']];
  for (const [a, b] of c) assert.equal(speakable(a), b);
});
import { promptFor, rejoinVias, squarePolygon, detourMinutes, labelAlternatives, tilesForLine, pointAlong } from '../js/logic.js';
import { levelFor, earnedBadges, updateStreak, DrivingMonitor, reportVisible, weekKey } from '../js/community.js';
import { Voice, PERSONALITIES } from '../js/voice.js';
test('accuracy-gated off-route (Ferrostar style)', () => { const d = new OffRouteDetector({ threshold: 50, needed: 3, minAccuracy: 30 });
  for (let i = 0; i < 5; i++) assert.equal(d.update(400, 80), false, 'fuzzy fixes never trigger'); assert.equal(d.ignored, 5);
  d.update(400, 10); d.update(400, 10); assert.equal(d.update(400, 10), true); });
test('highway prompts at 2 mi, 1 mi, 1/4 mi then at turn; never repeats or goes backwards', () => { const sp = {}; const got = [];
  for (let m = 3.5 * 1609; m > 0; m -= 100) { const k = promptFor(m, 29, sp, 20); if (k) got.push(k); } assert.deepEqual(got, ['2mi', '1mi', 'qmi', 'near']);
  const sp2 = {}; assert.equal(promptFor(1200, 29, sp2, 20), '1mi'); assert.equal(promptFor(3000, 29, sp2, 20), null);
  const city = {}; const g2 = []; for (let m = 1500; m > 0; m -= 20) { const k = promptFor(m, 10, city, 10); if (k) g2.push(k); } assert.deepEqual(g2, ['far', 'near']); });
test('rejoin vias are on chosen route ahead of truck', () => { const line = []; for (let i = 0; i <= 100; i++) line.push([-74 + i * 0.001, 40]); const cum = cumulative(line);
  const v = rejoinVias(line, cum, 1000, { ahead: 1500, max: 2 }); assert.equal(v.length, 2); assert.ok(v.every(p => p[1] === 40 && p[0] > -74 + 0.02));
  assert.deepEqual(rejoinVias(line, cum, cum.at(-1) - 1000), []); });
test('avoid polygon ~50 m square, closed ring', () => { const p = squarePolygon(-74, 40, 25); assert.equal(p.length, 5); assert.deepEqual(p[0], p[4]); const w = haversine(p[0], p[1]); assert.ok(w > 45 && w < 55, w); });
test('pointAlong + detour minutes', () => { const line = [[-74, 40], [-74, 40.01]], cum = cumulative(line); const m = pointAlong(line, cum, cum[1] / 2); assert.ok(Math.abs(m[1] - 40.005) < 1e-6);
  assert.equal(detourMinutes(50), 1); assert.equal(detourMinutes(1600), 7); });
test('route alternatives labels', () => { const mk = (len, time, toll, n) => ({ length: len, time, summary: { has_toll: toll }, maneuvers: Array(n).fill({}) });
  const L = labelAlternatives([mk(40000, 3000, true, 20), mk(38000, 3300, false, 12)], mk(39000, 2800, false, 10));
  assert.ok(L[0].includes('Fastest') && L[0].includes('Has tolls')); assert.ok(L[1].includes('Shortest') && L[1].includes('No tolls') && L[1].includes('Fewest turns') && L[1].includes('+5 min')); });
test('offline tiles cover corridor', () => { const t = tilesForLine([[-73.88, 40.81], [-74.16, 40.69]], [14], 1); assert.ok(t.length > 30 && t.length < 400, t.length); assert.ok(t.every(x => x.startsWith('14/'))); });
test('truck costing tuned', () => { const c = truckCosting({ heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5 }); assert.equal(c.use_truck_route, 0.8); assert.equal(c.low_class_penalty, 60); assert.equal(c.axle_load, 9.07); });
test('levels, badges, streak, week', () => { assert.equal(levelFor(0).name, 'Rookie'); assert.equal(levelFor(650).name, 'Gear Jammer'); assert.ok(Math.abs(levelFor(400).progress - 0.5) < 1e-9);
  assert.deepEqual(earnedBadges({ reports: 1, miles: 150, confirmed: 0, onTime: 0, breaks: 0, safeTrips: 0, streak: 0 }), ['first_report', 'miles100']);
  const s = {}; const d0 = Date.UTC(2026, 9, 19, 12); updateStreak(s, d0); updateStreak(s, d0 + 864e5); updateStreak(s, d0 + 864e5 + 3600e3); assert.equal(s.streak, 2); updateStreak(s, d0 + 4 * 864e5); assert.equal(s.streak, 1);
  assert.equal(weekKey(Date.UTC(2026, 9, 21, 12)), '2026-10-19'); });
test('hard braking from GPS speed', () => { const m = new DrivingMonitor(); m.update({ speed: 25, t: 0 }); m.update({ speed: 24, t: 1000 }); assert.ok(m.safe()); m.update({ speed: 19, t: 2000 }); assert.equal(m.hardBrakes, 1); assert.ok(!m.safe()); });
test('report visibility: votes + expiry', () => { const now = Date.now(); assert.ok(reportVisible({ type: 'police', t: now - 30 * 60e3 }, now)); assert.ok(!reportVisible({ type: 'police', t: now - 2 * 3600e3 }, now));
  assert.ok(reportVisible({ type: 'police', t: now - 2 * 3600e3, up: 2 }, now)); assert.ok(!reportVisible({ type: 'clearance', t: now, down: 3, up: 0 }, now)); assert.ok(reportVisible({ type: 'clearance', t: now - 99 * 864e5 }, now)); });
test('voice personalities rephrase + normalize', () => { const v = new Voice({ personality: 'oldschool' }); assert.match(v.phrase('Weigh station in two miles.', 'weigh'), /chicken coop/);
  const n = new Voice({ personality: 'nyc' }); assert.equal(n.phrase('Turn left onto I 278 W.', 'turn'), 'Ay, turn left onto Interstate 278 West.');
  assert.ok(Object.keys(PERSONALITIES).length >= 4); assert.match(new Voice({ personality: 'copilot' }).phrase('x', 'arrive'), /arrived/); });
import { parseLengthM, parseWeightT, dangersAhead, detectCurves, wrongRoad, wzdxToZones, ftIn } from '../js/safety.js';
test('parse OSM maxheight / maxweight', () => { assert.ok(Math.abs(parseLengthM(`12'6"`) - 3.81) < 0.01); assert.ok(Math.abs(parseLengthM('11 ft 8 in') - 3.556) < 0.01); assert.equal(parseLengthM('4.1'), 4.1); assert.equal(parseLengthM('3.5 m'), 3.5); assert.equal(parseLengthM('none'), null);
  assert.ok(Math.abs(parseWeightT('50000 lbs') - 22.68) < 0.01); assert.ok(Math.abs(parseWeightT('80 st') - 72.57) < 0.01); assert.equal(parseWeightT('10'), 10); assert.equal(ftIn(3.81), '12 foot 6'); });
test('look-ahead dangers compare to truck profile', () => { const truck = { heightM: 4.115, weightT: 36.3, lengthM: 21.3, hazmat: true };
  const edges = [{ along: 100, way_id: 1 }, { along: 500, way_id: 2 }, { along: 900, way_id: 3, tunnel: true }, { along: 1500, way_id: 4, max_downward_grade: -7, length: 900 }, { along: 2000, way_id: 5 }, { along: 2100, way_id: 6 }];
  const d = dangersAhead(edges, { 1: { maxheight: `12'6"` }, 2: { maxheight: `13'9"` }, 3: { maxheight: '4.5', 'hazmat:adr_tunnel_cat': 'D' }, 5: { maxweight: '50000 lbs' }, 6: { maxheight: '4.6' } }, truck);
  const k = d.map(x => x.kind + ':' + x.sev);
  assert.deepEqual(k, ['height:stop', 'height:warn', 'hazmat:stop', 'tunnel:warn', 'grade:warn', 'weight:stop']);
  assert.match(d[0].text, /Low clearance 12 foot 6 ahead\. Your truck is 13 foot 6/); });
test('sharp curve detection ignores maneuvers', () => { const line = []; for (let i = 0; i <= 20; i++) line.push([-74 + i * 0.0005, 40]); for (let i = 1; i <= 20; i++) line.push([-74 + 20 * 0.0005, 40 + i * 0.0005]);
  const cum = line.reduce((a, p, i) => (a.push(i ? a[i - 1] + haversine(line[i - 1], p) : 0), a), []);
  assert.equal(detectCurves(line, cum, []).length, 1); assert.equal(detectCurves(line, cum, [20]).length, 0); });
test('wrong-road check', () => { assert.match(wrongRoad({ edge: { access: { truck: false } } }).text, /closed to trucks/); assert.equal(wrongRoad({ edge: { access: { truck: true }, classification: { classification: 'residential', use: 'road' } } }), null);
  assert.match(wrongRoad({ edge: { access: { truck: true }, classification: { classification: 'residential', use: 'road' } } }, { offRoute: true }).short, /Residential/); });
test('WZDx closures parsing', () => { const now = Date.parse('2026-10-21T20:00:00Z'); const f = (desc, s, e, vi = 'all-lanes-open') => ({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[-74, 40]] }, properties: { start_date: s, end_date: e, vehicle_impact: vi, core_details: { description: desc } } });
  const z = wzdxToZones({ features: [f('Roadwork, right lane closed', '2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z'), f('Ramp closed to all traffic', '2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z'), f('Bridge work', '2026-10-25T00:00:00Z', '2026-10-26T00:00:00Z'), f('x', '2026-10-20T00:00:00Z', '2026-10-20T05:00:00Z', 'all-lanes-closed')] }, now);
  assert.equal(z.length, 2); assert.equal(z[0].closed, false); assert.equal(z[1].closed, true); });
import { encodePolyline } from '../js/logic.js';
test('polyline encode/decode roundtrip', () => { const c = [[-73.88031, 40.81281], [-74.158, 40.6879], [-74.2, 40.7]]; assert.deepEqual(decodePolyline(encodePolyline(c)).map(p => p.map(v => +v.toFixed(5))), c); });
test('HOS 70-hour/8-day cycle and 34-hour restart', () => { const ev = []; let t = T0;
  for (let d = 0; d < 6; d++) { ev.push({ t, s: 'drive' }, { t: t + 11 * H, s: 'on' }, { t: t + 12 * H, s: 'off' }); t += 24 * H; } // 6 days × 12h on duty = 72h
  let s = hosStatus(ev, t); assert.equal(s.cycleLeft, 0); assert.equal(s.driveLeft, 0); assert.ok(s.warnings.some(w => /70-hour cycle used up/.test(w)));
  assert.equal(hosStatus(ev, t, { cycle: 60 }).cycleLeft, 0);
  ev.push({ t: t + 34 * H, s: 'drive' }); s = hosStatus(ev, t + 35 * H); assert.equal(s.cycleLeft, 69 * H); });
import { milesByState, tollMiles, tollSegments, limitAt, effectiveLimitMph, isSpeeding, laneIntersections, lanesHTML, fuelPlan, weatherForTrucks, fatigueDue, remainingStops } from '../js/trip.js';
test('IFTA miles by state + tolls', () => { const e = [{ length: 1609.344 * 3, end_node: { admin_index: 0 }, toll: false, along: 0 }, { length: 1609.344 * 2, end_node: { admin_index: 1 }, toll: true, names: ['NJ Turnpike'], along: 4828 }];
  assert.deepEqual(milesByState(e, [{ state_code: 'NY' }, { state_code: 'NJ' }]), { NY: 3, NJ: 2 }); assert.equal(tollMiles(e), 2); assert.deepEqual(tollSegments(e)[0].names, ['NJ Turnpike']); });
test('speed limit lookup + truck cap', () => { const e = [{ along: 0, length: 1000, speed_limit: 88 }, { along: 1000, length: 1000, speed_limit: 40 }];
  assert.equal(limitAt(e, 500), 88); assert.equal(limitAt(e, 1500), 40); assert.equal(effectiveLimitMph(88, 65), 55); assert.equal(effectiveLimitMph(113, 65), 65); assert.equal(effectiveLimitMph(null, 62), 62);
  assert.ok(isSpeeding(61, 55)); assert.ok(!isSpeeding(59, 55)); });
test('lanes from OSRM steps', () => { const r = { legs: [{ steps: [{ intersections: [{ location: [1, 2], lanes: [{ indications: ['left'], valid: false }, { indications: ['straight', 'right'], valid: true, valid_indication: 'right' }] }] }] }] };
  const L = laneIntersections(r); assert.equal(L.length, 1); const h = lanesHTML(L[0].lanes); assert.match(h, /lane ok">↱/); assert.match(h, /↰/); });
test('fuel plan picks last station within range, flags gaps', () => { const MI = 1609.344, st = [100, 250, 400, 520].map(m => ({ along: m * MI, off: 200, name: 'S' + m }));
  const p = fuelPlan(700 * MI, st, 400, { reserve: 0.25 }); assert.deepEqual(p.map(s => s.name), ['S250', 'S520']);
  const g = fuelPlan(900 * MI, [{ along: 100 * MI, off: 0 }], 300, {}); assert.ok(g.some(s => s.gap)); });
test('weather filter for trucks', () => { const w = weatherForTrucks([{ properties: { id: 1, event: 'High Wind Warning', severity: 'Severe' } }, { properties: { id: 2, event: 'Air Quality Alert' } }, { properties: { id: 3, event: 'Winter Storm Watch', severity: 'Moderate' } }]);
  assert.equal(w.length, 2); assert.ok(w[0].highWind); assert.match(w[1].advice, /chain/); });
test('fatigue reminders every 2h', () => { assert.equal(fatigueDue(119), 0); assert.equal(fatigueDue(121), 1); assert.equal(fatigueDue(130, 1), 0); assert.equal(fatigueDue(245, 1), 2); });
test('remaining stops', () => { assert.equal(remainingStops([{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }], { lon: 0, lat: 0.0005 }).length, 1); });

// ---- My voice (ElevenLabs cloning), API mocked ----
import { MyVoice, cacheKey, COMMON } from '../js/myvoice.js';
const memLS = () => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const memStore = () => { const m = new Map(); return { m, get: async k => m.get(k) || null, put: async (k, v) => m.set(k, v), clear: async () => m.clear() }; };
test('myvoice: clone requires consent + key, posts sample, saves voice_id', async () => {
  const calls = []; const f = async (u, o) => { calls.push([u, o]); return { ok: true, json: async () => ({ voice_id: 'v123' }) }; };
  const mv = new MyVoice({ fetchFn: f, store: memStore(), storage: memLS() });
  await assert.rejects(mv.clone(new Blob(['x'])), /Consent/); mv.consent = true;
  await assert.rejects(mv.clone(new Blob(['x'])), /API key/); mv.key = 'k';
  assert.equal(await mv.clone(new Blob(['x'], { type: 'audio/webm' })), 'v123');
  assert.match(calls[0][0], /\/voices\/add$/); assert.equal(calls[0][1].headers['xi-api-key'], 'k'); assert.ok(calls[0][1].body.get('files'));
  assert.ok(mv.ready); assert.equal(new MyVoice({ storage: mv.ls }).voiceId, 'v123', 'persisted on device');
});
test('myvoice: tts caches clips, second call is offline-safe', async () => {
  let n = 0; const f = async (u, o) => { n++; assert.match(u, /text-to-speech\/v1/); assert.equal(JSON.parse(o.body).model_id, 'eleven_flash_v2_5'); return { ok: true, blob: async () => new Blob(['mp3']) }; };
  const st = memStore(); const mv = new MyVoice({ fetchFn: f, store: st, storage: memLS() }); mv.key = 'k'; mv.voiceId = 'v1';
  assert.equal((await mv.tts('Turn left.')).cached, false); assert.equal((await mv.tts('turn left.')).cached, true); assert.equal(n, 1);
  assert.ok(st.m.has(cacheKey('v1', 'Turn left.')));
  const mv2 = new MyVoice({ fetchFn: async () => { throw new Error('no net'); }, store: st, storage: memLS() }); mv2.voiceId = 'v1';
  assert.equal((await mv2.tts('Turn left.')).cached, true, 'IndexedDB clip served without network');
  assert.equal(await mv.pregenerate(COMMON), COMMON.length);
});
test('myvoice: API errors surface and voice falls back', async () => {
  const mv = new MyVoice({ fetchFn: async () => ({ ok: false, status: 401, json: async () => ({ detail: { message: 'Invalid API key' } }) }), store: memStore(), storage: memLS() });
  mv.key = 'bad'; mv.voiceId = 'v'; await assert.rejects(mv.tts('Hi'), /401: Invalid API key/);
});
import { paddOf, eiaFor, latestPrices, bestFuel, ageText } from '../js/trip.js';
import { amenitiesOf, attachAmenities, amenityLine, nextWithAmenity, isHelperAmenity } from '../js/logic.js';
test('EIA regional baseline', () => { const e = { week: '10/19/26', prices: { US: 6.2, PADD1B: 6.5, CA: 8.2, PADD5X: 6.6 } };
  assert.equal(paddOf('NJ'), '1B'); assert.equal(eiaFor('NJ', e).price, 6.5); assert.equal(eiaFor('CA', e).price, 8.2); assert.equal(eiaFor('OR', e).price, 6.6); assert.equal(eiaFor('TX', e).price, 6.2); });
test('driver prices expire + best price ranking with detour cost', () => { const now = Date.now();
  const lp = latestPrices([{ type: 'fuel_price', poi: 'a', price: 5.9, t: now - 3600e3 }, { type: 'fuel_price', poi: 'a', price: 5.8, t: now - 60e3 }, { type: 'fuel_price', poi: 'b', price: 5.5, t: now - 30 * 3600e3 }], now);
  assert.equal(lp.a.price, 5.8); assert.ok(!lp.b);
  const r = bestFuel([{ id: 'near', price: 6.0, off: 100 }, { id: 'far', price: 5.95, off: 16093 }], { gallons: 100, mpg: 6.5, baseline: 6.5 });
  assert.equal(r[0].id, 'near'); assert.equal(r[0].save, 50 - 0); assert.ok(r[1].save < r[0].save); assert.equal(ageText(now - 5 * 60e3, now), '5 min ago'); });
test('amenities: tags, chains, nearby nodes, confirmations', () => {
  assert.equal(amenitiesOf({ amenity: 'fuel', brand: "Love's" }, 'stop').showers, 'chain'); assert.equal(amenitiesOf({ amenity: 'fuel', shower: 'yes' }, 'fuel').showers, 'tagged'); assert.equal(amenitiesOf({ amenity: 'fuel', name: 'Shell' }, 'fuel').showers, null);
  assert.ok(isHelperAmenity({ amenity: 'fast_food' })); assert.ok(!isHelperAmenity({ amenity: 'fuel' }));
  const pois = [{ id: 'x', kind: 'rest', lon: -74, lat: 40, tags: { highway: 'rest_area' }, along: 5000, off: 10 }, { id: 'y', kind: 'fuel', lon: -74.1, lat: 40, tags: { amenity: 'fuel' }, along: 9000, off: 10 }];
  attachAmenities(pois, [{ lon: -74.0005, lat: 40, tags: { amenity: 'fast_food', name: "McDonald's" } }, { lon: -74.1, lat: 40.0005, tags: { amenity: 'shower' } }], 250, { x: { showers: true } });
  assert.equal(pois[0].amen.food, 'nearby'); assert.equal(pois[0].amen.showers, 'driver-confirmed'); assert.equal(pois[1].amen.showers, 'nearby'); assert.match(amenityLine(pois[0].amen), /Showers · 🚻 Restrooms · 🍔 Food \(McDonald's\)/);
  assert.equal(nextWithAmenity(pois, 6000, 'showers').id, 'y'); assert.equal(nextWithAmenity(pois, 0, 'food').id, 'x'); });

import { OffRouteDetector as ORD2, etaRemaining, EtaSmoother, PuckFilter } from '../js/logic.js';
test('off-route: fast fixes count double, heading check catches parallel road', () => {
  const d = new ORD2({ threshold: 50, needed: 3 }); d.update(80, 5, { speed: 25 }); assert.equal(d.update(80, 5, { speed: 25 }), true);
  const s = new ORD2({ threshold: 50, needed: 3 }); s.update(80, 5, { speed: 3 }); assert.equal(s.update(80, 5, { speed: 3 }), false);
  const h = new ORD2(); for (let i = 0; i < 3; i++) h.update(25, 5, { speed: 10, heading: 180, segBearing: 0 }); assert.equal(h.state, 'needsRebuild');
  const ok = new ORD2(); for (let i = 0; i < 5; i++) ok.update(10, 5, { speed: 10, heading: 5, segBearing: 0 }); assert.equal(ok.state, 'on'); });
test('ETA sums remaining maneuver times and is smoothed', () => {
  const r = { maneuvers: [{ time: 0, length: 0 }, { time: 600, length: 10 }, { time: 60, length: 0.5 }, { time: 0, length: 0 }] };
  assert.equal(Math.round(etaRemaining(r, 2, 5000)), 360); // half of 600 s highway leg + 60 s city leg
  const e = new EtaSmoother(); const t0 = 1e12; const a = e.update(1000, t0).arrival; assert.equal(e.update(1030, t0 + 1000).arrival, a);
  assert.equal(e.update(1000 + 600, t0 + 2000).arrival !== a, true); });
test('puck filter: ignores bad accuracy, holds heading when slow', () => {
  const f = new PuckFilter(); f.update({ lon: 0, lat: 0, acc: 5, speed: 10, heading: 90 }); const p = f.update({ lon: 1, lat: 1, acc: 200, speed: 10, heading: 0 }); assert.equal(p.lon, 0);
  assert.equal(f.update({ lon: 0, lat: 0.00001, acc: 5, speed: 0.5, heading: 270 }).heading, 90); });
import { sunAltitude, isDaylight } from '../js/logic.js';
test('sun altitude / auto day-night for NYC', () => {
  assert.ok(sunAltitude(40.71, -74.0, new Date('2026-06-21T16:50:00Z')) > 70); // ~local solar noon in June
  assert.ok(sunAltitude(40.71, -74.0, new Date('2026-10-22T04:00:00Z')) < -30); // midnight
  assert.equal(isDaylight(40.71, -74.0, new Date('2026-10-21T16:00:00Z')), true); assert.equal(isDaylight(40.71, -74.0, new Date('2026-10-22T00:30:00Z')), false); });
import { railItems, distLabel } from '../js/rail.js';
test('restriction rail: nearest 3 restrictions/scales ahead with values', () => {
  const it = railItems({ along: 1000, dangers: [{ kind: 'height', sev: 'warn', along: 20000, short: `Tight clearance 13'8"` }, { kind: 'weight', sev: 'stop', along: 5000, short: 'Weight limit 40k lb' }, { kind: 'curve', along: 3000 }, { kind: 'height', along: 500, short: `Low bridge 11'0"` }],
    pois: [{ kind: 'weigh', along: 80000, name: 'I-95 scale' }, { kind: 'fuel', along: 2000 }] });
  assert.deepEqual(it.map(x => x.kind), ['weight', 'height', 'weigh']); assert.equal(it[0].value, '40k'); assert.equal(it[1].value, `13'8"`); assert.equal(distLabel(it[0].dist), '2 mi'); });
import { freshness, receipt, receiptCSV } from '../js/fresh.js';
test('freshness labels: just now / min ago, stale after threshold', () => { const n = 1e12;
  assert.deepEqual(freshness(n - 20e3, n), { text: 'just now', stale: false }); assert.deepEqual(freshness(n - 12 * 60e3, n, 10), { text: '12 min ago', stale: true }); assert.equal(freshness(0, n).stale, true); });
test('trip receipt scales planned state split to driven miles', () => {
  const r = receipt({ start: 0, end: 125 * 60e3, drivenMi: 50, plannedByState: { NY: 30, NJ: 70 } });
  assert.equal(r.dur, '2h 05m'); assert.deepEqual(r.states, [{ st: 'NJ', mi: 35 }, { st: 'NY', mi: 15 }]); assert.equal(r.avgMph, 24); const c = receiptCSV({ ...r, unit: 'T-12' }); assert.match(c, /NJ,35.0/); assert.match(c, /TOTAL,50/); });
test('receipt: state miles always sum to the total; id, unit, odometer', () => {
  const r = receipt({ start: 1.7e12, end: 1.7e12 + 3600e3, drivenMi: 10, plannedByState: { NY: 1, NJ: 1, CT: 1 }, unit: '42', odoStart: 120000 });
  assert.equal(r.states.reduce((a, b) => a + Math.round(b.mi * 10), 0), 100); assert.match(r.id, /^RR-\d{8}-[0-9A-Z]{4}$/); assert.equal(r.odoEnd, 120010); assert.equal(r.unit, '42');
  assert.deepEqual(receipt({ start: 0, end: 1, drivenMi: 3.2 }).states, [{ st: 'Unknown', mi: 3.2 }]); });
import { smoothBearing } from '../js/logic.js';
test('camera bearing turns gradually along the shortest arc', () => {
  assert.equal(smoothBearing(null, 90), 90); const b = smoothBearing(350, 10); assert.ok(b > 350 || b < 10, 'wraps through north'); assert.ok(Math.abs(smoothBearing(0, 180) - 25) < 1e-9 || Math.abs(smoothBearing(0, 180) - 335) < 1e-9, 'max 25° per fix'); assert.equal(smoothBearing(45, null), 45); });
import { tooFar, held, MAX_REPORT_M } from '../js/hazlogic.js';
test('hazard abuse: >2 km from reporter rejected; new reporters held until confirmed', () => {
  assert.equal(MAX_REPORT_M, 2000); assert.equal(tooFar({ lat: 40.70, lon: -74, rlat: 40.71, rlon: -74 }), false); assert.equal(tooFar({ lat: 40.70, lon: -74, rlat: 40.73, rlon: -74 }), true); assert.equal(tooFar({ lat: 40.7, lon: -74 }), true);
  const t = new Set(); assert.equal(held({ by: 'x', up: 0 }, t), true); assert.equal(held({ by: 'x', up: 1 }, t), false); t.add('x'); assert.equal(held({ by: 'x', up: 0 }, t), false); assert.equal(held({ by: 'y', mine: true }, new Set()), false); });

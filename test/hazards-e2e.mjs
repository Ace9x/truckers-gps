// Live hazard sharing over REAL public Nostr relays: 3 separate browser contexts (separate storage = separate drivers).
// BASE=url node test/hazards-e2e.mjs
import { chromium, devices } from 'playwright'; import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/', SHOTS = '/workspace/truckers-gps-shots/hazards', N = +(process.env.WAIT_S || 30);
mkdirSync(SHOTS, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// unique spot each run so earlier runs' reports don't interfere: somewhere along I-95 in the Bronx, jittered
const j = Math.random() * 0.06, L = -73.95 + Math.random() * 0.12, A_POS = { latitude: 40.8350 + j, longitude: L }, B_POS = { latitude: 40.8200 + j, longitude: L }, C_POS = { latitude: 39.9526, longitude: -75.1652 };
const browser = await chromium.launch();
async function driver(name, geo, clock) { const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: geo, permissions: ['geolocation'] });
  const page = await ctx.newPage(); page.on('pageerror', e => { console.log(name, 'PAGE ERROR', e.message); fails++; });
  if (clock) await page.clock.install();
  await page.goto(BASE); await page.waitForFunction(() => window.TruckNav?.ready && TruckNav.pos && TruckNav.hz, null, { timeout: 30000 });
  await page.waitForFunction(() => /live/.test(TruckNav.hz.status), null, { timeout: 20000 }); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('#splash')?.remove()); return page; }
const t0 = Date.now();
const [A, B, C] = await Promise.all([driver('A', A_POS), driver('B', B_POS, true), driver('C', C_POS)]);
ok(true, `3 drivers online over public relays: ${await A.evaluate(() => TruckNav.hz.relays.filter(r => r.open).map(r => r.url).join(', '))}`);
// B is driving north (heading 0) toward A's spot
await B.evaluate(() => { TruckNav.pos.heading = 0; });
// A files 3 reports via the one-tap UI (tap ⚠ → tap type)
const near = [[40.8350 + j, L], [40.8330 + j, L + 0.0002], [40.8370 + j, L - 0.0002]];
const types = ['accident', 'police', 'construction']; let ts;
ts = Date.now(); await A.click('#reportBtn'); await A.waitForSelector('#hzGrid'); await A.screenshot({ path: `${SHOTS}/01-one-tap-grid.png` });
for (let i = 0; i < 3; i++) { await A.evaluate(([lat, lon]) => { TruckNav.pos = { ...TruckNav.pos, lat, lon }; }, near[i]); if (i) await A.click('#reportBtn'); await A.click(`#hzGrid [data-hz="${types[i]}"]`); }
const aIds = await A.evaluate(() => TruckNav.hz.list.filter(r => r.mine).map(r => ({ id: r.id, type: r.type })));
ok(aIds.length === 3, `A filed 3 reports: ${aIds.map(r => r.type).join(', ')}`);
const dup = await A.evaluate(([lat, lon]) => { TruckNav.pos = { ...TruckNav.pos, lat, lon }; const before = TruckNav.hz.list.length; TruckNav.hzFile('accident', true); return TruckNav.hz.list.length - before + 1; }, near[0]);
ok(dup === 1, 'A re-reporting the same accident is deduped (no second pin)');
await A.screenshot({ path: `${SHOTS}/02-driver-A-filed.png` });
// B sees them
const got = await B.waitForFunction(ids => ids.every(x => TruckNav.hz.visible().some(r => r.id === x.id)), aIds, { timeout: N * 1000, polling: 250 }).then(() => true).catch(() => false);
ok(got, `driver B (1.7 km south) received all 3 over the relays within ${((Date.now() - ts) / 1000).toFixed(1)} s of A's first tap (limit ${N} s)`);
await B.evaluate(() => { const m = TruckNav.map; m.jumpTo({ center: [TruckNav.pos.lon, TruckNav.pos.lat + 0.008], zoom: 14.3 }); });
await B.clock.runFor(6000); await B.waitForTimeout(800);
const bv = await B.evaluate(() => ({ pins: [...document.querySelectorAll('.hz-pin')].map(e => e.dataset.hz), calls: [...document.querySelectorAll('.hz-pin .hz-call')].filter(e => e.style.display !== 'none').map(e => e.textContent), ahead: TruckNav.hzAhead, alert: TruckNav.hzLastAlert, banner: document.querySelector('#hzBanner')?.textContent || TruckNav.hzLastBanner /* banner auto-dismisses after 8 s */ }));
ok(types.every(t => bv.pins.includes(t)), `B's map shows pins: ${bv.pins.join(', ')}`);
ok(bv.calls.length >= 3, `B sees callouts: ${bv.calls.join(' | ')}`);
ok(/reported ahead in/.test(bv.alert || '') && bv.banner, `B gets approaching alert: voice "${bv.alert}", banner "${bv.banner}"`);
await B.screenshot({ path: `${SHOTS}/03-driver-B-sees-reports.png` });
await B.evaluate(id => { const el = document.querySelector(`.hz-pin[data-id="${id}"]`); TruckNav.map.jumpTo({ center: TruckNav.hz.byId.get(id) ? [TruckNav.hz.byId.get(id).lon, TruckNav.hz.byId.get(id).lat - 0.004] : TruckNav.map.getCenter() }); el.click(); }, aIds[1].id); await B.waitForTimeout(500); await B.screenshot({ path: `${SHOTS}/04-driver-B-popup-vote.png` });
// B votes thumbs-up on police → A sees the vote
await B.click('.maplibregl-popup [data-v="up"]');
const upSeen = await A.waitForFunction(id => TruckNav.hz.byId.get(id)?.up >= 1, aIds[1].id, { timeout: N * 1000 }).then(() => true).catch(() => false);
ok(upSeen, `A sees B's 👍 "still there" on the police report`);
// C far away (Philadelphia) never gets them
await C.waitForTimeout(3000);
const cv = await C.evaluate(ids => ({ n: TruckNav.hz.list.filter(r => ids.includes(r.id)).length, pins: document.querySelectorAll('.hz-pin').length, cells: TruckNav.hz.cells.length }), aIds.map(x => x.id));
ok(cv.n === 0, `far driver C (Philadelphia, ~130 km) received none of them (${cv.pins} pins from other drivers in its own area)`);
// expiry with mocked clock: +61 min → police (1h) gone; +2h1m → accident (2h) gone, construction (24h) stays and faded
const op0 = await B.evaluate(id => +document.querySelector(`.hz-pin[data-id="${id}"]`)?.dataset.op, aIds[2].id);
await B.clock.fastForward('02:01:00'); await B.clock.runFor(6000); await B.waitForTimeout(500);
const after = await B.evaluate(() => [...document.querySelectorAll('.hz-pin')].map(e => ({ t: e.dataset.hz, op: +e.dataset.op, id: e.dataset.id })));
const has = t => after.some(x => x.t === t && x.id);
ok(!has('accident'), 'after 2 h 01 m (mocked clock) the accident report has expired and its pin is gone');
ok(!has('police') , 'police report (1 h, +1 h from the 👍) expired');
const con = after.find(x => x.id === aIds[2].id); ok(con && con.op < op0, `construction (24 h) still shown, faded ${op0} → ${con?.op}`);
await B.screenshot({ path: `${SHOTS}/05-driver-B-after-2h.png` });
// two "not there" votes remove a report: A files debris, B and C... use two fresh contexts as voters
const deb = await A.evaluate(() => { TruckNav.pos = { ...TruckNav.pos, lat: TruckNav.pos.lat + 0.004 }; return TruckNav.hzFile('debris', true).rep.id; });
const [V1, V2] = await Promise.all([driver('V1', A_POS), driver('V2', A_POS)]);
for (const V of [V1, V2]) { await V.waitForFunction(id => TruckNav.hz.byId.get(id), deb, { timeout: N * 1000 }); await V.evaluate(id => TruckNav.hz.vote(TruckNav.hz.byId.get(id), 'down'), deb); }
const gone = await A.waitForFunction(id => !TruckNav.hz.visible().some(r => r.id === id) && !document.querySelector(`.hz-pin[data-id="${id}"]`), deb, { timeout: N * 1000 }).then(() => true).catch(() => false);
ok(gone, 'two "not there" 👎 votes from two other drivers remove the debris report from A\'s map');
console.log(`\n${fails ? fails + ' FAILED' : 'ALL PASSED'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); await browser.close(); process.exit(fails ? 1 : 0);

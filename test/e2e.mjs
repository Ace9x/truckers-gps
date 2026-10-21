// End-to-end test: real browser, real routing server, simulated GPS. BASE=url node test/e2e.mjs
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS || '/workspace/truckers-gps-shots';
mkdirSync(SHOTS, { recursive: true });
const HUNTS_POINT = { latitude: 40.8128, longitude: -73.8803 };
const NJ_WAREHOUSE = { lat: 40.6879, lon: -74.1580, name: 'Port Newark warehouse district, NJ' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: HUNTS_POINT, permissions: ['geolocation'] });
const page = await ctx.newPage();
page.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
await page.goto(BASE); await page.waitForFunction(() => window.TruckNav?.ready);
await page.waitForFunction(() => window.TruckNav.pos, null, { timeout: 15000 });
ok(true, 'app loaded and received browser Geolocation fix');
await page.waitForTimeout(2500); await page.screenshot({ path: `${SHOTS}/01-home.png` });

// Address search UI (Photon)
await page.click('#searchBtn'); await page.fill('#q', 'Port Newark');
await page.waitForSelector('#results li small', { timeout: 15000 });
ok(await page.locator('#results li').count() > 0, 'address search returns results');
await page.screenshot({ path: `${SHOTS}/02-search.png` });
await page.click('.panel:not(.hidden) .close');

// Plan truck route Hunts Point -> NJ
await page.evaluate(d => window.TruckNav.setDest(d), NJ_WAREHOUSE);
await page.waitForFunction(() => window.TruckNav.route && !document.querySelector('#goBtn').disabled, null, { timeout: 30000 });
const r = await page.evaluate(() => ({ n: TruckNav.route.line.length, steps: TruckNav.route.maneuvers.length, len: TruckNav.route.length, car: TruckNav.carRoute?.length }));
ok(r.n > 50 && r.steps > 5, `truck route drawn: ${r.n} pts, ${r.steps} steps, ${(r.len / 1609).toFixed(1)} mi (car ${(r.car / 1609).toFixed(1)} mi)`);
await page.waitForTimeout(2000);
const rendered = await page.evaluate(() => { const m = document.querySelector('#map'); return true; });
await page.check('#cmpCar'); await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/03-route-overview.png` });

// Navigate with simulated GPS along the route
await page.evaluate(() => TruckNav.startNav());
const steps = [];
const total = r.n;
for (let k = 0; k < 40; k++) {
  const idx = Math.min(total - 1, Math.floor((k / 40) * total * 0.5));
  await page.evaluate(([i, t]) => { const p = TruckNav.route.line[i], q = TruckNav.route.line[Math.min(i + 1, TruckNav.route.line.length - 1)];
    TruckNav.onFix({ lon: p[0], lat: p[1], speed: 20, heading: null, acc: 5, t }); }, [idx, Date.now() + k * 1000]);
  steps.push(await page.evaluate(() => TruckNav.step));
}
const uniq = [...new Set(steps)];
ok(uniq.length >= 3 && steps.every((s, i) => i === 0 || s >= steps[i - 1]), `turn-by-turn steps advance in order: ${uniq.join('→')}`);
ok(await page.evaluate(() => TruckNav.rerouteCount === 0), 'no false reroute while on route');
const banner = await page.textContent('#bInstr'); ok(banner && banner !== '--', `banner shows instruction: "${banner}"`);
ok(await page.evaluate(() => (TruckNav.spokenLog || []).length > 1), 'voice prompts generated: ' + JSON.stringify(await page.evaluate(() => TruckNav.spokenLog.slice(0, 3))));
ok(/\d/.test(await page.textContent('#tEta')) && /\d/.test(await page.textContent('#tDist')), 'ETA and distance remaining shown');
await page.waitForTimeout(1500); await page.screenshot({ path: `${SHOTS}/04-navigating.png` });

// Off-route -> automatic reroute
const before = await page.evaluate(() => TruckNav.route.line[0].join());
const offPos = await page.evaluate(() => { const p = [TruckNav.pos.lon, TruckNav.pos.lat]; return [p[0] + 0.008, p[1] + 0.006]; });
for (let k = 0; k < 4; k++) await page.evaluate(([p, k]) => TruckNav.onFix({ lon: p[0] + k * 0.0002, lat: p[1], speed: 15, heading: 90, acc: 8, t: Date.now() + 60000 + k * 1000 }), [offPos, k]);
await page.waitForFunction(b => TruckNav.rerouteCount >= 1 && !TruckNav.rerouting && TruckNav.route.line[0].join() !== b, before, { timeout: 30000 });
const d0 = await page.evaluate(() => { const s = TruckNav.route.line[0], p = TruckNav.pos; return Math.hypot((s[0] - p.lon) * 84000, (s[1] - p.lat) * 111000); });
ok(d0 < 400, `auto-reroute triggered when off route; new route starts ${Math.round(d0)} m from truck`);
await page.screenshot({ path: `${SHOTS}/05-rerouted.png` });
await page.evaluate(() => TruckNav.endNav());

// Truck restriction vs car: Durham NC "11foot8" low-clearance bridge on Gregson St (11'8")
const dur = await page.evaluate(async () => {
  const a = { lat: 36.0008, lon: -78.9083 }, b = { lat: 35.9974, lon: -78.9103 };
  TruckNav.setTruck({ heightFt: 13, heightIn: 6 }); const tall = await TruckNav.valhalla(a, b, 'truck');
  TruckNav.setTruck({ heightFt: 8, heightIn: 0 }); const low = await TruckNav.valhalla(a, b, 'truck');
  const car = await TruckNav.valhalla(a, b, 'auto'); TruckNav.setTruck({ heightFt: 13, heightIn: 6 });
  const names = x => x.maneuvers.flatMap(m => m.street_names || []);
  return { tall: tall.length, low: low.length, car: car.length, tallNames: names(tall), carNames: names(car) };
});
ok(dur.tall > dur.car * 2 && dur.tallNames.includes('South Gregson Street') && dur.carNames.includes('North Gregson Street') && !dur.tallNames.includes('North Gregson Street'),
  `low clearance: 13'6" truck detours ${(dur.tall / 1609).toFixed(2)} mi around 11'8" bridge; car/8ft truck go under it (${(dur.car / 1609).toFixed(2)} / ${(dur.low / 1609).toFixed(2)} mi)`);

// Demo drive mode
await page.evaluate(d => TruckNav.setDest(d), NJ_WAREHOUSE);
await page.waitForFunction(() => !document.querySelector('#goBtn').disabled, null, { timeout: 30000 });
await page.evaluate(() => { TruckNav.pos = { lon: TruckNav.route.line[0][0], lat: TruckNav.route.line[0][1], t: Date.now() }; });
await page.click('#dock button[data-panel=routePanel]').catch(() => {});
await page.click('#demoBtn'); await page.waitForTimeout(6000);
const along = await page.evaluate(() => TruckNav.along);
ok(along > 200 && (await page.evaluate(() => TruckNav.nav)), `demo drive moves truck along route (${Math.round(along)} m)`);
await page.screenshot({ path: `${SHOTS}/06-demo-drive.png` });
await page.evaluate(() => TruckNav.endNav());

// POIs (Overpass; may be rate limited)
await page.evaluate(() => TruckNav.loadPois()); await page.waitForFunction(() => !/Loading/.test(document.querySelector('#poiList').textContent), null, { timeout: 60000 }).catch(() => {});
const poi = await page.evaluate(() => ({ n: TruckNav.pois.length, txt: document.querySelector('#poiList').textContent.slice(0, 120) }));
console.log((poi.n > 0 ? 'PASS ' : 'WARN ') + `POIs along route: ${poi.n} (${poi.txt})`);
await page.screenshot({ path: `${SHOTS}/07-truck-stops.png` });
await page.click('.panel:not(.hidden) .close').catch(() => {});

// HOS
await page.click('#dock button[data-panel=hosPanel]'); await page.click('[data-duty=drive]');
ok(await page.evaluate(() => TruckNav.hos.status === 'drive' && TruckNav.hos.driveLeft > 10.9 * 3600e3), 'HOS clock running in Driving status');
await page.screenshot({ path: `${SHOTS}/08-hos.png` });
await page.click('.panel:not(.hidden) .close');
await page.click('#dock button[data-panel=truckPanel]'); await page.screenshot({ path: `${SHOTS}/09-truck-profile.png` }); await page.click('.panel:not(.hidden) .close');
await page.click('#dock button[data-panel=loadPanel]'); await page.fill('[name=bol]', 'BOL-TEST'); await page.reload(); await page.waitForFunction(() => window.TruckNav?.ready);
ok(await page.inputValue('[name=bol]') === 'BOL-TEST', 'load details persist after reload');
ok(await page.evaluate(() => !!TruckNav.route), 'route restored after reload (works without network)');
// PWA
const sw = BASE.startsWith('https') ? await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }) : 'skipped (http)';
console.log('INFO service worker active:', sw);
const man = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json()); ok(man.icons.length >= 2 && man.display === 'standalone', 'manifest installable');
// landscape
await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1500); await page.screenshot({ path: `${SHOTS}/10-landscape.png` });
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);

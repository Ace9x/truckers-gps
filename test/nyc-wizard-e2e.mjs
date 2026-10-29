import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:8841/'; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok ' : 'FAIL ') + m); };
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 40.8320, longitude: -73.9150 }, permissions: ['geolocation'] });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(B + '?rrtest=1'); await p.waitForFunction(() => window.TruckNav?.plan && window.TruckNav.map?.loaded(), null, { timeout: 30000 });
// 1. real data loads; Jerome Ave is a truck route; Central Park is not
await p.evaluate(() => TruckNav.nycTruck.load()); const jer = await p.evaluate(() => TruckNav.nycTruck.nearest(-73.90645, 40.85480)); ok(jer && /JEROME/i.test(jer.name), 'Jerome Ave is a designated truck route: ' + jer?.name);
ok(!(await p.evaluate(() => TruckNav.nycTruck.nearest(-73.9654, 40.7829))), 'Central Park lawn is not a truck route');
// 2. map layer toggle
await p.evaluate(() => { document.querySelector('#layersPanel')?.classList.remove('hidden'); }); await p.waitForSelector('#nycTruckChk', { state: 'attached', timeout: 5000 });
await p.evaluate(() => { const c = document.querySelector('#nycTruckChk'); c.checked = true; c.dispatchEvent(new Event('change')); }); await p.waitForTimeout(1500);
ok(await p.evaluate(() => TruckNav.map.getLayoutProperty('nycTruck', 'visibility') === 'visible' && (TruckNav.map.getSource('nycTruck')?.serialize().data.features.length || 0) > 30000), 'NYC truck-route layer shows 30k+ real segments');
// 3. real Valhalla truck route through Manhattan: plan-time check runs on the real line
await p.evaluate(() => { TruckNav.pos = { lat: 40.8320, lon: -73.9150, speed: 0, acc: 10 }; TruckNav.dest = { lat: 40.7484, lon: -73.9857, name: 'Empire State Building' }; return TruckNav.plan(); });
await p.waitForFunction(() => TruckNav.route?.line?.length > 10, null, { timeout: 30000 }); await p.waitForTimeout(3500);
const off = await p.evaluate(() => ({ n: TruckNav.nycOff.length, note: document.querySelector('#nycOff')?.textContent || '', checked: Array.isArray(TruckNav.nycOff) }));
ok(off.checked, `plan-time truck-route check ran (${off.n} off stretches)`); ok(off.n === 0 || /Leaves NYC truck routes for \d/.test(off.note), 'route sheet note matches result: ' + (off.note || 'none (route stays on truck routes)'));
// 4. synthetic off-route stretch via a real line through Central Park: check flags it
const flagged = await p.evaluate(async () => { const { offTruckRoute, buildIndex } = await import('./js/truckroutes.js'); const d = await (await fetch('data/nyc-truck-routes.json')).json(); const ix = buildIndex(d);
  const line = [], cum = [0]; for (let i = 0; i <= 100; i++) { line.push([-73.9735 + 0.0155 * i / 100, 40.77 + 0.028 * i / 100]); if (i) cum.push(cum.at(-1) + 33.4); } return offTruckRoute(ix, line, cum, { exemptM: 200 }).length; });
ok(flagged >= 1, 'route through Central Park is flagged off-truck-route');
// 5. live warning: navigating, mid-route, off a truck route in NYC -> voice + banner
await p.evaluate(() => { const S = TruckNav; S.nav = true; S.along = 2000; S.route = { ...S.route, length: Math.max(S.route.length, 6000) }; S.pos = { lat: 40.7829, lon: -73.9654, speed: 10, acc: 5 }; });
await p.waitForFunction(() => [...document.querySelectorAll('#alerts .alert')].some(a => /Off NYC truck route/.test(a.textContent)), null, { timeout: 12000 }).then(() => ok(true, 'live off-truck-route banner shown'), () => ok(false, 'live off-truck-route banner shown'));
ok(await p.evaluate(() => TruckNav.nycTruckStatus === 'off'), 'status off while in Central Park');
await p.evaluate(() => { TruckNav.pos = { lat: 40.85480, lon: -73.90645, speed: 10, acc: 5 }; }); await p.waitForTimeout(2500); ok(await p.evaluate(() => TruckNav.nycTruckStatus === 'on'), 'status back on Jerome Ave');
await p.evaluate(() => { TruckNav.nav = false; });
// 6. wizard: 4 steps, 64px steppers, saves truck
await p.evaluate(() => { TruckNav.pos = { ...TruckNav.pos, speed: 0 }; }); await p.waitForTimeout(600); await p.evaluate(() => TruckNav.truckWizard()); await p.waitForSelector('#truckWiz [data-vtype]'); await p.click('#truckWiz .wz-next'); await p.waitForSelector('#truckWiz .wz-stepper');
const h = await p.$eval('.wz-stepper button', b => b.getBoundingClientRect().height); ok(h >= 64, 'stepper buttons are 64px: ' + h);
for (let i = 0; i < 6; i++) await p.click('.wz-stepper [data-d="-1"]'); ok((await p.textContent('.wz-stepper output')) === '13′0″', 'height stepped 13′6″ → 13′0″');
await p.screenshot({ path: '/workspace/truckers-gps-shots/r4/390-wizard-height.png' });
await p.click('.wz-next'); await p.click('.wz-stepper [data-d="-1"]'); await p.click('.wz-next'); await p.click('.wz-next'); await p.click('[data-hz="1"]'); await p.screenshot({ path: '/workspace/truckers-gps-shots/r4/390-wizard-hazmat.png' }); await p.click('.wz-next');
ok(/Spoken directions/.test(await p.textContent('#truckWiz')), 'first run continues to the voice step (design_v2 #16)'); await p.click('[data-vo="1"]'); await p.click('.wz-next');
await p.waitForSelector('.wz-saved'); ok(/13′0″/.test(await p.textContent('.wz-saved')), 'saved confirmation states the height');
const t = await p.evaluate(() => ({ ...TruckNav.truck, ls: JSON.parse(localStorage.getItem('tn_truck')) })); ok(t.heightFt === 13 && t.heightIn === 0 && t.weightLbs === 79000 && t.hazmat && t.ls.heightIn === 0, 'truck profile saved & persisted');
await p.screenshot({ path: '/workspace/truckers-gps-shots/r4/390-wizard-saved.png' }); await p.click('.wz-next'); ok(!(await p.$('#truckWiz')), 'wizard closed');
ok((await p.evaluate(() => document.querySelector('#hfH,#tH') ? 1 : 1)) && errs.length === 0, 'no page errors: ' + errs.join(' | '));
console.log(`pass=${pass} fail=${fail}`); await br.close(); process.exit(fail ? 1 : 0);

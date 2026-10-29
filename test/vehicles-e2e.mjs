import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:8841/'; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok ' : 'FAIL ') + m); };
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const SH = '/workspace/truckers-gps-shots/r4'; await import('node:fs').then(f => f.mkdirSync(SH, { recursive: true }));
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 40.7769, longitude: -73.8740 }, permissions: ['geolocation'] });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const reqs = []; p.on('request', r => { if (/valhalla.*\/route/.test(r.url()) && r.method() === 'POST') try { reqs.push(JSON.parse(r.postData())); } catch {} });
await p.goto(B + '?rrtest=1'); await p.waitForFunction(() => window.TruckNav?.plan && window.TruckNav.map?.loaded(), null, { timeout: 30000 });
ok(await p.evaluate(() => TruckNav.vehOf() === 'semi' && !document.body.classList.contains('no-truckui')), 'default vehicle is Semi with truck tools');
await p.evaluate(() => document.querySelector('#truckForm').dispatchEvent(new Event('change')));
ok(await p.evaluate(() => TruckNav.vehOf() === 'semi'), 'editing other truck settings keeps the vehicle (regression: select defaulted to Car)');
// wizard: pick Car -> one step, saves
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); TruckNav.truckWizard(); }); await p.waitForSelector('#truckWiz [data-vtype]');
ok((await p.$$('#truckWiz [data-vtype]')).length === 5, 'wizard offers 5 vehicle types'); await p.click('#truckWiz [data-vtype="car"]');
ok(/Step 1 of 1/.test(await p.textContent('#truckWiz')), 'car: wizard needs only the vehicle step'); await p.screenshot({ path: SH + '/veh-wizard-car.png' }); await p.click('#truckWiz .wz-next');
ok(await p.evaluate(() => TruckNav.vehOf() === 'car' && TruckNav.costingFor() === 'auto'), 'car saved → auto costing');
ok(await p.evaluate(() => document.body.classList.contains('no-truckui') && getComputedStyle(document.querySelector('#dock [data-panel=hosPanel]')).display === 'none'), 'car: HOS hidden from the dock');
const route = async () => { reqs.length = 0; await p.evaluate(() => { TruckNav.pos = { lat: 40.7769, lon: -73.8740, speed: 0, acc: 10 }; TruckNav.dest = { lat: 40.7140, lon: -73.8310, name: 'Kew Gardens' }; return TruckNav.plan(); });
  await p.waitForFunction(() => TruckNav.route?.line?.length > 10, null, { timeout: 40000 }); await p.waitForTimeout(800); return { body: reqs.find(b => b.costing) , names: await p.evaluate(() => (TruckNav.route.maneuvers || []).flatMap(m => m.street_names || []).join(' | ')) }; };
const car = await route(); ok(car.body?.costing === 'auto' && !car.body.costing_options?.truck, 'car route request: costing auto, no truck options');
ok(reqs.every(b => b.costing === 'auto') && await p.evaluate(() => !TruckNav.carRoute), 'car: every route request is auto, no separate truck-vs-car compare route');
ok(await p.evaluate(() => !(TruckNav.pois || []).some(x => x.kind === 'weigh' || x.kind === 'stop')), 'car: no weigh stations / truck stops in POIs');
// Cargo van via settings select
await p.evaluate(() => { const s = document.querySelector('#vehSel'); s.value = 'van'; s.dispatchEvent(new Event('change', { bubbles: true })); });
ok(await p.evaluate(() => TruckNav.vehOf() === 'van' && TruckNav.truck.heightFt === 9 && TruckNav.truck.weightLbs === 9000), 'settings: Cargo Van applies ~9 ft / 9,000 lb preset');
ok(await p.evaluate(() => getComputedStyle(document.querySelector('.van-note')).display !== 'none' && /parkways/.test(document.querySelector('.van-note').textContent)), 'van: commercial-plate / no-parkway note shown');
ok(await p.evaluate(() => !document.querySelector('#truckUIRow').hidden && document.body.classList.contains('no-truckui')), 'van: truck tools optional (off by default, toggle shown)');
const van = await route(); const vo = van.body?.costing_options?.truck; ok(van.body?.costing === 'truck' && vo && vo.height > 2.6 && vo.height < 3 && vo.hazmat === false, `van route request: truck costing, height ${vo?.height} m`);
ok(!/parkway|pkwy/i.test(van.names), 'van route avoids parkways: ' + van.names.slice(0, 160));
console.log('   (car route used: ' + car.names.slice(0, 160) + ')');
await p.evaluate(() => { const c = document.querySelector('[name=truckUI]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
ok(await p.evaluate(() => !document.body.classList.contains('no-truckui')), 'van: turning on truck tools shows HOS again');
// Reefer van
await p.evaluate(() => { const s = document.querySelector('#vehSel'); s.value = 'reefervan'; s.dispatchEvent(new Event('change', { bubbles: true })); });
ok(await p.evaluate(() => TruckNav.vehOf() === 'reefervan' && TruckNav.VEHICLES.reefervan.reefer && typeof TruckNav.freight?.podSheet === 'function'), 'reefer van set; freight (reefer temp log) module still active');
// Semi back
await p.evaluate(() => { const s = document.querySelector('#vehSel'); s.value = 'semi'; s.dispatchEvent(new Event('change', { bubbles: true })); });
const semi = await route(); ok(semi.body?.costing === 'truck' && semi.body.costing_options.truck.height > 4 && semi.body.costing_options.truck.use_truck_route === 0.8, 'semi: full truck costing restored');
ok(await p.evaluate(() => !document.body.classList.contains('no-truckui') && TruckNav.truck.weightLbs === 80000), 'semi: truck tools on, 80,000 lb');
ok(/Not an ELD · informational only/.test(await p.evaluate(() => document.querySelector('#hosPanel').textContent + document.querySelector('#dockHos').title)), 'HOS panel + dock carry the not-an-ELD notice');
ok(/verify clearances/.test(await p.textContent('#routeSafety')), 'route sheet has the verify-clearances/hazmat safety disclaimer');
{ const t = await ctx.newPage(); const r = await t.goto(B + 'terms.html'); ok(r.ok() && /not an ELD/i.test(await t.textContent('main')) && /nothing auto-renews/.test(await t.textContent('main')), 'terms page live (not-an-ELD, verify restrictions, no auto-renew)'); await t.close(); }
// dispatcher console shows vehicle selectors
const d = await ctx.newPage(); await d.goto(B + 'dispatch.html'); ok(await d.$('#bVeh') && await d.$('#veh') && (await d.$$('#veh option')).length === 6, 'dispatch forms have a vehicle type selector (board + relay)');
ok(!errs.length, 'no page errors ' + errs.join(' ; ')); console.log(`pass=${pass} fail=${fail}`); await br.close(); process.exit(fail ? 1 : 0);

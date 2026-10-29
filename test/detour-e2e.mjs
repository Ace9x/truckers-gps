// Detour detection: Hunts Point -> Port Newark, a semi gets a ~92 mi truck route vs ~29 mi by car (real Valhalla).
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/'; let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; return c; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const ctx = await b.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8085, longitude: -73.874 }, permissions: ['geolocation'] });
await ctx.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
const p = await ctx.newPage(); p.on('pageerror', e => { console.log('ERR', e.message); fails++; });
await p.goto(BASE + '?to=40.6930,-74.1520&name=Port%20Newark%20Terminal', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => TruckNav?.ready, null, { timeout: 40000, polling: 500 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.evaluate(() => TruckNav.setTruck({ type: 'semi', heightFt: 13, heightIn: 6, widthFt: 8.5, lengthFt: 70, weightLbs: 80000, axles: 5, hazmat: false }));
await p.evaluate(() => TruckNav.plan());
await p.waitForFunction(() => TruckNav.routes?.length && TruckNav.carRoute && document.querySelector('#detourWarn') && document.querySelector('.alt .why .warn'), null, { timeout: 90000, polling: 500 }).catch(() => {});
const r = await p.evaluate(() => ({ d: TruckNav.detour, n: TruckNav.routes.length, restricted: TruckNav.routes.map(x => !!x.restricted), sel: TruckNav.sel, truck: TruckNav.routes[0].length / 1609.344, car: TruckNav.carRoute.length / 1609.344, warn: document.querySelector('#detourWarn')?.textContent || '', badge: !!document.querySelector('.alt .why .warn'), said: (TruckNav.spokenLog || []).filter(t => /times the car route/.test(t)) }));
console.log(`   truck ${r.truck.toFixed(1)} mi, car ${r.car.toFixed(1)} mi, routes ${JSON.stringify(r.restricted)}`);
ok(r.d?.detour && r.d.ratio > 1.5, `detour detected: truck route ${r.d?.ratio}× the car route`);
ok(/Long detour: the truck route is \d\.\d× the car route/.test(r.warn), `driver warned in the route panel: "${r.warn.slice(0, 110)}…"`);
ok(r.said.length >= 1 || !(await p.evaluate(() => Array.isArray(TruckNav.spokenLog))), 'spoken heads-up');
ok(r.restricted.includes(true) && r.restricted[0] === false && r.sel === 0, 'relaxed shorter option listed, flagged, NOT auto-selected');
ok(r.badge, 'restricted option carries a ⚠ verify-signs badge');
const ri = r.restricted.indexOf(true);
p.once('dialog', dg => dg.dismiss()); await p.click(`.alt[data-i="${ri}"]`); await p.waitForTimeout(400); ok(await p.evaluate(() => TruckNav.sel) === 0, 'picking the restricted route asks first; cancel keeps the legal route');
p.once('dialog', dg => dg.accept()); await p.click(`.alt[data-i="${ri}"]`); await p.waitForTimeout(400); ok(await p.evaluate(i => TruckNav.sel === i && TruckNav.route.restricted, ri), 'confirming switches to it');
await p.screenshot({ path: '/workspace/truckers-gps-shots/r6/detour-warn.png' });
// a normal trip: no warning
await p.evaluate(() => { TruckNav.selectRoute(0); TruckNav.setDest({ lat: 40.931, lon: -73.898, name: 'Yonkers' }); });
await p.waitForFunction(() => TruckNav.dest?.name === 'Yonkers' && TruckNav.routes?.[0]?.line.at(-1)[1] > 40.9, null, { timeout: 60000 }); await p.waitForTimeout(8000);
const nd = await p.evaluate(() => ({ d: TruckNav.detour, t: TruckNav.routes[0].length / 1609, c: TruckNav.carRoute?.length / 1609, w: !!document.querySelector('#detourWarn') })); console.log('  ', JSON.stringify(nd)); ok(!nd.d && !nd.w, `normal trip (semi to Yonkers, ${(nd.t / nd.c).toFixed(2)}× car): no detour warning`);
console.log(`\n${fails ? 'FAILED ' + fails : 'ALL PASSED'} (${pass} pass)`); await b.close(); process.exit(fails ? 1 : 0);

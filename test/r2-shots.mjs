// Round-2 after screenshots at 390x844. BASE=url node test/r2-shots.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/', D = '/workspace/truckers-gps-shots/pro/r2-', errs = [];
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: 40.8128, longitude: -73.8803 }, permissions: ['geolocation'] });
await ctx.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.stack.slice(0, 300))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
const T = (f, a) => p.evaluate(f, a);
await p.goto(BASE + '?rrtest=1'); await p.waitForFunction(() => window.TruckNav?.ready, null, { timeout: 30000 }); await p.waitForTimeout(4000);
await T(() => document.querySelectorAll('.tour,#tour,#aceTour').forEach(e => e.remove()));
await p.screenshot({ path: D + '1-browse-corner.png' });
await T(() => TruckNav.setDest({ lat: 40.6879, lon: -74.1580, name: 'Port Newark, NJ' })); await p.waitForFunction(() => TruckNav.route && !document.querySelector('#goBtn').disabled, null, { timeout: 60000 });
// Demo traffic on the route so the gradient is visible even when the NYC feed is stale
await T(() => { const L = TruckNav.route.length, T0 = TruckNav.traffic; const fake = { slowdowns: [{ start: L * .15, end: L * .3, level: 'heavy' }, { start: L * .3, end: L * .36, level: 'jam' }, { start: L * .6, end: L * .7, level: 'slow' }], delay: 420, sources: ['demo'], coverage: 0.5 };
  Object.defineProperty(T0, 'cur', { get: () => fake, set: () => {}, configurable: true }); });
await p.waitForTimeout(2500); await p.screenshot({ path: D + '2-route-traffic.png' });
await T(() => TruckNav.startNav());
for (let k = 0; k < 6; k++) { await T(k => { const L = TruckNav.route.line, i = Math.min(L.length - 1, k * 3); TruckNav.onFix({ lon: L[i][0], lat: L[i][1], speed: 22, heading: null, acc: 5, t: Date.now() + k * 1000 }); }, k); await p.waitForTimeout(400); }
await T(() => { const a = TruckNav.along || 0; TruckNav.dangers = [{ kind: 'height', sev: 'warn', along: a + 1900, short: `Tight clearance 13'8"` }, { kind: 'weight', sev: 'stop', along: a + 6400, short: 'Weight limit 40k lb' }, ...(TruckNav.dangers || [])];
  TruckNav.pois = [...(TruckNav.pois || []), { kind: 'weigh', along: a + 14000, name: 'Demo scale', status: 'open', off: 10 }]; });
await p.waitForTimeout(2200); await p.screenshot({ path: D + '3-nav-rail.png' });
await T(() => TruckNav.hzShowBanner({ id: 'demo', type: 'construction', t: Date.now() - 6 * 60e3, up: 3 }, 900)); await p.waitForTimeout(700);
await p.screenshot({ path: D + '4-hazard-banner.png' });
const bh = await T(() => { const e = document.querySelector('#hzBanner'); return { h: e.offsetHeight, btn: [...e.querySelectorAll('button')].map(x => [x.textContent, x.offsetHeight, x.offsetWidth]) }; });
await p.waitForTimeout(8000); const gone = await T(() => !document.querySelector('#hzBanner'));
// Automatic day/night: same app, theme 'auto', clock at 12:30 ET -> day map without touching settings
const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: 40.8128, longitude: -73.8803 }, permissions: ['geolocation'] });
await c2.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
const p2 = await c2.newPage(); await p2.clock.install({ time: new Date('2026-10-21T16:30:00Z') }); await p2.clock.resume?.();
await p2.goto(BASE + '?rrtest=1'); await p2.waitForFunction(() => window.TruckNav?.ready, null, { timeout: 30000 }); await p2.waitForTimeout(5000);
await p2.evaluate(() => document.querySelectorAll('.tour,#tour,#aceTour').forEach(e => e.remove()));
console.log('auto theme at 12:30 ET:', await p2.evaluate(() => TruckNav.effTheme()), await p2.evaluate(() => document.documentElement.dataset.theme)); await p2.screenshot({ path: D + '5-auto-day.png' });
const corner = await T(() => { const r = s => document.querySelector(s)?.getBoundingClientRect(); return { leg: r('#tfLegend'), live: r('#hzLive'), speed: r('#speedBox') }; });
console.log(JSON.stringify({ bh, gone, corner, grad: await T(() => document.body.dataset.routeTraffic), errs: [...new Set(errs)].slice(0, 8) }));
await b.close();

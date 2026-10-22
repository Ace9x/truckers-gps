// Round-3 screenshots: colours, Go button, freshness labels, trip receipt, daylight high contrast. BASE=url node test/r3-shots.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/', D = '/workspace/truckers-gps-shots/pro/' + (process.env.PFX || 'r3-'), errs = [];
const b = await chromium.launch();
async function page(time) { const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: 40.8128, longitude: -73.8803 }, permissions: ['geolocation'] });
  await c.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.stack.slice(0, 240))); if (time) { await p.clock.install({ time }); }
  await p.goto(BASE + '?rrtest=1'); await p.waitForFunction(() => window.TruckNav?.ready, null, { timeout: 30000 }); await p.waitForTimeout(4500);
  await p.evaluate(() => document.querySelectorAll('.tour,#tour,#aceTour').forEach(e => e.remove())); return p; }
const p = await page(new Date('2026-10-22T02:30:00Z'));
await p.screenshot({ path: D + '1-night-browse.png' });
const ages = await p.evaluate(() => [...document.querySelectorAll('.age')].map(a => a.textContent + (a.classList.contains('stale') ? ' (stale)' : '')));
await p.evaluate(() => TruckNav.setDest({ lat: 40.6879, lon: -74.1580, name: 'Port Newark warehouse district, NJ' })); await p.waitForFunction(() => TruckNav.route && !document.querySelector('#goBtn').disabled, null, { timeout: 60000 }); await p.waitForTimeout(1500);
await p.evaluate(() => document.querySelector('#goBtn').scrollIntoView({ block: 'center' })); await p.waitForTimeout(400);
const go = await p.evaluate(() => { const e = document.querySelector('#goBtn'), cs = getComputedStyle(e); return { h: e.offsetHeight, bg: cs.backgroundColor }; });
await p.screenshot({ path: D + '2-go-button.png' });
const rr = await p.evaluate(() => TruckNav.map.getPaintProperty('route', 'line-color'));
await p.evaluate(() => TruckNav.showReceipt({ start: Date.now() - 97 * 60e3, dest: 'Port Newark warehouse district, NJ', miles: 41.6, arrived: true, via: 'I-278 → I-95 → NJ Turnpike', ifta: { NY: 14.2, NJ: 27.9 }, stops: ['Pilot Travel Center, Elizabeth'], tolls: 22.4, reports0: 0 }));
await p.waitForTimeout(800); await p.screenshot({ path: D + '3-trip-receipt.png' });
const p2 = await page(new Date('2026-10-21T16:30:00Z')); await p2.screenshot({ path: D + '4-day-high-contrast.png' });
await p2.evaluate(() => TruckNav.showReceipt({ start: Date.now() - 50 * 60e3, dest: 'Hunts Point Market', miles: 12.3, arrived: true, via: 'I-95', ifta: { NY: 12.3 }, stops: [], tolls: 0, reports0: 0 })); await p2.waitForTimeout(700); await p2.screenshot({ path: D + '5-receipt-day.png' });
console.log(JSON.stringify({ ages, go, routeColor: rr, theme2: await p2.evaluate(() => document.documentElement.dataset.theme), errs: [...new Set(errs)] })); await b.close();

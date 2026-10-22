// Round-4 screenshots (design_playbook audit). BASE=url W=390 node test/r4-shots.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/', W = +(process.env.W || 390), D = `/workspace/truckers-gps-shots/r4/${process.env.PFX || ''}${W}-`, errs = [];
const b = await chromium.launch(), c = await b.newContext({ viewport: { width: W, height: W > 800 ? 900 : 844 }, deviceScaleFactor: 2, geolocation: { latitude: 40.8128, longitude: -73.8803 }, permissions: ['geolocation'] });
await c.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.clock.install({ time: new Date('2026-10-22T02:30:00Z') });
await p.goto(BASE + '?rrtest=1'); await p.waitForFunction(() => window.TruckNav?.ready, null, { timeout: 30000 }); await p.waitForTimeout(4000);
await p.evaluate(() => document.querySelectorAll('.tour,#tour,#aceTour').forEach(e => e.remove()));
await p.screenshot({ path: D + '1-map.png' });
await p.evaluate(() => TruckNav.setDest({ lat: 40.6879, lon: -74.1580, name: 'Port Newark warehouse district, NJ' })); await p.waitForFunction(() => TruckNav.route && !document.querySelector('#goBtn').disabled, null, { timeout: 60000 }); await p.waitForTimeout(2000);
await p.screenshot({ path: D + '2-route-sheet.png' });
await p.evaluate(() => { const s = document.querySelector('#routePanel'); s.scrollTop = 0; s.classList.add('full'); }); await p.screenshot({ path: D + '3-route-sheet-full.png', fullPage: false });
const m = await p.evaluate(() => { const q = s => document.querySelector(s), bb = e => e && e.getBoundingClientRect(), clip = [...document.querySelectorAll('#routePanel *, #acctChips *, #searchBtn *')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis' && getComputedStyle(e).overflow !== 'visible').map(e => e.id || e.className).slice(0, 6);
  const vis = s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && getComputedStyle(e).visibility !== 'hidden');
  return { go: [bb(q('#goBtn')).width | 0, bb(q('#goBtn')).height | 0, bb(q('#routePanel')).width | 0], demoLink: q('#demoBtn').classList.contains('textlink'),
    cardH: [...document.querySelectorAll('#alts .alt')].map(e => e.offsetHeight), truckShown: vis('#truckChip, #rpTruck').length + (vis('#routeSummary').filter(e => /Truck routes/.test(e.textContent)).length),
    tfNotes: vis('#tfOnce').length + vis('.alt .tf-row').filter(e => /no live/.test(e.textContent)).length, stopsCollapsed: q('#stopsBox').classList.contains('collapsed'), clip }; });
console.log(JSON.stringify({ W, ...m, errs })); await b.close();

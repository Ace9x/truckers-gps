// Real geocode + cross-country proof for v3.32.2. Not part of the release gate.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = process.env.OUT || '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 40.728, longitude: -73.795 } });
await ctx.addInitScript(() => { localStorage.setItem('tn_locWhySeen', '1'); localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_lang', '"en"'); localStorage.setItem('tn_truckSetDone', '1'); localStorage.setItem('rr_area_asked', '1'); localStorage.setItem('rr_whatsnew_seen', '3.32.2'); });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.TruckNav?.geocode, null, { timeout: 30000 });
await p.waitForTimeout(800);
if (await p.$('#lfGo')) await p.click('#lfGo');
if (await p.$('#tSkip')) await p.click('#tSkip');
await p.evaluate(() => { const S = window.TruckNav; S.pos = { lat: 40.7282, lon: -73.7949, speed: 0, heading: 0, acc: 8, t: Date.now() }; });
const geo = await p.evaluate(async () => {
  const S = window.TruckNav;
  const beach = await S.geocode('224 Beach 19th Street');
  const canis = await S.geocode('224 Canis Street');
  const plain = await S.geocode('90-15 Queens Boulevard');
  const miss = await S.geocode('Canarsiee Street Queens');
  return {
    beach: beach.slice(0, 2).map(x => ({ name: x.name, sub: x.sub, mi: Math.round(x.dist / 1609) })),
    canis: canis.slice(0, 3).map(x => ({ name: x.name, sub: x.sub, mi: Math.round(x.dist / 1609) })),
    plain: plain.slice(0, 2).map(x => ({ name: x.name, sub: x.sub, mi: Math.round(x.dist / 1609) })),
    miss: miss.slice(0, 2).map(x => ({ name: x.name, sub: x.sub, mi: Math.round(x.dist / 1609) })),
  };
});
console.log('GEO', JSON.stringify(geo));
await p.evaluate(async () => {
  const S = window.TruckNav;
  const rows = await S.geocode('224 Canis Street');
  document.querySelector('#searchBtn')?.click();
  const box = document.querySelector('#q'); if (box) box.value = '224 Canis Street';
  S.showResults(rows);
});
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/v3322_canis_picker.png` });
const plan = async (dest, avoid) => p.evaluate(async ({ dest, avoid }) => {
  const S = window.TruckNav;
  document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'));
  S.truck.avoidWeigh = !!avoid; S.scaleMode = avoid ? 'avoid' : 'off';
  if (S.routeOpts) S.routeOpts.avoidWeigh = !!avoid;
  S.stops = []; S.route = null; S.routes = [];
  S.setDest(dest);
  for (let i = 0; i < 240 && !(S.route && S.route.length > 500000 && !document.querySelector('#goBtn')?.disabled); i++) await new Promise(r => setTimeout(r, 1000));
  const sum = document.querySelector('#routeSummary')?.textContent || '';
  return { km: S.route ? Math.round(S.route.length / 1000) : 0, min: S.route ? Math.round(S.route.time / 60) : 0, turns: S.route?.maneuvers?.length || 0, go: !document.querySelector('#goBtn')?.disabled, raw: /1500000|Path distance|max distance/i.test(sum), chained: !!S.route?.chained, sum: sum.slice(0, 160), avoid: !!S.truck.avoidWeigh, mode: S.scaleMode };
}, { dest, avoid });
const shootRoute = async (file, { top = false } = {}) => {
  await p.evaluate(() => new Promise(res => { const m = window.TruckNav.map; document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); if (m.loaded()) res(); else m.once('idle', res); setTimeout(res, 4000); }));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/${file}_map.png` });
  await p.evaluate(() => { document.querySelector('[data-panel=routePanel]')?.click(); document.querySelector('#routePanel')?.scrollTo(0, 0); });
  await p.waitForTimeout(300);
  if (top) await p.screenshot({ path: `${OUT}/${file}.png` });
  await p.evaluate(() => document.querySelector('#alts .alt, #alts')?.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${top ? file + '_eta' : file}.png` });
};
await p.evaluate(() => { window.TruckNav.pos = { lat: 40.7282, lon: -73.7949, speed: 0, heading: 0, acc: 8, t: Date.now() }; });
const la = await plan({ lon: -118.2437, lat: 34.0522, name: 'Los Angeles, CA' }, false);
console.log('LA', JSON.stringify(la));
await shootRoute('v3322_queens_la');
await p.evaluate(() => { window.TruckNav.pos = { lat: 25.7617, lon: -80.1918, speed: 0, heading: 0, acc: 8, t: Date.now() }; document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); });
const sea = await plan({ lon: -122.3321, lat: 47.6062, name: 'Seattle, WA' }, true);
console.log('SEA', JSON.stringify(sea));
await shootRoute('v3322_miami_seattle_avoid', { top: true });
console.log('ERRS', errs.slice(0, 6));
await browser.close();
if (!(la.km > 3500 && la.go && !la.raw && sea.km > 4000 && sea.go && !sea.raw)) process.exit(1);

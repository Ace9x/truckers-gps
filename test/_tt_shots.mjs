// screenshot harness: BASE, OUT prefix, THEME. Key from secrets file (local only; Referer spoofed to the allowed domain for localhost).
import { chromium, devices } from 'playwright'; import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:8841/', OUT = process.env.OUT || '/tmp/tt', live = /github\.io/.test(BASE);
const key = live ? '' : fs.readFileSync('/workspace/.rr-secrets/tomtom_key.txt', 'utf8').trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const views = { city: [-73.985, 40.752, 13.2], hwy: [-74.06, 40.80, 10.6] }; const st = {}; let errs = [];
for (const theme of (process.env.THEMES || 'day,night').split(',')) {
  const ctx = await b.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8085, longitude: -73.874 }, permissions: ['geolocation'], ...(live ? {} : { serviceWorkers: 'block' }) });
  await ctx.addInitScript(([k, th]) => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); if (k) localStorage.setItem('tn_tomtomKey', JSON.stringify(k)); }, [key, theme]);
  if (!live) await ctx.route(/api\.tomtom\.com/, async r => { const res = await r.fetch({ headers: { referer: 'https://ace9x.github.io/truckers-gps/' } }); await r.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } }); });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('response', r => { if (/api\.tomtom\.com\/traffic\/map/.test(r.url())) { const k = (/flow/.test(r.url()) ? 'flow' : 'inc') + (/\.pbf/.test(r.url()) ? '.pbf' : '.png') + ':' + r.status(); st[k] = (st[k] || 0) + 1; } });
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => TruckNav?.ready, null, { timeout: 40000 }); await p.evaluate(th => { document.querySelector('#splash')?.remove(); const e = document.querySelector('[name=theme]'); e.value = th; e.dispatchEvent(new Event('change', { bubbles: true })); }, theme); await p.waitForTimeout(4000);
  for (const [name, [lon, lat, z]] of Object.entries(views)) {
    await p.evaluate(([lon, lat, z]) => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); TruckNav.follow = false; TruckNav.map.jumpTo({ center: [lon, lat], zoom: z, pitch: 0, bearing: 0 }); }, [lon, lat, z]);
    await p.waitForTimeout(7000); await p.screenshot({ path: `${OUT}-${theme}-${name}.png` }); }
  const info = await p.evaluate(() => ({ layers: TruckNav.map.getStyle().layers.filter(l => /^tt/.test(l.id)).map(l => l.id + ':' + l.type), feats: TruckNav.map.queryRenderedFeatures({ layers: ['ttflow'].filter(l => TruckNav.map.getLayer(l)) }).length, inc: TruckNav.map.getLayer('ttinc') ? TruckNav.map.queryRenderedFeatures({ layers: ['ttinc'] }).length : -1, theme: document.body.className.match(/dim|night|day/g), status: TruckNav.traffic.status.tomtom }));
  console.log(theme, JSON.stringify(info)); await ctx.close(); }
console.log(JSON.stringify(st), errs.slice(0, 3)); await b.close();

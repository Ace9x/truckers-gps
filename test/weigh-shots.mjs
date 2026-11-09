// Screenshots: default route through a scale vs the avoid route, at iPhone and Pixel 7 sizes.
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = process.env.OUT || '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });
const TRIPS = [
  { id: 'i95', name: 'I-95 Chester', from: { lat: 39.830, lon: -75.400 }, to: { lon: -75.310, lat: 39.905, name: 'I-95 north of Chester' } },
  { id: 'i80', name: 'I-80 Knowlton', from: { lat: 40.985, lon: -75.25 }, to: { lon: -74.70, lat: 40.90, name: 'I-80 east of Knowlton' } },
  { id: 'i81', name: 'I-81 PA', from: { lat: 40.26, lon: -76.88 }, to: { lon: -75.66, lat: 41.41, name: 'Scranton' } },
];
const ONLY = process.env.ONLY;
const browser = await (process.env.ENGINE === 'webkit' ? webkit : chromium).launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const DEVS = [{ name: 'iphone', device: 'iPhone 13', vp: { width: 390, height: 844 } }, { name: 'pixel7', device: 'Pixel 7', vp: { width: 412, height: 915 } }].filter(d => !process.env.DEV || d.name === process.env.DEV);
for (const dev of DEVS) {
  for (const t of TRIPS.filter(t => !ONLY || t.id === ONLY)) {
    const ctx = await browser.newContext({ ...devices[dev.device], viewport: dev.vp, permissions: ['geolocation'], geolocation: { latitude: t.from.lat, longitude: t.from.lon } });
    await ctx.addInitScript(() => { localStorage.setItem('tn_locWhySeen', '1'); localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_lang', '"en"'); Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.TruckNav?.map, null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    if (await p.$('#langFirst [data-l="en"]')) await p.locator('#langFirst [data-l="en"]').tap().catch(() => {});
    if (await p.$('#tSkip')) await p.locator('#tSkip').tap().catch(() => {});
    await p.waitForTimeout(500);
    const run = async (avoid) => p.evaluate(async ({ to, avoid }) => {
      const S = window.TruckNav;
      S.pos = S.pos || { lat: 0, lon: 0, speed: 0, heading: 0, acc: 8, t: Date.now() };
      S.truck.avoidWeigh = avoid; S.scaleMode = avoid ? 'avoid' : 'off'; S.routeOpts = { ...(S.routeOpts || {}), avoidWeigh: avoid };
      S.setDest(to);
      for (let i = 0; i < 50; i++) { const sum = document.querySelector('#routeSummary')?.textContent || ''; if (S.route && !/Finding/.test(sum)) break; await new Promise(r => setTimeout(r, 400)); }
      const scales = (S.scalesOnTrip || []).map(s => s.name);
      return { km: S.route ? +(S.route.length / 1000).toFixed(1) : 0, choice: S.route?.scaleChoice || '', mode: S.scaleMode, weigh: !!S.truck.avoidWeigh, miss: !!S.route?.scaleMiss, note: S.planNote, err: S.lastAvoidErr || '', sum: (document.querySelector('#routeSummary')?.textContent || '').slice(0, 180) };
    }, { to: t.to, avoid });
    const through = await run(false);
    await p.screenshot({ path: `${OUT}/weigh_${t.id}_${dev.name}_through.png` });
    const avoid = await run(true);
    await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/weigh_${t.id}_${dev.name}_avoid_map.png` });
    await p.evaluate(() => {
      const alt = [...document.querySelectorAll('#alts .alt')].find(a => /Avoid scales/.test(a.textContent || ''));
      if (alt) window.TruckNav.selectRoute(+alt.dataset.i);
      window.TruckNav.fit?.() || null;
    });
    await p.waitForTimeout(700);
    await p.evaluate(() => {
      document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'));
      const S = window.TruckNav;
      if (S?.route?.line && window.maplibregl) {
        const b = new maplibregl.LngLatBounds();
        S.route.line.forEach(c => b.extend(c));
        S.map.fitBounds(b, { padding: 48, pitch: 0, bearing: 0, duration: 0 });
      }
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/weigh_${t.id}_${dev.name}_avoid_chosen_map.png` });
    await p.evaluate(() => { document.querySelector('[data-panel=routePanel]')?.click(); document.querySelector('#alts')?.scrollIntoView({ block: 'center' }); });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/weigh_${t.id}_${dev.name}_avoid_options.png` });
    const chosen = await p.evaluate(() => { const S = window.TruckNav; return { km: S.route ? +(S.route.length / 1000).toFixed(1) : 0, choice: S.route?.scaleChoice || '', mode: S.scaleMode }; });
    console.log(dev.name, t.id, 'through', JSON.stringify(through), 'avoid', JSON.stringify(avoid), 'chosen', JSON.stringify(chosen));
    await ctx.close();
  }
}
await browser.close();

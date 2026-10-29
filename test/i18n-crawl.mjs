// Opens every screen/panel/tab of the app + dispatcher console in LANG and lists visible English strings with no translation.
// LANG=xx collects everything (empty dictionary). OUT=file writes JSON.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:8841/', LANG = process.env.LANG2 || 'xx', OUT = process.env.OUT;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const all = new Set(); const errs = [];
async function grab(p) { const m = await p.evaluate(() => [...(globalThis.RRI18N?.missing || [])]); m.forEach(x => all.add(x)); }
async function page(url, fn, first = false) { const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 1280, height: 900 }, geolocation: { latitude: 40.8085, longitude: -73.874 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  await ctx.addInitScript(f => { if (!f) { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); localStorage.setItem('rr_wiz_done', '1'); } }, first);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss().catch(() => {}));
  await p.goto(BASE + url + (url.includes('?') ? '&' : '?') + 'lang=' + LANG, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(6000); await fn(p); await grab(p); await ctx.close(); }
const openAll = async p => { await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await p.waitForTimeout(500); await grab(p); };
// first run (splash, wizard, tour)
await page('', async p => { for (let i = 0; i < 8; i++) { await grab(p); const nx = await p.$('#truckWiz button.primary, #truckWiz [data-next], .tour button'); if (!nx) break; await nx.click().catch(() => {}); await p.waitForTimeout(600); } }, true);
// main app with a route: every panel
await page('?to=40.6930,-74.1520&name=Port%20Newark', async p => {
  await p.waitForFunction(() => TruckNav?.route, null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(3000); await grab(p);
  const ids = await p.evaluate(() => [...document.querySelectorAll('.panel, [id$=Panel]')].map(e => e.id).filter(Boolean));
  for (const id of ids) { await p.evaluate(id => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); const e = document.getElementById(id); e.classList.remove('hidden'); e.hidden = false; }, id); await openAll(p); }
  // every Help sheet, every glossary term, and every tour card
  await p.evaluate(async () => { const H = window.RRHelp; for (const id of Object.keys(H.HELP)) { H.showHelp(id); await new Promise(r => setTimeout(r, 120)); } for (const k of Object.keys(H.TERMS)) { H.explain(k); await new Promise(r => setTimeout(r, 80)); } document.querySelector('#helpSheet')?.remove();
    TruckNav.startTour?.(); for (let i = 0; i < 8 && document.querySelector('#tNext'); i++) { await new Promise(r => setTimeout(r, 150)); document.querySelector('#tNext').click(); } await new Promise(r => setTimeout(r, 150)); document.querySelector('#tKeep')?.click(); }); await grab(p);
  await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); TruckNav.startNav?.(); }); await p.waitForTimeout(3000); await grab(p);
  await p.evaluate(() => { TruckNav.endNav?.(); }); await p.waitForTimeout(2000); await grab(p);
  for (const sel of ['#moreBtn', '#sosBtn', '#layersBtn', '#meBtn', '#helpBtn', '#searchBtn']) { await p.evaluate(s => document.querySelector(s)?.click(), sel); await p.waitForTimeout(700); await openAll(p); }
});
for (const u of ['dispatch.html']) await page(u, async p => {
  const tabs = await p.$$eval('[data-tab]', e => e.map(x => x.dataset.tab)).catch(() => []);
  for (const tb of tabs) { await p.evaluate(tb => document.querySelector(`[data-tab="${tb}"]`)?.click(), tb); await p.waitForTimeout(800); await openAll(p); }
  await p.evaluate(() => document.querySelectorAll('[hidden]').forEach(e => { if (!e.closest('template')) e.hidden = false; })); await openAll(p); });
const arr = [...all].sort(); console.log(`${arr.length} untranslated visible strings (lang ${LANG}); page errors: ${errs.length}`); errs.slice(0, 5).forEach(e => console.log('  ERR', e.slice(0, 150)));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(arr, null, 1)); else arr.slice(0, 40).forEach(s => console.log('  ', s.slice(0, 120)));
await b.close(); process.exit(LANG !== 'xx' && arr.length ? 1 : 0);

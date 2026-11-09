// Screenshots for the v3.32.0 welcome page, cab card, and manifest install images.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = process.env.OUT || '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(BASE + 'welcome/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(400);
const welcome = await p.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent,
  open: document.querySelector('a.go')?.getAttribute('href'),
  legal: document.querySelector('.legal')?.textContent?.slice(0, 80),
  brand: document.querySelector('.brand')?.textContent,
}));
await p.screenshot({ path: `${OUT}/welcome_iphone.png` });
await p.click('#installBtn');
await p.waitForTimeout(200);
const guide = await p.evaluate(() => !document.querySelector('#iosGuide')?.hidden);
await p.screenshot({ path: `${OUT}/welcome_install_guide.png` });
await p.goto(BASE + 'card/', { waitUntil: 'domcontentloaded' });
const card = await p.evaluate(() => ({ qr: !!document.querySelector('svg.qr'), text: document.body.innerText.includes('ref=card') }));
await p.screenshot({ path: `${OUT}/cab_card.png` });
await ctx.close();

const ctx2 = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 40.7506, longitude: -73.9935 } });
await ctx2.addInitScript(() => { localStorage.setItem('tn_locWhySeen', '1'); localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_lang', '"en"'); localStorage.setItem('tn_truckSetDone', '1'); localStorage.setItem('rr_area_asked', '1'); localStorage.setItem('rr_whatsnew_seen', '3.32.0'); });
const a = await ctx2.newPage();
a.on('pageerror', e => errs.push('app ' + e.message));
await a.goto(BASE, { waitUntil: 'domcontentloaded' });
await a.waitForFunction(() => window.TruckNav?.map, null, { timeout: 30000 });
await a.waitForTimeout(1200);
await a.evaluate(async () => {
  const S = window.TruckNav;
  S.setDest({ lon: -73.9442, lat: 40.6782, name: 'Crown Heights' });
  for (let i = 0; i < 40 && !S.route; i++) await new Promise(r => setTimeout(r, 400));
  S.startNav();
});
await a.waitForTimeout(800);
await a.screenshot({ path: 'icons/shot-nav.png' });
await a.screenshot({ path: `${OUT}/shot_nav.png` });
await a.evaluate(() => { window.TruckNav.endNav(); document.querySelector('[data-panel=routePanel]')?.click(); });
await a.waitForTimeout(500);
await a.screenshot({ path: 'icons/shot-route.png' });
await a.evaluate(() => document.querySelector('[data-panel=mePanel]')?.click());
await a.waitForTimeout(400);
const me = await a.evaluate(() => {
  const b = document.querySelector('#installSettings'), i = document.querySelector('#inviteDriver');
  const box = e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  return { install: b ? box(b) : null, invite: i ? box(i) : null };
});
await a.screenshot({ path: `${OUT}/me_install.png` });
await a.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); window.TruckNav.truckWizard(); });
await a.waitForTimeout(300);
const wiz = await a.evaluate(() => document.querySelector('#truckWiz')?.innerText.replace(/\s+/g, ' ').slice(0, 180));
await a.screenshot({ path: `${OUT}/wizard_step1.png` });
await ctx2.close();

const wide = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['geolocation'], geolocation: { latitude: 40.7506, longitude: -73.9935 } });
await wide.addInitScript(() => { localStorage.setItem('tn_locWhySeen', '1'); localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_truckSetDone', '1'); localStorage.setItem('tn_lang', '"en"'); localStorage.setItem('rr_area_asked', '1'); localStorage.setItem('rr_whatsnew_seen', '3.32.0'); });
const w = await wide.newPage();
await w.goto(BASE, { waitUntil: 'domcontentloaded' });
await w.waitForFunction(() => window.TruckNav?.map, null, { timeout: 30000 });
await w.evaluate(async () => {
  const S = window.TruckNav;
  if (!S.route) { S.setDest({ lon: -73.9442, lat: 40.6782, name: 'Crown Heights' }); for (let i = 0; i < 40 && !S.route; i++) await new Promise(r => setTimeout(r, 400)); }
  document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'));
});
await w.waitForTimeout(600);
await w.screenshot({ path: 'icons/shot-wide.png' });
await w.screenshot({ path: `${OUT}/shot_wide.png` });
await browser.close();
const sizes = ['icons/shot-nav.png', 'icons/shot-route.png', 'icons/shot-wide.png'].map(f => { const b = fs.statSync(f); return f + ' ' + b.size; });
console.log(JSON.stringify({ welcome, guide, card, me, wiz, errs: errs.slice(0, 8), sizes }, null, 1));

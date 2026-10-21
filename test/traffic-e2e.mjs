// Live traffic e2e: real NYC DOT feed, real public Nostr relays (crowd speeds between 3 separate browser contexts), real Valhalla truck routing.
import { chromium, devices } from 'playwright'; import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8799/', SHOTS = '/workspace/truckers-gps-shots/traffic'; mkdirSync(SHOTS, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch(); const t0 = Date.now();
async function driver(name, geo) { const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: geo, permissions: ['geolocation'] }); const page = await ctx.newPage();
  page.on('pageerror', e => { console.log(name, 'PAGE ERROR', e.message); fails++; });
  await page.goto(BASE); await page.waitForFunction(() => TruckNav?.ready && TruckNav.pos && TruckNav.trafficReady, null, { timeout: 40000 });
  await page.evaluate(() => { document.querySelector('#splash')?.remove(); TruckNav.mascot && (TruckNav.mascot.enabled = false); }); return page; }
// ---- 1. NYC route shows real NYC DOT traffic ----
const A = await driver('A', { latitude: 40.8128, longitude: -73.8822 }); // Hunts Point
await A.waitForFunction(() => TruckNav.traffic.feeds.nyc?.links?.length > 50, null, { timeout: 60000 }).catch(() => {});
const nyc = await A.evaluate(() => { const f = TruckNav.traffic.feeds.nyc; return f && { n: f.links.length, age: Math.round((Date.now() - f.t) / 60000), lv: f.links.reduce((a, l) => (a[l.ratio >= .8 ? 'free' : l.ratio >= .55 ? 'slow' : l.ratio >= .3 ? 'heavy' : 'jam']++, a), { free: 0, slow: 0, heavy: 0, jam: 0 }) }; });
ok(nyc?.n > 50, `NYC DOT live speeds loaded keyless: ${nyc?.n} road links, newest reading ${nyc?.age} min old, levels ${JSON.stringify(nyc?.lv)}`);
await A.evaluate(() => TruckNav.setDest({ lat: 40.8466, lon: -73.9285, name: 'Washington Heights (Cross Bronx Expy)' }));
await A.waitForFunction(() => TruckNav.routes?.length && document.querySelector('.tf-row'), null, { timeout: 60000 });
await A.waitForFunction(() => TruckNav.traffic.cur?.sources.includes('NYC DOT'), null, { timeout: 30000 }).catch(() => {});
const rp = await A.evaluate(() => ({ rows: [...document.querySelectorAll('.tf-row')].map(e => e.textContent), box: document.querySelector('#tfBox')?.textContent, links: [...document.querySelectorAll('#tfBox a')].map(a => a.href), cur: TruckNav.traffic.cur && { d: Math.round(TruckNav.traffic.cur.delay), src: TruckNav.traffic.cur.sources, cov: TruckNav.traffic.cur.coverage } }));
ok(rp.cur?.src.includes('NYC DOT'), `route Hunts Point → Washington Heights uses real NYC DOT data (sources ${rp.cur?.src}): delay ${Math.round((rp.cur?.d || 0) / 60)} min, coverage ${Math.round((rp.cur?.cov || 0) * 100)}%`);
ok(rp.rows.length >= 1 && rp.rows.every(r => /Traffic:/.test(r)), `Traffic row on every route option: ${rp.rows.join(' | ')}`);
ok(rp.links.some(h => h.startsWith('https://waze.com/ul')) && rp.links.some(h => h.includes('google.com/maps/dir')), 'Waze / Google / Apple second-opinion deep links present');
await A.screenshot({ path: `${SHOTS}/01-route-options-traffic-row.png` });
await A.evaluate(() => { document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden')); TruckNav.map.jumpTo({ center: [-73.90, 40.74], zoom: 10.6 }); }); await A.waitForTimeout(3000);
await A.screenshot({ path: `${SHOTS}/02-nyc-traffic-layer.png` });
// ---- 2. crowd: A2 + B share slow speeds, C sees congestion ----
const j = Math.random() * 0.5, spot = { latitude: 41.2 + j, longitude: -75.6 };
const [P, Q, C] = await Promise.all([driver('P', spot), driver('Q', spot), driver('C', spot)]);
for (const X of [P, Q, C]) await X.waitForFunction(() => TruckNav.traffic.relays.some(r => r.open), null, { timeout: 20000 });
await Promise.all([P, Q, C].map(X => X.waitForTimeout(2500)));
for (const [X, mph] of [[P, 7], [Q, 11]]) ok(await X.evaluate(m => { TruckNav.pos.heading = 90; return TruckNav.traffic.share(m, TruckNav.pos, 55); }, mph) > 0, `driver shares ${mph} mph anonymously over public relays`);
const seen = await C.waitForFunction(() => Object.values(TruckNav.traffic.aggregate()).find(a => a.n >= 2), null, { timeout: 30000, polling: 500 }).then(h => h.jsonValue()).catch(() => null);
ok(seen && ['heavy', 'jam'].includes(seen.level), `third driver C sees crowd congestion: ${seen ? `${seen.mph} mph from ${seen.n} drivers → ${seen.level}` : 'nothing'}`);
await C.evaluate(() => { TruckNav.traffic.refresh(); TruckNav.map.jumpTo({ center: [TruckNav.pos.lon, TruckNav.pos.lat], zoom: 16 }); }); await C.waitForTimeout(2500);
ok(await C.evaluate(() => TruckNav.traffic.geo.features.some(f => f.properties.src === 'RigRoute drivers' && f.properties.level !== 'free')), 'crowd segment drawn on C\'s traffic layer');
await C.screenshot({ path: `${SHOTS}/03-crowd-congestion-third-driver.png` });
// one driver alone never shows (privacy / anti-spoof)
const solo = await P.evaluate(() => { const p = { ...TruckNav.pos, lat: TruckNav.pos.lat + 0.02 + Math.random() * 0.01 }; TruckNav.traffic.share(3, p, 55); return Object.values(TruckNav.traffic.aggregate()).filter(a => Math.abs(a.lat - p.lat) < 0.003 && Math.abs(a.lon - p.lon) < 0.003).length; });
ok(solo === 0, 'a single driver\'s report alone does not create congestion');
// ---- 3. simulated jam ahead → alert + truck-safe reroute suggestion (Hunts Point → JFK cargo: Valhalla gives 2 truck routes) ----
await A.evaluate(() => { TruckNav.routes = []; return TruckNav.setDest({ lat: 40.6535, lon: -73.7880, name: 'JFK Cargo' }); });
await A.waitForFunction(() => TruckNav.routes?.length >= 1 && /JFK/.test(TruckNav.dest?.name), null, { timeout: 60000 }).catch(() => {});
const inj = await A.evaluate(() => { const S = TruckNav, main = S.routes[S.sel], alts = S.routes.filter((_, i) => i !== S.sel);
  const R = 6371e3, d = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos(a[1] * Math.PI / 180), a[1] - b[1]) * Math.PI / 180 * R;
  const pts = main.line.filter((p, i) => main.cum[i] > 1500 && main.cum[i] < 9000 && alts.every(r => r.line.every(q => d(p, q) > 250)));
  S.traffic.injected = pts.map((p, k) => ({ lon: p[0], lat: p[1], mph: 3, ff: 45, src: 'simulated jam', t: Date.now() })); return { n: pts.length, alts: alts.length }; });
ok(inj.n > 5, `simulated stop-and-go jam on ${inj.n} points unique to the chosen route (${inj.alts} alternatives)`);
await A.evaluate(() => { TruckNav.startNav(); TruckNav.traffic.refresh(); });
const sug = await A.waitForFunction(() => TruckNav.traffic.suggestion, null, { timeout: 60000 }).then(h => h.jsonValue()).catch(() => null);
const st = await A.evaluate(() => ({ alert: TruckNav.traffic.lastAlert, banner: document.querySelector('#tfBanner')?.textContent, eta: document.querySelector('#tLeft')?.textContent, delay: Math.round(TruckNav.trafficDelay / 60) }));
ok(/traffic/i.test(st.alert || '') && /delay/.test(st.alert), `jam alert spoken: "${st.alert}"`);
ok(sug && sug.save > 0, `faster truck-safe reroute suggested: ${sug ? (sug.save ? `saves ${Math.round(sug.save / 60)} min` : JSON.stringify(sug)) : 'none'}; banner "${st.banner}"`);
ok(st.delay > 0, `traffic-aware ETA includes +${st.delay} min delay (time left ${st.eta})`);
await A.evaluate(() => TruckNav.map.jumpTo({ zoom: 13.2, pitch: 0 })); await A.waitForTimeout(1200); await A.screenshot({ path: `${SHOTS}/04-jam-ahead-reroute-suggestion.png` });
if (sug?.save) { await A.click('#tfBanner button'); await A.waitForTimeout(1500); const after = await A.evaluate(() => Math.round(TruckNav.trafficDelay / 60)); ok(after < st.delay, `after Switch: remaining delay ${after} min (was ${st.delay})`); await A.screenshot({ path: `${SHOTS}/05-after-switch.png` }); }
console.log(`\n${fails ? fails + ' FAILED' : 'ALL PASSED'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); await browser.close(); process.exit(fails ? 1 : 0);

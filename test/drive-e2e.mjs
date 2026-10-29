// Open list: multi-tap lock above 5 mph (SOS stays), passenger unlock, USGS imagery (no Esri), Waze embed panel, NWS forecast at ETA, OSM parking/weigh query.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/'; let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; return c; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const ctx = await b.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8085, longitude: -73.874 }, permissions: ['geolocation'] });
await ctx.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
const p = await ctx.newPage(); p.on('pageerror', e => { if (/waze\.com/.test(e.stack || '')) { console.log('  (third-party error inside the Waze iframe, not ours:', e.message.slice(0, 80) + ')'); return; } console.log('ERR', e.message); fails++; }); p.on('console', m => { if (/Refused to|Content Security Policy/.test(m.text())) { console.log('CSP', m.text().slice(0, 200)); fails++; } });
const tiles = []; p.on('request', r => { if (/arcgisonline|nationalmap/.test(r.url())) tiles.push(r.url()); });
await p.goto(BASE + '?to=40.6930,-74.1520&name=Port%20Newark%20Terminal', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => TruckNav?.ready, null, { timeout: 40000, polling: 500 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.waitForFunction(() => TruckNav.route?.line?.length > 10, null, { timeout: 60000, polling: 500 });
// NWS forecast at ETA
ok(await p.waitForFunction(() => /Forecast when you get there \(NWS\)/.test(document.querySelector('#wxFc')?.textContent || '') && TruckNav.forecast?.filter(x => x.p).length >= 2, null, { timeout: 45000 }).then(() => true, () => false), 'NWS hourly forecast shown for start/midway/destination at ETA');
console.log('  ', (await p.textContent('#wxFc').catch(() => '')).slice(0, 220));
// Waze embed panel
await p.evaluate(() => { document.querySelector('#wazeOpen') || document.querySelector('#tfBox')?.insertAdjacentHTML('beforeend', ''); });
const hasBtn = await p.waitForSelector('#wazeOpen', { state: 'attached', timeout: 20000 }).then(() => true, () => false); ok(hasBtn, 'Waze live map button next to the traffic second-opinion links');
if (hasBtn) { await p.evaluate(() => document.querySelector('#wazeOpen').click()); await p.waitForSelector('#wazePanel:not(.hidden) iframe', { timeout: 10000 }); ok(/^https:\/\/embed\.waze\.com\/iframe\?zoom=13&lat=/.test(await p.getAttribute('#wazeFrame', 'src')), 'Waze embed opens in its own panel (embed.waze.com iframe)');
  await p.waitForTimeout(4000); ok(await p.evaluate(() => !!document.querySelector('#wazeFrame')), 'Waze iframe loaded without CSP violations'); await p.screenshot({ path: '/workspace/truckers-gps-shots/r4/waze-panel.png' }); }
// multi-tap lock
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#truckPanel').classList.remove('hidden'); });
await p.evaluate(() => { TruckNav.pos = { ...(TruckNav.pos || { lat: 40.8085, lon: -73.874 }), speed: 13.4 }; }); // 30 mph
await p.waitForFunction(() => document.body.classList.contains('moving'), null, { timeout: 5000 }).catch(() => {});
await p.waitForTimeout(900);
ok(await p.evaluate(() => getComputedStyle(document.querySelector('#truckPanel')).display === 'none' && !document.querySelector('#mtLock').hidden), 'moving > 5 mph: truck settings panel hidden, "Paused while moving" card shown');
await p.screenshot({ path: '/workspace/truckers-gps-shots/r4/multitap-lock.png' });
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#loadPanel')?.classList.remove('hidden'); }); await p.waitForTimeout(600);
ok(await p.evaluate(() => getComputedStyle(document.querySelector('#loadPanel')).display === 'none'), 'moving: load board panel hidden too');
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#sosPanel')?.classList.remove('hidden'); }); await p.waitForTimeout(600);
ok(await p.evaluate(() => getComputedStyle(document.querySelector('#sosPanel')).display !== 'none'), 'SOS stays available while moving');
await p.evaluate(() => { document.querySelector('#sosPanel').classList.add('hidden'); document.querySelector('#truckPanel').classList.remove('hidden'); }); await p.waitForTimeout(600);
await p.evaluate(() => { const c = document.querySelector('#mtLock'); c.hidden = false; document.querySelector('#mtPass').click(); }); await p.waitForTimeout(600);
ok(await p.evaluate(() => getComputedStyle(document.querySelector('#truckPanel')).display !== 'none'), 'passenger unlock shows the panel (10 min)');
await p.evaluate(() => { TruckNav.passenger = false; TruckNav.pos = { ...TruckNav.pos, speed: 0 }; }); await p.waitForTimeout(900);
ok(await p.evaluate(() => getComputedStyle(document.querySelector('#truckPanel')).display !== 'none' && document.querySelector('#mtLock').hidden), 'stopped: panels usable again, lock card gone');
// imagery: USGS, never Esri
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#satBtn')?.click(); }); await p.waitForTimeout(4000);
ok(tiles.some(u => /nationalmap\.gov/.test(u)) && !tiles.some(u => /arcgisonline/.test(u)), `satellite uses USGS National Map tiles (public domain), no Esri (${tiles.length} tile requests)`);
// OSM truck parking + weigh stations in the corridor query
ok(await p.evaluate(async () => { const { overpassQuery } = await import('./js/logic.js'); const q = overpassQuery([[-74, 40.7], [-73.9, 40.8]]); return /amenity"="parking"\]\["hgv"/.test(q) && /weigh_station/.test(q) && /weighbridge/.test(q); }), 'route corridor query includes OSM truck parking and weigh stations');
await b.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

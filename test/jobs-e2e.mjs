// Job Finder driver tools on real data: crowd parking (server), HOS "short → last parking", shared facility notes, weekly pay, CDL/med reminders.
import { chromium, devices } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8841/', SH = '/workspace/truckers-gps-shots/r4';
const CFG = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), U = CFG.match(/url: '([^']+)'/)[1], K = CFG.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/testusers.json')); let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; };
const mk = async u => { const c = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await c.auth.signInWithPassword(u); return c; };
const X = await mk(users.dispatcher), Dv = await mk(users.driver); await Dv.from('parking_reports').delete().eq('reporter', users.driver.id); await X.from('facility_notes').delete().eq('author', users.dispatcher.id); await Dv.from('facility_notes').delete().eq('author', users.driver.id);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), H = 3600e3;
async function app(user, { hos, creds } = {}) { const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8296, longitude: -73.8876 }, permissions: ['geolocation'] });
  await ctx.addInitScript(([hos, creds]) => { if (sessionStorage.getItem('rrinit')) return; sessionStorage.setItem('rrinit', 1); localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); if (hos) localStorage.setItem('tn_hos', JSON.stringify(hos)); if (creds) localStorage.setItem('tn_creds', JSON.stringify(creds)); }, [hos, creds]);
  const p = await ctx.newPage(); p.on('pageerror', e => { console.log(user?.email?.slice(0, 6), 'PAGE ERROR', e.message); fails++; });
  await p.goto(BASE); await p.waitForFunction(() => TruckNav?.accountReady && TruckNav.backendReady && TruckNav.jobs, null, { timeout: 40000 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
  if (user) { await p.click('#acctBtn'); await p.click('[data-t="in"]'); await p.fill('#acEmail', user.email); await p.fill('#acPass', user.password); await p.click('#acGo'); await p.waitForFunction(() => TruckNav.auth.user?.method === 'supabase', null, { timeout: 30000 }); await p.evaluate(() => document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'))); }
  return p; }
const now = Date.now(), hos = [{ t: now - 22 * H, s: 'off' }, { t: now - 10 * H, s: 'on' }, { t: now - 9.75 * H, s: 'drive' }];
const p = await app(users.driver, { hos, creds: { med: new Date(now + 10 * 864e5).toISOString().slice(0, 10), cdl: '2029-04-30' } });
// 1. CDL / med card reminder banner on open
ok(await p.waitForSelector('#credBanner', { timeout: 8000 }).then(() => true, () => false) && /DOT medical card expires in (9|10) days/.test(await p.textContent('#credBanner')), 'med-card reminder banner on open: ' + await p.textContent('#credBanner').catch(() => ''));
await p.screenshot({ path: SH + '/390-cred-banner.png' }); await p.click('[data-credok]');
// 2. HOS: 1h15m of driving left, real route Bronx → Harrisburg PA, real POIs
await p.evaluate(() => TruckNav.setDest({ lat: 40.2732, lon: -76.8867, name: 'Harrisburg, PA' })); await p.waitForFunction(() => TruckNav.route?.time > 2 * 3600, null, { timeout: 40000 });
ok(await p.evaluate(() => Math.round(TruckNav.hos.driveLeft / 60e3)) <= 75, 'HOS engine: about 1h15m of driving left');
await p.evaluate(() => TruckNav.loadPois?.() ?? document.querySelector('#poiBtn').click()); await p.waitForFunction(() => TruckNav.pois?.some(x => x.kind === 'stop' || x.kind === 'rest'), null, { timeout: 60000 });
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#routePanel').classList.remove('hidden'); }); await p.waitForSelector('#hosPark', { timeout: 15000 }).catch(async e => { console.log('DBG', await p.evaluate(() => JSON.stringify({ hos: TruckNav.hos && TruckNav.hos.driveLeft, len: TruckNav.route.length, time: TruckNav.route.time, hp: TruckNav.hosParking, nav: TruckNav.nav, rp: document.querySelector('#routePanel').className, par: document.querySelector('#hosPark')?.parentElement?.id + '/' + document.querySelector('#hosPark')?.parentElement?.className, eta: document.querySelector('#hosEta')?.outerHTML?.slice(0, 120), np: TruckNav.pois.length }))); throw e; }); const hp = await p.textContent('#hosPark'); const pick = await p.evaluate(() => TruckNav.hosParking);
ok(/short of the destination/.test(hp) && (pick.pick ? hp.includes(pick.pick.name || 'Truck parking') && pick.pick.mi <= pick.reachMi : /No truck parking/.test(hp)), 'route sheet: "Xh short" + last reachable parking: ' + hp.replace(/\s+/g, ' ').slice(0, 160));
ok(pick.pick == null || pick.pick.mi < 75 * 1.2, 'pick is within the miles you can still drive');
await p.screenshot({ path: SH + '/390-hos-parking.png' });
// 3. parking report on a real truck stop marker → server → visible to a guest
const poi = await p.evaluate(async () => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); for (const m of document.querySelectorAll('.poi-marker')) { m.click(); await new Promise(r => setTimeout(r, 300)); if (document.querySelector('.maplibregl-popup [data-pk]')) return true; m.click(); } return false; });
await p.waitForSelector('.maplibregl-popup [data-pk] [data-pks="some"]', { timeout: 8000 }); const pid = await p.getAttribute('.maplibregl-popup [data-pk]', 'data-pk');
await p.click('.maplibregl-popup [data-pks="some"]'); await p.waitForFunction(() => /A few spots left/.test(document.querySelector('.maplibregl-popup [data-pkline]')?.textContent), null, { timeout: 8000 });
ok(/just now|0 min/.test(await p.textContent('.maplibregl-popup [data-pkline]')), 'parking "Some" reported with timestamp');
const { data: pr } = await Dv.from('parking_reports').select('*').eq('poi', pid); ok(pr.length === 1 && pr[0].status === 'some', 'report stored on the server');
await p.click('.maplibregl-popup [data-pks="full"]'); await p.waitForTimeout(1200); ok(/last 15 minutes/.test(await p.textContent('#toast')), 'repeat report within 15 min refused (abuse limit)');
await p.screenshot({ path: SH + '/390-parking-report.png' });
await p.evaluate(() => { document.querySelectorAll('.maplibregl-popup').forEach(x => x.remove()); document.querySelector('#routePanel').classList.remove('hidden'); });
if (pick.pick) { await p.click('[data-hpgo]'); await p.waitForFunction(n => TruckNav.stops?.[0]?.name?.includes(n), pick.pick.name || 'Truck parking', { timeout: 5000 }); ok(true, '"Stop there" adds the lot as a stop'); }
const G = await app(null); const seen = await G.evaluate(async id => { await TruckNav.jobs.loadParking(true); return TruckNav.parking?.[id]; }, pid).catch(() => null);
const { data: anonRows } = await createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }).from('parking_reports').select('status').eq('poi', pid); ok(anonRows?.[0]?.status === 'some', 'guest (not signed in) can read the parking status');
// 4. facility notes shared between drivers
const FAC = { lat: 40.8085, lon: -73.8740, name: 'Hunts Point Produce Market' };
await p.evaluate(f => { TruckNav.stops = []; return TruckNav.setDest(f); }, FAC); await p.evaluate(() => TruckNav.openFac()); await p.waitForSelector('#facGate');
await p.fill('#facGate', '#4471'); await p.dispatchEvent('#facGate', 'change'); await p.selectOption('#facOver', 'no'); await p.fill('#facEnt', 'Enter on Halleck St, guard shack on the right'); await p.dispatchEvent('#facEnt', 'change');
await p.waitForTimeout(1500); const { data: fn } = await Dv.from('facility_notes').select('*').eq('author', users.driver.id); ok(fn?.[0]?.gate_code === '#4471' && fn[0].overnight === 'no', 'facility notes saved and shared');
await p.screenshot({ path: SH + '/390-facility-notes.png' });
ok(/Gate code #4471\. Enter on Halleck St.*No overnight parking/.test(await p.evaluate(() => TruckNav.jobs.facSummary(TruckNav.facilities['40.8085,-73.8740'] || {}))), 'last-mile card summary has gate code, entrance, overnight');
const q = await app(users.dispatcher); await q.evaluate(f => TruckNav.setDest(f), FAC); await q.waitForTimeout(2500); await q.evaluate(() => TruckNav.openFac());
ok(await q.waitForSelector('[data-faco]', { timeout: 10000 }).then(async () => /Gate #4471.*overnight: ⛔ no.*Halleck/.test((await q.textContent('#facOthers')).replace(/\s+/g, ' ')), () => false), 'another driver sees the shared notes under "From other drivers"');
// 5. weekly pay from a real delivered load (server flow incl. POD) + lumper receipt
const { data: L } = await X.from('loads').insert({ driver: users.driver.id, ref: 'PAY-' + now.toString(36), pickup_address: 'Hunts Point', pickup_lat: 40.81, pickup_lng: -73.87, dropoff_address: 'Port Newark', dropoff_lat: 40.69, dropoff_lng: -74.15, rate_usd: 900, detention: { free_min: 0, rate_hr: 60 } }).select().single();
const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await Dv.rpc('driver_update_load', { p_id: L.id, p_status: 'accepted' }); for (const [i, e] of [[0, 'arrive'], [0, 'depart'], [1, 'arrive']]) { const r = await Dv.rpc('driver_stop_event', { p_id: L.id, p_idx: i, p_event: e }); if (r.error) console.log(r.error.message); }
await Dv.from('load_events').insert({ load_id: L.id, kind: 'doc', body: { type: 'lumper', amount: 85, data: img } });
const dr = await Dv.rpc('driver_stop_event', { p_id: L.id, p_idx: 1, p_event: 'depart', p_pod: { name: 'Dock 2', pieces: 10, photo: img, signature: img } }); ok(!dr.error && dr.data.status === 'delivered', 'load delivered through the POD flow');
await p.evaluate(() => TruckNav.refreshCloudLoads()); await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#meBtn').click(); });
await p.waitForSelector('#mePay [data-paytot]', { timeout: 15000 }); const wk = await p.$eval('#mePay details[open]', d => ({ tot: d.querySelector('[data-paytot]').textContent, lum: d.querySelector('[data-paylum]').textContent, det: d.querySelector('[data-paydet]').textContent, txt: d.textContent }));
const tot = +wk.tot.replace(/[$,]/g, ''), det = +wk.det.replace(/[$,]/g, ''); ok(tot >= 985 && Math.abs(tot - (900 + 85 + det)) < 0.01 && /PAY-/.test(wk.txt) && /LUMPER/.test(wk.txt), `weekly pay: $900 linehaul + $85 lumper + ${wk.det} detention = ${wk.tot}`);
await p.$eval('#mePay', e => e.scrollIntoView()); await p.screenshot({ path: SH + '/390-weekly-pay.png' });
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#mePay details[open] [data-paycsv]')]); const csv = fs.readFileSync(await dl.path(), 'utf8'); ok(/TOTAL/.test(csv) && csv.includes('PAY-'), 'pay week exports to CSV');
// 6. credentials editor
await p.$eval('#meCreds', e => e.scrollIntoView()); ok(/DOT medical card expires in/.test(await p.textContent('#credState')), 'Me > Licenses shows the med-card warning');
await p.fill('[data-cred="cdl"]', new Date(now - 2 * 864e5).toISOString().slice(0, 10)); await p.dispatchEvent('[data-cred="cdl"]', 'change'); ok(/CDL expired/.test(await p.textContent('#credState')), 'expired CDL flagged');
await p.screenshot({ path: SH + '/390-licenses.png' });
await p.reload(); await p.waitForFunction(() => TruckNav?.jobs); await p.waitForTimeout(5000); ok(/CDL expired/.test(await p.textContent('#credBanner').catch(() => '')), 'after a change the banner shows the worst one (expired CDL)');
await p.click('[data-credok]'); await p.reload(); await p.waitForFunction(() => TruckNav?.jobs); await p.waitForTimeout(5000); ok(!(await p.$('#credBanner')), 'dismissed banner stays away for the rest of the day');
// cleanup
await X.from('loads').delete().eq('id', L.id); await Dv.from('parking_reports').delete().eq('reporter', users.driver.id); await Dv.from('facility_notes').delete().eq('author', users.driver.id);
await browser.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

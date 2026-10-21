// Browser e2e against the live server: driver signs in in the app, dispatcher offers a load over the API, it appears (realtime) in the driver's
// Loads panel, driver accepts + starts it; driver posts a hazard which a guest sees on the map. Cleans up after itself.
// BASE=url RR_TEST_USERS=/path node test/supabase-e2e.mjs
import { chromium, devices } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8766/', SH = '/workspace/truckers-gps-shots/supabase'; fs.mkdirSync(SH, { recursive: true });
const CFG = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), U = CFG.match(/url: '([^']+)'/)[1], K = CFG.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync(process.env.RR_TEST_USERS || '/workspace/.rr-secrets/testusers.json'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const X = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await X.auth.signInWithPassword(users.dispatcher);
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8160, longitude: -73.88 }, permissions: ['geolocation'] });
const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGE ERROR', e.message)); p.on('dialog', d => d.accept(''));
const wait = (fn, arg, s = 30) => p.waitForFunction(fn, arg, { timeout: s * 1000, polling: 300 }).then(() => true).catch(() => false);
await p.goto(BASE); await p.waitForFunction(() => TruckNav?.accountReady && TruckNav.backendReady, null, { timeout: 40000 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
ok(await p.evaluate(() => TruckNav.auth.kind === 'supabase' && TruckNav.backend.name === 'supabase'), 'app uses Supabase auth + hazards backend');
await p.click('#acctBtn'); await p.click('[data-t="in"]'); await p.fill('#acEmail', users.driver.email); await p.fill('#acPass', users.driver.password); await p.click('#acGo');
ok(await wait(() => TruckNav.auth.user?.method === 'supabase'), 'driver signed in via email+password'); await p.screenshot({ path: SH + '/1-signed-in.png' });
await p.waitForTimeout(2500);
const { data: L } = await X.from('loads').insert({ driver: users.driver.id, ref: 'E2E-' + Date.now().toString(36), pickup_address: '355 Food Center Dr, Bronx, NY', pickup_lat: 40.8085, pickup_lng: -73.874, dropoff_address: '1 Export St, Newark, NJ', dropoff_lat: 40.693, dropoff_lng: -74.152, rate_usd: 850, commodity: 'Produce' }).select().single();
await p.click('#loadsBtn');
ok(await wait(id => !!document.querySelector(`[data-cload="${id}"]`), L.id, 20), 'offered load appears in driver Loads inbox'); await p.screenshot({ path: SH + '/2-load-offered.png' });
await p.click(`[data-cload="${L.id}"] [data-cs="accepted"]`); ok(await wait(id => document.querySelector(`[data-cload="${id}"] [data-state]`)?.textContent === 'Accepted', L.id), 'driver accepted in app');
const { data: Lx } = await X.from('loads').select('status').eq('id', L.id).single(); ok(Lx.status === 'accepted', 'dispatcher sees accepted');
await p.click(`[data-cload="${L.id}"] [data-cs="in_transit"]`); await p.waitForTimeout(1500); await p.screenshot({ path: SH + '/3-in-transit.png' });
ok((await X.from('loads').select('status').eq('id', L.id).single()).data.status === 'in_transit', 'in transit synced');
// hazard from app -> server -> guest
const hid = await p.evaluate(async () => { const r = await TruckNav.report('police', [-73.881, 40.817]); return r.id; }); await p.waitForTimeout(1500);
const G = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); const { data: gh } = await G.from('hazards').select('id,type').eq('id', hid);
ok(gh?.length === 1, 'hazard reported in app is on the server for everyone');
await X.from('loads').delete().eq('id', L.id); await p.evaluate(async () => { const c = await TruckNav.cloud?.sb(); }); 
const D = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await D.auth.signInWithPassword(users.driver); await D.from('hazards').delete().eq('id', hid); await D.from('live_locations').delete().eq('user_id', users.driver.id);
await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);

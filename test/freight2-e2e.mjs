// Geofence auto-arrive + 60 s undo, detention heads-up, stop exceptions → board alert, offline outbox, board search; hazmat tunnels; 53' NYC note.
import { chromium, devices } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8841/', SH = '/workspace/truckers-gps-shots/r4';
const CFG = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), U = CFG.match(/url: '([^']+)'/)[1], K = CFG.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/testusers.json')); let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; };
const X = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await X.auth.signInWithPassword(users.dispatcher); await X.from('loads').delete().like('ref', 'G2-%');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), REF = 'G2-' + Date.now().toString(36).toUpperCase();
const PU = { lat: 40.8085, lng: -73.8740 };
const { data: L } = await X.from('loads').insert({ driver: users.driver.id, ref: REF, pickup_address: 'Hunts Point Produce Market, Bronx', pickup_lat: PU.lat, pickup_lng: PU.lng, dropoff_address: 'Port Newark', dropoff_lat: 40.69, dropoff_lng: -74.15, detention: { free_min: 10, rate_hr: 60 }, reefer: { setpoint: 34, min: 32, max: 36 }, rate_usd: 500 }).select().single();
// dispatcher board
const dc = await browser.newContext({ viewport: { width: 1100, height: 1200 } }), d = await dc.newPage(); d.on('pageerror', e => { console.log('DISP', e.message); fails++; });
await d.goto(BASE + 'dispatch.html'); await d.waitForFunction(() => document.querySelector('#sbIn').onclick); await d.fill('#sbEmail', users.dispatcher.email); await d.fill('#sbPass', users.dispatcher.password); await d.click('#sbIn'); await d.waitForFunction(() => window.RRB, null, { timeout: 30000 });
await d.fill('#bSearch', REF); await d.waitForTimeout(300); ok((await d.$$('[data-bload]')).length === 1, 'board search by ref finds exactly that load');
// driver parked at the pickup gate
const vc = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: PU.lat + 0.0006, longitude: PU.lng }, permissions: ['geolocation'] }); const p = await vc.newPage(); p.on('pageerror', e => { console.log('APP', e.message); fails++; });
await p.goto(BASE); await p.waitForFunction(() => TruckNav?.accountReady && TruckNav.backendReady, null, { timeout: 40000 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.click('#acctBtn'); await p.click('[data-t="in"]'); await p.fill('#acEmail', users.driver.email); await p.fill('#acPass', users.driver.password); await p.click('#acGo');
await p.waitForFunction(() => TruckNav.auth.user?.method === 'supabase', null, { timeout: 30000 }); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'))); await p.click('#loadsBtn');
const C = `[data-cload="${L.id}"]`; await p.waitForSelector(C + ' [data-cs="accepted"]', { timeout: 20000 }); await p.click(C + ' [data-cs="accepted"]');
ok(await p.waitForSelector('#fxUndo', { timeout: 15000 }).then(() => true, () => false) && /logged automatically/.test(await p.textContent('#fxUndo')), 'geofence (within 150 m, stopped) logs the arrival automatically with Undo');
const a1 = (await X.from('loads').select('stops,status').eq('id', L.id).single()).data; ok(a1.stops[0].arrived_at && a1.status === 'in_transit', 'auto arrival on the server');
// detention heads-up (10 min free → inside the 15-min window)
await p.waitForTimeout(2000); const soon = (await X.from('load_events').select('body').eq('load_id', L.id).eq('kind', 'note')).data; ok(soon.some(e => e.body.detention_soon > 0), 'detention heads-up posted to dispatch');
await p.screenshot({ path: SH + '/390-auto-arrive-undo.png' });
await p.click('[data-fundo]'); await p.waitForTimeout(2500); ok(!(await X.from('loads').select('stops').eq('id', L.id).single()).data.stops[0].arrived_at, 'Undo within 60 s removes the arrival on the server');
ok(await p.waitForSelector(C + ' [data-farr="0"]', { timeout: 10000 }).then(() => true, () => false), 'stop back to "I\'ve arrived" and not auto-logged again');
await p.click(C + ' [data-farr="0"]'); await p.waitForSelector(C + ' [data-fexc]');
await p.selectOption(C + ' [data-fexc]', 'Not ready / waiting on freight'); await p.waitForSelector(C + ' [data-exc]', { timeout: 10000 }); ok(true, 'driver reports a stop problem');
ok(await d.waitForFunction(() => /Not ready/.test(document.querySelector('#bAlerts')?.textContent || ''), null, { timeout: 15000 }).then(() => true, () => false), 'dispatcher gets a live alert for the problem');
await d.evaluate(() => RRB.refresh()); ok(/Not ready/.test(await d.textContent(`[data-bload="${L.id}"] [data-bexc]`)) && (await d.$(`[data-bload="${L.id}"] [data-bsoon]`)) != null, 'board card shows the exception and the detention heads-up');
await d.screenshot({ path: SH + '/dispatch-alerts.png' });
// offline outbox
await vc.setOffline(true); await p.fill(C + ' [data-ftemp]', '35'); await p.click(C + ' [data-flogtemp]'); await p.waitForSelector(C + ' [data-pending]', { timeout: 8000 }); ok(/1 waiting for signal/.test(await p.textContent(C + ' [data-pending]')), 'offline: temp reading queued with a pending badge');
await p.screenshot({ path: SH + '/390-offline-outbox.png' });
await vc.setOffline(false); await p.evaluate(() => TruckNav.freight.flush()); await p.waitForTimeout(2000);
const t = (await X.from('load_events').select('body').eq('load_id', L.id).eq('kind', 'temp')).data; console.log('  temps', JSON.stringify(t)); ok(t.length === 1 && t[0].body.f === 35, 'back online: queued reading delivered once'); ok(await p.evaluate(() => TruckNav.freight.outbox().length === 0), 'outbox empty');
await X.from('loads').delete().eq('id', L.id);
// hazmat tunnels: Midtown Manhattan → Jersey City
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); TruckNav.pos = { lat: 40.7570, lon: -73.9900, speed: 0, acc: 5 }; TruckNav.stops = []; });
const names = async hz => { await p.evaluate(h => TruckNav.setTruck({ hazmat: h }), hz); await p.evaluate(() => TruckNav.setDest({ lat: 40.7282, lon: -74.0776, name: 'Jersey City' })); await p.waitForFunction(() => TruckNav.route?.maneuvers?.length, null, { timeout: 40000 }); await p.waitForTimeout(2500);
  return p.evaluate(() => ({ n: TruckNav.route.maneuvers.flatMap(m => [...(m.street_names || []), m.instruction || '']).join(' | '), hz: (TruckNav.dangers || []).filter(d => d.kind === 'hazmat').map(d => d.short) })); };
const plain = await names(false), hz = await names(true);
console.log('  plain:', /Lincoln|Holland/i.exec(plain.n)?.[0] || '(no tunnel)', ' hazmat:', /Lincoln|Holland/i.exec(hz.n)?.[0] || '(no tunnel)', hz.hz);
ok(!/Lincoln Tunnel|Holland Tunnel/i.test(hz.n) || hz.hz.some(x => /Tunnel/.test(x)), 'hazmat on: route avoids Lincoln/Holland tunnels or flags them as banned');
ok(await p.$('#nycOff [data-nyc53]') != null || await p.evaluate(() => { document.querySelector('#routePanel').classList.remove('hidden'); return !!document.querySelector('#nycOff [data-nyc53]'); }), '70 ft rig in NYC: 53′/55 ft interstate-only note on the route sheet');
await p.evaluate(() => TruckNav.setTruck({ hazmat: false }));
await browser.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

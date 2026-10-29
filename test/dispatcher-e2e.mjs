// Dispatcher END on the real RigRoute server: fleet + invite codes, driver joins in the app, live map/HOS, contacts, multi-stop load with pickup PIN,
// Valhalla ETA, rate con PDF, POD-gated delivery, invoice (CSV + PDF), analytics, today view, role permissions and a cross-fleet RLS audit.
import { chromium, devices } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8841/', SH = '/workspace/truckers-gps-shots/r4'; fs.mkdirSync(SH, { recursive: true });
const cfg = fs.readFileSync('js/config.js', 'utf8'), U = cfg.match(/url:\s*'([^']+)'/)[1], K = cfg.match(/anonKey:\s*'([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/testusers.json')); let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; return c; };
const mk = () => createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); const X = mk(), Y = mk(), A = mk();
await X.auth.signInWithPassword(users.dispatcher); await Y.auth.signInWithPassword(users.driver);
for (const C of [X, Y]) { const { data } = await C.from('fleets').select('id,name').like('name', 'E2E%'); for (const f of data || []) { await C.from('loads').delete().eq('fleet', f.id); await C.from('fleets').delete().eq('id', f.id); } }
await X.from('loads').delete().like('ref', 'FL-%');
const TS = Date.now().toString(36).toUpperCase(), FNAME = 'E2E Fleet ' + TS, REF = 'FL-' + TS;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const dc = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true }), d = await dc.newPage(); d.on('pageerror', e => { console.log('DISP PAGE ERROR', e.message); fails++; });
d.on('console', m => { if (/Refused to|Content Security Policy/.test(m.text())) { console.log('CSP', m.text().slice(0, 160)); fails++; } });
await d.goto(BASE + 'dispatch.html'); await d.waitForFunction(() => document.querySelector('#sbIn').onclick); await d.fill('#sbEmail', users.dispatcher.email); await d.fill('#sbPass', users.dispatcher.password); await d.click('#sbIn');
await d.waitForFunction(() => window.RRB && window.RRF, null, { timeout: 30000 });
const tab = async t => { await d.click(`.fx-tabs [data-tab="${t}"]`); await d.waitForTimeout(400); };
// 1. fleet + invite
await tab('fleet'); await d.waitForSelector('#fxNewName, #fxInvD'); if (await d.$('#fxInvD')) { /* has another fleet: create a new one through RPC-free UI path */ }
if (await d.$('#fxNewName')) { await d.fill('#fxNewName', FNAME); await d.click('#fxCreate'); } else { const { data: fid } = await X.rpc('create_fleet', { p_name: FNAME }); await d.evaluate(f => localStorage.setItem('rr_fleet', f), fid); await d.reload(); await d.waitForFunction(() => window.RRF); await tab('fleet'); }
await d.waitForSelector('#fxInvD', { timeout: 15000 }); ok(/you are owner/.test(await d.textContent('#fxFleet')), 'dispatcher created fleet "' + FNAME + '" and is owner');
const FID = await d.evaluate(() => RRF.fleet);
await d.click('#fxInvD'); await d.waitForFunction(() => /invite code: \w{6,}/.test(document.querySelector('#fxMsg')?.textContent || ''), null, { timeout: 15000 }); const CODE = (await d.textContent('#fxMsg')).match(/code: (\w+)/)[1]; ok(true, 'driver invite code ' + CODE);
await d.screenshot({ path: SH + '/dispatcher-fleet.png', fullPage: true });
// 2. driver joins in the app (UI), consents to share
const vc = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8085, longitude: -73.874 }, permissions: ['geolocation'] }); const p = await vc.newPage(); p.on('pageerror', e => { console.log('APP PAGE ERROR', e.message); fails++; });
await p.goto(BASE); await p.waitForFunction(() => TruckNav?.accountReady && TruckNav.backendReady, null, { timeout: 40000 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.click('#acctBtn'); await p.click('[data-t="in"]'); await p.fill('#acEmail', users.driver.email); await p.fill('#acPass', users.driver.password); await p.click('#acGo');
await p.waitForFunction(() => TruckNav.auth.user?.method === 'supabase', null, { timeout: 30000 }); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'))); await p.click('#loadsBtn');
await p.waitForSelector('#fleetCode', { timeout: 20000 }); await p.fill('#fleetCode', CODE); await p.fill('#fleetUnit', '7'); await p.evaluate(() => { window.confirm = () => true; }); await p.click('#fleetGo');
ok(await p.waitForFunction(n => document.querySelector('[data-fleetbox]')?.textContent.includes(n), FNAME, { timeout: 20000 }).then(() => true, () => false), 'driver joined the fleet in the app with unit 7');
ok((await Y.rpc('join_fleet', { p_code: CODE })).error != null, 'invite code is single-use');
await p.evaluate(() => TruckNav.fleetDriver.tick(true)); await p.waitForTimeout(2500);
const { data: ll } = await X.from('live_locations').select('*').eq('user_id', users.driver.id); ok(ll?.length === 1 && ll[0].sharing, 'dispatcher can read the fleet driver\'s shared location');
const { data: hh } = await X.from('driver_hos').select('*').eq('user_id', users.driver.id); ok(hh?.length === 1 && hh[0].drive_left_min != null, 'dispatcher can read the driver\'s HOS snapshot');
// 3. contacts
await d.evaluate(() => RRF.refresh?.()); await tab('contacts'); await d.waitForSelector('#ctName'); await d.selectOption('#ctKind', 'broker'); await d.fill('#ctName', 'Dana Ruiz'); await d.fill('#ctCo', 'Acme Logistics ' + TS); await d.fill('#ctMc', '123456'); await d.fill('#ctEm', 'dana@example.com'); await d.click('#ctAdd');
ok(await d.waitForFunction(t => document.querySelector('#fxContacts').textContent.includes('Acme Logistics ' + t), TS, { timeout: 15000 }).then(() => true, () => false), 'broker contact saved');
// 4. live map + roster + HOS
await tab('map'); await d.waitForSelector('[data-drop]', { timeout: 15000 }); await d.waitForTimeout(2500);
ok(/Unit 7/.test(await d.textContent('#fxRoster')) && /Not an ELD · informational only/.test(await d.textContent('#fxRoster')), 'roster shows driver, unit 7, HOS with the not-an-ELD notice');
ok(await d.evaluate(() => document.querySelectorAll('.fx-mk').length >= 1), 'driver marker on the live map'); await d.screenshot({ path: SH + '/dispatcher-map.png', fullPage: true });
// 5. new multi-stop load to the fleet driver, with customer + PIN
await tab('board'); await d.selectOption('#bFleetDrv', users.driver.id); await d.selectOption('#bCust', { index: 1 }); await d.fill('#bRef', REF); await d.fill('#bRate', '1250');
const pick = async (i, q, re) => { await d.fill(`[data-bi="${i}"] [data-ba]`, ''); await d.type(`[data-bi="${i}"] [data-ba]`, q, { delay: 20 }); await d.waitForSelector(`[data-bi="${i}"] .b-sug:not([hidden]) [data-sg]`, { timeout: 15000 });
  const o = await d.$$eval(`[data-bi="${i}"] [data-sg]`, b => b.map(x => x.textContent)); const k = Math.max(0, o.findIndex(x => re.test(x))); await d.dispatchEvent(`[data-bi="${i}"] [data-sg="${k}"]`, 'mousedown'); };
await pick(0, 'Hunts Point Cooperative Market', /Bronx|Hunts/i); await d.click('#bAdd'); await pick(1, 'Yankee Stadium', /Bronx/i); await pick(2, 'Port Newark', /Newark/i);
const appt = h => d.evaluate(h => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(new Date(Date.now() + h * 3600e3)).replace(' ', 'T'), h);
await d.fill('[data-bi="0"] [data-bt]', await appt(0.5)); await d.dispatchEvent('[data-bi="0"] [data-bt]', 'change'); await d.fill('[data-bi="2"] [data-bt]', await appt(3)); await d.dispatchEvent('[data-bi="2"] [data-bt]', 'change');
await d.click('#bSend'); await d.waitForFunction(r => document.querySelector('#bMsg').textContent.includes('Sent ' + r), REF, { timeout: 20000 }).catch(async e => { console.log('bMsg:', await d.textContent('#bMsg')); throw e; });
const PIN = (await d.textContent('#bMsg')).match(/PIN (\d{4})/)?.[1]; ok(!!PIN, 'load sent with a pickup PIN shown to the dispatcher: ' + PIN);
const { data: L } = await X.from('loads').select('*').eq('ref', REF).single(); ok(L.fleet === FID && L.customer && /^[0-9a-f]{64}$/.test(L.pin_hash || '') && L.stops.length === 3, 'server row: fleet, customer, 3 stops, salted PIN hash only (no PIN)');
ok(!JSON.stringify(L).includes('"' + PIN + '"'), 'plain PIN never stored on the server');
const card = `[data-bload="${L.id}"]`; await d.waitForSelector(card + ' [data-cpin]', { timeout: 15000 }); ok((await d.textContent(card + ' [data-cpin]')).includes(PIN), 'PIN on the load card');
// rate con PDF
const [dl] = await Promise.all([d.waitForEvent('download', { timeout: 30000 }), d.click(card + ' [data-ratecon]')]); const pdf = fs.readFileSync(await dl.path()); ok(pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 1500, `rate confirmation PDF downloaded (${dl.suggestedFilename()}, ${pdf.length} bytes)`);
// fleet-shared PIN (server table load_pins; staff only)
await d.evaluate(() => localStorage.removeItem('rr_cloud_pins')); await d.evaluate(() => window.RRB.refresh()); await d.waitForTimeout(1500);
ok(((await d.textContent(card + ' [data-cpin]').catch(() => '')) || '').includes(PIN), 'PIN still on the card with no local copy (served from load_pins to fleet staff)');
ok(((await X.from('load_pins').select('pin').eq('load_id', L.id)).data || [])[0]?.pin === PIN, 'dispatcher reads the PIN from load_pins');
ok(((await Y.from('load_pins').select('pin').eq('load_id', L.id)).data || []).length === 0, 'driver cannot read the PIN (RLS)');
ok(((await A.from('load_pins').select('pin')).data || []).length === 0, 'anonymous cannot read PINs');
// per-load documents (Storage bucket load-docs)
await d.waitForTimeout(1500); const rc = await X.storage.from('load-docs').list(L.id); ok((rc.data || []).some(f => /^ratecon-\d+\.pdf$/.test(f.name)), 'rate con PDF filed to the load documents');
await d.click(card + ' [data-docs]'); await d.waitForSelector(`[data-docbox="${L.id}"] [data-docfile]`, { timeout: 15000 }); await d.selectOption(`[data-docbox="${L.id}"] [data-dockind]`, 'bol');
fs.writeFileSync('/tmp/bol-test.pdf', pdf); await d.setInputFiles(`[data-docbox="${L.id}"] [data-docfile]`, '/tmp/bol-test.pdf');
ok(await d.waitForFunction(id => /BOL ·/.test(document.querySelector(`[data-docbox="${id}"]`)?.textContent || ''), L.id, { timeout: 20000 }).then(() => true, () => false), 'BOL uploaded from the load card and listed');
const yl = await Y.storage.from('load-docs').list(L.id); ok((yl.data || []).length >= 2, 'assigned driver can see the load documents');
const yd = await Y.storage.from('load-docs').remove([L.id + '/' + yl.data[0].name]); ok(!yd.data?.length, 'driver cannot delete documents');
ok(((await A.storage.from('load-docs').list(L.id)).data || []).length === 0, 'anonymous cannot list load documents');
ok((await Y.storage.from('load-docs').upload(crypto.randomUUID() + '/bol-1.pdf', new Blob([pdf], { type: 'application/pdf' }))).error != null, 'cannot upload to a load you are not party to');
// profile privacy
ok(((await Y.from('profiles').select('*').eq('id', users.dispatcher.id)).data || []).length === 0, 'profiles: another user\'s full row is not readable');
ok(((await Y.from('profiles').select('id').limit(50)).data || []).length === 1, 'profiles: a user sees only their own row');
const { data: pp } = await X.rpc('peer_profiles', { p_ids: [users.driver.id] }); ok(pp?.length === 1 && pp[0].unit === '7' && !('truck' in pp[0]) && !('points' in pp[0]), 'fleet-mate visible via peer_profiles with minimal fields (name, unit, vehicle)');
ok(((await X.rpc('peer_profiles', { p_ids: ['00000000-0000-0000-0000-000000000001'] })).data || []).length === 0 && (await A.rpc('peer_profiles', { p_ids: [users.driver.id] })).data?.length !== 1, 'strangers and anonymous get nothing from peer_profiles');
await d.screenshot({ path: SH + '/dispatcher-docs.png', fullPage: true });
// 6. driver: accept, arrive, PIN gate on leaving the pickup (app UI)
await p.evaluate(() => document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'))); await p.click('#loadsBtn'); const C = `[data-cload="${L.id}"]`; await p.waitForSelector(C + ' [data-cs="accepted"]', { timeout: 30000 }); await p.click(C + ' [data-cs="accepted"]');
await p.waitForSelector(C + ' [data-fx] [data-farr="0"]', { timeout: 20000 }); await p.click(C + ' [data-fx] [data-farr="0"]'); await p.waitForSelector(C + ' [data-fx] [data-fdep="0"]', { timeout: 20000 });
await p.evaluate(w => { window.prompt = () => w; }, PIN === '0000' ? '1111' : '0000'); await p.click(C + ' [data-fx] [data-fdep="0"]'); await p.waitForTimeout(2500);
let { data: L2 } = await X.from('loads').select('stops').eq('id', L.id).single(); ok(!L2.stops[0].departed_at, 'wrong pickup PIN: server refuses to mark loaded');
await p.evaluate(w => { window.prompt = () => w; }, PIN); await p.click(C + ' [data-fx] [data-fdep="0"]'); await p.waitForTimeout(3000);
({ data: L2 } = await X.from('loads').select('stops,status').eq('id', L.id).single()); ok(!!L2.stops[0].departed_at && L2.status === 'in_transit', 'right PIN: left the pickup, load in transit');
// 7. ETA from Valhalla for the driver's vehicle
await p.evaluate(() => TruckNav.fleetDriver.tick(true)); await d.evaluate(() => RRF.refresh?.()); await d.evaluate(() => window.RRB.refresh());
ok(await d.waitForFunction(id => /ETA stop \d+: .+Valhalla (truck|auto)/.test(document.querySelector(`[data-bload="${id}"] [data-ceta]`)?.textContent || ''), L.id, { timeout: 40000 }).then(() => true, () => false), 'load card shows a real Valhalla ETA: ' + (await d.textContent(card + ' [data-ceta]').catch(() => '')));
await d.screenshot({ path: SH + '/dispatcher-board.png', fullPage: true });
// 8. finish stops via server (POD required) then invoice
const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
for (let i = 1; i < 3; i++) { await Y.rpc('driver_stop_event', { p_id: L.id, p_idx: i, p_event: 'arrive' }); const r = await Y.rpc('driver_stop_event', { p_id: L.id, p_idx: i, p_event: 'depart', p_pod: { photo: img, signature: img, name: 'R. Alvarez', pieces: 10 } }); if (r.error) console.log('stop', i, r.error.message); }
const { data: L3 } = await X.from('loads').select('status').eq('id', L.id).single(); ok(L3.status === 'delivered', 'delivered with POD');
await d.evaluate(() => window.RRB.refresh()); await tab('inv'); await d.waitForFunction(r => document.querySelector('#fxInv').textContent.includes(r), REF, { timeout: 15000 }); ok(true, 'delivered load listed as ready to invoice');
await d.selectOption('#invCust', { index: 1 }); await d.click('#invMake'); await d.waitForFunction(() => /Created INV-/.test(document.querySelector('#invMsg')?.textContent || ''), null, { timeout: 15000 }); ok(true, 'invoice created: ' + await d.textContent('#invMsg'));
const [csv] = await Promise.all([d.waitForEvent('download'), d.click('[data-invcsv]')]); const ct = fs.readFileSync(await csv.path(), 'utf8'); ok(ct.includes(REF) && /Total,,,,,1250\.00/.test(ct), 'invoice CSV has the load and $1,250.00 total');
const [ip] = await Promise.all([d.waitForEvent('download'), d.click('[data-invpdf]')]); ok(fs.readFileSync(await ip.path()).slice(0, 4).toString() === '%PDF', 'invoice PDF downloaded'); await d.screenshot({ path: SH + '/dispatcher-invoices.png', fullPage: true });
await d.click('[data-invpaid]'); await d.waitForFunction(() => /paid/.test(document.querySelector('#fxInv').textContent), null, { timeout: 10000 }); ok(true, 'invoice marked paid');
// 9. analytics + today
await tab('stats'); const rev = await d.textContent('[data-k="revenue"]'); ok(/\$1,250\.00|\$[\d,]+\.\d\d/.test(rev) && +(await d.textContent('[data-k="delivered"]')) >= 1, 'analytics: delivered ≥ 1, revenue ' + rev + ', on-time ' + await d.textContent('[data-k="ontime"]')); await d.screenshot({ path: SH + '/dispatcher-analytics.png', fullPage: true });
await tab('sched'); ok(await d.$$eval('[data-sched]', r => r.length) >= 1, 'today view lists appointments'); await d.screenshot({ path: SH + '/dispatcher-today.png', fullPage: true });
// 10. roles + RLS audit (one fleet never sees another's data)
ok((await Y.rpc('create_fleet_invite', { p_fleet: FID, p_role: 'driver' })).error != null, 'driver cannot create invites');
ok(((await Y.from('fleet_contacts').select('*').eq('fleet', FID)).data || []).length === 0, 'driver cannot read fleet contacts');
ok(((await Y.from('fleet_invoices').select('*').eq('fleet', FID)).data || []).length === 0, 'driver cannot read invoices');
const { data: FB } = await Y.rpc('create_fleet', { p_name: 'E2E Other ' + TS }); await Y.from('fleet_contacts').insert({ fleet: FB, kind: 'customer', name: 'Secret Shipper' });
ok(((await X.from('fleets').select('*').eq('id', FB)).data || []).length === 0, 'fleet A owner cannot see fleet B');
ok(((await X.from('fleet_contacts').select('*').eq('fleet', FB)).data || []).length === 0, 'fleet A cannot read fleet B contacts');
ok((await X.rpc('create_fleet_invite', { p_fleet: FB, p_role: 'driver' })).error != null, 'fleet A cannot mint invites for fleet B');
ok((await X.from('loads').insert({ id: crypto.randomUUID(), dispatcher: users.dispatcher.id, driver: users.driver.id, fleet: FB, ref: 'FL-X' + TS, status: 'offered', pickup_address: 'x', pickup_lat: 40, pickup_lng: -74, dropoff_address: 'y', dropoff_lat: 40.1, dropoff_lng: -74.1 })).error != null, 'fleet A cannot create loads in fleet B');
const { data: bad } = await X.from('loads').update({ driver: '00000000-0000-0000-0000-000000000001' }).eq('id', L.id).select(); ok(!bad?.length, 'reassign to a non-member driver is refused by RLS');
ok(((await A.from('fleets').select('*')).data || []).length === 0 && ((await A.from('fleet_contacts').select('*')).data || []).length === 0 && ((await A.from('driver_hos').select('*')).data || []).length === 0, 'anonymous sees no fleets, contacts or HOS');
// mobile console screenshot
const mc = await browser.newContext({ ...devices['iPhone 13'] }), m = await mc.newPage(); await m.goto(BASE + 'dispatch.html'); await m.waitForFunction(() => document.querySelector('#sbIn').onclick); await m.fill('#sbEmail', users.dispatcher.email); await m.fill('#sbPass', users.dispatcher.password); await m.click('#sbIn');
await m.waitForFunction(() => window.RRF && window.RRB, null, { timeout: 30000 }); await m.waitForTimeout(1500); await m.screenshot({ path: SH + '/dispatcher-mobile.png', fullPage: false }); ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'mobile dispatcher console has no horizontal overflow');
// cleanup
await X.from('loads').delete().eq('id', L.id); await X.from('fleets').delete().eq('id', FID); await Y.from('fleets').delete().eq('id', FB);
await browser.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

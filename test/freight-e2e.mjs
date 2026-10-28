// Dispatcher (dispatch.html board) ↔ driver (app) on the real RigRoute server: multi-stop load with autocomplete + address book,
// optimize, reefer; driver stop-by-stop timestamps, detention, temp log, BOL/lumper docs, messages, POD-gated delivery; late loads first.
import { chromium, devices } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8841/', SH = '/workspace/truckers-gps-shots/r4'; fs.mkdirSync(SH, { recursive: true });
const CFG = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), U = CFG.match(/url: '([^']+)'/)[1], K = CFG.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/testusers.json')); let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; };
const X = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await X.auth.signInWithPassword(users.dispatcher);
const Dv = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await Dv.auth.signInWithPassword(users.driver);
for (const c of [X]) { await c.from('loads').delete().like('ref', 'FX-%'); await c.from('address_book').delete().like('name', 'Hunts Point Market FX-%'); }
const REF = 'FX-' + Date.now().toString(36).toUpperCase(), browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
// ---- dispatcher board
const dc = await browser.newContext({ viewport: { width: 1100, height: 1300 } }), d = await dc.newPage(); d.on('pageerror', e => { console.log('DISP PAGE ERROR', e.message); fails++; });
d.on('dialog', x => x.accept(/Name/.test(x.message()) ? 'Hunts Point Market ' + REF : 'Gate 3 code 4471, trucks enter Halleck St'));
await d.goto(BASE + 'dispatch.html'); await d.waitForFunction(() => document.querySelector('#sbIn').onclick); await d.fill('#sbEmail', users.dispatcher.email); await d.fill('#sbPass', users.dispatcher.password); await d.click('#sbIn');
await d.waitForFunction(() => window.RRB, null, { timeout: 30000 }); ok(await d.isHidden('#log'), 'debug log hidden by default');
await d.fill('#bDriver', users.driver.email); await d.fill('#bRef', REF);
const pick = async (i, q, re) => { await d.fill(`[data-bi="${i}"] [data-ba]`, ''); await d.type(`[data-bi="${i}"] [data-ba]`, q, { delay: 20 }); await d.waitForSelector(`[data-bi="${i}"] .b-sug:not([hidden]) [data-sg]`, { timeout: 15000 });
  const opts = await d.$$eval(`[data-bi="${i}"] [data-sg]`, b => b.map(x => x.textContent)); const k = Math.max(0, opts.findIndex(o => re.test(o))); await d.dispatchEvent(`[data-bi="${i}"] [data-sg="${k}"]`, 'mousedown'); return opts[k]; };
const a0 = await pick(0, 'Hunts Point Cooperative Market', /Bronx|Hunts/i); ok(await d.evaluate(() => RRB.draft[0].lat != null), 'Photon autocomplete picked a real address: ' + a0);
await d.click('[data-bi="0"] [data-bsv]'); await d.waitForFunction(r => [...document.querySelectorAll('[data-book]')].some(b => b.textContent.includes(r)), REF, { timeout: 10000 }); ok(true, 'stop saved to address book with gate notes');
await d.click('#bAdd'); await d.click('#bAdd'); // pickup, drop, drop, drop
await pick(1, 'Newark Liberty International Airport', /Newark/i); await pick(2, 'Yankee Stadium', /Bronx/i); await pick(3, 'Jersey City', /Jersey City/i);
const before = await d.evaluate(() => RRB.draft.map(s => s.address)); await d.click('#bOpt'); const after = await d.evaluate(() => RRB.draft.map(s => s.address)); const om = await d.textContent('#bMsg');
const [o1, o2] = om.match(/([\d.]+) → ([\d.]+)/).slice(1).map(Number); ok(o2 < o1 && after[0] === before[0], `optimize kept the pickup first and shortened ${o1} → ${o2} mi`);
// address-book reuse: typing the saved name suggests ★ entry first
await d.fill('[data-bi="1"] [data-ba]', ''); await d.type('[data-bi="1"] [data-ba]', 'Hunts Point Mar', { delay: 20 }); await d.waitForSelector('[data-bi="1"] [data-sg="0"]'); ok(/★/.test(await d.textContent('[data-bi="1"] [data-sg="0"]')), 'saved place suggested first');
await pick(1, 'Newark Liberty International Airport', /Newark/i);
const apptPast = await d.evaluate(() => { const t = new Date(Date.now() - 3 * 3600e3), f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(t); return f.replace(' ', 'T'); });
await d.fill('[data-bi="0"] [data-bt]', apptPast); await d.dispatchEvent('[data-bi="0"] [data-bt]', 'change');
await d.check('#bReefer'); await d.fill('#bFree', '0'); await d.fill('#bDetR', '60'); await d.screenshot({ path: SH + '/dispatch-new-load.png', fullPage: true });
await d.click('#bSend'); await d.waitForFunction(r => document.querySelector('#bMsg').textContent.includes('Sent ' + r), REF, { timeout: 15000 }).catch(async e => { console.log('bMsg:', await d.textContent('#bMsg')); throw e; }); ok(true, 'multi-stop reefer load sent');
const { data: L } = await X.from('loads').select('*').eq('ref', REF).single(); ok(L.stops.length === 4 && L.reefer?.setpoint === 34 && L.stops[0].notes?.includes('Gate 3'), '4 stops + reefer + facility notes stored on the server');
const { data: L2 } = await X.from('loads').insert({ driver: users.driver.id, ref: REF + '-B', pickup_address: 'Port Newark', pickup_lat: 40.69, pickup_lng: -74.15, dropoff_address: 'Hunts Point', dropoff_lat: 40.81, dropoff_lng: -73.87, pickup_at: new Date(Date.now() + 5 * 3600e3).toISOString(), rate_usd: 400 }).select().single();
await d.evaluate(() => RRB.refresh()); await d.waitForTimeout(800);
const order = await d.$$eval('[data-bload]', c => c.map(x => [x.querySelector('header b').textContent, x.classList.contains('late')]));
ok(order[0][0] === REF && order[0][1], 'late load (pickup appt passed) is on top, flagged LATE: ' + order.slice(0, 3).map(o => o[0]).join(', '));
// ---- driver app
const vc = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.81, longitude: -73.88 }, permissions: ['geolocation'] }); const p = await vc.newPage(); p.on('pageerror', e => { console.log('APP PAGE ERROR', e.message); fails++; });
await p.goto(BASE); await p.waitForFunction(() => TruckNav?.accountReady && TruckNav.backendReady, null, { timeout: 40000 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.click('#acctBtn'); await p.click('[data-t="in"]'); await p.fill('#acEmail', users.driver.email); await p.fill('#acPass', users.driver.password); await p.click('#acGo');
await p.waitForFunction(() => TruckNav.auth.user?.method === 'supabase', null, { timeout: 30000 }); await p.waitForTimeout(2000); await p.evaluate(() => document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'))); await p.click('#loadsBtn');
const C = `[data-cload="${L.id}"]`; await p.waitForSelector(C + ' [data-cs="accepted"]', { timeout: 20000 }); await p.click(C + ' [data-cs="accepted"]');
await p.waitForSelector(C + ' [data-fx] [data-farr="0"]', { timeout: 15000 }); ok((await p.$$(C + ' .fx-stop')).length === 4, 'driver sees all 4 stops in order');
ok((await X.rpc('driver_update_load', { p_id: L.id, p_status: 'delivered' })).error != null, 'server refuses "delivered" without the stop flow');
await p.click(C + ' [data-farr="0"]'); await p.waitForSelector(C + ' [data-fdep="0"]', { timeout: 15000 });
ok(/Arrived \d/.test(await p.textContent(C + ' [data-stop="0"] [data-times]')), 'arrival timestamp shown'); ok(await p.waitForFunction(c => /Detention \d+m · \$\d/.test(document.querySelector(c + ' [data-stop="0"] [data-det]')?.textContent), C, { timeout: 10000 }).then(() => true, () => false), 'detention clock running and billing (0 min free)');
await p.fill(C + ' [data-ftemp]', '39.5'); await p.click(C + ' [data-flogtemp]'); ok(await p.waitForSelector(C + ' [data-tempr].high', { timeout: 10000 }).then(() => true, async () => { console.log('TOAST', await p.textContent('#toast')); return false; }), 'reefer temp 39.5°F logged and flagged out of range');
const img = await p.screenshot({ type: 'jpeg', quality: 50, clip: { x: 0, y: 0, width: 300, height: 300 } });
await p.$eval(C + ' [data-fdoct]', x => x.closest('details').open = true); await p.selectOption(C + ' [data-fdoct]', 'bol'); await p.setInputFiles(C + ' [data-fdoc]', { name: 'bol.jpg', mimeType: 'image/jpeg', buffer: img });
await p.waitForSelector(C + ' [data-docr="bol"]', { timeout: 15000 }); await p.selectOption(C + ' [data-fdoct]', 'lumper'); await p.fill(C + ' [data-fdocamt]', '125'); await p.setInputFiles(C + ' [data-fdoc]', { name: 'lumper.jpg', mimeType: 'image/jpeg', buffer: img });
await p.waitForSelector(C + ' [data-docr="lumper"]', { timeout: 15000 }); ok(true, 'BOL and $125 lumper receipt photos uploaded');
await p.click(C + ' [data-sec="msgs"] summary'); await p.click(C + ' [data-fq="At the gate"]'); await p.waitForSelector(C + ' [data-msg].me'); await p.screenshot({ path: SH + '/390-load-at-stop.png' });
await p.click(C + ' [data-fdep="0"]'); await p.waitForSelector(C + ' [data-farr="1"]', { timeout: 15000 });
// dispatcher message -> driver (realtime)
await X.from('load_events').insert({ load_id: L.id, kind: 'message', body: { text: 'Drop 2 opens at 6, take your break first' } });
ok(await p.waitForFunction(id => [...document.querySelectorAll(`[data-cload="${id}"] [data-msg]`)].some(m => m.textContent.includes('take your break')), L.id, { timeout: 15000 }).then(() => true, () => false), 'dispatcher message arrives in the driver app live');
for (const i of [1, 2]) { await p.click(C + ` [data-farr="${i}"]`); await p.waitForSelector(C + ` [data-fpod="${i}"]`, { timeout: 15000 });
  if (i === 1) { ok((await Dv.rpc('driver_stop_event', { p_id: L.id, p_idx: 1, p_event: 'depart', p_pod: { name: 'x', pieces: 3 } })).error?.message.includes('proof of delivery'), 'server refuses a drop without photo + signature');
    await p.click(C + ' [data-fpod="1"]'); ok(await p.isDisabled('#fxPodGo') && /photo, signature, name, pieces/.test(await p.textContent('#fxPodMsg')), 'POD submit disabled until photo, signature, name, pieces');
    await p.setInputFiles('#fxPodPhoto', { name: 'pod.jpg', mimeType: 'image/jpeg', buffer: img }); await p.fill('#fxPodName', 'R. Alvarez'); await p.fill('#fxPodPcs', '12');
    const b = await p.$eval('#fxPodSig', c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }); await p.mouse.move(b[0] + 20, b[1] + 60); await p.mouse.down(); for (let k = 0; k < 20; k++) await p.mouse.move(b[0] + 20 + k * 12, b[1] + 60 + Math.sin(k) * 25); await p.mouse.up();
    await p.check('#fxPodDmg'); ok(await p.isDisabled('#fxPodGo'), 'damage ticked needs a note'); await p.fill('#fxPodDmgT', '1 case crushed'); await p.waitForFunction(() => !document.querySelector('#fxPodGo').disabled); await p.screenshot({ path: SH + '/390-pod.png' });
    await p.click('#fxPodGo'); } else { const pod = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 10; c.height = 10; return c.toDataURL('image/png'); }); await p.evaluate(([id, pod]) => TruckNav.freight.podSheet(TruckNav.cloudLoads.find(l => l.id === id), 2), [L.id, pod]);
    await p.setInputFiles('#fxPodPhoto', { name: 'pod.jpg', mimeType: 'image/jpeg', buffer: img }); await p.fill('#fxPodName', 'K. Osei'); await p.fill('#fxPodPcs', '8');
    const b = await p.$eval('#fxPodSig', c => { const r = c.getBoundingClientRect(); return [r.x, r.y]; }); await p.mouse.move(b[0] + 30, b[1] + 40); await p.mouse.down(); for (let k = 0; k < 15; k++) await p.mouse.move(b[0] + 30 + k * 15, b[1] + 50 + (k % 3) * 10); await p.mouse.up(); await p.click('#fxPodGo'); }
  await p.waitForSelector(C + ` [data-farr="${i + 1}"]`, { timeout: 15000 }); }
ok((await X.from('loads').select('status').eq('id', L.id).single()).data.status === 'in_transit', 'still in transit with one drop left');
await p.click(C + ' [data-farr="3"]'); await p.waitForSelector(C + ' [data-fpod="3"]'); await p.click(C + ' [data-fpod="3"]'); await p.setInputFiles('#fxPodPhoto', { name: 'pod.jpg', mimeType: 'image/jpeg', buffer: img }); await p.fill('#fxPodName', 'Dock 4'); await p.fill('#fxPodPcs', '20');
{ const b = await p.$eval('#fxPodSig', c => { const r = c.getBoundingClientRect(); return [r.x, r.y]; }); await p.mouse.move(b[0] + 30, b[1] + 40); await p.mouse.down(); for (let k = 0; k < 15; k++) await p.mouse.move(b[0] + 30 + k * 15, b[1] + 50 + (k % 3) * 10); await p.mouse.up(); }
await p.click('#fxPodGo'); await p.waitForFunction(id => /Delivered/.test(document.querySelector(`[data-cload="${id}"] [data-stage]`)?.textContent || ''), L.id, { timeout: 15000 });
const { data: Lf } = await X.from('loads').select('*').eq('id', L.id).single(); ok(Lf.status === 'delivered' && Lf.stops.every(s => s.arrived_at && s.departed_at) && Lf.stops[1].pod.damage === '1 case crushed', 'delivered with arrive/depart timestamps on every stop and POD (with damage) recorded');
await p.screenshot({ path: SH + '/390-load-delivered.png' });
// ---- dispatcher board shows it all
await d.evaluate(() => RRB.refresh()); await d.waitForTimeout(1000); const B = `[data-bload="${L.id}"]`;
ok((await d.$$(B + ' [data-barr]')).length === 4, 'board shows arrival times for all stops'); ok(await d.$(B + ' [data-btemp].late') != null, 'board flags the out-of-range reefer temp');
ok((await d.$$(B + ' [data-bdoc="pod"]')).length === 3 && (await d.$$(B + ' [data-bdoc="pod"] img.sig')).length === 3, 'board shows 3 PODs with signatures');
ok(await d.$(B + ' [data-bdoc="lumper"]') != null && await d.$(B + ' [data-bdoc="bol"]') != null, 'board shows BOL + lumper docs'); ok(/At the gate/.test(await d.textContent(B + ' .b-msgs')), 'board shows the driver message');
ok(/detention \d+m \$\d/.test(await d.textContent(B + ' [data-bstop="0"]')), 'board shows billed detention at pickup');
await d.fill(B + ' [data-bmi]', 'Thanks, nice work'); await d.click(B + ' [data-bms]'); await d.waitForSelector(B + ' [data-bmsg].me'); ok(true, 'dispatcher replies from the board');
await d.screenshot({ path: SH + '/dispatch-board.png', fullPage: true });
// cleanup
await X.from('loads').delete().in('id', [L.id, L2.id]); await X.from('address_book').delete().like('name', '%' + REF);
await browser.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

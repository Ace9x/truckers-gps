// Multi-stop planner e2e. BASE=https://ace9x.github.io/truckers-gps/ node test/planner-e2e.mjs
import { chromium, devices } from 'playwright'; import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = process.env.BASE || 'https://ace9x.github.io/truckers-gps/', SHOTS = process.env.SHOTS || '/workspace/truckers-gps-shots/planner'; mkdirSync(SHOTS, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8128, longitude: -73.8803 }, permissions: ['geolocation'] });
const page = await ctx.newPage(); page.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; }); page.on('dialog', d => d.accept('closed gate'));
const T = (f, a) => page.evaluate(f, a), shot = n => page.screenshot({ path: `${SHOTS}/${n}.png` });
await page.goto(BASE); await page.waitForFunction(() => window.TruckNav?.planner?.ready && TruckNav.pos, null, { timeout: 40000 });
await T(() => { localStorage.removeItem('rr_plan'); TruckNav.planner.plan.stops = []; });
await page.click('#plannerBtn'); await page.waitForTimeout(300);
// 6 via CSV (with windows/priority/packages) + 2 via pasted list = 8 NYC-area stops, all geocoded live
const csv = `Name,Address,Window Start,Window End,Priority,Service Min,Packages,Notes
Jacobi Medical Center,1400 Pelham Pkwy S Bronx NY,,,normal,10,3,Receiving dock
Yankee Stadium,1 E 161st St Bronx NY,,,low,5,2,
Port Newark,Port Newark Container Terminal Newark NJ,,,normal,20,1,
Barclays Center,620 Atlantic Ave Brooklyn NY,,,normal,10,5,Gate B
JFK Cargo,JFK International Airport Queens NY,,,high,15,4,Bldg 151
Flushing Meadows,Flushing Meadows Corona Park Queens NY,,,normal,5,1,`;
await T(c => { document.querySelector('#plImport').open = true; document.querySelector('#plPaste').value = c; }, csv); await shot('01-import-csv');
await T(() => document.querySelector('#plPasteGo').click()); await page.waitForFunction(() => /Added \d+ stops/.test(document.querySelector('#toast').textContent), null, { timeout: 90000 }); console.log('  ' + await T(() => document.querySelector('#toast').textContent));
await T(() => TruckNav.planner.addMany([{ address: 'Hudson Yards New York NY' }, { address: 'Staten Island Mall' }]));
const n = await T(() => TruckNav.planner.plan.stops.length); ok(n === 8, `8 NYC-area stops imported & geocoded (CSV + pasted list): ${n}`);
// time window on Barclays (must be early) via edit
await T(() => { const s = TruckNav.planner.plan.stops.find(s => /Barclays/.test(s.name)); const d = new Date(); const now = d.getHours() * 3600 + d.getMinutes() * 60; s.tw = [null, 8 * 3600 + 90 * 60]; TruckNav.planner.render(); });
await T(() => { document.querySelector('#plImport').open = false; }); await shot('02-stops-entered');
const r = await T(async () => { document.querySelector('#plStart').value = '08:00'; const r = await TruckNav.planner.optimize(); return { src: r.src, before: r.before.dist, after: r.dist, late: r.lateCount, order: TruckNav.planner.plan.stops.map(s => s.name), sum: document.querySelector('#plSum').innerText }; });
ok(/Valhalla truck/.test(r.src), 'travel times from Valhalla truck matrix: ' + r.src);
ok(r.after < r.before, `optimized shorter than entered order: ${(r.before / 1609).toFixed(1)} → ${(r.after / 1609).toFixed(1)} mi`);
ok(r.late === 0 && r.order.indexOf(r.order.find(x => /Barclays/.test(x))) <= 2, `Barclays 9:30 window respected (position ${r.order.findIndex(x => /Barclays/.test(x)) + 1}), late stops: ${r.late}`);
console.log('  order:', r.order.join(' → ')); console.log('  ' + r.sum.replace(/\n/g, ' | '));
const etas = await T(() => [...document.querySelectorAll('#plList li small')].filter(x => /ETA/.test(x.textContent)).length); ok(etas === 8, `ETA shown per stop (${etas})`);
await T(() => document.querySelector('#plList').scrollIntoView()); await shot('03-optimized'); await T(() => TruckNav.map.resize()); 
// lock first + reorder via move, then save + share link
await T(() => { TruckNav.planner.move(7, 0); }); const firstAfterMove = await T(() => TruckNav.planner.plan.stops[0].name);
const lk = await T(async () => { document.querySelector('#plLF').checked = true; document.querySelector('#plLF').dispatchEvent(new Event('change')); const r = await TruckNav.planner.optimize(); return TruckNav.planner.plan.stops[0].name; });
ok(lk === firstAfterMove, `drag-reorder + "Lock first" keeps ${lk} first after re-optimize`);
await T(() => { document.querySelector('#plLF').checked = false; document.querySelector('#plLF').dispatchEvent(new Event('change')); return TruckNav.planner.optimize(); });
await T(() => { document.querySelector('#plName').value = 'NYC test run'; document.querySelector('#plName').dispatchEvent(new Event('change')); document.querySelector('#plSave').click(); });
const url = await T(() => TruckNav.planner.shareURL()); ok(/#plan=/.test(url) && (await T(() => TruckNav.planner.saved.length)) > 0, `route saved + share link (${url.length} chars)`);
// open share link in a second "friend" phone
const ctx2 = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.7, longitude: -73.9 }, permissions: ['geolocation'] }); const p2 = await ctx2.newPage(); await p2.goto(url);
await p2.waitForFunction(() => TruckNav?.planner?.plan?.stops?.length === 8, null, { timeout: 40000 }).then(() => ok(true, 'share link opens same 8-stop route on another phone')).catch(() => ok(false, 'share link import'));
await p2.waitForTimeout(1200); await p2.screenshot({ path: `${SHOTS}/04-shared-on-friend-phone.png` }); await ctx2.close();
// navigate stop by stop
await T(() => document.querySelector('#plGo').click()); await page.waitForFunction(() => TruckNav.nav && TruckNav.route, null, { timeout: 60000 });
ok(await T(() => /Stop 1/.test(document.querySelector('#plBarT').textContent)), 'Start route → turn-by-turn to stop 1, stop bar shown'); await page.waitForTimeout(1500); await shot('05-navigating-stop1');
const fix = s => T(s => TruckNav.onFix({ lat: s.lat, lon: s.lon, speed: 0, acc: 5, t: Date.now() }), s);
for (let k = 0; k < 3; k++) { const s = await T(() => { const P = TruckNav.planner; return P.plan.stops[P.cur]; }); await fix(s); await page.waitForFunction(() => TruckNav.planner.arrived, null, { timeout: 8000 }).catch(() => {});
  ok(await T(() => TruckNav.planner.arrived), `auto-arrive detected at stop ${k + 1} (${s.name})`);
  if (k === 0) { await T(() => document.querySelector('#plBar [data-a=done]').click()); await page.waitForTimeout(300);
    const box = await page.locator('#podSig').boundingBox(); await page.mouse.move(box.x + 20, box.y + 70); await page.mouse.down(); for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 20 + i * 20, box.y + 70 + (i % 2 ? -30 : 30)); await page.mouse.up();
    await page.setInputFiles('#podPhoto', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await T(() => { document.querySelector('#podName').value = 'J. Smith'; document.querySelector('#podNote').value = 'Left at receiving dock 2'; }); await page.waitForTimeout(500); await shot('06-proof-of-delivery');
    await T(() => document.querySelector('#podSave').click()); await page.waitForTimeout(800);
    const pod = await T(async () => { const s = TruckNav.planner.plan.stops.find(x => x.pod); const r = await TruckNav.planner.podGet(s.pod); return { sig: !!r.signature, photo: !!r.photo, note: r.note, by: r.receivedBy }; });
    ok(pod.sig && pod.photo && pod.note && pod.by, `proof of delivery stored on device (IndexedDB): signature ${pod.sig}, photo ${pod.photo}, note "${pod.note}"`); }
  else if (k === 1) { await T(() => document.querySelector('#plBar [data-a=fail]').click()); await page.waitForTimeout(500); }
  else { await T(() => document.querySelector('#plBar [data-a=done]').click()); await page.waitForTimeout(200); await T(() => document.querySelector('#podSave').click()); await page.waitForTimeout(500); } }
const st = await T(() => TruckNav.planner.plan.stops.map(s => s.status)); ok(st.filter(x => x === 'done').length === 2 && st.includes('failed'), 'statuses after 3 stops: ' + st.join(','));
await page.waitForFunction(() => TruckNav.nav, null, { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1000); await shot('07-next-stop-after-complete');
// skip mid-route → re-optimize remaining
const before = await T(() => TruckNav.planner.plan.stops[TruckNav.planner.cur].name); await T(() => document.querySelector('#plBar [data-a=skip]').click());
await page.waitForFunction(b => TruckNav.planner.plan.stops[TruckNav.planner.cur]?.name !== b, before, { timeout: 60000 }).catch(() => {});
const after = await T(() => ({ cur: TruckNav.planner.plan.stops[TruckNav.planner.cur].name, pend: TruckNav.planner.plan.stops.filter(s => s.status === 'pending').length }));
ok(after.cur !== before && after.pend === 5, `skip "${before}" → re-optimized remaining ${after.pend}, now heading to ${after.cur}`);
// finish remaining stops
for (let k = 0; k < 5; k++) { await page.waitForFunction(() => TruckNav.planner.cur >= 0, null, { timeout: 5000 }); const s = await T(() => TruckNav.planner.plan.stops[TruckNav.planner.cur]); await fix(s); await page.waitForTimeout(2300);
  await T(() => { TruckNav.planner.arrive(); document.querySelector('#plBar [data-a=done]').click(); }); await page.waitForTimeout(150); await T(() => document.querySelector('#podSave').click()); await page.waitForTimeout(900); }
const sm = await T(() => ({ s: TruckNav.planner.summary, txt: document.querySelector('#plSum').innerText }));
ok(sm.s && sm.s.done === 7 && sm.s.failed === 1 && sm.s.total === 8, `route summary: ${JSON.stringify(sm.s)} — ${sm.txt.split('\n')[0]}`); await shot('08-route-complete-summary');
// dispatcher multi-stop load → planner
await T(() => window.dispatchEvent(new CustomEvent('rr:load', { detail: { id: 'L1', ref: 'Load #4471', stops: [{ type: 'pickup', name: 'Hunts Point Market', lat: 40.8098, lon: -73.8768, appt: '07:00' }, { type: 'drop', name: 'Newark DC', lat: 40.7357, lon: -74.1724, window: ['10:00', '12:00'] }, { type: 'drop', name: 'Edison DC', lat: 40.5187, lon: -74.4121 }] } })));
const ld = await T(() => ({ n: TruckNav.planner.plan.stops.length, name: TruckNav.planner.plan.name, lf: TruckNav.planner.plan.opts.lockFirst, vis: !document.querySelector('#plannerPanel').classList.contains('hidden') }));
ok(ld.n === 3 && ld.name === 'Load #4471' && ld.lf && ld.vis, 'dispatcher multi-stop load opens in planner with pickup locked first'); await shot('09-dispatch-load-in-planner');
await browser.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);

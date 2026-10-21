// Offline + Drive mode end-to-end. BASE=https://ace9x.github.io/truckers-gps/ node test/offline-e2e.mjs
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://ace9x.github.io/truckers-gps/', SHOTS = process.env.SHOTS || '/workspace/truckers-gps-shots/offline';
mkdirSync(SHOTS, { recursive: true });
const HP = { latitude: 40.8128, longitude: -73.8803 }, NJ = { lat: 40.6879, lon: -74.1580, name: 'Port Newark warehouse district, NJ' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream'] });
const mk = async geo => { const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: geo, permissions: ['geolocation'], serviceWorkers: 'allow' });
  const page = await ctx.newPage(); page.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; }); return { ctx, page }; };
const A = await mk(HP), page = A.page, T = (f, a) => page.evaluate(f, a), shot = n => page.screenshot({ path: `${SHOTS}/${n}.png` });
const ready = async p => { await p.waitForFunction(() => window.TruckNav?.ready && TruckNav.offlineReady, null, { timeout: 30000 }); };
await page.goto(BASE); await ready(page);
await T(async () => { await navigator.serviceWorker.ready; }); await page.reload(); await ready(page); // page now controlled by the service worker
ok(await T(() => !!navigator.serviceWorker.controller), 'service worker controls the page (offline app shell + tile cache)');
await page.waitForFunction(() => TruckNav.pos, null, { timeout: 15000 });
await T(d => TruckNav.setDest(d), NJ);
await page.waitForFunction(() => TruckNav.route && !document.querySelector('#goBtn').disabled, null, { timeout: 60000 });
const R = await T(() => ({ steps: TruckNav.route.maneuvers.length, mi: TruckNav.route.length / 1609 }));
ok(R.steps > 5, `truck route planned online: ${R.steps} maneuvers, ${R.mi.toFixed(1)} mi`);
// region download panel estimate
await T(() => document.querySelector('#regionBtn').click()); await page.waitForTimeout(500);
const est = await T(() => document.querySelector('#rgEst').textContent + ' | ' + document.querySelector('#rgRoute').textContent);
ok(/tiles ≈ [\d.]+ MB/.test(est), 'download-region option with size estimate: ' + est); await shot('01-offline-maps-panel');
const dl = await T(() => TruckNav.downloadRoute()); ok(dl.done > 300 && dl.done >= dl.total * 0.95, `route corridor saved at zoom 6–14: ${dl.done}/${dl.total} tiles`);
await T(() => document.querySelector('#regionPanel .close').click());
await page.waitForFunction(() => TruckNav.tripSaved, null, { timeout: 30000 }).catch(() => {});
// start navigation + simulated GPS at highway speed
await T(() => { TruckNav.startNav(); });
const drive = (from, to, step = 60, spd = 20) => T(async ([from, to, step, spd]) => { const r = TruckNav.route; let t = Date.now();
  for (let d = from; d <= to; d += step) { let i = r.cum.findIndex(c => c > d); if (i < 1) i = r.cum.length - 1; const a = r.line[i - 1], b = r.line[i], k = (d - r.cum[i - 1]) / Math.max(.01, r.cum[i] - r.cum[i - 1]);
    t += 3000; TruckNav.onFix({ lon: a[0] + (b[0] - a[0]) * k, lat: a[1] + (b[1] - a[1]) * k, speed: spd, acc: 5, t }); await new Promise(res => setTimeout(res, 15)); } }, [from, to, step, spd]);
await drive(0, 600); await page.waitForTimeout(1500);
const dm = await T(() => ({ on: TruckNav.drive, vis: !document.querySelector('#drive').classList.contains('hidden'), btns: [...document.querySelectorAll('#dBtns button')].map(b => b.textContent.trim()), h: document.querySelector('#dBtns button').getBoundingClientRect().height, turn: document.querySelector('#dDist').textContent + ' ' + document.querySelector('#dStreet').textContent, spd: document.querySelector('#dSpd').textContent }));
ok(dm.on && dm.vis, `drive mode auto-entered above 10 mph (showing ${dm.spd} mph, next turn "${dm.turn}")`);
ok(dm.btns.length === 4 && dm.h >= 80, `4 giant buttons (${dm.btns.join(' / ')}), ${Math.round(dm.h)} px tall`);
await shot('02-drive-mode');
const kb = await T(() => { const i = document.querySelector('#q'); i.focus(); return document.activeElement === i; }); ok(!kb, 'keyboard blocked while moving in drive mode');
// voice commands
const vc = await T(() => { const n = TruckNav.spokenLog.length; TruckNav.runCommand('how long left'); TruckNav.runCommand('where is the next fuel'); return TruckNav.spokenLog.slice(n); });
ok(vc.length === 2 && /left/.test(vc[0]) && /fuel|truck stop/i.test(vc[1]), `voice commands answered: "${vc[0]}" / "${vc[1]}"`);
const mu = await T(() => { TruckNav.runCommand('mute'); const m = !TruckNav.voiceObj.enabled; TruckNav.runCommand('unmute'); return m && TruckNav.voiceObj.enabled; }); ok(mu, 'voice commands "mute" / "unmute"');

// ===== GO OFFLINE mid-navigation =====
let netCalls = 0; A.ctx.on('request', r => { if (/valhalla|overpass|photon/.test(r.url())) netCalls++; });
await A.ctx.setOffline(true); await page.waitForTimeout(800);
const pill = await T(() => ({ on: navigator.onLine, t: document.querySelector('#netPill').textContent }));
ok(!pill.on && /OFFLINE/.test(pill.t), `offline indicator: "${pill.t}"`);
const s0 = await T(() => ({ step: TruckNav.step, along: TruckNav.along, instr: document.querySelector('#bInstr').textContent }));
const target = await T(() => { const r = TruckNav.route, i = TruckNav.step; return r.cum[Math.min(r.maneuvers[Math.min(i + 2, r.maneuvers.length - 1)].begin_shape_index, r.cum.length - 1)] + 50; });
await drive(s0.along + 60, target, 80); await page.waitForTimeout(800);
const s1 = await T(() => ({ step: TruckNav.step, along: TruckNav.along, instr: document.querySelector('#bInstr').textContent, nav: TruckNav.nav, said: TruckNav.spokenLog.slice(-4) }));
ok(s1.nav && s1.step > s0.step && s1.along > s0.along, `offline turn-by-turn continues with GPS only: step ${s0.step}→${s1.step}, ${(s0.along / 1609).toFixed(2)}→${(s1.along / 1609).toFixed(2)} mi, now "${s1.instr}"`);
ok(s1.said.some(t => /turn|keep|take|continue|merge|exit|bear|head/i.test(t)), 'voice prompts still spoken offline: ' + s1.said.at(-1));
// map tiles render from cache
await T(() => { const p = TruckNav.pos; TruckNav.map.jumpTo({ center: [p.lon, p.lat], zoom: 14 }); });
await page.waitForFunction(() => TruckNav.map.loaded() && TruckNav.map.areTilesLoaded(), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const tiles = await T(() => ({ feats: TruckNav.map.queryRenderedFeatures().filter(f => f.source === 'openmaptiles').length, roads: TruckNav.map.queryRenderedFeatures().filter(f => /road|transportation/.test(f.sourceLayer || '')).length }));
ok(tiles.feats > 50 && tiles.roads > 5, `map tiles render from cache offline: ${tiles.feats} map features (${tiles.roads} road features) at zoom 14`);
await shot('03-offline-driving');
// off-route offline: guidance, no reroute call
await T(() => TruckNav.setDrive(false));
await T(async () => { const p = TruckNav.pos; for (let k = 1; k <= 4; k++) { TruckNav.onFix({ lon: p.lon + 0.004 * k / 4 + 0.003, lat: p.lat + 0.003, speed: 12, acc: 5, t: Date.now() + 60e3 + k * 2000 }); await new Promise(r => setTimeout(r, 50)); } });
await page.waitForTimeout(600);
const og = await T(() => ({ vis: !document.querySelector('#offGuide').classList.contains('hidden'), txt: document.querySelector('#offGuide').textContent, pend: TruckNav.pendingReroute, rer: TruckNav.rerouting }));
ok(og.vis && og.pend && !og.rer, `offline off-route: "${og.txt.replace(/\s+/g, ' ').trim()}" (reroute queued)`);
ok(netCalls === 0, `no routing/network calls attempted while offline (${netCalls})`);
await shot('04-offline-off-route');
// file a report offline
await T(() => TruckNav.setDrive(true)); await page.click('#dReport'); await page.waitForTimeout(300); await shot('05-drive-report-grid');
const rid = await T(async () => { const before = TruckNav.reports.length; document.querySelector('[data-dr]').click(); await new Promise(r => setTimeout(r, 800)); const r = TruckNav.reports.at(-1); return { id: r.id, t: r.t, type: r.type, lat: r.lat, lon: r.lon, n: TruckNav.reports.length - before, q: await TruckNav.outbox.size(), pill: document.querySelector('#netPill').textContent }; });
ok(rid.n === 1 && rid.q >= 1 && /waiting/.test(rid.pill), `report filed offline queued in IndexedDB outbox (${rid.type}; pill "${rid.pill}")`);
await shot('06-offline-report-queued');
// reload with no signal: app shell + saved trip + outbox survive
await page.reload(); await ready(page);
const rl = await T(async () => ({ route: !!TruckNav.route, steps: TruckNav.route?.maneuvers.length, q: await TruckNav.outbox.size(), dangers: (TruckNav.dangers || []).length }));
ok(rl.route && rl.steps === R.steps && rl.q >= 1, `app reopens with no signal: route (${rl.steps} maneuvers) and ${rl.q} queued report restored from the phone`);
await page.waitForTimeout(2500); await shot('07-offline-reload');

// ===== another driver nearby, online =====
const B = await mk({ latitude: rid.lat, longitude: rid.lon }); await B.page.goto(BASE); await ready(B.page);
const hasLive = await B.page.evaluate(() => TruckNav.backend?.name); console.log('INFO backend:', hasLive);
const seenBefore = await B.page.evaluate(id => TruckNav.reports.some(r => r.id === id), rid.id); ok(!seenBefore, 'other driver does not see the report while reporter is offline');
// back online
await A.ctx.setOffline(false); await page.waitForTimeout(500);
await page.waitForFunction(() => TruckNav.lastFlush && TruckNav.outboxSize === 0, null, { timeout: 30000 }).catch(() => {});
const fl = await T(() => ({ f: TruckNav.lastFlush, n: TruckNav.outboxSize, pill: document.querySelector('#netPill').textContent }));
ok(fl.f?.sent >= 1 && fl.n === 0, `back online: outbox synced (${JSON.stringify(fl.f)}), pill "${fl.pill}"`);
const seen = await B.page.waitForFunction(id => TruckNav.reports.find(r => r.id === id), rid.id, { timeout: 45000 }).then(h => h.jsonValue()).catch(() => null);
ok(seen && seen.t === rid.t, seen ? `report made offline appears for another nearby driver with original timestamp (${new Date(seen.t).toISOString()})` : 'report made offline did NOT reach the other driver (backend: ' + hasLive + ')');
await B.page.waitForTimeout(1500); await B.page.screenshot({ path: `${SHOTS}/08-other-driver-sees-report.png` });
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); await browser.close(); process.exit(fails ? 1 : 0);

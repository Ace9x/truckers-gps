// End-to-end: real browser + real routing server + simulated GPS. BASE=url node test/e2e.mjs
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/', SHOTS = process.env.SHOTS || '/workspace/truckers-gps-shots';
mkdirSync(SHOTS, { recursive: true });
const HUNTS_POINT = { latitude: 40.8128, longitude: -73.8803 }, NJ = { lat: 40.6879, lon: -74.1580, name: 'Port Newark warehouse district, NJ' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: HUNTS_POINT, permissions: ['geolocation'] });
const page = await ctx.newPage(); page.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; }); page.on('console', m => { if (/Refused to|Content Security Policy/.test(m.text())) { console.log('CSP VIOLATION', m.text().slice(0, 200)); fails++; } });
const T = (f, a) => page.evaluate(f, a); const shot = n => page.screenshot({ path: `${SHOTS}/${n}.png` });
const closeP = () => page.click('.panel:not(.hidden) .close').catch(() => {});
await page.goto(BASE); await page.waitForFunction(() => window.TruckNav?.ready); await page.waitForFunction(() => TruckNav.pos, null, { timeout: 15000 });
ok(true, 'app loaded, browser Geolocation fix received'); await page.waitForTimeout(2500); await shot('01-home');

await page.click('#searchBtn'); await page.fill('#q', 'Port Newark'); await page.waitForSelector('#results li small', { timeout: 15000 });
ok(await page.locator('#results li').count() > 0, 'address search returns results'); await shot('02-search'); await closeP();

// Route + alternatives
await T(d => TruckNav.setDest(d), NJ);
await page.waitForFunction(() => TruckNav.route && !document.querySelector('#goBtn').disabled, null, { timeout: 40000 });
const r = await T(() => ({ n: TruckNav.route.line.length, steps: TruckNav.route.maneuvers.length, len: TruckNav.route.length, car: TruckNav.carRoute?.length, alts: TruckNav.routes.length, cards: document.querySelectorAll('.alt').length, why: document.querySelector('.alt .why')?.textContent }));
ok(r.n > 50 && r.steps > 5, `truck route drawn: ${r.steps} steps, ${(r.len / 1609).toFixed(1)} mi (car ${(r.car / 1609).toFixed(1)} mi)`);
ok(r.alts >= 1 && r.cards === r.alts && r.why, `${r.alts} route option(s) with "why": ${r.why}`);
if (r.alts > 1) { await page.click('.alt[data-i="1"]'); ok(await T(() => TruckNav.sel === 1 && TruckNav.chosen === TruckNav.routes[1]), 'driver can pick route 2 (locked as chosen)'); await page.click('.alt[data-i="0"]'); }
await page.check('#cmpCar'); await page.waitForTimeout(1500); await shot('03-route-options');

// Stops ahead (built-in extract + live)
await T(() => { TruckNav.loadPois(); }); await page.waitForFunction(() => TruckNav.pois.length > 0 || TruckNav.poiDone, null, { timeout: 20000 });
let poi = await T(() => ({ n: TruckNav.pois.length, st: TruckNav.poiStatic, markers: document.querySelectorAll('.poi-marker').length, list: document.querySelectorAll('.poi').length, kinds: [...new Set(TruckNav.pois.map(p => p.kind))], det: document.querySelector('.poi .muted')?.textContent }));
ok(poi.n > 0 && poi.markers > 0 && poi.list > 0, `truck stops render along Hunts Point→Port Newark: ${poi.n} (${poi.kinds.join(', ')}), built-in extract ${poi.st}, e.g. "${poi.det}"`);
await page.waitForFunction(() => TruckNav.poiDone, null, { timeout: 120000 }).catch(() => {});
const fuel = await T(() => { const d = TruckNav.pois.filter(p => p.kind === 'fuel' || p.kind === 'stop').length; document.querySelector('[data-pf=diesel]').click(); const shown = document.querySelectorAll('.poi').length; document.querySelector('[data-pf=all]').click(); return { d, shown, layer: TruckNav.fuelGeo?.features.length }; });
ok(fuel.layer > 500 && fuel.d > 0 && fuel.shown > 0, `diesel/fuel: ${fuel.layer} stations on map layer, ${fuel.d} along route, diesel filter shows ${fuel.shown}`);
poi = await T(() => ({ n: TruckNav.pois.length, live: TruckNav.poiLive, note: document.querySelector('#poiList .muted')?.textContent }));
console.log(`INFO after live Overpass pass: ${poi.n} stops; ${poi.note}`);
await T(() => { const b = new maplibregl.LngLatBounds(); TruckNav.pois.forEach(p => b.extend([p.lon, p.lat])); TruckNav.map.fitBounds(b, { padding: { top: 60, bottom: 460, left: 30, right: 30 }, duration: 0 }); });
await page.waitForTimeout(2500); await shot('07-truck-stops');

// Navigate with simulated GPS
await T(() => TruckNav.startNav()); const steps = [];
for (let k = 0; k < 40; k++) { await T(([k]) => { const L = TruckNav.route.line, i = Math.min(L.length - 1, Math.floor(k / 40 * L.length * 0.5)); TruckNav.onFix({ lon: L[i][0], lat: L[i][1], speed: 26, heading: null, acc: 5, t: Date.now() + k * 1000 }); }, [k]); steps.push(await T(() => TruckNav.step)); }
const uniq = [...new Set(steps)];
ok(uniq.length >= 3 && steps.every((s, i) => !i || s >= steps[i - 1]), `turn-by-turn steps advance in order: ${uniq.join('→')}`);
ok(await T(() => TruckNav.rerouteCount === 0), 'no false reroute while on route');
const log = await T(() => TruckNav.spokenLog.slice());
ok(log.some(t => /^In (two miles|one mile|a quarter mile)/.test(t)), 'highway exit prompts at 2 mi / 1 mi / ¼ mi: ' + JSON.stringify(log.filter(t => /^In /.test(t)).slice(0, 3)));
ok(!log.some(t => /Interstate \d \d/.test(t) || /\bI \d/.test(t)), 'voice text normalized (no "I 278"/"Interstate 2 78")');
ok(/\d/.test(await page.textContent('#tEta')), 'ETA / distance remaining shown'); await page.waitForTimeout(1200); await shot('04-navigating');

// Accuracy gate: fuzzy far-away fixes must NOT reroute
const fuzzy = await T(() => { const p = TruckNav.pos; for (let k = 0; k < 5; k++) TruckNav.onFix({ lon: p.lon + 0.01, lat: p.lat, speed: 20, heading: 90, acc: 120, t: Date.now() + 50000 + k * 1000 }); return TruckNav.rerouteCount; });
ok(fuzzy === 0, 'poor-accuracy GPS fixes (120 m) do not trigger reroute');
await T(() => { const L = TruckNav.route.line, i = Math.floor(L.length * 0.5); TruckNav.onFix({ lon: L[i][0], lat: L[i][1], speed: 26, acc: 5, t: Date.now() + 56000 }); });

// Off-route -> reroute that rejoins the chosen route
const before = await T(() => TruckNav.route.line[0].join());
const offPos = await T(() => [TruckNav.pos.lon + 0.008, TruckNav.pos.lat + 0.006]);
for (let k = 0; k < 4; k++) await T(([p, k]) => TruckNav.onFix({ lon: p[0] + k * 0.0002, lat: p[1], speed: 15, heading: 90, acc: 8, t: Date.now() + 60000 + k * 1000 }), [offPos, k]);
await page.waitForFunction(b => TruckNav.rerouteCount >= 1 && !TruckNav.rerouting && TruckNav.route.line[0].join() !== b, before, { timeout: 40000 });
const rr = await T(() => { const s = TruckNav.route.line[0], p = TruckNav.pos; const ch = TruckNav.chosen; const end = TruckNav.route.line.slice(-200);
  // share of the new route's 2nd half that lies on the chosen route
  const half = TruckNav.route.line.slice(Math.floor(TruckNav.route.line.length / 2)); let on = 0; for (const q of half) { let best = 1e9; for (let i = 0; i < ch.line.length; i += 3) best = Math.min(best, Math.hypot((ch.line[i][0] - q[0]) * 84000, (ch.line[i][1] - q[1]) * 111000)); if (best < 150) on++; }
  return { start: Math.hypot((s[0] - p.lon) * 84000, (s[1] - p.lat) * 111000), vias: TruckNav.lastRerouteVias, share: on / half.length }; });
ok(rr.start < 400 && rr.vias > 0 && rr.share > 0.9, `auto-reroute keeps driver's chosen route: starts ${Math.round(rr.start)} m from truck, ${rr.vias} rejoin points, ${Math.round(rr.share * 100)}% of remaining route on chosen corridor`);
await shot('05-rerouted');

// Weigh-station alerts (test-only synthetic station placed on route ahead)
const wa = await T(() => { const L = TruckNav.route, a = TruckNav.along; TruckNav.pois.push({ id: 'test-weigh', kind: 'weigh', name: 'Weigh station', lon: 0, lat: 0, along: a + 2.2 * 1609, off: 20, tags: {} });
  const fire = d => { const i = L.cum.findIndex(c => c >= a + d); TruckNav.onFix({ lon: L.line[i][0], lat: L.line[i][1], speed: 26, acc: 5, t: Date.now() + 90000 + d }); };
  fire(0.3 * 1609); fire(1.25 * 1609); TruckNav.pois = TruckNav.pois.filter(p => p.id !== 'test-weigh'); return TruckNav.spokenLog.filter(t => /Weigh station in/.test(t)); });
ok(wa.length === 2 && /two miles/.test(wa[0]) && /one mile/.test(wa[1]), 'weigh-station alerts at 2 mi and 1 mi: ' + JSON.stringify(wa));

// Mascot + garage
const mz = await T(() => ({ log: TruckNav.mascot.log.map(x => x.text), busyHidden: (() => { TruckNav.nav = true; TruckNav.toNext = 200; TruckNav.mascot.say('test tip'); const v = TruckNav.mascot.visible; TruckNav.toNext = 1e9; TruckNav.nav = false; return !v; })() }));
ok(mz.log.some(t => /new route|Whoops/i.test(t)) && mz.log.some(t => /Weigh station/i.test(t)) && mz.busyHidden, 'mascot Ace reacts to reroute + weigh station, stays out of the way near turns');
ok(await T(() => /Show Ace/.test(document.querySelector('label:has(#mascotOn)').textContent) && !/Coney/.test(document.body.innerHTML)), 'mascot is named Ace in settings, no Coney left');
// Resume after crash/reload
await page.reload(); await page.waitForFunction(() => window.TruckNav?.ready); await page.waitForTimeout(800);
ok(await T(() => TruckNav.resumed && TruckNav.nav && !!TruckNav.route), 'navigation resumes automatically after reload/crash');
await T(() => TruckNav.endNav());

// Low-power GPS when parked
const gm = await T(() => { const p = TruckNav.pos, t0 = Date.now(); const a = []; TruckNav.powerManage({ ...p, speed: 0, t: t0 }); TruckNav.powerManage({ ...p, speed: 0, t: t0 + 4 * 60e3 }); a.push(TruckNav.gpsMode); TruckNav.powerManage({ ...p, speed: 12, t: t0 + 5 * 60e3 }); a.push(TruckNav.gpsMode); return a; });
ok(gm[0] === 'low' && gm[1] === 'high', `GPS drops to low-power after 3 min parked, back to high when moving (${gm.join('→')})`);

// Official closures / work zones (NJ WZDx feed, published server-side)
const cz = await T(() => ({ n: TruckNav.closures?.length, closed: TruckNav.closures?.filter(z => z.closed).length, meta: TruckNav.closureMeta }));
ok(cz.n > 0 && cz.meta?.sources?.[0]?.ok, `official work zones loaded: ${cz.n} active NJ work zones (${cz.closed} full closures avoided in routing), feed ${cz.meta?.generated}`);
// Wrong road: truck on Bronx River Parkway (trucks banned) -> immediate alert
await T(async () => { TruckNav.nav = true; TruckNav.distFromRoute = 500; TruckNav.pos = { lon: -73.872514, lat: 40.857071, speed: 15, heading: 0, acc: 5, t: Date.now() }; window.__wr = 0; await TruckNav.checkWrongRoad(); });
await page.waitForFunction(() => TruckNav.wrongRoad, null, { timeout: 15000 }).catch(() => {});
const wr = await T(() => ({ w: TruckNav.wrongRoad, txt: document.querySelector('#wrongRoad').textContent, vis: !document.querySelector('#wrongRoad').classList.contains('hidden'), said: TruckNav.spokenLog.at(-1) }));
ok(wr.w?.sev === 'stop' && wr.vis && /closed to trucks/.test(wr.said), `wrong-road warning on a truck-banned parkway: "${wr.txt}" / voice "${wr.said}"`);
await shot('16-wrong-road'); await T(() => { TruckNav.nav = false; TruckNav.showWrongRoad(null); });

// Truck restriction vs car: Durham "11foot8" bridge
const dur = await T(async () => { const a = { lat: 36.0008, lon: -78.9083 }, b = { lat: 35.9974, lon: -78.9103 };
  TruckNav.setTruck({ heightFt: 13, heightIn: 6 }); const tall = await TruckNav.valhalla(a, b, 'truck'); TruckNav.setTruck({ heightFt: 8, heightIn: 0 }); const low = await TruckNav.valhalla(a, b, 'truck');
  const car = await TruckNav.valhalla(a, b, 'auto'); const names = x => x.maneuvers.flatMap(m => m.street_names || []); return { tall: tall.length, low: low.length, car: car.length, tn: names(tall), cn: names(car), lowLine: low.line }; });
ok(dur.tall > dur.car * 2 && !dur.tn.includes('North Gregson Street') && dur.cn.includes('North Gregson Street'), `low clearance: 13'6" truck detours ${(dur.tall / 1609).toFixed(2)} mi around the 11'8" bridge; car goes under (${(dur.car / 1609).toFixed(2)} mi)`);

// Report-a-restriction: 8ft truck under the bridge, driver reports "No trucks" on N Gregson -> avoided immediately + persists
const rep = await T(async ([ln]) => { TruckNav.setTruck({ heightFt: 8, heightIn: 0 }); TruckNav.avoids.length = 0; const a = { lat: 36.0008, lon: -78.9083 }, b = { lat: 35.9974, lon: -78.9103 };
  const mid = ln[Math.floor(ln.length * 0.6)]; await TruckNav.report('notrucks', mid); const after = await TruckNav.valhalla(a, b, 'truck'); return { after: after.length, avoids: TruckNav.avoids.length, names: after.maneuvers.flatMap(m => m.street_names || []) }; }, [dur.lowLine]);
ok(rep.avoids === 1 && rep.after > dur.low * 2 && !rep.names.includes('North Gregson Street'), `reported road avoided at once: ${(dur.low / 1609).toFixed(2)} mi → ${(rep.after / 1609).toFixed(2)} mi`);
await page.reload(); await page.waitForFunction(() => window.TruckNav?.ready);
ok(await T(() => TruckNav.avoids.length === 1), 'reported restriction persists after reload');
await T(() => { TruckNav.avoids.length = 0; localStorage.setItem('tn_avoids', '[]'); });
// Look-ahead danger: route planned for an 8' truck under the 11'8" bridge, then driver is actually 13'6" -> announced 2 mi / 0.5 mi with profile comparison + auto reroute
const la = await T(async () => { TruckNav.setTruck({ heightFt: 8, heightIn: 0 }); TruckNav.pos = { lat: 41.2740, lon: -72.6956, t: Date.now() }; TruckNav.dest = { lat: 41.2670, lon: -72.6953, name: 'Guilford CT test' };
  const r = await TruckNav.valhalla(TruckNav.pos, TruckNav.dest, 'truck'); TruckNav.routes = [r]; TruckNav.chosen = r; TruckNav.route = r; TruckNav.setTruck({ heightFt: 13, heightIn: 6 });
  await TruckNav.analyzeRoute(r); return { d: TruckNav.dangers.map(x => x.kind + ':' + x.sev + ':' + x.short), edges: TruckNav.routeEdges }; });
ok(la.d.some(x => /^height:stop/.test(x)), `look-ahead finds Guilford CT's 11'8" Water St rail bridge vs 13'6" truck (${la.edges} road segments checked): ${la.d.join(' | ')}`);
const la2 = await T(async () => { TruckNav.off.reset(); TruckNav.dangerSpoken = {}; TruckNav.nav = true; TruckNav.along = 0; TruckNav.lastReroute = 0; const r = TruckNav.route, d = TruckNav.dangers.find(x => x.kind === 'height'); const before = TruckNav.rerouteCount;
  TruckNav.along = Math.max(0, d.along - 200); const p = r.line[0]; TruckNav.pos = { lon: p[0], lat: p[1], speed: 10, acc: 5, t: Date.now() };
  // call the alert routine via a nav tick on route
  TruckNav.hint = 0; const i0 = Math.max(1, r.cum.findIndex(c => c >= d.along - 250)); TruckNav.onFix({ lon: r.line[i0][0], lat: r.line[i0][1], speed: 10, acc: 5, t: Date.now() + 1000 });
  await new Promise(res => setTimeout(res, 6000)); const out = { said: TruckNav.spokenLog.filter(t => /clearance/i.test(t)), rerouted: TruckNav.rerouteCount > before, len: TruckNav.route.length }; TruckNav.endNav(); return out; });
ok(la2.said.some(t => /Low clearance 11 foot \d+ (just ahead|in a quarter mile|in half a mile)\. Your truck is 13 foot 6\. Rerouting/.test(t)) && la2.rerouted && la2.len > 3000, `danger announced + rerouted around it (${(la2.len / 1609).toFixed(1)} mi): ${JSON.stringify(la2.said[0])}`);
await T(() => { TruckNav.avoids.length = 0; localStorage.setItem('tn_avoids', '[]'); TruckNav.setTruck({ heightFt: 13, heightIn: 6 }); });
// Garage (parked: speed 0, otherwise the >5 mph multi-tap lock correctly hides panels)
await T(() => { TruckNav.pos = { ...TruckNav.pos, speed: 0 }; document.querySelector('#trcDone')?.click(); }); await page.waitForTimeout(600);
await page.click('#meBtn'); await page.evaluate(() => { document.querySelector('#funBox').open = true; }); await page.waitForSelector('#garage button');
const gar = await T(() => { const locked = document.querySelectorAll('#garage button.lock').length; document.querySelector('[data-veh=box]').click(); document.querySelector('[data-col=green]').click(); return { locked, total: document.querySelectorAll('#garage button').length, ride: TruckNav.ride, svg: document.querySelector('.truck-marker svg') ? true : false }; });
ok(gar.total >= 8 && gar.locked > 0 && gar.ride.type === 'box' && gar.ride.color === 'green' && gar.svg, `garage: ${gar.total} vehicles (${gar.locked} locked by level), picked green box truck as map icon`);
await shot('17-garage'); await closeP();
await T(() => { TruckNav.setTruck({ heightFt: 13, heightIn: 6 }); TruckNav.map.jumpTo({ center: [-78.9085, 35.9995], zoom: 16 }); }); await T(() => TruckNav.openPanel('reportPanel')); await page.waitForTimeout(1500); await shot('11-report');
await T(() => { TruckNav.avoids.length = 0; localStorage.setItem('tn_avoids', '[]'); }); await closeP();

// Community report + voting + points
const com = await T(async () => { const p0 = TruckNav.profile.p.points; const other = { id: 'other-1', type: 'hazard', lat: TruckNav.pos.lat + 0.001, lon: TruckNav.pos.lon, t: Date.now(), up: 0, down: 0, mine: false };
  await TruckNav.backend.addReport(other); TruckNav.reports.push(other); await TruckNav.vote(other, 'up'); await TruckNav.report('police', [TruckNav.pos.lon + 0.002, TruckNav.pos.lat]);
  return { up: other.up, pts: TruckNav.profile.p.points - p0, badges: TruckNav.profile.p.badges, markers: document.querySelectorAll('.rpt-marker').length }; });
ok(com.up === 1 && com.pts >= 7 && com.badges.includes('first_report') && com.markers >= 2, `community reports on map with voting; +${com.pts} pts; badges ${com.badges.join(',')}`);

// Account: Me > Account opens the single account panel. With Supabase (email confirmation ON) sign-up must land in a clear
// "check your email" state; the signup call is intercepted so tests never send real email. Device accounts sign in directly.
await page.click('#meBtn'); await page.click('#meSignIn'); await page.waitForSelector('#acctPanel:not(.hidden)');
const sbMode = await T(() => TruckNav.auth?.kind === 'supabase'); const ACC = `driver.${Date.now().toString(36)}@example.com`;
if (sbMode) await page.route('**/auth/v1/signup**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: '', email: ACC, confirmation_sent_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }));
await page.click('#acctPanel [data-t="up"]'); await page.fill('#acName', 'Test Driver'); await page.fill('#acctPanel #acEmail', ACC); await page.fill('#acPass', 'Diesel-test-123'); await page.click('#acGo');
if (sbMode) { await page.waitForSelector('#acctPanel [data-state="check-email"]', { timeout: 20000 }); const ce = await T(() => document.querySelector('#acCheck').textContent);
  ok(ce.includes(ACC) && /Check your email/.test(ce), 'Supabase sign-up with email confirmation shows "check your email" (resend + sign-in buttons)');
  await page.click('#acConfirmed'); ok(await T(a => document.querySelector('#acctPanel #acEmail').value === a && !!document.querySelector('#acPass'), ACC), '"I\'ve confirmed" goes to Sign in with the email filled in');
  await shot('acct-check-email'); await page.unroute('**/auth/v1/signup**'); }
else { await page.waitForFunction(() => !!TruckNav.auth.user, null, { timeout: 60000 }); await closeP(); await page.click('#meBtn'); await page.waitForSelector('#signOut');
  ok(await T(a => TruckNav.auth.user.email === a, ACC), 'device account sign-up signs in; Me shows Sign out'); }
await closeP(); await page.click('#meBtn'); await page.waitForSelector('#vPersona', { state: 'visible' }); // voice settings live in the Me panel
// Voice personalities
await page.selectOption('#vPersona', 'oldschool'); await page.click('#vPreview'); await page.waitForTimeout(300);
const vl = await T(() => TruckNav.spokenLog.at(-1)); ok(/Ten-four\?$/.test(vl) && /Interstate 95 South/.test(vl), 'voice personality + preview: ' + vl);
ok(await page.locator('#vPersona option').count() >= 4, 'voice personalities listed');
await shot('12-profile'); await page.locator('#mePanel').evaluate(e => e.scrollTop = e.scrollHeight); await page.waitForTimeout(300); await shot('13-voice'); await closeP();

// Facility mode: truck entrance pin -> route ends at gate
await T(d => TruckNav.setDest(d), NJ); await page.waitForFunction(() => !document.querySelector('#goBtn').disabled, null, { timeout: 40000 });
const gate = [NJ.lon + 0.004, NJ.lat + 0.002];
await T(async g => { TruckNav.saveFac({ gate: g, notes: 'Gate 3 on Doremus Ave. Check in at guard shack, dock 14.' }); await TruckNav.plan(); }, gate);
const gd = await T(g => { const e = TruckNav.route.line.at(-1); return Math.hypot((e[0] - g[0]) * 84000, (e[1] - g[1]) * 111000); }, gate);
ok(gd < 200, `last-mile: route goes to pinned truck entrance (ends ${Math.round(gd)} m from gate)`);
await T(() => TruckNav.openFac()); await page.waitForTimeout(3500); await shot('14-facility-satellite'); await closeP(); await T(() => TruckNav.map.setLayoutProperty('sat', 'visibility', 'none'));

// RigRoute vision items: driver types, hazmat toggle, HOS 70h cycle, HUD, layer toggles
const rv = await T(async () => { document.querySelector('[data-dt=local]').click(); const local = { ...TruckNav.truck }; document.querySelector('[data-dt=otr]').click();
  document.querySelector('#hazBtn').click(); const haz = TruckNav.truck.hazmat; document.querySelector('#hazBtn').click();
  TruckNav.setHud(true); TruckNav.updateHud(); const hud = !document.querySelector('#hud').classList.contains('hidden') && getComputedStyle(document.querySelector('#hud')).transform !== 'none'; 
  return { local, otr: TruckNav.truck.weightLbs, haz, hud, cyc: document.querySelector('#hCycle').textContent }; });
ok(rv.local.lengthFt === 34 && +rv.local.cycle === 60 && rv.otr === 80000 && rv.haz === true && rv.hud && /\d+:\d\d/.test(rv.cyc), `driver-type presets (Local→26k box/60h, OTR→80k/70h), hazmat toggle, HOS cycle ${rv.cyc} left, mirrored HUD mode`);
await shot('18-hud'); await T(() => TruckNav.setHud(false));
await closeP(); await page.click('#layersBtn'); await page.uncheck('[data-layer=fuelAll]'); const lv = await T(() => TruckNav.map.getLayoutProperty('fuelAll', 'visibility')); await shot('19-layers'); await page.check('[data-layer=fuelAll]'); await closeP();
ok(lv === 'none', 'layer toggles hide/show map layers');

// Offline tiles prefetch
await T(() => TruckNav.prefetchTiles(true)); const ot = await T(() => TruckNav.offlineTiles);
ok(ot && ot.done > 50, `route map saved for offline: ${ot?.done}/${ot?.total} tiles`);

// Demo drive + HOS + load persistence + manifest
await T(() => { TruckNav.pos = { lon: TruckNav.route.line[0][0], lat: TruckNav.route.line[0][1], t: Date.now() }; }); await page.click('#dock button[data-panel=routePanel]'); await page.click('#demoBtn'); await page.waitForTimeout(6000);
ok(await T(() => TruckNav.along > 200 && TruckNav.nav), 'demo drive moves the truck along the route'); await shot('06-demo-drive'); await T(() => TruckNav.endNav());
if (await page.$('#tripReceipt')) { ok(true, 'trip receipt shown after ending trip'); await page.click('#trcDone'); }
await page.click('#dock button[data-panel=hosPanel]'); await page.click('[data-duty=drive]'); ok(await T(() => TruckNav.hos.status === 'drive'), 'HOS clock running'); await shot('08-hos'); await closeP();
await page.click('#dock button[data-panel=truckPanel]'); await page.selectOption('[name=theme]', 'dim'); await page.waitForTimeout(1500); ok(await T(() => document.body.classList.contains('dim')), 'dim night mode'); await shot('09-truck-profile-dim'); await closeP(); await shot('15-dim-map');
await page.click('#dock button[data-panel=loadPanel]'); await page.fill('[name=bol]', 'BOL-TEST'); await page.reload(); await page.waitForFunction(() => window.TruckNav?.ready);
ok(await page.inputValue('[name=bol]') === 'BOL-TEST', 'load details persist');

// ===== v2.3: features competitors paywall, free in RigRoute =====
await page.setViewportSize({ width: 390, height: 844 });
await T(([hp, nj]) => { TruckNav.pos = { lon: hp.longitude, lat: hp.latitude, t: Date.now(), acc: 5 }; TruckNav.stops = []; localStorage.removeItem('tn_facilities'); TruckNav.facilities = {}; TruckNav.setDest(nj); }, [HUNTS_POINT, NJ]);
await page.waitForFunction(() => TruckNav.ifta && Object.keys(TruckNav.ifta).length && TruckNav.weather && TruckNav.lanesDone, null, { timeout: 90000 }).catch(() => {});
const v2 = await T(() => ({ ifta: TruckNav.ifta, toll: TruckNav.tolls, wx: TruckNav.weather?.length, wxc: TruckNav.wxChecked, lanes: TruckNav.lanes?.length, fuel: TruckNav.fuelNear?.length, box: document.querySelector('#iftaBox').textContent, fb: document.querySelector('#fuelBox').textContent }));
ok(v2.ifta.NY > 0 && v2.ifta.NJ > 0, `IFTA miles by state from real road data: ${v2.box}`);
ok(v2.toll && typeof v2.toll.miles === 'number', `toll roads on route: ${v2.toll?.miles} mi (${(v2.toll?.segs || []).map(t => t.names.join('/')).join('; ')})`);
ok(v2.wxc > 0 && v2.wx >= 0, `NWS weather alerts checked at ${v2.wxc} points along route: ${v2.wx} truck-relevant alerts`);
ok(v2.lanes > 0, `lane guidance: ${v2.lanes} lane-choice intersections on route`);
ok(/Fuel plan/.test(v2.fb) && v2.fuel > 0, `fuel planner: ${v2.fuel} diesel stations near route — "${v2.fb.slice(0, 90)}"`);
await page.click('#dock button[data-panel=routePanel]').catch(() => {});
await T(() => document.querySelector('#tripSheet').scrollIntoView()); await page.waitForTimeout(800); await shot('v2-01-trip-sheet');

// Amenities: showers / restrooms / food
await T(() => { TruckNav.pois = []; TruckNav.loadPois(true); }); await page.waitForFunction(() => TruckNav.pois.length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => TruckNav.poiDone, null, { timeout: 150000 }).catch(() => {});
const am = await T(() => { const P = TruckNav.pois; const c = k => P.filter(p => p.amen?.[k]).length; document.querySelector('[data-pf=showers]').click(); const shown = document.querySelectorAll('.poi').length; const msg = TruckNav.lastAmenMsg;
  const card = document.querySelector('.poi .amen')?.textContent; return { n: P.length, sh: c('showers'), rr: c('restrooms'), fd: c('food'), shown, msg, card, helpers: TruckNav.amenHelpers, live: TruckNav.poiLive }; });
ok(am.sh + am.rr + am.fd > 0 && /^(Next .* with showers is .* ahead|No showers found ahead)/.test(am.msg), `amenities on ${am.n} stops: showers ${am.sh}, restrooms ${am.rr}, food ${am.fd} (${am.helpers} nearby amenity nodes, live sections ${am.live}); showers filter shows ${am.shown}; voice "${am.msg}"; card "${am.card}"`);
await page.click('#dock button[data-panel=routePanel]').catch(() => {}); await T(() => document.querySelector('#poiList').scrollIntoView()); await page.waitForTimeout(500); await shot('v2-08-showers-filter');
const cf = await T(async () => { const p = TruckNav.pois.find(x => ['stop', 'rest', 'parking', 'fuel'].includes(x.kind)); await TruckNav.confirmAmenity(p.id, 'showers', true); return TruckNav.pois.find(x => x.id === p.id).amen.showers; });
ok(cf === 'driver-confirmed', 'driver can confirm amenities (showers → driver-confirmed)');
await T(() => document.querySelector('[data-pf=all]').click());
// Fuel prices: EIA baseline + driver price + best price mode
page.once('dialog', d => d.accept('5.799'));
const fp = await T(async () => { const st = TruckNav.pois.filter(p => p.kind === 'fuel' || p.kind === 'stop'); await TruckNav.reportPrice(st[0].id); document.querySelector('#optBest').click();
  TruckNav.bestPrice(true); return { eia: TruckNav.eia?.prices?.US, week: TruckNav.eia?.week, box: document.querySelector('#priceBox').textContent, msg: TruckNav.lastPriceMsg, card: TruckNav.priceFor(st[0]), card2: st[1] ? TruckNav.priceFor(st[1]) : '' }; });
ok(fp.eia > 1 && /EIA weekly average/.test(fp.box), `EIA weekly diesel baseline loaded: US $${fp.eia} (week ${fp.week}) — "${fp.box.slice(0, 110)}"`);
ok(/^Cheapest diesel ahead: \$5\.80 at .+, \d+ miles/.test(fp.msg || '') && /driver-reported/.test(fp.card), `best-price mode voice: "${fp.msg}"; card labels source+age`);
await T(() => document.querySelector('#priceBox').scrollIntoView()); await shot('v2-09-best-fuel-price');
// Nav: speed limit sign + speeding alert + lanes
const sp = await T(async () => { TruckNav.startNav(); TruckNav.opts.maxMph = 30; const r = TruckNav.route, ln = TruckNav.lanes[0];
  const i = Math.max(1, r.cum.findIndex(c => c >= ln.along - 300)); TruckNav.onFix({ lon: r.line[i][0], lat: r.line[i][1], speed: 22, acc: 5, t: Date.now() + 1000 });
  await new Promise(res => setTimeout(res, 300));
  return { lim: TruckNav.limitMph, posted: TruckNav.postedKph, sign: !document.querySelector('#limitSign').classList.contains('hidden'), over: document.querySelector('#speedBox').classList.contains('over'), said: TruckNav.spokenLog.filter(t => /Slow down/.test(t)), lanes: !document.querySelector('#lanes').classList.contains('hidden'), lhtml: document.querySelector('#lanes').innerHTML }; });
ok(sp.sign && sp.lim === 30 && sp.over && sp.said.length, `speed-limit sign shows ${sp.lim} mph (truck max; posted ${sp.posted ?? 'n/a'} km/h) + speeding alert "${sp.said[0]}"`);
ok(sp.lanes && /lane ok/.test(sp.lhtml), 'lane guidance arrows shown before a lane-choice junction');
await page.waitForTimeout(1200); await shot('v2-02-speed-lanes');
// Posted limit from OSM on a real edge
const pl = await T(() => { const e = TruckNav.edges.filter(x => x.speed_limit); return { n: e.length, tot: TruckNav.edges.length, sample: e.slice(0, 3).map(x => x.speed_limit) }; });
ok(pl.n > 0, `posted speed limits on ${pl.n}/${pl.tot} route segments (km/h e.g. ${pl.sample.join(',')})`);
// Driving lockout
await T(() => { TruckNav.opts.maxMph = 65; TruckNav.pos.speed = 20; document.querySelector('#searchBtn').click(); });
ok(await T(() => !document.querySelector('#lockout').classList.contains('hidden') && document.querySelector('#searchPanel').classList.contains('hidden')), 'typing locked while moving; voice/passenger options offered');
await shot('v2-03-lockout'); await page.click('#lockClose');
// Fatigue
const fa = await T(() => { const p = TruckNav.pos, t0 = Date.now() + 3600e3; TruckNav.onFixHook({ ...p, t: t0 }, 55); TruckNav.onFixHook({ ...p, t: t0 + 121 * 60e3 }, 55); return TruckNav.spokenLog.filter(t => /driving 2 hours/.test(t)); });
ok(fa.length === 1, 'drowsy-driving reminder after 2 h continuous driving: ' + fa[0]);
await T(() => TruckNav.endNav());
// SOS
await page.click('#moreBtn'); await page.click('#sosBtn'); const so = await T(() => ({ tel: document.querySelector('#sos911').getAttribute('href'), where: document.querySelector('#sosWhere').textContent, sms: document.querySelector('#sosSms').getAttribute('href') }));
ok(so.tel === 'tel:911' && /40\.\d+/.test(so.where) && /sms:/.test(so.sms), `SOS: call 911 + share/text exact location (${so.where})`);
await shot('v2-04-sos'); await closeP();
// Multi-stop
const ms = await T(async () => { const before = TruckNav.route.length; TruckNav.addStop({ lon: -74.0431, lat: 40.7282, name: 'Jersey City stop' }); await new Promise(r => setTimeout(r, 200)); await TruckNav.plan(); const near = Math.min(...TruckNav.route.line.map(([x, y]) => Math.hypot((x + 74.0431) * 84000, (y - 40.7282) * 111000))); return { before, after: TruckNav.route.length, n: TruckNav.stops.length, near }; });
ok(ms.n === 1 && ms.near < 300, `multi-stop routing: added stop, route ${(ms.before / 1609).toFixed(1)} → ${(ms.after / 1609).toFixed(1)} mi, passes ${Math.round(ms.near)} m from the stop`);
await T(() => document.querySelector('#stopsBox').scrollIntoView()); await shot('v2-05-multistop'); await T(() => { TruckNav.stops.length = 0; localStorage.setItem('tn_stops', '[]'); }); await closeP();
// Parking + weather reports, accessibility
await T(() => TruckNav.openPanel('reportPanel')); ok(await T(() => ['parking_full', 'parking_open', 'ice', 'wind', 'chains'].every(k => document.querySelector(`[data-rt=${k}]`))), 'driver reports for parking availability (open/few/full), ice, high wind, chain law');
await shot('v2-06-reports'); await closeP();
await page.click('#dock button[data-panel=truckPanel]'); await page.check('#optBig'); await page.check('#optContrast');
ok(await T(() => document.body.classList.contains('bigtext') && document.body.classList.contains('contrast')), 'accessibility: large text + high contrast');
await T(() => document.querySelector('#optMax').scrollIntoView()); await shot('v2-07-accessibility'); await page.uncheck('#optBig'); await page.uncheck('#optContrast'); await closeP();
if (BASE.startsWith('https')) ok(await T(async () => !!(await navigator.serviceWorker.ready).active), 'service worker active (offline app shell + tiles)');
const man = await T(async () => (await fetch('manifest.webmanifest')).json()); ok(man.display === 'standalone' && man.icons.length >= 2, 'installable manifest');
await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1500); await shot('10-landscape');
await browser.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);

// End-to-end: real browser + real routing server + simulated GPS. BASE=url node test/e2e.mjs
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/', SHOTS = process.env.SHOTS || '/workspace/truckers-gps-shots';
mkdirSync(SHOTS, { recursive: true });
const HUNTS_POINT = { latitude: 40.8128, longitude: -73.8803 }, NJ = { lat: 40.6879, lon: -74.1580, name: 'Port Newark warehouse district, NJ' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: HUNTS_POINT, permissions: ['geolocation'] });
const page = await ctx.newPage(); page.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
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
ok(mz.log.some(t => /new route|Whoops/i.test(t)) && mz.log.some(t => /Weigh station/i.test(t)) && mz.busyHidden, 'mascot Coney reacts to reroute + weigh station, stays out of the way near turns');
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
const la = await T(async () => { TruckNav.setTruck({ heightFt: 8, heightIn: 0 }); TruckNav.pos = { lat: 41.2700, lon: -72.6954, t: Date.now() }; TruckNav.dest = { lat: 41.2670, lon: -72.6953, name: 'Guilford CT test' };
  const r = await TruckNav.valhalla(TruckNav.pos, TruckNav.dest, 'truck'); TruckNav.routes = [r]; TruckNav.chosen = r; TruckNav.route = r; TruckNav.setTruck({ heightFt: 13, heightIn: 6 });
  await TruckNav.analyzeRoute(r); return { d: TruckNav.dangers.map(x => x.kind + ':' + x.sev + ':' + x.short), edges: TruckNav.routeEdges }; });
ok(la.d.some(x => /^height:stop/.test(x)), `look-ahead finds Guilford CT's 11'8" Water St rail bridge vs 13'6" truck (${la.edges} road segments checked): ${la.d.join(' | ')}`);
const la2 = await T(async () => { TruckNav.off.reset(); TruckNav.dangerSpoken = {}; TruckNav.nav = true; TruckNav.along = 0; TruckNav.lastReroute = 0; const r = TruckNav.route, d = TruckNav.dangers.find(x => x.kind === 'height'); const before = TruckNav.rerouteCount;
  TruckNav.along = Math.max(0, d.along - 200); const p = r.line[0]; TruckNav.pos = { lon: p[0], lat: p[1], speed: 10, acc: 5, t: Date.now() };
  // call the alert routine via a nav tick on route
  TruckNav.hint = 0; TruckNav.onFix({ lon: r.line[1][0], lat: r.line[1][1], speed: 10, acc: 5, t: Date.now() + 1000 });
  await new Promise(res => setTimeout(res, 6000)); const out = { said: TruckNav.spokenLog.filter(t => /clearance/i.test(t)), rerouted: TruckNav.rerouteCount > before, len: TruckNav.route.length }; TruckNav.endNav(); return out; });
ok(la2.said.some(t => /Low clearance 11 foot \d+ (just ahead|in half a mile)\. Your truck is 13 foot 6\. Rerouting/.test(t)) && la2.rerouted && la2.len > 3000, `danger announced + rerouted around it (${(la2.len / 1609).toFixed(1)} mi): ${JSON.stringify(la2.said[0])}`);
await T(() => { TruckNav.avoids.length = 0; localStorage.setItem('tn_avoids', '[]'); TruckNav.setTruck({ heightFt: 13, heightIn: 6 }); });
// Garage
await page.click('#meBtn'); await page.waitForSelector('#garage button');
const gar = await T(() => { const locked = document.querySelectorAll('#garage button.lock').length; document.querySelector('[data-veh=box]').click(); document.querySelector('[data-col=green]').click(); return { locked, total: document.querySelectorAll('#garage button').length, ride: TruckNav.ride, svg: document.querySelector('.truck-marker svg') ? true : false }; });
ok(gar.total >= 8 && gar.locked > 0 && gar.ride.type === 'box' && gar.ride.color === 'green' && gar.svg, `garage: ${gar.total} vehicles (${gar.locked} locked by level), picked green box truck as map icon`);
await shot('17-garage'); await closeP();
await T(() => { TruckNav.setTruck({ heightFt: 13, heightIn: 6 }); TruckNav.map.jumpTo({ center: [-78.9085, 35.9995], zoom: 16 }); }); await page.click('#reportBtn'); await page.waitForTimeout(1500); await shot('11-report');
await T(() => { TruckNav.avoids.length = 0; localStorage.setItem('tn_avoids', '[]'); }); await closeP();

// Community report + voting + points
const com = await T(async () => { const p0 = TruckNav.profile.p.points; const other = { id: 'other-1', type: 'hazard', lat: TruckNav.pos.lat + 0.001, lon: TruckNav.pos.lon, t: Date.now(), up: 0, down: 0, mine: false };
  await TruckNav.backend.addReport(other); TruckNav.reports.push(other); await TruckNav.vote(other, 'up'); await TruckNav.report('police', [TruckNav.pos.lon + 0.002, TruckNav.pos.lat]);
  return { up: other.up, pts: TruckNav.profile.p.points - p0, badges: TruckNav.profile.p.badges, markers: document.querySelectorAll('.rpt-marker').length }; });
ok(com.up === 1 && com.pts >= 7 && com.badges.includes('first_report') && com.markers >= 2, `community reports on map with voting; +${com.pts} pts; badges ${com.badges.join(',')}`);

// Account (local adapter until Supabase connected)
await page.click('#meBtn'); await page.fill('#acEmail', 'driver@example.com'); await page.click('#acGo'); await page.waitForSelector('#signOut');
ok(await T(async () => (await TruckNav.backend.session()).email === 'driver@example.com'), `sign-in works via ${await T(() => TruckNav.backend.name)} adapter`);
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
await page.click('#dock button[data-panel=hosPanel]'); await page.click('[data-duty=drive]'); ok(await T(() => TruckNav.hos.status === 'drive'), 'HOS clock running'); await shot('08-hos'); await closeP();
await page.click('#dock button[data-panel=truckPanel]'); await page.selectOption('[name=theme]', 'dim'); await page.waitForTimeout(1500); ok(await T(() => document.body.classList.contains('dim')), 'dim night mode'); await shot('09-truck-profile-dim'); await closeP(); await shot('15-dim-map');
await page.click('#dock button[data-panel=loadPanel]'); await page.fill('[name=bol]', 'BOL-TEST'); await page.reload(); await page.waitForFunction(() => window.TruckNav?.ready);
ok(await page.inputValue('[name=bol]') === 'BOL-TEST', 'load details persist');
if (BASE.startsWith('https')) ok(await T(async () => !!(await navigator.serviceWorker.ready).active), 'service worker active (offline app shell + tiles)');
const man = await T(async () => (await fetch('manifest.webmanifest')).json()); ok(man.display === 'standalone' && man.icons.length >= 2, 'installable manifest');
await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1500); await shot('10-landscape');
await browser.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);

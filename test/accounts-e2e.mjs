// Live e2e over REAL public relays: accounts (signup/login/logout/recovery on other contexts), dispatcher <-> driver, friends + pass prediction.
// BASE=url node test/accounts-e2e.mjs
import { chromium, devices } from 'playwright'; import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/', SH = '/workspace/truckers-gps-shots/dispatch'; mkdirSync(SH, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch(); const BRONX = { latitude: 40.8160, longitude: -73.8800 };
async function app(name, geo = BRONX) { const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: geo, permissions: ['geolocation'] }); const p = await ctx.newPage();
  // this suite covers the relay (no-server) fallback: blank out the Supabase config
  await p.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "export const SUPABASE = { url: '', anonKey: '' };" }));
  p.on('pageerror', e => console.log(name, 'PAGE ERROR', e.message)); p.on('dialog', d => d.accept(d.type() === 'prompt' ? '950' : undefined));
  await p.goto(BASE); await p.waitForFunction(() => TruckNav?.accountReady && TruckNav.pos, null, { timeout: 40000 }); await p.evaluate(() => document.querySelector('#splash')?.remove()); await p.waitForTimeout(1500); return p; }
const shot = (p, n) => p.screenshot({ path: `${SH}/${n}.png` });
const wait = (p, fn, arg, s = 40) => p.waitForFunction(fn, arg, { timeout: s * 1000, polling: 300 }).then(() => true).catch(() => false);
const id = Date.now().toString(36), EMAIL = `driver.${id}@example.com`, PASS = 'Diesel-' + id, EMAIL_B = `mike.${id}@example.com`;
async function signUp(p, email, name) { await p.click('#acctBtn'); await p.click('[data-t="up"]'); await p.fill('#acName', name); await p.fill('#acEmail', email); await p.fill('#acPass', PASS); await p.click('#acGo');
  return wait(p, () => !!TruckNav.auth.user, null, 60); }
// ---------- 1. accounts
const A = await app('A'); await A.evaluate(() => { TruckNav.truck.heightFt = 13.5; localStorage.setItem('tn_truck', JSON.stringify(TruckNav.truck)); });
ok(await signUp(A, EMAIL, 'Anthony'), 'sign up with email + password'); await shot(A, '01-signed-up');
const rec = await A.evaluate(() => TruckNav.auth.recoveryCode()); ok(/^RR1-/.test(rec), 'recovery code available');
await A.click('#acRec'); await shot(A, '02-recovery-code');
await A.click('#acOut'); ok(await A.evaluate(() => !TruckNav.auth.user), 'sign out -> guest mode'); await shot(A, '03-guest');
await A.click('[data-t="in"]'); await A.fill('#acEmail', EMAIL); await A.fill('#acPass', PASS + 'x'); await A.click('#acGo');
ok(await wait(A, () => /No account found/.test(document.querySelector('#acMsg').textContent), null, 40), 'wrong password rejected');
await A.fill('#acPass', PASS); await A.click('#acGo'); ok(await wait(A, () => TruckNav.auth.user?.name === 'Anthony', null, 40), 'sign back in with email + password');
const A2 = await app('A2'); await A2.click('#acctBtn'); await A2.click('[data-t="in"]'); await A2.fill('#acEmail', EMAIL.toUpperCase()); await A2.fill('#acPass', PASS); await A2.click('#acGo');
ok(await wait(A2, () => TruckNav.auth.user?.name === 'Anthony' && TruckNav.truck.heightFt === 13.5, null, 60), 'second device: same account, name + truck profile (13.5 ft) restored'); await shot(A2, '04-second-device-signed-in');
const A3 = await app('A3'); await A3.click('#acctBtn'); await A3.click('[data-t="rec"]'); await A3.fill('#acCode', rec); await A3.click('#acGo');
ok(await wait(A3, (pk) => TruckNav.auth.user?.name === 'Anthony', null, 40), 'third device: restored with recovery code'); await A3.context().close(); await A2.context().close();
// ---------- 2. dispatch
const Dp = await (await browser.newContext({ viewport: { width: 1100, height: 1400 } })).newPage(); Dp.on('pageerror', e => console.log('DISP PAGE ERROR', e.message));
await Dp.goto(BASE + 'dispatch.html'); await Dp.waitForFunction(() => window.RRD); await Dp.click('#newCode'); ok(await Dp.$eval('#codeBox', e => e.hidden), 'pairing code needs a company name first'); await Dp.fill('#dName', 'Rocapulco Freight'); await Dp.click('#newCode'); await Dp.waitForSelector('#code:not(:empty)'); const code = await Dp.textContent('#code');
await Dp.waitForTimeout(1500); await shot(Dp, '05-dispatcher-code');
await A.click('#loadsBtn'); await A.fill('#pairUnit', '42'); await A.fill('#pairCode', code); await A.click('#pairGo');
ok(await wait(A, () => TruckNav.dispatch.pairings.length === 1, null, 60), `driver paired with dispatcher using code ${code}`);
ok(await wait(Dp, () => RRD.drivers.length === 1 && RRD.drivers[0].driver.name === 'Anthony', null, 20), 'dispatcher sees paired driver "Anthony"');
ok(await Dp.evaluate(() => ['#ref', '#pAddr', '#pLL', '#rate', '#comm', '#bol', '#notes', '#pWin'].every(i => !document.querySelector(i).value)), 'relay form has placeholders, no sample load values');
ok(await wait(Dp, () => /Anthony · Unit 42/.test(document.querySelector('#drivers').textContent), null, 20), 'dispatcher shows driver as "Anthony · Unit 42", not an id'); console.log('drivers:', await Dp.textContent('#drivers'), '| msg:', await Dp.textContent('#sendMsg'));
ok(await Dp.isDisabled('#send') && /Needed: driver/.test(await Dp.textContent('#sendMsg')), 'Send blocked until required fields are filled');
await Dp.selectOption('#to', { index: 1 }); await Dp.fill('#rate', '850'); await Dp.fill('#pAddr', '355 Food Center Dr, Bronx, NY'); ok(await Dp.isDisabled('#send'), 'typed address without a picked match still blocks Send');
await Dp.evaluate(() => { const set = (i, v) => { const e = document.querySelector(i); e.value = v; }; set('#pLL', '40.80850,-73.87400'); set('#dAddr', '1 Export St, Newark, NJ'); set('#dLL', '40.69300,-74.15200'); set('#dWin', '2099-01-01T08:00,2099-01-01T10:00'); document.querySelector('#rate').dispatchEvent(new Event('input')); });
ok(!(await Dp.isDisabled('#send')), 'Send enabled once driver, both addresses+locations and rate are set');
await A.evaluate(() => addEventListener('unhandledrejection', e => window.__lastErr = String(e.reason?.message || e.reason)));
const LID = await Dp.inputValue('#lid'); await Dp.click('#send'); ok(await wait(Dp, () => /sent/.test(document.querySelector('#sendMsg').textContent), null, 20), 'dispatcher sent load ' + LID);
ok(await wait(A, l => !!document.querySelector(`[data-load="${l}"] [data-act="accept"]`), LID, 40), 'driver Loads inbox shows the offer'); await shot(A, '06-driver-load-offer');
await A.click(`[data-load="${LID}"] [data-act="accept"]`); ok(await wait(Dp, l => document.querySelector(`[data-load="${l}"] [data-state]`)?.dataset.state === 'accepted', LID, 40), 'dispatcher sees ACCEPTED');
await A.click(`[data-load="${LID}"] [data-act="nav"]`);
ok(await wait(A, () => TruckNav.nav && TruckNav.stops?.[0]?.name?.startsWith('Pickup') && /Deliver/.test(TruckNav.dest?.name), null, 90), 'one-tap Navigate: multi-stop truck route pickup -> delivery, navigation started');
await A.waitForTimeout(1500); await shot(A, '07-driver-navigating');
ok(await wait(Dp, l => document.querySelector(`[data-load="${l}"] [data-state]`)?.dataset.state === 'en_route_pickup', LID, 40), 'dispatcher sees "En route to pickup" (auto on Navigate)');
await A.evaluate(() => { document.querySelector('#endBtn')?.click(); document.querySelector('#trcDone')?.click(); }); await A.click('#loadsBtn');
await A.check('#shareLoc'); ok(await wait(Dp, () => RRD.drivers[0].sharing && RRD.drivers[0].last?.lat, null, 40), 'driver opted in to live location -> dispatcher sees position');
ok(await wait(Dp, l => !!document.querySelector(`[data-load="${l}"] [data-eta]`), LID, 20), 'dispatcher sees (en route) an ETA estimate for the load');

const PIN = await Dp.textContent(`[data-load="${LID}"] [data-pin] b`).catch(() => ''); ok(/^\d{4}$/.test(PIN || ''), 'dispatcher console shows the 4-digit pickup PIN on the load: ' + PIN);
for (const s of ['arrived_pickup', 'loaded', 'en_route_drop', 'arrived_drop']) { if (s === 'loaded') { await A.evaluate(w => { window.prompt = () => w; }, '0000' === PIN ? '1111' : '0000'); await A.click(`[data-load="${LID}"] [data-s="loaded"]`); await A.waitForTimeout(800); ok(await A.evaluate(l => TruckNav.dispatch.allLoads().find(x => x.load.id === l).state === 'arrived_pickup', LID), 'wrong pickup PIN is refused'); await A.evaluate(w => { window.prompt = () => w; }, PIN); }
  await A.click(`[data-load="${LID}"] [data-s="${s}"]`);
  ok(await wait(Dp, ([l, s]) => document.querySelector(`[data-load="${l}"] [data-state]`)?.dataset.state === s, [LID, s], 40), 'dispatcher sees status ' + s) }
await A.check('#shareLoc'); ok(await wait(Dp, () => RRD.drivers[0].sharing && RRD.drivers[0].last?.lat, null, 40), 'driver opted in to live location -> dispatcher sees position');
await Dp.fill(`[data-load="${LID}"] [data-mi]`, 'Gate 3 please'); await Dp.click(`[data-load="${LID}"] [data-ms]`);
ok(await wait(A, () => /Gate 3 please/.test(document.querySelector('#loadsPanel, body').textContent), null, 30), 'driver receives dispatcher message');
ok(!(await A.$(`[data-load="${LID}"] [data-s="delivered"]`)), 'no one-tap Delivered: proof of delivery required');
await A.click(`[data-load="${LID}"] [data-act="podsheet"]`); ok(await A.isDisabled('#fxPodGo'), 'POD sheet blocks submit until photo, signature, name');
await A.setInputFiles('#fxPodPhoto', 'icons/icon-192.png'); await A.fill('#fxPodName', 'R. Alvarez'); if (await A.$('#fxPodPcs')) await A.fill('#fxPodPcs', '12');
{ const b = await A.$eval('#fxPodSig', c => { const r = c.getBoundingClientRect(); return [r.x, r.y]; }); await A.mouse.move(b[0] + 20, b[1] + 40); await A.mouse.down(); for (let k = 0; k < 15; k++) await A.mouse.move(b[0] + 20 + k * 8, b[1] + 40 + (k % 3) * 6); await A.mouse.up(); }
await A.waitForFunction(() => !document.querySelector('#fxPodGo').disabled, null, { timeout: 10000 }); await A.click('#fxPodGo');
ok(await wait(Dp, l => document.querySelector(`[data-load="${l}"] [data-state]`)?.dataset.state === 'delivered' && document.querySelector(`[data-load="${l}"] img.pod`), LID, 40), 'delivered + POD photo visible to dispatcher'); ok(/R\. Alvarez/.test(await Dp.textContent(`[data-load="${LID}"]`)) && !!(await Dp.$(`[data-load="${LID}"] img.sig`)), 'dispatcher sees signature + receiver name');
ok(/relays connected/.test(await Dp.textContent('#relays')) && (await Dp.$$('[data-relay]')).length > 0, 'per-relay health shown');
await shot(A, '08-driver-delivered'); await shot(Dp, '09-dispatcher-timeline');
// ---------- 3. friends + pass prediction
const B = await app('B', { latitude: 40.75, longitude: -74.05 }); ok(await signUp(B, EMAIL_B, 'Mike'), 'second driver Mike signs up');
await B.click('#friendsBtn'); const bCode = await B.textContent('#myFriendCode');
await A.click('#friendsBtn'); await A.fill('#frAdd', bCode); await A.click('#frSend'); ok(await wait(A, () => TruckNav.friends.outgoing.length === 1, null, 30), 'Anthony sends friend request to Mike by code');
ok(await wait(B, () => !!document.querySelector('[data-acc]'), null, 40), 'Mike sees the request'); await shot(B, '10-friend-request');
await B.click('[data-acc]'); ok(await wait(A, () => TruckNav.friends.friends.some(f => f.name === 'Mike'), null, 40) && await wait(B, () => TruckNav.friends.friends.some(f => f.name === 'Anthony'), null, 10), 'both are friends');
// Anthony plans a real truck route to Newark; Mike is on it ~2/3 along, heading the same way more slowly
await A.evaluate(() => TruckNav.setDest({ lat: 40.693, lon: -74.152, name: 'Port Newark' })); ok(await wait(A, () => !!TruckNav.route?.line?.length, null, 90), 'Anthony has a truck route');
const mPos = await A.evaluate(() => { const l = TruckNav.route.line, i = Math.floor(l.length * 0.66), a = l[i], b = l[i + 3] || l.at(-1); const h = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360; return { lon: a[0], lat: a[1], heading: h }; });
await A.evaluate(() => { TruckNav.pos = { ...TruckNav.pos, speed: 26, heading: 220 }; TruckNav.friends.setRouteShare(true); TruckNav.shareNow(); });
await B.evaluate(p => { TruckNav.pos = { ...TruckNav.pos, lat: p.lat, lon: p.lon, heading: p.heading, speed: 4 }; TruckNav.shareNow(); }, mPos);
ok(await wait(A, () => document.querySelector('.fr-pin') && /Mike/.test(document.querySelector('.fr-pin').textContent), null, 40), "Mike appears on Anthony's map (name + truck + last updated)");
ok(await wait(B, () => document.querySelector('.fr-pin') && /Anthony/.test(document.querySelector('.fr-pin').textContent), null, 40), "Anthony appears on Mike's map");
ok(await wait(B, () => TruckNav.map.getSource('frRoutes')?._data?.features?.length > 0 || TruckNav.friends.live[Object.keys(TruckNav.friends.live)[0]]?.route, null, 40), "Mike sees Anthony's shared route");
await A.click('#friendsBtn'); await A.click('#friendsBtn').catch(() => {}); const pass = await A.evaluate(() => Object.values(TruckNav.friendPass || {})[0]?.text);
ok(/You'll pass Mike in ~\d+ mi/.test(pass || ''), 'pass prediction: "' + pass + '"');
if (!(await A.isVisible('#friendsPanel'))) await A.click('#friendsBtn'); await A.waitForTimeout(800); await shot(A, '11-friends-pass-prediction');
await A.evaluate(() => document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'))); await A.evaluate(p => TruckNav.map.jumpTo({ center: [p.lon, p.lat], zoom: 12 }), mPos); await A.waitForTimeout(1500); await shot(A, '12-friend-on-map');
// privacy: Mike turns ghost mode on -> no further location sent
const sent = await B.evaluate(async () => { TruckNav.friends.setGhost(true); return TruckNav.friends.tick(TruckNav.pos, null); }); ok(sent === 0, 'ghost mode: nothing shared');
await browser.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);

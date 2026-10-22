// Deep link ?to= → route; Share ETA via share sheet; install card only after a real completed trip.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/', SH = '/workspace/truckers-gps-shots/r4'; let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; };
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await br.newContext({ ...devices['Pixel 7'], geolocation: { latitude: 40.8296, longitude: -73.8876 }, permissions: ['geolocation'] });
await ctx.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); navigator.share = async d => { window.__shared = d; }; });
const p = await ctx.newPage(); p.on('pageerror', e => { console.log('ERR', e.message); fails++; });
await p.goto(BASE + '?to=40.6930,-74.1520&name=Port%20Newark%20Terminal', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => TruckNav?.ready && TruckNav.growth, null, { timeout: 40000, polling: 500 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.waitForFunction(() => TruckNav.route?.line?.length > 10, null, { timeout: 40000, polling: 500 }).catch(async e => { console.log('DBG', await p.evaluate(() => JSON.stringify([!!window.TruckNav?.ready, !!window.TruckNav?.growth, location.href]))); throw e; });
ok(await p.evaluate(() => TruckNav.dest.name === 'Port Newark Terminal' && Math.abs(TruckNav.dest.lat - 40.693) < 1e-4 && !location.search.includes('to=')), 'deep link opens a real truck route to the shared place and cleans the URL');
ok(await p.evaluate(() => TruckNav.growth.parseTo('?to=999,1') === null && TruckNav.growth.parseTo('?to=abc') === null), 'bad deep links ignored');
await p.evaluate(() => document.querySelector('#routePanel').classList.remove('hidden')); await p.waitForSelector('#shareEta'); await p.click('#shareEta');
const sh = await p.evaluate(() => window.__shared); ok(/Heading to Port Newark Terminal\. ETA \d{1,2}:\d\d [AP]M \(\d+ mi\)/.test(sh?.text) && /\?to=40\.69300,-74\.15200&name=Port%20Newark/.test(sh?.url), 'Share ETA: ' + sh?.text);
await p.screenshot({ path: SH + '/390-share-eta.png' });
// install card: not before any trip; after a completed trip + beforeinstallprompt
await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); });
await p.waitForTimeout(2500); ok(!(await p.$('#installCard')), 'no install nag before the first real trip');
await p.evaluate(() => localStorage.setItem('tn_trips', JSON.stringify([{ id: 'RR-1', dest: 'Port Newark', start: Date.now() - 3600e3, miles: 21 }]))); await p.waitForSelector('#installCard', { timeout: 5000 });
await p.screenshot({ path: SH + '/390-install-card.png' }); await p.click('[data-inst]'); await p.waitForTimeout(300);
ok(await p.evaluate(() => window.__prompted && !document.querySelector('#installCard') && localStorage.getItem('tn_installAsked')), 'after the first trip: install card → native prompt, asked once');
await br.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

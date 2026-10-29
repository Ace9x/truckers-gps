// CSP present and violation-free on every page; hostile text from the server (load ref/notes/address, messages, facility notes) renders as plain text.
import { chromium, devices } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8841/';
const CFG = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), U = CFG.match(/url: '([^']+)'/)[1], K = CFG.match(/anonKey: '([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/testusers.json')); let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const pg of ['', 'dispatch.html', 'privacy.html']) { const p = await browser.newPage(), v = []; p.on('console', m => /Content Security Policy|Refused to/.test(m.text()) && v.push(m.text().slice(0, 160)));
  await p.goto(BASE + pg); await p.waitForTimeout(pg ? 3000 : 8000); const csp = await p.$eval('meta[http-equiv="Content-Security-Policy"]', m => m.content).catch(() => '');
  ok(/script-src 'self'/.test(csp) && /object-src 'none'/.test(csp), `${pg || 'index'}: CSP meta present`); ok(!v.length, `${pg || 'index'}: no CSP violations ${v.join(' | ')}`);
  if (!pg) ok(await p.evaluate(() => !!window.TruckNav?.ready && !!TruckNav.map?.loaded()), 'app boots and map loads under CSP');
  ok(!/unsafe-eval/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp), `${pg || 'index'}: no unsafe-eval / unsafe-inline scripts`); ok(/media-src[^;]*blob:/.test(csp), `${pg || 'index'}: media-src allows blob: (cloned-voice playback)`); await p.close(); }
// hostile text through the real server
const X = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await X.auth.signInWithPassword(users.dispatcher); await X.from('loads').delete().like('notes', 'XSS-%');
const BAD = `<img src=x onerror="window.__xss=1">'"><svg onload=window.__xss=2>`;
const { data: L } = await X.from('loads').insert({ driver: users.driver.id, ref: BAD, notes: 'XSS-' + BAD, commodity: BAD, pickup_address: BAD, pickup_lat: 40.81, pickup_lng: -73.87, dropoff_address: BAD, dropoff_lat: 40.69, dropoff_lng: -74.15 }).select().single();
const ctx = await browser.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.75, longitude: -73.99 }, permissions: ['geolocation'] }); const p = await ctx.newPage();
await p.goto(BASE); await p.waitForFunction(() => TruckNav?.accountReady && TruckNav.backendReady, null, { timeout: 40000 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.click('#acctBtn'); await p.click('[data-t="in"]'); await p.fill('#acEmail', users.driver.email); await p.fill('#acPass', users.driver.password); await p.click('#acGo');
await p.waitForFunction(() => TruckNav.auth.user?.method === 'supabase', null, { timeout: 30000 }); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'))); await p.click('#loadsBtn');
const C = `[data-cload="${L.id}"]`; await p.waitForSelector(C + ' [data-cs="accepted"]', { timeout: 20000 }); await p.click(C + ' [data-cs="accepted"]'); await p.waitForSelector(C + ' [data-fx] .fx-stop', { timeout: 15000 });
await X.from('load_events').insert({ load_id: L.id, kind: 'message', body: { text: BAD } }); await p.waitForTimeout(3000);
ok(await p.evaluate(() => window.__xss === undefined), 'driver app: no script ran from hostile load fields or messages'); ok((await p.textContent(C)).includes('<img src=x'), 'hostile text shown literally as plain text');
ok(await p.$(C + ' img[src="x"], ' + C + ' svg[onload]') == null, 'no injected elements in the load card');
const d = await browser.newPage(); await d.goto(BASE + 'dispatch.html'); await d.waitForFunction(() => document.querySelector('#sbIn').onclick); await d.fill('#sbEmail', users.dispatcher.email); await d.fill('#sbPass', users.dispatcher.password); await d.click('#sbIn'); await d.waitForFunction(() => window.RRB, null, { timeout: 30000 }); await d.waitForTimeout(1500);
ok(await d.evaluate(() => window.__xss === undefined) && (await d.textContent(`[data-bload="${L.id}"]`)).includes('<img src=x'), 'dispatch board: hostile text plain, nothing executed');
await X.from('loads').delete().eq('id', L.id); await browser.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

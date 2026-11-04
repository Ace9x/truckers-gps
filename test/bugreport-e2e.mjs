// E2E: guest files a bug with a screenshot; type/size checks; cooldown. BASE=url node test/bugreport-e2e.mjs
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8790/'; let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const b = await chromium.launch(), ctx = await b.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8128, longitude: -73.8803 }, permissions: ['geolocation'] }), p = await ctx.newPage(); p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
await p.goto(BASE + '?notour'); await p.waitForFunction(() => window.TruckNav?.ready, null, { timeout: 30000 });
await p.evaluate(() => document.querySelector('#splash')?.remove()); await p.waitForTimeout(1500); await p.click('#meBtn', { force: true }).catch(() => {}); await p.evaluate(() => { document.querySelector('#mePanel')?.classList.remove('hidden'); document.querySelector('#bugBox').open = true; }); ok(await p.isVisible('#bugForm'), 'bug form visible in Me panel');
await p.setInputFiles('#bugShot', '/tmp/x.txt'); ok(/PNG, JPG or WebP/.test(await p.textContent('#bugMsg')) || (await p.inputValue('#bugShot')) === '', 'non-image rejected');
await p.setInputFiles('#bugShot', '/tmp/big.png'); ok(/5MB/.test(await p.textContent('#bugMsg')), 'over-5MB rejected');
await p.click('#bugSend'); await p.waitForFunction(() => /at least 5/.test(document.querySelector('#bugMsg').textContent)); ok(true, 'empty description rejected');
await p.fill('#bugDesc', 'E2E TEST bug report ' + (process.env.TAG || Date.now())); await p.setInputFiles('#bugShot', '/tmp/shot.png'); await p.fill('#bugContact', 'e2e@test.dev');
await p.click('#bugSend'); await p.waitForFunction(() => /Thanks|failed|Too many|error/i.test(document.querySelector('#bugMsg').textContent), null, { timeout: 20000 });
const m = await p.textContent('#bugMsg'); ok(/Thanks! Your report was sent/.test(m), 'report sent: ' + m);
await p.fill('#bugDesc', 'second quick one'); await p.click('#bugSend'); await p.waitForTimeout(1500); ok(/wait 30 seconds/.test(await p.textContent('#bugMsg')), 'client cooldown works');
await b.close(); console.log(fails ? `${fails} fails` : 'all passed'); process.exit(fails ? 1 : 0);

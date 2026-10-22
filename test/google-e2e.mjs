// "Continue with Google": hidden unless Supabase reports external.google; click starts OAuth with redirect to the live app. BASE=url node test/google-e2e.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/'; let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
for (const google of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 40.75, longitude: -73.99 }, permissions: ['geolocation'] }); await ctx.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
  const p = await ctx.newPage(); let authUrl = null;
  await p.route('**/auth/v1/settings**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ external: { google, email: true } }) }));
  await p.route('**/auth/v1/authorize**', r => { authUrl = r.request().url(); r.fulfill({ status: 200, contentType: 'text/html', body: 'stub' }); });
  await p.goto(BASE + '?rrtest=1'); await p.waitForFunction(() => window.TruckNav?.ready && TruckNav.openAccount, null, { timeout: 30000 });
  if (await p.evaluate(() => TruckNav.auth?.kind) !== 'supabase') { ok(false, 'Supabase auth active'); break; }
  await p.evaluate(() => TruckNav.openAccount()); await p.waitForTimeout(1500);
  const vis = await p.locator('#acGoogle').isVisible().catch(() => false);
  ok(vis === google, `Google button ${google ? 'shown' : 'hidden'} when provider ${google ? 'enabled' : 'disabled'}`);
  if (google) { await p.click('#acGoogle'); await p.waitForTimeout(2500);
    ok(authUrl && /provider=google/.test(authUrl) && decodeURIComponent(authUrl).includes('redirect_to=https://ace9x.github.io/truckers-gps/'), 'click starts Supabase Google OAuth redirecting back to the live app: ' + (authUrl || 'none').slice(0, 160)); }
  await ctx.close(); }
await b.close(); console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);

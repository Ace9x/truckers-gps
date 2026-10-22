// Splash never sticks: gone within the 2.5 s cap even if the map library CDN or app modules fail. BASE=url node test/splash-e2e.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/'; let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
for (const [name, block] of [['normal load', null], ['map CDN blocked', '**/unpkg.com/**'], ['app.js fails', '**/js/app.js*']]) {
  const p = await (await b.newContext()).newPage(); if (block) await p.route(block, r => r.abort());
  await p.goto(BASE + '?rrtest=1', { waitUntil: 'commit' }); const t0 = Date.now();
  const bar = await p.waitForSelector('#splash .splashBar', { timeout: 3000 }).then(() => true).catch(() => false);
  await p.waitForFunction(() => !document.querySelector('#splash') || document.querySelector('#splash').classList.contains('gone'), null, { timeout: 4000 }).catch(() => {});
  const ms = Date.now() - t0; ok(bar && ms <= 2900, `${name}: progress bar shown, splash dismissed after ${ms} ms (cap 2.5 s)`); await p.context().close(); }
await b.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);

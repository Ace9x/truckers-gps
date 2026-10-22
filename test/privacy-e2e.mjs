// Trust & privacy end to end: location explainer before the prompt, privacy.html, Me > Privacy export/delete, not-an-ELD notices, OG/favicon.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/'; let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
// 1. No permission yet -> explainer first; geolocation not requested until Continue
{ const c = await b.newContext(); await c.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); window.__geo = 0; const g = navigator.geolocation; const w = g.watchPosition.bind(g); g.watchPosition = (...a) => { window.__geo++; return w(...a); }; });
  const p = await c.newPage(); await p.goto(BASE + '?rrtest=1'); await p.waitForSelector('#locWhy', { timeout: 15000 }).catch(() => {});
  const s = await p.evaluate(() => ({ shown: !!document.querySelector('#locWhy'), geo: window.__geo, text: document.querySelector('#locWhy')?.textContent || '' }));
  ok(s.shown && s.geo === 0 && /Valhalla/.test(s.text) && /not stored/.test(s.text), 'location explainer shown before any location request');
  await p.click('#locWhyGo'); await p.waitForTimeout(800); ok(await p.evaluate(() => window.__geo > 0 && !document.querySelector('#locWhy')), 'Continue starts GPS'); await c.close(); }
// 2. privacy.html is real and names the services
{ const p = await b.newPage(); const r = await p.goto(BASE + 'privacy.html'); const t = await p.textContent('body');
  ok(r.status() === 200 && ['Valhalla', 'Photon', 'Overpass', 'Nostr'].every(x => t.includes(x)), 'privacy.html 200 and names Valhalla, Photon, Overpass, Nostr'); await p.close(); }
// 3. Me > Privacy, export + delete; notices; head tags
{ const c = await b.newContext({ geolocation: { latitude: 40.7357, longitude: -74.1724 }, permissions: ['geolocation'] }); await c.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); });
  const p = await c.newPage(); await p.goto(BASE + '?rrtest=1'); await p.waitForFunction(() => window.TruckNav?.ready, null, { timeout: 30000 });
  ok(!(await p.$('#locWhy')), 'no explainer when permission already granted');
  const head = await p.evaluate(() => ({ og: document.querySelector('meta[property="og:image"]')?.content, icon: document.querySelector('link[rel=icon]')?.getAttribute('href'), ns: !!document.querySelector('noscript') }));
  const ogr = await p.request.get(new URL('icons/og-image.png', BASE).href), ic = await p.request.get(new URL(head.icon, BASE).href);
  ok(/og-image\.png$/.test(head.og) && ogr.ok() && ic.ok() && /svg/.test(ic.headers()['content-type']) && head.ns, 'og:image + SVG favicon served, <noscript> fallback present');
  await p.evaluate(() => { localStorage.setItem('tn_hos', JSON.stringify({ test: 1 })); }); await p.click('#meBtn'); await p.waitForSelector('#mePriv #pvExport', { timeout: 5000 });
  const labels = await p.$$eval('#mePriv .pv-tag', e => e.map(x => x.textContent)); ok(labels.includes('Syncs') && labels.includes('This phone only'), 'Me > Privacy labels what syncs: ' + [...new Set(labels)].join(' / '));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pvExport')]); const j = JSON.parse(await (await import('node:fs')).promises.readFile(await dl.path(), 'utf8'));
  ok(j.data.tn_hos?.test === 1 && !Object.values(j.data).some(v => /^[0-9a-f]{64}$/.test(String(v))), 'Export downloads my data as JSON (private keys excluded)');
  await p.click('[data-panel=hosPanel], #dock button[data-panel=hosPanel]').catch(() => {}); ok(/Not a certified ELD/.test(await p.textContent('#hosPanel')), 'HOS panel says Not a certified ELD');
  await p.evaluate(() => TruckNav.setDest({ lat: 40.7, lon: -74.15, name: 'Test' })); await p.waitForSelector('#eldRoute', { timeout: 60000 }).catch(() => {});
  ok(/may be incomplete/.test(await p.textContent('#eldRoute').catch(() => '')), 'first route shows "restrictions may be incomplete" notice');
  await p.click('#eldOk'); for (const x of await p.$$('.panel:not(.hidden) .close')) await x.click().catch(() => {}); await p.click('#meBtn'); await p.waitForSelector('#pvDelete', { state: 'visible' });
  p.on('dialog', d => d.accept()); await Promise.all([p.waitForNavigation({ timeout: 15000 }).catch(() => {}), p.click('#pvDelete')]);
  ok(await p.evaluate(() => !Object.keys(localStorage).some(k => k === 'tn_hos' || k === 'tn_truck')), 'Delete all erases stored data'); await c.close(); }
await b.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);

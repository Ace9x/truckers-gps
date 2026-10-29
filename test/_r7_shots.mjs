import { chromium } from 'playwright';
const U = 'https://ace9x.github.io/truckers-gps/', O = '/workspace/truckers-gps-shots/r7/';
const b = await chromium.launch();
async function pg(lang, q = '', tourDone = true) { const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', permissions: ['geolocation'], geolocation: { latitude: 40.7357, longitude: -74.1724 } });
  await c.addInitScript(([l, td]) => { localStorage.setItem('tn_lang', JSON.stringify(l)); if (td) { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); } localStorage.setItem('tn_truckSetDone', '1'); localStorage.setItem('rr_wiz_done', '1'); }, [lang, tourDone]);
  const p = await c.newPage(); await p.goto(U + q, { waitUntil: 'load' }); await p.waitForTimeout(6000); await p.evaluate(() => document.querySelector('#locWhy')?.remove()); return p; }
let p = await pg('en', '?tour=1', false); await p.waitForSelector('#tourCard', { timeout: 15000 }).catch(() => {}); await p.click('#tNext').catch(() => {}); await p.waitForTimeout(800); await p.screenshot({ path: O + 'tour-card.png' });
p = await pg('en'); await p.click('#dock button[data-panel=hosPanel]'); await p.waitForTimeout(800); await p.screenshot({ path: O + 'hos-panel-terms.png' });
await p.click('#hosPanel .help-q'); await p.waitForTimeout(800); await p.screenshot({ path: O + 'help-open.png' });
await p.click('#helpSheet .hs-close'); await p.click('#hosPanel .gl').catch(e => console.log('gl', e.message)); await p.waitForTimeout(800); await p.screenshot({ path: O + 'tap-to-explain.png' });
for (const l of ['es', 'ar']) { p = await pg(l); await p.screenshot({ path: O + `main-${l}.png` }); await p.click('#dock button[data-panel=routePanel]'); await p.waitForTimeout(800); await p.screenshot({ path: O + `route-${l}.png` }); }
await b.close(); console.log('ok');

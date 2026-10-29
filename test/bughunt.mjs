import { chromium } from 'playwright';
const B = process.env.BASE || 'https://ace9x.github.io/truckers-gps/', SH = '/workspace/truckers-gps-shots/r4/hunt'; const out = [];
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [vn, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 900 }]]) {
  const ctx = await br.newContext({ viewport: vp, geolocation: { latitude: 40.7769, longitude: -73.874 }, permissions: ['geolocation'], isMobile: vn === 'mobile', hasTouch: vn === 'mobile' });
  for (const pg of ['', 'dispatch.html', 'privacy.html', 'terms.html']) {
    const p = await ctx.newPage(); const log = (k, m) => out.push(`[${vn}] ${pg || 'index'} ${k}: ${m}`);
    p.on('console', m => m.type() === 'error' && log('console', m.text().slice(0, 220))); p.on('pageerror', e => log('pageerror', e.message.slice(0, 220)));
    p.on('requestfailed', r => { if (!/tile|\.pbf|\.png|favicon/.test(r.url())) log('reqfail', r.url().slice(0, 140) + ' ' + r.failure()?.errorText); });
    p.on('response', r => { if (r.status() >= 400 && !/\.pbf|tile/.test(r.url())) log('http' + r.status(), r.url().slice(0, 160)); });
    await p.goto(B + pg + (pg ? '' : '?rrtest=1'), { waitUntil: 'load' }); await p.waitForTimeout(pg ? 2500 : 9000);
    const a11y = async tag => { const r = await p.evaluate(() => { const vis = e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
      const noName = [...document.querySelectorAll('button,a,[role=button],input,select')].filter(vis).filter(e => !((e.getAttribute('aria-label') || e.textContent || e.title || e.placeholder || e.value || (e.labels?.[0]?.textContent) || e.querySelector?.('img[alt]')?.alt || '').trim())).map(e => e.outerHTML.slice(0, 90));
      const imgs = [...document.querySelectorAll('img:not([alt])')].filter(vis).map(e => e.outerHTML.slice(0, 80));
      const over = document.documentElement.scrollWidth > innerWidth + 2 ? [`page width ${document.documentElement.scrollWidth} > ${innerWidth}`] : [];
      const small = [...document.querySelectorAll('button')].filter(vis).filter(e => { const b = e.getBoundingClientRect(); return (b.height < 24 || b.width < 24) && !e.closest('.maplibregl-ctrl-attrib'); }).map(e => (e.id || e.textContent.trim().slice(0, 20) || e.outerHTML.slice(0, 60)) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      const offscreen = [...document.querySelectorAll('button')].filter(vis).filter(e => { const b = e.getBoundingClientRect(); return b.right > innerWidth + 2 || b.left < -2; }).map(e => e.id || e.textContent.trim().slice(0, 20));
      return { noName, imgs, over, small, offscreen }; });
      for (const [k, v] of Object.entries(r)) for (const x of [...new Set(v)].slice(0, 12)) log(tag + ' ' + k, x); };
    await a11y('a11y'); await p.screenshot({ path: `${SH}/${vn}-${pg || 'index'}.png` });
    if (!pg) { const panels = await p.$$eval('#dock [data-panel]', b => b.map(x => x.dataset.panel));
      for (const id of panels) { await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#truckWiz')?.remove(); });
        const b = await p.$(`#dock [data-panel="${id}"]`); if (!(await b.isVisible())) { log('dock', id + ' button not visible'); continue; }
        try { await b.click({ timeout: 4000 }); } catch (e) { log('click', id + ': ' + e.message.split('\n').find(l => /intercepts|not visible|Timeout/.test(l))?.slice(0, 200)); continue; }
        await p.waitForTimeout(600); if (await p.$eval('#' + id, e => e.classList.contains('hidden')).catch(() => true)) log('panel', id + ' did not open');
        await a11y('panel ' + id); await p.screenshot({ path: `${SH}/${vn}-panel-${id}.png` }); }
      // other top-level buttons
      const tops = await p.$$eval('body > button[id], #topbar button[id], .fab[id], header button[id]', b => b.map(x => x.id)); log('info', 'top buttons ' + tops.join(','));
      for (const id of tops) { await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#truckWiz')?.remove(); });
        const b = await p.$('#' + id); if (!(await b.isVisible())) continue; try { await b.click({ timeout: 3000 }); await p.waitForTimeout(500); } catch (e) { log('click', id + ': ' + (e.message.split('\n').find(l => /intercepts|Timeout/.test(l)) || '').slice(0, 200)); } }
      await p.screenshot({ path: `${SH}/${vn}-after-buttons.png` }); }
    await p.close(); }
  await ctx.close(); }
await br.close(); console.log(out.join('\n') || 'no issues'); 

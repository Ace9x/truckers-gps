// Real-iPhone fit check (BUG-025…030): WebKit, iPhone 13 at 390x844 AND 390x664 (Safari's address bar + toolbar eat ~180 px).
// Fails on: text wrapping inside a button / menu item / tab, overlapping UI, anything clipped off-screen, a tab without an icon, duplicate map (i) buttons.
// Screens: ⋮ menu, bottom tabs, map, nav turn banner + lanes + alert, windshield (driving) view.  Usage: BASE=… OUT=dir node test/iphone-fit.mjs  (exit 1 on any FAIL)
import { webkit, chromium, devices } from 'playwright'; import fs from 'node:fs';
const BASE = process.env.BASE || 'https://ace9x.github.io/truckers-gps/', OUT = process.env.OUT || '/tmp/iphone-fit', TAG = process.env.TAG || '';
fs.mkdirSync(OUT, { recursive: true });
const br = await webkit.launch({ env: { ...process.env, ...(fs.existsSync('/opt/wklibs/gio') ? { GIO_EXTRA_MODULES: '/opt/wklibs/gio' } : {}) } }).catch(() => null) || await chromium.launch();
const res = []; const ok = (c, m, x) => { res.push({ ok: !!c, m, x }); console.log((c ? 'ok   ' : 'FAIL ') + m + (x && !c ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const AUDIT = () => { const vw = innerWidth, vh = innerHeight, out = { wrap: [], ov: [], clip: [] };
  const vis = e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && !e.closest('.hidden,[hidden],[aria-hidden=true]'); };
  const name = e => (e.id ? '#' + e.id : e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : e.tagName.toLowerCase()) + ' "' + (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28) + '"';
  // 1) wrapping: a control's own label must sit on one line (pseudo-element labels are measured by the label box height vs one line)
  const lines = el => { const r = document.createRange(); const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.data.trim() || n.parentElement.closest('.pi-t,svg')) continue; const pe = n.parentElement; if (getComputedStyle(pe).position === 'absolute' && pe.classList.contains('pi-t')) continue; r.selectNodeContents(n); for (const x of r.getClientRects()) if (x.width > 1) tops.add(Math.round(x.top / 4)); } return tops.size; };
  for (const e of document.querySelectorAll('#railMenu button,#dock button,#drive button,#navStack button,#banner button,[role=menuitem]')) { if (!vis(e)) continue;
    const L = lines(e), after = getComputedStyle(e, '::after'); let pseudoWrap = false;
    if (after.content && after.content !== 'none' && after.content !== 'normal') { const fs_ = parseFloat(after.fontSize) || 15, h = e.getBoundingClientRect().height; pseudoWrap = after.whiteSpace !== 'nowrap' && e.scrollHeight > h + 2 || after.whiteSpace !== 'nowrap' && e.getBoundingClientRect().width < (after.content.length - 2) * fs_ * 0.5 + 56; }
    if (L > 1 || pseudoWrap) out.wrap.push(name(e) + (pseudoWrap ? ' (label)' : ` (${L} lines)`)); }
  // 2) icon present on every bottom tab
  out.noIcon = [...document.querySelectorAll('#dock button')].filter(vis).filter(b => !b.querySelector('svg') || [...b.querySelectorAll('svg')].every(s => s.getBoundingClientRect().width < 8)).map(name);
  // 3) overlap + clip among the things a driver sees
  const SEL = '#railMenu,#tfBanner,#dock button,#sideBtns .round,#searchBtn,#truckChip,#banner,#lanes,#alerts .alert,#thenBox,#speedBox,#limitSign,#tripBar,#navStack button,#dTurn,#dExit,#dStreet,#dDist,#dMid>*,#dBtns button,#hzLive,#tfLegend,.maplibregl-ctrl-attrib,.maplibregl-ctrl-attrib-button,.maplibregl-ctrl-scale,.maplibregl-marker,#hzBanner';
  const els = [...document.querySelectorAll(SEL)].filter(vis);
  for (const e of els) { const b = e.getBoundingClientRect(); const marker = e.classList.contains('maplibregl-marker');
    if (marker && (b.right < 0 || b.left > vw || b.bottom < 0 || b.top > vh)) continue; // a pin fully off the map is fine
    if (b.left < -1 || b.right > vw + 1 || b.top < -1 || b.bottom > vh + 1) out.clip.push(name(e) + ` [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`); }
  const under = (a, b) => { const za = a.closest('#railMenu') ? 99 : 0; return za; };
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
    if (a.closest('#railMenu') || b.closest('#railMenu')) { const m = a.closest('#railMenu') ? a : b, o = m === a ? b : a; if (!o.matches('#sideBtns .round,#searchBtn,#truckChip')) continue; if (m.closest('#railMenu').getBoundingClientRect().width >= vw - 24 && /0px 0px 0px \d{3,}/.test(getComputedStyle(m.closest('#railMenu')).boxShadow)) continue; } // a full-width sheet with a backdrop covers the map on purpose // the open menu may cover the map, not the controls it belongs with
    if (a.matches('#dDist,#dStreet') && b.matches('#dDist,#dStreet')) continue; const mk = e => e.classList.contains('maplibregl-marker'); if (mk(a) !== mk(b)) continue; const off = e => { const q = e.getBoundingClientRect(); return q.right <= 0 || q.bottom <= 0 || q.left >= vw || q.top >= vh; }; if (off(a) || off(b)) continue;
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(), w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
    const strict = [a, b].some(e => e.matches('#lanes,#dTurn,#banner,#dExit,#alerts .alert,#hzBanner')); if (strict ? w > 0.5 && h > 0.5 : w > 3 && h > 3) { const ta = document.elementFromPoint(Math.max(x.left, y.left) + w / 2, Math.max(x.top, y.top) + h / 2); out.ov.push(`${name(a)} × ${name(b)} (${Math.round(w)}x${Math.round(h)})`); } }
  // 4) covered: lane bar, alerts and the turn text must be on top where they are drawn (catches z-order cover-ups a box test misses)
  out.covered = []; for (const e of document.querySelectorAll('#lanes,#alerts .alert,#dDist,#dStreet,#bDist,#bInstr,#dExit')) { if (!vis(e)) continue; const b = e.getBoundingClientRect(); const pe = []; for (let x = e; x && x !== document.body; x = x.parentElement) { pe.push([x, x.style.pointerEvents]); x.style.setProperty('pointer-events', 'auto', 'important'); }
    const ix = Math.min(14, b.width / 3), iy = Math.min(10, b.height / 3); const pts = [[b.left + ix, b.top + iy], [b.right - ix, b.top + iy], [b.left + b.width / 2, b.top + b.height / 2], [b.left + ix, b.bottom - iy], [b.right - ix, b.bottom - iy]];
    const bad = pts.filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh).filter(([x, y]) => { const t = document.elementFromPoint(x, y); return t && !e.contains(t) && !t.contains(e) && !t.closest('#toast,.maplibregl-marker'); });
    if (bad.length) out.covered.push(name(e) + ' under ' + name(document.elementFromPoint(...bad[0]))); pe.forEach(([x, v]) => x.style.pointerEvents = v); }
  out.attribButtons = [...document.querySelectorAll('.maplibregl-ctrl-attrib-button,.maplibregl-ctrl-attrib')].filter(vis).filter(e => e.matches('.maplibregl-ctrl-attrib-button') || !e.querySelector('.maplibregl-ctrl-attrib-button')).length;
  out.ibuttons = [...document.querySelectorAll('.maplibregl-ctrl-attrib-button')].filter(vis).map(e => { const c = getComputedStyle(e), b = e.getBoundingClientRect(); return c.backgroundRepeat.startsWith('no-repeat') || b.height <= 26 && b.width <= 26 ? 1 : 2; }).reduce((a, b) => a + b, 0) + [...document.querySelectorAll('.maplibregl-ctrl-attrib:not(.maplibregl-compact)')].filter(vis).length;
  return out; };
for (const [vp, label] of [[{ width: 390, height: 664 }, '390x664 (Safari bars)'], [{ width: 390, height: 844 }, '390x844']]) {
  const ctx = await br.newContext({ ...devices['iPhone 13'], locale: 'en-US', viewport: vp, permissions: ['geolocation'], geolocation: { latitude: 40.6560, longitude: -73.7680 } });
  await ctx.addInitScript(() => { localStorage.setItem('tn_locWhySeen', '1'); localStorage.setItem('tn_lang', '"en"'); Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForFunction(() => window.TruckNav?.map?.loaded?.(), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(3500);
  const sk = await p.$('#tSkip'); if (sk) { const b = await sk.boundingBox(); if (b) await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(1500); }
  await p.evaluate(() => { const v = document.querySelector('#vehSel'); if (v) { v.value = 'semi'; v.dispatchEvent(new Event('change', { bubbles: true })); v.dispatchEvent(new Event('input', { bubbles: true })); } }); await p.waitForTimeout(800); // a real semi profile (Fan's truck)
  await p.evaluate(() => { document.querySelectorAll('#splash,.wiz,#wizard,.onb,#tour,.tour,.hs-sheet,#helpSheet').forEach(x => x.remove()); document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); });
  const v = vp.height, shot = n => p.screenshot({ path: `${OUT}/${TAG}${v}-${n}.png` });
  const check = async where => { const r = await p.evaluate(AUDIT); ok(!r.wrap.length, `[${label}] ${where}: no text wrapping inside buttons/menu items`, r.wrap); ok(!r.ov.length, `[${label}] ${where}: nothing overlaps`, r.ov); ok(!r.clip.length, `[${label}] ${where}: nothing clipped off-screen`, r.clip); ok(!r.covered.length, `[${label}] ${where}: lanes, alerts and turn text not covered`, r.covered); return r; };
  // map + tabs
  await p.waitForTimeout(500); let r = await check('map + tabs'); ok(!r.noIcon.length, `[${label}] every bottom tab has an icon`, r.noIcon); ok(r.ibuttons <= 1, `[${label}] one map info (i) button, not ${r.ibuttons}`); await shot('1-map-tabs');
  // ⋮ menu
  const more = await p.$('#moreBtn'); if (more) { const b = await more.boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(500); }
  ok(await p.evaluate(() => !!document.querySelector('#railMenu:not(.hidden)')), `[${label}] ⋮ menu opens`); await check('⋮ menu'); await shot('2-menu');
  await p.evaluate(() => document.querySelector('#railMenu')?.classList.add('hidden'));
  // nav: route + banner + lanes + an alert (the layout from Fan's 12:02 AM screenshot)
  const routed = await p.evaluate(async () => { const S = window.TruckNav; S.setDest({ lon: -73.7413, lat: 40.6231, name: 'Inwood, NY' }); for (let i = 0; i < 90 && !S.route; i++) await new Promise(r => setTimeout(r, 500)); if (!S.route) return false; S.startNav(); await new Promise(r => setTimeout(r, 2500)); return true; });
  ok(routed, `[${label}] route + navigation start`);
  const fill = () => p.evaluate(() => { const L = document.querySelector('#lanes'); if (L) { L.innerHTML = '<span class="ln">↰</span><span class="ln on">↑</span><span class="ln on">↑</span>'; L.classList.remove('hidden'); }
    const bi = document.querySelector('#bInstr'), dS = document.querySelector('#dStreet'), dD = document.querySelector('#dDist'), bD = document.querySelector('#bDist'); if (bi) bi.textContent = 'Turn left onto Nassau Expressway'; if (dS) dS.textContent = 'Nassau Expressway'; if (dD) dD.textContent = '0.5 mi'; if (bD) bD.textContent = '0.5 mi';
    const a = document.querySelector('#alerts'); if (a && !a.querySelector('[data-fit]')) { a.insertAdjacentHTML('beforeend', '<div class="alert warn" data-fit>⚠ Sharp curve 97° · 0.2 mi</div><div class="alert warn" data-fit>⚠ Off NYC truck route — return to a designated route</div>'); } });
  await fill(); await p.waitForTimeout(600); await check('nav turn banner + lanes + alerts'); await shot('3-nav');
  await p.evaluate(() => window.TruckNav.setDrive?.(true)); await fill(); await p.waitForTimeout(700); await check('windshield (driving) view'); await shot('4-driving');
  ok(!errs.length, `[${label}] no page errors`, errs);
  await p.evaluate(() => { window.TruckNav.setDrive?.(false); window.TruckNav.endNav?.(); }).catch(() => {}); await ctx.close(); }
await br.close(); fs.writeFileSync(`${OUT}/${TAG}iphone-fit.json`, JSON.stringify(res, null, 1));
const bad = res.filter(x => !x.ok); console.log(bad.length ? `IPHONE-FIT FAIL (${bad.length})` : 'IPHONE-FIT PASS'); process.exit(bad.length ? 1 : 0);

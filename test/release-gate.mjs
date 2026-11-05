// RigRoute release gate. Run against the LIVE site after every deploy:  BASE=https://ace9x.github.io/truckers-gps/ node test/release-gate.mjs
// (a) tap-through of every panel at phone sizes: labels do what they say, no overlap/clipping between controls, screenshots
// (b) five real truck routes end to end (NYC local, highway, low clearance, multi-stop, reroute offer via TEST-ONLY mock)
// (c) zero console errors from the app (outside public Nostr relays are listed separately)  (d) report file in /workspace/rigroute/qa/<version>/
// WebKit: used when the host has its system libraries (GATE_WEBKIT=1); otherwise Chromium with the iPhone profile, noted in the report.
import { chromium, webkit, devices } from 'playwright'; import fs from 'node:fs';
const BASE = process.env.BASE || 'https://ace9x.github.io/truckers-gps/';
const sw = await (await fetch(BASE + 'sw.js', { cache: 'no-store' })).text(); const VER = sw.match(/tn-v([\d.]+)/)?.[1] || 'unknown';
const OUT = process.env.OUT || `/workspace/rigroute/qa/${VER}`; fs.mkdirSync(OUT, { recursive: true });
const R = { version: VER, base: BASE, started: new Date().toISOString(), runs: [] };
let wk = null; if (process.env.GATE_WEBKIT) { try { wk = await webkit.launch({ env: { ...process.env, ...(fs.existsSync('/opt/wklibs/gio') ? { GIO_EXTRA_MODULES: '/opt/wklibs/gio' } : {}) } }); /* QA box: TLS module unpacked from Debian glib-networking */ R.webkitNote = 'iPhone run uses real WebKit (Playwright ' + wk.version() + ').'; } catch (e) { R.webkitNote = 'WebKit unavailable: ' + e.message.split('\n')[0]; } } else R.webkitNote = 'WebKit system libraries missing on the QA box (Debian mirror down); iPhone run uses Chromium with the iPhone 13 profile at 390x844.';
const ch = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const PROFILES = [
  { name: 'iphone', engine: wk ? 'webkit' : 'chromium', br: wk || ch, dev: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  { name: 'pixel7', engine: 'chromium', br: ch, dev: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } } }];
const EXTERNAL = /relay\.|nos\.lol|damus|nostr|wss:\/\/|tile|openfreemap|overpass|photon|valhalla|nominatim|geojs|tomtom|ERR_INTERNET_DISCONNECTED|preconnect|esm\.sh/i;

for (const P of PROFILES) {
  const run = { profile: P.name, engine: P.engine, checks: [], overlaps: [], small: [], errors: [], external: [], shots: [] }; R.runs.push(run);
  const ok = (c, m, extra) => { run.checks.push({ ok: !!c, m, extra }); console.log((c ? 'ok   ' : 'FAIL ') + `[${P.name}] ` + m + (extra && !c ? ' ' + JSON.stringify(extra).slice(0, 300) : '')); };
  const ctx = await P.br.newContext({ ...P.dev, bypassCSP: true /* lets the gate inject axe-core */, permissions: ['geolocation'], geolocation: { latitude: 40.7506, longitude: -73.9935 } });
  await ctx.addInitScript(() => { localStorage.setItem('tn_locWhySeen', '1'); Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); }); // real first run: the app skips onboarding for automation
  const p = await ctx.newPage();
  p.on('pageerror', e => run.errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() !== 'error') return; const t = m.text() + ' ' + (m.location()?.url || ''); (EXTERNAL.test(t) ? run.external : run.errors).push(t.slice(0, 300)); });
  const shot = async n => { const f = `${OUT}/${P.name}-${n}.png`; await p.screenshot({ path: f }); run.shots.push(f); };
  const ev = (f, a) => p.evaluate(f, a);
  const tap = async sel => { const el = await p.$(sel); if (!el) return false; await el.scrollIntoViewIfNeeded().catch(() => {}); const b = await el.boundingBox(); if (!b) return false; await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(350); return true; };
  // layout audit of what is on screen now: overlapping controls, clipped controls, tap targets < 44px
  const audit = async (where) => { const r = await ev(() => { const vw = innerWidth, out = { ov: [], clip: [], small: [] };
      const root = document.querySelector('#helpSheet, .hs-sheet') || document.querySelector('.panel:not(.hidden)') || document.body;
      const els = [...root.querySelectorAll('button,a[href],input,select,textarea,summary,[role=button],#hzLive,#tfLegend')].filter(e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && e.type !== 'hidden' && !e.closest('[hidden],details:not([open]) > :not(summary)') && !(e.style.position === 'absolute' && b.left < -1000) && (() => { const cx = Math.min(innerWidth - 1, Math.max(0, b.left + b.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, b.top + b.height / 2)), t = document.elementFromPoint(cx, cy); return e.matches('#hzLive,#tfLegend') || !t || e.contains(t) || t.contains(e) || t.closest('label')?.contains(e) || b.top > innerHeight || b.bottom < 0; })(); }); // only controls a finger can actually reach (covered ones are behind a sheet)
      const name = e => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + ' "' + (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.type || '').trim().slice(0, 24) + '"';
      for (const e of els) { const b = e.getBoundingClientRect(); if (b.right > vw + 1 || b.left < -1) out.clip.push(name(e));
        const tgt = e.tagName === 'INPUT' && /checkbox|radio/.test(e.type) ? (e.closest('label') || e) : e, tb = tgt.getBoundingClientRect(); const inlineLink = e.tagName === 'A' && getComputedStyle(e).display === 'inline'; /* WCAG 2.5.8 exempts links inside a sentence */ if (!inlineLink && (tb.height < 44 || tb.width < 44) && !e.closest('.maplibregl-ctrl,.maplibregl-popup')) out.small.push(name(e) + ` ${Math.round(tb.width)}x${Math.round(tb.height)}`); }
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a) || a.closest('label')?.contains(b) || b.closest('label')?.contains(a)) continue;
        let best = null; for (const x of a.getClientRects()) for (const y of b.getClientRects()) { const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top); if (w > 3 && h > 3) best = [w, h]; }
        if (best) out.ov.push(`${name(a)} × ${name(b)} (${Math.round(best[0])}x${Math.round(best[1])})`); }
      return out; });
    run.overlaps.push(...r.ov.map(x => where + ': ' + x)); run.small.push(...r.small.map(x => where + ': ' + x));
    ok(!r.ov.length, `${where}: no overlapping controls`, r.ov); ok(!r.clip.length, `${where}: no clipped controls`, r.clip); };
  const openPanel = async id => { await ev(id => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); const b = document.querySelector(`[data-panel=${id}]`) || document.querySelector('#' + id.replace('Panel', 'Btn')); b?.click(); }, id); await p.waitForTimeout(700); return ev(id => !document.getElementById(id)?.classList.contains('hidden'), id); };
  const close = () => ev(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelectorAll('#helpSheet,.hs-sheet,#walkCard,#walkRing').forEach(x => x.remove()); });

  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  if (await p.$('#langFirst [data-l="en"]')) await tap('#langFirst [data-l="en"]'); await p.waitForTimeout(600);
  ok(!!await p.$('#tourCard, #tSkip'), 'first-run tour appears'); if (await p.$('#tSkip')) await tap('#tSkip'); await p.waitForTimeout(4000);
  await shot('00-map'); await audit('map screen');
  const axe = async where => { await p.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' }).catch(() => {}); const v = await ev(async () => { const r = await window.axe.run(document.querySelector('.panel:not(.hidden)') || document, { runOnly: ['color-contrast', 'button-name', 'label', 'link-name', 'image-alt', 'aria-valid-attr-value'] }); return r.violations.map(v => v.id + ': ' + v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(', ')); }).catch(e => ['axe error ' + e.message]);
    (run.a11y ||= []).push(...v.map(x => where + ': ' + x)); ok(!v.length, `${where}: accessibility (contrast AA, labels, names)`, v); };
  await axe('map screen');

  // HOS: each duty button sets + highlights exactly its status; timers + log follow (BUG-001)
  ok(await openPanel('hosPanel'), 'HOS opens'); await shot('01-hos');
  for (const d of ['off', 'sb', 'on', 'drive', 'sb', 'off']) { await tap(`[data-duty="${d}"]`); const st = await ev(() => ({ on: [...document.querySelectorAll('[data-duty].on')].map(x => x.dataset.duty), last: JSON.parse(localStorage.tn_hos || '[]').at(-1)?.s, status: window.TruckNav.hos?.status, log: document.querySelector('#hosLog li')?.textContent || '' }));
    const L = { off: 'Off duty', sb: 'Sleeper', on: 'On duty', drive: 'Driving' }[d]; ok(st.on.length === 1 && st.on[0] === d && st.last === d && st.status === d && st.log.includes(L), `HOS tap "${L}" sets+highlights ${d}, log says ${L}`, st); }
  await tap('[data-duty="off"]'); // double tap does not add twice
  const nOff = await ev(() => JSON.parse(localStorage.tn_hos).length); await tap('[data-duty="off"]'); ok(await ev(() => JSON.parse(localStorage.tn_hos).length) === nOff, 'HOS: double-tap does not log twice');
  await audit('HOS'); await axe('HOS'); await close();

  // Truck setup persists across reload
  await ev(() => { const S = window.TruckNav; S.truck = { ...S.truck, heightFt: 13, heightIn: 6, weightLbs: 80000 }; localStorage.tn_truck = JSON.stringify(S.truck); });
  ok(await openPanel('truckPanel'), 'Truck panel opens'); await shot('02-truck'); await audit('Truck'); await close();
  ok(await openPanel('routePanel'), 'Route panel opens'); await shot('03-route'); await audit('Route'); await axe('Route');
  { const h0 = await ev(() => document.querySelector('#hazBtn')?.textContent); await tap('#hazBtn'); const h1 = await ev(() => document.querySelector('#hazBtn')?.textContent); ok(h0 !== h1 && /on|off/i.test(h1), `Hazmat toggle flips label (${h0} → ${h1})`); await tap('#hazBtn'); }
  { const w0 = await ev(() => document.querySelector('#weighBtn')?.textContent); await tap('#weighBtn'); const w1 = await ev(() => document.querySelector('#weighBtn')?.textContent); ok(w0 !== w1, `Avoid scales toggle flips label (${w0} → ${w1})`); await tap('#weighBtn'); }
  await close();
  ok(await openPanel('loadPanel'), 'Load panel opens'); await shot('04-load'); await audit('Load'); await close();
  await close(); await ev(() => document.querySelector('#reportBtn').click()); await p.waitForTimeout(700); ok(await ev(() => !!document.querySelector('#hzX, .panel#reportPanel:not(.hidden)')), 'Report (📣) opens the hazard picker'); await shot('05-report'); await audit('Report'); await ev(() => document.querySelector('#hzX')?.click()); await close();
  // Multi-stop sheet (BUG-002)
  await ev(() => document.querySelector('#plannerBtn')?.click()); await p.waitForTimeout(700); ok(await ev(() => !document.querySelector('#plannerPanel')?.classList.contains('hidden')), 'Multi-stop opens');
  ok(await ev(() => { const b = document.querySelector('#plOpt'), s = document.querySelector('#plSum'); const bt = b.textContent.replace(/[^A-Za-z ]/g, '').trim(); return !/Optimize/.test(s.textContent) || s.textContent.includes(bt); }), 'Multi-stop hint names the real button');
  ok(await ev(() => ['plLF', 'plLL', 'plRTS'].every(id => { const i = document.getElementById(id), l = i.closest('label'), a = i.getBoundingClientRect(), t = l.getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (t.top + t.bottom) / 2) < 6; })), 'Multi-stop checkboxes sit inline with their labels');
  for (const id of ['plLF', 'plLL', 'plRTS']) { const before = await ev(id => document.getElementById(id).checked, id); await tap(`label:has(#${id})`); ok(await ev(id => document.getElementById(id).checked, id) !== before, `Multi-stop "${id}" label tap toggles`); await tap(`label:has(#${id})`); }
  await shot('06-multistop'); await audit('Multi-stop'); await axe('Multi-stop'); await close();
  // Friends / Loads chips
  for (const [b, n] of [['#friendsBtn', 'Friends'], ['#loadsBtn', 'Loads']]) { await ev(b => document.querySelector(b)?.click(), b); await p.waitForTimeout(1500); ok(await ev(() => !!document.querySelector('.panel:not(.hidden)')), `${n} opens`); ok(!/sign in|sign up|create account/i.test(await ev(() => document.querySelector('.panel:not(.hidden)')?.innerText || '')), `${n}: no sign-in prompt`); await shot('07-' + n.toLowerCase()); await audit(n); await close(); }
  // Me: settings, Report a Bug (validation), What's New, Help RigRoute grow
  ok(await openPanel('mePanel'), 'Me opens'); await shot('08-me'); await audit('Me'); await axe('Me');
  await ev(() => { document.querySelector('#bugBox').open = true; }); await p.fill('#bugDesc', ''); await tap('#bugSend'); ok(/at least 5/.test(await p.textContent('#bugMsg')), 'Report a Bug: empty text is refused with a clear message');
  await ev(() => { document.querySelector('#wnBox') && (document.querySelector('#wnBox').open = true); }); await p.waitForTimeout(300); ok(await ev(() => (document.querySelector('#wnList')?.children.length || 0) > 0), "What's New lists entries");
  { const g = await p.$('#areaOptChk'); if (g) { const v0 = await g.isChecked(); await g.click(); await p.reload(); await p.waitForTimeout(3500); await openPanel('mePanel'); const g2 = await p.$('#areaOptChk'); ok(g2 && (await g2.isChecked()) !== v0, 'Help RigRoute grow toggle persists after reload'); await g2.click(); } else ok(false, 'Help RigRoute grow toggle found'); }
  await close();
  // Help sheet: Ask RigRoute + Show me around
  await ev(() => document.querySelector('[data-panel=routePanel]').click()); await p.waitForTimeout(500); await ev(() => document.querySelector('.panel:not(.hidden) .help-q')?.click()); await p.waitForTimeout(500);
  ok(!!await p.$('.hs-q'), 'Help sheet opens with Ask RigRoute box'); await shot('09-help'); await audit('Help sheet');
  await p.fill('.hs-q', 'how do I add a stop'); await ev(() => document.querySelector('.hs-ask').requestSubmit()); await p.waitForFunction(() => document.querySelector('.hs-a')?.textContent.length > 5, null, { timeout: 25000 }).catch(() => {}); ok((await p.textContent('.hs-a')).length > 10, 'Ask RigRoute answers: ' + (await p.textContent('.hs-a')).slice(0, 80));
  await ev(() => document.querySelector('.hs-walk')?.click()); await p.waitForTimeout(700); ok(!!await p.$('#walkCard'), 'Show me around starts'); await shot('10-walk'); await audit('Show me around'); await tap('#walkStop'); ok(!await p.$('#walkCard'), 'Show me around Stop closes it'); await close();

  // (b) five routes
  const route = (dest, extra = {}) => ev(async ([dest, extra]) => { const S = window.TruckNav; S.stops = extra.stops || []; localStorage.tn_stops = JSON.stringify(S.stops); if (extra.pos) S.pos = { ...S.pos, ...extra.pos }; S.route = null; S.setDest(dest);
      for (let i = 0; i < 180 && !S.route; i++) { await new Promise(r => setTimeout(r, 500)); if (i === 90 && !S.route) S.plan?.(); } const r = S.route; return r ? { km: +(r.length / 1000).toFixed(1), min: Math.round(r.time / 60), warn: (r.warnings || []).length } : null; }, [dest, extra]);
  const r1 = await route({ lon: -73.9442, lat: 40.6782, name: 'Crown Heights, Brooklyn' }); ok(r1 && r1.km > 3, 'Route 1 NYC local truck route ' + JSON.stringify(r1));
  const r2 = await route({ lon: -75.1652, lat: 39.9526, name: 'Philadelphia, PA' }); ok(r2 && r2.km > 120, 'Route 2 highway NYC→Philadelphia ' + JSON.stringify(r2));
  const r3 = await ev(async () => { const S = window.TruckNav; S.truck = { ...S.truck, heightFt: 14, heightIn: 0 }; S.route = null; S.stops = []; S.setDest({ lon: -73.8648, lat: 40.8501, name: 'Bronx (parkway corridor)' }); for (let i = 0; i < 90 && !S.route; i++) await new Promise(r => setTimeout(r, 500)); const r = S.route; return r ? { km: +(r.length / 1000).toFixed(1), parkway: (r.maneuvers || r.steps || []).some(m => /parkway|pkwy/i.test(m.street || m.name || m.instruction || '')) } : null; });
  ok(r3 && !r3.parkway, 'Route 3 low clearance (14 ft rig): route found and no parkway (NYC parkways have low bridges) ' + JSON.stringify(r3));
  const r4 = await route({ lon: -74.1724, lat: 40.7357, name: 'Newark, NJ' }, { stops: [{ lat: 40.7282, lon: -74.0776, name: 'Jersey City' }] }); ok(r4 && r4.km > 15, 'Route 4 multi-stop via Jersey City ' + JSON.stringify(r4));
  const r5 = await ev(async () => { const S = window.TruckNav, T = S.traffic; const ov = S.valhalla, ort = T.routeTraffic, orem = S.remT; const alt = { ...S.route, time: S.route.time - 600, length: S.route.length - 1500, _mock: true };
    S.valhalla = async () => [alt]; T.routeTraffic = () => ({ delay: 0, slowdowns: [], sources: [], coverage: 0, newest: 0 }); S.remT = S.route.time + 1200; S.trafficDelay = 0; // TEST-ONLY mock: production code unchanged
    await T.suggest({ delay: 1200, slowdowns: [] }); const b = document.querySelector('#tfBanner'); const offered = !!b && /Faster/.test(b.textContent); [...(b?.querySelectorAll('button') || [])].find(x => x.textContent === 'Switch')?.click(); await new Promise(r => setTimeout(r, 600));
    S.valhalla = ov; T.routeTraffic = ort; S.remT = orem; return { offered, switched: S.routes?.[0]?._mock === true }; });
  ok(r5.offered && r5.switched, 'Route 5 reroute offer shown and Switch takes it ' + JSON.stringify(r5));
  await shot('11-route-done');
  // Hazard pin votes as a guest (pin made by another device; note marks it as gate data for cleanup)
  const nE = run.errors.length; const hv = await ev(async () => { const S = window.TruckNav, c = await (await import('./js/cloud.js')).sb(); const other = 'gate-' + crypto.randomUUID().slice(0, 12);
    const { data } = await c.rpc('guest_report_hazard', { p_device: other, p_type: 'hazard', p_lat: 40.70 + Math.random() / 50, p_lng: -73.95 + Math.random() / 50, p_note: '[automated gate test]' });
    await S.backend.listReports().then(l => { S.reports = l; S.drawReports(); }); const r = data ? S.reports.find(x => x.id === data.id) : S.reports.find(x => x.server && !x.mine && !x.voted); if (!r) return { err: 'no pin to vote on (report RPC refused: ' + JSON.stringify(data) + ')' };
    await S.vote(r, 'up'); const after = (await S.backend.listReports()).find(x => x.id === r.id); /* re-read: a background refresh may replace S.reports mid-vote */ let again = null; try { await S.backend.vote(r.id, 'up'); } catch (e) { again = e.message; }
    return { up: after?.up, voted: after?.voted, again }; });
  await p.waitForTimeout(300); run.errors.splice(nE, run.errors.length - nE, ...run.errors.slice(nE).filter(e => !/status of 400.*guest_vote_hazard/.test(e))); /* the deliberate second vote is refused with 400 */ ok(hv.up >= 1 && hv.voted === 'up' && /already voted/.test(hv.again || ''), 'Hazard pin: 👍 Still there works once per device ' + JSON.stringify(hv));
  // ===== Edge cases (permanent) =====
  const LONG = 'Truck stop near exit 12 '.repeat(209).slice(0, 5000), EMOJI = '🚛💨 Pilot ⛽️ 👍🏽 near 🌉 exit 🧊', RTL = 'מחסן ראשי · مستودع الشحن الرئيسي';
  { const fields = ['#q', '#stopQ', '#plQ', '#plName', '#plPaste', '#pNameIn', '#bugDesc', '#bugPage', '#bugContact', '#facNotes', '.hs-q'];
    for (const sel of fields) for (const [kind, val] of [['5k chars', LONG], ['emoji', EMOJI], ['RTL', RTL]]) { const nE0 = run.errors.length;
      const r = await ev(async ([sel, val]) => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#helpSheet')?.remove();
        if (sel === '.hs-q') { document.querySelector('[data-panel=routePanel]')?.click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('.panel:not(.hidden) .help-q')?.click(); await new Promise(r => setTimeout(r, 300)); }
        let el = document.querySelector(sel); if (!el) return { missing: true }; const pn = el.closest('.panel'); if (pn) pn.classList.remove('hidden'); el.closest('details')?.setAttribute('open', '');
        el.focus(); el.value = ''; if (!document.execCommand('insertText', false, val)) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } /* real typing/paste path: maxlength applies */ el.dispatchEvent(new Event('change', { bubbles: true }));
        if (el.type === 'search' || sel === '#q') el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise(r => setTimeout(r, 1500)); const box = el.closest('.panel,#helpSheet') || document.body, ml = +el.getAttribute('maxlength') || 0;
        const wide = [...box.querySelectorAll('*')].filter(x => { const b = x.getBoundingClientRect(); return b.width && b.right > innerWidth + 2 && getComputedStyle(x).position !== 'fixed' && !x.closest('.maplibregl-map'); }).slice(0, 3).map(x => (x.id ? '#' + x.id : x.tagName + '.' + x.className).slice(0, 40));
        return { len: el.value.length, ml, page: document.documentElement.scrollWidth <= innerWidth + 1, wide, dirOk: !/[\u0590-\u06FF]/.test(val) || el.dir === 'auto' || getComputedStyle(el).direction === 'rtl' || el.getAttribute('dir') === 'auto' }; }, [sel, val]);
      if (r.missing) { if (kind === 'RTL') ok(true, `${sel}: not on this screen (skipped)`); continue; }
      ok(r.page && !r.wide.length && (!r.ml || r.len <= r.ml) && run.errors.length === nE0, `Edge input ${sel} · ${kind}: no crash, no sideways overflow${r.ml ? ', capped at ' + r.ml : ''}`, r);
      if (kind === 'RTL') ok(r.dirOk, `Edge input ${sel} · RTL text reads right-to-left (dir=auto)`, r);
      await ev(sel => { const el = document.querySelector(sel); if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } }, sel); }
    await shot('15-edge-inputs'); await close(); }
  // Back button closes sheets/panels instead of leaving the app
  for (const [n, open, isOpen] of [['panel (Me)', () => openPanel('mePanel'), () => ev(() => !!document.querySelector('.panel:not(.hidden)'))],
    ['Help sheet', async () => { await openPanel('routePanel'); await ev(() => document.querySelector('.panel:not(.hidden) .help-q')?.click()); }, () => ev(() => !!document.querySelector('#helpSheet'))],
    ['Report sheet', () => ev(() => document.querySelector('#reportBtn')?.click()), () => ev(() => !!document.querySelector('#hzSheet'))]]) {
    await close(); await p.waitForTimeout(300); await open(); await p.waitForTimeout(700); const was = await isOpen(); const url0 = p.url();
    await p.goBack({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(700); const still = p.url() === url0 && await ev(() => !!document.querySelector('#meBtn')).catch(() => false);
    const top = await ev(() => !!document.querySelector('#helpSheet, #hzSheet') ).catch(() => true); const shut = !(await isOpen().catch(() => true)) && (n !== 'Help sheet' || !top);
    ok(was && still && shut, `Back button closes the ${n} and stays in the app`, { was, still, shut, url: p.url() }); await close(); }
  // Double / triple taps
  { const cnt = {}; const onReq = r => { const u = r.url(); for (const k of ['ask-rigroute', 'guest_report_hazard', 'bug_reports', 'bug-shots']) if (u.includes(k) && r.method() === 'POST') cnt[k] = (cnt[k] || 0) + 1; }; p.on('request', onReq);
    const tri = async sel => { const el = await p.$(sel); await el?.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300); const b = el && await el.boundingBox(); if (!b) return false; for (let i = 0; i < 3; i++) await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); return true; };
    // Ask: triple tap the send button → one question
    await openPanel('routePanel'); await ev(() => document.querySelector('.panel:not(.hidden) .help-q')?.click()); await p.waitForTimeout(400);
    await p.fill('.hs-q', 'how do I report a hazard'); await tri('.hs-ask button'); await p.waitForFunction(() => document.querySelector('.hs-a')?.textContent.length > 5, null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(500);
    ok((cnt['ask-rigroute'] || 0) === 1 && (await p.textContent('.hs-a')).length > 10, 'Ask: triple tap sends one question and answers', cnt); await close();
    // Multi-stop: triple tap Best order / Clear → no stuck state, no error
    await ev(() => document.querySelector('#plannerBtn')?.click()); await p.waitForTimeout(500); const nE1 = run.errors.length; await tri('#plOpt'); await p.waitForTimeout(1200); await tri('#plClear'); await p.waitForTimeout(800);
    ok(run.errors.length === nE1 && await ev(() => !document.querySelector('#plOpt').disabled && !/…/.test(document.querySelector('#plOpt').textContent)), 'Multi-stop: triple tap Best order / Clear leaves no stuck state'); await close();
    p.off('request', onReq); R.multiTap = { ...(R.multiTap || {}), [P.name]: cnt }; }
  // Report a Bug with a real screenshot, end to end, triple-tapped; then the gate deletes the stored file and the row
  { const token = crypto.randomUUID(), shotFile = `${OUT}/${P.name}-00-map.png`; await openPanel('mePanel'); await ev(() => { document.querySelector('#bugBox').open = true; localStorage.removeItem('tn_bugLast'); });
    await p.fill('#bugDesc', `[automated gate test] ${token} screenshot upload e2e (${P.name}) — safe to delete`); await p.setInputFiles('#bugShot', shotFile);
    const bs = await p.$('#bugSend'); await bs.scrollIntoViewIfNeeded(); await p.waitForTimeout(400); const b = await bs.boundingBox(); for (let i = 0; i < 3; i++) await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForFunction(() => /Thanks|failed|wait|reach/i.test(document.querySelector('#bugMsg')?.textContent || ''), null, { timeout: 45000 }).catch(() => {}); const msg = await p.textContent('#bugMsg'); await shot('16-bug-sent');
    const cfg = await ev(async () => { const { SUPABASE } = await import('./js/config.js'); return SUPABASE; });
    const cl = await (await fetch(cfg.url + '/functions/v1/gate-cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey }, body: JSON.stringify({ token }) })).json().catch(e => ({ error: String(e) }));
    ok(/Thanks/.test(msg) && cl.rows === 1 && cl.files?.length === 1 && cl.filesLeft === 0, `Report a Bug: screenshot uploads end to end, triple tap sends one report, gate then deleted file + row (${msg.slice(0, 40)}) ${JSON.stringify(cl)}`); await close(); }
  // Throttled 3G (~400 kbps, 400 ms): route planning, Ask, Report
  { let cdp = null; if (P.engine === 'chromium') { cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8 }); }
    else await ctx.route('**', async r => { await new Promise(x => setTimeout(x, 400)); await r.continue().catch(() => {}); }); // WebKit has no CDP: same 400 ms latency per request
    const nE3 = run.errors.length; const t0 = Date.now(); const g = await route({ lon: -73.9442, lat: 40.6782, name: 'Crown Heights, Brooklyn' }); ok(g && g.km > 3, `3G: route planning still works (${Math.round((Date.now() - t0) / 1000)} s) ` + JSON.stringify(g));
    await openPanel('routePanel'); await ev(() => document.querySelector('.panel:not(.hidden) .help-q')?.click()); await p.waitForTimeout(600);
    await p.fill('.hs-q', 'how do I save maps for no signal'); await ev(() => document.querySelector('.hs-ask').requestSubmit()); await p.waitForTimeout(300); const busy = await p.textContent('.hs-a');
    await p.waitForFunction(() => document.querySelector('.hs-a')?.textContent.length > 10, null, { timeout: 45000 }).catch(() => {}); ok(busy.length > 0 && (await p.textContent('.hs-a')).length > 10, '3G: Ask shows it is working, then answers'); await close();
    const nPins = await ev(() => JSON.parse(localStorage[Object.keys(localStorage).find(k => /myPins/.test(k))] || '[]').length);
    await ev(() => { window.__toasts = []; new MutationObserver(() => { const t = document.querySelector('#toast'); if (t && !t.classList.contains('hidden')) window.__toasts.push(t.textContent); }).observe(document.querySelector('#toast'), { childList: true, characterData: true, subtree: true, attributes: true }); });
    await ev(() => document.querySelector('#reportBtn').click()); await p.waitForTimeout(800); const tile = await p.$('#hzSheet [data-hz="debris"]') || await p.$('#hzSheet [data-hz]'); /* shortest-lived type (45 min) */ await ev(() => { const H = window.TruckNav.hz, o = H.report.bind(H); window.__hzCalls = 0; H.report = (...a) => { window.__hzCalls++; return o(...a); }; }); const tb = tile && await tile.boundingBox();
    if (tb) { await p.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2); await p.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2); }
    await p.waitForTimeout(9000); const after = await ev(() => { const k = Object.keys(localStorage).find(k => /myPins/.test(k)), q = Object.keys(localStorage).find(k => /guestReports/.test(k)); return { pins: JSON.parse(localStorage[k] || '[]'), sheet: !!document.querySelector('#hzSheet'), filed: window.__hzCalls, toasts: [...new Set(window.__toasts)].slice(0, 4) }; });
    (R.cleanupHazards ||= []).push(...after.pins.slice(nPins)); ok(!after.sheet && after.filed === 1 && after.pins.length - nPins <= 1, '3G: Report (double-tapped) files exactly one hazard and closes the sheet', after);
    await shot('17-3g'); if (cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); else { await ctx.unroute('**'); run.errors.splice(nE3, run.errors.length - nE3, ...run.errors.slice(nE3).filter(e => !/WebKit encountered an internal error/.test(e))); /* artefact of the request-delay shim, not the app */ } }
  // ===== Map marker popups + Map key legend (EN + ES) =====
  const TTL = { 0: 'Unknown incident', 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice on the road', 6: 'Traffic jam', 7: 'Lane closed', 8: 'Road closed', 9: 'Road work', 10: 'Strong wind', 11: 'Flooding', 12: 'Unknown incident', 13: 'Unknown incident', 14: 'Broken-down vehicle' };
  const TTL_ES = { 1: 'Choque', 6: 'Embotellamiento', 8: 'Carretera cerrada', 9: 'Obras en la vía', 14: 'Vehículo averiado' };
  const readPop = () => ev(() => { const m = [...document.querySelectorAll('.maplibregl-popup .mp')].at(-1); return m ? { kind: m.dataset.mpKind, label: m.querySelector('.mp-label')?.textContent.trim(), src: m.querySelector('.mp-src')?.textContent.trim(), age: m.querySelector('.mp-age')?.textContent.trim() } : null; });
  const clearPops = () => ev(() => document.querySelectorAll('.maplibregl-popup').forEach(x => x.remove()));
  await close(); await ev(() => { const S = window.TruckNav; S.map.jumpTo({ center: [-73.9855, 40.758], zoom: 14 }); });
  { const bad = []; for (let c = 0; c <= 14; c++) { await clearPops(); await ev(c => { const S = window.TruckNav; S.mp.showTomTom(S.map, S, { icon_category: c }, S.map.getCenter()); }, c); await p.waitForTimeout(80); const r = await readPop();
      if (!r || !r.label.endsWith(TTL[c]) || !/TomTom traffic/.test(r.src) || !r.age) bad.push([c, r]); } ok(!bad.length, 'TomTom incident popup: iconCategory 0–14 each show the right plain label + "Source: TomTom traffic" + a time line', bad); }
  { const key = await ev(() => window.TruckNav.traffic?.keys?.tomtom || ''); let real = null;
    if (key) { real = await ev(async key => { try { const j = await (await fetch(`https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=-74.02,40.70,-73.93,40.80&fields={incidents{properties{id,iconCategory,startTime,lastReportTime}}}&key=${key}`)).json(); return j.incidents?.find(i => i.properties.startTime || i.properties.lastReportTime)?.properties || null; } catch (e) { return { err: String(e) }; } }, key); }
    if (real?.id) { await clearPops(); await ev(r => { const S = window.TruckNav; S.mp.showTomTom(S.map, S, { id: r.id, icon_category: r.iconCategory }, S.map.getCenter()); }, real); await p.waitForFunction(() => /Reported|Started/.test([...document.querySelectorAll('.mp-age')].at(-1)?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
      const r = await readPop(); ok(r && /(Reported|Started) .*(ago|now|starts)/.test(r.age), `TomTom incident popup (live Manhattan incident ${real.id.slice(0, 8)}, cat ${real.iconCategory}): age from TomTom data "${r?.age}"`, r); }
    else ok(true, 'TomTom live incident age: no TomTom key / no Manhattan incident with a time right now (label path checked above)');
    const fe = await ev(() => { const S = window.TruckNav; if (!S.map.getLayer('ttinc')) return null; const f = S.map.queryRenderedFeatures({ layers: ['ttinc'] })[0]; if (!f) return null; const pt = S.map.project(f.geometry.coordinates); const r = S.map.getCanvas().getBoundingClientRect(); return { x: r.left + pt.x, y: r.top + pt.y, c: f.properties.icon_category }; });
    if (fe) { await clearPops(); await p.touchscreen.tap(fe.x, fe.y); await p.waitForTimeout(700); const r = await readPop(); ok(r?.kind === 'tomtom' && r.label.includes(TTL[+fe.c] || ''), `Tapping a real 🚘/TomTom icon on the map opens its popup (cat ${fe.c})`, r); } }
  // RigRoute driver pin, friend, you
  { await clearPops(); const S0 = await ev(async () => { const S = window.TruckNav, c = S.map.getCenter(); S.reports = [...(S.reports || []).filter(r => r.id !== 'gate-pop'), { id: 'gate-pop', type: 'police', lat: c.lat + 0.001, lon: c.lng + 0.001, t: Date.now() - 5 * 60e3, up: 0, down: 0 }]; S.drawReports(); await new Promise(r => setTimeout(r, 300));
      const el = [...document.querySelectorAll('.rpt-marker')].find(e => e.textContent.includes('👮')); el?.click(); await new Promise(r => setTimeout(r, 300)); return !!el; });
    const r = await readPop(); ok(S0 && r?.kind === 'hazard' && /Police/.test(r.label) && /RigRoute driver/.test(r.src) && /Reported 5 min ago/.test(r.age), 'Driver hazard pin popup: label, "Source: RigRoute driver", "Reported 5 min ago"', r);
    await ev(() => { const S = window.TruckNav; S.reports = S.reports.filter(r => r.id !== 'gate-pop'); S.drawReports(); }); }
  { await clearPops(); const hp = await ev(async () => { const el = document.querySelector('.hz-pin'); if (!el) return null; el.click(); await new Promise(r => setTimeout(r, 300)); return el.dataset.hz; }); if (hp) { const r = await readPop(); ok(r?.kind === 'hazard' && /Source: (RigRoute driver|You)/.test(r.src) && /Reported/.test(r.age), `Live hazard pin popup (${hp}): label, source, age`, r); } }
  { await clearPops(); const fp = await ev(async () => { const S = window.TruckNav, F = S.friends; if (!F) return 'no friends module'; const c = S.map.getCenter(); F.friends = [...F.friends.filter(f => f.pk !== 'gatepop'), { pk: 'gatepop', name: 'Gate Pal', share: false, since: Date.now() }]; F.live.gatepop = { loc: { lat: c.lat - 0.001, lon: c.lng - 0.001, t: Date.now() - 3 * 60e3 } }; F._emit(); await new Promise(r => setTimeout(r, 400));
      const el = document.querySelector('.fr-pin[data-friend="gatepop"]'); el?.click(); await new Promise(r => setTimeout(r, 300)); return el ? 'ok' : 'no marker'; });
    const r = await readPop(); ok(fp === 'ok' && r?.kind === 'friend' && /Source: Friend/.test(r.src) && /Reported 3 min ago/.test(r.age), 'Friend marker popup: label, "Source: Friend", "Reported 3 min ago"', { fp, r });
    await ev(() => { const F = window.TruckNav.friends; if (!F) return; F.friends = F.friends.filter(f => f.pk !== 'gatepop'); delete F.live.gatepop; F._save(); F._emit(); }); }
  { await clearPops(); await ev(async () => { const S = window.TruckNav, m = S.truckMarker; if (!m._map && S.pos) m.setLngLat([S.pos.lon, S.pos.lat]).addTo(S.map); m.togglePopup(); await new Promise(r => setTimeout(r, 300)); });
    const r = await readPop(); ok(r?.kind === 'you' && /Your truck/.test(r.label) && /Source: You/.test(r.src) && /Reported|just now|min ago/.test(r.age), 'Your truck popup: label, "Source: You", GPS age', r); await clearPops(); }
  // legend
  { await ev(() => document.querySelector('#legendBtn')?.parentElement?.id === 'railMenu' && document.querySelector('#moreBtn')?.click()); await p.waitForTimeout(300); await tap('#legendBtn'); await p.waitForTimeout(500); const L = await ev(() => [...document.querySelectorAll('#legendSheet .lg-item')].map(li => li.dataset.key + '|' + li.querySelector('.lg-label').textContent));
    const need = ['tt-0', 'tt-1', 'tt-2', 'tt-3', 'tt-4', 'tt-5', 'tt-6', 'tt-7', 'tt-8', 'tt-9', 'tt-10', 'tt-11', 'tt-14', 'hz-accident', 'hz-police', 'hz-stalled', 'hz-clearance', 'hz-closed', 'friend', 'you'];
    const miss = need.filter(k => !L.some(x => x.startsWith(k + '|'))); ok(miss.length === 0 && L.some(x => x === 'tt-14|Broken-down vehicle'), `Map key legend lists every icon (${L.length} entries)`, miss);
    await shot('18-legend'); await audit('Map key'); await axe('Map key'); await p.goBack().catch(() => {}); await p.waitForTimeout(500); ok(!await p.$('#legendSheet') && p.url().startsWith(BASE), 'Back button closes the Map key'); }
  // Spanish
  { await ev(async () => { const I = await import('./js/i18n.js'); await I.setLang('es'); }); await p.waitForTimeout(1200); const bad = [];
    for (const [c, es] of Object.entries(TTL_ES)) { await clearPops(); await ev(c => { const S = window.TruckNav; S.mp.showTomTom(S.map, S, { icon_category: +c }, S.map.getCenter()); }, c); await p.waitForTimeout(80); const r = await readPop(); if (!r || !r.label.endsWith(es) || !/^Fuente: Tráfico de TomTom/.test(r.src)) bad.push([c, r]); }
    await clearPops(); await ev(async () => { const S = window.TruckNav, c = S.map.getCenter(); S.reports = [...S.reports, { id: 'gate-pop', type: 'police', lat: c.lat + 0.001, lon: c.lng + 0.001, t: Date.now() - 5 * 60e3, up: 0, down: 0 }]; S.drawReports(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('.rpt-marker')].find(e => e.textContent.includes('👮'))?.click(); await new Promise(r => setTimeout(r, 300)); });
    const r = await readPop(); if (!r || !/Policía/.test(r.label) || !/Conductor de RigRoute/.test(r.src) || !/hace 5 min/.test(r.age)) bad.push(['driver pin', r]);
    await ev(() => { const S = window.TruckNav; S.reports = S.reports.filter(r => r.id !== 'gate-pop'); S.drawReports(); }); await clearPops();
    await ev(() => document.querySelector('#legendBtn')?.parentElement?.id === 'railMenu' && document.querySelector('#moreBtn')?.click()); await p.waitForTimeout(300); await tap('#legendBtn'); await p.waitForTimeout(500); const lg = await ev(() => ({ h: document.querySelector('#legendSheet h2')?.textContent, b: document.querySelector('#legendSheet [data-key="tt-14"] .lg-label')?.textContent, s: document.querySelector('#legendSheet [data-key="you"] .lg-src')?.textContent })); await shot('19-legend-es');
    if (!/Leyenda del mapa/.test(lg.h || '') || lg.b !== 'Vehículo averiado' || lg.s !== 'Tú') bad.push(['legend', lg]);
    const missES = await ev(() => [...(globalThis.RRI18N?.missing || [])].filter(k => /Map key|Source|Reported|Started|TomTom|incident|RigRoute driver|Broken-down|Share my location|Not now|Yes, share/i.test(k)));
    await ev(() => document.querySelector('#legendSheet')?.remove());
    const pl = await ev(async () => { await new Promise(r => setTimeout(r, 300)); document.querySelector('#plannerBtn')?.click(); await new Promise(r => setTimeout(r, 600)); const s = document.querySelector('#plSum')?.textContent || '', b = document.querySelector('#plOpt')?.textContent || ''; document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); return { s, b }; });
    if (!/Mejor orden/.test(pl.b) || /Best order|Add stops/.test(pl.s)) bad.push(['multi-stop hint', pl]);
    ok(!bad.length && !missES.length, 'Spanish: popups (TomTom + driver pin), Map key and the ⚡ Best order hint are in Spanish', { bad, missES });
    await ev(async () => { const I = await import('./js/i18n.js'); await I.setLang('en'); }); await p.waitForTimeout(800); }
  // ===== Friend location privacy: new friends start OFF, nothing sent before Yes =====
  { const fx = await ev(async () => { const S = window.TruckNav, F = S.friends; if (!F) return { err: 'no friends module' };
      window.__ws = 0; if (!window.__wsHook) { window.__wsHook = 1; const o = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { if (typeof d === 'string' && d.startsWith('["EVENT"')) window.__ws++; return o.call(this, d); }; }
      const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
      const pk = hex(32), sent = []; window.__gateFriend = pk; await F._add({ pk, name: 'Gate Buddy', secret: hex(32), share: false, askShare: true, since: Date.now() });
      window.__gateSent = sent; if (F.chans[pk]) { const c0 = F.chans[pk], o = c0.send.bind(c0); c0.send = function (sk, m, ...a) { window.__gateSent.push(m && m.type); return o(sk, m, ...a); }; }
      await new Promise(r => setTimeout(r, 800)); const f = F.friends.find(x => x.pk === pk), dlg = document.querySelector('#shareAsk');
      const ws0 = window.__ws; const n = await F.tick(S.pos || { lat: 40.75, lon: -73.99 }, null); await new Promise(r => setTimeout(r, 1500));
      return { share: f.share, prompt: !!dlg, title: dlg?.querySelector('h2')?.textContent, focus: document.activeElement?.hasAttribute('data-no'), ticks: n, locSent: sent.filter(t => t === 'loc').length, wsDuring: window.__ws - ws0 }; });
    await shot('20-share-ask');
    ok(fx.share === false && fx.prompt && /Share my location with Gate Buddy\?/.test(fx.title) && fx.focus, 'New friend: sharing starts OFF and asks "Share my location with Gate Buddy?" with Not now as the default', fx);
    ok(fx.ticks === 0 && fx.locSent === 0 && fx.wsDuring === 0, 'New friend: no location goes out before Yes (no channel send, no relay EVENT frame)', fx);
    await tap('#shareAsk [data-yes]'); await p.waitForTimeout(1500);
    const on = await ev(async () => { const S = window.TruckNav, F = S.friends, pk = window.__gateFriend; const n = await F.tick(S.pos || { lat: 40.75, lon: -73.99 }, null); await new Promise(r => setTimeout(r, 800)); return { share: F.friends.find(x => x.pk === pk).share, ticks: n, loc: window.__gateSent.filter(t => t === 'loc').length, stored: JSON.parse(localStorage[Object.keys(localStorage).find(k => k.startsWith('tn_friends_'))]).friends.find(x => x.pk === pk)?.share }; });
    ok(on.share === true && on.ticks >= 1 && on.loc >= 1 && on.stored === true, 'Tapping Yes starts sharing (location sent, choice saved)', on);
    const off = await ev(async () => { const S = window.TruckNav, F = S.friends, pk = window.__gateFriend; document.querySelector('#friendsBtn')?.click(); await new Promise(r => setTimeout(r, 800)); const cb = document.querySelector(`[data-fr="${pk}"] [data-share]`); if (cb) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); } else F.setShare(pk, false);
      await new Promise(r => setTimeout(r, 500)); const l0 = window.__gateSent.filter(t => t === 'loc').length; const n = await F.tick(S.pos || { lat: 40.75, lon: -73.99 }, null); await new Promise(r => setTimeout(r, 500));
      return { viaCheckbox: !!cb, share: F.friends.find(x => x.pk === pk).share, ticks: n, newLoc: window.__gateSent.filter(t => t === 'loc').length - l0, stop: window.__gateSent.includes('stop_share') }; });
    ok(!off.share && off.ticks === 0 && off.newLoc === 0 && off.stop, 'Turning sharing off stops it (stop_share sent, no more locations)', off); await close();
    // second new friend: "Not now" keeps it off
    const nn = await ev(async () => { const F = window.TruckNav.friends, hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join(''); const pk = hex(32); window.__gateFriend2 = pk; await F._add({ pk, name: 'Gate Two', secret: hex(32), share: false, askShare: true, since: Date.now() }); await new Promise(r => setTimeout(r, 600)); return !!document.querySelector('#shareAsk'); });
    await tap('#shareAsk [data-no]'); await p.waitForTimeout(500); const nn2 = await ev(() => { const f = window.TruckNav.friends.friends.find(x => x.pk === window.__gateFriend2); return { share: f.share, ask: !!f.askShare, prompt: !!document.querySelector('#shareAsk') }; });
    ok(nn && nn2.share === false && !nn2.ask && !nn2.prompt, '"Not now" keeps a new friend off and does not ask again', nn2);
    // upgrade: an existing user's saved per-friend choices survive (on stays on, off stays off, no prompt)
    await ev(() => { const F = window.TruckNav.friends; F.remove(window.__gateFriend); F.remove(window.__gateFriend2); const k = Object.keys(localStorage).find(k => k.startsWith('tn_friends_')), st = JSON.parse(localStorage[k]);
      st.friends = [...st.friends.filter(f => !/^0{8}/.test(f.pk)), { pk: '0'.repeat(63) + '1', name: 'Old On', secret: 'a'.repeat(64), share: true, since: 1 }, { pk: '0'.repeat(63) + '2', name: 'Old Off', secret: 'b'.repeat(64), share: false, since: 1 }]; localStorage[k] = JSON.stringify(st); });
    await p.reload(); await p.waitForTimeout(5000);
    const up = await ev(() => { const F = window.TruckNav.friends, g = n => F?.friends.find(f => f.name === n); return { on: g('Old On')?.share, off: g('Old Off')?.share, prompt: !!document.querySelector('#shareAsk') }; });
    ok(up.on === true && up.off === false && !up.prompt, "Upgrade keeps an existing user's per-friend choice (on stays on, off stays off, no new prompt)", up);
    await ev(() => { const F = window.TruckNav.friends; for (const f of [...F.friends]) if (/^0{8}/.test(f.pk)) F.remove(f.pk); }); }
  // reload mid-task keeps destination + stops
  await p.reload(); await p.waitForTimeout(4000); ok(await ev(() => !!window.TruckNav.dest && document.querySelector('#destLabel').textContent !== 'Where to?'), 'Reload mid-trip keeps the destination');
  // offline: app shell still loads
  await ctx.setOffline(true); await p.reload().catch(() => {}); await p.waitForTimeout(3000); ok(await ev(() => !!document.querySelector('#meBtn')), 'Offline reload still opens the app (service worker)'); await shot('12-offline'); await ctx.setOffline(false);
  // rotate
  await p.setViewportSize({ width: P.dev.viewport.height, height: P.dev.viewport.width }); await p.waitForTimeout(800); await audit('landscape map'); await shot('13-landscape'); await p.setViewportSize(P.dev.viewport);
  for (const pg of ['admin-stats.html', 'bug-reports.html']) { await p.goto(BASE + pg); await p.waitForTimeout(3000); ok(!!await p.$('#adEmail') && !/google|code/i.test(await p.textContent('#who')), `${pg}: admin email-link sign-in only`); await audit(pg); await shot('14-' + pg.replace('.html', '')); }
  run.errors = [...new Set(run.errors)].filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|WebKit encountered an internal error/.test(e)) /* WebKit's wording for a request that failed while the gate had the phone offline */; ok(!run.errors.length, 'zero console errors from the app', run.errors);
  await ctx.close();
}
await ch.close(); if (wk) await wk.close();
R.finished = new Date().toISOString(); const fails = R.runs.flatMap(r => r.checks.filter(c => !c.ok).map(c => `[${r.profile}] ${c.m}`)); R.pass = !fails.length;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(R, null, 1));
fs.writeFileSync(`${OUT}/REPORT.md`, `# RigRoute release gate v${VER}\n\n${R.pass ? '**PASS**' : '**FAIL**'} · ${BASE} · ${R.started}\n\n${R.webkitNote ? '> ' + R.webkitNote + '\n\n' : ''}` + R.runs.map(r => `## ${r.profile} (${r.engine})\n\n${r.checks.map(c => `- ${c.ok ? '✅' : '❌'} ${c.m}`).join('\n')}\n\nAccessibility findings: ${(r.a11y || []).length}\n${(r.a11y || []).map(x => '  - ' + x).join('\n')}\n\nTap targets under 44px: ${r.small.length}\n${r.small.slice(0, 60).map(x => '  - ' + x).join('\n')}\n\nExternal (not ours) console errors: ${r.external.length}\n\nScreenshots:\n${r.shots.map(s => '- ' + s).join('\n')}\n`).join('\n') + (fails.length ? `\n## Failures\n${fails.map(f => '- ' + f).join('\n')}\n` : ''));
if (R.cleanupHazards?.length) fs.writeFileSync(`${OUT}/cleanup-hazards.json`, JSON.stringify(R.cleanupHazards)); /* delete these gate-filed pins after the run */
console.log(R.pass ? 'GATE PASS' : 'GATE FAIL', OUT); process.exit(R.pass ? 0 : 1);

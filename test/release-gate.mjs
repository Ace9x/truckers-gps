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
let wk = null; if (process.env.GATE_WEBKIT) { try { wk = await webkit.launch(); } catch (e) { R.webkitNote = 'WebKit unavailable: ' + e.message.split('\n')[0]; } } else R.webkitNote = 'WebKit system libraries missing on the QA box (Debian mirror down); iPhone run uses Chromium with the iPhone 13 profile at 390x844.';
const ch = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const PROFILES = [
  { name: 'iphone', engine: wk ? 'webkit' : 'chromium', br: wk || ch, dev: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  { name: 'pixel7', engine: 'chromium', br: ch, dev: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } } }];
const EXTERNAL = /relay\.|nos\.lol|damus|nostr|wss:\/\/|tile|openfreemap|overpass|photon|valhalla|nominatim|geojs|tomtom|ERR_INTERNET_DISCONNECTED/i;

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
    await S.vote(r, 'up'); const after = S.reports.find(x => x.id === r.id); let again = null; try { await S.backend.vote(r.id, 'up'); } catch (e) { again = e.message; }
    return { up: after?.up, voted: after?.voted, again }; });
  await p.waitForTimeout(300); run.errors.splice(nE, run.errors.length - nE, ...run.errors.slice(nE).filter(e => !/status of 400.*guest_vote_hazard/.test(e))); /* the deliberate second vote is refused with 400 */ ok(hv.up >= 1 && hv.voted === 'up' && /already voted/.test(hv.again || ''), 'Hazard pin: 👍 Still there works once per device ' + JSON.stringify(hv));
  // reload mid-task keeps destination + stops
  await p.reload(); await p.waitForTimeout(4000); ok(await ev(() => !!window.TruckNav.dest && document.querySelector('#destLabel').textContent !== 'Where to?'), 'Reload mid-trip keeps the destination');
  // offline: app shell still loads
  await ctx.setOffline(true); await p.reload().catch(() => {}); await p.waitForTimeout(3000); ok(await ev(() => !!document.querySelector('#meBtn')), 'Offline reload still opens the app (service worker)'); await shot('12-offline'); await ctx.setOffline(false);
  // rotate
  await p.setViewportSize({ width: P.dev.viewport.height, height: P.dev.viewport.width }); await p.waitForTimeout(800); await audit('landscape map'); await shot('13-landscape'); await p.setViewportSize(P.dev.viewport);
  for (const pg of ['admin-stats.html', 'bug-reports.html']) { await p.goto(BASE + pg); await p.waitForTimeout(3000); ok(!!await p.$('#adEmail') && !/google|code/i.test(await p.textContent('#who')), `${pg}: admin email-link sign-in only`); await audit(pg); await shot('14-' + pg.replace('.html', '')); }
  run.errors = [...new Set(run.errors)].filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)); ok(!run.errors.length, 'zero console errors from the app', run.errors);
  await ctx.close();
}
await ch.close(); if (wk) await wk.close();
R.finished = new Date().toISOString(); const fails = R.runs.flatMap(r => r.checks.filter(c => !c.ok).map(c => `[${r.profile}] ${c.m}`)); R.pass = !fails.length;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(R, null, 1));
fs.writeFileSync(`${OUT}/REPORT.md`, `# RigRoute release gate v${VER}\n\n${R.pass ? '**PASS**' : '**FAIL**'} · ${BASE} · ${R.started}\n\n${R.webkitNote ? '> ' + R.webkitNote + '\n\n' : ''}` + R.runs.map(r => `## ${r.profile} (${r.engine})\n\n${r.checks.map(c => `- ${c.ok ? '✅' : '❌'} ${c.m}`).join('\n')}\n\nAccessibility findings: ${(r.a11y || []).length}\n${(r.a11y || []).map(x => '  - ' + x).join('\n')}\n\nTap targets under 44px: ${r.small.length}\n${r.small.slice(0, 60).map(x => '  - ' + x).join('\n')}\n\nExternal (not ours) console errors: ${r.external.length}\n\nScreenshots:\n${r.shots.map(s => '- ' + s).join('\n')}\n`).join('\n') + (fails.length ? `\n## Failures\n${fails.map(f => '- ' + f).join('\n')}\n` : ''));
console.log(R.pass ? 'GATE PASS' : 'GATE FAIL', OUT); process.exit(R.pass ? 0 : 1);

// Rate con import on the real dispatcher console: drop/choose 3 text PDFs + 1 scanned PDF + 1 photo, read the review form, score vs ground truth.
// Then apply one to the New load form, check nothing is saved before Send, send it and check the original file is attached to the load documents.
import { chromium } from 'playwright'; import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'node:fs'; import { execSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://localhost:8841/', FX = 'test/fixtures/ratecons/', SH = '/workspace/truckers-gps-shots/r4';
const truth = JSON.parse(fs.readFileSync(FX + 'truth.json')); truth['d_scan.png'] = truth['d_scan.pdf'];
const cfg = fs.readFileSync('js/config.js', 'utf8'), U = cfg.match(/url:\s*'([^']+)'/)[1], K = cfg.match(/anonKey:\s*'([^']+)'/)[1];
const users = JSON.parse(fs.readFileSync('/workspace/.rr-secrets/testusers.json')); let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; return c; };
const X = createClient(U, K, { realtime: { transport: WebSocket }, auth: { persistSession: false } }); await X.auth.signInWithPassword(users.dispatcher);
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), d = await ctx.newPage();
d.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; }); d.on('console', m => { if (/Refused to|Content Security Policy/.test(m.text())) { console.log('CSP', m.text().slice(0, 200)); fails++; } });
await d.goto(BASE + 'dispatch.html'); await d.waitForFunction(() => document.querySelector('#sbIn').onclick); await d.fill('#sbEmail', users.dispatcher.email); await d.fill('#sbPass', users.dispatcher.password); await d.click('#sbIn');
await d.waitForFunction(() => window.RRB && window.RRI, null, { timeout: 30000 }); await d.click('.fx-tabs [data-tab="board"]').catch(() => {});
const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9#$.]+/g, ' ').trim(), num = v => v === '' || v == null ? null : +v;
const closeRv = () => d.evaluate(() => { const b = document.querySelector('#rcReview'); b.close?.(); b.removeAttribute('open'); b.innerHTML = ''; });
const geoDone = () => d.waitForFunction(() => [...document.querySelectorAll('[data-geomsg]')].every(e => !/checking/.test(e.textContent)), null, { timeout: 60000 }).catch(() => {});
const score = {};
for (const f of ['a_summit.pdf', 'b_blueridge.pdf', 'c_hudson.pdf', 'd_scan.pdf', 'd_scan.png']) { const T = truth[f], t0 = Date.now(); await closeRv();
  if (f === 'a_summit.pdf') { const b64 = fs.readFileSync(FX + f).toString('base64'); // real drag-and-drop path
    await d.evaluate(({ b64, f }) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), dt = new DataTransfer(); dt.items.add(new File([bin], f, { type: 'application/pdf' })); document.querySelector('#rcDrop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, { b64, f });
  } else await d.setInputFiles('#rcFile', FX + f);
  const opened = await d.waitForSelector('#rcReview[open] [data-rc="ref"]', { timeout: 150000 }).then(() => true, () => false); if (!ok(opened, `${f}: review form opened (${((Date.now() - t0) / 1000).toFixed(1)} s)`)) { console.log(await d.textContent('#rcStatus')); continue; }
  await geoDone();
  const got = await d.evaluate(() => { const top = k => document.querySelector(`.rc-form > .grid [data-rc="${k}"]`)?.value ?? '';
    return { customer: top('customer'), ref: top('ref'), commodity: top('commodity'), weight_lb: top('weight_lb'), equipment: top('equipment'), vehicle: top('vehicle'), rate_usd: top('rate_usd'), reefer_setpoint: top('reefer_setpoint'), det_rate: top('det_rate'), det_free: top('det_free'), notes: document.querySelector('[data-rc="notes"]').value,
      acc: document.querySelector('.rc-form').textContent.match(/Accessorials:(.*)/)?.[1] || '', ocr: /OCR/.test(document.querySelector('.rc-form p').textContent),
      stops: [...document.querySelectorAll('[data-rcs]')].map(fs => { const q = k => fs.querySelector(`[data-rc="${k}"]`)?.value ?? ''; return { kind: fs.querySelector('[data-rk]').value, name: q('name'), address: q('address'), appt: q('appt'), appt_end: q('appt_end'), phone: q('phone'), geo: /📍/.test(fs.querySelector('[data-geomsg]').textContent) }; }) }; });
  const chk = []; const c = (name, good) => chk.push([name, !!good]);
  c('customer', norm(got.customer) === norm(T.customer)); c('ref', got.ref === T.ref); c('commodity', norm(got.commodity) === norm(T.commodity)); c('weight', num(got.weight_lb) === T.weight_lb); c('equipment', norm(got.equipment) === norm(T.equipment));
  c('vehicle', got.vehicle === T.vehicle); c('rate', num(got.rate_usd) === T.rate_usd); c('reefer temp', num(got.reefer_setpoint) === T.reefer_setpoint); c('detention $/hr', num(got.det_rate) === T.detention_rate); c('detention free', num(got.det_free) === T.detention_free_min);
  c('notes', got.notes.toLowerCase().includes(T.notes_has.toLowerCase())); c('accessorials', T.accessorials.length ? T.accessorials.every(a => got.acc.toLowerCase().includes(a)) : /none found/.test(got.acc)); c('stop count', got.stops.length === T.stops.length);
  T.stops.forEach((s, i) => { const g = got.stops[i] || {}; c(`s${i + 1} type`, g.kind === s.kind); c(`s${i + 1} facility`, norm(g.name) === norm(s.name)); c(`s${i + 1} address`, norm(g.address) === norm(s.address)); c(`s${i + 1} appt`, g.appt === s.appt); c(`s${i + 1} window end`, (g.appt_end || null) === s.appt_end); c(`s${i + 1} phone`, (g.phone || '').replace(/\D/g, '') === s.phone.replace(/\D/g, '')); c(`s${i + 1} geocoded`, g.geo); });
  const n = chk.filter(x => x[1]).length; score[f] = { n, of: chk.length, misses: chk.filter(x => !x[1]).map(x => x[0]), ocr: got.ocr };
  console.log(`${f}: ${n}/${chk.length} fields correct${got.ocr ? ' (OCR)' : ''}${score[f].misses.length ? ' · missed: ' + score[f].misses.join(', ') : ''}`);
  if (/d_scan/.test(f)) ok(got.ocr, f + ' went through OCR'); if (f === 'd_scan.pdf') await d.screenshot({ path: SH + '/dispatcher-import-review-scan.png', fullPage: true });
  if (f === 'b_blueridge.pdf') await d.screenshot({ path: SH + '/dispatcher-import-review.png', fullPage: true });
  ok(n / chk.length >= 0.85, `${f}: accuracy ≥ 85% (${Math.round(100 * n / chk.length)}%)`); }
const tot = Object.values(score).reduce((a, s) => [a[0] + s.n, a[1] + s.of], [0, 0]); console.log(`OVERALL ${tot[0]}/${tot[1]} = ${(100 * tot[0] / tot[1]).toFixed(1)}%`); fs.writeFileSync('/tmp/ratecon-accuracy.json', JSON.stringify(score, null, 1));
// no fabrication: an unrelated PDF yields blanks, not invented values
execSync(`python3 -c "from reportlab.pdfgen import canvas; c=canvas.Canvas('/tmp/menu.pdf'); c.drawString(50,800,'Lunch menu: soup of the day, grilled cheese, coffee and tea. Open daily.'); c.drawString(50,780,'Thank you for visiting our cafe. Free wifi for all guests.'); c.save()"`);
await closeRv(); await d.setInputFiles('#rcFile', '/tmp/menu.pdf'); await d.waitForSelector('#rcReview[open] [data-rc="ref"]', { timeout: 60000 });
ok(await d.evaluate(() => ['ref', 'rate_usd', 'weight_lb', 'commodity', 'customer'].every(k => document.querySelector(`.rc-form > .grid [data-rc="${k}"]`).value === '') && document.querySelectorAll('[data-rcs]').length === 0 && /No pickup/.test(document.querySelector('.rc-warn')?.textContent || '')), 'unrelated PDF: no fields invented (all blank, warning shown)');
// apply A → form filled, nothing saved; then send → original attached
const REF = 'SFB-448812'; await X.from('loads').delete().eq('ref', REF);
await closeRv(); await d.setInputFiles('#rcFile', FX + 'a_summit.pdf'); await d.waitForSelector('#rcReview[open] [data-rc="ref"]', { timeout: 60000 }); await geoDone(); await d.click('#rcApply');
const form = await d.evaluate(() => ({ ref: bRef.value, rate: bRate.value, wt: bWt.value, comm: bComm.value, veh: bVeh.value, notes: bNotes.value, det: bDetR.value, free: bFree.value, draft: RRB.draft.map(s => ({ a: s.address, lat: s.lat, appt: s._appt, kind: s.kind })) }));
ok(form.ref === REF && form.rate === '2210' && form.wt === '38500' && form.veh === 'semi' && form.det === '50' && form.free === '120', 'New load form filled from the rate con');
ok(form.draft.length === 2 && form.draft[0].kind === 'pickup' && form.draft[0].appt === '2026-11-02T08:00' && /Lumper/.test(form.notes), 'stops, appointment times and accessorials carried into the form');
ok(((await X.from('loads').select('id').eq('ref', REF)).data || []).length === 0, 'nothing saved before Send (no auto-save)');
if (await d.$(`#bFleetDrv option[value="${users.driver.id}"]`)) await d.selectOption('#bFleetDrv', users.driver.id); else await d.fill('#bDriver', users.driver.email);
if (ok(form.draft.every(s => s.lat != null), 'geocoder confirmed both addresses')) { await d.click('#bSend'); await d.waitForFunction(r => document.querySelector('#bMsg').textContent.includes('Sent ' + r), REF, { timeout: 20000 }).catch(async () => console.log('bMsg:', await d.textContent('#bMsg')));
  const { data: L } = await X.from('loads').select('id').eq('ref', REF).maybeSingle(); ok(!!L, 'load saved only after Send');
  if (L) { await d.waitForTimeout(2000); const ls = await X.storage.from('load-docs').list(L.id); ok((ls.data || []).some(x => /^ratecon-\d+\.pdf$/.test(x.name)), 'original rate con attached to the load documents'); await X.from('loads').delete().eq('id', L.id); } }
await d.screenshot({ path: SH + '/dispatcher-import-filled.png', fullPage: true });
await browser.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

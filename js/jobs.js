// Driver tools: crowd parking status (open/some/full), shared facility notes, HOS "short of destination → last parking" helper,
// weekly settlement (linehaul + detention + lumper, from RigRoute dispatch loads), CDL / med-card expiry reminders.
import * as cloud from './cloud.js';
import { parkingNow, hosParking, fmtH, credAlerts, CREDS, expiry } from './jobslogic.js';
import { settlement, stopsOf } from './freightlogic.js';
let S; const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('tn_' + k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem('tn_' + k, JSON.stringify(v)) };
const signedIn = () => S.auth?.user?.method === 'supabase', toast = m => S.toast?.(m);
const PK = { open: ['Open', 'Plenty of spots'], some: ['Some', 'A few spots left'], full: ['Full', 'Lot is full'] };
const facKey = d => d ? `${d.lat.toFixed(4)},${d.lon.toFixed(4)}` : '';
// ---- parking
let pkReports = {}, pkIds = '';
async function loadParking(force) { const ids = (S.pois || []).filter(p => ['stop', 'rest', 'parking'].includes(p.kind)).map(p => String(p.id)), key = ids.join(); if (!ids.length || (!force && key === pkIds)) return; pkIds = key;
  const c = await cloud.sb(); if (!c) return; const out = {}; for (let i = 0; i < ids.length; i += 150) { const { data } = await c.from('parking_reports').select('poi,status,t').in('poi', ids.slice(i, i + 150)).gt('t', new Date(Date.now() - 4 * 3600e3).toISOString()); for (const r of data || []) (out[r.poi] ||= []).push(r); }
  pkReports = out; S.parking = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, parkingNow(v)]).filter(([, v]) => v)); fillPk(true); }
const pkLine = s => s ? `<b class="pk-${s.status}">🅿️ ${PK[s.status][1]}</b> <small>· ${s.ageMin < 1 ? 'just now' : s.ageMin + ' min ago'}${s.n > 1 ? ` · ${s.n} reports` : ''}</small>` : '<small>🅿️ No parking reports in the last 4 h</small>';
function fillPk(all) { document.querySelectorAll('[data-pk]').forEach(el => { if (el.dataset.done && !all) return; el.dataset.done = 1; const id = el.dataset.pk, s = S.parking?.[id];
  el.innerHTML = `<div data-pkline>${pkLine(s)}</div><div class="vote pk-btns">${Object.entries(PK).map(([k, [w]]) => `<button data-pks="${k}">${w}</button>`).join('')}</div>`;
  el.querySelectorAll('[data-pks]').forEach(b => b.onclick = () => reportParking(id, el.dataset.pkname, el.dataset.pkll.split(',').map(Number), b.dataset.pks)); }); }
export async function reportParking(id, name, [lat, lon], status) { if (!signedIn()) return toast('Sign in (Me → Account) to report parking'); const c = await cloud.sb();
  const { data, error } = await c.rpc('report_parking', { p_poi: String(id), p_name: name, p_lat: lat, p_lng: lon, p_status: status }); if (error) return toast('⚠ ' + error.message);
  (pkReports[id] ||= []).push(data); S.parking = { ...(S.parking || {}), [id]: parkingNow(pkReports[id]) }; fillPk(true); toast(`🅿️ Thanks — ${PK[status][1].toLowerCase()} reported`); }
// ---- HOS short → last parking
let hpSaid = null;
function hosPark() { const r = S.route, h = S.hos; let el = $('#hosPark'); const res = r && h ? hosParking({ pois: S.pois || [], along: S.nav ? S.along : 0, length: r.length, timeSec: r.time, driveLeftMs: h.driveLeft, status: S.parking || {} }) : null; S.hosParking = res;
  if (!res) { el?.remove(); return; } if (!el) { el = document.createElement('div'); el.id = 'hosPark'; el.setAttribute('role', 'alert'); }
  const host = S.nav ? $('#alerts') : $('#hosEta')?.parentElement || $('#routePanel'); if (host && el.parentElement !== host) (S.nav ? host.prepend(el) : ($('#hosEta') ? $('#hosEta').before(el) : host.appendChild(el)));
  const p = res.pick, txt = `${fmtH(res.shortMs)} short of the destination on today's hours`;
  el.className = 'hos-park' + (S.nav ? ' alert warn' : ''); el.innerHTML = `<b>⏰ ${txt}</b><div>${p ? `Last truck parking before your clock runs out: <b>${esc(p.name || 'Truck parking')}</b>, ${p.mi.toFixed(0)} mi${p.park ? ' · ' + PK[p.park.status][1].toLowerCase() + ' (' + p.park.ageMin + ' min ago)' : ''}` : `No truck parking found within the ${res.reachMi.toFixed(0)} mi you can still drive — load stops along the route (🅿️ button) or plan a shorter day.`}${res.skippedFull ? ` · ${res.skippedFull} closer lot${res.skippedFull > 1 ? 's' : ''} reported full` : ''}</div>${p ? '<button class="small-btn" data-hpgo>Stop there</button>' : ''}`;
  const b = el.querySelector('[data-hpgo]'); if (b) b.onclick = () => { S.stops = [{ lat: p.lat, lon: p.lon, name: '🅿️ ' + (p.name || 'Truck parking') }]; localStorage.setItem('tn_stops', JSON.stringify(S.stops)); S.plan?.(S.nav); toast('Parking added as a stop'); };
  const sayKey = p ? p.id : 'none'; if (S.nav && hpSaid !== sayKey) { hpSaid = sayKey; S.voiceObj?.say(p ? `Heads up. You are ${fmtH(res.shortMs).replace('h', ' hours').replace('m', ' minutes')} short on hours. Last truck parking before your clock runs out is ${p.name || 'a truck parking area'}, in ${p.mi.toFixed(0)} miles.` : 'Heads up. You do not have enough driving hours to reach the destination.', 'warn'); } }
// ---- facility notes (local + shared with RigRoute drivers)
let facShared = [], facDestK = '';
function facUI() { const fp = $('#facPanel'); if (!fp || $('#facGate')) return; const box = document.createElement('div'); box.id = 'facMore';
  box.innerHTML = `<div class="grid2"><label>Gate code<input id="facGate" maxlength="40" autocomplete="off"></label><label>Overnight parking<select id="facOver"><option value="unknown">Not sure</option><option value="yes">Yes, allowed</option><option value="no">No overnight</option></select></label></div>
    <label>Truck entrance / check-in<input id="facEnt" maxlength="400" placeholder="e.g. Use Halleck St gate, guard shack on right"></label>
    <label class="chk"><input type="checkbox" id="facShare"> Share these notes with other RigRoute drivers</label><div id="facOthers"></div>`;
  $('#facNotes').closest('label').after(box);
  const save = () => { const f = { gate_code: $('#facGate').value.trim(), overnight: $('#facOver').value, entrance: $('#facEnt').value.trim() }; S.saveFac(f); LS.set('facShare', $('#facShare').checked); if ($('#facShare').checked) pushFac(); };
  ['#facGate', '#facEnt'].forEach(s => $(s).addEventListener('change', save)); $('#facOver').onchange = save; $('#facShare').onchange = save; $('#facNotes').addEventListener('change', () => $('#facShare').checked && pushFac()); }
async function pushFac() { if (!signedIn() || !S.dest) return; const f = S.facilities[facKey(S.dest)] || {}; const c = await cloud.sb();
  const { error } = await c.from('facility_notes').upsert({ key: facKey(S.dest), name: S.dest.name, lat: S.dest.lat, lng: S.dest.lon, gate_code: f.gate_code || null, entrance: f.entrance || null, overnight: f.overnight || 'unknown', notes: f.notes || null, updated_at: new Date().toISOString() });
  toast(error ? '⚠ ' + error.message : 'Facility notes shared'); }
async function loadFac() { if (!S.dest || !signedIn()) { facShared = []; return; } const c = await cloud.sb(); const me = S.auth.user.id;
  const { data } = await c.from('facility_notes').select('*').eq('key', facKey(S.dest)).order('updated_at', { ascending: false }).limit(10); facShared = (data || []).filter(x => x.author !== me); S.facShared = facShared; }
function facFill() { if (!$('#facGate') || $('#facPanel').classList.contains('hidden')) return; const k = facKey(S.dest); if ($('#facPanel').dataset.k !== k) { $('#facPanel').dataset.k = k; const f = S.facilities[k] || {};
    $('#facGate').value = f.gate_code || ''; $('#facOver').value = f.overnight || 'unknown'; $('#facEnt').value = f.entrance || ''; $('#facShare').checked = LS.get('facShare', true); loadFac().then(facFill); }
  $('#facOthers').innerHTML = facShared.length ? '<h4>From other drivers</h4>' + facShared.map(x => `<div class="fac-o" data-faco><b>${x.gate_code ? 'Gate ' + esc(x.gate_code) : 'Notes'}</b>${x.overnight !== 'unknown' ? ` · overnight: ${x.overnight === 'yes' ? '✅ allowed' : '⛔ no'}` : ''}${x.entrance ? `<div>${esc(x.entrance)}</div>` : ''}${x.notes ? `<div class="small">${esc(x.notes)}</div>` : ''}<small class="muted">${new Date(x.updated_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}</small></div>`).join('') : ''; }
export function facSummary(f, shared = []) { const o = shared[0] || {}; const g = f.gate_code || o.gate_code, e = f.entrance || o.entrance, ov = f.overnight && f.overnight !== 'unknown' ? f.overnight : o.overnight;
  return [g && `Gate code ${g}`, e, ov === 'yes' ? 'Overnight parking allowed' : ov === 'no' ? 'No overnight parking' : null, f.notes || o.notes].filter(Boolean).join('. '); }
// ---- weekly settlement
let payDocs = [], payKey = '', payBusy = false;
async function pay() { const me = $('#mePanel'); if (!me || me.classList.contains('hidden')) return; let el = $('#mePay'); if (!el) { el = document.createElement('div'); el.id = 'mePay'; ($('#meTrips') || me.lastChild).before(el); }
  if (!signedIn()) { el.innerHTML = '<h3>Weekly pay</h3><p class="small muted">Sign in to see settlements for loads from RigRoute dispatch.</p>'; return; }
  const mine = (S.cloudLoads || []).filter(l => l.driver === S.auth.user.id && l.status === 'delivered'), key = mine.map(l => l.id + l.updated_at).join();
  if (key !== payKey) { if (payBusy) return; payBusy = true; try { payDocs = (await cloud.loadEvents(mine.map(l => l.id))).filter(e => e.kind === 'doc'); payKey = key; } catch { return; } finally { payBusy = false; } }
  const W = settlement(mine, payDocs), k2 = JSON.stringify(W.map(w => [w.week, w.total, w.loads.length])); if (el.dataset.k === k2) return; el.dataset.k = k2;
  const wk = w => new Date(w + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), $$ = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  el.innerHTML = '<h3>Weekly pay</h3>' + (W.length ? W.map((w, i) => `<details class="pay-wk" ${i ? '' : 'open'} data-payweek="${w.week}"><summary><b>Week of ${wk(w.week)}</b><span class="pay-tot" data-paytot>${$$(w.total)}</span></summary>
    <div class="pay-row"><span>Linehaul (${w.loads.length} load${w.loads.length > 1 ? 's' : ''})</span><span>${$$(w.linehaul)}</span></div><div class="pay-row"><span>Detention</span><span data-paydet>${$$(w.detention)}</span></div><div class="pay-row"><span>Lumper reimbursement</span><span data-paylum>${$$(w.lumper)}</span></div>
    ${w.loads.map(l => `<div class="pay-load small"><b>${esc(l.ref || l.id.slice(0, 8))}</b> ${$$(l.rate)}${l.detention ? ` + det ${$$(l.detention)}` : ''}${l.lumper ? ` + lumper ${$$(l.lumper)}` : ''} · ${l.docs.length ? l.docs.map(d => d.toUpperCase()).join(', ') : '<span class="pay-miss">no docs</span>'}</div>`).join('')}
    <button class="small-btn" data-paycsv="${w.week}">Export CSV</button></details>`).join('') : '<p class="small muted">No delivered loads yet. Delivered RigRoute loads, detention and lumper receipts add up here by week (Mon–Sun).</p>') + '<p class="small muted">Estimate from your loads — your carrier’s settlement statement is final.</p>';
  el.querySelectorAll('[data-paycsv]').forEach(b => b.onclick = () => { const w = W.find(x => x.week === b.dataset.paycsv); const rows = [['week', 'ref', 'linehaul', 'detention', 'lumper', 'docs'], ...w.loads.map(l => [w.week, l.ref || l.id, l.rate, l.detention, l.lumper, l.docs.join(' ')]), [w.week, 'TOTAL', w.linehaul, w.detention, w.lumper, '']];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })); a.download = `rigroute-pay-${w.week}.csv`; a.click(); }); }
// ---- CDL / med card reminders
function creds() { const me = $('#mePanel'); if (!me) return; let el = $('#meCreds'); if (!el) { el = document.createElement('div'); el.id = 'meCreds'; ($('#mePay') || $('#meTrips') || me.lastChild).before(el);
    const c = LS.get('creds', {}); el.innerHTML = '<h3>Licenses & cards</h3>' + CREDS.map(x => `<label class="cred">${x.label}<input type="date" data-cred="${x.k}" value="${c[x.k] || ''}"></label>`).join('') + '<div id="credState" class="small"></div><p class="small muted">Stored only on this phone. Reminders at 60, 30 and 7 days.</p>';
    el.querySelectorAll('[data-cred]').forEach(i => i.onchange = () => { const c = LS.get('creds', {}); c[i.dataset.cred] = i.value || undefined; LS.set('creds', c); localStorage.removeItem('tn_credSeen'); credState(); banner(true); }); credState(); } }
function credState() { const a = credAlerts(LS.get('creds', {})); const s = $('#credState'); if (s) s.innerHTML = a.map(x => `<div class="cred-${x.level}" data-credalert="${x.k}">${x.level === 'expired' ? '⛔' : '⚠'} ${esc(x.text)}</div>`).join(''); }
function banner(force) { const a = credAlerts(LS.get('creds', {})); $('#credBanner')?.remove(); if (!a.length || S.nav) return; const today = new Date().toDateString(), seen = LS.get('credSeen', null); if (!force && seen === today) return;
  const worst = a.sort((x, y) => (x.days ?? 0) - (y.days ?? 0))[0]; const b = document.createElement('div'); b.id = 'credBanner'; b.className = 'cred-banner cred-' + worst.level; b.setAttribute('role', 'status');
  b.innerHTML = `<span>${worst.level === 'expired' ? '⛔' : '🪪'} ${esc(worst.text)}${a.length > 1 ? ` (+${a.length - 1} more)` : ''}</span><button data-credok>OK</button>`; document.body.appendChild(b);
  b.querySelector('[data-credok]').onclick = () => { LS.set('credSeen', today); b.remove(); };
  try { if (Notification?.permission === 'granted' && seen !== today) new Notification('RigRoute', { body: worst.text, icon: 'icons/icon.svg', tag: 'rr-cred' }); } catch {} }
export function start() { S = window.TruckNav; S.jobs = { reportParking, loadParking, facSummary, banner };
  setInterval(() => { const dk = facKey(S.dest) + signedIn(); if (dk !== facDestK) { facDestK = dk; loadFac().catch(() => {}); } fillPk(); loadParking().catch(() => {}); hosPark(); facUI(); facFill(); creds(); pay().catch(() => {}); }, 1000);
  setInterval(() => loadParking(true).catch(() => {}), 120e3); setTimeout(() => banner(), 4000); }

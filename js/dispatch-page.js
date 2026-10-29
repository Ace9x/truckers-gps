
import { DispatcherConsole, STATUS_LABEL } from './dispatch.js'; import { bus, hex, unhex, newSecret, uid } from './link.js';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let k = localStorage.getItem('rr_disp_key'); if (!k) { k = hex(newSecret()); localStorage.setItem('rr_disp_key', k); }
const D = new DispatcherConsole(unhex(k), $('#dName').value); window.RRD = D;
// Time windows are entered/shown in America/New_York (not UTC)
const TZ = 'America/New_York', nyParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
const nyOffset = d => { const q = nyParts(d); return Date.UTC(+q.year, q.month - 1, +q.day, +q.hour, +q.minute, +q.second) - (d.getTime() - d.getMilliseconds()); };
const nyLocal = d => { const q = nyParts(d); return `${q.year}-${q.month}-${q.day}T${q.hour}:${q.minute}`; };
const fromNY = s => { const g = Date.parse(s + ':00Z'); let t = g - nyOffset(new Date(g)); return new Date(g - nyOffset(new Date(t))); };
const iso = h => { const d = new Date(Date.now() + h * 3600e3); d.setMinutes(0, 0, 0); return nyLocal(d); };
$('#lid').value = 'L-' + uid().slice(0, 6).toUpperCase();
import { photon } from './board.js';
const hav = (a, b) => { const R = 3958.8, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// relay health: per-relay state, warning under 2
setInterval(() => { const rs = bus().health || bus().rs || [], n = bus().openCount; $('#relays').innerHTML = `<span class="${n < 2 ? 'late' : ''}" data-relayn="${n}">${n} of ${rs.length} relays connected${n < 2 ? ' — messages may be delayed' : ''}</span> ` + rs.map(r => `<span class="b-pill" data-relay="${r.open ? 'up' : 'down'}" title="${esc(r.url)}">${r.open ? '🟢' : '🔴'} ${esc(r.url.replace('wss://', ''))}${!r.open && r.retryAt ? ' · retry in ' + Math.max(0, Math.round((r.retryAt - Date.now()) / 1e3)) + 's' : ''}</span>`).join(' '); }, 1000);
// address search (Photon) fills read-only coordinates
for (const [ai, li] of [['#pAddr', '#pLL'], ['#dAddr', '#dLL']]) { const inp = $(ai), sug = inp.nextElementSibling; let tm;
  inp.oninput = () => { $(li).value = ''; check(); clearTimeout(tm); const q = inp.value.trim(); if (q.length < 3) { sug.hidden = true; return; }
    tm = setTimeout(async () => { try { const list = await photon(q); sug.innerHTML = list.map((r, k) => `<button type="button" data-sg="${k}">${esc(r.address)}</button>`).join(''); sug.hidden = !list.length;
      sug.querySelectorAll('[data-sg]').forEach(b => b.onmousedown = e => { e.preventDefault(); const r = list[+b.dataset.sg]; inp.value = r.address; $(li).value = r.lat.toFixed(5) + ',' + r.lng.toFixed(5); sug.hidden = true; check(); }); } catch {} }, 300); };
  inp.onblur = () => setTimeout(() => sug.hidden = true, 150); }
$('#newCode').onclick = async () => { if (!$('#dName').value.trim()) { $('#dName').focus(); $('#codeExp').textContent = ''; $('#dName').placeholder = 'Enter your company name first'; return; } D.name = $('#dName').value.trim(); const { code, expires } = await D.newCode(p => log('paired with ' + (p.driver?.name || 'driver')));
  $('#codeBox').hidden = false; $('#code').textContent = code; $('#codeExp').textContent = 'Expires ' + new Date(expires).toLocaleTimeString() + ' · one driver per code';
  const url = new URL('./?pair=' + code, location.href).href; import('https://esm.sh/qrcode@1.5.4').then(q => q.toDataURL(url, { margin: 1 })).then(u => $('#qr').src = u).catch(() => $('#qr').remove()); };
const ll = s => s.split(',').map(Number), win = s => { const [a, b] = s.split(','); return a ? { start: fromNY(a.trim()).toISOString(), end: b ? fromNY(b.trim()).toISOString() : null, tz: TZ } : null; };
const okLL = s => { const [a, b] = ll(s || ''); return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && s.includes(','); };
function missing() { const m = []; if (!$('#to').value) m.push('driver'); if (!$('#pAddr').value.trim() || !okLL($('#pLL').value)) m.push('pickup address (pick from the list)'); if (!$('#dAddr').value.trim() || !okLL($('#dLL').value)) m.push('drop address (pick from the list)'); if (!(+$('#rate').value > 0)) m.push('rate'); return m; }
function check() { const m = missing(); $('#send').disabled = m.length > 0; $('#sendMsg').textContent = (sentNote ? sentNote + ' · next: ' : '') + (m.length ? 'Needed: ' + m.join(', ') : 'Ready to send'); }
let sentNote = '';
document.querySelectorAll('#rate,#to,#pAddr,#dAddr').forEach(i => i.addEventListener('input', check)); $('#to').addEventListener('change', check);
const loadFromForm = () => { const [pl, pn] = ll($('#pLL').value), [dl, dn] = ll($('#dLL').value), v = id => $(id).value.trim();
  return { id: v('#lid'), ref: v('#ref') || null, pickup: { name: v('#pName') || null, address: v('#pAddr'), lat: pl, lon: pn, window: win(v('#pWin')) },
    drop: { name: v('#dNameS') || null, address: v('#dAddr'), lat: dl, lon: dn, window: win(v('#dWin')) }, rate: { amount: +v('#rate'), currency: 'USD', per: 'flat' },
    vehicle: v('#veh') || null, commodity: v('#comm') || null, weight_lb: +v('#wt') || null, equipment: v('#eq') || null, hazmat: v('#hz') ? { is: true, class: v('#hz'), un: v('#un') } : { is: false },
    bol: v('#bol').split(',').map(s => s.trim()).filter(Boolean), notes: v('#notes') || null }; };
$('#send').onclick = async () => { if (missing().length) return check(); try { const load = loadFromForm(); await D.sendLoad($('#to').value, load); sentNote = '✅ sent ' + load.id + (D.lastPin ? ` · pickup PIN ${D.lastPin} — give it to the shipper only; the driver must enter it to mark Loaded` : '');
  for (const id of ['#ref', '#pName', '#pAddr', '#pLL', '#pWin', '#dNameS', '#dAddr', '#dLL', '#dWin', '#rate', '#comm', '#wt', '#eq', '#veh', '#hz', '#un', '#bol', '#notes']) $(id).value = ''; $('#lid').value = 'L-' + uid().slice(0, 6).toUpperCase(); check(); } catch (e) { $('#sendMsg').textContent = '⚠ ' + e.message; } };
const log = s => $('#log').textContent = new Date().toLocaleTimeString() + ' ' + s + '\n' + $('#log').textContent;
const VEH = { car: '🚗 Car', van: '🚐 Cargo Van', reefervan: '🧊 Reefer Van', box: '📦 Box Truck', semi: '🚛 Semi' };
const seen = new Set(), who = p => esc(p.driver?.name || 'Driver') + (VEH[p.driver?.truck?.vehicle] ? ' · ' + VEH[p.driver.truck.vehicle] : '') + (p.driver?.unit ? ' · Unit ' + esc(p.driver.unit) : ''), ago = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
// ETA estimate from the last ping (straight-line × 1.3 road factor at 35 mph) vs the appointment window
const pinOf = id => { try { return JSON.parse(localStorage.getItem('rr_load_pins') || '{}')[id] || ''; } catch { return ''; } };
function eta(p, L) { if (!p.last || ['delivered', 'cancelled', 'declined', 'offered'].includes(L.state)) return ''; const to = ['accepted', 'en_route_pickup'].includes(L.state) ? L.load.pickup : L.load.drop; if (/^arrived/.test(L.state)) return '';
  const mi = hav(p.last, to) * 1.3, t = Date.now() + mi / 35 * 3600e3, end = to.window?.end ? Date.parse(to.window.end) : null, cls = !end ? '' : t <= end - 15 * 60e3 ? 'ok' : t <= end ? 'warn' : 'late';
  return ` · <span class="eta-${cls}" data-eta="${cls}">ETA ≈ ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${mi.toFixed(0)} mi)${end ? cls === 'late' ? ' · LATE vs window' : cls === 'warn' ? ' · tight' : ' · on time' : ''}</span>`; }
function render() { const sel = $('#to').value; $('#to').innerHTML = '<option value="">Choose a paired driver…</option>' + D.drivers.filter(p => !p.unpaired).map(p => `<option value="${esc(p.session)}">${who(p)}</option>`).join(''); if (sel) $('#to').value = sel;
  $('#drivers').innerHTML = D.drivers.map(p => `<div class="drv" data-driver="${esc(p.driverPk)}"><b data-dname>${who(p)}</b> ${p.unpaired ? '(disconnected)' : ''} · location sharing: <b data-sharing>${p.sharing ? 'ON' : 'off — asked when they accept a load'}</b>
    ${p.last ? `<br><span data-loc>📍 last ping ${ago(p.last.t)}</span> <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${+p.last.lat}&mlon=${+p.last.lon}#map=14/${+p.last.lat}/${+p.last.lon}">map</a>` : ''}</div>`).join('') || 'None paired yet.';
  const others = s => D.drivers.filter(p => !p.unpaired && p.session !== s);
  $('#loads').innerHTML = D.drivers.flatMap(p => Object.values(D.loads(p.session)).map(L => `<div class="drv" data-load="${esc(L.load.id)}"><b>${esc(L.load.ref || L.load.id)}</b> → ${who(p)} · ${L.load.vehicle ? `<span data-lveh="${esc(L.load.vehicle)}">${VEH[L.load.vehicle] || esc(L.load.vehicle)}</span> · ` : ''}<b data-state="${esc(L.state)}">${esc(STATUS_LABEL[L.state] || L.state)}</b>${eta(p, L)}${pinOf(L.load.id) && !['loaded', 'en_route_drop', 'arrived_drop', 'delivered', 'cancelled', 'declined'].includes(L.state) ? ` · <span data-pin title="Give this to the shipper only — the driver enters it at the dock to mark Loaded">🔑 Pickup PIN <b>${esc(pinOf(L.load.id))}</b></span>` : ''}${L.counter ? ' · counter $' + (+L.counter.amount || 0) + ` <button data-cr="${esc(p.session)}|${esc(L.load.id)}|1">Accept counter</button> <button data-cr="${esc(p.session)}|${esc(L.load.id)}|0">Reject</button>` : ''}${L.reason ? ' · ' + esc(L.reason) : ''}
    <div style="font-size:12px;color:#aaa">${L.history.map(h => new Date(h.t).toLocaleTimeString() + ' ' + esc(h.status ? STATUS_LABEL[h.status] || h.status : h.action || h.type)).join(' → ')}</div>
    ${L.podMissing && L.state !== 'delivered' ? '<div class="late">⚠ Driver tried to deliver without full proof of delivery — not accepted</div>' : ''}
    ${L.pod ? `<div class="b-docs" data-rpod><figure><img class="pod" src="${esc(L.pod.photo)}" alt="POD photo"><img class="pod sig" src="${esc(L.pod.signature)}" alt="signature"><figcaption>Received by ${esc(L.pod.name)}${L.pod.pieces != null ? ' · ' + (+L.pod.pieces || 0) + ' pcs' : ''}${L.pod.damage ? ' · ⚠ ' + esc(L.pod.damage) : ''}</figcaption></figure></div>` : ''}
    <div class="b-msgs">${(L.msgs || []).slice(-10).map(m => `<div class="b-m ${m.from === 'driver' ? '' : 'me'}" data-rmsg>${esc(m.text)} <small>${new Date(m.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div>`).join('')}</div>
    ${['delivered', 'cancelled', 'declined'].includes(L.state) ? '' : `<div class="row"><input data-mi placeholder="Message driver" maxlength="500"><button data-ms="${esc(p.session)}">Send</button><button class="ghost" data-cancel="${esc(p.session)}">Cancel load</button>${others(p.session).length ? `<select data-rs><option value="">Reassign to…</option>${others(p.session).map(o => `<option value="${esc(o.session)}">${who(o)}</option>`).join('')}</select>` : ''}</div>`}</div>`)).join('');
  document.querySelectorAll('[data-cr]').forEach(b => b.onclick = () => { const [s, id, a] = b.dataset.cr.split('|'); D.send(s, { type: 'counter_reply', loadId: id, accept: a === '1' }); });
  document.querySelectorAll('#loads [data-load]').forEach(card => { const id = card.dataset.load;
    const ms = card.querySelector('[data-ms]'); if (ms) ms.onclick = () => { const i = card.querySelector('[data-mi]'); if (i.value.trim()) D.send(ms.dataset.ms, { type: 'msg', loadId: id, text: i.value.trim(), from: 'dispatch' }); };
    const cb = card.querySelector('[data-cancel]'); if (cb) cb.onclick = () => { if (confirm('Cancel this load? The driver is told right away.')) D.send(cb.dataset.cancel, { type: 'cancel', loadId: id }); };
    const rs = card.querySelector('[data-rs]'); if (rs) rs.onchange = async () => { const to = rs.value; if (!to) return; const from = cb.dataset.cancel, L = D.loads(from)[id]; await D.send(from, { type: 'cancel', loadId: id, reason: 'reassigned' });
      const nid = id.replace(/-R\d+$/, '') + '-R' + Date.now().toString(36).slice(-3).toUpperCase(); const { pinHash: _ph, ...rest } = L.load; await D.sendLoad(to, { ...rest, id: nid }); log('reassigned ' + id + ' → ' + nid); }; });
  for (const p of D.drivers) for (const m of D.logs[p.session] || []) if (!seen.has(m.id)) { seen.add(m.id); log(`${m.type}${m.action ? ' ' + m.action : ''}${m.status ? ' ' + m.status : ''}${m.loadId ? ' ' + m.loadId : ''}${m.load ? ' ' + m.load.id : ''}`); }
  check(); }
D.onChange(render); render(); setInterval(render, 30e3);
import * as cloud from './cloud.js';
(async () => { const c = await cloud.sb(); if (!c) { $('#sbSec').hidden = true; return; }
  const show = async () => { const id = await cloud.uid(); $('#sbAuth').hidden = !!id; $('#sbMain').hidden = !id; if (!id) return; const { data: u } = await c.auth.getUser(); const role = await cloud.myRole();
    $('#sbWho').textContent = u.user.email + ' (' + role + ')'; if (role !== 'dispatcher' && role !== 'admin') $('#bMsg').textContent = 'Driving your own truck too? Create a fleet in 👥 Fleet to dispatch from this account.'; draw(); };
  const draw = async () => { if (!window.RRF) await (await import('./fleet.js')).start(); else await (await import('./fleet.js')).refresh(); if (!window.RRB) (await import('./board.js')).start(); else window.RRB.refresh(); };
  const cred = () => ({ email: $('#sbEmail').value.trim(), password: $('#sbPass').value });
  $('#sbIn').onclick = async () => { const { error } = await c.auth.signInWithPassword(cred()); $('#sbMsg').textContent = error ? '⚠ ' + error.message : ''; show(); };
  $('#sbUp').onclick = async () => { const { data, error } = await c.auth.signUp({ ...cred(), options: { data: { role: 'dispatcher', display_name: $('#dName').value }, emailRedirectTo: location.href } }); $('#sbMsg').textContent = error ? '⚠ ' + error.message : data.session ? '' : '✅ Check your email to confirm, then sign in.'; show(); };
  $('#sbOut').onclick = async () => { await c.auth.signOut(); show(); };
  c.auth.onAuthStateChange(() => setTimeout(show, 0)); await show();
})();

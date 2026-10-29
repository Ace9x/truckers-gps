// design_v2 Part 2 behaviours (CSS in css/design2.css): recenter only after pan (#8), parked route overview via View Transition (#9),
// 2-snap route sheet (#10), truck-profile steppers (#11), search palette with truck stops / weigh stations / recents + fuel chips (#12), GPS-weak chip (#14).
import { eiaFor } from './trip.js';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MI = 1609.344, LSK = 'tn_recents';
export function start() { const S = window.TruckNav; if (!S) return;
  const recents = () => { try { return JSON.parse(localStorage.getItem(LSK) || '[]'); } catch { return []; } };
  let lastDest = null;
  setInterval(() => { const b = document.body;
    const acc = S.pos?.acc, chip = $('#gpsChip') || Object.assign(document.createElement('div'), { id: 'gpsChip', hidden: true }); if (!chip.isConnected) { chip.setAttribute('role', 'status'); b.appendChild(chip); }
    const weak = acc != null && acc > 50; if (chip.hidden === weak) chip.hidden = !weak; if (weak) chip.textContent = `GPS weak · ±${Math.round(acc)} m`;   // #14
    const d = S.dest; if (d && d !== lastDest && d.name && Number.isFinite(d.lat)) { lastDest = d; const r = [{ name: d.name, lat: d.lat, lon: d.lon ?? d.lng }, ...recents().filter(x => x.name !== d.name)].slice(0, 6); localStorage.setItem(LSK, JSON.stringify(r)); }
    palette(); sheet(); steppers(); }, 400);
  // #9 tap the maneuver banner while parked → route overview with a container transform
  $('#banner')?.addEventListener('click', () => { if (document.body.classList.contains('moving') || !S.route) return; const go = () => S.openPanel?.('routePanel');
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(go); else go(); });
  // #12 palette: shown in the search panel while the query is empty
  function palette() { const q = $('#q'), ul = $('#results'), sp = $('#searchPanel'); if (!q || !ul || !sp || sp.classList.contains('hidden') || q.value.trim().length >= 3) { $('#d2Pal')?.remove(); return; }
    const along = S.nav ? S.along || 0 : 0, pois = (S.pois || []).filter(p => p.along >= along - 200).sort((a, b) => a.along - b.along), stops = pois.filter(p => p.kind === 'stop').slice(0, 5), weigh = pois.filter(p => p.kind === 'weigh').slice(0, 3), rec = recents().slice(0, 4);
    const state = Object.entries(S.ifta || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'US', eia = S.eia && eiaFor(state, S.eia), lp = (S.prices?.() || {});
    const price = p => { const r = lp[p.id]; return r ? `$${(+r.price).toFixed(3)} · driver` : eia ? `~$${eia.price.toFixed(3)} area avg` : ''; };
    const key = JSON.stringify([stops.map(p => p.id), weigh.map(p => p.id), rec.map(r => r.name), eia?.price]); let box = $('#d2Pal'); if (box?.dataset.key === key) return;
    if (!box) { box = document.createElement('div'); box.id = 'd2Pal'; box.className = 'd2-pal'; ul.before(box); } box.dataset.key = key;
    const row = (k, i, label, sub, chip) => `<button type="button" data-pal="${k}:${i}"><span>${esc(label)}<small class="muted"> ${esc(sub)}</small></span>${chip ? `<span class="d2-chip">${esc(chip)}</span>` : ''}</button>`;
    box.innerHTML = (rec.length ? '<h4>Recent</h4>' + rec.map((r, i) => row('r', i, r.name, '')).join('') : '') +
      (stops.length ? '<h4>Truck stops on route</h4>' + stops.map((p, i) => row('s', i, p.name, `${((p.along - along) / MI).toFixed(0)} mi`, price(p))).join('') : '') +
      (weigh.length ? '<h4>Weigh stations on route</h4>' + weigh.map((p, i) => row('w', i, p.name, `${((p.along - along) / MI).toFixed(0)} mi`)).join('') : '') +
      (!rec.length && !stops.length && !weigh.length ? '<p class="small muted">Type an address. Truck stops and weigh stations on your route show here once a route is planned.</p>' : '') +
      (eia && stops.length ? `<p class="small muted">Fuel chips: driver-reported price when we have one, otherwise the EIA weekly average for ${esc(eia.area)} — not a station price.</p>` : '');
    box.querySelectorAll('[data-pal]').forEach(b => b.onclick = () => { const [k, i] = b.dataset.pal.split(':'), it = (k === 'r' ? rec : k === 's' ? stops : weigh)[+i]; if (!it) return; document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden')); S.setDest({ name: it.name, lat: it.lat, lon: it.lon }); }); }
  // #10 route sheet with 2 snaps (half / full), drag or tap the handle; velocity decides on release
  function sheet() { const rp = $('#routePanel'); if (!rp || rp.querySelector('.d2-handle')) return; if (!rp.classList.contains('snap-full')) rp.classList.add('snap-half');
    const h = document.createElement('button'); h.type = 'button'; h.className = 'd2-handle'; h.setAttribute('aria-label', 'Expand or collapse route options'); rp.prepend(h);
    let y0 = 0, t0 = 0; const snap = full => { rp.classList.toggle('snap-full', full); rp.classList.toggle('snap-half', !full); h.setAttribute('aria-expanded', String(full)); };
    h.onpointerdown = e => { y0 = e.clientY; t0 = performance.now(); h.setPointerCapture(e.pointerId); };
    h.onpointerup = e => { const dy = e.clientY - y0, v = dy / Math.max(1, performance.now() - t0); if (Math.abs(dy) < 6) snap(!rp.classList.contains('snap-full')); else snap(v < -0.3 || dy < -40 ? true : v > 0.3 || dy > 40 ? false : rp.classList.contains('snap-full')); };
    h.onkeydown = e => { if (e.key === 'ArrowUp') snap(true); if (e.key === 'ArrowDown') snap(false); }; }
  // #11 −/+ steppers on the truck profile numbers (values in JetBrains Mono)
  function steppers() { const f = $('#truckForm'); if (!f) return; f.querySelectorAll('input[type=number]:not([data-d2s])').forEach(inp => { inp.dataset.d2s = '1'; const w = document.createElement('span'); w.className = 'd2-step'; inp.before(w);
    const mk = (d, l) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.setAttribute('aria-label', (d < 0 ? 'Decrease ' : 'Increase ') + (inp.name || inp.id || 'value')); b.onclick = () => { const st = +inp.step || 1; inp.value = String(Math.max(inp.min !== '' ? +inp.min : -Infinity, Math.min(inp.max !== '' ? +inp.max : Infinity, (+inp.value || 0) + d * st))); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }; return b; };
    w.append(mk(-1, '−'), inp, mk(1, '+')); }); } }

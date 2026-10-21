// RigRoute Multi-stop Planner (Circuit/Spoke-style) — free: Photon geocoding, Valhalla truck matrix, on-device optimizer, on-device proof of delivery.
import { optimize, simulate, haversineMatrix, parseCSV, rowsToStops, parsePaste, fmtClock, hm, hav, encodePlan, decodePlan } from './plannerlogic.js';
const MATRIX = 'https://valhalla1.openstreetmap.de/sources_to_targets', PHOTON = 'https://photon.komoot.io/api/';
export function init(S, H) {
  const { esc, toast, say, map, closePanels } = H, $ = s => document.querySelector(s);
  const LSG = (k, d) => { try { return JSON.parse(localStorage.getItem('rr_' + k)) ?? d; } catch { return d; } }, LSS = (k, v) => localStorage.setItem('rr_' + k, JSON.stringify(v));
  const P = S.planner = { plan: LSG('plan', { name: 'My route', stops: [], opts: { lockFirst: false, lockLast: false, returnToStart: false, start: '08:00' } }), saved: LSG('plans', []), active: false, cur: -1, log: [] };
  const save = () => LSS('plan', P.plan); const uidS = () => Math.random().toString(36).slice(2, 9);
  // ---------- UI ----------
  const dockBtn = document.createElement('button'); dockBtn.id = 'plannerBtn'; dockBtn.innerHTML = '🗺<span>Stops</span>'; dockBtn.onclick = () => openP(); $('#dock')?.appendChild(dockBtn);
  const sec = document.createElement('section'); sec.id = 'plannerPanel'; sec.className = 'panel hidden';
  sec.innerHTML = `<div class="phead"><h2>Multi-stop route</h2><button class="close" id="plClose">✕</button></div>
  <div class="row"><input id="plName" placeholder="Route name" style="flex:1"><button id="plSave" class="small-btn">💾 Save</button><button id="plShare" class="small-btn">🔗 Share</button></div>
  <div class="row"><input id="plQ" type="search" placeholder="Add stop: address or place…" style="flex:1" autocomplete="off"><button id="plMic" class="small-btn" title="Add by voice">🎙</button></div>
  <ul id="plRes" class="results"></ul>
  <details id="plImport"><summary>Paste list / import CSV or spreadsheet</summary><textarea id="plPaste" rows="4" placeholder="One address per line — or paste rows copied from Excel/Sheets (with a header row: Name, Address, Window Start, Window End, Priority, Service Min, Packages, Notes)" style="width:100%"></textarea>
    <div class="row"><button id="plPasteGo" class="small-btn">Add pasted stops</button><label class="small-btn">📄 CSV/TSV file<input id="plFile" type="file" accept=".csv,.tsv,.txt,text/csv" hidden></label><label class="small-btn">📷 Photo of list<input id="plPhoto" type="file" accept="image/*" capture="environment" hidden></label></div>
    <small class="muted">Excel/Numbers: “Save as CSV” or copy-paste the cells. Photo entry reads text with the phone's built-in text detector when available.</small></details>
  <div class="row small"><label>Start <input id="plStart" type="time" value="08:00"></label><label><input type="checkbox" id="plLF"> Lock first</label><label><input type="checkbox" id="plLL"> Lock last</label><label><input type="checkbox" id="plRTS"> Return to start</label></div>
  <div class="row"><button id="plOpt" class="primary">⚡ Optimize</button><button id="plGo" class="primary">▶ Start route</button><button id="plClear" class="small-btn">Clear</button></div>
  <div id="plSum" class="small muted"></div><ol id="plList" class="pl-list"></ol>
  <details><summary>Saved routes</summary><ul id="plSaved" class="results"></ul></details>`;
  document.body.appendChild(sec);
  const bar = document.createElement('div'); bar.id = 'plBar'; bar.className = 'hidden';
  bar.innerHTML = `<div id="plBarT"></div><div class="row"><button data-a="arrive">📍 Arrived</button><button data-a="done" class="primary">✅ Complete</button><button data-a="fail" class="danger">✖ Failed</button><button data-a="skip">⏭ Skip</button><button data-a="list">☰</button></div>`;
  document.body.appendChild(bar);
  const pod = document.createElement('div'); pod.id = 'plPod'; pod.className = 'hidden';
  pod.innerHTML = `<div class="podbox"><h3 id="podT">Proof of delivery</h3><label class="small-btn">📷 Photo<input id="podPhoto" type="file" accept="image/*" capture="environment" hidden></label> <span id="podPh" class="small muted">no photo</span>
   <div class="small">Signature</div><canvas id="podSig" width="320" height="140"></canvas><div class="row"><button id="podClr" class="small-btn">Clear signature</button></div>
   <input id="podName" placeholder="Received by (name)"><textarea id="podNote" rows="2" placeholder="Note (left at side door, etc.)"></textarea>
   <div class="row"><button id="podSave" class="primary">Save & next stop</button><button id="podCancel" class="small-btn">Cancel</button></div></div>`;
  document.body.appendChild(pod);
  const st = document.createElement('style'); st.textContent = `#plannerPanel .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}#plannerPanel input,#plannerPanel textarea{background:#111;color:#eee;border:1px solid #333;border-radius:8px;padding:8px}
  .pl-list{list-style:none;padding:0;margin:6px 0}.pl-list li{display:flex;gap:8px;align-items:flex-start;padding:8px;border-bottom:1px solid #2a2a2a;background:var(--panel)}.pl-list li.drag{opacity:.6;outline:1px dashed #f80}
  .pl-n{min-width:26px;height:26px;border-radius:13px;background:#f80;color:#000;font-weight:700;display:flex;align-items:center;justify-content:center}.pl-list li.done .pl-n{background:#2c6}.pl-list li.failed .pl-n{background:#d33}.pl-list li.skipped .pl-n{background:#777}
  .pl-b{flex:1;min-width:0}.pl-b small{display:block;color:#aaa}.pl-h{cursor:grab;touch-action:none;padding:4px 6px;font-size:20px;color:#888}.late{color:#f55}.pl-ed{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px}.pl-ed input,.pl-ed select{font-size:12px;padding:4px!important;background:#111;color:#eee;border:1px solid #333;border-radius:6px}
  #plBar{position:fixed;left:8px;right:8px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:30;background:#151515ee;border:1px solid #f80;border-radius:14px;padding:10px;color:#eee}#plBar .row{display:flex;gap:6px}#plBar button{flex:1;min-height:52px;font-size:15px;border-radius:10px;border:0;background:#2a2a2a;color:#eee}#plBar .primary{background:#f80;color:#000}#plBar .danger{background:#a22}
  #plPod{position:fixed;inset:0;z-index:40;background:#000c;display:flex;align-items:center;justify-content:center}#plPod.hidden,#plBar.hidden{display:none}.podbox{background:#1a1a1a;color:#eee;padding:14px;border-radius:14px;width:min(360px,94vw);display:flex;flex-direction:column;gap:6px}#podSig{background:#fff;border-radius:8px;touch-action:none;width:100%}.podbox input,.podbox textarea{background:#111;color:#eee;border:1px solid #333;border-radius:8px;padding:8px}`;
  document.head.appendChild(st);
  function openP() { document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden')); sec.classList.remove('hidden'); render(); }
  $('#plClose').onclick = () => sec.classList.add('hidden');
  // ---------- geocoding ----------
  async function geocode(q) { const n = S.pos || { lat: 40.81, lon: -73.88 }; const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=${n.lat}&lon=${n.lon}`, { signal: AbortSignal.timeout(12000) }); const j = await r.json();
    return j.features.map(f => { const p = f.properties; return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city, sub: [p.housenumber && p.street ? p.housenumber + ' ' + p.street : p.street, p.city, p.state].filter(Boolean).join(', ') }; }); }
  const mkStop = o => ({ id: uidS(), name: o.name || o.address, address: o.sub || o.address || '', lat: o.lat, lon: o.lon, tw: o.tw || null, priority: o.priority || 2, service: o.service ?? 300, notes: o.notes || '', packages: o.packages || 0, phone: o.phone || '', status: 'pending' });
  function addStop(o) { P.plan.stops.push(mkStop(o)); P.result = null; save(); render(); }
  async function addMany(list) { let ok = 0, bad = []; toast(`Finding ${list.length} stops…`, 4000);
    for (const s of list) { if (s.lat != null && s.lon != null && !isNaN(s.lat)) { P.plan.stops.push(mkStop(s)); ok++; continue; }
      try { const r = (await geocode(s.address))[0]; if (r) { P.plan.stops.push(mkStop({ ...s, lat: r.lat, lon: r.lon, sub: s.address, name: s.name && s.name !== s.address ? s.name : (r.name || s.address) })); ok++; } else bad.push(s.address); } catch { bad.push(s.address); }
      await new Promise(r => setTimeout(r, 120)); }
    P.result = null; save(); render(); toast(`Added ${ok} stops` + (bad.length ? ` — couldn't find: ${bad.join('; ')}` : ''), 6000); return { ok, bad }; }
  P.addMany = addMany; P.addStop = addStop;
  let qt; $('#plQ').oninput = () => { clearTimeout(qt); qt = setTimeout(async () => { const q = $('#plQ').value.trim(), ul = $('#plRes'); if (q.length < 3) { ul.innerHTML = ''; return; }
    try { const res = await geocode(q); ul.innerHTML = ''; res.forEach(r => { const li = document.createElement('li'); li.innerHTML = `${esc(r.name)}<small>${esc(r.sub)}</small>`; li.onclick = () => { addStop(r); ul.innerHTML = ''; $('#plQ').value = ''; }; ul.appendChild(li); }); }
    catch { ul.innerHTML = '<li class="muted">Search needs signal</li>'; } }, 400); };
  $('#plPasteGo').onclick = () => { const t = $('#plPaste').value; const rows = parseCSV(t); const multi = rows[0]?.length > 1; addMany(multi ? rowsToStops(rows) : parsePaste(t)); $('#plPaste').value = ''; };
  $('#plFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (/\.xlsx?$/i.test(f.name)) return toast('Save the spreadsheet as CSV first'); addMany(rowsToStops(parseCSV(await f.text()))); e.target.value = ''; };
  $('#plPhoto').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (!('TextDetector' in window)) return toast('This phone has no built-in text reader — paste or type the list instead', 5000);
    try { const bmp = await createImageBitmap(f); const t = await new window.TextDetector().detect(bmp); const lines = t.map(x => x.rawValue).filter(x => /\d/.test(x) && x.length > 6); $('#plPaste').value = lines.join('\n'); $('#plImport').open = true; toast(`Read ${lines.length} lines — check them, then tap Add`); } catch { toast('Could not read the photo'); } };
  $('#plMic').onclick = () => { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return toast('Voice entry not supported in this browser'); const r = new SR(); r.lang = 'en-US';
    r.onresult = async ev => { const q = ev.results[0][0].transcript; $('#plQ').value = q; try { const g = (await geocode(q))[0]; if (g) { addStop(g); say?.('Added ' + g.name, 'info'); } else toast('Not found: ' + q); } catch { toast('Search needs signal'); } }; r.start(); toast('Say the address…'); };
  // ---------- optimize ----------
  async function matrix(pts) { try { const locs = pts.map(p => ({ lat: p.lat, lon: p.lon })); const body = { sources: locs, targets: locs, costing: 'truck', costing_options: S.truck && H.truckCosting ? { truck: H.truckCosting(S.truck) } : undefined };
      const r = await fetch(MATRIX, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); const j = await r.json(); if (!j.sources_to_targets) throw 0;
      const fb = haversineMatrix(pts); const time = j.sources_to_targets.map((row, a) => row.map((c, b) => c.time ?? fb.time[a][b])), dist = j.sources_to_targets.map((row, a) => row.map((c, b) => c.distance != null ? c.distance * 1000 : fb.dist[a][b]));
      return { time, dist, source: 'Valhalla truck' }; } catch { return haversineMatrix(pts); } }
  const traffic = () => { const f = S.trafficFactor?.() ?? S.traffic?.factor; return typeof f === 'number' && f > 0 ? f : null; };
  const opts = () => ({ lockFirst: $('#plLF').checked, lockLast: $('#plLL').checked, returnToStart: $('#plRTS').checked, startSec: hm($('#plStart').value) ?? 8 * 3600 });
  async function runOpt({ onlyPending = false, from = null } = {}) {
    const all = P.plan.stops, pend = onlyPending ? all.filter(s => s.status === 'pending') : all; if (!pend.length) return toast('Add stops first');
    const depot = from || P.plan.depot || S.pos || pend[0]; if (!onlyPending) P.plan.depot = { lat: depot.lat, lon: depot.lon };
    const nodes = [depot, ...pend], o = opts(); if (onlyPending) { o.lockFirst = false; const now = new Date(); o.startSec = now.getHours() * 3600 + now.getMinutes() * 60; }
    $('#plSum').textContent = 'Optimizing with truck travel times…'; const M = await matrix(nodes); const tf = traffic(); if (tf) M.time = M.time.map(r => r.map(x => x * tf));
    const before = simulate(pend.map((_, i) => i + 1), nodes, M, o), res = optimize(nodes, M, o);
    const ordered = res.order.map(i => pend[i - 1]); const done = all.filter(s => !pend.includes(s)); P.plan.stops = [...done, ...ordered];
    P.result = { ...res, M, nodes: [depot, ...ordered], before, src: M.source + (tf ? ' + live traffic' : '') }; P.plan.opts = { ...P.plan.opts, ...o }; save(); render(); drawMap(); return P.result; }
  P.optimize = runOpt;
  $('#plOpt').onclick = () => runOpt();
  function schedule() { const pend = P.plan.stops; if (!P.result || !pend.length) return null; const nodes = [P.result.nodes[0], ...pend];
    const idx = pend.map(s => P.result.nodes.indexOf(s)); if (idx.some(i => i < 1)) return null; const M = { time: [0, ...idx].map(a => [0, ...idx].map(b => P.result.M.time[a === 0 ? 0 : a][b === 0 ? 0 : b])), dist: [0, ...idx].map(a => [0, ...idx].map(b => P.result.M.dist[a][b])) };
    return simulate(pend.map((_, i) => i + 1), nodes, M, P.plan.opts.startSec ? P.plan.opts : opts()); }
  // ---------- render ----------
  function render() { $('#plName').value = P.plan.name; const ul = $('#plList'); ul.innerHTML = ''; const sc = schedule();
    P.plan.stops.forEach((s, k) => { const li = document.createElement('li'); li.className = s.status; li.dataset.k = k; const e = sc?.sched[k];
      li.innerHTML = `<span class="pl-h" title="Drag to reorder">⠿</span><span class="pl-n">${s.status === 'done' ? '✓' : s.status === 'failed' ? '✖' : k + 1}</span><div class="pl-b"><b>${esc(s.name)}</b>${s.priority === 1 ? ' <span class="late">★ high</span>' : ''}<small>${esc(s.address || '')}</small>
        <small>${e ? `ETA ${fmtClock(e.start)}${e.wait > 60 ? ` (wait ${Math.round(e.wait / 60)}m)` : ''}${e.late > 0 ? ` <span class="late">${Math.round(e.late / 60)} min late</span>` : ''} · ` : ''}${s.tw ? `window ${s.tw[0] != null ? fmtClock(s.tw[0]) : '…'}–${s.tw[1] != null ? fmtClock(s.tw[1]) : '…'} · ` : ''}${Math.round(s.service / 60)} min service${s.packages ? ` · 📦 ${s.packages}` : ''}${s.status !== 'pending' ? ' · ' + s.status : ''}</small>${s.notes ? `<small>📝 ${esc(s.notes)}</small>` : ''}
        <details><summary class="small">Edit</summary><div class="pl-ed"><label>Open<input type="time" data-f="o" value="${s.tw?.[0] != null ? new Date(s.tw[0] * 1000).toISOString().slice(11, 16) : ''}"></label><label>Close<input type="time" data-f="c" value="${s.tw?.[1] != null ? new Date(s.tw[1] * 1000).toISOString().slice(11, 16) : ''}"></label>
        <label>Priority<select data-f="p"><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select></label><label>Service min<input type="number" data-f="s" value="${Math.round(s.service / 60)}"></label><label>Packages<input type="number" data-f="k" value="${s.packages}"></label><label>Notes<input data-f="n" value="${esc(s.notes)}"></label></div>
        <div class="row"><button class="small-btn" data-x="nav">Navigate</button><button class="small-btn" data-x="up">▲</button><button class="small-btn" data-x="dn">▼</button><button class="small-btn" data-x="rm">Remove</button></div></details></div>`;
      li.querySelector('[data-f=p]').value = s.priority;
      li.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => { const v = inp.value, f = inp.dataset.f; if (f === 'o' || f === 'c') { s.tw = s.tw || [null, null]; s.tw[f === 'o' ? 0 : 1] = hm(v); if (s.tw[0] == null && s.tw[1] == null) s.tw = null; }
        if (f === 'p') s.priority = +v; if (f === 's') s.service = +v * 60; if (f === 'k') s.packages = +v; if (f === 'n') s.notes = v; save(); render(); });
      li.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { const x = b.dataset.x, a = P.plan.stops; if (x === 'rm') a.splice(k, 1); if (x === 'up' && k) [a[k - 1], a[k]] = [a[k], a[k - 1]]; if (x === 'dn' && k < a.length - 1) [a[k + 1], a[k]] = [a[k], a[k + 1]]; if (x === 'nav') return goTo(k); save(); render(); drawMap(); });
      dragify(li.querySelector('.pl-h'), li); ul.appendChild(li); });
    const tot = P.plan.stops.length, dn = P.plan.stops.filter(s => s.status === 'done').length, fl = P.plan.stops.filter(s => s.status === 'failed').length, pk = P.plan.stops.reduce((a, s) => a + (+s.packages || 0), 0);
    $('#plSum').innerHTML = !tot ? 'Add stops by search, voice, paste or CSV, then tap Optimize.' : `${tot} stops · ${dn} done${fl ? ` · ${fl} failed` : ''}${pk ? ` · 📦 ${pk}` : ''}` + (sc ? ` · ${(sc.dist / 1609).toFixed(1)} mi · ${Math.round(sc.drive / 60)} min driving · finish ≈ ${fmtClock(sc.end)}${sc.lateCount ? ` · <span class="late">${sc.lateCount} late</span>` : ''}` +
      (P.result?.before ? `<br>Optimized vs entered order: ${(P.result.before.dist / 1609).toFixed(1)} → ${(P.result.dist / 1609).toFixed(1)} mi · times from ${P.result.src}${P.result.src.includes('traffic') ? '' : ' (no live traffic data — typical speeds)'}` : '') : '');
    $('#plSaved').innerHTML = ''; P.saved.forEach((p, i) => { const li = document.createElement('li'); li.innerHTML = `${esc(p.name)}<small>${p.stops.length} stops · ${new Date(p.t).toLocaleDateString()}</small>`; li.onclick = () => { P.plan = { ...JSON.parse(JSON.stringify(p)), stops: p.stops.map(s => ({ ...s, status: 'pending', id: uidS() })) }; P.result = null; save(); render(); drawMap(); toast('Loaded ' + p.name); }; $('#plSaved').appendChild(li); });
    ['LF', 'LL', 'RTS'].forEach((k, i) => $('#pl' + k).checked = !!P.plan.opts[['lockFirst', 'lockLast', 'returnToStart'][i]]); }
  P.render = render;
  function dragify(h, li) { h.onpointerdown = e => { e.preventDefault(); h.setPointerCapture(e.pointerId); li.classList.add('drag'); const from = +li.dataset.k; let to = from;
    h.onpointermove = ev => { const items = [...$('#plList').children]; to = items.findIndex(x => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }); if (to < 0) to = items.length - 1; else if (to > from) to--; };
    h.onpointerup = () => { h.onpointermove = h.onpointerup = null; li.classList.remove('drag'); if (to !== from) { const a = P.plan.stops, [x] = a.splice(from, 1); a.splice(to, 0, x); save(); render(); drawMap(); } }; }; }
  P.move = (from, to) => { const a = P.plan.stops, [x] = a.splice(from, 1); a.splice(to, 0, x); save(); render(); drawMap(); };
  $('#plName').onchange = () => { P.plan.name = $('#plName').value || 'My route'; save(); };
  ['LF', 'LL', 'RTS'].forEach((k, i) => $('#pl' + k).onchange = () => { P.plan.opts[['lockFirst', 'lockLast', 'returnToStart'][i]] = $('#pl' + k).checked; save(); });
  $('#plClear').onclick = () => { if (!confirm('Clear all stops?')) return; P.plan.stops = []; P.result = null; save(); render(); drawMap(); };
  $('#plSave').onclick = () => { P.saved = [{ ...JSON.parse(JSON.stringify(P.plan)), t: Date.now() }, ...P.saved.filter(p => p.name !== P.plan.name)].slice(0, 30); LSS('plans', P.saved); render(); toast('Route saved'); };
  // ---------- share ----------
  P.shareURL = () => location.origin + location.pathname + '#plan=' + encodePlan(P.plan);
  $('#plShare').onclick = async () => { if (!P.plan.stops.length) return; const url = P.shareURL();
    if (S.link?.sendPlan) try { await S.link.sendPlan(P.plan); } catch {}
    try { if (navigator.share) await navigator.share({ title: 'RigRoute: ' + P.plan.name, text: `${P.plan.stops.length}-stop route`, url }); else { await navigator.clipboard.writeText(url); toast('Route link copied — send it to a driver, friend or dispatcher'); } } catch { prompt('Copy this route link:', url); } };
  function importHash() { const m = location.hash.match(/plan=([\w-]+)/); if (!m) return; try { const p = decodePlan(m[1]); P.plan = { name: p.name, stops: p.stops.map(s => ({ ...s, id: uidS() })), opts: P.plan.opts }; P.result = null; save(); history.replaceState(null, '', location.pathname); setTimeout(() => { openP(); drawMap(); toast(`Opened shared route “${p.name}” (${p.stops.length} stops)`); }, 800); } catch (e) { toast('Bad route link'); } }
  // ---------- dispatcher loads ----------
  P.openLoad = (load) => { const stops = (load.stops || []).map(s => mkStop({ name: s.name || s.facility || s.address, address: s.address || '', lat: s.lat, lon: s.lon, tw: s.tw || (s.window ? [hm(s.window[0] ?? s.window.from), hm(s.window[1] ?? s.window.to)] : (s.appt ? [hm(s.appt), null] : null)),
      priority: s.priority || (s.appt ? 1 : 2), service: (s.serviceMin ?? 30) * 60, notes: [s.type, s.ref, s.notes].filter(Boolean).join(' · '), packages: s.pieces || s.packages || 0 })).filter(s => s.lat != null);
    P.plan = { name: load.ref || load.title || 'Load ' + (load.id || ''), stops, opts: { ...P.plan.opts, lockFirst: stops.length > 1, lockLast: false }, loadId: load.id }; P.result = null; save(); openP(); drawMap(); toast(`Load opened in planner: ${stops.length} stops`); };
  window.addEventListener('rr:load', e => P.openLoad(e.detail));
  // ---------- map ----------
  function drawMap() { try { const fc = { type: 'FeatureCollection', features: P.plan.stops.map((s, k) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { n: String(k + 1), st: s.status } })) };
      const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [...(P.plan.depot ? [[P.plan.depot.lon, P.plan.depot.lat]] : []), ...P.plan.stops.map(s => [s.lon, s.lat])] } };
      if (!map.getSource('plStops')) { map.addSource('plStops', { type: 'geojson', data: fc }); map.addSource('plLine', { type: 'geojson', data: line });
        map.addLayer({ id: 'plLine', type: 'line', source: 'plLine', paint: { 'line-color': '#f80', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': .7 } });
        map.addLayer({ id: 'plDot', type: 'circle', source: 'plStops', paint: { 'circle-radius': 11, 'circle-color': ['match', ['get', 'st'], 'done', '#2c6', 'failed', '#d33', 'skipped', '#777', '#f80'], 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
        map.addLayer({ id: 'plNum', type: 'symbol', source: 'plStops', layout: { 'text-field': ['get', 'n'], 'text-size': 12, 'text-allow-overlap': true, 'text-font': ['Noto Sans Bold', 'Open Sans Bold'] }, paint: { 'text-color': '#000' } }); }
      else { map.getSource('plStops').setData(fc); map.getSource('plLine').setData(line); }
      if (P.plan.stops.length > 1 && !P.active) { const b = new maplibregl.LngLatBounds(); P.plan.stops.forEach(s => b.extend([s.lon, s.lat])); map.fitBounds(b, { padding: 60, duration: 0 }); } } catch (e) { console.warn('planner map', e); } }
  P.drawMap = drawMap; if (map.loaded()) drawMap(); else map.once('load', drawMap);
  // ---------- navigate stop by stop ----------
  const next = () => P.plan.stops.findIndex(s => s.status === 'pending');
  async function goTo(k) { const s = P.plan.stops[k]; if (!s) return finish(); P.active = true; P.cur = k; P.arrived = false; sec.classList.add('hidden'); updBar();
    say?.(`Stop ${k + 1}: ${s.name}`, 'info'); await S.setDest({ lat: s.lat, lon: s.lon, name: `Stop ${k + 1}: ${s.name}`, sub: s.address });
    if (S.route) { S.startNav?.(); } else toast('Route to this stop needs signal'); }
  P.goTo = goTo; P.start = () => { const k = next(); if (k < 0) return toast('No pending stops'); P.startedAt = P.startedAt || Date.now(); P.plan.startedAt = P.startedAt; save(); return goTo(k); };
  $('#plGo').onclick = () => P.plan.stops.length ? P.start() : toast('Add stops first');
  function updBar() { const s = P.plan.stops[P.cur]; if (!P.active || !s) { bar.classList.add('hidden'); return; } bar.classList.remove('hidden'); const left = P.plan.stops.filter(x => x.status === 'pending').length;
    const d = S.pos ? hav(S.pos, s) : null; $('#plBarT').innerHTML = `<b>Stop ${P.cur + 1}/${P.plan.stops.length}: ${esc(s.name)}</b> ${P.arrived ? '· 📍 arrived' : d != null ? '· ' + (d / 1609).toFixed(1) + ' mi' : ''}<br><small>${esc(s.address || '')}${s.packages ? ' · 📦 ' + s.packages : ''}${s.notes ? ' · ' + esc(s.notes) : ''} · ${left} left</small>`; }
  setInterval(() => { if (!P.active) return; const s = P.plan.stops[P.cur]; if (s && S.pos && !P.arrived && hav(S.pos, s) < 120) arrive(); updBar(); }, 2000);
  function arrive() { const s = P.plan.stops[P.cur]; if (!s || P.arrived) return; P.arrived = true; s.arrivedAt = Date.now(); save(); say?.(`Arrived at ${s.name}`, 'info'); try { S.endNav?.(); } catch {} updBar(); }
  async function mark(status, podData) { const s = P.plan.stops[P.cur]; if (!s) return; s.status = status; s.doneAt = Date.now(); if (podData) s.pod = podData.key; save(); P.log.push({ id: s.id, status }); try { S.endNav?.(); } catch {} drawMap(); render();
    const k = next(); if (k < 0) return finish(); setTimeout(() => goTo(k), 300); }
  P.mark = mark; P.arrive = arrive;
  bar.onclick = e => { const a = e.target.closest('button')?.dataset.a; if (!a) return; if (a === 'arrive') arrive(); if (a === 'done') openPod(); if (a === 'fail') { const why = prompt('Why did this stop fail? (closed, no one home, refused…)') || 'failed'; P.plan.stops[P.cur].failReason = why; mark('failed'); }
    if (a === 'skip') { const s = P.plan.stops[P.cur]; const a2 = P.plan.stops; a2.splice(P.cur, 1); a2.push(s); save(); try { S.endNav?.(); } catch {} toast('Skipped — moved to the end. Re-optimizing the rest…'); runOpt({ onlyPending: true, from: S.pos }).then(() => goTo(next())); }
    if (a === 'list') { openP(); } };
  function finish() { P.active = false; bar.classList.add('hidden'); try { S.endNav?.(); } catch {} const st = P.plan.stops, dn = st.filter(s => s.status === 'done').length, fl = st.filter(s => s.status === 'failed').length;
    const mins = P.startedAt ? Math.round((Date.now() - P.startedAt) / 60000) : 0; const sum = `Route complete: ${dn} delivered, ${fl} failed of ${st.length} stops${mins ? ` in ${Math.floor(mins / 60)}h ${mins % 60}m` : ''}.`; P.summary = { done: dn, failed: fl, total: st.length, mins, mi: P.result ? +(P.result.dist / 1609).toFixed(1) : null }; say?.(sum, 'info'); toast(sum, 8000); openP(); P.startedAt = null; }
  // ---------- proof of delivery (IndexedDB, on device only) ----------
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('rr-pod', 1); r.onupgradeneeded = () => r.result.createObjectStore('pod'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  P.podPut = async (k, v) => { const db = await idb(); return new Promise(r => { const t = db.transaction('pod', 'readwrite'); t.objectStore('pod').put(v, k); t.oncomplete = r; }); };
  P.podGet = async k => { const db = await idb(); return new Promise(r => { const q = db.transaction('pod').objectStore('pod').get(k); q.onsuccess = () => r(q.result); }); };
  const cv = $('#podSig'), cx = cv.getContext('2d'); let drawing = false, inked = false, photo = null; cx.lineWidth = 2.5; cx.lineCap = 'round';
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { drawing = true; cv.setPointerCapture(e.pointerId); cx.beginPath(); cx.moveTo(...pt(e)); }; cv.onpointermove = e => { if (!drawing) return; cx.lineTo(...pt(e)); cx.stroke(); inked = true; }; cv.onpointerup = () => drawing = false;
  $('#podClr').onclick = () => { cx.clearRect(0, 0, cv.width, cv.height); inked = false; };
  $('#podPhoto').onchange = async e => { const f = e.target.files[0]; if (!f) return; const img = await createImageBitmap(f), sc = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * sc; c.height = img.height * sc; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); photo = c.toDataURL('image/jpeg', .7); $('#podPh').textContent = '✓ photo attached'; };
  function openPod() { const s = P.plan.stops[P.cur]; $('#podT').textContent = 'Proof of delivery — ' + s.name; photo = null; inked = false; cx.clearRect(0, 0, cv.width, cv.height); $('#podPh').textContent = 'no photo'; $('#podNote').value = ''; $('#podName').value = ''; pod.classList.remove('hidden'); }
  P.openPod = openPod;
  $('#podCancel').onclick = () => pod.classList.add('hidden');
  $('#podSave').onclick = async () => { const s = P.plan.stops[P.cur], key = 'pod_' + s.id + '_' + Date.now();
    const rec = { stop: s.name, address: s.address, t: Date.now(), pos: S.pos ? { lat: S.pos.lat, lon: S.pos.lon } : null, photo, signature: inked ? cv.toDataURL('image/png') : null, receivedBy: $('#podName').value, note: $('#podNote').value };
    await P.podPut(key, rec); pod.classList.add('hidden'); toast('Proof of delivery saved on this phone'); mark('done', { key }); };
  importHash(); window.addEventListener('hashchange', importHash);
  P.ready = true;
}

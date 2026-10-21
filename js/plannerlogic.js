// RigRoute multi-stop planner logic (pure, testable). Time-window TSP: multi-start construction + 2-opt + or-opt, exact for n<=9.
export const hm = s => { if (s == null || s === '') return null; if (typeof s === 'number') return s; const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i); if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h * 3600 + mi * 60; };
export const fmtClock = sec => { const d = new Date(0); d.setUTCSeconds(Math.round(sec)); let h = d.getUTCHours(), m = d.getUTCMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; };
const R = 6371000, rad = x => x * Math.PI / 180;
export const hav = (a, b) => { const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon), s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
// Fallback matrix when Valhalla is unreachable: road factor 1.35, truck avg 40 km/h.
export function haversineMatrix(pts) { const d = pts.map(a => pts.map(b => hav(a, b) * 1.35)); return { dist: d, time: d.map(r => r.map(x => x / 11.1)), source: 'estimate' }; }

// Simulate a visiting order. nodes[0] = start (depot). order = indices into nodes (excluding 0). Returns schedule + cost.
// stop fields: tw:[open,close] secs-of-day | null, service secs, priority 1(high)..3(low)
export function simulate(order, nodes, M, { startSec = 8 * 3600, returnToStart = false } = {}) {
  let t = startSec, cur = 0, drive = 0, dist = 0, late = 0, wait = 0, lateCount = 0; const sched = [];
  order.forEach((i, k) => { const leg = M.time[cur][i]; drive += leg; dist += M.dist[cur][i]; t += leg; const s = nodes[i], arr = t; let w = 0;
    if (s.tw?.[0] != null && t < s.tw[0]) { w = s.tw[0] - t; t = s.tw[0]; wait += w; }
    let l = 0; if (s.tw?.[1] != null && t > s.tw[1]) { l = t - s.tw[1]; late += l * (s.priority === 1 ? 3 : s.priority === 3 ? 0.5 : 1); lateCount++; }
    sched.push({ i, arrive: arr, start: t, wait: w, late: l, leg }); t += s.service || 0; cur = i; });
  if (returnToStart) { drive += M.time[cur][0]; dist += M.dist[cur][0]; t += M.time[cur][0]; }
  // priority: high-priority stops earlier is a mild tie-breaker
  const prio = order.reduce((a, i, k) => a + (nodes[i].priority === 1 ? k * 30 : 0), 0);
  return { sched, drive, dist, end: t, late, lateCount, wait, cost: drive + wait * 0.5 + late * 20 + prio };
}
function perms(a) { if (a.length <= 1) return [a]; const o = []; a.forEach((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).forEach(p => o.push([x, ...p]))); return o; }
// opts: lockFirst (bool: nodes[1] stays first), lockLast (nodes[n-1] stays last), returnToStart, startSec
export function optimize(nodes, M, opts = {}) {
  const n = nodes.length; let ids = [...Array(n).keys()].slice(1); if (!ids.length) return { order: [], ...simulate([], nodes, M, opts) };
  const lockedFirst = opts.lockFirst ? ids[0] : null, lockedLast = opts.lockLast && ids.length > 1 ? ids.at(-1) : null;
  const free = ids.filter(i => i !== lockedFirst && i !== lockedLast);
  const wrap = mid => [...(lockedFirst != null ? [lockedFirst] : []), ...mid, ...(lockedLast != null ? [lockedLast] : [])];
  const cost = mid => simulate(wrap(mid), nodes, M, opts).cost;
  let best;
  if (free.length <= 8) { let bc = Infinity; for (const p of perms(free)) { const c = cost(p); if (c < bc) { bc = c; best = p; } } }
  else {
    let bc = Infinity; const starts = [...free].sort(() => 0).slice(0, Math.min(free.length, 12));
    const cands = [free.slice().sort((a, b) => (nodes[a].tw?.[1] ?? 9e9) - (nodes[b].tw?.[1] ?? 9e9))];
    for (const s of starts) { const rest = free.filter(x => x !== s), o = [s]; while (rest.length) { const last = o.at(-1); let bi = 0;
        rest.forEach((x, j) => { if (M.time[last][x] < M.time[last][rest[bi]]) bi = j; }); o.push(rest.splice(bi, 1)[0]); } cands.push(o); }
    for (let o of cands) { let c = cost(o), imp = true;
      while (imp) { imp = false;
        for (let i = 0; i < o.length - 1; i++) for (let j = i + 1; j < o.length; j++) { const q = [...o.slice(0, i), ...o.slice(i, j + 1).reverse(), ...o.slice(j + 1)], qc = cost(q); if (qc < c - 1e-6) { o = q; c = qc; imp = true; } }
        for (let i = 0; i < o.length; i++) for (let j = 0; j < o.length; j++) { if (i === j) continue; const q = o.slice(); const [x] = q.splice(i, 1); q.splice(j, 0, x); const qc = cost(q); if (qc < c - 1e-6) { o = q; c = qc; imp = true; } } }
      if (c < bc) { bc = c; best = o; } }
  }
  const order = wrap(best); return { order, ...simulate(order, nodes, M, opts) };
}
// CSV / paste parsing
export function parseCSV(text) { const rows = []; let row = [], f = '', q = false; const d = /\t/.test(text.split('\n')[0]) ? '\t' : ',';
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === d) { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows.filter(r => r.some(x => x.trim())); }
const COLS = { address: /^(address|addr|street|location|stop|destination)$/i, name: /^(name|customer|recipient|company|stop name)$/i, lat: /^(lat|latitude)$/i, lon: /^(lon|lng|long|longitude)$/i,
  open: /^(open|start|window start|from|earliest|tw_start|window_start)$/i, close: /^(close|end|window end|to|latest|tw_end|window_end)$/i, priority: /^(priority|prio)$/i, service: /^(service|service min|service_min|service time|duration)$/i,
  notes: /^(notes?|comments?|instructions)$/i, packages: /^(packages?|pkgs?|qty|quantity|pieces|pallets|count)$/i, phone: /^(phone|tel)$/i };
export function rowsToStops(rows) { if (!rows.length) return []; const head = rows[0].map(h => h.trim()), map = {};
  head.forEach((h, i) => { for (const [k, re] of Object.entries(COLS)) if (re.test(h) && map[k] == null) map[k] = i; });
  const hasHead = Object.keys(map).length > 0, body = hasHead ? rows.slice(1) : rows; if (!hasHead) map.address = 0;
  return body.map(r => { const g = k => map[k] != null ? (r[map[k]] || '').trim() : ''; const pr = g('priority').toLowerCase();
    return { address: g('address'), name: g('name') || g('address'), lat: g('lat') ? +g('lat') : null, lon: g('lon') ? +g('lon') : null,
      tw: (g('open') || g('close')) ? [hm(g('open')), hm(g('close'))] : null, priority: /^(1|high|h|urgent)$/.test(pr) ? 1 : /^(3|low|l)$/.test(pr) ? 3 : 2,
      service: g('service') ? +g('service') * 60 : 300, notes: g('notes'), packages: g('packages') ? +g('packages') : 0, phone: g('phone') }; }).filter(s => s.address || s.lat != null); }
export const parsePaste = t => t.split(/\n|;/).map(s => s.trim().replace(/^\d+[.)]\s*/, '')).filter(s => s.length > 3).map(a => ({ address: a, name: a, priority: 2, service: 300, packages: 0, notes: '', tw: null }));
// URL-safe share encoding
export const encodePlan = p => btoa(unescape(encodeURIComponent(JSON.stringify({ n: p.name, s: p.stops.map(s => [s.name, +s.lat.toFixed(5), +s.lon.toFixed(5), s.tw, s.priority, s.service, s.notes, s.packages]) })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodePlan = c => { const j = JSON.parse(decodeURIComponent(escape(atob(c.replace(/-/g, '+').replace(/_/g, '/'))))); return { name: j.n, stops: j.s.map(([name, lat, lon, tw, priority, service, notes, packages]) => ({ name, address: name, lat, lon, tw, priority, service, notes, packages, status: 'pending' })) }; };

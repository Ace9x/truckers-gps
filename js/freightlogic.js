// Pure freight logic shared by the driver app and the dispatch board (unit-tested).
export const hav = (a, b) => { const R = 6371e3, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
export function stopsOf(l) { if (Array.isArray(l.stops) && l.stops.length) return l.stops;
  return [{ kind: 'pickup', address: l.pickup_address, lat: l.pickup_lat, lng: l.pickup_lng, appt: l.pickup_at }, { kind: 'drop', address: l.dropoff_address, lat: l.dropoff_lat, lng: l.dropoff_lng, appt: l.dropoff_at }]; }
export const nextIdx = stops => { const i = stops.findIndex(s => !s.departed_at); return i < 0 ? null : i; };
// Detention: clock starts at the later of arrival and appointment; first free_min minutes free; billed per started 15 min.
export function detention(stop, { free_min = 120, rate_hr = 50 } = {}, now = Date.now()) { if (!stop?.arrived_at) return null;
  const arr = Date.parse(stop.arrived_at), appt = stop.appt ? Date.parse(stop.appt) : arr, start = Math.max(arr, appt), end = stop.departed_at ? Date.parse(stop.departed_at) : now;
  const onSite = Math.max(0, end - arr) / 60e3, clock = Math.max(0, end - start) / 60e3, billMin = Math.max(0, clock - free_min), q = Math.ceil(billMin / 15) * 15;
  return { onSiteMin: Math.round(onSite), freeLeftMin: Math.max(0, Math.round(free_min - clock)), billMin: Math.ceil(billMin), amount: +(q / 60 * rate_hr).toFixed(2), running: !stop.departed_at, early: arr < appt }; }
export const isLate = (stop, now = Date.now()) => !!stop?.appt && !stop.arrived_at && Date.parse(stop.appt) < now;
export function boardSort(loads, now = Date.now()) { const rank = l => { if (['delivered', 'declined', 'cancelled'].includes(l.status)) return 3; const s = stopsOf(l), i = nextIdx(s); if (i != null && isLate(s[i], now)) return 0; return l.status === 'offered' ? 2 : 1; };
  return [...loads].sort((a, b) => rank(a) - rank(b) || Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0)); }
export function tempStatus(f, reefer) { if (!reefer || f == null || isNaN(f)) return 'ok'; const min = reefer.min ?? reefer.setpoint - 2, max = reefer.max ?? reefer.setpoint + 2; return f < min ? 'low' : f > max ? 'high' : 'ok'; }
// Optimize the order of stops: nearest-neighbour from `from`, never visiting a drop before every pickup is done; first/last fixed if asked.
export function optimize(stops, from, { keepFirst = true } = {}) { if (stops.length < 3) return stops.slice(); const done = stops.filter(s => s.departed_at || s.arrived_at), todo = stops.filter(s => !(s.departed_at || s.arrived_at));
  const out = [...done]; let cur = done.at(-1) || (keepFirst ? todo.shift() : null) || null; if (cur && !done.includes(cur)) out.push(cur); let at = cur || from;
  while (todo.length) { const pickLeft = todo.some(s => s.kind === 'pickup'); const cand = todo.filter(s => !pickLeft || s.kind === 'pickup'); cand.sort((a, b) => hav(at, a) - hav(at, b)); const n = cand[0]; todo.splice(todo.indexOf(n), 1); out.push(n); at = n; }
  return out; }
export const routeLen = (stops, from) => stops.reduce((a, s, i) => a + hav(i ? stops[i - 1] : from || s, s), 0);
export function move(stops, i, d) { const j = i + d; if (j < 0 || j >= stops.length || stops[i].arrived_at || stops[j].arrived_at) return stops; const s = stops.slice(); [s[i], s[j]] = [s[j], s[i]]; return s; }
// Weekly settlement (Mon–Sun, America/New_York): delivered loads' rate + billable detention + lumper reimbursements.
export function weekKey(t) { const d = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York' })); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function settlement(loads, docs = []) { const weeks = {};
  for (const l of loads) { if (l.status !== 'delivered') continue; const s = stopsOf(l), end = s.at(-1)?.departed_at || l.updated_at, k = weekKey(end), w = weeks[k] ||= { week: k, loads: [], linehaul: 0, detention: 0, lumper: 0, total: 0 };
    const det = s.reduce((a, st) => a + (detention(st, l.detention)?.amount || 0), 0), lum = docs.filter(d => d.load_id === l.id && d.body?.type === 'lumper').reduce((a, d) => a + (+d.body.amount || 0), 0);
    w.loads.push({ id: l.id, ref: l.ref, rate: +l.rate_usd || 0, detention: det, lumper: lum, docs: docs.filter(d => d.load_id === l.id).map(d => d.body.type) }); w.linehaul += +l.rate_usd || 0; w.detention += det; w.lumper += lum; }
  for (const w of Object.values(weeks)) w.total = +(w.linehaul + w.detention + w.lumper).toFixed(2);
  return Object.values(weeks).sort((a, b) => b.week.localeCompare(a.week)); }
export const STAGE_LABEL = st => !st ? 'Not started' : st === 'delivered' ? 'Delivered' : st.startsWith('at_stop_') ? 'At stop ' + st.slice(8) : st.startsWith('to_stop_') ? 'En route to stop ' + st.slice(8) : st;

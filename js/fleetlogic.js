// Pure helpers for the dispatcher console (unit-tested).
export const pinHashHex = async (id, pin) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('rr-pin:' + id + ':' + String(pin).trim())); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); };
export const stopsOf = l => Array.isArray(l.stops) && l.stops.length ? l.stops : [{ kind: 'pickup', address: l.pickup_address, lat: l.pickup_lat, lng: l.pickup_lng, appt: l.pickup_at }, { kind: 'drop', address: l.dropoff_address, lat: l.dropoff_lat, lng: l.dropoff_lng, appt: l.dropoff_at }];
const T = x => x ? Date.parse(x) : NaN;
// detention: minutes on site past the free time, billed per started 15 min
export function detention(stop, det = { free_min: 120, rate_hr: 50 }) { const a = T(stop.arrived_at), d = T(stop.departed_at) || Date.now(); if (!Number.isFinite(a)) return { min: 0, over: 0, usd: 0 };
  const min = Math.max(0, (d - a) / 60e3), over = Math.max(0, min - (det?.free_min ?? 120)), billed = Math.ceil(over / 15) * 15; return { min: Math.round(min), over: Math.round(over), usd: +(billed / 60 * (det?.rate_hr ?? 50)).toFixed(2) }; }
export function invoiceLines(loads) { return loads.map(l => { const st = stopsOf(l), det = st.reduce((s, x) => s + detention(x, l.detention).usd, 0), a = st[0], z = st.at(-1);
  return { load: l.id, ref: l.ref || l.id.slice(0, 8), route: `${a.address || ''} → ${z.address || ''}`, delivered: z.departed_at || l.updated_at, linehaul: +(+l.rate_usd || 0).toFixed(2), detention: +det.toFixed(2), total: +((+l.rate_usd || 0) + det).toFixed(2) }; }); }
const q = v => /[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');
export const invoiceCSV = (inv, lines) => ['Invoice,' + q(inv.number), 'Customer,' + q(inv.customerName || ''), 'Date,' + q(new Date(inv.created_at || Date.now()).toISOString().slice(0, 10)), '', 'Ref,Route,Delivered,Linehaul USD,Detention USD,Total USD',
  ...lines.map(x => [x.ref, x.route, x.delivered ? new Date(x.delivered).toISOString().slice(0, 10) : '', x.linehaul.toFixed(2), x.detention.toFixed(2), x.total.toFixed(2)].map(q).join(',')), '', 'Total,,,,,' + lines.reduce((s, x) => s + x.total, 0).toFixed(2)].join('\n');
// on time = arrived at the last stop no later than appointment + 15 min grace
export function stats(loads, now = Date.now(), days = 30) { const since = now - days * 864e5, L = loads.filter(l => T(l.created_at) >= since), del = L.filter(l => l.status === 'delivered');
  let ot = 0, otN = 0, det = 0; for (const l of del) { const st = stopsOf(l), z = st.at(-1); if (z.appt && z.arrived_at) { otN++; if (T(z.arrived_at) <= T(z.appt) + 15 * 60e3) ot++; } det += st.reduce((s, x) => s + detention(x, l.detention).usd, 0); }
  const rev = del.reduce((s, l) => s + (+l.rate_usd || 0), 0); return { loads: L.length, delivered: del.length, active: L.filter(l => ['accepted', 'in_transit'].includes(l.status)).length, revenue: +rev.toFixed(2), detention: +det.toFixed(2), onTimePct: otN ? Math.round(ot / otN * 100) : null, onTimeN: otN, perLoad: del.length ? +(rev / del.length).toFixed(2) : 0 }; }
// today's schedule in New York time: every stop with an appointment today, sorted
export function schedule(loads, day = new Date(), tz = 'America/New_York') { const key = d => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d), k = key(day), out = [];
  for (const l of loads) { if (['declined', 'cancelled'].includes(l.status)) continue; stopsOf(l).forEach((s, i) => { if (s.appt && key(new Date(s.appt)) === k) out.push({ load: l, idx: i, stop: s, t: T(s.appt), done: !!s.departed_at, here: !!s.arrived_at && !s.departed_at }); }); }
  return out.sort((a, b) => a.t - b.t); }
export const nextStop = l => { const st = stopsOf(l); const i = st.findIndex(s => !s.departed_at); return i < 0 ? null : { i, s: st[i] }; };
export const VCOST = v => v === 'car' ? 'auto' : 'truck';

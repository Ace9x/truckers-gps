// Freshness labels for live data (nav_ux_principles.md addendum: "2 min ago", grey after threshold).
export function freshness(t, now = Date.now(), staleMin = 10) { if (!t) return { text: 'no time', stale: true };
  const s = Math.max(0, (now - t) / 1000), m = Math.round(s / 60);
  const text = s < 60 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  return { text, stale: m >= staleMin }; }
export const ageHTML = (t, staleMin, now) => { const f = freshness(t, now, staleMin); return `<span class="age${f.stale ? ' stale' : ''}" data-t="${t || 0}" data-stale="${staleMin ?? 10}">${f.text}</span>`; };
// Trip receipt (addendum "trust receipts"): auditable miles by state, route, stops. Planned state split is scaled to the miles actually driven.
export function receipt({ id, unit = '', odoStart = null, start, end, drivenMi = 0, plannedByState = {}, via = '', stops = [], dest = '', reports = 0, tolls = 0 }) {
  const planned = Object.values(plannedByState).reduce((a, b) => a + b, 0), k = planned > 0 ? drivenMi / planned : 0;
  // State miles must add up to the total: largest-remainder rounding in tenths; unknown split -> one "Unknown" line.
  const total10 = Math.round(drivenMi * 10); let states;
  if (planned > 0 && total10 > 0) { const raw = Object.entries(plannedByState).map(([st, mi]) => ({ st, x: mi * k * 10 })); const fl = raw.map(r => ({ st: r.st, t: Math.floor(r.x), rem: r.x - Math.floor(r.x) }));
    let left = total10 - fl.reduce((a, b) => a + b.t, 0); for (const r of [...fl].sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; r.t++; left--; }
    states = fl.filter(r => r.t > 0).map(r => ({ st: r.st, mi: r.t / 10 })).sort((a, b) => b.mi - a.mi); }
  else states = total10 > 0 ? [{ st: 'Unknown', mi: total10 / 10 }] : [];
  const min = Math.max(0, Math.round((end - start) / 60e3));
  return { id: id || receiptId(start), unit, odoStart, odoEnd: odoStart != null && odoStart !== '' ? Math.round((+odoStart + Math.round(drivenMi * 10) / 10) * 10) / 10 : null, start, end, min, dur: `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`, miles: Math.round(drivenMi * 10) / 10, avgMph: min ? Math.round(drivenMi / (min / 60)) : 0, states, via, stops, dest, reports, tolls,
    csv: '' }; }
export const receiptId = t => 'RR-' + new Date(t || Date.now()).toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(((t || 0) / 1000) % 1e5).toString(36).toUpperCase().padStart(4, '0');
export function receiptCSV(r) { const q = v => /[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');
  const rows = [['receipt_id', r.id], ['unit', r.unit], ['start', new Date(r.start).toISOString()], ['end', new Date(r.end).toISOString()], ['destination', r.dest], ['route', r.via], ['odometer_start', r.odoStart ?? ''], ['odometer_end', r.odoEnd ?? ''], ['total_miles', r.miles.toFixed(1)], [], ['state', 'miles'], ...r.states.map(s => [s.st, s.mi.toFixed(1)]), ['TOTAL', r.states.reduce((a, b) => a + b.mi * 10, 0) / 10]];
  return rows.map(x => x.map(q).join(',')).join('\n') + '\n'; }

// Freshness labels for live data (nav_ux_principles.md addendum: "2 min ago", grey after threshold).
export function freshness(t, now = Date.now(), staleMin = 10) { if (!t) return { text: 'no time', stale: true };
  const s = Math.max(0, (now - t) / 1000), m = Math.round(s / 60);
  const text = s < 60 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  return { text, stale: m >= staleMin }; }
export const ageHTML = (t, staleMin, now) => { const f = freshness(t, now, staleMin); return `<span class="age${f.stale ? ' stale' : ''}" data-t="${t || 0}" data-stale="${staleMin ?? 10}">${f.text}</span>`; };
// Trip receipt (addendum "trust receipts"): auditable miles by state, route, stops. Planned state split is scaled to the miles actually driven.
export function receipt({ start, end, drivenMi = 0, plannedByState = {}, via = '', stops = [], dest = '', reports = 0, tolls = 0 }) {
  const planned = Object.values(plannedByState).reduce((a, b) => a + b, 0), k = planned > 0 ? drivenMi / planned : 0;
  const states = Object.entries(plannedByState).map(([st, mi]) => ({ st, mi: Math.round(mi * k * 10) / 10 })).filter(x => x.mi > 0).sort((a, b) => b.mi - a.mi);
  const min = Math.max(0, Math.round((end - start) / 60e3));
  return { start, end, min, dur: `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`, miles: Math.round(drivenMi * 10) / 10, avgMph: min ? Math.round(drivenMi / (min / 60)) : 0, states, via, stops, dest, reports, tolls,
    csv: [['state', 'miles'], ...states.map(s => [s.st, s.mi])].map(r => r.join(',')).join('\n') }; }

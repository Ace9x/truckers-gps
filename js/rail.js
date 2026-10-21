// Restriction rail (UX spec §1, Trucker Path pattern): up to 3 upcoming clearance / weight / length / hazmat / weigh-station chips with distance.
export const MI = 1609.344;
const VAL = { height: s => (s.match(/(\d+'\s?\d*"?)/) || [])[1], weight: s => (s.match(/(\d+)\s*k|(\d+)\s*thousand/i) || []).slice(1).find(Boolean)?.concat('k'), length: s => (s.match(/(\d+)\s*ft/) || [])[1]?.concat("'") };
export function railItems({ dangers = [], pois = [], along = 0, horizonM = 50 * MI, max = 3 } = {}) {
  const items = [];
  for (const d of dangers) if (['height', 'weight', 'length', 'hazmat', 'notrucks'].includes(d.kind)) items.push({ kind: d.kind, sev: d.sev, at: d.along, value: d.kind === 'hazmat' ? 'No HM' : d.kind === 'notrucks' ? 'No trk' : VAL[d.kind]?.(d.short || d.text || '') || '', label: d.short || d.kind });
  for (const p of pois) if (p.kind === 'weigh') items.push({ kind: 'weigh', sev: p.status === 'open' ? 'warn' : 'info', at: p.along, value: p.status === 'open' ? 'Open' : p.status === 'closed' ? 'Closed' : 'Scale', label: p.name || 'Weigh station' });
  return items.filter(x => x.at != null && x.at - along > 0 && x.at - along <= horizonM).sort((a, b) => a.at - b.at).slice(0, max).map(x => ({ ...x, dist: x.at - along })); }
export const distLabel = (m, units = 'mi') => units === 'km' ? (m < 950 ? Math.round(m / 50) * 50 + ' m' : (m / 1000).toFixed(m < 9500 ? 1 : 0) + ' km') : (m < 0.95 * MI ? (Math.round(m / MI * 10) / 10 || 0.1) + ' mi' : Math.round(m / MI) + ' mi');

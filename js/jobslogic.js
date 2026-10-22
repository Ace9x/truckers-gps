// Pure driver-tools logic (unit-tested): parking freshness, HOS-vs-route parking pick, credential expiry levels.
export const PARK_TTL = 4 * 3600e3;
export function parkingNow(reports, now = Date.now()) { const r = reports.filter(x => now - Date.parse(x.t) < PARK_TTL).sort((a, b) => Date.parse(b.t) - Date.parse(a.t))[0]; return r ? { status: r.status, t: r.t, ageMin: Math.round((now - Date.parse(r.t)) / 60e3), n: reports.filter(x => now - Date.parse(x.t) < PARK_TTL).length } : null; }
// When remaining drive time on the route exceeds legal drive time left: how short, and the last parking reachable before the clock runs out (skipping lots reported full).
export function hosParking({ pois, along, length, timeSec, driveLeftMs, status = {} }) { if (!length || !timeSec || driveLeftMs == null) return null;
  const remM = Math.max(0, length - along), remMs = timeSec * 1000 * remM / length; if (remMs <= driveLeftMs) return null;
  const reachM = along + remM * driveLeftMs / remMs, cand = pois.filter(p => ['stop', 'rest', 'parking'].includes(p.kind) && p.along > along && p.along <= reachM && (p.off ?? 0) < 1500);
  const usable = cand.filter(p => status[p.id]?.status !== 'full'), pick = usable.sort((a, b) => b.along - a.along)[0] || null;
  return { shortMs: remMs - driveLeftMs, reachMi: (reachM - along) / 1609.34, pick: pick && { ...pick, mi: (pick.along - along) / 1609.34, park: status[pick.id] || null }, skippedFull: cand.length - usable.length }; }
export function fmtH(ms) { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`; }
export function expiry(date, now = Date.now()) { if (!date) return null; const [y, mo, d] = date.split('-').map(Number); const end = Date.UTC(y, mo - 1, d, 23, 59) ; const days = Math.floor((end - now) / 864e5);
  return { days, level: days < 0 ? 'expired' : days <= 7 ? 'week' : days <= 30 ? 'urgent' : days <= 60 ? 'soon' : 'ok' }; }
export const CREDS = [{ k: 'cdl', label: 'CDL' }, { k: 'med', label: 'DOT medical card' }, { k: 'hazmat', label: 'Hazmat endorsement (TSA)' }, { k: 'twic', label: 'TWIC card' }];
export function credAlerts(creds, now = Date.now()) { return CREDS.map(c => ({ ...c, ...(expiry(creds?.[c.k], now) || {}) })).filter(c => c.level && c.level !== 'ok')
  .map(c => ({ ...c, text: c.level === 'expired' ? `${c.label} expired ${-c.days} day${c.days === -1 ? '' : 's'} ago` : c.days === 0 ? `${c.label} expires today` : `${c.label} expires in ${c.days} day${c.days === 1 ? "" : "s"}` })); }

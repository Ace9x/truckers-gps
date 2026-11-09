// Anonymous funnel counts. The phone keeps the timestamps. A random device id (the same one used for the daily active count)
// and the event name are the only things sent. No name, location, referral code or trip.
import { sb } from './cloud.js';
const KEY = 'tn_funnel';
const EVENTS = new Set(['wizard_done', 'first_trip', 'install', 'day7']);
export function readFunnel() { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
function write(f) { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch {} }
export function mark(ev) {
  if (!EVENTS.has(ev)) return;
  const f = readFunnel();
  if (!f.firstSeen) f.firstSeen = Date.now();
  if (f[ev]) { write(f); return; }
  f[ev] = Date.now();
  write(f);
  send(ev);
}
export function tickFunnel() {
  const f = readFunnel();
  if (!f.firstSeen) { f.firstSeen = Date.now(); write(f); }
  if (!f.day7 && Date.now() - f.firstSeen >= 7 * 864e5) mark('day7');
}
async function send(ev) {
  try {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    let id = localStorage.getItem('rr_dev');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('rr_dev', id); }
    const c = await sb(); if (!c) return;
    await c.rpc('funnel_ping', { p_id: id, p_event: ev });
  } catch { /* offline or the count table is unreachable: the phone already kept the event */ }
}

// Driver side of fleets: join with an invite code, consent to share location with the fleet, publish HOS snapshot (informational — not an ELD).
import * as cloud from './cloud.js';
let S, fleets = [], busy = false; const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('rr_' + k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem('rr_' + k, JSON.stringify(v)) };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let signedIn = false, checking = false;
export function html() { if (!signedIn) { if (!checking) { checking = true; cloud.uid().then(async id => { if (id) { signedIn = true; await load(); S.renderLoads?.(); } }).catch(() => {}).finally(() => setTimeout(() => checking = false, 5000)); } return ''; }
  const mine = fleets.filter(f => f.role === 'driver'), share = LS.get('fleetShare', null);
  return `<div class="fleet-join" data-fleetbox>${mine.map(f => `<div class="small">🚚 Fleet: <b>${esc(f.fleets?.name)}</b>${f.unit ? ' · Unit ' + esc(f.unit) : ''}</div>`).join('')}
    ${mine.length ? `<label class="small"><input type="checkbox" id="fleetShare" ${share ? 'checked' : ''}> Share my live location and HOS clock with my fleet's dispatchers (HOS is informational — not an ELD)</label>` : ''}
    <div class="row"><input id="fleetCode" placeholder="Fleet invite code" maxlength="12" autocomplete="off"><input id="fleetUnit" placeholder="Unit #" maxlength="20"><button id="fleetGo">Join fleet</button></div><p id="fleetMsg" class="small muted"></p></div>`; }
export function wire() { const go = document.querySelector('#fleetGo'); if (!go) return;
  go.onclick = async () => { const code = document.querySelector('#fleetCode').value.trim(); if (!code) return; const m = document.querySelector('#fleetMsg'); m.textContent = 'Joining…';
    try { const r = await cloud.joinFleet(code, document.querySelector('#fleetUnit').value.trim()); await load();
      const ok = confirm(`Joined ${r.name}. Share your live location and HOS clock with ${r.name}'s dispatchers while signed in? You can turn this off any time in Loads.`); LS.set('fleetShare', ok); tick(true);
      S.toast?.('✅ Joined ' + r.name); S.renderLoads?.(); } catch (e) { m.textContent = '⚠ ' + (e.message || e); } };
  const sh = document.querySelector('#fleetShare'); if (sh) sh.onchange = () => { LS.set('fleetShare', sh.checked); if (!sh.checked) cloud.pushLocation(S.pos, false).catch(() => {}); else tick(true); }; }
async function load() { try { fleets = await cloud.myFleets(); } catch { fleets = []; } S.fleets = fleets; }
let last = 0; async function tick(force) { if (busy || !fleets.some(f => f.role === 'driver') || !LS.get('fleetShare', false)) return; if (!force && Date.now() - last < 60e3) return; busy = true; last = Date.now();
  try { if (S.pos) await cloud.pushLocation(S.pos, true); if (S.hos) await cloud.pushHos(S.hos); } catch {} finally { busy = false; } }
export function start() { S = window.TruckNav; S.fleetDriver = { html, wire, load, tick, get fleets() { return fleets; } };
  const boot = async () => { signedIn = !!(await cloud.uid().catch(() => null)); if (signedIn) { await load(); tick(true); } }; setTimeout(boot, 3000); setInterval(boot, 120e3); setInterval(() => tick(false), 15e3); }

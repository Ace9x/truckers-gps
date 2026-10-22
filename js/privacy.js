// Privacy & trust (Credit Repair Bot review): location pre-prompt, data export / delete-all, what syncs, not-an-ELD notices.
const $ = s => document.querySelector(s);
const SEEN = 'tn_locWhySeen';
// Explain BEFORE the browser asks. Shown only while the permission is still undecided ('prompt'); never blocks if already granted/denied.
export async function locGate(start) {
  let st = 'prompt'; try { st = (await navigator.permissions?.query({ name: 'geolocation' }))?.state || 'prompt'; } catch {}
  if (st !== 'prompt' || localStorage.getItem(SEEN)) return start();
  const el = document.createElement('section'); el.id = 'locWhy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'locWhyH');
  el.innerHTML = `<div class="lw-card"><div class="lw-ic" aria-hidden="true">📍</div><h2 id="locWhyH">RigRoute needs your location</h2>
    <ul><li><b>Turn-by-turn for your truck</b> — routes avoid low bridges, weight limits and no-truck roads from where you are.</li>
    <li><b>Hazards near you</b> — alerts for reports on the road ahead.</li>
    <li><b>Stays on your phone</b> — your position is not stored on our servers. It is shared only if you turn on friend sharing or anonymous traffic speeds.</li></ul>
    <p class="lw-small">Routing requests go to Valhalla (OpenStreetMap). <a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></p>
    <button id="locWhyGo" class="lw-go">Continue</button><button id="locWhyLater" class="lw-later">Not now</button></div>`;
  document.body.appendChild(el);
  $('#locWhyGo').onclick = () => { localStorage.setItem(SEEN, '1'); el.remove(); start(); };
  $('#locWhyLater').onclick = () => { localStorage.setItem(SEEN, '1'); el.remove(); window.TruckNav?.toast?.('Location off. Tap the locate button any time to turn it on.'); };
}
// What leaves the device, and where. Used by Me > Privacy and privacy.html.
export const DATA_MAP = [
  { item: 'Truck profile, name, points', where: 'Your RigRoute account (Supabase) when signed in; otherwise this phone only', sync: true },
  { item: 'Hazard reports and votes you make', where: 'Public to other drivers (Supabase + Nostr relays), with a random driver key', sync: true },
  { item: 'Anonymous traffic speeds', where: 'Nostr relays, only if "Share my speed" is on', sync: 'opt-in' },
  { item: 'Live location for friends', where: 'Only friends you approved, only while sharing is on', sync: 'opt-in' },
  { item: 'Loads from dispatch', where: 'Your paired dispatcher', sync: 'opt-in' },
  { item: 'Routes, stops, trips, receipts, HOS log, facility notes, voice settings', where: 'This phone only', sync: false },
];
export function exportAll() { const out = { exported: new Date().toISOString(), app: 'RigRoute GPS', data: {} };
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k.startsWith('tn_')) continue; if (/sk$|devkey|hzsk|tfsk/.test(k)) { out.data[k] = '(private key — not exported)'; continue; }
    const v = localStorage.getItem(k); try { out.data[k] = JSON.parse(v); } catch { out.data[k] = v; } }
  return out; }
export async function deleteAll() { try { await window.TruckNav?.auth?.signOut?.(); } catch {}
  for (const k of Object.keys(localStorage)) if (k.startsWith('tn_') || k.startsWith('sb-')) localStorage.removeItem(k);
  try { for (const k of await caches.keys()) if (/^tn-|tiles/.test(k)) await caches.delete(k); } catch {}
  try { for (const db of (await indexedDB.databases?.()) || []) if (db.name) indexedDB.deleteDatabase(db.name); } catch {} }
export function privacyHTML() {
  const tag = s => s === true ? '<span class="pv-tag sync">Syncs</span>' : s === 'opt-in' ? '<span class="pv-tag opt">Only if you turn it on</span>' : '<span class="pv-tag local">This phone only</span>';
  return `<h3>Privacy</h3><ul class="pv-list">${DATA_MAP.map(d => `<li><div><b>${d.item}</b><small>${d.where}</small></div>${tag(d.sync)}</li>`).join('')}</ul>
    <div class="pv-btns"><button id="pvExport">Export my data</button><button id="pvDelete" class="pv-danger">Delete all data</button></div>
    <p class="small muted">Hazard reports already sent to public relays can't be recalled. <a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a></p>`; }
export function wirePrivacy(root) {
  root.querySelector('#pvExport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' })); a.download = `rigroute-data-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  root.querySelector('#pvDelete').onclick = async () => { if (!confirm('Delete everything RigRoute stored on this phone (truck profile, trips, receipts, HOS, settings) and sign out? This cannot be undone.')) return; await deleteAll(); location.reload(); }; }
export const NOT_ELD = 'Not a certified ELD. Truck restrictions come from OpenStreetMap and may be incomplete — always obey posted signs.';

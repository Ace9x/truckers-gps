// RigRoute offline + drive mode: IndexedDB trip cache, offline outbox for reports/votes, offline off-route guidance,
// map-region download, glanceable Drive mode with voice commands. No paid services.
import { haversine, bearing, snapToRoute, tilesForLine, fmtDist, fmtDur, cumulative } from './logic.js';
import { TTL_H, REPORT_TYPES } from './community.js';

// ---------- Tiny IndexedDB key/value store (falls back to memory) ----------
const DBN = 'rr-offline';
function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('outbox', { keyPath: 'key' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const tx = async (st, mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(st, mode), s = t.objectStore(st); let out; const q = fn(s); if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); };
export const kv = { get: k => tx('kv', 'readonly', s => s.get(k)), put: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)) };
export const idbOutboxStore = { getAll: () => tx('outbox', 'readonly', s => s.getAll()).then(a => a || []), put: it => tx('outbox', 'readwrite', s => s.put(it)), del: k => tx('outbox', 'readwrite', s => s.delete(k)) };
export function memoryStore() { const m = new Map(); return { getAll: async () => [...m.values()], put: async it => { m.set(it.key, structuredClone(it)); }, del: async k => { m.delete(k); }, m }; }

// ---------- Outbox (pure logic, store injected → unit-testable) ----------
export const VOTE_TTL_MS = 12 * 3600e3, DEFAULT_REPORT_TTL_H = 24;
export function outboxKey(kind, p) { return kind === 'vote' ? `vote:${p.id}:${p.uid}` : `report:${p.id}`; }
export function isExpired(it, now = Date.now()) {
  if (it.kind === 'vote') return now - it.t > VOTE_TTL_MS;
  const ttl = TTL_H[it.payload.type] ?? DEFAULT_REPORT_TTL_H; return now - it.t > ttl * 3600e3;
}
export class Outbox {
  constructor(store = memoryStore()) { this.store = store; }
  async add(kind, payload, t = payload.t ?? Date.now()) { // dedupe: same report id → one item; same voter on same report → latest vote wins
    const key = outboxKey(kind, payload), it = { key, kind, payload: { ...payload }, t, queuedAt: Date.now() };
    await this.store.put(it); return it; }
  async list() { return (await this.store.getAll()).sort((a, b) => a.t - b.t); }
  async size() { return (await this.store.getAll()).length; }
  // send(kind, payload) must throw on failure. Keeps original timestamps (payload.t untouched). Drops expired items.
  async flush(send, now = Date.now()) {
    const res = { sent: 0, dropped: 0, failed: 0 };
    if (this.flushing) return res; this.flushing = true;
    try { for (const it of await this.list()) {
      if (isExpired(it, now)) { await this.store.del(it.key); res.dropped++; continue; }
      try { await send(it.kind, it.payload); await this.store.del(it.key); res.sent++; } catch { res.failed++; break; } } }
    finally { this.flushing = false; }
    return res; }
}

// ---------- Offline off-route guidance (pure) ----------
const CARD = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function rejoinGuidance(pos, line, cum, along = 0, heading = null) {
  const p = [pos.lon, pos.lat], sn = snapToRoute(p, line, cum, 0);
  // aim a bit ahead of the nearest point so the driver merges forward, never backtracks
  const target = Math.min(cum.at(-1), Math.max(sn.along, along) + Math.min(400, sn.dist));
  let i = cum.findIndex(c => c >= target); if (i < 1) i = cum.length - 1;
  const a = line[i - 1], b = line[i], t = (target - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]);
  const pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const brg = bearing(p, pt), dist = haversine(p, pt), card = CARD[Math.round(brg / 45) % 8];
  let rel = null; if (heading != null) { const d = ((brg - heading + 540) % 360) - 180; rel = Math.abs(d) < 30 ? 'ahead' : Math.abs(d) > 150 ? 'behind you' : d > 0 ? 'to your right' : 'to your left'; }
  return { dist, bearing: brg, cardinal: card, rel, point: pt, offBy: sn.dist };
}

// ---------- Tiles for a map region (pure) ----------
const rad = d => d * Math.PI / 180;
export const tileXY = (lon, lat, z) => { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n)]; };
export function tilesForBbox([w, s, e, n], zooms) { const out = [];
  for (const z of zooms) { const [x0, y0] = tileXY(w, n, z), [x1, y1] = tileXY(e, s, z); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${z}/${x}/${y}`); }
  return out; }
export const AVG_TILE_KB = 28; // measured avg of OpenFreeMap vector tiles z6–z14 in NY/NJ
export const estimateMB = n => Math.round(n * AVG_TILE_KB / 1024 * 10) / 10;
export function corridorTiles(line, cap = 6000) { // multi-zoom: wide context at low zoom, street detail along the line
  const set = new Set([...tilesForLine(line, [6, 8], 1), ...tilesForLine(line, [10, 11], 1), ...tilesForLine(line, [12, 13, 14], 1)]);
  return [...set].slice(0, cap); }

// ---------- Voice commands (pure) ----------
export function parseCommand(text) {
  const t = String(text || '').toLowerCase().trim();
  const rep = t.match(/\breport(?:ing)?\s+(?:an?\s+|the\s+)?(.+)$/);
  if (rep) { const w = rep[1]; const map = [[/accident|crash|wreck/, 'accident'], [/camera|speed trap/, 'camera'], [/construction|work ?zone/, 'construction'], [/police|cop|bear|trooper/, 'police'], [/debris|object/, 'debris'], [/ice|snow/, 'ice'], [/wind/, 'wind'], [/closed|closure/, 'closed'], [/low (bridge|clearance)|bridge/, 'clearance'], [/scale.*open|weigh.*open/, 'weigh_open'], [/scale.*closed|weigh.*closed/, 'weigh_closed'], [/parking.*full/, 'parking_full'], [/hazard|danger|something/, 'hazard']];
    for (const [re, k] of map) if (re.test(w)) return { cmd: 'report', type: k }; return { cmd: 'report', type: 'hazard' }; }
  if (/\bun ?mute|voice on|sound on/.test(t)) return { cmd: 'unmute' };
  if (/\bmute|quiet|shut up|voice off|silence/.test(t)) return { cmd: 'mute' };
  if (/(next|nearest|closest).*(fuel|diesel|gas|truck stop)|(fuel|diesel|gas).*(next|near)/.test(t)) return { cmd: 'fuel' };
  if (/how (long|far|much (longer|further))|time left|eta|arrive|when will/.test(t)) return { cmd: 'eta' };
  if (/re ?center|where am i|follow me/.test(t)) return { cmd: 'recenter' };
  if (/exit drive|stop drive|normal mode/.test(t)) return { cmd: 'exitdrive' };
  return { cmd: null, text: t };
}
export function pickReportType(want, types = REPORT_TYPES) { if (types[want]) return want;
  const alias = { accident: ['crash', 'hazard'], camera: ['speedcam', 'speed_camera', 'police'], construction: ['work', 'closed', 'hazard'], debris: ['hazard'] };
  return (alias[want] || []).find(k => types[k]) || 'hazard'; }

// ---------- App wiring ----------
export function init(S, h) {
  const { $, $$, toast, say, map, MI, U, report } = h;
  const outbox = new Outbox(typeof indexedDB !== 'undefined' ? idbOutboxStore : memoryStore()); S.outbox = outbox;
  document.head.insertAdjacentHTML('beforeend', `<style>
#netPill{position:fixed;top:calc(6px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:40;padding:3px 12px;border-radius:12px;font:600 12px system-ui;background:#1b5e20;color:#fff;box-shadow:0 2px 8px #0008;pointer-events:none;transition:opacity .4s}
#netPill.off{background:#b71c1c;font-size:14px;padding:5px 14px}#netPill.ok{opacity:.0}
#offGuide{position:fixed;left:8px;right:8px;top:calc(120px + env(safe-area-inset-top));z-index:30;background:#3e2723;color:#fff;border:3px solid #ffb300;border-radius:16px;padding:10px 14px;font:700 18px system-ui;display:flex;gap:12px;align-items:center}
#offGuide b{font-size:44px;line-height:1;display:inline-block;transition:transform .4s}
#drive{position:fixed;inset:0;z-index:35;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none;font-family:system-ui}
#drive>*{pointer-events:auto}
#dTurn{margin:calc(8px + env(safe-area-inset-top)) 8px 0;background:#000;color:#fff;border:4px solid #ffeb3b;border-radius:22px;padding:12px 16px;display:flex;gap:14px;align-items:center}
#dArrow{font-size:84px;line-height:1;color:#ffeb3b;min-width:90px;text-align:center}#dDist{font-size:56px;font-weight:900;line-height:1}#dStreet{font-size:24px;font-weight:700;margin-top:4px;word-break:break-word}
#dMid{display:flex;justify-content:space-between;align-items:flex-end;padding:0 10px}
#dSpeed,#dLimit{background:#000;color:#fff;border:4px solid #fff;border-radius:18px;padding:6px 14px;text-align:center;font-weight:900}
#dSpeed b{font-size:56px;display:block;line-height:1}#dSpeed.over{border-color:#ff1744;background:#5a0d0d}
#dLimit{background:#fff;color:#000;border-color:#000}#dLimit b{font-size:44px;display:block;line-height:1}
#dEta{background:#000;color:#ffeb3b;border:3px solid #ffeb3b;border-radius:14px;padding:6px 12px;font:800 22px system-ui;text-align:center}
#dBtns{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px 8px calc(8px + env(safe-area-inset-bottom));background:#000c}
#dBtns button{min-height:92px;border-radius:20px;border:3px solid #fff;background:#111;color:#fff;font:800 17px system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
#dBtns button i{font-style:normal;font-size:38px}#dBtns #dReport{background:#e65100}#dBtns #dAce.listen{background:#1565c0;animation:pulse 1s infinite}
#dRep{position:fixed;inset:auto 0 0 0;z-index:36;background:#000;border-top:4px solid #ffeb3b;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 10px calc(10px + env(safe-area-inset-bottom))}
#dRep button{min-height:96px;border-radius:18px;border:3px solid #fff;background:#222;color:#fff;font:800 17px system-ui}#dRep button i{display:block;font-style:normal;font-size:40px}
#dExit{position:absolute;right:10px;top:calc(170px + env(safe-area-inset-top));background:#000a;color:#fff;border:2px solid #fff;border-radius:12px;padding:6px 10px;font:600 13px system-ui}
body.driving #dock,body.driving #sideBtns,body.driving #banner,body.driving #tripBar,body.driving #speedBox,body.driving #limitSign,body.driving #thenBox{display:none!important}
#regionPanel .est{font:700 18px system-ui;margin:8px 0}
</style>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="netPill" class="ok" role="status" aria-live="polite">● Online</div>
<div id="offGuide" class="hidden" role="alert"><b id="ogArrow">↑</b><div><div id="ogText">Offline — follow the route line</div><small id="ogSub"></small></div></div>
<div id="drive" class="hidden" aria-label="Drive mode">
 <div id="dTurn"><div id="dArrow">↑</div><div><div id="dDist">--</div><div id="dStreet"></div></div></div>
 <button id="dExit">✕ Exit drive mode</button>
 <div id="dMid"><div id="dSpeed"><b id="dSpd">--</b>MPH</div><div id="dEta"><span id="dLeft">--</span><br><small id="dMi"></small></div><div id="dLimit" class="hidden">LIMIT<b id="dLim">--</b></div></div>
 <div id="dBtns"><button id="dReport"><i>⚠️</i>Report</button><button id="dMute"><i>🔊</i>Mute</button><button id="dAce"><i>🎤</i>Ace</button><button id="dCenter"><i>🎯</i>Recenter</button></div>
</div>
<div id="dRep" class="hidden"></div>
<section id="regionPanel" class="panel hidden"><div class="phead"><h2>📥 Offline maps</h2><button class="close">✕</button></div>
 <p class="small muted">Saves the map so it shows with no signal. Your planned route is saved automatically when you start navigation.</p>
 <label>Detail<select id="rgZoom"><option value="12">Highways &amp; towns (to zoom 12)</option><option value="13" selected>Main roads (to zoom 13)</option><option value="14">Every street (to zoom 14)</option></select></label>
 <div class="est" id="rgEst">—</div>
 <div class="row"><button id="rgArea" class="big primary">Download area on screen</button><button id="rgRoute" class="big">Download route corridor</button></div>
 <p id="rgMsg" class="small"></p><p class="small muted" id="rgStats"></p></section>`);
  $('#regionPanel .close').onclick = () => $('#regionPanel').classList.add('hidden');
  const ins = $('#offlineBtn'); if (ins) ins.insertAdjacentHTML('afterend', ' <button id="regionBtn" class="small-btn">📥 Offline maps…</button>');
  $('#regionBtn')?.addEventListener('click', () => { $$('.panel').forEach(p => p.classList.add('hidden')); $('#regionPanel').classList.remove('hidden'); estimate(); });

  // ----- online/offline indicator -----
  const online = () => navigator.onLine !== false && !S.forceOffline;
  async function renderNet() { const n = await outbox.size().catch(() => 0), el = $('#netPill'); S.outboxSize = n;
    if (online()) { el.className = n ? '' : 'ok'; el.textContent = n ? `● Online — sending ${n} report${n > 1 ? 's' : ''}…` : '● Online'; if (!n) setTimeout(() => el.classList.add('ok'), 2500); }
    else { el.className = 'off'; el.textContent = `⚡ OFFLINE${S.nav ? ' — navigation still working' : ''}${n ? ` · ${n} report${n > 1 ? 's' : ''} waiting` : ''}`; } }
  S.renderNet = renderNet;

  // ----- wrap backend: queue when offline or send fails -----
  async function sendNow(kind, p) { const b = S.backend; if (!b?._raw) throw new Error('no backend');
    if (kind === 'report') return b._raw.addReport(p); const r = await b._raw.vote(p.id, p.dir, p.uid); if (r === undefined && b.name !== 'local') throw new Error('vote failed'); return r; }
  function wrap(b) { if (!b || b._raw) return; b._raw = { addReport: b.addReport.bind(b), vote: b.vote.bind(b) };
    b.addReport = async r => { if (!online()) { await outbox.add('report', r, r.t); renderNet(); cacheReports(); toast('Offline — report saved, will send when signal returns', 4000); return r; }
      try { return await b._raw.addReport(r); } catch (e) { await outbox.add('report', r, r.t); renderNet(); return r; } };
    b.vote = async (id, dir, uid) => { if (!online()) { await outbox.add('vote', { id, dir, uid, t: Date.now() }); renderNet(); return null; }
      try { return await b._raw.vote(id, dir, uid); } catch { await outbox.add('vote', { id, dir, uid, t: Date.now() }); renderNet(); return null; } }; }
  const waitB = setInterval(() => { if (S.backend) { clearInterval(waitB); wrap(S.backend); flush(); if (!online() || !(S.reports || []).length) restoreReports(); } }, 200);
  async function flush() { if (!online() || !S.backend?._raw) return; const r = await outbox.flush(sendNow); S.lastFlush = r; renderNet();
    if (r.sent) toast(`Back online — sent ${r.sent} report${r.sent > 1 ? 's' : ''}/vote${r.sent > 1 ? 's' : ''} made offline${r.dropped ? `, dropped ${r.dropped} expired` : ''}`, 4000); return r; }
  S.flushOutbox = flush;
  function goOnline() { renderNet(); flush();
    if (S.nav && S.off.isOff() && S.pendingReroute) { S.pendingReroute = false; $('#offGuide').classList.add('hidden'); say('Signal is back. Recalculating.', 'reroute'); S.rerouting = true; S.lastReroute = Date.now(); S.plan(true).finally(() => S.rerouting = false); } }
  function goOffline() { renderNet(); saveTrip(); }
  addEventListener('online', goOnline); addEventListener('offline', goOffline); S.goOnline = goOnline; S.goOffline = goOffline;
  setInterval(() => { if (online()) flush(); }, 30e3); renderNet();

  // ----- trip cache (route, maneuvers, voice text, dangers, reports, stops) in IndexedDB -----
  const routeSig = r => r ? `${r.line.length}:${r.line[0]}:${r.line.at(-1)}:${Math.round(r.length)}` : '';
  async function saveTrip() { const r = S.route; if (!r) return;
    const voiceText = r.maneuvers.flatMap(m => [m.verbal_pre_transition_instruction, m.verbal_transition_alert_instruction, m.instruction].filter(Boolean));
    try { await kv.put('trip', { sig: routeSig(r), route: { ...r, cum: undefined }, dest: S.dest, voiceText, dangers: S.dangers || [], edges: (S.edges || []).length ? S.edges : null,
      pois: (S.pois || []).slice(0, 400), savedAt: Date.now() }); S.tripSaved = routeSig(r); } catch (e) { console.warn('trip cache', e); }
    cacheReports(); }
  async function cacheReports() { try { await kv.put('reports', { t: Date.now(), reports: (S.reports || []).slice(-500) }); } catch {} }
  async function restoreReports() { try { const c = await kv.get('reports'); if (!c?.reports?.length) return; const have = new Set((S.reports || []).map(r => r.id));
    for (const r of c.reports) if (!have.has(r.id)) S.reports.push(r); for (const it of await outbox.list()) if (it.kind === 'report' && !have.has(it.payload.id) && !S.reports.some(x => x.id === it.payload.id)) S.reports.push({ ...it.payload, pending: true });
    S.drawReports?.(); S.reportsFromCache = c.reports.length; } catch {} }
  async function restoreTrip() { try { const c = await kv.get('trip'); if (!c) return;
    if (!S.route && c.route?.line) { S.route = { ...c.route, cum: cumulative(c.route.line) }; S.routes = [S.route]; S.chosen = S.route; S.drawRoute?.(); }
    if (routeSig(S.route) === c.sig) { if (!(S.dangers || []).length && c.dangers?.length) S.dangers = c.dangers; if (!(S.edges || []).length && c.edges) S.edges = c.edges; S.tripRestored = true; } } catch {} }
  S.saveTrip = saveTrip; S.restoreTrip = restoreTrip; restoreTrip();
  let lastSig = '', lastDangerN = -1;
  setInterval(() => { const sig = routeSig(S.route), dn = (S.dangers || []).length; if (sig && (sig !== lastSig || dn !== lastDangerN)) { lastSig = sig; lastDangerN = dn; saveTrip(); cacheVoice(); } }, 3000);
  // cache cloned-voice audio for this route's turn prompts (only when My Voice is on and we're online)
  async function cacheVoice() { const mv = S.myVoice, v = S.voiceObj; if (!mv?.ready || !online() || !S.route) return;
    const lines = [...new Set(S.route.maneuvers.slice(0, 40).map(m => v.phrase(m.verbal_pre_transition_instruction || m.instruction, 'turn')))];
    try { await mv.pregenerate(lines); S.voiceCached = lines.length; } catch {} }

  // ----- offline off-route: guidance back to the line, reroute queued until signal -----
  const ARW = ['↑', '↗', '➡', '↘', '↓', '↙', '⬅', '↖'];
  function offlineGuide() { const g = rejoinGuidance(S.pos, S.route.line, S.route.cum, S.along, S.pos.heading); S.offGuide = g; S.pendingReroute = true;
    const rel = S.pos.heading != null ? ((g.bearing - S.pos.heading + 360) % 360) : g.bearing;
    $('#ogArrow').textContent = ARW[Math.round(rel / 45) % 8]; $('#ogText').textContent = `Offline — follow the route line`;
    $('#ogSub').textContent = `Route is ${fmtDist(g.dist, U())} ${g.rel || g.cardinal}. New route will load when signal returns.`; $('#offGuide').classList.remove('hidden');
    $('#bInstr') && ($('#bInstr').textContent = 'Offline — head back to the route');
    if (!S._ogSpoken || Date.now() - S._ogSpoken > 45e3) { S._ogSpoken = Date.now(); say(`No signal. The truck route is ${spoken(g.dist)} ${g.rel || 'to the ' + g.cardinal}. Follow the route line when safe.`, 'reroute'); } }
  const spoken = m => U() === 'km' ? (m < 1000 ? `${Math.round(m / 50) * 50} meters` : `${(m / 1000).toFixed(1)} kilometers`) : (m < 0.2 * MI ? `${Math.round(m * 3.28084 / 100) * 100} feet` : `${(m / MI).toFixed(1)} miles`);
  S.offlineOffRoute = () => { if (S.route && S.pos) offlineGuide(); };

  // ----- Drive mode -----
  let fast = 0;
  const prevHook = S.onFixHook;
  S.onFixHook = (f, mph) => { try { prevHook?.(f, mph); } catch (e) { console.warn(e); }
    if (S.nav && S.off && !S.off.isOff()) $('#offGuide').classList.add('hidden');
    if (S.nav && !online() && S.off?.isOff()) offlineGuide();
    fast = mph > 10 ? fast + 1 : 0;
    if (S.nav && fast >= 2 && !S.drive && !S.driveDismissedAt) setDrive(true);
    if (S.drive) renderDrive(mph); };
  function setDrive(v) { S.drive = v; document.body.classList.toggle('driving', v); $('#drive').classList.toggle('hidden', !v); if (!v) $('#dRep').classList.add('hidden');
    if (v) { document.activeElement?.blur?.(); $$('.panel').forEach(p => p.classList.add('hidden')); renderDrive((S.pos?.speed || 0) * 2.23694); } }
  S.setDrive = setDrive;
  function renderDrive(mph) {
    $('#dArrow').textContent = $('#bArrow')?.textContent || '↑'; $('#dDist').textContent = $('#bDist')?.textContent || '--'; $('#dStreet').textContent = $('#bInstr')?.textContent || '';
    $('#dSpd').textContent = U() === 'km' ? Math.round(mph * 1.609) : Math.round(mph);
    const lim = $('#limitSign') && !$('#limitSign').classList.contains('hidden') ? $('#limitVal').textContent : null;
    $('#dLimit').classList.toggle('hidden', !lim); if (lim) $('#dLim').textContent = lim; $('#dSpeed').classList.toggle('over', $('#speedBox')?.classList.contains('over'));
    $('#dLeft').textContent = S.remT != null ? fmtDur(S.remT) : '--'; $('#dMi').textContent = $('#tDist') ? `${$('#tDist').textContent} ${U() === 'km' ? 'km' : 'mi'} · ${$('#tEta')?.textContent || ''}` : '';
    $('#dMute i').textContent = S.voiceObj?.enabled ? '🔊' : '🔇'; $('#dMute').lastChild.textContent = S.voiceObj?.enabled ? 'Mute' : 'Unmute'; }
  S.renderDrive = () => renderDrive((S.pos?.speed || 0) * 2.23694);
  $('#dExit').onclick = () => { setDrive(false); S.driveDismissedAt = Date.now(); setTimeout(() => S.driveDismissedAt = null, 5 * 60e3); };
  $('#dCenter').onclick = () => { $('#followBtn')?.click(); say('Recentered', 'info'); };
  $('#dMute').onclick = () => { $('#muteBtn').click(); S.renderDrive(); };
  const QUICK = ['accident', 'camera', 'construction', 'police', 'debris', 'hazard', 'closed', 'ice', 'clearance'];
  $('#dReport').onclick = () => { const types = h.types?.() || REPORT_TYPES, ks = [...new Set(QUICK.map(k => pickReportType(k, types)))].slice(0, 6);
    $('#dRep').innerHTML = ks.map(k => `<button data-dr="${k}"><i>${types[k].icon}</i>${types[k].label}</button>`).join(''); $('#dRep').classList.toggle('hidden');
    $$('[data-dr]').forEach(b => b.onclick = async () => { $('#dRep').classList.add('hidden'); await doReport(b.dataset.dr); }); };
  async function doReport(type) { const types = h.types?.() || REPORT_TYPES; const k = pickReportType(type, types); const r = await report(k); setDrive(S.drive);
    say(`${types[k].label} reported${online() ? '' : '. It will send when signal returns'}. Thanks, driver.`, 'info', true); return r; }
  S.driveReport = doReport;
  // voice commands
  function runCommand(text) { const c = parseCommand(text); S.lastCommand = c;
    if (c.cmd === 'report') return doReport(c.type);
    if (c.cmd === 'mute') { if (S.voiceObj.enabled) $('#muteBtn').click(); S.renderDrive(); return; }
    if (c.cmd === 'unmute') { if (!S.voiceObj.enabled) $('#muteBtn').click(); S.renderDrive(); return; }
    if (c.cmd === 'recenter') return $('#dCenter').click();
    if (c.cmd === 'exitdrive') return $('#dExit').click();
    if (c.cmd === 'eta') { if (!S.nav || !S.route) return say('No route active.', 'info', true); const rem = Math.max(0, S.route.length - S.along);
      return say(`${fmtDur(S.remT || 0).replace('h', ' hours').replace('min', ' minutes')} left, ${spoken(rem)}. Arriving at ${$('#tEta').textContent}.`, 'info', true); }
    if (c.cmd === 'fuel') { const base = S.along || 0; let best = (S.pois || []).filter(p => (p.kind === 'fuel' || p.kind === 'stop') && p.along > base && p.off < 1700).sort((a, b) => a.along - b.along)[0];
      if (!best && S.fuelGeo && S.route) { best = S.fuelGeo.features.map(f => { const sn = snapToRoute(f.geometry.coordinates, S.route.line, S.route.cum, 0); return { name: f.properties.name || 'Diesel', along: sn.along, off: sn.dist }; }).filter(p => p.off < 1500 && p.along > base).sort((a, b) => a.along - b.along)[0]; }
      S.lastFuelAnswer = best || null;
      return say(best ? `Next fuel: ${best.name || 'truck stop'}, in ${spoken(best.along - base)}${best.off > 150 ? ', just off the route' : ', on your route'}.` : 'No mapped fuel stop ahead on this route.', 'info', true); }
    say("Sorry, try: report accident, mute, next fuel, or how long left.", 'info', true); }
  S.runCommand = runCommand;
  $('#dAce').onclick = () => { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { toast('Voice commands need Chrome or Safari'); say('Voice commands are not supported in this browser.', 'info', true); return; }
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1; $('#dAce').classList.add('listen'); S.voiceObj.noCustom = true; speechSynthesis?.cancel();
    rec.onresult = e => runCommand(e.results[0][0].transcript); rec.onend = () => { $('#dAce').classList.remove('listen'); S.voiceObj.noCustom = false; };
    rec.onerror = e => toast(e.error === 'network' ? 'Voice commands need signal on this phone' : 'Did not catch that'); try { rec.start(); } catch {} };
  // no keyboard while moving in drive mode
  document.addEventListener('focusin', e => { if (S.drive && (S.pos?.speed || 0) * 2.23694 > 10 && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.target.blur(); toast('Typing is off while driving — tap 🎤 Ace and speak'); } });
  const prevEnd = S.endNav; S.endNav = (...a) => { setDrive(false); $('#offGuide').classList.add('hidden'); return prevEnd(...a); };
  $('#endBtn') && ($('#endBtn').onclick = () => S.endNav('Navigation ended'));

  // ----- Region download -----
  async function tileTemplate() { const src = map.getStyle()?.sources, vec = src && Object.values(src).find(s => s.type === 'vector' && s.url); if (!vec) return null;
    try { return (await (await fetch(vec.url)).json()).tiles[0]; } catch { return null; } }
  function regionTiles() { const b = map.getBounds(), zmax = +$('#rgZoom').value, zs = []; for (let z = 6; z <= zmax; z++) zs.push(z); return tilesForBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zs); }
  function estimate() { const n = regionTiles().length; $('#rgEst').textContent = `This area: ${n.toLocaleString()} tiles ≈ ${estimateMB(n)} MB`; $('#rgArea').disabled = n > 20000;
    if (n > 20000) $('#rgEst').textContent += ' — too big, zoom in or pick less detail';
    $('#rgRoute').disabled = !S.route; if (S.route) $('#rgRoute').textContent = `Download route corridor (${corridorTiles(S.route.line).length.toLocaleString()} tiles ≈ ${estimateMB(corridorTiles(S.route.line).length)} MB)`; }
  $('#rgZoom').onchange = estimate; map.on('moveend', () => { if (!$('#regionPanel').classList.contains('hidden')) estimate(); });
  async function download(tiles, label) { const tmpl = await tileTemplate(); if (!tmpl) { $('#rgMsg').textContent = '⚠ Need signal to download maps'; return { done: 0 }; }
    let done = 0, fail = 0; const q = tiles.slice(); const worker = async () => { while (q.length) { const [z, x, y] = q.shift().split('/');
      try { const r = await fetch(tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y)); r.ok ? done++ : fail++; } catch { fail++; } if ((done + fail) % 50 === 0) $('#rgMsg').textContent = `${label}: ${done + fail}/${tiles.length}…`; } };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker)); const res = { done, fail, total: tiles.length }; $('#rgMsg').textContent = `✅ ${label} saved: ${done}/${tiles.length} tiles${fail ? ` (${fail} failed)` : ''}. Works with no signal.`;
    const st = await navigator.storage?.estimate?.().catch(() => null); if (st) $('#rgStats').textContent = `Phone storage used by RigRoute: ${Math.round(st.usage / 1048576)} MB`; return res; }
  $('#rgArea').onclick = async () => { S.regionResult = await download(regionTiles(), 'Map area'); };
  $('#rgRoute').onclick = async () => { if (S.route) S.regionResult = await download(corridorTiles(S.route.line), 'Route corridor'); };
  S.downloadRoute = () => download(corridorTiles(S.route.line), 'Route corridor'); S.regionTiles = regionTiles;
}

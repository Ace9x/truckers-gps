// RigRoute Dispatch API v1 (see docs/DISPATCH_API.md). Transport: encrypted Link channels over free Nostr relays.
import { Channel, hex, rand, shortCode, normCode, pubkeyOf } from './link.js';
export const STATUSES = ['en_route_pickup', 'arrived_pickup', 'loaded', 'en_route_drop', 'arrived_drop', 'delivered'];
export const STATUS_LABEL = { en_route_pickup: 'En route to pickup', arrived_pickup: 'Arrived at pickup', loaded: 'Loaded', en_route_drop: 'En route to delivery', arrived_drop: 'Arrived at delivery', delivered: 'Delivered' };
const okStop = s => s && typeof s.lat === 'number' && typeof s.lon === 'number' && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180 && s.address;
export function validateLoad(l) { const e = [];
  if (!l?.id) e.push('id'); if (!okStop(l?.pickup)) e.push('pickup (address, lat, lon)'); if (!okStop(l?.drop)) e.push('drop (address, lat, lon)');
  (l?.stops || []).forEach((s, i) => { if (!okStop(s)) e.push('stops[' + i + ']'); });
  if (l?.rate && !(l.rate.amount >= 0)) e.push('rate.amount'); if (l?.weight_lb != null && !(l.weight_lb > 0)) e.push('weight_lb');
  if (l?.hazmat?.is && !l.hazmat.class) e.push('hazmat.class'); return e; }
// Delivered only with proof of delivery: photo + signature (images) + receiver name
// Pickup PIN: dispatch gives the 4-digit PIN to the shipper only; the driver gets it from the shipper at the dock and enters it to mark Loaded.
// The load carries only a salted hash (stops honest mix-ups and impostors using the app; 4 digits is not cryptographic security).
export const pinHash = (id, pin) => { let h = 0x811c9dc5; for (const ch of 'rr-pin:' + id + ':' + String(pin).trim()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
export const newPin = () => String(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
export const pinOk = (load, pin) => !load?.pinHash || pinHash(load.id, pin) === load.pinHash;
export const podOk = p => !!p && /^data:image\//.test(p.photo || '') && /^data:image\//.test(p.signature || '') && String(p.name || '').trim().length > 0;
// Fold an ordered message log into per-load state (both sides use this, so they always agree)
export function fold(msgs) { const loads = {}; for (const m of [...msgs].sort((a, b) => a.t - b.t)) {
    if (m.type === 'load' && !validateLoad(m.load).length) loads[m.load.id] = { ...(loads[m.load.id] || { history: [] }), load: m.load, state: loads[m.load.id]?.state || 'offered', updated: m.t };
    const L = loads[m.loadId]; if (!L) continue;
    if (m.type === 'response') { L.state = m.action === 'accept' ? 'accepted' : m.action === 'decline' ? 'declined' : 'countered'; L.counter = m.counter || null; L.reason = m.reason || ''; }
    if (m.type === 'counter_reply') L.state = m.accept ? 'accepted' : 'declined';
    if (m.type === 'status') { if (m.status === 'delivered' && !podOk(m.pod)) { L.podMissing = true; continue; } if (m.status === 'loaded' && !pinOk(L.load, m.pin)) { L.pinMissing = true; continue; } if (m.status === 'loaded') L.pinMissing = false; L.state = m.status; if (m.pod) L.pod = m.pod; }
    if (m.type === 'msg' && typeof m.text === 'string') { (L.msgs ||= []).push({ text: m.text.slice(0, 500), t: m.t, from: m.from || '' }); continue; }
    if (m.type === 'cancel') L.state = 'cancelled';
    if (['response', 'status', 'cancel', 'counter_reply'].includes(m.type)) { L.history.push({ type: m.type, t: m.t, action: m.action, status: m.status, lat: m.lat, lon: m.lon }); L.updated = m.t; } }
  return loads; }
export function nextStatus(cur) { if (cur === 'arrived_drop') return null; /* delivery goes through the POD sheet */ const i = STATUSES.indexOf(cur); return cur === 'accepted' ? STATUSES[0] : i >= 0 && i < STATUSES.length - 1 ? STATUSES[i + 1] : null; }
export const routeStops = l => [{ ...l.pickup, kind: 'pickup' }, ...(l.stops || []).map(s => ({ ...s, kind: 'stop' })), { ...l.drop, kind: 'drop' }];

// ---- Pairing: dispatcher shows a short code (and QR); driver types/scans it within 15 min.
// pair channel = PBKDF2(code). Driver -> pair_request {driver}. Dispatcher -> pair_accept {session (32B random), dispatcher, driverPk}.
// All further traffic on Channel.fromSecret(session) — the code is useless after pairing.
export const PAIR_TTL = 15 * 60e3;
class Base { constructor(sk, store) { this.sk = sk; this.pk = pubkeyOf(sk); this.store = store; this.cbs = []; this.logs = {}; this.chans = {}; }
  onChange(cb) { this.cbs.push(cb); } _emit() { this.cbs.forEach(c => { try { c(this); } catch {} }); }
  async _attach(p) { if (this.chans[p.session]) return; const ch = await Channel.fromSecret(p.session, 'dispatch'); this.chans[p.session] = ch; this.logs[p.session] ||= [];
    ch.listen(m => { this.logs[p.session].push(m); this._onMsg?.(p, m); this._emit(); }, Math.floor(p.at / 1000) - 60); }
  loads(session) { return fold(this.logs[session] || []); }
  send(session, msg) { return this.chans[session].send(this.sk, msg).then(m => { if (!this.logs[session].some(x => x.id === m.id)) this.logs[session].push(m); this._emit(); return m; }); }
}
export class DriverDispatch extends Base {
  constructor(sk, profile = () => ({})) { super(sk); this.profile = profile; this.pairings = JSON.parse(localStorage.getItem('tn_pairings') || '[]'); this.share = JSON.parse(localStorage.getItem('tn_shareloc') || 'false'); this.pairings.forEach(p => this._attach(p)); }
  _save() { localStorage.setItem('tn_pairings', JSON.stringify(this.pairings)); localStorage.setItem('tn_shareloc', JSON.stringify(this.share)); }
  async pair(code) { const n = normCode(code); if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(n)) throw new Error('Code looks like ABCD-1234'); const ch = await Channel.fromCode(n, 'pair');
    return new Promise((res, rej) => { const to = setTimeout(() => { un(); rej(new Error('No dispatcher answered that code (expired or mistyped?)')); }, 45000);
      const un = ch.listen(async m => { if (m.type !== 'pair_accept' || m.driverPk !== this.pk) return; clearTimeout(to); un();
        const p = { session: m.session, dispatcher: m.dispatcher, at: Date.now() }; this.pairings = [...this.pairings.filter(x => x.session !== p.session), p]; this._save(); await this._attach(p); this._emit(); res(p); }, Math.floor(Date.now() / 1000) - 60);
      ch.send(this.sk, { type: 'pair_request', driverPk: this.pk, driver: this.profile() }, 1).catch(e => { clearTimeout(to); un(); rej(e); }); }); }
  unpair(session) { this.send(session, { type: 'unpair' }).catch(() => {}); this.pairings = this.pairings.filter(p => p.session !== session); this._save(); this._emit(); }
  allLoads() { return this.pairings.flatMap(p => Object.values(this.loads(p.session)).map(L => ({ ...L, session: p.session, dispatcher: p.dispatcher }))).sort((a, b) => b.updated - a.updated); }
  respond(session, loadId, action, extra = {}) { return this.send(session, { type: 'response', loadId, action, ...extra }); }
  status(session, loadId, status, extra = {}) { return this.send(session, { type: 'status', loadId, status, ...extra }); }
  setShare(on) { this.share = !!on; this._save(); this.pairings.forEach(p => this.send(p.session, { type: 'share', on: this.share }).catch(() => {})); this._emit(); }
  location(pos) { if (!this.share || !pos) return; this.pairings.forEach(p => this.send(p.session, { type: 'location', lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5), heading: pos.heading ?? null, speed: pos.speed ?? null }, 1).catch(() => {})); }
}
export class DispatcherConsole extends Base {
  constructor(sk, name = 'Dispatch') { super(sk); this.name = name; this.drivers = JSON.parse(localStorage.getItem('rr_disp_drivers') || '[]'); this.drivers.forEach(p => this._attach(p)); }
  _save() { localStorage.setItem('rr_disp_drivers', JSON.stringify(this.drivers)); }
  async newCode(onPaired) { const code = shortCode(), ch = await Channel.fromCode(code, 'pair'), exp = Date.now() + PAIR_TTL; let used = false;
    const un = ch.listen(async m => { if (m.type !== 'pair_request' || used || Date.now() > exp) return; used = true; un();
      const p = { session: hex(rand(32)), driver: m.driver || {}, driverPk: m.driverPk, at: Date.now() };
      await ch.send(this.sk, { type: 'pair_accept', session: p.session, driverPk: m.driverPk, dispatcher: { name: this.name, pk: this.pk } }, 1);
      this.drivers.push(p); this._save(); await this._attach(p); this._emit(); onPaired?.(p); }, Math.floor(Date.now() / 1000) - 5);
    setTimeout(un, PAIR_TTL); return { code, expires: exp }; }
  _onMsg(p, m) { if (m.type === 'location') p.last = m; if (m.type === 'share') p.sharing = m.on; if (m.type === 'unpair') p.unpaired = true; }
  sendLoad(session, load, { pin = true } = {}) { const e = validateLoad(load); if (e.length) throw new Error('Invalid load: ' + e.join(', ')); let p = null; if (pin && !load.pinHash) { p = newPin(); load = { ...load, pinHash: pinHash(load.id, p) }; const all = JSON.parse(localStorage.getItem('rr_load_pins') || '{}'); all[load.id] = p; localStorage.setItem('rr_load_pins', JSON.stringify(all)); }
    this.lastPin = p; return this.send(session, { type: 'load', load }); }
}

// RigRoute Link — free encrypted messaging over public Nostr relays (no server, no paid service).
// Used by auth (profile sync), dispatch (driver <-> dispatcher) and friends. AES-256-GCM end-to-end; relays only see ciphertext + a hashed channel tag.
import { finalizeEvent, generateSecretKey } from './vendor/nostr.js';
export const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://relay.damus.io'];
export const KIND_MSG = 7534, KIND_PROFILE = 30078;
const te = new TextEncoder(), td = new TextDecoder(), C = globalThis.crypto, SUB = C.subtle;
export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
export const b64 = u => btoa(String.fromCharCode(...u)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const rand = n => C.getRandomValues(new Uint8Array(n));
export const uid = () => hex(rand(8));
export async function sha(s) { return hex(await SUB.digest('SHA-256', te.encode(s))); }
export async function pbkdf(pass, salt, iter = 150000) { const k = await SUB.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await SUB.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(salt), iterations: iter }, k, 256)); }
export async function aesKey(secret, info) { const k = await SUB.importKey('raw', secret, 'HKDF', false, ['deriveKey']); return SUB.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('rigroute-link-v1'), info: te.encode(info) }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
export async function seal(key, obj) { const iv = rand(12), ct = new Uint8Array(await SUB.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)))); const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return b64(o); }
export async function open(key, s) { const u = unb64(s); return JSON.parse(td.decode(await SUB.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12)))); }
export function pubkeyOf(sk) { return finalizeEvent({ kind: 1, created_at: 0, tags: [], content: '' }, sk).pubkey; }
export function newSecret() { return generateSecretKey(); }
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function shortCode(n = 8) { const r = rand(n); let s = ''; for (let i = 0; i < n; i++) s += ABC[r[i] % ABC.length]; return s.slice(0, 4) + '-' + s.slice(4); }
export const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.+)$/, '$1-$2');

// ---- relay bus: one socket per relay, auto-reconnect, re-REQ on reconnect, event-id dedupe
export class Bus {
  constructor(urls = RELAYS) { this.urls = urls; this.rs = []; this.subs = new Map(); this.seen = new Set(); this.waiters = []; urls.forEach(u => this._open(u)); }
  get openCount() { return this.rs.filter(r => r.open).length; }
  _open(url) { const r = { url, open: false }; try { r.ws = new WebSocket(url); } catch { return; } this.rs.push(r);
    r.ws.onopen = () => { r.open = true; for (const [id, f] of this.subs) this._req(r, id, f.filter); this.waiters.splice(0).forEach(w => w()); };
    r.ws.onmessage = m => { let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d[0] === 'EVENT') { const s = this.subs.get(d[1]); if (!s) return; const ev = d[2], k = d[1] + ev.id; if (this.seen.has(k)) return; this.seen.add(k); s.cb(ev); }
      else if (d[0] === 'EOSE') this.subs.get(d[1])?.eose?.(r.url); else if (d[0] === 'OK') this.onOk?.(d[1], d[2], r.url); };
    r.ws.onclose = () => { r.open = false; this.rs = this.rs.filter(x => x !== r); if (!this.closed) setTimeout(() => this._open(url), 4000); };
    r.ws.onerror = () => {}; }
  _req(r, id, filter) { try { r.ws.send(JSON.stringify(['REQ', id, filter])); } catch {} }
  ready(ms = 8000) { return this.openCount ? Promise.resolve() : new Promise(res => { this.waiters.push(res); setTimeout(res, ms); }); }
  sub(filter, cb, eose) { const id = 'rr' + uid(); this.subs.set(id, { filter, cb, eose }); this.rs.filter(r => r.open).forEach(r => this._req(r, id, filter)); return () => { this.subs.delete(id); this.rs.filter(r => r.open).forEach(r => { try { r.ws.send(JSON.stringify(['CLOSE', id])); } catch {} }); }; }
  async pub(ev) { await this.ready(); const m = JSON.stringify(['EVENT', ev]); let n = 0; this.rs.forEach(r => { if (r.open) try { r.ws.send(m); n++; } catch {} }); if (!n) throw new Error('No relay connected'); return n; }
  // fetch stored events once (resolves after first EOSE from enough relays or timeout)
  async query(filter, ms = 5000) { await this.ready(); const out = []; return new Promise(res => { let done = 0, fin = () => { un(); res(out); };
    const un = this.sub(filter, ev => out.push(ev), () => { if (++done >= Math.max(1, this.openCount)) fin(); }); setTimeout(fin, ms); }); }
  close() { this.closed = true; this.rs.forEach(r => r.ws.close()); }
}
let _bus; export const bus = () => (_bus ||= new Bus(globalThis.RR_RELAYS || RELAYS));

// ---- Channel: shared-secret encrypted stream between 2+ parties. Messages are stored on relays (30 days) so offline peers catch up.
export class Channel {
  static async fromSecret(secretHex, info = 'ch') { const c = new Channel(); c.tag = await sha('rigroute-ch-v1|' + info + '|' + secretHex); c.key = await aesKey(unhex(secretHex), info); return c; }
  static async fromCode(code, scope) { const c = new Channel(); const n = normCode(code); c.tag = await sha(`rigroute-${scope}-v1|${n}`); c.key = await aesKey(await pbkdf(n, 'rigroute-' + scope, 60000), scope); return c; }
  async send(sk, msg, ttlDays = 30) { const body = { id: uid(), t: Date.now(), ...msg }; const ev = finalizeEvent({ kind: KIND_MSG, created_at: Math.floor(Date.now() / 1000), content: await seal(this.key, body),
      tags: [['t', this.tag], ['expiration', String(Math.floor(Date.now() / 1000) + ttlDays * 86400)]] }, sk); await bus().pub(ev); return body; }
  listen(cb, sinceSec = Math.floor(Date.now() / 1000) - 30 * 86400) { const seen = new Set(); return bus().sub({ kinds: [KIND_MSG], '#t': [this.tag], since: sinceSec, limit: 500 }, async ev => {
      try { const m = await open(this.key, ev.content); if (seen.has(m.id)) return; seen.add(m.id); m._from = ev.pubkey; cb(m); } catch {} }); }
}

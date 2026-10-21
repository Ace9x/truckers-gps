// RigRoute accounts behind ONE interface: { user, signUp, signIn, signInRecovery, signOut, saveProfile, recoveryCode, onChange }.
// Today (no Supabase): "Device + relay" accounts — email+password deterministically derive a Nostr keypair on the device (PBKDF2, 250k rounds),
// so the same email+password signs in on any phone. Profile (name, username, truck) is AES-GCM encrypted and stored as a replaceable event on
// free public relays. A recovery code (the raw key) restores the account if the password is forgotten. Nothing readable ever leaves the phone.
// When js/config.js has Supabase url+anonKey, SupabaseAuth (email+password + magic link) is used instead — same interface.
import { finalizeEvent } from './vendor/nostr.js';
import { bus, pbkdf, aesKey, seal, open, hex, unhex, pubkeyOf, newSecret, KIND_PROFILE, sha } from './link.js';
const LSK = 'tn_auth', D = 'rigroute-profile';
export const ITER = 250000;
export async function deriveKey(email, password, iter = ITER) { return pbkdf(password, 'rigroute-auth-v1|' + email.trim().toLowerCase(), iter); }
export function toRecovery(sk) { return 'RR1-' + hex(sk).toUpperCase().match(/.{8}/g).join('-'); }
export function fromRecovery(code) { const h = String(code).toLowerCase().replace(/^rr1/, '').replace(/[^0-9a-f]/g, ''); if (h.length !== 64) throw new Error('Recovery code should be RR1- followed by 64 characters'); return unhex(h); }
export function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim()); }

export class DeviceAuth {
  constructor() { this.kind = 'device'; this.cbs = []; this.user = null; this.sk = null;
    try { const s = JSON.parse(localStorage.getItem(LSK)); if (s?.sk) { this.sk = unhex(s.sk); this.user = s.user; } } catch {} }
  onChange(cb) { this.cbs.push(cb); } _emit() { this.cbs.forEach(c => { try { c(this.user); } catch {} }); }
  _persist() { if (this.sk) localStorage.setItem(LSK, JSON.stringify({ sk: hex(this.sk), user: this.user })); else localStorage.removeItem(LSK); }
  async _key(sk) { return aesKey(sk, 'profile'); }
  async fetchProfile(sk, tries = 2) { const pk = pubkeyOf(sk); let evs = [];
    for (let i = 0; i < tries && !evs.length; i++) { if (i) await new Promise(r => setTimeout(r, 1500)); evs = await bus().query({ kinds: [KIND_PROFILE], authors: [pk], '#d': [D] }, 6000); }
    const ev = evs.sort((a, b) => b.created_at - a.created_at)[0]; if (!ev) return null; try { return await open(await this._key(sk), ev.content); } catch { return null; } }
  async _publish(sk, p) { const ev = finalizeEvent({ kind: KIND_PROFILE, created_at: Math.floor(Date.now() / 1000), tags: [['d', D]], content: await seal(await this._key(sk), p) }, sk); return bus().pub(ev); }
  async signUp({ email, password, name, username = '', truck = null }) {
    if (!validEmail(email)) throw new Error('Enter a valid email'); if (String(password).length < 8) throw new Error('Password must be at least 8 characters');
    const sk = await deriveKey(email, password); if (await this.fetchProfile(sk, 1)) throw new Error('An account with this email + password already exists — use Sign in');
    const p = { v: 1, email: email.trim().toLowerCase(), name: name || email.split('@')[0], username: username.trim().toLowerCase(), truck, created: Date.now(), updated: Date.now() };
    await this._publish(sk, p); return this._set(sk, p, 'password'); }
  async signIn({ email, password }) { const sk = await deriveKey(email, password), p = await this.fetchProfile(sk);
    if (!p) throw new Error('No account found for that email and password (check both, or use your recovery code)'); return this._set(sk, p, 'password'); }
  async signInRecovery(code) { const sk = fromRecovery(code), p = await this.fetchProfile(sk); if (!p) throw new Error('No account found for that recovery code'); return this._set(sk, p, 'recovery'); }
  _set(sk, p, method) { this.sk = sk; this.user = { id: pubkeyOf(sk), email: p.email, name: p.name, username: p.username || '', method, profile: p }; this._persist(); this._emit(); return this.user; }
  async saveProfile(patch) { if (!this.sk) throw new Error('Not signed in'); const p = { ...this.user.profile, ...patch, updated: Date.now() }; await this._publish(this.sk, p);
    this.user = { ...this.user, name: p.name, username: p.username || '', profile: p }; this._persist(); this._emit(); return p; }
  async refresh() { if (!this.sk) return null; const p = await this.fetchProfile(this.sk); if (p && p.updated > (this.user.profile?.updated || 0)) { this.user = { ...this.user, name: p.name, username: p.username, profile: p }; this._persist(); this._emit(); } return p; }
  recoveryCode() { return this.sk ? toRecovery(this.sk) : null; }
  signOut() { this.sk = null; this.user = null; this._persist(); this._emit(); }
  secret() { return this.sk; }
}

// Drop-in for later: Supabase email+password and magic link. Activated automatically when config.js is filled in.
export class SupabaseAuth {
  constructor(cfg) { this.kind = 'supabase'; this.cfg = cfg; this.cbs = []; this.user = null; this.local = new DeviceAuth(); }
  async init() { const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2'); this.sb = createClient(this.cfg.url, this.cfg.anonKey);
    const { data } = await this.sb.auth.getSession(); await this._from(data.session); this.sb.auth.onAuthStateChange((_e, s) => this._from(s)); return this; }
  async _from(s) { if (!s) { this.user = null; } else { const { data } = await this.sb.from('drivers').select('*').eq('id', s.user.id).maybeSingle();
      this.user = { id: s.user.id, email: s.user.email, name: data?.name || s.user.email, username: data?.username || '', method: 'supabase', profile: data || {} }; } this.cbs.forEach(c => c(this.user)); }
  onChange(cb) { this.cbs.push(cb); }
  async signUp({ email, password, name, username, truck }) { const { data, error } = await this.sb.auth.signUp({ email, password }); if (error) throw error; await this.sb.from('drivers').upsert({ id: data.user.id, name, username, truck }); return this.user; }
  async signIn({ email, password }) { const { error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) throw error; return this.user; }
  async magicLink(email) { const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } }); if (error) throw error; }
  async signInRecovery() { throw new Error('Use "Forgot password" email reset'); }
  async saveProfile(patch) { await this.sb.from('drivers').upsert({ id: this.user.id, ...patch }); await this._from((await this.sb.auth.getSession()).data.session); }
  recoveryCode() { return null; } async signOut() { await this.sb.auth.signOut(); }
  secret() { return this.local.sk; } // relay features (friends/dispatch) still use a device key
}
export async function makeAuth() { let cfg = null; try { cfg = (await import('./config.js')).SUPABASE; } catch {}
  if (cfg?.url && cfg?.anonKey) { try { return await new SupabaseAuth(cfg).init(); } catch (e) { console.warn('Supabase auth unavailable, using device accounts', e); } } return new DeviceAuth(); }
// Guest / relay identity: signed-in key, else a per-device key (guest mode keeps working)
export function deviceKey() { let h = localStorage.getItem('tn_devkey'); if (!h) { h = hex(newSecret()); localStorage.setItem('tn_devkey', h); } return unhex(h); }
export { sha };

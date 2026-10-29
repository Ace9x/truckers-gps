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

// Supabase email+password (project ace-platform). Activated automatically when config.js is filled in. Uses the shared client from cloud.js.
export const OAUTH_REDIRECT = 'https://ace9x.github.io/truckers-gps/';
export class SupabaseAuth {
  constructor(cfg) { this.kind = 'supabase'; this.cfg = cfg; this.cbs = []; this.user = null; this.local = new DeviceAuth(); }
  async init() { const { sb } = await import('./cloud.js'); this.sb = await sb(); if (!this.sb) throw new Error('no supabase');
    const { data } = await this.sb.auth.getSession(); await this._from(data.session); this.sb.auth.onAuthStateChange((e, s) => { if (e !== 'TOKEN_REFRESHED') setTimeout(() => this._from(s), 0); }); return this; }
  async _from(s) { const prev = this.user?.id; if (!s) { this.user = null; } else { const { data } = await this.sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
      this.user = { id: s.user.id, email: s.user.email, name: data?.display_name || s.user.email, username: data?.username || '', role: data?.role || 'driver', method: 'supabase', profile: { ...(data || {}), name: data?.display_name, truck: data?.truck && Object.keys(data.truck).length ? data.truck : null } }; }
    if (prev !== this.user?.id || this._force) this.cbs.forEach(c => { try { c(this.user); } catch {} }); this._force = false; }
  onChange(cb) { this.cbs.push(cb); }
  async signUp({ email, password, name, username = '', truck = null, role = 'driver' }) {
    if (!validEmail(email)) throw new Error('Enter a valid email'); if (String(password).length < 8) throw new Error('Password must be at least 8 characters');
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name || email.split('@')[0], role }, emailRedirectTo: location.href.split('?')[0] } });
    if (error) throw new Error(error.code === 'over_email_send_rate_limit' ? 'Too many sign-ups right now — please try again in a little while' : error.message);
    if (!data.session) return { pending: 'confirm', email: email.trim() }; // project requires email confirmation: caller shows the "check your email" state
    await this.sb.from('profiles').update({ display_name: name || null, username: username.trim().toLowerCase() || null, truck: truck || {} }).eq('id', data.user.id); await this._from(data.session); return this.user; }
  async signIn({ email, password }) { const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password }); if (error) { if (error.code === 'email_not_confirmed' || error.message === 'Email not confirmed') return { pending: 'confirm', email: email.trim() }; throw new Error(error.message); } await this._from(data.session); return this.user; }
  async resendConfirmation(email) { const { error } = await this.sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.href.split('?')[0] } }); if (error) throw new Error(error.code === 'over_email_send_rate_limit' ? 'Please wait a minute before asking for another email' : error.message); }
  // Google sign-in. Shown only when the provider is enabled, checked like queens-cab cloud.js: GET /auth/v1/settings -> external.google
  async providers() { if (this._prov) return this._prov; try { const r = await fetch(this.cfg.url + '/auth/v1/settings', { headers: { apikey: this.cfg.anonKey } }); const j = await r.json(); this._prov = { google: !!j.external?.google }; } catch { this._prov = { google: false }; } return this._prov; }
  async oauth(provider = 'google') { const { error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: OAUTH_REDIRECT } }); if (error) throw error; }
  async magicLink(email) { const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('?')[0] } }); if (error) throw error; }
  async resetPassword(email) { const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.href.split('?')[0] }); if (error) throw error; }
  async signInRecovery() { throw new Error('Use "Forgot password" — we will email you a reset link'); }
  async saveProfile(patch) { const row = {}; if ('name' in patch) row.display_name = patch.name; if ('username' in patch) row.username = patch.username || null; if ('truck' in patch) row.truck = patch.truck || {};
    const { error } = await this.sb.from('profiles').update(row).eq('id', this.user.id); if (error) throw new Error(error.code === '23505' ? 'That username is taken' : error.message); this._force = true; await this._from((await this.sb.auth.getSession()).data.session); return this.user.profile; }
  async refresh() { await this._from((await this.sb.auth.getSession()).data.session); return this.user?.profile; }
  // Passkeys (Face ID / Touch ID / Windows Hello). Biometrics stay on the device; the server keeps only a public key.
  async passkeyIn() { const PK = await import('./passkey.js'); await PK.signIn(this.sb); await this._from((await this.sb.auth.getSession()).data.session); return this.user; }
  async passkeyAdd() { const PK = await import('./passkey.js'); return PK.register(this.sb, { app: 'RigRoute' }); }
  async passkeys() { const PK = await import('./passkey.js'); return PK.list(this.sb); }
  async passkeyDel(id) { const PK = await import('./passkey.js'); return PK.remove(this.sb, id); }
  recoveryCode() { return null; } async signOut() { await this.sb.auth.signOut(); }
  secret() { return this.local.sk; } // relay features (friends/dispatch fallback) still use a device key
}
export async function makeAuth() { let cfg = null; try { cfg = (await import('./config.js')).SUPABASE; } catch {}
  if (cfg?.url && cfg?.anonKey) { try { return await new SupabaseAuth(cfg).init(); } catch (e) { console.warn('Supabase auth unavailable, using device accounts', e); } } return new DeviceAuth(); }
// Guest / relay identity: signed-in key, else a per-device key (guest mode keeps working)
export function deviceKey() { let h = localStorage.getItem('tn_devkey'); if (!h) { h = hex(newSecret()); localStorage.setItem('tn_devkey', h); } return unhex(h); }
export { sha };

// Accounts + community reports + gamification. Backend adapter: Supabase when configured (js/config.js), local-only otherwise.
import { haversine } from './logic.js';
const LSK = k => 'tn_' + k, get = (k, d) => { try { return JSON.parse(localStorage.getItem(LSK(k))) ?? d; } catch { return d; } }, set = (k, v) => localStorage.setItem(LSK(k), JSON.stringify(v));

export const REPORT_TYPES = {
  clearance: { icon: '⛔', label: 'Low clearance', avoid: true, pts: 25 }, notrucks: { icon: '🚫', label: 'No trucks', avoid: true, pts: 25 },
  weight: { icon: '⚖️', label: 'Weight limit', avoid: true, pts: 20 }, closed: { icon: '🚧', label: 'Road closed', avoid: true, pts: 20 },
  hazard: { icon: '⚠️', label: 'Hazard', avoid: false, pts: 10 }, police: { icon: '👮', label: 'Police', avoid: false, pts: 5 },
  weigh_open: { icon: '🟢', label: 'Scale open', avoid: false, pts: 10 }, weigh_closed: { icon: '🔴', label: 'Scale closed', avoid: false, pts: 10 },
  parking_open: { icon: '🅿️', label: 'Parking: spots open', avoid: false, pts: 10 }, parking_some: { icon: '🟡', label: 'Parking: few left', avoid: false, pts: 10 }, parking_full: { icon: '🈵', label: 'Parking: FULL', avoid: false, pts: 10 },
  ice: { icon: '🧊', label: 'Ice / snow on road', avoid: false, pts: 10 }, wind: { icon: '🌬️', label: 'High wind', avoid: false, pts: 10 }, chains: { icon: '⛓️', label: 'Chain law in effect', avoid: false, pts: 15 },
};
export const TTL_H = { fuel_price: 24, parking_open: 2, parking_some: 2, parking_full: 3, ice: 6, wind: 6, chains: 12, hazard: 4, police: 1, weigh_open: 3, weigh_closed: 3 }; // restrictions persist

// ---------- Gamification rules (pure) ----------
export const LEVELS = [[0, 'Rookie'], [200, 'Road Dog'], [600, 'Gear Jammer'], [1500, 'Highway Hero'], [4000, 'Road Captain'], [10000, 'Legend of the Road']];
export function levelFor(points) { let i = 0; for (let k = 0; k < LEVELS.length; k++) if (points >= LEVELS[k][0]) i = k;
  const next = LEVELS[i + 1]; return { index: i + 1, name: LEVELS[i][1], next: next ? next[0] : null, progress: next ? (points - LEVELS[i][0]) / (next[0] - LEVELS[i][0]) : 1 }; }
export const POINTS = { mile: 1, onTime: 50, breakTaken: 15, safeTrip: 30, reportConfirmed: 15, vote: 2 };
export const BADGES = {
  first_report: { icon: '📣', name: 'First Report', test: s => s.reports >= 1 }, scout: { icon: '🔭', name: 'Road Scout (10 reports)', test: s => s.reports >= 10 },
  confirmed5: { icon: '✅', name: 'Trusted Reporter (5 confirmed)', test: s => s.confirmed >= 5 }, miles100: { icon: '🛣️', name: '100 Miles', test: s => s.miles >= 100 },
  miles1000: { icon: '🏆', name: '1,000 Miles', test: s => s.miles >= 1000 }, ontime5: { icon: '⏰', name: 'On-Time x5', test: s => s.onTime >= 5 },
  rested: { icon: '😴', name: 'Break Pro (10 HOS breaks)', test: s => s.breaks >= 10 }, smooth: { icon: '🧈', name: 'Smooth Operator (5 safe trips)', test: s => s.safeTrips >= 5 },
  streak7: { icon: '🔥', name: '7-day streak', test: s => s.streak >= 7 },
};
export function earnedBadges(stats) { return Object.entries(BADGES).filter(([, b]) => b.test(stats)).map(([id]) => id); }
const dayKey = t => new Date(t).toISOString().slice(0, 10);
export function updateStreak(stats, now = Date.now()) { const today = dayKey(now); if (stats.lastDay === today) return stats;
  const y = dayKey(now - 864e5); stats.streak = stats.lastDay === y ? (stats.streak || 0) + 1 : 1; stats.lastDay = today; return stats; }
export function weekKey(t = Date.now()) { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return dayKey(d); }

// Safe-driving monitor from GPS speed only (no accelerometer): hard brake = decel > 3.4 m/s² (~0.35 g); speeding = > limit + 5 mph for 10s+.
export class DrivingMonitor {
  constructor() { this.hardBrakes = 0; this.speedingSec = 0; this.prev = null; this.overSince = null; this.events = 0; }
  update(fix, limitMps) { // fix {speed,t}
    if (this.prev && fix.speed != null && this.prev.speed != null) { const dt = (fix.t - this.prev.t) / 1000;
      if (dt > 0.5 && dt < 5 && (this.prev.speed - fix.speed) / dt > 3.4 && this.prev.speed > 8) this.hardBrakes++; }
    if (limitMps && fix.speed > limitMps + 2.24) { this.overSince ??= fix.t; if (fix.t - this.overSince > 10e3 && !this._counted) { this.events++; this._counted = true; } }
    else { if (this.overSince) this.speedingSec += (fix.t - this.overSince) / 1000; this.overSince = null; this._counted = false; }
    this.prev = fix;
  }
  safe() { return this.hardBrakes === 0 && this.events === 0; }
}

// Report confirmation scoring: net votes decide visibility/trust
export function reportScore(r) { return (r.up || 0) - (r.down || 0) * 1.5; }
export function reportVisible(r, now = Date.now()) { if (r.down >= 3 && reportScore(r) < 0) return false; const ttl = TTL_H[r.type]; return !ttl || now - r.t < ttl * 3600e3 * (1 + Math.max(0, r.up || 0)); }

// ---------- Backends ----------
class LocalBackend {
  name = 'local';
  async session() { return get('user', null); }
  async signIn(email, phone) { const u = { id: 'local-' + btoa(email).replace(/=/g, '').slice(0, 16), email, phone: phone || '', local: true }; set('user', u); return { user: u, message: 'Saved on this phone. Online accounts (magic-link email) turn on when the server is connected.' }; }
  async signOut() { localStorage.removeItem(LSK('user')); }
  async listReports(bbox) { return get('reports', []).filter(r => !bbox || (r.lon >= bbox[0] && r.lon <= bbox[2] && r.lat >= bbox[1] && r.lat <= bbox[3])); }
  async addReport(r) { const all = get('reports', []); all.push(r); set('reports', all); return r; }
  async vote(id, dir, uid) { const all = get('reports', []); const r = all.find(x => x.id === id); if (!r) return; r.voters ||= {}; const prev = r.voters[uid];
    if (prev === dir) return r; if (prev) r[prev]--; r[dir] = (r[dir] || 0) + 1; r.voters[uid] = dir; set('reports', all); return r; }
  async saveProfile(p) { set('profile', p); }
  async leaderboard(week, me) { return me ? [{ name: me.name, points: me.weekPoints?.[week] || 0, you: true }] : []; }
}
class SupabaseBackend {
  name = 'supabase';
  constructor(cfg) { this.cfg = cfg; }
  async init() { const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2'); this.sb = createClient(this.cfg.url, this.cfg.anonKey); }
  async session() { const { data } = await this.sb.auth.getSession(); const u = data.session?.user; return u ? { id: u.id, email: u.email, phone: u.phone } : null; }
  async signIn(email, phone) {
    if (phone && !email) { const { error } = await this.sb.auth.signInWithOtp({ phone }); if (error) throw error; return { message: 'Text code sent to ' + phone, needCode: 'phone' }; }
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } }); if (error) throw error;
    return { message: 'Check your email for the sign-in link.' };
  }
  async verifyPhone(phone, token) { const { data, error } = await this.sb.auth.verifyOtp({ phone, token, type: 'sms' }); if (error) throw error; return data.user; }
  async signOut() { await this.sb.auth.signOut(); }
  async listReports(b) { const { data } = await this.sb.from('reports').select('*').gte('lon', b[0]).lte('lon', b[2]).gte('lat', b[1]).lte('lat', b[3]).limit(500); return (data || []).map(r => ({ ...r, t: Date.parse(r.t) })); }
  async addReport(r) { const { data, error } = await this.sb.from('reports').insert({ id: r.id, type: r.type, lat: r.lat, lon: r.lon, note: r.note, poi: r.poi ?? null, price: r.price ?? null, key: r.key ?? null, val: r.val ?? null, t: new Date(r.t).toISOString() }).select().single(); if (error) throw error; return { ...data, t: Date.parse(data.t) }; }
  async vote(id, dir) { await this.sb.rpc('vote_report', { report_id: id, dir }); }
  async saveProfile(p) { await this.sb.from('profiles').upsert({ id: (await this.session()).id, name: p.name, avatar: p.avatar, mood: p.mood, points: p.points, stats: p.stats }); }
  async addPoints(pts, why) { await this.sb.from('point_events').insert({ pts, why }); }
  async leaderboard(week) { const { data } = await this.sb.from('weekly_points').select('name,points').eq('week', week).order('points', { ascending: false }).limit(25); return data || []; }
}

export async function makeBackend() {
  let cfg = null; try { cfg = (await import('./config.js')).SUPABASE; } catch {}
  if (cfg?.url && cfg?.anonKey) { try { const b = new SupabaseBackend(cfg); await b.init(); return b; } catch (e) { console.warn('Supabase unavailable, using local', e); } }
  return new LocalBackend();
}

// ---------- Profile / points (client-side bookkeeping) ----------
export class Profile {
  constructor() { this.p = { name: 'Driver', avatar: '🚛', mood: '😎', points: 0, weekPoints: {}, stats: { miles: 0, reports: 0, confirmed: 0, onTime: 0, breaks: 0, safeTrips: 0, streak: 0 }, badges: [], ...get('profile', {}) }; }
  save(backend) { set('profile', this.p); backend?.saveProfile?.(this.p).catch?.(() => {}); }
  add(pts, why) { this.p.points += pts; const w = weekKey(); this.p.weekPoints[w] = (this.p.weekPoints[w] || 0) + pts; updateStreak(this.p.stats);
    const before = new Set(this.p.badges); this.p.badges = earnedBadges(this.p.stats); const fresh = this.p.badges.filter(b => !before.has(b)); (this.history ||= []).push({ pts, why }); return fresh; }
  get level() { return levelFor(this.p.points); }
}
export function nearestReport(reports, lon, lat, type, maxM = 80) { return reports.find(r => r.type === type && haversine([r.lon, r.lat], [lon, lat]) < maxM); }

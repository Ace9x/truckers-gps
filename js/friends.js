// RigRoute Friends — privacy first. Each signed-in driver has a friend code (and optional public username -> code lookup).
// A request travels encrypted on the code's inbox channel; accepting creates a 32-byte pair secret both sides keep.
// Location/route only go to a friend over that pair channel, only when BOTH are friends, sharing is on for that friend, and you're not in ghost mode.
import { Channel, bus, hex, rand, sha, shortCode, normCode, pubkeyOf, KIND_PROFILE } from './link.js';
import { finalizeEvent } from './vendor/nostr.js';
const R = 6371000, rad = d => d * Math.PI / 180;
export function hav(a, b) { const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function bearing(a, b) { const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat)), x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
// snap a point onto a polyline [[lon,lat],...] -> { along (m), dist (m), seg, brg }
export function snap(line, p) { let best = { dist: Infinity }, acc = 0;
  for (let i = 0; i < line.length - 1; i++) { const A = { lon: line[i][0], lat: line[i][1] }, B = { lon: line[i + 1][0], lat: line[i + 1][1] }, L = hav(A, B);
    const kx = Math.cos(rad(A.lat)) * R * Math.PI / 180, ky = R * Math.PI / 180, ax = (B.lon - A.lon) * kx, ay = (B.lat - A.lat) * ky, px = (p.lon - A.lon) * kx, py = (p.lat - A.lat) * ky;
    const t = Math.max(0, Math.min(1, (ax * px + ay * py) / ((ax * ax + ay * ay) || 1))), q = { lon: A.lon + (B.lon - A.lon) * t, lat: A.lat + (B.lat - A.lat) * t }, d = hav(q, p);
    if (d < best.dist) best = { dist: d, along: acc + L * t, seg: i, brg: bearing(A, B) }; acc += L; } return best; }
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** Pass prediction. me/fr: {lat,lon,speed m/s,heading,t}; myRoute: [[lon,lat]]; names: optional [{along,name}] along my route.
 *  Returns {kind:'ahead'|'behind'|'near'|null, miles, minutes, near, text} */
export function passPrediction({ me, fr, myRoute, frRoute = null, names = [], who = 'your friend', now = Date.now(), corridorM = 400 }) {
  if (!me || !fr || !myRoute?.length) return null; if (now - fr.t > 20 * 60e3) return null; // stale friend position
  const s = snap(myRoute, fr), m = snap(myRoute, me); const dir = (fr.heading ?? (frRoute ? null : null));
  const d = hav(me, fr); if (d < 800) return { kind: 'near', miles: d / 1609.34, text: `${who} is right by you (${Math.round(d * 3.281)} ft)` };
  let onMine = s.dist <= corridorM;
  if (!onMine && frRoute?.length) { // friend's planned route crosses mine? use the crossing as meeting point
    const x = crossing(myRoute, frRoute, corridorM); if (x && x.along > m.along) { const vMe = Math.max(me.speed || 0, 13.4), mi = (x.along - m.along) / 1609.34, tMe = (x.along - m.along) / vMe;
      const fs = snap(frRoute, fr), tFr = Math.max(0, x.alongFr - fs.along) / Math.max(fr.speed || 0, 13.4);
      if (Math.abs(tMe - tFr) < 20 * 60) return { kind: 'ahead', miles: mi, minutes: tMe / 60, near: nameAt(names, x.along), text: `Your route crosses ${who}'s in ~${Math.round(mi)} mi${nameAt(names, x.along) ? ' near ' + nameAt(names, x.along) : ''} — about the same time` }; }
    return null; }
  const gap = s.along - m.along, vMe = Math.max(me.speed || 0, 1); const opposite = fr.heading != null && angDiff(fr.heading, s.brg) > 120, vFr = Math.max(fr.speed || 0, 0);
  if (gap > 0) { const close = opposite ? vMe + vFr : vMe - vFr; if (close <= 0.5) return { kind: 'ahead', miles: gap / 1609.34, minutes: null, text: `${who} is ${Math.round(gap / 1609.34)} mi ahead on your route` };
    const tSec = gap / close, mi = vMe * tSec / 1609.34, at = m.along + vMe * tSec, nm = nameAt(names, at);
    return { kind: 'ahead', miles: mi, minutes: tSec / 60, near: nm, text: `You'll pass ${who} in ~${Math.max(1, Math.round(mi))} mi${nm ? ' near ' + nm : ''}` }; }
  const back = -gap, close = opposite ? vMe + vFr : vMe - vFr, ago = close > 0.5 ? back / close / 60 : null;
  return { kind: 'behind', miles: back / 1609.34, minutes: ago, text: ago != null && ago < 180 ? `You passed ${who} ${Math.max(1, Math.round(ago))} min ago` : `${who} is ${Math.round(back / 1609.34)} mi behind you` }; }
function nameAt(names, along) { let n = null; for (const x of names || []) if (x.along <= along + 300 && x.name) n = x.name; return n; }
export function crossing(a, b, tol = 400) { let acc = 0; for (let i = 0; i < a.length; i++) { if (i) acc += hav({ lon: a[i - 1][0], lat: a[i - 1][1] }, { lon: a[i][0], lat: a[i][1] });
    if (i % 3) continue; const p = { lon: a[i][0], lat: a[i][1] }, s = snap(b, p); if (s.dist <= tol) return { along: acc, alongFr: s.along, lon: p.lon, lat: p.lat }; } return null; }
export function simplify(line, maxPts = 300) { if (!line || line.length <= maxPts) return line; const k = Math.ceil(line.length / maxPts); return line.filter((_, i) => i % k === 0 || i === line.length - 1).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]); }

export class Friends {
  constructor(sk, me) { this.sk = sk; this.pk = pubkeyOf(sk); this.me = me; this.cbs = []; this.chans = {};
    const s = JSON.parse(localStorage.getItem('tn_friends_' + this.pk.slice(0, 16)) || 'null') || {}; this.code = s.code || shortCode(); this.friends = s.friends || []; this.requests = []; this.outgoing = s.outgoing || [];
    this.ghost = !!s.ghost; this.shareUntil = s.shareUntil || 0; this.routeShare = s.routeShare ?? false; this.live = {}; this._save(); }
  onChange(cb) { this.cbs.push(cb); } _emit() { this.cbs.forEach(c => { try { c(this); } catch {} }); }
  _save() { localStorage.setItem('tn_friends_' + this.pk.slice(0, 16), JSON.stringify({ code: this.code, friends: this.friends, outgoing: this.outgoing, ghost: this.ghost, shareUntil: this.shareUntil, routeShare: this.routeShare })); }
  get sharingActive() { return !this.ghost && (!this.shareUntil || Date.now() < this.shareUntil); }
  async start() { const inbox = await Channel.fromCode(this.code, 'friend'); this.inbox = inbox;
    inbox.listen(m => { if (m.type !== 'friend_request' || m.fromPk === this.pk) return; if (this.friends.some(f => f.pk === m.fromPk)) return; if (!this.requests.some(r => r.fromPk === m.fromPk)) this.requests.push(m); this._emit(); });
    for (const f of this.friends) await this._attach(f); for (const o of this.outgoing) this._awaitAccept(o); return this; }
  async publishUsername(username) { if (!username) return; const tag = await sha('rigroute-user-v1|' + username.toLowerCase());
    await bus().pub(finalizeEvent({ kind: KIND_PROFILE, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'rigroute-user:' + tag], ['t', tag]], content: JSON.stringify({ code: this.code }) }, this.sk)); }
  async lookup(username) { const tag = await sha('rigroute-user-v1|' + username.replace(/^@/, '').toLowerCase()); const ev = (await bus().query({ kinds: [KIND_PROFILE], '#t': [tag] }, 5000)).sort((a, b) => b.created_at - a.created_at)[0];
    if (!ev) throw new Error('No driver with that username'); return JSON.parse(ev.content).code; }
  async request(target) { const code = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(target.trim()) ? normCode(target) : await this.lookup(target.trim()); if (code === this.code) throw new Error("That's your own code");
    const secret = hex(rand(32)), o = { code, secret, at: Date.now(), label: target }; const ch = await Channel.fromCode(code, 'friend');
    await ch.send(this.sk, { type: 'friend_request', fromPk: this.pk, from: { name: this.me().name, username: this.me().username, truck: this.me().truck }, secret });
    this.outgoing = [...this.outgoing.filter(x => x.code !== code), o]; this._save(); this._awaitAccept(o); this._emit(); return o; }
  async _awaitAccept(o) { const ch = await Channel.fromSecret(o.secret, 'friend'); const un = ch.listen(m => { if (m._from === this.pk) return;
      if (m.type === 'friend_accept') { un(); this.outgoing = this.outgoing.filter(x => x !== o); this._add({ pk: m._from, name: m.from?.name, username: m.from?.username, truck: m.from?.truck, secret: o.secret, share: true, since: Date.now() }); }
      if (m.type === 'friend_decline') { un(); this.outgoing = this.outgoing.filter(x => x !== o); this._save(); this._emit(); } }, Math.floor(o.at / 1000) - 60); }
  async accept(req) { this.requests = this.requests.filter(r => r !== req); const f = { pk: req.fromPk, name: req.from?.name, username: req.from?.username, truck: req.from?.truck, secret: req.secret, share: true, since: Date.now() };
    await this._add(f); await this.chans[f.pk].send(this.sk, { type: 'friend_accept', from: { name: this.me().name, username: this.me().username, truck: this.me().truck } }); }
  async decline(req) { this.requests = this.requests.filter(r => r !== req); (await Channel.fromSecret(req.secret, 'friend')).send(this.sk, { type: 'friend_decline' }, 1).catch(() => {}); this._emit(); }
  async _add(f) { this.friends = [...this.friends.filter(x => x.pk !== f.pk), f]; this._save(); await this._attach(f); this._emit(); }
  async _attach(f) { if (this.chans[f.pk]) return; const ch = await Channel.fromSecret(f.secret, 'friend'); this.chans[f.pk] = ch;
    ch.listen(m => { if (m._from !== f.pk) return; const L = this.live[f.pk] ||= {};
      if (m.type === 'loc') { if (!L.loc || m.t > L.loc.t) L.loc = m; } if (m.type === 'route') L.route = m.line ? m : null; if (m.type === 'stop_share') L.loc = null;
      if (m.type === 'unfriend') { this.friends = this.friends.filter(x => x.pk !== f.pk); delete this.live[f.pk]; this._save(); } this._emit(); }, Math.floor(Date.now() / 1000) - 3600); }
  remove(pk) { this.chans[pk]?.send(this.sk, { type: 'unfriend' }, 1).catch(() => {}); this.friends = this.friends.filter(f => f.pk !== pk); delete this.live[pk]; this._save(); this._emit(); }
  setShare(pk, on) { const f = this.friends.find(x => x.pk === pk); if (!f) return; f.share = !!on; this._save(); if (!on) this.chans[pk]?.send(this.sk, { type: 'stop_share' }, 1).catch(() => {}); this._emit(); }
  setGhost(on) { this.ghost = !!on; this._save(); if (on) this.friends.forEach(f => this.chans[f.pk]?.send(this.sk, { type: 'stop_share' }, 1).catch(() => {})); this._emit(); }
  setTimer(minutes) { this.shareUntil = minutes ? Date.now() + minutes * 60e3 : 0; this._save(); this._emit(); }
  setRouteShare(on) { this.routeShare = !!on; this._save(); this._emit(); }
  /** called by the app with my position; only sends to friends with share on, when not ghost/expired */
  async tick(pos, routeLine) { if (!pos || !this.sharingActive) return 0; let n = 0;
    for (const f of this.friends.filter(f => f.share)) { const ch = this.chans[f.pk]; if (!ch) continue; n++;
      ch.send(this.sk, { type: 'loc', lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5), heading: pos.heading ?? null, speed: pos.speed ?? null, name: this.me().name, truck: this.me().truck?.icon || null }, 1).catch(() => {});
      const key = routeLine ? routeLine.length + ':' + routeLine[0] : 'none'; if (this.routeShare ? f._rk !== key : f._rk && f._rk !== 'off') { f._rk = this.routeShare ? key : 'off'; ch.send(this.sk, { type: 'route', line: this.routeShare && routeLine ? simplify(routeLine) : null }, 1).catch(() => {}); } }
    return n; }
}

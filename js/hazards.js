// Live shared hazard reports: one-tap UI, Waze-style pins/callouts, approaching alerts,
// shared in real time over free public Nostr relays (geohash-tagged), MQTT public broker fallback.
import { finalizeEvent, generateSecretKey } from './vendor/nostr.js';
import { HZ, HZ_ORDER, alive, opacity, ingest, applyVote, RateLimiter, geohash, ghNeighbors, AREA_P, ahead, alertText, dist, tooFar, held, MAX_REPORT_M, FLAG_REASONS } from './hazlogic.js';
import { snapToRoute } from './logic.js';

export const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
export const KIND = 7533, TAG = 'rigroute-hz-v1';
const MQTT_URL = 'wss://broker.emqx.io:8084/mqtt', MQTT_LIB = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

// Reports filed by automated browsers (e2e tests) are tagged test:1 and only visible to other test browsers.
export const IS_TEST = typeof navigator !== 'undefined' && (navigator.webdriver === true || (typeof location !== 'undefined' && /[?&]rrtest=1/.test(location.search)));
export const CHAN = IS_TEST ? TAG + '-test' : TAG; // automated tests publish on their own channel, never the public one
export class LiveHazards {
  constructor({ onChange = () => {}, onStatus = () => {}, relays = RELAYS } = {}) {
    let sk; try { sk = new Uint8Array(JSON.parse(localStorage.getItem('tn_hzsk'))); if (sk.length !== 32) throw 0; } catch { sk = generateSecretKey(); localStorage.setItem('tn_hzsk', JSON.stringify([...sk])); }
    this.sk = sk; this.me = null; this.list = []; this.byId = new Map(); this.pendingVotes = []; this.seen = new Set(); this.trusted = new Set();
    this.mine = new RateLimiter(); this.theirs = new RateLimiter({ perType: 30e3, windowMs: 600e3, maxInWindow: 10 });
    this.onChange = onChange; this.onStatus = onStatus; this.cells = []; this.relays = []; this.status = 'connecting';
    this.urls = relays; relays.forEach(u => this._open(u));
    this._fb = setTimeout(() => { if (!this.relays.some(r => r.open)) this._mqtt(); }, 8000);
  }
  // ---------- transport ----------
  _open(url) {
    const r = { url, open: false }; try { r.ws = new WebSocket(url); } catch { return; } this.relays.push(r);
    r.ws.onopen = () => { r.open = true; this._st('live'); this._req(r); this.outbox?.forEach(m => r.ws.send(m)); };
    r.ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m[0] === 'EVENT') this._event(m[2]); } catch {} };
    r.ws.onclose = () => { r.open = false; this.relays = this.relays.filter(x => x !== r); if (!this.relays.some(x => x.open) && !this.mq) this._st('reconnecting'); setTimeout(() => this._open(url), 4000); };
    r.ws.onerror = () => {};
  }
  _st(s) { this.status = s; this.onStatus(s); }
  _req(r) { if (!this.cells.length) return; try { r.ws.send(JSON.stringify(['REQ', 'hz', { kinds: [KIND], '#g': this.cells, '#t': [CHAN], since: Math.floor(Date.now() / 1000) - 31 * 86400, limit: 500 }])); } catch {} }
  async _mqtt() { try { if (!window.mqtt) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = MQTT_LIB; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      this.mq = window.mqtt.connect(MQTT_URL, { clientId: 'rr_' + Math.random().toString(16).slice(2), clean: true });
      this.mq.on('connect', () => { this._st('live (mqtt)'); this._mqsub(); });
      this.mq.on('message', (_t, p) => { try { this._event(JSON.parse(p.toString())); } catch {} }); } catch { this._st('offline'); } }
  _mqsub() { if (this.mq?.connected) this.cells.forEach(c => this.mq.subscribe(`${CHAN}/${c}`)); }
  setArea(lat, lon) { const c = geohash(lat, lon, AREA_P); if (c === this.cell) return; this.cell = c; this.cells = ghNeighbors(c); this.relays.filter(r => r.open).forEach(r => this._req(r)); this._mqsub(); }
  _send(ev) { const m = JSON.stringify(['EVENT', ev]); this.outbox = [...(this.outbox || []).slice(-20), m]; let n = 0;
    this.relays.forEach(r => { if (r.open) try { r.ws.send(m); n++; } catch {} });
    if (this.mq?.connected) { this.mq.publish(`${CHAN}/${ev.tags.find(t => t[0] === 'g')[1]}`, JSON.stringify(ev)); n++; } return n; }
  _sign(content, lat, lon, expSec) { const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), content: JSON.stringify({ ...content, v: 2, ...(IS_TEST ? { test: 1 } : {}) }),
      tags: [['g', geohash(lat, lon, AREA_P)], ['g', geohash(lat, lon, 6)], ['t', CHAN], ['expiration', String(expSec)]] }, this.sk); this.me = ev.pubkey; this.seen.add(ev.id); return ev; }
  // ---------- inbound ----------
  _event(ev) { if (!ev || this.seen.has(ev.id) || ev.kind !== KIND) return; this.seen.add(ev.id);
    let c; try { c = JSON.parse(ev.content); } catch { return; }
    if (!c.v || !!c.test !== IS_TEST) return; // automated-test reports never show to real drivers (and untagged legacy test reports are ignored)
    const t = Math.min(ev.created_at * 1000, Date.now() + 60e3);
    if (c.a === 'r') { if (ev.pubkey !== this.me && !this.theirs.allow(ev.pubkey, c.type, t)) return;
      const rep = { id: ev.id, type: c.type, lat: +c.lat, lon: +c.lon, hd: c.hd ?? null, t, by: ev.pubkey, mine: ev.pubkey === this.me, rlat: c.rlat == null ? null : +c.rlat, rlon: c.rlon == null ? null : +c.rlon };
      if (tooFar(rep)) return; // filed >2 km from the reporter (or no reporter position): rejected
      const res = ingest(this.list, rep); if (res.added) this.byId.set(rep.id, this.list.find(x => x.id === rep.id)); if (res.merged) this.byId.set(rep.id, res.merged);
      this.pendingVotes = this.pendingVotes.filter(v => { const r = this.byId.get(v.rid); if (r) applyVote(r, v); return !r; });
      if (!res.dropped) this.onChange(); }
    else if (c.a === 'v') { if (ev.pubkey !== this.me && !this.theirs.allow(ev.pubkey, 'vote', t)) return; const v = { rid: c.rid, dir: c.dir === 'down' ? 'down' : 'up', reason: FLAG_REASONS[c.reason] ? c.reason : null, by: ev.pubkey, t }; const r = this.byId.get(c.rid);
      if (r) { applyVote(r, v); this.onChange(); } else this.pendingVotes.push(v); } }
  // ---------- outbound ----------
  report(type, lat, lon, hd = null, from = null) { const h = HZ[type]; if (!h) return { error: 'type' };
    if (!from || !isFinite(from.lat)) return { nofix: true }; if (dist(from, { lat, lon }) > MAX_REPORT_M) return { far: true };
    const now = Date.now(), near = this.list.find(x => x.type === type && alive(x, now) && dist(x, { lat, lon }) <= h.r);
    if (near) { if (!near.mine) this.vote(near, 'up'); return { dup: near }; }   // dedupe: same thing already reported → confirm it instead
    if (!this.mine.allow('me', type, now)) return { limited: true };
    const ev = this._sign({ a: 'r', type, lat: +lat.toFixed(6), lon: +lon.toFixed(6), hd: hd == null ? null : Math.round(hd), rlat: +from.lat.toFixed(5), rlon: +from.lon.toFixed(5) }, lat, lon, Math.floor((now + h.ttl * 3) / 1000));
    const rep = { id: ev.id, type, lat, lon, hd, t: now, by: ev.pubkey, mine: true }; ingest(this.list, rep); this.byId.set(rep.id, this.list.find(x => x.id === rep.id));
    const sent = this._send(ev); this.onChange(); return { rep: this.byId.get(rep.id), sent }; }
  vote(r, dir, reason = null) { if (r.mine) return; if (!this.mine.allow('me', 'vote', Date.now())) return { limited: true }; const ev = this._sign({ a: 'v', rid: r.id, dir, ...(dir === 'down' && reason ? { reason } : {}) }, r.lat, r.lon, Math.floor((expiresAtSafe(r) + 86400e3) / 1000));
    applyVote(r, { by: ev.pubkey, dir, t: Date.now() }); this._send(ev); this.onChange(); }
  visible(now = Date.now()) { const L = this.list.filter(r => alive(r, now)); for (const r of L) if (r.up > 0) this.trusted.add(r.by); return L; }
  isHeld(r) { return held(r, this.trusted); }
}
const expiresAtSafe = r => (r.t || Date.now()) + (HZ[r.type]?.ttl || 0) * 3;

// ---------- UI ----------
const REASON_OPTS = Object.entries(FLAG_REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
export function init(S, { $, map, say, toast, report: legacyReport, openPanel, closePanels, esc }) {
  const ago = ms => ms < 60e3 ? 'just now' : ms < 3600e3 ? `${Math.round(ms / 60e3)} min ago` : ms < 86400e3 ? `${Math.round(ms / 3600e3)} h ago` : `${Math.round(ms / 86400e3)} d ago`;
  const css = document.createElement('style'); css.textContent = `
  #hzSheet{position:fixed;inset:auto 0 0 0;z-index:40;background:#141820f2;backdrop-filter:blur(8px);border-radius:22px 22px 0 0;padding:14px 12px calc(14px + env(safe-area-inset-bottom));box-shadow:0 -8px 30px #000a}
  #hzSheet h3{margin:0 0 10px;font-size:18px;color:#fff;display:flex;justify-content:space-between;align-items:center}
  #hzGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  #hzGrid button{min-height:86px;border:0;border-radius:18px;background:#232a36;color:#fff;font-weight:700;font-size:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
  #hzGrid button b{font-size:34px;line-height:1} #hzGrid button:active{transform:scale(.95);background:#f59e0b;color:#111}
  #hzSheet .row{display:flex;gap:10px;margin-top:10px} #hzSheet .row button{flex:1;min-height:52px;border-radius:14px;border:0;font-weight:700;font-size:15px;background:#2d3748;color:#fff}
  .hz-pin{width:40px;height:48px;position:relative;cursor:pointer;transition:opacity .6s}
  .hz-pin .bub{position:absolute;left:0;top:0;width:40px;height:40px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#f59e0b;border:3px solid #fff;box-shadow:0 3px 10px #0009}
  .hz-pin.red .bub{background:#e53935} .hz-pin.blue .bub{background:#1e88e5} .hz-pin.green .bub{background:#2e7d32}
  .hz-pin i{position:absolute;left:0;top:2px;width:40px;text-align:center;font-style:normal;font-size:20px}
  .hz-call{position:absolute;bottom:52px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#fff;color:#111;font:700 12px system-ui;padding:4px 8px;border-radius:10px;box-shadow:0 2px 8px #0007}
  .hz-call:after{content:'';position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#fff}
  #hzBanner{position:fixed;left:10px;right:10px;top:calc(96px + env(safe-area-inset-top));z-index:30;display:flex;gap:12px;align-items:center;background:#f59e0b;color:#111;border-radius:18px;padding:12px 14px;box-shadow:0 8px 24px #000a;font-weight:800}
  #hzBanner.red{background:#e53935;color:#fff} #hzBanner b{font-size:34px} #hzBanner .t{flex:1;font-size:17px} #hzBanner .d{font-size:13px;opacity:.85;font-weight:700}
  #hzBanner button{border:0;border-radius:12px;padding:10px;font-size:16px;background:#fff3}
  #hzLive{position:fixed;right:10px;bottom:calc(150px + env(safe-area-inset-bottom));z-index:6;font:700 11px system-ui;background:#000a;color:#9f9;padding:3px 7px;border-radius:9px;pointer-events:none}`;
  document.head.appendChild(css);
  const color = t => ['accident', 'closed', 'clearance', 'weigh_closed'].includes(t) ? 'red' : t === 'police' || t === 'camera' ? 'blue' : t === 'weigh_open' ? 'green' : '';
  const live = document.createElement('div'); live.id = 'hzLive'; live.textContent = '● reports: connecting'; document.body.appendChild(live);
  let markers = new Map();
  const hz = new LiveHazards({ onChange: () => draw(), onStatus: s => { live.textContent = `● live reports: ${s}`; live.style.color = /live/.test(s) ? '#9f9' : '#fc6'; } });
  S.hz = hz; S.hzShowBanner = (r, d) => showBanner(r, d); // test/screenshot hook
  const here = () => S.pos || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })();
  const syncArea = () => { const p = here(); hz.setArea(p.lat, p.lon); }; syncArea();
  map.on('moveend', () => { if (!S.pos) syncArea(); });
  function draw() { const now = Date.now(), vis = hz.visible(now), p = here(), keep = new Set();
    for (const r of vis) { keep.add(r.id); let m = markers.get(r.id); const h = HZ[r.type], d = dist(p, r);
      if (!m) { const el = document.createElement('div'); el.className = `hz-pin ${color(r.type)}`; el.dataset.hz = r.type; el.dataset.id = r.id;
        el.innerHTML = `<div class="bub"></div><i>${h.icon}</i><div class="hz-call"></div>`;
        const pop = new maplibregl.Popup({ offset: 30 }); pop.on('open', () => { const box = document.createElement('div');
          box.innerHTML = `<b style="color:#111;font-size:15px">${h.icon} ${h.label}</b><br><span style="color:#333">${ago(Date.now() - r.t)} · 👍 ${+r.up || 0} · 👎 ${+r.down || 0}</span>` + (r.mine ? '<br><i style="color:#555">Your report</i>' : '<div class="vote"><button data-v="up" style="min-height:44px">👍 Still there</button><button data-v="down" style="min-height:44px">👎 Not there</button><label style="display:block;color:#333;font-size:13px;margin-top:6px">Reason for "not there" <select class="hz-reason" style="min-height:40px;font-size:15px;width:100%">' + REASON_OPTS + '</select></label></div>');
          box.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { hz.vote(r, b.dataset.v, box.querySelector('.hz-reason')?.value || 'gone'); pop.remove(); toast(b.dataset.v === 'up' ? 'Thanks — kept on the map' : 'Thanks — 2 "not there" votes remove it'); });
          pop.setDOMContent(box); });
        m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([r.lon, r.lat]).setPopup(pop).addTo(map); markers.set(r.id, m); }
      const el = m.getElement(); el.style.opacity = opacity(r, now); el.dataset.op = opacity(r, now);
      const call = el.querySelector('.hz-call'); call.textContent = `${h.label} · ${hz.isHeld(r) ? 'unconfirmed' : ago(now - (r.lastUp || r.t))}`; el.classList.toggle('held', hz.isHeld(r)); call.style.display = d < 3000 ? '' : 'none';
      el.style.display = S.layers?.reports === false ? 'none' : ''; }
    for (const [id, m] of markers) if (!keep.has(id)) { m.remove(); markers.delete(id); }
    checkAhead(); }
  // approaching alerts
  const warned = new Map(); let banner;
  function showBanner(r, d) { banner?.remove(); banner = document.createElement('div'); banner.id = 'hzBanner'; banner.className = color(r.type) === 'red' ? 'red' : '';
    // UX P9: approach-triggered, two equal 76 px answers, auto-dismiss after 8 s (progress bar), spoken at the same time.
    banner.innerHTML = `<div class="hzb-top"><b>${HZ[r.type].icon}</b><div class="t">${HZ[r.type].label} ahead<div class="d">${(d / 1609.34).toFixed(1)} mi · reported ${ago(Date.now() - r.t)} · 👍 ${+r.up || 0}</div></div></div>` +
      (r.mine ? '' : '<div class="hzb-btns"><button data-v="up" aria-label="Thanks, still there">Thanks</button><button data-v="down" aria-label="Not there">Not there</button></div>') + '<i class="hzb-bar"></i>';
    banner.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { hz.vote(r, b.dataset.v, 'gone'); banner.remove(); toast(b.dataset.v === 'up' ? 'Thanks — kept on the map' : 'Thanks — marked not there'); });
    document.body.appendChild(banner); S.hzLastBanner = banner.textContent; const bb = banner; setTimeout(() => bb.remove(), 8000); }
  function checkAhead() { const p = S.pos; if (!p) return;
    const route = S.nav && S.route ? { line: S.route.line, cum: S.route.cum, along: S.along || 0 } : null;
    const list = ahead(hz.visible().filter(r => !hz.isHeld(r)), { pos: p, heading: p.heading, route, snap: snapToRoute }).filter(x => !x.r.mine);
    S.hzAhead = list.map(x => ({ id: x.r.id, type: x.r.type, d: Math.round(x.d) }));
    for (const { r, d } of list) { const w = warned.get(r.id) || 0, stage = d < 500 ? 2 : 1; if (w >= stage) continue; warned.set(r.id, stage);
      showBanner(r, d); const txt = alertText(r, d); S.hzLastAlert = txt; say(txt, 'hazard', true); break; } }
  setInterval(() => { syncArea(); draw(); }, 5000);
  // one-tap sheet
  let sheet;
  function openSheet() { if (sheet) return closeSheet(); sheet = document.createElement('div'); sheet.id = 'hzSheet';
    sheet.innerHTML = `<h3>Report what you see <span style="font-size:12px;color:#9aa">one tap · shared live with nearby drivers</span></h3><div id="hzGrid">${HZ_ORDER.map(k => `<button data-hz="${k}"><b>${HZ[k].icon}</b>${HZ[k].label}</button>`).join('')}</div>
      <div class="row">${(window.SpeechRecognition || window.webkitSpeechRecognition) ? '<button id="hzMic">🎤 Say it</button>' : ''}<button id="hzMore">More (no trucks, weight, parking)</button><button id="hzX">Cancel</button></div>`;
    document.body.appendChild(sheet);
    sheet.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => file(b.dataset.hz));
    sheet.querySelector('#hzX').onclick = closeSheet; sheet.querySelector('#hzMore').onclick = () => { closeSheet(); openPanel('reportPanel'); };
    const mic = sheet.querySelector('#hzMic'); if (mic) mic.onclick = listen; }
  function closeSheet() { sheet?.remove(); sheet = null; }
  function file(type, quiet) { closeSheet(); const p = S.pos || here(), [lon, lat] = S.nav && S.reportPoint ? S.reportPoint() : [p.lon, p.lat];
    const res = hz.report(type, lat, lon, S.pos?.heading ?? null, S.pos ? { lat: S.pos.lat, lon: S.pos.lon } : null), h = HZ[type];
    if (res.nofix) toast('Waiting for GPS — reports need your real position');
    else if (res.far) toast('Reports must be within 2 km of where you are');
    else if (res.limited) toast('Easy, driver — you just reported that. Try again in a minute.');
    else if (res.dup) toast(res.dup.mine ? `You already reported this ${h.label.toLowerCase()}` : `${h.label} was already reported here — added your 👍`);
    else { toast(`${h.icon} ${h.label} reported — shared with drivers nearby`); if (!quiet) say(`${h.say} reported. Thanks, driver.`, 'report');
      if (!h.avoid) S.award?.(10, `${h.label} report`); if (h.avoid && legacyReport) legacyReport(type, [lon, lat]).catch?.(() => {}); }
    return res; }
  S.hzFile = file;
  function listen() { const SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = new SR(); rec.lang = 'en-US';
    rec.onresult = e => { const t = e.results[0][0].transcript.toLowerCase(); const k = parseVoice(t); if (k) file(k); else toast(`Didn't catch a report type in "${t}"`); };
    rec.start(); toast('Listening… say "report accident"'); }
  const rb = $('#reportBtn'); if (rb) { rb.onclick = openSheet; rb.style.width = rb.style.height = '64px'; rb.style.fontSize = '30px'; }
  draw();
}
export function parseVoice(t) { const m = [['accident', /accident|crash|wreck/], ['police', /police|cop|trooper|bear/], ['camera', /camera/], ['construction', /construction|work zone/], ['debris', /debris|object|tire|ladder/],
  ['stalled', /stall|broke|disabled/], ['clearance', /clearance|bridge|low/], ['ice', /ice|icy|snow|weather|fog/], ['closed', /closed|closure/], ['weigh_open', /scale.*open|open.*scale|weigh.*open/], ['weigh_closed', /scale.*closed|weigh.*closed/], ['hazard', /hazard|other/]];
  const w = m.filter(([k]) => k.startsWith('weigh')).find(([, r]) => r.test(t)) || m.find(([, r]) => r.test(t)); return w ? w[0] : null; }

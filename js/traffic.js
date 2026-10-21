// Live traffic: free sources (NYC DOT keyless, optional free TomTom / HERE developer keys) + anonymous RigRoute crowd speeds over free Nostr relays.
// Colors the map, adds traffic-aware ETA, jam alerts ahead, truck-safe faster-route suggestions, and Waze/Google/Apple second-opinion links.
import { finalizeEvent, generateSecretKey } from './vendor/nostr.js';
import { geohash, ghNeighbors } from './hazlogic.js';
import { cumulative, decodePolyline } from './logic.js';
import { LEVELS, level, segKey, aggregate, routeTraffic, jamText, rerouteDecision, ageText, wazeLink, gmapsLink, appleLink, parseNycDot, freshLinks, linkObs, traceRequest, parseTrace, parseHere, parseTomTom, MPH, MI } from './trafficlogic.js';
import { RELAYS } from './hazards.js';

export const TKIND = 7534, TTAG = 'rigroute-tf-v1';
const NYC = 'https://data.cityofnewyork.us/resource/i4gi-tjb9.json';
const NYC_BOX = [-74.30, 40.48, -73.65, 40.95];
const inBox = (p, b) => p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3];
const empty = { type: 'FeatureCollection', features: [] };

export function init(S, { $, map, say, toast, esc, LS }) {
  const T = { feeds: {}, crowd: [], links: [], status: {}, keys: { tomtom: LS.get('tomtomKey', ''), here: LS.get('hereKey', '') }, thresholdMin: LS.get('trafficRerouteMin', 5) };
  S.traffic = T;
  // ---------- styles ----------
  const css = document.createElement('style'); css.textContent = `
  #tfBanner{position:fixed;left:10px;right:10px;top:calc(168px + env(safe-area-inset-top));z-index:31;background:#b71c1c;color:#fff;border-radius:18px;padding:12px 14px;box-shadow:0 8px 24px #000a;font-weight:800;display:flex;gap:10px;align-items:center}
  #tfBanner.slow{background:#f9a825;color:#111} #tfBanner .t{flex:1;font-size:17px} #tfBanner .d{font-size:12px;opacity:.85}
  #tfBanner button{border:0;border-radius:12px;padding:12px 14px;font-weight:800;font-size:15px;background:#fff;color:#111}
  #tfBanner button.x{background:#fff3;color:inherit}
  .tf-row{margin-top:4px;font-size:13px} .tf-row b{padding:1px 6px;border-radius:6px;color:#fff}
  #tfBox{margin:8px 0;padding:8px;border-radius:12px;background:#ffffff10;font-size:13px}
  #tfBox .links{display:flex;gap:6px;margin-top:6px} #tfBox .links a{flex:1;text-align:center;padding:9px 4px;border-radius:10px;background:#2d3748;color:#fff;text-decoration:none;font-weight:700}
  #tfLegend{position:fixed;left:10px;bottom:calc(262px + env(safe-area-inset-bottom));z-index:6;font:700 11px system-ui;background:#000b;color:#ddd;padding:4px 8px;border-radius:9px;pointer-events:none;max-width:60vw}
  #tfLegend i{display:inline-block;width:14px;height:4px;margin:0 3px 2px 6px;vertical-align:middle}`;
  document.head.appendChild(css);
  const legend = document.createElement('div'); legend.id = 'tfLegend'; document.body.appendChild(legend);
  // ---------- map layers ----------
  function layers() {
    if (!map.getSource('tf')) map.addSource('tf', { type: 'geojson', data: T.geo || empty });
    if (!map.getSource('tfRoute')) map.addSource('tfRoute', { type: 'geojson', data: T.routeGeo || empty });
    const before = map.getLayer('route-casing') ? 'route-casing' : undefined;
    // UX P7 / code C2: casing + exponential width; motorway/trunk only below z12, primary+ from z12, everything matched from z14.
    const clsFilter = ['any', ['in', ['get', 'cls'], ['literal', ['motorway', 'trunk']]], ['all', ['>=', ['zoom'], 12], ['==', ['get', 'cls'], 'primary']], ['>=', ['zoom'], 14]];
    const W = (k, add = 0) => ['interpolate', ['exponential', 1.5], ['zoom'], 9, 1.5 * k + add, 12, 3 * k + add, 15, 6 * k + add, 18, 14 * k + add]; // zoom must be the top-level interpolate input (no ['+', interpolate, n])
    if (!map.getLayer('tf-casing')) map.addLayer({ id: 'tf-casing', type: 'line', source: 'tf', minzoom: 9, filter: clsFilter, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: S.layers?.traffic === false ? 'none' : 'visible' },
      paint: { 'line-color': '#000', 'line-opacity': 0.6, 'line-width': W(1, 3) } }, before);
    if (!map.getLayer('tf')) map.addLayer({ id: 'tf', type: 'line', source: 'tf', minzoom: 9, filter: clsFilter, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: S.layers?.traffic === false ? 'none' : 'visible' },
      paint: { 'line-color': ['match', ['get', 'level'], 'free', LEVELS[0].color, 'slow', LEVELS[1].color, 'heavy', LEVELS[2].color, LEVELS[3].color], 'line-width': W(1) } }, before);
    if (!map.getLayer('tfRoute')) map.addLayer({ id: 'tfRoute', type: 'line', source: 'tfRoute', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'level'], 'slow', LEVELS[1].color, 'heavy', LEVELS[2].color, LEVELS[3].color], 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 3, 12, 6, 16, 10] } }, map.getLayer('done') ? 'done' : undefined);
    if (T.keys.tomtom && !map.getSource('ttflow')) { map.addSource('ttflow', { type: 'raster', tileSize: 256, attribution: 'Traffic © TomTom', tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(T.keys.tomtom)}`] });
      map.addLayer({ id: 'ttflow', type: 'raster', source: 'ttflow', minzoom: 8, paint: { 'raster-opacity': 0.8 } }, before); }
  }
  map.on('style.load', layers); if (map.isStyleLoaded()) layers(); else map.once('load', layers);
  map.on('click', 'tf', e => { const p = e.features[0].properties; new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b style="color:#111">${esc(p.name || 'Road')}</b><br><span style="color:#333">${Math.round(p.mph)} mph now (normal ~${Math.round(p.ff)}) · ${level(p.ratio).label}<br><i>Source: ${esc(p.src)} · ${ageText(Date.now() - p.t)}</i></span>`).addTo(map); });

  // ---------- sources ----------
  async function fetchNyc() { if (T.feeds.nyc && Date.now() - T.feeds.nyc.fetched < 120e3) return;
    try { const r = await fetch(`${NYC}?$limit=3000&$where=data_as_of>'${new Date(Date.now() - 6 * 3600e3 - 4 * 3600e3).toISOString().slice(0, 19)}'&$order=data_as_of DESC`, { signal: AbortSignal.timeout(25000) });
      const rows = await r.json(); const seen = new Set(), latest = rows.filter(x => !seen.has(x.link_id) && seen.add(x.link_id));
      const all = parseNycDot(latest), links = freshLinks(all); T.feeds.nyc = { links, fetched: Date.now(), t: Math.max(0, ...links.map(l => l.t)) }; T.status.nyc = links.length ? `${links.length} links` : all.length ? 'stale (hidden)' : 'no data'; }
    catch (e) { T.status.nyc = 'unavailable'; } }
  async function fetchHere(b) { if (!T.keys.here) return; try {
      const j = await (await fetch(`https://data.traffic.hereapi.com/v7/flow?in=bbox:${b.map(x => x.toFixed(4)).join(',')}&locationReferencing=shape&apiKey=${encodeURIComponent(T.keys.here)}`, { signal: AbortSignal.timeout(20000) })).json();
      const links = parseHere(j); T.feeds.here = { links, fetched: Date.now(), t: Date.now() }; T.status.here = j.error ? 'key error' : `${links.length} links`;
      try { const ij = await (await fetch(`https://data.traffic.hereapi.com/v7/incidents?in=bbox:${b.map(x => x.toFixed(4)).join(',')}&locationReferencing=shape&apiKey=${encodeURIComponent(T.keys.here)}`)).json();
        T.incidents = [...(T.incidents || []).filter(i => i.src !== 'HERE'), ...(ij.results || []).map(i => { const p = i.location?.shape?.links?.[0]?.points?.[0]; return p && { lat: p.lat, lon: p.lng, closed: !!i.incidentDetails?.roadClosed, desc: i.incidentDetails?.description?.value || i.incidentDetails?.type, src: 'HERE' }; }).filter(Boolean)]; } catch {}
    } catch { T.status.here = 'unavailable'; } }
  async function fetchTomTom(route, from) { if (!T.keys.tomtom || !route) return; const pts = [];
    for (let a = from + 500; a < Math.min(route.length, from + 40e3) && pts.length < 10; a += 4000) { const i = route.cum.findIndex(c => c >= a); if (i > 0) pts.push(route.line[i]); }
    const links = (await Promise.all(pts.map(([lon, lat]) => fetch(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=KMPH&key=${encodeURIComponent(T.keys.tomtom)}`).then(r => r.json()).then(j => parseTomTom(j)).catch(() => null)))).filter(Boolean);
    T.feeds.tomtom = { links, fetched: Date.now(), t: Date.now() }; T.status.tomtom = `${links.length} segments`;
    const b = bboxOf(route.line.slice(route.cum.findIndex(c => c >= from)), 0.02);
    try { const ij = await (await fetch(`https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${b.join(',')}&fields={incidents{geometry{type,coordinates},properties{iconCategory,events{description},delay}}}&language=en-US&key=${encodeURIComponent(T.keys.tomtom)}`)).json();
      T.incidents = [...(T.incidents || []).filter(i => i.src !== 'TomTom'), ...(ij.incidents || []).map(i => { const c = i.geometry.type === 'Point' ? i.geometry.coordinates : i.geometry.coordinates[0]; return { lat: c[1], lon: c[0], closed: i.properties.iconCategory === 8, desc: i.properties.events?.[0]?.description, delay: i.properties.delay, src: 'TomTom' }; })]; } catch {} }
  const bboxOf = (ln, pad) => { let a = [180, 90, -180, -90]; for (const [x, y] of ln) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; return [a[0] - pad, a[1] - pad, a[2] + pad, a[3] + pad]; };

  // ---------- crowd speeds over Nostr ----------
  let sk; try { sk = new Uint8Array(JSON.parse(localStorage.getItem('tn_tfsk'))); if (sk.length !== 32) throw 0; } catch { sk = generateSecretKey(); localStorage.setItem('tn_tfsk', JSON.stringify([...sk])); }
  const rel = []; T.cells = []; const seen = new Set();
  function open(url) { const r = { url, open: false }; try { r.ws = new WebSocket(url); } catch { return; } rel.push(r);
    r.ws.onopen = () => { r.open = true; T.status.crowd = 'live'; req(r); };
    r.ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m[0] === 'EVENT') ingest(m[2]); } catch {} };
    r.ws.onclose = () => { r.open = false; rel.splice(rel.indexOf(r), 1); setTimeout(() => open(url), 5000); }; r.ws.onerror = () => {}; }
  const req = r => { if (T.cells.length) try { r.ws.send(JSON.stringify(['REQ', 'tf', { kinds: [TKIND], '#g': T.cells, '#t': [TTAG], since: Math.floor(Date.now() / 1000) - 900, limit: 1000 }])); } catch {} };
  RELAYS.forEach(open); T.relays = rel;
  function ingest(ev) { if (!ev || ev.kind !== TKIND || seen.has(ev.id)) return; seen.add(ev.id); let c; try { c = JSON.parse(ev.content); } catch { return; }
    if (!(c.mph >= 0 && c.mph < 100) || typeof c.k !== 'string') return;
    T.crowd.push({ k: c.k, mph: +c.mph, ff: +c.ff || 50, lat: +c.lat, lon: +c.lon, h: c.h, t: Math.min(ev.created_at * 1000, Date.now()), by: ev.pubkey });
    if (T.crowd.length > 5000) T.crowd = T.crowd.slice(-4000); schedule(); }
  function setArea(lat, lon) { const c = geohash(lat, lon, 4); if (c === T.cell) return; T.cell = c; T.cells = ghNeighbors(c); rel.filter(r => r.open).forEach(req); }
  // Anonymous: random per-install key, position rounded to ~150 m segment, no route/destination/ID shared. Opt-out in Settings.
  function share(mph, pos = S.pos, ff = S.expMph || 50) { if (!pos || LS.get('shareSpeed', true) === false) return 0;
    const lat = +pos.lat.toFixed(4), lon = +pos.lon.toFixed(4), h = pos.heading == null ? null : Math.round(pos.heading / 45) * 45 % 360;
    const ev = finalizeEvent({ kind: TKIND, created_at: Math.floor(Date.now() / 1000), content: JSON.stringify({ k: segKey(pos.lat, pos.lon, pos.heading), mph: Math.round(mph), ff: Math.round(ff), lat, lon, h }),
      tags: [['g', geohash(pos.lat, pos.lon, 4)], ['t', TTAG], ['expiration', String(Math.floor(Date.now() / 1000) + 1800)]] }, sk);
    ingest(ev); const m = JSON.stringify(['EVENT', ev]); let n = 0; rel.forEach(r => { if (r.open) try { r.ws.send(m); n++; } catch {} }); return n; }
  T.share = share; T.aggregate = () => aggregate(T.crowd);
  // Auto-share only while actually rolling (>= 60 m since last share or > 3 mph) so parked/idling trucks never paint fake jams; never from automated test browsers.
  let lastShare = 0, lastAt = null;
  setInterval(() => { const p = S.pos; if (!p) return; setArea(p.lat, p.lon); if (navigator.webdriver) return;
    const mph = (p.speed || 0) * MPH, moved = lastAt ? Math.hypot((p.lon - lastAt.lon) * 84e3, (p.lat - lastAt.lat) * 111e3) : 1e9;
    if (S.nav && (mph > 3 || moved >= 60) && Date.now() - lastShare > 30e3) { lastShare = Date.now(); lastAt = { lat: p.lat, lon: p.lon }; share(mph); } }, 5000);

  // ---------- combine ----------
  function allLinks() { const out = []; for (const k of ['here', 'tomtom', 'nyc']) for (const l of T.feeds[k]?.links || []) out.push(l);
    for (const a of Object.values(aggregate(T.crowd))) { const h = (a.h ?? 0) * Math.PI / 180, d = 0.0007;
      out.push({ id: a.k, name: `RigRoute drivers (${a.n})`, mph: a.mph, ff: a.ff, ratio: a.ratio, coords: [[a.lon - Math.sin(h) * d, a.lat - Math.cos(h) * d * 0.76], [a.lon + Math.sin(h) * d, a.lat + Math.cos(h) * d * 0.76]], t: a.t, src: 'RigRoute drivers', crowd: a }); }
    return out; }
  function obsFor(route) { const b = bboxOf(route.line, 0.01), o = [];
    for (const l of allLinks()) { if (!l.coords.some(([x, y]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) continue;
      if (l.crowd) o.push({ lat: l.crowd.lat, lon: l.crowd.lon, h: l.crowd.h, mph: l.mph, ff: l.ff, src: l.src, t: l.t }); else o.push(...linkObs(l)); }
    return o.concat(T.injected || []); }
  T.routeTraffic = (route, from = 0) => { if (!route.cum) route.cum = cumulative(route.line); return routeTraffic(route, obsFor(route), { from }); };
  let pend = null; const schedule = () => { clearTimeout(pend); pend = setTimeout(refresh, 400); };
  // Map-match NYC DOT links once (geometry is static), cache by link_id; only links near the view, 2 at a time.
  T.match = new Map(Object.entries((() => { try { return JSON.parse(localStorage.getItem('tn_tfmatch') || '{}'); } catch { return {}; } })()));
  const mq = [], inq = new Set(), failed = new Set(); let busy = 0;
  function queueMatch(l) { if (inq.has(l.id) || failed.has(l.id) || T.match.has(l.id)) return; const b = map.getBounds();
    if (!l.coords.some(([x, y]) => b.contains([x, y]))) return; inq.add(l.id); mq.push(l); pump(); }
  async function pump() { while (busy < 2 && mq.length) { const l = mq.shift(); busy++;
      fetch('https://valhalla1.openstreetmap.de/trace_attributes', { method: 'POST', body: JSON.stringify(traceRequest(l.coords)), signal: AbortSignal.timeout(15000) })
        .then(r => r.ok ? r.json() : null).then(j => { const m = parseTrace(j, decodePolyline); if (m) { m.coords = m.coords.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]); T.match.set(l.id, m); saveMatch(); schedule(); } else failed.add(l.id); })
        .catch(() => failed.add(l.id)).finally(() => { busy--; inq.delete(l.id); setTimeout(pump, 300); }); } }
  let saveT; const saveMatch = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('tn_tfmatch', JSON.stringify(Object.fromEntries(T.match))); } catch {} }, 2000); };
  map.on('moveend', () => { if (T.links) for (const l of T.links) if (l.src === 'NYC DOT' && !T.match.has(l.id)) queueMatch(l); });
  function refresh() { const links = allLinks(); T.links = links;
    T.geo = { type: 'FeatureCollection', features: links.filter(l => !l.crowd).map(l => { const m = l.src === 'NYC DOT' ? T.match.get(l.id) : { coords: l.coords, cls: l.cls || 'primary' }; if (!m) { queueMatch(l); return null; }
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: m.coords }, properties: { cls: m.cls, level: level(l.ratio).id, ratio: l.ratio, mph: l.mph, ff: l.ff, name: l.name, src: l.src, t: l.t } }; }).filter(Boolean) };
    map.getSource('tf')?.setData(T.geo);
    const r = S.route; if (r) { const tr = T.routeTraffic(r, S.nav ? S.along || 0 : 0); T.cur = tr;
      T.routeGeo = { type: 'FeatureCollection', features: tr.slowdowns.map(s => ({ type: 'Feature', properties: { level: s.level }, geometry: { type: 'LineString', coordinates: slice(r, s.start, s.end) } })) };
      map.getSource('tfRoute')?.setData(T.routeGeo); S.trafficDelay = tr.delay; } else { T.cur = null; S.trafficDelay = 0; map.getSource('tfRoute')?.setData(empty); }
    renderLegend(); renderPanel(); if (S.nav) ahead(); }
  T.refresh = refresh;
  const slice = (r, a, b) => { const out = []; for (let i = 0; i < r.line.length; i++) if (r.cum[i] >= a && r.cum[i] <= b) out.push(r.line[i]); if (out.length < 2) { const i = r.cum.findIndex(c => c >= a); out.splice(0, out.length, r.line[Math.max(0, i - 1)], r.line[Math.max(1, i)]); } return out; };
  function srcLine(tr) { if (!tr || !tr.sources.length) return 'No live traffic data for this route area — ETA uses normal speeds.';
    return `Live: ${tr.sources.join(' + ')} · ${ageText(Date.now() - tr.newest)} · covers ${Math.round(tr.coverage * 100)}% of route`; }
  function renderLegend() { const tr = T.cur, n = T.links.length;
    legend.innerHTML = `Traffic${LEVELS.map(l => `<i style="background:${l.color}"></i>`).join('')} · ${n ? `${n} roads` : 'no data here'}${T.feeds.nyc ? ` · NYC DOT ${ageText(Date.now() - T.feeds.nyc.t)}` : ''}${T.status.crowd ? ' · drivers live' : ''}${T.keys.tomtom ? ' · TomTom' : ''}${T.keys.here ? ' · HERE' : ''}`;
    legend.style.display = S.layers?.traffic === false ? 'none' : ''; }
  // Route options: Traffic row per alternative + second-opinion links
  function renderPanel() { const box = $('#alts'); if (!box || !S.routes?.length) return;
    box.querySelectorAll('.alt').forEach(el => { const r = S.routes[+el.dataset.i]; if (!r) return; const tr = T.routeTraffic(r, 0);
      let row = el.querySelector('.tf-row'); if (!row) { row = document.createElement('div'); row.className = 'tf-row'; el.appendChild(row); }
      const lv = level(tr.delay > 0 ? r.time / (r.time + tr.delay) : 1);
      row.innerHTML = !tr.sources.length ? '🚦 Traffic: <span class="muted">no live data for this area</span>' : `🚦 Traffic: <b style="background:${lv.color}">${tr.delay >= 60 ? '+' + Math.round(tr.delay / 60) + ' min' : 'no delay'}</b> · ETA ${new Date(Date.now() + (r.time + tr.delay) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} <span class="muted">(${tr.sources.join(', ')})</span>`; });
    let tb = $('#tfBox'); if (!tb) { tb = document.createElement('div'); tb.id = 'tfBox'; box.after(tb); }
    const d = S.dest, o = S.pos; tb.innerHTML = `<div>${esc(srcLine(T.cur))}</div>${d ? `<div class="muted small" style="margin-top:4px">Second opinion on traffic (car apps — they do NOT know truck restrictions; keep driving the RigRoute truck route):</div><div class="links"><a target="_blank" rel="noopener" href="${wazeLink(d)}">Waze</a><a target="_blank" rel="noopener" href="${gmapsLink(o, d)}">Google Maps</a><a target="_blank" rel="noopener" href="${appleLink(d)}">Apple Maps</a></div>` : ''}`; }
  new MutationObserver(() => { if ([...$('#alts').querySelectorAll('.alt')].some(e => !e.querySelector('.tf-row'))) renderPanel(); }).observe($('#alts'), { childList: true });
  // ---------- while driving: jam alerts + reroute suggestion ----------
  const warned = new Map(); let banner, lastCheck = 0, suggesting = false;
  function showBanner(html, cls, buttons = []) { banner?.remove(); banner = document.createElement('div'); banner.id = 'tfBanner'; banner.className = cls || ''; banner.innerHTML = html;
    for (const [lbl, fn, x] of buttons) { const b = document.createElement('button'); b.textContent = lbl; if (x) b.className = 'x'; b.onclick = () => { banner.remove(); fn?.(); }; banner.appendChild(b); }
    document.body.appendChild(banner); const bb = banner; setTimeout(() => bb.remove(), 20000); }
  function ahead() { const tr = T.cur, along = S.along || 0; if (!tr) return;
    const s = tr.slowdowns.find(x => x.end > along && x.start - along < 8 * MI && (x.level !== 'slow' || x.delay > 60)); T.ahead = s || null;
    if (s) { const d = s.start - along, stage = d < 800 ? 2 : 1, key = Math.round(s.start / 500); if ((warned.get(key) || 0) < stage) { warned.set(key, stage); const txt = jamText(s, along); T.lastAlert = txt; say(txt + '.', 'traffic', true);
        showBanner(`<div class="t">🚦 ${esc(txt)}<div class="d">${s.mph} mph · ${esc(tr.sources.join(' + '))} · ${ageText(Date.now() - tr.newest)}</div></div>`, s.level === 'slow' ? 'slow' : '', [['✕', null, true]]); } }
    if (Date.now() - lastCheck > 120e3 && tr.delay >= T.thresholdMin * 60 && !suggesting) { lastCheck = Date.now(); suggest(tr); } }
  async function suggest(tr) { suggesting = true; try { const from = S.pos, to = S.dest; if (!from || !to || !S.valhalla) return;
      // truck costing on every candidate: clearance/weight/hazmat/length restrictions kept. Also ask for a route that steers around the worst jam (Waze-style).
      const along = S.along || 0, worst = [...tr.slowdowns].filter(s => s.end > along).sort((a, b) => b.delay - a.delay)[0], ex = [];
      if (worst) for (let a = Math.max(worst.start, along + 300); a < Math.min(worst.end, worst.start + 3000); a += 250) { const i = S.route.cum.findIndex(c => c >= a); if (i > 0) ex.push(sq(S.route.line[i], 40)); }
      const [r1, r2] = await Promise.all([S.valhalla(from, to, 'truck', { alternates: 2, heading: from.heading }).catch(() => []), ex.length ? S.valhalla(from, to, 'truck', { heading: from.heading, exclude: ex }).then(r => [r]).catch(() => []) : []]);
      const alts = [...r1, ...r2];
      const cur = { time: S.remT != null ? S.remT - (S.trafficDelay || 0) : S.route.time, delay: tr.delay };
      const cand = alts.map(r => ({ r, time: r.time, delay: T.routeTraffic(r, 0).delay })).filter(c => Math.abs(c.r.length - (S.route.length - (S.along || 0))) > 200 || c.r.time < cur.time - 60);
      const best = rerouteDecision(cur, cand, { minDelay: T.thresholdMin * 60 }); T.suggestion = best ? { save: best.save, delay: best.delay, len: best.r.length } : { none: true, delay: tr.delay };
      if (!best) return; const min = Math.round(best.save / 60);
      say(`Traffic ahead. A faster truck-safe route saves about ${min} minutes. Tap switch to take it.`, 'traffic', true);
      showBanner(`<div class="t">⚡ Faster truck‑safe route<div class="d">saves ~${min} min · avoids ${Math.round(tr.delay / 60)} min delay · still checked for your ${S.truck.heightFt}'${S.truck.heightIn}" / ${Math.round(S.truck.weightLbs / 1000)}k lbs rig</div></div>`, '', [['Switch', () => { S.routes = [best.r]; S.sel = 0; S.chosen = best.r; S.selectRoute?.(0); say('Switched to the faster truck route.', 'info', true); refresh(); }], ['Keep', null, true]]);
    } catch (e) { T.suggestion = { error: e.message }; } finally { suggesting = false; } }
  T.suggest = suggest;
  const sq = ([lon, lat], m) => { const dy = m / 111320, dx = dy / Math.cos(lat * Math.PI / 180); return [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]]; };
  // ---------- settings: free keys ----------
  T.setKeys = (k) => { Object.assign(T.keys, k); LS.set('tomtomKey', T.keys.tomtom || ''); LS.set('hereKey', T.keys.here || ''); if (map.getLayer('ttflow')) { map.removeLayer('ttflow'); map.removeSource('ttflow'); } layers(); tick(true); };
  const me = $('#mePanel'); if (me) { const d = document.createElement('details'); d.innerHTML = `<summary>🚦 Traffic sources</summary><div class="small muted">Built in, free: NYC DOT live speeds (keyless), RigRoute drivers' anonymous speeds. Optional free developer keys add nationwide coverage (TomTom 2,500 req/day, HERE free tier). Keys stay on this phone.</div>
      <label>TomTom key <input id="tfTT" value="${esc(T.keys.tomtom)}" autocomplete="off"></label><label>HERE key <input id="tfHR" value="${esc(T.keys.here)}" autocomplete="off"></label>
      <label><input type="checkbox" id="tfShare" ${LS.get('shareSpeed', true) !== false ? 'checked' : ''}> Share my speed anonymously to help other drivers</label>
      <label>Suggest faster route when delay ≥ <input id="tfThr" type="number" min="1" max="60" value="${T.thresholdMin}" style="width:4em"> min</label><button id="tfSave">Save traffic settings</button>`; me.appendChild(d);
    d.querySelector('#tfSave').onclick = () => { T.thresholdMin = +d.querySelector('#tfThr').value || 5; LS.set('trafficRerouteMin', T.thresholdMin); LS.set('shareSpeed', d.querySelector('#tfShare').checked); T.setKeys({ tomtom: d.querySelector('#tfTT').value.trim(), here: d.querySelector('#tfHR').value.trim() }); toast('Traffic settings saved'); }; }
  // ---------- loop ----------
  let lastFeeds = 0;
  async function tick(force) { const p = S.pos || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })();
    if (force || Date.now() - lastFeeds > 120e3) { lastFeeds = Date.now(); if (!navigator.onLine) { T.status.net = 'offline'; return refresh(); }
      const b = S.route ? bboxOf(S.route.line, 0.02) : [p.lon - 0.15, p.lat - 0.12, p.lon + 0.15, p.lat + 0.12];
      const jobs = []; if (inBox(p, NYC_BOX) || (S.route && S.route.line.some(([lon, lat]) => inBox({ lat, lon }, NYC_BOX)))) jobs.push(fetchNyc());
      jobs.push(fetchHere(b), fetchTomTom(S.route, S.along || 0)); await Promise.allSettled(jobs); }
    refresh(); }
  T.tick = tick; setInterval(tick, 15000); tick(true);
  let lastRoute = null; setInterval(() => { if (S.route !== lastRoute) { lastRoute = S.route; tick(true); } }, 1500);
}

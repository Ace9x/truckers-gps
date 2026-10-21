import { haversine, bearing, decodePolyline, cumulative, snapToRoute, OffRouteDetector, currentStep, promptFor,
  fmtDist, fmtDur, truckCosting, hosStatus, H, overpassQuery, classifyPoi } from './logic.js';

const VERSION = '1.0.0';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const STYLES = { night: 'https://tiles.openfreemap.org/styles/dark', day: 'https://tiles.openfreemap.org/styles/liberty' };
const $ = s => document.querySelector(s);
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('tn_' + k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem('tn_' + k, JSON.stringify(v)) };

const DEFAULT_TRUCK = { heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, hazmat: false, avoidTolls: false, units: 'mi', theme: 'night' };
const S = {
  truck: { ...DEFAULT_TRUCK, ...LS.get('truck', {}) },
  pos: LS.get('lastPos', null), // {lon,lat,heading,speed,acc,t}
  dest: LS.get('dest', null), route: null, carRoute: null,
  nav: false, demo: null, follow: true, voice: LS.get('voice', true),
  hint: 0, spoken: {}, off: new OffRouteDetector(), rerouting: false, lastReroute: 0, rerouteCount: 0,
  step: 0, along: 0, pois: [], events: LS.get('hos', []), stoppedSince: null, warned: {},
};
window.TruckNav = S; // exposed for testing/debugging

document.body.classList.toggle('day', S.truck.theme === 'day');
$('#ver').textContent = 'v' + VERSION;

// ---------- Map ----------
const map = new maplibregl.Map({ container: 'map', style: STYLES[S.truck.theme] || STYLES.night,
  center: S.pos ? [S.pos.lon, S.pos.lat] : [-73.88, 40.81], zoom: S.pos ? 13 : 10, attributionControl: { compact: true }, pitchWithRotate: true });
map.addControl(new maplibregl.ScaleControl({ unit: S.truck.units === 'km' ? 'metric' : 'imperial' }), 'bottom-right');
const truckEl = document.createElement('div'); truckEl.className = 'truck-marker';
truckEl.innerHTML = `<svg viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="20" fill="#1e88e5" fill-opacity=".25"/><path d="M22 5 L34 36 L22 29 L10 36 Z" fill="#ffb300" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`;
const truckMarker = new maplibregl.Marker({ element: truckEl, rotationAlignment: 'map', pitchAlignment: 'map' });
const destMarker = new maplibregl.Marker({ color: '#e53935' });
let poiMarkers = [];

function addLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['car', 'route', 'done']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty });
  if (!map.getLayer('car')) map.addLayer({ id: 'car', type: 'line', source: 'car', paint: { 'line-color': '#9e9e9e', 'line-width': 4, 'line-dasharray': [2, 2] } });
  if (!map.getLayer('route-casing')) map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0d47a1', 'line-width': 12 } });
  if (!map.getLayer('route')) map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#29b6f6', 'line-width': 7 } });
  if (!map.getLayer('done')) map.addLayer({ id: 'done', type: 'line', source: 'done', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#607d8b', 'line-width': 7 } });
  drawRoute();
}
map.on('load', addLayers);
map.on('style.load', addLayers);
const line = coords => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
function drawRoute() {
  if (!map.getSource('route')) return;
  map.getSource('route').setData(S.route ? line(S.route.line) : { type: 'FeatureCollection', features: [] });
  map.getSource('car').setData(S.carRoute && $('#cmpCar').checked ? line(S.carRoute.line) : { type: 'FeatureCollection', features: [] });
  map.getSource('done').setData({ type: 'FeatureCollection', features: [] });
}
map.on('dragstart', () => setFollow(false));

// long-press to set destination
let lpTimer = null;
map.on('touchstart', e => { if (e.originalEvent.touches.length !== 1) return; lpTimer = setTimeout(() => pickPoint(e.lngLat), 650); });
['touchend', 'touchmove', 'dragstart', 'zoomstart'].forEach(ev => map.on(ev, () => clearTimeout(lpTimer)));
map.on('contextmenu', e => pickPoint(e.lngLat));
function pickPoint(ll) { setDest({ lon: ll.lng, lat: ll.lat, name: `Pin ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}` }); }

// ---------- UI helpers ----------
function toast(msg, ms = 3000) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); }
function openPanel(id) { document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== id || !p.classList.contains('hidden'))); }
function closePanels() { document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden')); }
document.querySelectorAll('#dock button').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
document.querySelectorAll('.panel .close').forEach(b => b.onclick = closePanels);
const U = () => S.truck.units;

// ---------- Voice ----------
let voiceObj = null;
function pickVoice() { const vs = speechSynthesis.getVoices(); voiceObj = vs.find(v => /en-US/i.test(v.lang) && /natural|google|samantha|aria/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || null; }
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, force) {
  S.lastSpoken = text; (S.spokenLog ||= []).push(text);
  if (!(S.voice || force) || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text); if (voiceObj) u.voice = voiceObj; u.rate = 1; u.lang = 'en-US';
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
const setMute = () => { $('#muteBtn').textContent = S.voice ? '🔊' : '🔇'; };
$('#muteBtn').onclick = () => { S.voice = !S.voice; LS.set('voice', S.voice); setMute(); if (S.voice) say('Voice guidance on', true); };
setMute();

// ---------- Follow ----------
function setFollow(v) { S.follow = v; $('#followBtn').classList.toggle('on', v); if (v && S.pos) camera(true); }
$('#followBtn').onclick = () => setFollow(!S.follow || true);
function camera(jump) {
  if (!S.pos || !S.follow) return;
  const opts = { center: [S.pos.lon, S.pos.lat] };
  if (S.nav) Object.assign(opts, { zoom: Math.max(14, 17 - (S.pos.speed || 0) / 12), pitch: 55, bearing: S.pos.heading ?? map.getBearing(), padding: { top: window.innerHeight * 0.45, bottom: 40 } });
  else Object.assign(opts, { padding: { top: 0, bottom: 0 } });
  jump ? map.jumpTo(opts) : map.easeTo({ ...opts, duration: 900, easing: t => t });
}

// ---------- GPS ----------
let watchId = null;
function startGPS() {
  if (!('geolocation' in navigator)) { toast('This browser has no GPS access'); return; }
  watchId = navigator.geolocation.watchPosition(p => {
    if (S.demo) return; // demo drive overrides
    const c = p.coords;
    onFix({ lon: c.longitude, lat: c.latitude, speed: c.speed, heading: Number.isFinite(c.heading) ? c.heading : null, acc: c.accuracy, t: p.timestamp });
  }, err => { if (err.code === 1) toast('Location permission denied — enable it in browser settings to navigate', 6000); else toast('Waiting for GPS signal…'); },
  { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}

function onFix(f) {
  const prev = S.pos;
  if (prev && (f.speed == null || !Number.isFinite(f.speed))) { const dt = (f.t - prev.t) / 1000; f.speed = dt > 0 ? haversine([prev.lon, prev.lat], [f.lon, f.lat]) / dt : 0; }
  if (f.heading == null && prev) { const d = haversine([prev.lon, prev.lat], [f.lon, f.lat]); f.heading = d > 3 ? bearing([prev.lon, prev.lat], [f.lon, f.lat]) : prev.heading; }
  S.pos = f; LS.set('lastPos', { ...f });
  truckMarker.setLngLat([f.lon, f.lat]).setRotation(f.heading || 0).addTo(map);
  const mph = (f.speed || 0) * 2.23694; $('#speed').textContent = U() === 'km' ? Math.round(mph * 1.609) : Math.round(mph);
  if (S.nav && S.route) navTick();
  hosAuto(mph);
  camera(false);
}
window.TruckNav.onFix = onFix;

// ---------- Search ----------
let qTimer;
$('#searchBtn').onclick = () => { openPanel('searchPanel'); setTimeout(() => $('#q').focus(), 50); };
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(search, 450); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(qTimer); search(); } });
export async function geocode(q) {
  const near = S.pos || { lat: 40.81, lon: -73.88 };
  try {
    const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=7&lang=en&lat=${near.lat}&lon=${near.lon}`);
    if (!r.ok) throw 0; const j = await r.json();
    return j.features.map(f => { const p = f.properties; return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      name: p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city, sub: [p.housenumber && p.name ? '' : '', p.street, p.city, p.state, p.postcode].filter(Boolean).join(', ') }; });
  } catch {
    const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`); const j = await r.json();
    return j.map(x => ({ lon: +x.lon, lat: +x.lat, name: x.name || x.display_name.split(',')[0], sub: x.display_name }));
  }
}
async function search() {
  const q = $('#q').value.trim(); const ul = $('#results'); if (q.length < 3) { ul.innerHTML = ''; return; }
  ul.innerHTML = '<li class="muted">Searching…</li>';
  try {
    const res = await geocode(q); ul.innerHTML = res.length ? '' : '<li class="muted">No results</li>';
    for (const r of res) { const li = document.createElement('li'); li.innerHTML = `${esc(r.name)}<small>${esc(r.sub)}</small>`; li.onclick = () => { closePanels(); setDest(r); }; ul.appendChild(li); }
  } catch { ul.innerHTML = '<li class="muted">Search unavailable (offline?)</li>'; }
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Routing ----------
async function valhalla(from, to, costing, heading) {
  const loc0 = { lat: from.lat, lon: from.lon }; if (heading != null) { loc0.heading = Math.round(heading); loc0.heading_tolerance = 45; }
  const body = { locations: [loc0, { lat: to.lat, lon: to.lon }], costing, units: 'kilometers', language: 'en-US', directions_options: { units: 'kilometers' } };
  if (costing === 'truck') body.costing_options = { truck: truckCosting(S.truck) };
  const r = await fetch(VALHALLA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok || !j.trip) throw new Error(j.error || 'No route found');
  const leg = j.trip.legs[0], ln = decodePolyline(leg.shape);
  return { line: ln, cum: cumulative(ln), maneuvers: leg.maneuvers, length: j.trip.summary.length * 1000, time: j.trip.summary.time, summary: j.trip.summary, costing };
}
window.TruckNav.valhalla = valhalla;

async function setDest(d) {
  S.dest = d; LS.set('dest', d); $('#destLabel').textContent = d.name;
  destMarker.setLngLat([d.lon, d.lat]).addTo(map);
  if (!S.pos) { toast('Waiting for your GPS position to plan the route…'); openPanel('routePanel'); $('#routeSummary').textContent = 'Waiting for GPS… (or use Demo drive after GPS fix)'; return; }
  await plan();
}
async function plan(isReroute = false) {
  if (!S.pos || !S.dest) return;
  if (!isReroute) { $('#routeSummary').textContent = 'Finding a truck‑safe route…'; openPanel('routePanel'); }
  try {
    const from = S.pos;
    const [tr, car] = await Promise.all([valhalla(from, S.dest, 'truck', isReroute ? from.heading : null), isReroute ? Promise.resolve(null) : valhalla(from, S.dest, 'auto').catch(() => null)]);
    S.route = tr; if (!isReroute) S.carRoute = car; S.hint = 0; S.spoken = {}; S.off.reset(); S.step = 0; S.pois = []; clearPois();
    LS.set('route', { ...tr, cum: undefined }); LS.set('carRoute', S.carRoute ? { ...S.carRoute, cum: undefined } : null);
    drawRoute(); renderRoute();
    if (!isReroute) fitRoute();
    $('#goBtn').disabled = $('#demoBtn').disabled = false;
    return tr;
  } catch (e) {
    if (!isReroute) $('#routeSummary').textContent = '⚠ ' + (navigator.onLine ? e.message : 'Offline — routing needs a connection'); else toast('Reroute failed: ' + e.message);
  }
}
window.TruckNav.plan = plan; window.TruckNav.setDest = setDest;
function fitRoute() { const b = new maplibregl.LngLatBounds(); S.route.line.forEach(c => b.extend(c)); setFollow(false); map.fitBounds(b, { padding: { top: 80, bottom: window.innerHeight * 0.5, left: 40, right: 80 }, pitch: 0, bearing: 0 }); }

function renderRoute() {
  const r = S.route, c = S.carRoute;
  let html = `<b>${fmtDist(r.length, U())}</b> · ${fmtDur(r.time)} · truck route for ${S.truck.heightFt}'${S.truck.heightIn}" / ${Math.round(S.truck.weightLbs / 1000)}k lbs${S.truck.hazmat ? ' · HAZMAT' : ''}`;
  if (r.summary.has_toll) html += ' · tolls';
  $('#routeSummary').innerHTML = html;
  let note = '';
  if (c) { const diff = r.length - c.length; note = Math.abs(diff) > 300 ? `Car route would be ${fmtDist(c.length, U())}. The truck route differs by ${fmtDist(Math.abs(diff), U())} to stay on roads legal and safe for your rig (clearances, weight limits, truck bans).` : 'Truck route matches the car route — no truck restrictions in the way.'; }
  $('#restrictNote').textContent = note;
  $('#steps').innerHTML = r.maneuvers.map((m, i) => `<li data-i="${i}">${arrow(m.type)} ${esc(m.instruction)} <span class="muted">${m.length ? fmtDist(m.length * 1000, U()) : ''}</span></li>`).join('');
}
$('#cmpCar').onchange = drawRoute;

// ---------- Navigation ----------
const ARROWS = { 1: '↑', 2: '↑', 3: '↑', 4: '🏁', 5: '🏁', 6: '🏁', 7: '↑', 8: '↑', 9: '↗', 10: '➡', 11: '↘', 12: '↩', 13: '↪', 14: '↙', 15: '⬅', 16: '↖', 17: '↑', 18: '↗', 19: '↖', 20: '↗', 21: '↖', 22: '↑', 23: '↗', 24: '↖', 25: '⤴', 26: '⟳', 27: '↗', 28: '⛴', 29: '⛴' };
const arrow = t => ARROWS[t] || '↑';
let wakeLock = null;
async function startNav() {
  if (!S.route) return;
  S.nav = true; document.body.classList.add('nav'); closePanels(); setFollow(true);
  $('#banner').classList.remove('hidden'); $('#tripBar').classList.remove('hidden');
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  const first = S.route.maneuvers[0]; say(first.verbal_pre_transition_instruction || first.instruction);
  if (S.pos) navTick();
}
function endNav(msg) {
  S.nav = false; stopDemo(); document.body.classList.remove('nav');
  $('#banner').classList.add('hidden'); $('#tripBar').classList.add('hidden'); $('#thenBox').classList.add('hidden');
  try { wakeLock?.release(); } catch {} wakeLock = null; map.easeTo({ pitch: 0, padding: { top: 0, bottom: 0 } });
  if (msg) toast(msg);
}
window.TruckNav.startNav = startNav; window.TruckNav.endNav = endNav;
$('#goBtn').onclick = () => { stopDemo(); startNav(); };
$('#endBtn').onclick = () => endNav('Navigation ended');

function navTick() {
  const r = S.route, p = [S.pos.lon, S.pos.lat];
  const sn = snapToRoute(p, r.line, r.cum, S.hint); S.hint = sn.seg; S.along = sn.along; S.distFromRoute = sn.dist;
  // off-route?
  if (S.off.update(sn.dist, S.demo ? 0 : S.pos.acc) && !S.rerouting && Date.now() - S.lastReroute > 8000) {
    S.rerouting = true; S.lastReroute = Date.now(); S.rerouteCount++; $('#bInstr').textContent = 'Rerouting…'; say('Off route. Recalculating.');
    plan(true).finally(() => { S.rerouting = false; if (S.demo && S.demo.followNewRoute) S.demo.reset(); });
    return;
  }
  const remaining = Math.max(0, r.length - sn.along);
  const idx = currentStep(r.maneuvers, sn.seg); const m = r.maneuvers[idx];
  const toM = Math.max(0, r.cum[Math.min(m.begin_shape_index, r.cum.length - 1)] - sn.along);
  if (idx !== S.step) { S.step = idx; document.querySelectorAll('#steps li').forEach(li => li.classList.toggle('cur', +li.dataset.i === idx)); }
  $('#bArrow').textContent = arrow(m.type); $('#bDist').textContent = fmtDist(toM, U()); $('#bInstr').textContent = m.street_names?.join(' / ') || m.instruction;
  const nx = r.maneuvers[idx + 1]; const tb = $('#thenBox');
  if (nx && m.length * 1000 < 400 && idx > 0) { tb.textContent = `Then ${arrow(nx.type)} ${nx.instruction}`; tb.classList.remove('hidden'); } else tb.classList.add('hidden');
  const remT = r.time * (remaining / r.length);
  $('#tEta').textContent = new Date(Date.now() + remT * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#tLeft').textContent = fmtDur(remT); $('#tDist').textContent = U() === 'km' ? (remaining / 1000).toFixed(1) : (remaining / 1609.344).toFixed(1);
  $('#tDist').nextElementSibling.textContent = U() === 'km' ? 'km' : 'miles';
  // voice
  const sp = (S.spoken[idx] ||= {}); const which = promptFor(toM, S.pos.speed || 0, sp);
  if (which === 'far' && idx > 0) { sp.far = true; say(`In ${spokenDist(toM)}, ${m.verbal_transition_alert_instruction || m.instruction}`); }
  else if (which === 'near' && idx > 0) { sp.near = true; sp.far = true; say(m.verbal_pre_transition_instruction || m.instruction); }
  // completed part
  if (map.getSource('done')) map.getSource('done').setData(line([...r.line.slice(0, sn.seg + 1), p]));
  if (remaining < 35 || (idx === r.maneuvers.length - 1 && toM < 35)) { say('You have arrived at your destination.'); S.arrived = true; endNav('Arrived 🏁'); }
}
function spokenDist(m) { if (U() === 'km') return m < 1000 ? `${Math.round(m / 50) * 50} meters` : `${(m / 1000).toFixed(1)} kilometers`; const mi = m / 1609.344; return mi < 0.2 ? `${Math.round(m * 3.28084 / 100) * 100} feet` : mi < 0.9 ? `${(Math.round(mi * 4) / 4).toString().replace('0.25', 'a quarter').replace('0.5', 'half a').replace('0.75', 'three quarters of a')} mile` : `${mi.toFixed(mi < 10 ? 1 : 0)} miles`; }

// ---------- Demo drive (simulated GPS along the planned route) ----------
function startDemo(speedMps = 25, rate = 4) {
  if (!S.route) return; stopDemo();
  const d = { dist: 0, followNewRoute: true, line: S.route.line, cum: S.route.cum };
  d.reset = () => { d.line = S.route.line; d.cum = S.route.cum; d.dist = 0; };
  d.timer = setInterval(() => {
    d.dist += speedMps * rate;
    if (d.dist >= d.cum[d.cum.length - 1]) { d.dist = d.cum[d.cum.length - 1]; }
    let i = d.cum.findIndex(c => c > d.dist); if (i < 1) i = d.cum.length - 1;
    const a = d.line[i - 1], b = d.line[i], t = (d.dist - d.cum[i - 1]) / Math.max(0.01, d.cum[i] - d.cum[i - 1]);
    onFix({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, speed: speedMps, heading: bearing(a, b), acc: 5, t: Date.now() });
    if (!S.nav) stopDemo();
  }, 1000);
  S.demo = d; if (!S.nav) startNav(); toast('Demo drive: simulated GPS along your route (4× speed)');
}
function stopDemo() { if (S.demo) { clearInterval(S.demo.timer); S.demo = null; } }
$('#demoBtn').onclick = () => startDemo();
window.TruckNav.startDemo = startDemo; window.TruckNav.stopDemo = stopDemo;

// ---------- POIs along route (OpenStreetMap / Overpass) ----------
const POI_ICON = { stop: '🚛', fuel: '⛽', rest: '🅿️', parking: '🅿️', weigh: '⚖️', other: '📍' };
const POI_NAME = { stop: 'Truck stop', fuel: 'Fuel', rest: 'Rest area', parking: 'Truck parking', weigh: 'Weigh station', other: 'Place' };
function clearPois() { poiMarkers.forEach(m => m.remove()); poiMarkers = []; $('#poiList').textContent = 'Tap ⛽ to load truck stops, rest areas and weigh stations along this route.'; }
async function loadPois() {
  if (!S.route) { toast('Plan a route first'); return; }
  openPanel('routePanel'); $('#poiList').textContent = 'Loading from OpenStreetMap…';
  const key = 'pois_' + S.route.line.length + '_' + S.route.line[0].join() + S.route.line.at(-1).join();
  let els = null; try { const c = JSON.parse(sessionStorage.getItem(key)); if (c) els = c; } catch {}
  if (!els) for (let round = 0; round < 3 && !els; round++) {
    if (round) { $('#poiList').textContent = `OpenStreetMap POI servers busy — retrying (${round}/2)…`; await new Promise(r => setTimeout(r, 4000 * round)); }
    for (const url of OVERPASS) {
      try { const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(overpassQuery(S.route.line)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(35000) });
        if (!r.ok) continue; const j = await r.json(); if (j.remark && !j.elements?.length) continue; // server-side timeout = not a real "nothing here"
        els = j.elements; sessionStorage.setItem(key, JSON.stringify(els)); break; } catch {}
    }
  }
  if (!els) { $('#poiList').textContent = 'Could not reach OpenStreetMap POI server (busy or offline). Try again in a minute.'; return; }
  const seen = new Set();
  S.pois = els.map(e => { const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat; const k = classifyPoi(e.tags);
    const sn = snapToRoute([lon, lat], S.route.line, S.route.cum, 0); return { lon, lat, kind: k, name: e.tags?.name || e.tags?.brand || POI_NAME[k], tags: e.tags || {}, along: sn.along, off: sn.dist }; })
    .filter(p => p.lon != null && !seen.has(p.name + Math.round(p.along / 500)) && seen.add(p.name + Math.round(p.along / 500)))
    .sort((a, b) => a.along - b.along);
  poiMarkers.forEach(m => m.remove());
  poiMarkers = S.pois.map(p => { const el = document.createElement('div'); el.textContent = POI_ICON[p.kind]; el.style.fontSize = '22px';
    return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<b style="color:#111">${esc(p.name)}</b><br><span style="color:#333">${POI_NAME[p.kind]} · ${fmtDist(p.along, U())} along route</span>`)).addTo(map); });
  const ahead = S.pois.filter(p => p.along >= (S.nav ? S.along : 0));
  $('#poiList').innerHTML = ahead.length ? ahead.map((p, i) => `<div class="poi" data-i="${S.pois.indexOf(p)}"><i>${POI_ICON[p.kind]}</i><div><b>${esc(p.name)}</b><br><span class="muted small">${POI_NAME[p.kind]} · in ${fmtDist(p.along - (S.nav ? S.along : 0), U())}${p.off > 300 ? ` · ${fmtDist(p.off, U())} off route` : ''}${p.tags['opening_hours'] ? ' · ' + esc(p.tags.opening_hours) : ''}</span></div></div>`).join('') : 'No mapped truck stops/rest areas within ~1 mile of this route.';
  document.querySelectorAll('.poi').forEach(el => el.onclick = () => { const p = S.pois[+el.dataset.i]; setFollow(false); closePanels(); map.flyTo({ center: [p.lon, p.lat], zoom: 15, pitch: 0 }); });
}
$('#poiBtn').onclick = loadPois;
window.TruckNav.loadPois = loadPois;

// ---------- HOS helper ----------
function hosSet(s, auto) { const last = S.events.at(-1); if (last?.s === s) return; S.events.push({ t: Date.now(), s, auto: !!auto }); S.events = S.events.filter(e => e.t > Date.now() - 8 * 24 * H); LS.set('hos', S.events); hosRender(); if (auto) toast(`Duty status → ${labelDuty(s)} (auto)`); }
const labelDuty = s => ({ off: 'Off duty', sb: 'Sleeper', on: 'On duty', drive: 'Driving' }[s]);
document.querySelectorAll('[data-duty]').forEach(b => b.onclick = () => hosSet(b.dataset.duty));
$('#hosReset').onclick = () => { if (confirm('Clear the HOS helper log on this phone?')) { S.events = []; LS.set('hos', []); hosRender(); } };
function hosAuto(mph) {
  if (!$('#autoDrive').checked || !S.nav) return;
  const cur = S.events.at(-1)?.s;
  if (mph > 5) { S.stoppedSince = null; if (cur !== 'drive') hosSet('drive', true); }
  else if (cur === 'drive') { S.stoppedSince ??= Date.now(); if (Date.now() - S.stoppedSince > 5 * 60e3) hosSet('on', true); }
}
const hm = ms => { const m = Math.max(0, Math.floor(ms / 60e3)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
function hosRender() {
  const h = hosStatus(S.events); S.hos = h;
  $('#hDrive').textContent = hm(h.driveLeft); $('#hWin').textContent = hm(h.windowLeft); $('#hBreak').textContent = hm(h.breakLeft);
  $('#dockHos').textContent = hm(Math.min(h.driveLeft, h.breakLeft + (h.status === 'drive' ? 0 : 0)));
  document.querySelectorAll('[data-duty]').forEach(b => b.classList.toggle('on', b.dataset.duty === h.status));
  $('#hosWarn').innerHTML = h.warnings.map(w => `<div class="alert ${/soon|under/i.test(w) ? 'warn' : ''}">${w}</div>`).join('');
  $('#alerts').innerHTML = h.status === 'drive' ? h.warnings.map(w => `<div class="alert ${/soon|under/i.test(w) ? 'warn' : ''}">⏱ ${w}</div>`).join('') : '';
  for (const w of h.warnings) if (!S.warned[w] && h.status === 'drive') { S.warned[w] = true; say('Hours of service: ' + w); }
  $('#hosLog').innerHTML = S.events.slice(-20).reverse().map(e => `<li>${new Date(e.t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} — ${labelDuty(e.s)}${e.auto ? ' (auto)' : ''}</li>`).join('');
}
setInterval(hosRender, 30e3); hosRender();

// ---------- Load / trip ----------
const lf = $('#loadForm');
const load = LS.get('load', {}); for (const [k, v] of Object.entries(load)) if (lf.elements[k]) lf.elements[k].value = v;
const syncCall = () => { const ph = lf.elements.dispatch.value.replace(/[^\d+]/g, ''); $('#callDispatch').href = ph ? 'tel:' + ph : '#'; };
lf.addEventListener('input', () => { LS.set('load', Object.fromEntries(new FormData(lf))); syncCall(); }); syncCall();
async function navTo(field) { const q = lf.elements[field].value.trim(); if (!q) { toast('Enter the address first'); return; }
  toast('Looking up ' + q); try { const r = await geocode(q); if (!r.length) return toast('Address not found'); closePanels(); setDest({ ...r[0], name: q }); } catch { toast('Search unavailable'); } }
$('#navPickup').onclick = () => navTo('pickup'); $('#navDelivery').onclick = () => navTo('delivery');

// ---------- Truck profile ----------
const tf = $('#truckForm');
function fillTruck() { for (const [k, v] of Object.entries(S.truck)) { const el = tf.elements[k]; if (!el) continue; el.type === 'checkbox' ? (el.checked = !!v) : (el.value = v); } }
fillTruck();
tf.addEventListener('change', () => {
  const prevTheme = S.truck.theme;
  for (const el of tf.elements) if (el.name) S.truck[el.name] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? +el.value : el.value);
  LS.set('truck', S.truck);
  if (S.truck.theme !== prevTheme) { document.body.classList.toggle('day', S.truck.theme === 'day'); map.setStyle(STYLES[S.truck.theme]); }
  if (S.dest && S.pos && !S.nav) plan();
});
const PRESETS = { 53: { heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5 }, box: { heightFt: 12, heightIn: 0, weightLbs: 26000, lengthFt: 34, widthFt: 8.5, axles: 2 }, bob: { heightFt: 13, heightIn: 0, weightLbs: 20000, lengthFt: 22, widthFt: 8.5, axles: 3 } };
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { Object.assign(S.truck, PRESETS[b.dataset.preset]); fillTruck(); tf.dispatchEvent(new Event('change')); toast('Truck profile updated'); });
window.TruckNav.setTruck = t => { Object.assign(S.truck, t); fillTruck(); LS.set('truck', S.truck); };

// ---------- Boot ----------
setFollow(true);
if (S.pos) truckMarker.setLngLat([S.pos.lon, S.pos.lat]).addTo(map);
if (S.dest) { $('#destLabel').textContent = S.dest.name; destMarker.setLngLat([S.dest.lon, S.dest.lat]).addTo(map); }
const saved = LS.get('route', null);
if (saved?.line) { S.route = { ...saved, cum: cumulative(saved.line) }; const c = LS.get('carRoute', null); if (c?.line) S.carRoute = { ...c, cum: cumulative(c.line) }; renderRoute(); $('#goBtn').disabled = $('#demoBtn').disabled = false; }
startGPS();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
window.addEventListener('offline', () => toast('Offline — current route keeps working; rerouting & search need signal', 5000));
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && S.nav && !wakeLock) try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} });
window.TruckNav.ready = true;

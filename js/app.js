import { haversine, bearing, decodePolyline, cumulative, snapToRoute, OffRouteDetector, currentStep, promptFor, fmtDist, fmtDur, truckCosting,
  hosStatus, H, encodePolyline, overpassQuery, classifyPoi, isHelperAmenity, attachAmenities, amenityLine, nextWithAmenity, sampleLine, rejoinVias, squarePolygon, pointAlong, detourMinutes, labelAlternatives, tilesForLine, etaRemaining, EtaSmoother, PuckFilter } from './logic.js';
import { Voice, PERSONALITIES } from './voice.js';
import { MyVoice, SCRIPT, COMMON, recMime } from './myvoice.js';
import { dangersAhead, detectCurves, wrongRoad } from './safety.js';
import { Mascot, TIPS } from './mascot.js';
import { VEHICLES, COLORS, vehicleSVG, unlocked, colorUnlocked } from './garage.js';
import { makeBackend, Profile, REPORT_TYPES, POINTS, BADGES, LEVELS, DrivingMonitor, reportVisible, weekKey } from './community.js';

const VERSION = '3.0.0';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const STYLES = { night: 'https://tiles.openfreemap.org/styles/dark', dim: 'https://tiles.openfreemap.org/styles/dark', day: 'https://tiles.openfreemap.org/styles/liberty' };
const MI = 1609.344;
const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('tn_' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('tn_' + k, JSON.stringify(v)); } catch {} } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const empty = { type: 'FeatureCollection', features: [] };
const line = coords => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });

const DEFAULT_TRUCK = { driverType: 'otr', cycle: 70, heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, hazmat: false, avoidTolls: false, avoidWeigh: false, units: 'mi', theme: 'night' };
const S = {
  truck: { ...DEFAULT_TRUCK, ...(LS.get('truck', null) || LS.get('truckBak', {})) }, // profile never silently resets (UX P15): backup copy kept by pro.js pos: LS.get('lastPos', null), dest: LS.get('dest', null),
  route: null, routes: [], sel: 0, chosen: null, carRoute: null, nav: false, demo: null, follow: true,
  hint: 0, spoken: {}, off: new OffRouteDetector({ threshold: 50, needed: 3, minAccuracy: 30 }), rerouting: false, lastReroute: 0, rerouteCount: 0,
  step: 0, along: 0, pois: [], events: LS.get('hos', []), stoppedSince: null, warned: {}, avoids: LS.get('avoids', []), facilities: LS.get('facilities', {}),
  gpsMode: 'high', parkedSince: null, weighAlerted: {}, tripMiles: 0, sat: false,
};
window.TruckNav = S;
const voice = new Voice(LS.get('voiceCfg', {})); voice.enabled = LS.get('voice', true); S.voiceObj = voice;
Object.defineProperty(S, 'spokenLog', { get: () => voice.log });
const say = (t, kind, force) => voice.say(t, kind, force);
const profile = new Profile(); S.profile = profile;
const mascot = new Mascot({ enabled: LS.get('mascot', false), isBusy: () => S.nav && (S.toNext ?? 1e9) < 600 }); S.mascot = mascot; let backend = null; S.reports = [];

const applyTheme = () => { document.body.classList.toggle('day', S.truck.theme === 'day'); document.body.classList.toggle('dim', S.truck.theme === 'dim'); };
applyTheme(); $('#ver').textContent = 'v' + VERSION;

// ---------- Map ----------
const map = new maplibregl.Map({ container: 'map', style: STYLES[S.truck.theme] || STYLES.night, center: S.pos ? [S.pos.lon, S.pos.lat] : [-73.88, 40.81], zoom: S.pos ? 13 : 10, attributionControl: { compact: true } });
S.map = map;
map.addControl(new maplibregl.ScaleControl({ unit: S.truck.units === 'km' ? 'metric' : 'imperial' }), 'bottom-right');
const truckEl = document.createElement('div'); truckEl.className = 'truck-marker';
S.ride = { type: 'pro', color: 'orange', ...LS.get('ride', {}) };
const drawRide = () => { truckEl.innerHTML = vehicleSVG(S.ride.type, S.ride.color, 52); };
drawRide();
const truckMarker = new maplibregl.Marker({ element: truckEl, rotationAlignment: 'map', pitchAlignment: 'map' });
const destMarker = new maplibregl.Marker({ color: '#e53935' }); const gateMarker = new maplibregl.Marker({ color: '#ffb300' });
let poiMarkers = [], rptMarkers = [], avoidMarkers = []; let updateHud = null;

function addLayers() {
  if (!map.getSource('sat')) map.addSource('sat', { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] });
  const firstSym = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  if (!map.getLayer('sat')) map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: S.sat ? 'visible' : 'none' } }, firstSym);
  for (const id of ['car', 'alts', 'route', 'done']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty });
  if (!map.getLayer('car')) map.addLayer({ id: 'car', type: 'line', source: 'car', paint: { 'line-color': '#9e9e9e', 'line-width': 4, 'line-dasharray': [2, 2] } });
  if (!map.getLayer('alts')) map.addLayer({ id: 'alts', type: 'line', source: 'alts', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#78909c', 'line-width': 7, 'line-opacity': 0.8 } });
  if (!map.getLayer('route-casing')) map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0d47a1', 'line-width': 13 } });
  if (!map.getLayer('route')) map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#29b6f6', 'line-width': 8 } });
  if (!map.getLayer('done')) map.addLayer({ id: 'done', type: 'line', source: 'done', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#607d8b', 'line-width': 8 } });
  if (!map.getSource('wz')) map.addSource('wz', { type: 'geojson', data: S.closureGeo || empty, cluster: true, clusterRadius: 45, clusterMaxZoom: 13, clusterProperties: { closed: ['max', ['case', ['get', 'closed'], 1, 0]] } }); // UX P8 / C3: clustered in the source
  if (!map.getLayer('wz')) map.addLayer({ id: 'wz', type: 'circle', source: 'wz', minzoom: 11, filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': ['case', ['get', 'closed'], 8, 5], 'circle-color': ['case', ['get', 'closed'], '#ff1744', '#ff9100'], 'circle-stroke-color': '#111', 'circle-stroke-width': 1.5 } });
  if (!map.getSource('fuelAll')) map.addSource('fuelAll', { type: 'geojson', data: S.fuelGeo || empty, cluster: true, clusterRadius: 45, clusterMaxZoom: 13 });
  if (!map.getLayer('fuelAll')) map.addLayer({ id: 'fuelAll', type: 'circle', source: 'fuelAll', minzoom: 10, filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 6, 'circle-color': ['case', ['==', ['get', 'truck'], true], '#ffb300', '#26a69a'], 'circle-stroke-color': '#111', 'circle-stroke-width': 1.5 } });
  drawRoute();
}
map.on('style.load', addLayers);
map.on('click', 'wz', e => { const p = e.features[0].properties; new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b style="color:#111">${p.closed ? '⛔ Closure' : '🚧 Work zone'}</b><br><span style="color:#333">${esc(p.desc)}<br><i>Source: official ${esc(p.src)} 511/WZDx feed</i></span>`).addTo(map); });
map.on('click', 'fuelAll', e => { const p = e.features[0].properties; new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b style="color:#111">⛽ ${esc(p.name || 'Fuel')}</b><br><span style="color:#333">${p.truck ? 'Truck lanes / truck stop' : 'Diesel'}${p.hours ? ' · ' + esc(p.hours) : ''}</span>`).addTo(map); });
async function loadOverlays() {
  try { const c = await (await fetch('data/closures.geojson', { cache: 'no-cache' })).json(); S.closureMeta = { generated: c.generated, sources: c.sources };
    S.closures = c.features.map(f => ({ coords: f.geometry.coordinates, closed: f.properties.closed, desc: f.properties.desc })); S.closureGeo = { type: 'FeatureCollection', features: c.features.flatMap(f => f.geometry.coordinates.map(co => ({ type: 'Feature', geometry: { type: 'Point', coordinates: co }, properties: f.properties }))) };
    map.getSource('wz')?.setData(S.closureGeo); } catch { S.closures = []; }
  const sp = await getStaticPois(); S.fuelGeo = { type: 'FeatureCollection', features: sp.filter(p => p.tags.amenity === 'fuel').map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { name: p.tags.name || p.tags.brand, truck: classifyPoi(p.tags) === 'stop', hours: p.tags.opening_hours } })) };
  map.getSource('fuelAll')?.setData(S.fuelGeo); S.overlaysReady = true;
}
map.on('click', 'alts', e => { const i = S.routes.findIndex((r, k) => k !== S.sel && snapToRoute([e.lngLat.lng, e.lngLat.lat], r.line, r.cum).dist < 80); if (i >= 0) selectRoute(i); });
function drawRoute() {
  if (!map.getSource('route')) return;
  map.getSource('route').setData(S.route ? line(S.route.line) : empty);
  map.getSource('alts').setData(!S.nav && S.routes.length > 1 ? { type: 'FeatureCollection', features: S.routes.filter((_, i) => i !== S.sel).map(r => line(r.line)) } : empty);
  map.getSource('car').setData(S.carRoute && $('#cmpCar').checked ? line(S.carRoute.line) : empty);
  map.getSource('done').setData(empty);
}
function setSat(v) { S.sat = v; if (map.getLayer('sat')) map.setLayoutProperty('sat', 'visibility', v ? 'visible' : 'none'); $('#satBtn').classList.toggle('on', v); $('#facSat').checked = v; }
$('#satBtn').onclick = () => setSat(!S.sat); $('#facSat').onchange = e => setSat(e.target.checked);
map.on('dragstart', () => setFollow(false));
let lpTimer = null;
map.on('touchstart', e => { if (e.originalEvent.touches.length !== 1) return; lpTimer = setTimeout(() => pickPoint(e.lngLat), 650); });
['touchend', 'touchmove', 'dragstart', 'zoomstart'].forEach(ev => map.on(ev, () => clearTimeout(lpTimer)));
map.on('contextmenu', e => pickPoint(e.lngLat));
function pickPoint(ll) { setDest({ lon: ll.lng, lat: ll.lat, name: `Pin ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}` }); }

// ---------- UI helpers ----------
function toast(msg, ms = 3000) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); }
function openPanel(id) { $$('.panel').forEach(p => p.classList.toggle('hidden', p.id !== id || !p.classList.contains('hidden'))); $('#crosshair').classList.toggle('hidden', id !== 'facPanel' || $('#facPanel').classList.contains('hidden')); if (id === 'mePanel') renderMe(); if (id === 'reportPanel') renderReportPanel(); }
function closePanels() { $$('.panel').forEach(p => p.classList.add('hidden')); $('#crosshair').classList.add('hidden'); }
$$('#dock button').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
$$('.panel .close').forEach(b => b.onclick = closePanels);
const U = () => S.truck.units;
const setMute = () => { $('#muteBtn').textContent = voice.enabled ? '🔊' : '🔇'; };
$('#muteBtn').onclick = () => { voice.enabled = !voice.enabled; LS.set('voice', voice.enabled); setMute(); if (voice.enabled) say('Voice guidance on', 'info', true); }; setMute();

// ---------- Follow / camera ----------
function setFollow(v) { S.follow = v; $('#followBtn').classList.toggle('on', v); if (v && S.pos) camera(true); }
$('#followBtn').onclick = () => setFollow(true);
function camera(jump) {
  if (!S.pos || !S.follow) return;
  const o = { center: [S.pos.lon, S.pos.lat] };
  if (S.nav) Object.assign(o, { zoom: Math.max(14, 17 - (S.pos.speed || 0) / 12), pitch: 55, bearing: S.pos.heading ?? map.getBearing(), padding: { top: window.innerHeight * 0.45, bottom: 40 } });
  else Object.assign(o, { padding: { top: 0, bottom: 0 } });
  jump ? map.jumpTo(o) : map.easeTo({ ...o, duration: 900, easing: t => t });
}

// ---------- GPS (high accuracy while moving, low-power when parked) ----------
let watchId = null;
function startGPS(mode = 'high') {
  if (!('geolocation' in navigator)) { toast('This browser has no GPS access'); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  S.gpsMode = mode;
  const opts = mode === 'high' ? { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 } : { enableHighAccuracy: false, maximumAge: 60000, timeout: 120000 };
  watchId = navigator.geolocation.watchPosition(p => { if (S.demo) return; const c = p.coords;
    onFix({ lon: c.longitude, lat: c.latitude, speed: c.speed, heading: Number.isFinite(c.heading) ? c.heading : null, acc: c.accuracy, t: p.timestamp }); },
  err => { if (err.code === 1) toast('Location permission denied — enable it in browser settings to navigate', 6000); else if (mode === 'high') toast('Waiting for GPS signal…'); }, opts);
}
function powerManage(f) {
  const spd = f.speed || 0;
  if (spd < 1) { S.parkedSince ??= f.t; if (S.gpsMode === 'high' && f.t - S.parkedSince > 3 * 60e3 && !S.demo) { startGPS('low'); toast('Parked — GPS in battery saver'); } }
  else if (spd > 3) { S.parkedSince = null; if (S.gpsMode === 'low') startGPS('high'); }
}
S.powerManage = powerManage;

const monitor = new DrivingMonitor(); S.monitor = monitor;
// Puck: accuracy-gated filter, snapped to the route while on it, animated between ~1 Hz fixes (UX P6/C6).
const puckFilter = new PuckFilter(); const etaSmooth = new EtaSmoother(); S.etaSmooth = etaSmooth;
let puckAnim = null;
function movePuck(lon, lat, heading) { if (!truckMarker._map) { truckMarker.setLngLat([lon, lat]).setRotation(heading).addTo(map); return; }
  const from = truckMarker.getLngLat(), r0 = truckMarker.getRotation(), dr = ((heading - r0) % 360 + 540) % 360 - 180, t0 = performance.now(), D = S.demo ? 950 : 800;
  if (Math.abs(from.lng - lon) + Math.abs(from.lat - lat) > 0.02 || document.hidden) { truckMarker.setLngLat([lon, lat]).setRotation(heading); return; }
  cancelAnimationFrame(puckAnim); const step = now => { const k = Math.min(1, (now - t0) / D), e = k * (2 - k);
    truckMarker.setLngLat([from.lng + (lon - from.lng) * e, from.lat + (lat - from.lat) * e]).setRotation(r0 + dr * e); if (k < 1) puckAnim = requestAnimationFrame(step); };
  puckAnim = requestAnimationFrame(step); }
S.movePuck = movePuck;
function onFix(f) {
  const prev = S.pos;
  if (prev && (f.speed == null || !Number.isFinite(f.speed))) { const dt = (f.t - prev.t) / 1000; f.speed = dt > 0 ? haversine([prev.lon, prev.lat], [f.lon, f.lat]) / dt : 0; }
  if (f.heading == null && prev) { const d = haversine([prev.lon, prev.lat], [f.lon, f.lat]); f.heading = d > 3 ? bearing([prev.lon, prev.lat], [f.lon, f.lat]) : prev.heading; }
  if (S.nav && prev && (f.acc || 0) <= 30) { const d = haversine([prev.lon, prev.lat], [f.lon, f.lat]); if (d < 500) S.tripMiles += d / MI; }
  S.pos = f; LS.set('lastPos', { ...f });
  { const q = puckFilter.update(f); movePuck(q.lon, q.lat, q.heading ?? f.heading ?? 0); } // filtered + animated; snapped to route in navTick
  const mph = (f.speed || 0) * 2.23694; $('#speed').textContent = U() === 'km' ? Math.round(mph * 1.609) : Math.round(mph);
  if (S.nav) monitor.update(f, null);
  if (S.nav && S.route) navTick();
  try { S.onFixHook?.(f, mph); } catch (e) { console.warn(e); }
  hosAuto(mph); powerManage(f); camera(false); updateHud?.();
}
S.onFix = onFix;

// ---------- Search ----------
let qTimer;
$('#searchBtn').onclick = () => { if (S.lockedOut?.()) return; openPanel('searchPanel'); setTimeout(() => $('#q').focus(), 50); };
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(search, 450); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(qTimer); search(); } });
async function geocode(q) {
  const near = S.pos || { lat: 40.81, lon: -73.88 };
  try { const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=7&lang=en&lat=${near.lat}&lon=${near.lon}`); if (!r.ok) throw 0; const j = await r.json();
    return j.features.map(f => { const p = f.properties; return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city, sub: [p.street, p.city, p.state, p.postcode].filter(Boolean).join(', ') }; });
  } catch { const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`); const j = await r.json(); return j.map(x => ({ lon: +x.lon, lat: +x.lat, name: x.name || x.display_name.split(',')[0], sub: x.display_name })); }
}
async function search() {
  const q = $('#q').value.trim(), ul = $('#results'); if (q.length < 3) { ul.innerHTML = ''; return; }
  ul.innerHTML = '<li class="muted">Searching…</li>';
  try { const res = await geocode(q); ul.innerHTML = res.length ? '' : '<li class="muted">No results</li>';
    for (const r of res) { const li = document.createElement('li'); li.innerHTML = `${esc(r.name)}<small>${esc(r.sub)}</small>`; li.onclick = () => { closePanels(); setDest(r); }; ul.appendChild(li); }
  } catch { ul.innerHTML = '<li class="muted">Search unavailable (offline?)</li>'; }
}

// ---------- Routing ----------
const facKey = d => d ? `${d.lat.toFixed(4)},${d.lon.toFixed(4)}` : '';
const destTarget = () => { const f = S.facilities[facKey(S.dest)]; return f?.gate ? { lat: f.gate[1], lon: f.gate[0] } : S.dest; };
function excludePolys(from, to) {
  const polys = S.avoids.map(a => squarePolygon(a.lon, a.lat, 25));
  for (const z of S.closures || []) if (z.closed) for (const c of z.coords) polys.push(squarePolygon(c[0], c[1], 30));
  if (S.truck.avoidWeigh && staticPois && from && to) { const bb = bboxOf([[from.lon, from.lat], [to.lon, to.lat]], 0.4);
    for (const p of staticPois) if (classifyPoi(p.tags) === 'weigh' && p.lon >= bb[0] && p.lon <= bb[2] && p.lat >= bb[1] && p.lat <= bb[3]) polys.push(squarePolygon(p.lon, p.lat, 15)); }
  return polys;
}
function mergeLegs(trip, costing) {
  const ln = [], man = [];
  for (const leg of trip.legs) { const pts = decodePolyline(leg.shape); const off = ln.length ? ln.length - 1 : 0;
    const ms = leg.maneuvers.map(m => ({ ...m, begin_shape_index: m.begin_shape_index + off, end_shape_index: m.end_shape_index + off }));
    if (ln.length) { pts.shift(); if (man.length && [4, 5, 6].includes(man.at(-1).type)) man.pop(); if ([1, 2, 3].includes(ms[0]?.type) && man.length) ms.shift(); }
    ln.push(...pts); man.push(...ms); }
  return { line: ln, cum: cumulative(ln), maneuvers: man, length: trip.summary.length * 1000, time: trip.summary.time, summary: trip.summary, costing };
}
async function valhalla(from, to, costing, { heading = null, vias = [], alternates = 0, avoid = true, radius = 0, stops = S.stops || [], exclude = [] } = {}) {
  const loc0 = { lat: from.lat, lon: from.lon }; if (radius) { loc0.radius = radius; loc0.minimum_reachability = 500; } if (heading != null) { loc0.heading = Math.round(heading); loc0.heading_tolerance = 45; }
  const body = { locations: [loc0, ...vias.map(([lon, lat]) => ({ lat, lon, type: 'through' })), ...stops.map(s => ({ lat: s.lat, lon: s.lon, type: 'break' })), { lat: to.lat, lon: to.lon }], costing, units: 'kilometers', language: 'en-US', directions_options: { units: 'kilometers' } };
  if (costing === 'truck') body.costing_options = { truck: truckCosting(S.truck) };
  { const ex = [...(avoid ? excludePolys(from, to) : []), ...exclude]; if (ex.length) body.exclude_polygons = ex; } // exclude: e.g. a live traffic jam
  if (alternates && !stops.length) body.alternates = alternates;
  const r = await fetch(VALHALLA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); if (!r.ok || !j.trip) throw new Error(j.error || 'No route found');
  const main = mergeLegs(j.trip, costing);
  if (alternates) return [main, ...(j.alternates || []).map(a => mergeLegs(a.trip, costing))];
  return main;
}
S.valhalla = valhalla;

async function setDest(d) {
  S.dest = d; LS.set('dest', d); $('#destLabel').textContent = d.name; destMarker.setLngLat([d.lon, d.lat]).addTo(map); showGate();
  if (!S.pos) { toast('Waiting for your GPS position to plan the route…'); openPanel('routePanel'); $('#routeSummary').textContent = 'Waiting for GPS…'; return; }
  await plan();
}
async function plan(isReroute = false) {
  if (!S.pos || !S.dest) return;
  if (isReroute && !navigator.onLine) { S.pendingReroute = true; return; } // offline: keep current route, reroute queued until signal returns
  if (!isReroute) { $('#routeSummary').textContent = 'Finding truck‑safe routes…'; if ($('#routePanel').classList.contains('hidden')) openPanel('routePanel'); }
  try {
    const from = S.pos, to = destTarget();
    if (isReroute) {
      // Respect the driver's chosen route: rejoin it ahead via "through" points instead of silently switching routes.
      let vias = [];
      if (S.chosen) { const sn = snapToRoute([from.lon, from.lat], S.chosen.line, S.chosen.cum, 0); if (sn.dist < 3000) vias = rejoinVias(S.chosen.line, S.chosen.cum, sn.along, { ahead: 1500, max: 2 }); }
      let tr; const tries = [{ heading: from.heading, vias }, { vias }, { heading: from.heading, vias, radius: 300 }, { radius: 300 }]; let err; // radius: escape driveways/lots
      for (const o of tries) { try { tr = await valhalla(from, to, 'truck', o); vias = o.vias || []; break; } catch (e) { err = e; } }
      if (!tr) throw err;
      S.lastRerouteVias = vias.length; setRoute(tr); return tr;
    }
    const [alts, car] = await Promise.all([valhalla(from, to, 'truck', { alternates: 2 }), valhalla(from, to, 'auto', { avoid: false }).catch(() => null)]);
    S.routes = alts; S.carRoute = car; S.sel = 0; setRoute(alts[0]); S.chosen = alts[0];
    LS.set('routes', alts.map(r => ({ ...r, cum: undefined }))); LS.set('carRoute', car ? { ...car, cum: undefined } : null); LS.set('sel', 0);
    renderRoute(); fitRoute(); ['#goBtn', '#demoBtn', '#facBtn', '#offlineBtn'].forEach(s => $(s).disabled = false);
    return alts[0];
  } catch (e) { if (!isReroute) $('#routeSummary').textContent = '⚠ ' + (navigator.onLine ? e.message : 'Offline — routing needs a connection'); else toast('Reroute failed: ' + e.message); }
}
function setRoute(r) { S.route = r; S.etaSmooth?.reset(); S.hint = 0; S.spoken = {}; S.off.reset(); S.step = 0; S.dangers = []; S.dangerSpoken = {}; LS.set('route', { ...r, cum: undefined }); drawRoute(); renderSteps(); analyzeRoute(r); }
function selectRoute(i) { S.sel = i; S.chosen = S.routes[i]; LS.set('sel', i); setRoute(S.routes[i]); renderRoute(); S.pois = []; S.poiDone = false; clearPois(); }
S.plan = plan; S.setDest = setDest; S.selectRoute = selectRoute;
function fitRoute() { const b = new maplibregl.LngLatBounds(); S.routes.forEach(r => r.line.forEach(c => b.extend(c))); setFollow(false); map.fitBounds(b, { padding: { top: 80, bottom: window.innerHeight * 0.5, left: 40, right: 80 }, pitch: 0, bearing: 0 }); }

function renderRoute() {
  const r = S.route, c = S.carRoute;
  $('#routeSummary').innerHTML = `Truck routes for ${S.truck.heightFt}'${S.truck.heightIn}" · ${Math.round(S.truck.weightLbs / 1000)}k lbs · ${S.truck.lengthFt}'${S.truck.hazmat ? ' · HAZMAT' : ''}${S.avoids.length ? ` · avoiding ${S.avoids.length} reported road(s)` : ''}`;
  const labels = labelAlternatives(S.routes, c);
  $('#alts').innerHTML = S.routes.map((x, i) => `<div class="alt ${i === S.sel ? 'sel' : ''}" data-i="${i}"><b>${i === S.sel ? '✔ ' : ''}Route ${i + 1}: ${fmtDur(x.time)} · ${fmtDist(x.length, U())}</b><div>via ${esc(viaNames(x))}</div><div class="why">${labels[i].map(esc).join(' · ')}</div></div>`).join('')
    + (S.routes.length < 3 ? `<div class="muted small">${S.routes.length === 1 ? 'Only one truck‑legal route found for this trip.' : 'Only ' + S.routes.length + ' truck‑legal options found.'}</div>` : '');
  $$('.alt').forEach(el => el.onclick = () => selectRoute(+el.dataset.i));
  $('#restrictNote').textContent = c ? (Math.abs(r.length - c.length) > 300 ? `Car route: ${fmtDist(c.length, U())}. Truck route differs to stay on roads mapped as legal for your rig (clearance, weight, length, truck bans). Check “Show car route” to see where.` : 'Truck route matches the car route — no truck restrictions in the way.') : '';
  renderSteps();
}
function viaNames(r) { const n = []; for (const m of r.maneuvers) for (const s of m.street_names || []) if (/^(I|US|NJ|NY|PA|CT)\b|Turnpike|Parkway|Expressway|Highway/.test(s) && !n.includes(s)) n.push(s); return n.slice(0, 3).join(', ') || (r.maneuvers[1]?.street_names?.[0] ?? 'local roads'); }
function renderSteps() { if (!S.route) return; $('#steps').innerHTML = S.route.maneuvers.map((m, i) => `<li data-i="${i}">${arrow(m.type)} ${esc(m.instruction)} <span class="muted">${m.length ? fmtDist(m.length * 1000, U()) : ''}</span></li>`).join(''); }
$('#cmpCar').onchange = drawRoute;

// ---------- Look-ahead dangers (Valhalla trace_attributes + OSM restriction tags + geometry) ----------
let restrictTags = null;
async function getRestrictions() { if (restrictTags) return restrictTags; try { restrictTags = await (await fetch('data/restrictions-northeast.json')).json(); } catch { restrictTags = {}; } return restrictTags; }
const truckMetric = () => { const c = truckCosting(S.truck); return { heightM: c.height, weightT: c.weight, lengthM: c.length, hazmat: !!S.truck.hazmat }; };
async function analyzeRoute(r) {
  const curves = detectCurves(r.line, r.cum, r.maneuvers.map(m => m.begin_shape_index));
  let edges = [];
  try { const shape = sampleLine(r.line, Math.min(r.line.length, 4000));
    const res = await fetch(VALHALLA.replace('/route', '/trace_attributes'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ encoded_polyline: encodePolyline(shape), costing: 'truck', costing_options: { truck: truckCosting(S.truck) }, shape_match: 'map_snap', filters: { attributes: ['edge.way_id', 'edge.max_upward_grade', 'edge.max_downward_grade', 'edge.tunnel', 'edge.length', 'edge.names', 'edge.begin_shape_index', 'edge.road_class', 'edge.speed_limit', 'edge.toll', 'node.admin_index', 'admin.state_code', 'admin.country_code'], action: 'include' } }) });
    const j = await res.json(); const sc = cumulative(shape);
    edges = (j.edges || []).map(e => { const p = shape[Math.min(e.begin_shape_index ?? 0, shape.length - 1)]; return { ...e, length: (e.length || 0) * 1000, along: snapToRoute(p, r.line, r.cum, 0).along }; });
    S.routeEdges = edges.length; S.admins = j.admins || [];
  } catch (e) { S.routeEdges = 0; }
  const tags = { ...(await getRestrictions()) };
  const inNE = r.line.every(([x, y]) => y >= 38.4 && y <= 45.1 && x >= -80.6 && x <= -66.9);
  if (!inNE && edges.length) { // outside the built-in extract: ask OpenStreetMap live for restriction tags of exactly these roads
    const ids = [...new Set(edges.map(e => e.way_id))].slice(0, 600);
    for (const url of OVERPASS) { try { const q = `[out:json][timeout:25];way(id:${ids.join(',')})[~"^(maxheight|maxweight|maxlength|hazmat|hgv|incline)$"~"."];out tags;`;
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue; const j = await res.json(); for (const w of j.elements || []) tags[w.id] = w.tags; S.liveRestrictions = (j.elements || []).length; break; } catch {} }
  }
  if (S.route !== r) return;
  S.edges = edges; try { S.onRouteAnalyzed?.(r); } catch (e) { console.warn(e); }
  S.dangers = [...dangersAhead(edges, tags, truckMetric()), ...curves].sort((a, b) => a.along - b.along);
  renderDangers();
}
S.analyzeRoute = analyzeRoute;
const DICON = { height: '⛔', weight: '⚖️', length: '📏', hazmat: '☣️', notrucks: '🚫', tunnel: '🚇', grade: '⛰️', curve: '↪️' };
function renderDangers() { const d = S.dangers || [], base = S.nav ? S.along : 0;
  $('#dangerList').innerHTML = d.length ? d.filter(x => x.along >= base).slice(0, 25).map(x => `<li class="${x.sev}">${DICON[x.kind] || '⚠'} ${esc(x.short)} · in ${fmtDist(x.along - base, U())}</li>`).join('') : `<li>No mapped clearance/weight/grade dangers found on this route${S.routeEdges ? '' : ' (road data server busy — curves only)'}.</li>`; }
function dangerAlerts() {
  for (const d of S.dangers || []) { const ahead = d.along - S.along; if (ahead < 0 || ahead > 2.1 * MI) continue; if (d.kind === 'curve' && (S.pos.speed || 0) < 13) continue;
    const a = (S.dangerSpoken[d.kind + d.along] ||= {});
    const tier = ahead <= 0.5 * MI ? 'half' : ahead <= 2 * MI ? 'two' : null; if (!tier || a[tier] || (d.sev === 'info' && tier === 'two')) continue;
    a[tier] = true; if (tier === 'half') a.two = true;
    const where = tier === 'half' ? (ahead < 300 ? 'just ahead' : 'in half a mile') : 'in two miles';
    say(d.text.replace(' ahead', ' ' + where), 'danger'); alertBanner(`${DICON[d.kind] || '⚠'} ${d.short} · ${fmtDist(ahead, U())}`);
    if (d.sev === 'stop' && !S.rerouting && Date.now() - S.lastReroute > 15000) { S.avoids.push({ lat: pointAlong(S.route.line, S.route.cum, d.along)[1], lon: pointAlong(S.route.line, S.route.cum, d.along)[0], type: d.kind === 'weight' ? 'weight' : d.kind === 'notrucks' ? 'notrucks' : 'clearance', t: Date.now(), auto: true });
      LS.set('avoids', S.avoids); S.rerouting = true; S.lastReroute = Date.now(); S.rerouteCount++; plan(true).finally(() => S.rerouting = false); }
  }
}
// Wrong-road check: ask Valhalla what road we're on (truck access, class)
let wrTimer = 0;
async function checkWrongRoad() {
  if (!S.nav || !S.pos || !navigator.onLine || Date.now() - wrTimer < 10000 || (S.pos.speed || 0) < 2) return; wrTimer = Date.now(); S.wrChecks = (S.wrChecks || 0) + 1;
  try { const r = await fetch(VALHALLA.replace('/route', '/locate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ locations: [{ lat: S.pos.lat, lon: S.pos.lon, heading: S.pos.heading != null ? Math.round(S.pos.heading) : undefined, radius: 15 }], costing: 'auto', verbose: true }) }); // auto: so roads closed to trucks are still found
    const j = await r.json(); const e = j[0]?.edges?.[0]; S.lastLocate = e?.edge_info?.names; showWrongRoad(wrongRoad(e, { offRoute: (S.distFromRoute || 0) > 40, nearDest: S.route && S.route.length - S.along < 800 }));
  } catch {}
}
function showWrongRoad(w) { const el = $('#wrongRoad'); S.wrongRoad = w;
  if (!w) { el.classList.add('hidden'); return; } el.textContent = w.short + (S.lastLocate?.length ? ` (${S.lastLocate.filter(n => n.length > 3)[0] || S.lastLocate[0]})` : ''); el.classList.remove('hidden');
  if (S.lastWrong !== w.short) { S.lastWrong = w.short; say(w.text, 'danger'); mascot.say(w.sev === 'stop' ? 'Yikes! Trucks are not allowed on this road. Find a safe place to turn.' : 'Hmm, this looks like a side street. Let me get you back to the truck route.', 'worried', 8000); }
  clearTimeout(showWrongRoad._t); showWrongRoad._t = setTimeout(() => { el.classList.add('hidden'); S.lastWrong = null; }, 15000); }
S.checkWrongRoad = checkWrongRoad; S.showWrongRoad = showWrongRoad; S.wrongRoadFn = wrongRoad;

// ---------- Navigation ----------
const ARROWS = { 1: '↑', 2: '↑', 3: '↑', 4: '🏁', 5: '🏁', 6: '🏁', 7: '↑', 8: '↑', 9: '↗', 10: '➡', 11: '↘', 12: '↩', 13: '↪', 14: '↙', 15: '⬅', 16: '↖', 17: '↑', 18: '↗', 19: '↖', 20: '↗', 21: '↖', 22: '↑', 23: '↗', 24: '↖', 25: '⤴', 26: '⟳', 27: '↗', 28: '⛴', 29: '⛴' };
const arrow = t => ARROWS[t] || '↑';
let wakeLock = null;
async function startNav(resumed) {
  if (!S.route) return;
  S.nav = true; S.arrived = false; S.tripStart = S.tripStart && resumed ? S.tripStart : Date.now(); if (!resumed) { S.tripMiles = 0; monitor.hardBrakes = 0; monitor.events = 0; }
  document.body.classList.add('nav'); closePanels(); setFollow(true); drawRoute();
  $('#banner').classList.remove('hidden'); $('#tripBar').classList.remove('hidden');
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  LS.set('navActive', { t: Date.now(), sel: S.sel });
  const first = S.route.maneuvers[0]; if (!resumed) { if (!S.introDone) { S.introDone = true; say('RigRoute GPS. Truck route ready.', 'info'); } say(first.verbal_pre_transition_instruction || first.instruction, 'turn'); } else say('Navigation resumed', 'info');
  if (!S.pois.length) loadPois(true);
  prefetchTiles(true);
  if (S.pos) navTick();
}
function endNav(msg) {
  if (S.nav) finishTrip();
  S.nav = false; stopDemo(); document.body.classList.remove('nav'); localStorage.removeItem('tn_navActive');
  $('#banner').classList.add('hidden'); $('#tripBar').classList.add('hidden'); $('#thenBox').classList.add('hidden'); $('#lastMile').classList.add('hidden');
  try { wakeLock?.release(); } catch {} wakeLock = null; map.easeTo({ pitch: 0, padding: { top: 0, bottom: 0 } }); drawRoute();
  if (msg) toast(msg);
}
S.startNav = startNav; S.endNav = endNav;
$('#goBtn').onclick = () => { stopDemo(); startNav(); };
$('#endBtn').onclick = () => endNav('Navigation ended');

function navTick() {
  const r = S.route, p = [S.pos.lon, S.pos.lat];
  const sn = snapToRoute(p, r.line, r.cum, S.hint); S.distFromRoute = sn.dist;
  const si = Math.min(sn.seg, r.line.length - 2), segB = si >= 0 ? bearing(r.line[si], r.line[si + 1]) : null;
  const offNow = S.off.update(sn.dist, S.demo ? 0 : S.pos.acc, { speed: S.pos.speed, heading: S.pos.heading, segBearing: segB });
  if (offNow && !navigator.onLine && S.offlineOffRoute) { S.offlineOffRoute(sn); return; } // no signal: guide back to the line, reroute queued until online
  if (offNow && !S.rerouting && Date.now() - S.lastReroute > 8000) {
    S.rerouting = true; S.lastReroute = Date.now(); S.rerouteCount++; $('#bInstr').textContent = 'Rerouting…'; say('Off route. Recalculating.', 'reroute'); mascot.say("Whoops! New route coming up — I've got you.", 'worried');
    plan(true).finally(() => { S.rerouting = false; if (S.demo) S.demo.reset(); });
    return;
  }
  if (S.off.isOff()) { checkWrongRoad(); return; } // Ferrostar: don't advance steps while (possibly) off route
  if (sn.pt && sn.dist < 30) movePuck(sn.pt[0], sn.pt[1], segB ?? S.pos.heading ?? 0); // show the snapped point while on route
  S.hint = sn.seg; S.along = sn.along; LS.set('navActive', { t: Date.now(), sel: S.sel });
  const remaining = Math.max(0, r.length - sn.along);
  const idx = currentStep(r.maneuvers, sn.seg), m = r.maneuvers[idx];
  const toM = Math.max(0, r.cum[Math.min(m.begin_shape_index, r.cum.length - 1)] - sn.along); S.toNext = idx > 0 ? toM : 1e9; mascot.watchBusy();
  if (idx !== S.step) { S.step = idx; $$('#steps li').forEach(li => li.classList.toggle('cur', +li.dataset.i === idx)); }
  $('#bArrow').textContent = arrow(m.type); $('#bDist').textContent = fmtDist(toM, U()); $('#bInstr').textContent = m.street_names?.join(' / ') || m.instruction;
  const nx = r.maneuvers[idx + 1], tb = $('#thenBox');
  if (nx && m.length * 1000 < 400 && idx > 0) { tb.textContent = `Then ${arrow(nx.type)} ${nx.instruction}`; tb.classList.remove('hidden'); } else tb.classList.add('hidden');
  const sm = etaSmooth.update(etaRemaining(r, idx, toM) + (S.trafficDelay || 0)), remT = sm.remSec; S.remT = remT; // remaining-leg times + traffic, smoothed (UX P6/C7)
  $('#tEta').textContent = new Date(sm.arrival).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#tLeft').textContent = fmtDur(remT); $('#tDist').textContent = U() === 'km' ? (remaining / 1000).toFixed(1) : (remaining / MI).toFixed(1);
  $('#tDist').nextElementSibling.textContent = U() === 'km' ? 'km' : 'miles';
  const sp = (S.spoken[idx] ||= {}), which = promptFor(toM, S.pos.speed || 0, sp, m.type);
  if (which && idx > 0) {
    if (which === 'near') { sp.near = true; say(m.verbal_pre_transition_instruction || m.instruction, 'turn'); }
    else { const d = { '2mi': 'two miles', '1mi': 'one mile', qmi: 'a quarter mile' }[which] || spokenDist(toM); say(`In ${d}, ${m.verbal_transition_alert_instruction || m.instruction}`, 'turn'); }
  }
  weighAlerts(); dangerAlerts(); checkWrongRoad(); lastMile(remaining);
  if (map.getSource('done')) map.getSource('done').setData(line([...r.line.slice(0, sn.seg + 1), p]));
  if (remaining < 35 || (idx === r.maneuvers.length - 1 && toM < 35)) { say('You have arrived at your destination.', 'arrive'); S.arrived = true; mascot.say('You made it! 🏁 Nice driving.', 'party'); endNav('Arrived 🏁'); }
}
function spokenDist(m) { if (U() === 'km') return m < 1000 ? `${Math.round(m / 50) * 50} meters` : `${(m / 1000).toFixed(1)} kilometers`; const mi = m / MI; return mi < 0.2 ? `${Math.round(m * 3.28084 / 100) * 100} feet` : `${mi.toFixed(1)} miles`; }

// Weigh station alerts 2 mi / 1 mi (stations on or right next to the route)
function weighAlerts() {
  for (const p of S.pois) { if (p.kind !== 'weigh' || p.off > 250) continue; const ahead = p.along - S.along; if (ahead < 0) continue;
    const a = (S.weighAlerted[p.id] ||= {}); const rpt = S.reports.find(r => /^weigh_/.test(r.type) && haversine([r.lon, r.lat], [p.lon, p.lat]) < 400 && reportVisible(r));
    const status = rpt ? (rpt.type === 'weigh_open' ? ' Reported open.' : ' Reported closed.') : '';
    for (const [k, d, txt] of [['2', 2 * MI, 'two miles'], ['1', MI, 'one mile']]) if (ahead <= d && ahead > d - 0.6 * MI && !a[k]) { a[k] = true; a['2'] = true;
      mascot.say(`Weigh station in ${k} mile${k === '1' ? '' : 's'}! Have your paperwork handy.`, 'wow'); say(`Weigh station in ${txt}. ${p.name !== 'Weigh station' ? p.name + '.' : ''}${status}`, 'weigh'); alertBanner(`⚖️ Weigh station in ${k} mi${status}`); } }
}
function alertBanner(txt) { const el = document.createElement('div'); el.className = 'alert warn'; el.textContent = txt; $('#alerts').appendChild(el); setTimeout(() => el.remove(), 12000); }

// ---------- Last-mile facility mode ----------
function lastMile(remaining) {
  const on = remaining < 3 * MI; $('#lastMile').classList.toggle('hidden', !on); if (!on) return;
  const f = S.facilities[facKey(S.dest)] || {};
  $('#lmNote').textContent = f.notes ? f.notes.slice(0, 90) : (f.gate ? 'Routing to saved truck entrance.' : 'No notes yet — check the yard on satellite.');
  if (!S.lmSpoken) { S.lmSpoken = true; say(f.notes ? `Facility notes: ${f.notes.slice(0, 140)}` : 'Approaching destination. Tap Facility to check the yard on satellite.', 'info'); }
}
$('#lmOpen').onclick = () => openFac(); $('#facBtn').onclick = () => openFac();
function openFac() { if (!S.dest) return; const f = S.facilities[facKey(S.dest)] || {}; $('#facName').textContent = S.dest.name; $('#facNotes').value = f.notes || '';
  $('#facPinInfo').textContent = f.gate ? `Truck entrance saved at ${f.gate[1].toFixed(5)}, ${f.gate[0].toFixed(5)}` : 'No truck entrance pinned.'; openPanel('facPanel'); $('#crosshair').classList.remove('hidden');
  setFollow(false); map.flyTo({ center: f.gate || [S.dest.lon, S.dest.lat], zoom: 17, pitch: 0, bearing: 0 }); setSat(true); }
function saveFac(patch) { const k = facKey(S.dest); S.facilities[k] = { ...(S.facilities[k] || {}), name: S.dest.name, ...patch }; LS.set('facilities', S.facilities); showGate(); }
$('#facNotes').addEventListener('input', e => saveFac({ notes: e.target.value }));
$('#facPin').onclick = () => { const c = map.getCenter(); saveFac({ gate: [c.lng, c.lat] }); $('#facPinInfo').textContent = 'Truck entrance saved. Rerouting to the gate…'; toast('Truck entrance saved'); if (!S.nav) plan(); else plan(true); };
$('#facClear').onclick = () => { saveFac({ gate: null }); $('#facPinInfo').textContent = 'Pin cleared.'; };
function showGate() { const f = S.facilities[facKey(S.dest)]; if (f?.gate) gateMarker.setLngLat(f.gate).addTo(map); else gateMarker.remove(); }
S.saveFac = saveFac; S.openFac = openFac;

// ---------- Demo drive ----------
function startDemo(speedMps = 25, rate = 4) {
  if (!S.route) return; stopDemo();
  const d = { dist: 0 }; d.reset = () => { d.line = S.route.line; d.cum = S.route.cum; d.dist = 0; }; d.reset();
  d.timer = setInterval(() => { d.dist = Math.min(d.dist + speedMps * rate, d.cum.at(-1));
    let i = d.cum.findIndex(c => c > d.dist); if (i < 1) i = d.cum.length - 1;
    const a = d.line[i - 1], b = d.line[i], t = (d.dist - d.cum[i - 1]) / Math.max(0.01, d.cum[i] - d.cum[i - 1]);
    onFix({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, speed: speedMps, heading: bearing(a, b), acc: 5, t: Date.now() }); if (!S.nav) stopDemo(); }, 1000);
  S.demo = d; if (!S.nav) startNav(); toast('Demo drive: simulated GPS along your route (4× speed)');
}
function stopDemo() { if (S.demo) { clearInterval(S.demo.timer); S.demo = null; } }
$('#demoBtn').onclick = () => startDemo(); S.startDemo = startDemo; S.stopDemo = stopDemo;

// ---------- Stops ahead along the route (built-in OSM extract + live Overpass corridor chunks) ----------
const POI_ICON = { stop: '🚛', fuel: '⛽', rest: '🅿️', parking: '🅿️', weigh: '⚖️', other: '📍' };
const POI_NAME = { stop: 'Truck stop', fuel: 'Fuel', rest: 'Rest area', parking: 'Truck parking', weigh: 'Weigh station', other: 'Place' };
function clearPois() { poiMarkers.forEach(m => m.remove()); poiMarkers = []; $('#poiList').textContent = 'Tap ⛽ to load truck stops, rest areas and weigh stations ahead on this route.'; }
let staticPois = null;
async function getStaticPois() { if (staticPois) return staticPois;
  try { const [j, dz, am] = await Promise.all([fetch('data/truck-pois-northeast.geojson').then(r => r.json()), fetch('data/diesel-northeast.geojson').then(r => r.json()).catch(() => ({ features: [] })), fetch('data/amenities-northeast.geojson').then(r => r.json()).catch(() => ({ features: [] }))]); j.features = j.features.concat(dz.features, am.features); staticPois = j.features.map(f => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], tags: f.properties, id: f.properties.osm })); } catch { staticPois = []; }
  return staticPois; }
function bboxOf(ln, pad) { let a = [180, 90, -180, -90]; for (const [x, y] of ln) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; return [a[0] - pad, a[1] - pad, a[2] + pad, a[3] + pad]; }
async function overpassChunk(pts) {
  const key = 'op_' + pts[0].map(v => v.toFixed(3)).join() + '_' + pts.at(-1).map(v => v.toFixed(3)).join() + '_' + pts.length;
  const c = LS.get(key, null); if (c && Date.now() - c.t < 7 * 864e5) return c.els;
  if (S.overpassBusyUntil > Date.now() || !navigator.onLine) return null;

  for (let round = 0; round < 1; round++) {
    for (const url of OVERPASS) { if (!navigator.onLine) return null; try { const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(overpassQuery
(pts, 1200)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue; const j = await r.json(); if (j.remark && !j.elements?.length) continue; LS.set(key, { t: Date.now(), els: j.elements }); return j.elements; } catch {} } }
  S.overpassBusyUntil = Date.now() + 5 * 60e3; return null; // all mirrors busy: back off 5 min, built-in extract covers it
}
function showPois(raw, note) { S.lastPoiRaw = raw; S.lastPoiNote = note;
  const seen = new Set(), base = S.nav ? S.along : 0, r = S.route;
  const pos = e => ({ lon: e.lon ?? e.center?.lon, lat: e.lat ?? e.center?.lat, tags: e.tags || {} });
  const helpers = raw.filter(e => isHelperAmenity(e.tags)).map(pos).filter(h => h.lon != null); S.amenHelpers = helpers.length;
  S.pois = raw.filter(e => !isHelperAmenity(e.tags)).map(e => { const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat; if (lon == null) return null; const k = classifyPoi(e.tags || {});
    const sn = snapToRoute([lon, lat], r.line, r.cum, 0); return { id: e.id || (e.type?.[0] + e.id) || `${lat},${lon}`, lon, lat, kind: k, name: e.tags?.name || e.tags?.brand || POI_NAME[k], tags: e.tags || {}, along: sn.along, off: sn.dist }; })
    .filter(p => p && p.off <= 1700 && (k => !seen.has(k) && seen.add(k))(p.kind + Math.round(p.lat * 500) + ',' + Math.round(p.lon * 500))).sort((a, b) => a.along - b.along);
  attachAmenities(S.pois, helpers, 250, LS.get('amenConf', {}));
  const pf = S.poiFilter || 'all', match = p => pf === 'all' || (pf === 'diesel' ? (p.kind === 'fuel' || p.kind === 'stop') && p.tags['fuel:diesel'] !== 'no' : pf === 'truck' ? p.kind === 'stop' || p.tags.hgv === 'yes' || p.tags['fuel:HGV_diesel'] === 'yes' : pf === 'rest' ? p.kind === 'rest' || p.kind === 'parking' : pf === 'showers' ? !!p.amen?.showers : pf === 'restrooms' ? !!p.amen?.restrooms : pf === 'food' ? !!p.amen?.food : p.kind === pf);
  const ahead = S.pois.filter(p => p.along >= base - 50 && match(p));
  poiMarkers.forEach(m => m.remove());
  poiMarkers = ahead.map(p => { const el = document.createElement('div'); el.className = 'poi-marker'; el.textContent = POI_ICON[p.kind]; el.style.fontSize = '22px';
    return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<b style="color:#111">${esc(p.name)}</b><br><span style="color:#333">${POI_NAME[p.kind]} · ${fmtDist(p.along - base, U())} ahead · ≈${detourMinutes(p.off)} min detour</span>${p.amen && amenityLine(p.amen) ? `<br><span style="color:#333">${esc(amenityLine(p.amen))}</span>` : ''}${amenConfirmHTML(p)}`)).addTo(map); });
  $('#poiList').innerHTML = `<div class="muted small">${esc(note)}</div>` + (ahead.length ? ahead.map(p => `<div class="poi" data-i="${S.pois.indexOf(p)}"><i>${POI_ICON[p.kind]}</i><div><b>${esc(p.name)}</b><br><span class="muted small">${POI_NAME[p.kind]} · in ${fmtDist(p.along - base, U())} · ${p.off < 150 ? 'on route' : '≈' + detourMinutes(p.off) + ' min detour'}${p.tags.opening_hours ? ' · ' + esc(p.tags.opening_hours) : ''}${p.tags['capacity:hgv'] ? ' · ' + esc(p.tags['capacity:hgv']) + ' truck spots' : ''}</span>${S.priceFor?.(p) || ''}${amenityLine(p.amen) ? `<div class="amen small">${esc(amenityLine(p.amen))}${Object.values(p.amen).includes('chain') ? ' <i class="muted">(chain standard — confirm 👍)</i>' : ''}</div>` : ''}</div></div>`).join('') : '<p>No mapped truck stops/rest areas within ~1 mile ahead on this route.</p>');
  if (S.layers && !S.layers.pois) poiMarkers.forEach(m => m.getElement().style.display = 'none');
  $$('.poi').forEach(el => el.onclick = () => { const p = S.pois[+el.dataset.i]; setFollow(false); closePanels(); map.flyTo({ center: [p.lon, p.lat], zoom: 15, pitch: 0 }); });
}
async function loadPois(quiet) {
  if (!S.route) { toast('Plan a route first'); return; }
  if (!quiet) openPanel('routePanel'); $('#poiList').textContent = 'Loading truck stops…'; S.poiDone = false;
  const route = S.route, bb = bboxOf(route.line, 0.02);
  const st = (await getStaticPois()).filter(p => p.lon >= bb[0] && p.lon <= bb[2] && p.lat >= bb[1] && p.lat <= bb[3]);
  let all = st.slice(); S.poiStatic = st.length;
  showPois(all, st.length ? 'From built‑in OpenStreetMap extract · checking live data…' : 'Checking live OpenStreetMap data…');
  const pts = sampleLine(route.line, Math.min(200, Math.max(10, Math.round(route.length / 1200)))), chunks = [];
  for (let i = 0; i < pts.length - 1; i += 24) chunks.push(pts.slice(i, i + 25));
  let okN = 0;
  for (const [i, ch] of chunks.entries()) { if (S.route !== route && S.route?.line[0] !== route.line[0]) break;
    const els = await overpassChunk(ch); if (els) { okN++; all = all.concat(els); }
    showPois(all, `${st.length ? 'Built‑in extract + ' : ''}live OpenStreetMap: ${okN}/${chunks.length} route sections${i < chunks.length - 1 ? '…' : ''}`); }
  if (!okN) showPois(all, st.length ? 'Live servers busy — showing built‑in OpenStreetMap extract (US Northeast, Oct 2026).' : 'Live POI servers busy and this route is outside the built‑in extract. Try again later.');
  S.poiLive = okN; S.poiDone = true;
  try { S.bestPrice?.(S.nav && S.opts?.bestPrice); } catch {}
  if (S.nav && !S.showerSaid && S.pois.some(p => p.amen?.showers)) { S.showerSaid = true; nextAmenity('showers'); }
}
$('#poiBtn').onclick = () => loadPois();
function amenConfirmHTML(p) { if (!['stop', 'rest', 'parking', 'fuel'].includes(p.kind)) return ''; return `${p.kind === 'fuel' || p.kind === 'stop' ? `<div class="vote"><button onclick="TruckNav.reportPrice('${esc(p.id)}')">💲 Report diesel price</button></div>` : ''}<div class="vote">${['showers', 'restrooms', 'food'].map(k => `<button onclick="TruckNav.confirmAmenity('${esc(p.id)}','${k}',true)">👍 ${k}</button><button onclick="TruckNav.confirmAmenity('${esc(p.id)}','${k}',false)">👎</button>`).join('')}</div>`; }
S.refreshPois = () => { if (S.route && S.lastPoiRaw) showPois(S.lastPoiRaw, S.lastPoiNote); };
S.confirmAmenity = async (id, key, val) => { const c = LS.get('amenConf', {}); (c[id] ||= {})[key] = val; LS.set('amenConf', c); const p = S.pois.find(x => String(x.id) === String(id));
  try { await backend.addReport({ id: crypto.randomUUID?.() || String(Math.random()).slice(2), type: 'amenity', poi: id, key, val, lat: p?.lat, lon: p?.lon, t: Date.now(), up: 0, down: 0, mine: true }); } catch {}
  award(5, `Confirmed ${key}`); if (S.lastPoiRaw) showPois(S.lastPoiRaw, S.lastPoiNote); toast(`${val ? 'Confirmed' : 'Marked no'} ${key} — thanks, driver`); };
const AMEN_WORD = { showers: 'showers', restrooms: 'restrooms', food: 'food' };
function nextAmenity(key, speak = true) { const p = nextWithAmenity(S.pois, S.nav ? S.along : 0, key); const msg = p ? `Next ${p.kind === 'rest' ? 'rest area' : 'truck stop'} with ${AMEN_WORD[key]} is ${spokenDist(p.along - (S.nav ? S.along : 0))} ahead${p.name && !/^(Truck stop|Rest area|Fuel|Truck parking)$/.test(p.name) ? ', ' + p.name : ''}.` : `No ${AMEN_WORD[key]} found ahead on this route.`;
  if (speak) say(msg, 'info'); S.lastAmenMsg = msg; return msg; }
S.nextAmenity = nextAmenity;
$$('[data-pf]').forEach(b => b.onclick = () => { S.poiFilter = b.dataset.pf; $$('[data-pf]').forEach(x => x.classList.toggle('on', x === b)); if (S.route && S.lastPoiRaw) showPois(S.lastPoiRaw, S.lastPoiNote); if (['showers', 'restrooms', 'food'].includes(b.dataset.pf) && S.pois.length) toast(nextAmenity(b.dataset.pf), 5000); }); S.loadPois = loadPois;

// ---------- Offline tiles ----------
async function prefetchTiles(quiet) {
  if (!S.route) return; const src = map.getStyle()?.sources; const vec = src && Object.values(src).find(s => s.type === 'vector' && s.url);
  let tmpl = null; try { tmpl = (await (await fetch(vec.url)).json()).tiles[0]; } catch {}
  if (!tmpl) { if (!quiet) toast('Could not read map tile source'); return; }
  const tiles = [...new Set([...tilesForLine(S.route.line, [6, 8], 1), ...tilesForLine(S.route.line, [10, 11, 12, 13, 14], 1)])].slice(0, 6000); let done = 0, fail = 0;
  if (!quiet) toast(`Saving ${tiles.length} map tiles along the route…`);
  const q = tiles.slice(); const worker = async () => { while (q.length) { const t = q.shift(); const [z, x, y] = t.split('/');
    try { const r = await fetch(tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y)); r.ok ? done++ : fail++; } catch { fail++; } } };
  await Promise.all([1, 2, 3, 4].map(worker)); S.offlineTiles = { done, fail, total: tiles.length };
  if (!quiet) toast(`Route map saved for offline: ${done}/${tiles.length} tiles`);
}
$('#offlineBtn').onclick = () => prefetchTiles(false); S.prefetchTiles = prefetchTiles;

// ---------- Report a restriction / hazard (avoided immediately, persists) ----------
function reportPoint() { if (S.nav && S.route) return pointAlong(S.route.line, S.route.cum, S.along + 120); if (S.pos) return [S.pos.lon, S.pos.lat]; const c = map.getCenter(); return [c.lng, c.lat]; }
function renderReportPanel() {
  $('#reportWhere').textContent = S.nav ? 'Reports the road just ahead of you. Restrictions are avoided right away.' : 'Reports at your position (or map centre). Restrictions are avoided right away on this phone.';
  $('#reportGrid').innerHTML = Object.entries(REPORT_TYPES).map(([k, t]) => `<button data-rt="${k}"><b>${t.icon}</b>${t.label}</button>`).join('');
  $$('[data-rt]').forEach(b => b.onclick = () => report(b.dataset.rt));
  $('#avoidList').innerHTML = S.avoids.length ? S.avoids.map((a, i) => `<li>${REPORT_TYPES[a.type]?.icon} ${REPORT_TYPES[a.type]?.label} · ${a.lat.toFixed(4)}, ${a.lon.toFixed(4)} · ${new Date(a.t).toLocaleDateString()} <button class="small-btn" data-un="${i}">Remove</button></li>`).join('') : '<li class="muted">None</li>';
  $$('[data-un]').forEach(b => b.onclick = () => { S.avoids.splice(+b.dataset.un, 1); LS.set('avoids', S.avoids); drawAvoids(); renderReportPanel(); if (S.dest && S.pos && !S.nav) plan(); });
}
async function report(type, at) {
  const [lon, lat] = at || reportPoint(), t = REPORT_TYPES[type];
  const r = { id: (crypto.randomUUID?.() || String(Math.random()).slice(2)), type, lat, lon, t: Date.now(), up: 0, down: 0, mine: true, by: profile.p.name };
  try { await backend.addReport(r); } catch {} S.reports.push(r); drawReports();
  profile.p.stats.reports++; award(t.pts, `${t.label} report`);
  if (t.avoid) { S.avoids.push({ lat, lon, type, t: r.t }); LS.set('avoids', S.avoids); drawAvoids(); toast(`${t.label} saved — avoiding that road`);
    if (S.nav) { say('Thanks. Avoiding that road and recalculating.', 'reroute'); S.lastReroute = Date.now(); S.rerouteCount++; S.rerouting = true; await plan(true).finally(() => S.rerouting = false); }
    else if (S.dest && S.pos) await plan(); }
  else toast(`${t.label} reported — thanks, driver`);
  closePanels(); return r;
}
S.report = report; S.reportPoint = reportPoint;
function drawAvoids() { avoidMarkers.forEach(m => m.remove()); avoidMarkers = S.avoids.map(a => { const el = document.createElement('div'); el.className = 'rpt-marker'; el.textContent = '⛔'; return new maplibregl.Marker({ element: el }).setLngLat([a.lon, a.lat]).addTo(map); }); }
function drawReports() {
  rptMarkers.forEach(m => m.remove());
  rptMarkers = S.reports.filter(r => reportVisible(r) && !(r.mine && REPORT_TYPES[r.type]?.avoid)).map(r => { const t = REPORT_TYPES[r.type]; if (!t) return null;
    const el = document.createElement('div'); el.className = 'rpt-marker'; el.textContent = t.icon;
    const html = document.createElement('div'); html.innerHTML = `<b style="color:#111">${t.label}</b><br><span style="color:#333">${new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · 👍 ${r.up || 0} · 👎 ${r.down || 0}</span>${r.mine ? '<br><i style="color:#555">Your report</i>' : '<div class="vote"><button data-v="up">👍 Still there</button><button data-v="down">👎 Not there</button></div>' + (r.server ? '<button data-abuse style="font-size:11px;margin-top:4px">🚩 Report fake/abusive</button>' : '')}`;
    html.querySelector('[data-abuse]')?.addEventListener('click', async () => { try { await backend.reportAbuse(r.id, prompt('What is wrong with this report? (optional)') || ''); toast('Thanks — flagged for review'); } catch { toast('Sign in (👤) to flag reports'); } });
    html.querySelectorAll('[data-v]').forEach(b => b.onclick = () => vote(r, b.dataset.v));
    return new maplibregl.Marker({ element: el }).setLngLat([r.lon, r.lat]).setPopup(new maplibregl.Popup({ offset: 14 }).setDOMContent(html)).addTo(map); }).filter(Boolean);
}
async function vote(r, dir) { const uid = profile.p.uid || 'me'; let res = null; try { res = await backend.vote(r.id, dir, uid); } catch (e) { if (backend.name === 'supabase') return toast('Sign in (👤) to confirm reports'); } if (res) Object.assign(r, res); else r[dir] = (r[dir] || 0) + 1; award(POINTS.vote, 'Voted on a report'); drawReports(); toast(dir === 'up' ? 'Confirmed — thanks!' : 'Marked not there — thanks!'); }
S.vote = vote; S.drawReports = drawReports; S.drawRoute = drawRoute;
$('#reportBtn').onclick = () => openPanel('reportPanel');

// ---------- Points, badges, leaderboard ----------
function award(pts, why) { const fresh = profile.add(pts, why); profile.save(backend); backend?.addPoints?.(pts, why); renderDock();
  if (pts >= 5) mascot.say(`+${pts} points! ${why}.`, 'happy', 3500);
  for (const b of fresh) { toast(`🏅 Badge earned: ${BADGES[b].name}`, 4000); mascot.say(`New badge: ${BADGES[b].icon} ${BADGES[b].name}!`, 'party'); }
  const lv = profile.level; if (S.lastLevel && lv.index > S.lastLevel) { toast(`⬆ Level up: ${lv.name}!`, 4000); mascot.say(`LEVEL UP! You're a ${lv.name} now. Check the garage for new rigs!`, 'party', 8000); say(`Level up! You're now a ${lv.name}.`, 'info'); } S.lastLevel = lv.index; }
S.award = award;
function renderDock() { $('#dockPts').textContent = `${profile.p.points} pts`; $('#meBtn').firstChild.textContent = profile.p.mood; }
function finishTrip() {
  const miles = Math.round(S.tripMiles); if (miles > 0) { profile.p.stats.miles += miles; award(miles * POINTS.mile, `${miles} miles driven`); }
  if (S.arrived) { const appt = LS.get('load', {}).deliveryTime; if (appt && Date.now() <= Date.parse(appt)) { profile.p.stats.onTime++; award(POINTS.onTime, 'On-time arrival'); }
    if (S.tripMiles >= 5 && monitor.safe()) { profile.p.stats.safeTrips++; award(POINTS.safeTrip, 'Safe trip: no hard braking'); } }
  S.tripMiles = 0;
}
async function renderMe() {
  const p = profile.p, lv = profile.level;
  $('#avatarBig').textContent = p.avatar; $('#pName').textContent = `${p.name} ${p.mood}`; $('#pLevel').textContent = `Level ${lv.index}: ${lv.name}${lv.next ? ` · ${lv.next - p.points} pts to next` : ''}`; $('#pBar').style.width = Math.round(lv.progress * 100) + '%';
  $('#pPts').textContent = p.points; $('#pStreak').textContent = p.stats.streak || 0; $('#pMiles').textContent = p.stats.miles;
  $('#badges').innerHTML = Object.entries(BADGES).map(([k, b]) => `<span class="${p.badges.includes(k) ? '' : 'locked'}">${b.icon} ${b.name}</span>`).join('');
  $('#pNameIn').value = p.name;
  $('#avatarPick').innerHTML = ['🚛', '🚚', '🛻', '🚜', '🚌', '🏎️'].map(a => `<button class="${a === p.avatar ? 'on' : ''}" data-av="${a}">${a}</button>`).join('');
  $('#moodPick').innerHTML = ['😎', '😀', '😴', '😤', '🤠', '☕'].map(a => `<button class="${a === p.mood ? 'on' : ''}" data-md="${a}">${a}</button>`).join('');
  $$('[data-av]').forEach(b => b.onclick = () => { p.avatar = b.dataset.av; profile.save(backend); renderMe(); });
  $$('[data-md]').forEach(b => b.onclick = () => { p.mood = b.dataset.md; profile.save(backend); renderMe(); renderDock(); });
  const lb = await backend.leaderboard(weekKey(), p).catch(() => []);
  $('#leader').innerHTML = lb.map(x => `<li>${esc(x.name)}${x.you ? ' (you)' : ''} — ${x.points} pts</li>`).join('') || '<li class="muted">No points yet this week</li>';
  $('#leaderNote').textContent = backend.name === 'local' ? 'Shared leaderboard and community confirmations go live once accounts are connected to the server. Right now points are kept on this phone.' : 'Live weekly leaderboard.';
  renderGarage(); $('#mascotOn').checked = mascot.enabled; renderAcct(); renderVoiceUI();
}
function renderGarage() { const lv = profile.level.index;
  $('#garage').innerHTML = Object.entries(VEHICLES).filter(([, v]) => !v.real).map(([k, v]) => `<button data-veh="${k}" class="${S.ride.type === k ? 'on' : ''} ${unlocked(k, lv) ? '' : 'lock'}">${vehicleSVG(k, S.ride.color, 44)}${v.name}${unlocked(k, lv) ? '' : ' 🔒L' + v.level}</button>`).join('');
  $('#swatches').innerHTML = Object.entries(COLORS).map(([k, c]) => `<button data-col="${k}" title="${k}${colorUnlocked(k, lv) ? '' : ' (level 3)'}" class="${S.ride.color === k ? 'on' : ''}" style="background:${c};${colorUnlocked(k, lv) ? '' : 'opacity:.3'}"></button>`).join('');
  $$('[data-veh]').forEach(b => b.onclick = () => { if (!unlocked(b.dataset.veh, lv)) return toast(`Reach level ${VEHICLES[b.dataset.veh].level} to unlock`); S.ride.type = b.dataset.veh; LS.set('ride', S.ride); drawRide(); renderGarage(); });
  $$('[data-col]').forEach(b => b.onclick = () => { if (!colorUnlocked(b.dataset.col, lv)) return toast('Reach level 3 to unlock'); S.ride.color = b.dataset.col; LS.set('ride', S.ride); drawRide(); renderGarage(); }); }
$('#mascotOn').onchange = e => { mascot.enabled = e.target.checked; LS.set('mascot', mascot.enabled); if (mascot.enabled) mascot.say("Hey! I'm Ace, your co-pilot. Tap me for tips.", 'happy'); else mascot.hide(); };
S.renderGarage = renderGarage; S.drawRide = drawRide;
$('#pNameIn').addEventListener('change', e => { profile.p.name = e.target.value.trim() || 'Driver'; profile.save(backend); renderMe(); });
// Me > Account: one account system (account.js: email + password, or device accounts). This box only summarises it; no second sign-in form.
async function renderAcct() { const box = $('#acctBox'); if (!box) return; const a = S.auth, u = a?.user;
  if (!a) { box.innerHTML = '<p class="small muted">Loading account…</p>'; return; }
  if (u) { box.dataset.state = 'signed-in'; box.innerHTML = `<p>Signed in as <b>${esc(u.name || u.email)}</b> <span class="muted small">${esc(u.email || '')}</span></p><div class="row"><button id="meAcctOpen" class="small-btn">Account settings</button><button id="signOut" class="small-btn">Sign out</button></div>`;
    $('#signOut').onclick = async () => { await a.signOut(); renderAcct(); }; $('#meAcctOpen').onclick = () => S.openAccount?.(); return; }
  box.dataset.state = 'signed-out'; box.innerHTML = `<p class="small muted">Guest mode: everything works on this phone. An account restores your truck profile on any phone.</p><button id="meSignIn" class="big primary">Sign in or create account</button>`;
  $('#meSignIn').onclick = () => S.openAccount?.(); }
S.renderMeAcct = renderAcct;

// ---------- Voice settings ----------
function renderVoiceUI() {
  $('#vPersona').innerHTML = Object.entries(PERSONALITIES).map(([k, p]) => `<option value="${k}" ${voice.s.personality === k ? 'selected' : ''}>${p.name}</option>`).join('');
  $('#vVoice').innerHTML = `<option value="">Auto (best available)</option>` + voice.voices.map(v => `<option value="${esc(v.voiceURI)}" ${voice.s.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('');
  $('#vRate').value = voice.s.rate; $('#vPitch').value = voice.s.pitch;
}
voice.onchange = () => { if (!$('#mePanel').classList.contains('hidden')) renderVoiceUI(); };
const saveVoice = () => { voice.s = { ...voice.s, personality: $('#vPersona').value, voiceURI: $('#vVoice').value, rate: +$('#vRate').value, pitch: +$('#vPitch').value }; LS.set('voiceCfg', voice.s); };
['#vPersona', '#vVoice', '#vRate', '#vPitch'].forEach(s => $(s).addEventListener('change', saveVoice));
// ---------- My voice (cloning) ----------
const myVoice = new MyVoice(); voice.custom = myVoice; S.myVoice = myVoice;
let mvBlob = null, mvRec = null, mvT0 = 0, mvTick = 0;
const mvStatus = t => { $('#mvStatus').textContent = t; };
const mvRefresh = () => { $('#mvKey').value = myVoice.key; $('#mvConsent').checked = myVoice.consent; $('#mvOn').checked = myVoice.on; $('#mvOn').disabled = !myVoice.voiceId;
  ['#mvPreview', '#mvCache', '#mvDelete'].forEach(x => $(x).disabled = !myVoice.voiceId);
  $('#mvCreate').disabled = !(mvBlob && myVoice.consent && myVoice.key);
  if (!$('#mvStatus').textContent) mvStatus(myVoice.voiceId ? '✅ Your voice profile is saved on this phone.' : 'No voice profile yet.'); };
$('#mvScript').textContent = SCRIPT;
$('#mvKey').addEventListener('change', () => { myVoice.key = $('#mvKey').value.trim(); myVoice.save(); mvRefresh(); });
$('#mvConsent').addEventListener('change', () => { myVoice.consent = $('#mvConsent').checked; myVoice.save(); mvRefresh(); });
$('#mvOn').addEventListener('change', () => { myVoice.on = $('#mvOn').checked; myVoice.save(); mvStatus(myVoice.on ? 'Navigation will use your voice.' : 'Using the phone voice.'); });
$('#mvRec').onclick = async () => {
  if (mvRec?.state === 'recording') { mvRec.stop(); return; }
  try { const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = []; mvRec = new MediaRecorder(st, recMime() ? { mimeType: recMime() } : undefined);
    mvRec.ondataavailable = e => e.data.size && chunks.push(e.data);
    mvRec.onstop = () => { st.getTracks().forEach(t => t.stop()); clearInterval(mvTick); const secs = Math.round((Date.now() - mvT0) / 1000);
      mvBlob = new Blob(chunks, { type: mvRec.mimeType || 'audio/webm' }); $('#mvPlayback').src = URL.createObjectURL(mvBlob); $('#mvPlayback').classList.remove('hidden');
      $('#mvRec').textContent = '⏺ Re-record'; mvStatus(secs < 30 ? `Recorded ${secs}s. 30–60s gives a much better clone; consider re-recording.` : `Recorded ${secs}s. Listen back, then tap Create my voice.`); mvRefresh(); };
    mvRec.start(1000); mvT0 = Date.now(); $('#mvRec').textContent = '⏹ Stop';
    mvTick = setInterval(() => { const s2 = Math.round((Date.now() - mvT0) / 1000); $('#mvTimer').textContent = s2 + 's'; if (s2 >= 90) mvRec.stop(); }, 500);
  } catch (e) { mvStatus('Microphone not available: ' + e.message); } };
$('#mvCreate').onclick = async () => { $('#mvCreate').disabled = true; mvStatus('Uploading sample and creating your voice…');
  try { await myVoice.clone(mvBlob, (profile?.name || 'Driver') + ' (RigRoute)'); mvStatus('✅ Voice created. Saving common phrases for offline use…');
    await myVoice.pregenerate(COMMON, (n, t) => mvStatus(`✅ Voice created. Saving phrases offline ${n}/${t}…`)); mvStatus('✅ Your voice is ready and common phrases work offline.');
  } catch (e) { mvStatus('⚠️ ' + e.message); } mvRefresh(); };
$('#mvPreview').onclick = async () => { try { const c = await myVoice.play('In one mile, take the exit on the right. Weigh station ahead.'); mvStatus(c ? 'Played from offline cache.' : 'Played your voice.'); } catch (e) { mvStatus('⚠️ ' + e.message + ' — using phone voice.'); voice.speakWeb('In one mile, take the exit on the right.'); } };
$('#mvCache').onclick = async () => { try { const n = await myVoice.pregenerate(COMMON, (i, t) => mvStatus(`Saving ${i}/${t}…`)); mvStatus(`✅ ${n} phrases saved for offline.`); } catch (e) { mvStatus('⚠️ ' + e.message); } };
$('#mvDelete').onclick = async () => { await myVoice.remove(); mvStatus('Voice profile deleted from this phone and ElevenLabs.'); mvRefresh(); };
mvRefresh();
$('#vPreview').onclick = () => { saveVoice(); say('In one mile, take exit 13A toward I 95 S / NJ Tpke.', 'turn', true); setTimeout(() => say('Weigh station in two miles.', 'weigh', true), 4500); };

// ---------- HOS helper ----------
function hosSet(s, auto) { const last = S.events.at(-1); if (last?.s === s) return;
  const before = hosStatus(S.events, Date.now(), { cycle: +S.truck.cycle || 70 }); if (['off', 'sb'].includes(last?.s) && s === 'drive' && Date.now() - last.t >= 30 * 60e3 && before.driveUsed > 2 * H && before.breakLeft > 0) { profile.p.stats.breaks++; award(POINTS.breakTaken, 'HOS break before it was due'); }
  S.events.push({ t: Date.now(), s, auto: !!auto }); S.events = S.events.filter(e => e.t > Date.now() - 8 * 24 * H); LS.set('hos', S.events); hosRender(); if (auto) toast(`Duty status → ${labelDuty(s)} (auto)`); }
const labelDuty = s => ({ off: 'Off duty', sb: 'Sleeper', on: 'On duty', drive: 'Driving' }[s]);
$$('[data-duty]').forEach(b => b.onclick = () => hosSet(b.dataset.duty));
$('#hosReset').onclick = () => { if (confirm('Clear the HOS helper log on this phone?')) { S.events = []; LS.set('hos', []); hosRender(); } };
function hosAuto(mph) { if (!$('#autoDrive').checked || !S.nav) return; const cur = S.events.at(-1)?.s;
  if (mph > 5) { S.stoppedSince = null; if (cur !== 'drive') hosSet('drive', true); } else if (cur === 'drive') { S.stoppedSince ??= Date.now(); if (Date.now() - S.stoppedSince > 5 * 60e3) hosSet('on', true); } }
const hm = ms => { const m = Math.max(0, Math.floor(ms / 60e3)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
function hosRender() {
  const h = hosStatus(S.events, Date.now(), { cycle: +S.truck.cycle || 70 }); S.hos = h;
  $('#hCycle').textContent = hm(h.cycleLeft); $('#hCycleLbl').textContent = `Left on ${S.truck.cycle || 70}‑hour / ${+S.truck.cycle === 60 ? 7 : 8}‑day cycle (34‑h restart resets)`;
  $('#hDrive').textContent = hm(h.driveLeft); $('#hWin').textContent = hm(h.windowLeft); $('#hBreak').textContent = hm(h.breakLeft); $('#dockHos').textContent = hm(Math.min(h.driveLeft, h.breakLeft));
  $$('[data-duty]').forEach(b => b.classList.toggle('on', b.dataset.duty === h.status));
  $('#hosWarn').innerHTML = h.warnings.map(w => `<div class="alert ${/soon|under/i.test(w) ? 'warn' : ''}">${w}</div>`).join('');
  $$('#alerts .hosA').forEach(e => e.remove());
  if (h.status === 'drive') for (const w of h.warnings) { const el = document.createElement('div'); el.className = 'alert hosA ' + (/soon|under/i.test(w) ? 'warn' : ''); el.textContent = '⏱ ' + w; $('#alerts').prepend(el); }
  for (const w of h.warnings) if (!S.warned[w] && h.status === 'drive') { S.warned[w] = true; say('Hours of service: ' + w, 'hos'); mascot.say(`⏱ ${w}. Time to find a spot to rest.`, 'worried', 9000); }
  $('#hosLog').innerHTML = S.events.slice(-20).reverse().map(e => `<li>${new Date(e.t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} — ${labelDuty(e.s)}${e.auto ? ' (auto)' : ''}</li>`).join('');
}
setInterval(hosRender, 30e3); hosRender();

// ---------- Load / trip ----------
const lf = $('#loadForm'); const load = LS.get('load', {}); for (const [k, v] of Object.entries(load)) if (lf.elements[k]) lf.elements[k].value = v;
const syncCall = () => { const ph = lf.elements.dispatch.value.replace(/[^\d+]/g, ''); $('#callDispatch').href = ph ? 'tel:' + ph : '#'; };
lf.addEventListener('input', () => { LS.set('load', Object.fromEntries(new FormData(lf))); syncCall(); }); syncCall();
async function navTo(field) { const q = lf.elements[field].value.trim(); if (!q) { toast('Enter the address first'); return; }
  toast('Looking up ' + q); try { const r = await geocode(q); if (!r.length) return toast('Address not found'); closePanels(); setDest({ ...r[0], name: q }); } catch { toast('Search unavailable'); } }
$('#navPickup').onclick = () => navTo('pickup'); $('#navDelivery').onclick = () => navTo('delivery');

// ---------- Truck profile ----------
const tf = $('#truckForm');
function fillTruck() { for (const [k, v] of Object.entries(S.truck)) { const el = tf.elements[k]; if (!el) continue; el.type === 'checkbox' ? (el.checked = !!v) : (el.value = v); } }
fillTruck();
tf.addEventListener('change', () => { const prevTheme = S.truck.theme;
  for (const el of tf.elements) if (el.name) S.truck[el.name] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? +el.value : el.value);
  LS.set('truck', S.truck); if (S.truck.theme !== prevTheme) { applyTheme(); if (STYLES[S.truck.theme] !== STYLES[prevTheme]) map.setStyle(STYLES[S.truck.theme]); }
  if (S.dest && S.pos && !S.nav) plan(); });
const PRESETS = { 53: { heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5 }, box: { heightFt: 12, heightIn: 0, weightLbs: 26000, lengthFt: 34, widthFt: 8.5, axles: 2 }, bob: { heightFt: 13, heightIn: 0, weightLbs: 20000, lengthFt: 22, widthFt: 8.5, axles: 3 } };
$$('[data-preset]').forEach(b => b.onclick = () => { Object.assign(S.truck, PRESETS[b.dataset.preset]); fillTruck(); tf.dispatchEvent(new Event('change')); toast('Truck profile updated'); });
const DRIVER_TYPES = {
  otr: { label: 'Over‑the‑road: 53\' van 80k, 70h/8‑day cycle, interstates preferred.', set: { heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, cycle: 70, avoidTolls: false } },
  local: { label: 'Local/short‑haul: 26\' box truck. If you stay within 150 air‑miles and return in 14h you may qualify for the short‑haul exception (no 30‑min break / logs) — check your carrier.', set: { heightFt: 12, heightIn: 0, weightLbs: 26000, lengthFt: 34, widthFt: 8.5, axles: 2, cycle: 60, avoidTolls: false } },
  owner: { label: 'Owner‑operator: your own rig; avoid tolls on by default to protect your margin.', set: { heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 72, widthFt: 8.5, axles: 5, cycle: 70, avoidTolls: true } },
  fleet: { label: 'Fleet driver: company tractor‑trailer, follow company routing policy; tolls allowed.', set: { heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 70, widthFt: 8.5, axles: 5, cycle: 70, avoidTolls: false } },
};
function renderDT() { $$('[data-dt]').forEach(b => b.classList.toggle('on', b.dataset.dt === S.truck.driverType)); $('#dtNote').textContent = DRIVER_TYPES[S.truck.driverType]?.label || '';
  $('#hazBtn').textContent = `☣ Hazmat: ${S.truck.hazmat ? 'ON' : 'off'}`; $('#hazBtn').classList.toggle('on', !!S.truck.hazmat); $('#weighBtn').textContent = `⚖️ Avoid scales: ${S.truck.avoidWeigh ? 'ON' : 'off'}`; $('#weighBtn').classList.toggle('on', !!S.truck.avoidWeigh); }
$$('[data-dt]').forEach(b => b.onclick = () => { S.truck.driverType = b.dataset.dt; Object.assign(S.truck, DRIVER_TYPES[b.dataset.dt].set); fillTruck(); tf.dispatchEvent(new Event('change')); renderDT(); hosRender(); toast('Driver type: ' + b.textContent.trim()); });
$('#hazBtn').onclick = () => { S.truck.hazmat = !S.truck.hazmat; fillTruck(); tf.dispatchEvent(new Event('change')); renderDT(); toast(S.truck.hazmat ? 'Hazmat ON — routing around hazmat-restricted roads & tunnels' : 'Hazmat off'); };
$('#weighBtn').onclick = () => { S.truck.avoidWeigh = !S.truck.avoidWeigh; fillTruck(); tf.dispatchEvent(new Event('change')); renderDT(); if (S.truck.avoidWeigh) toast('Avoiding scales where possible — you must still stop when signs require it', 5000); };
tf.addEventListener('change', renderDT); renderDT(); S.DRIVER_TYPES = DRIVER_TYPES;
// Layers
const LAYERS = { fuelAll: v => map.getLayer('fuelAll') && map.setLayoutProperty('fuelAll', 'visibility', v ? 'visible' : 'none'), wz: v => map.getLayer('wz') && map.setLayoutProperty('wz', 'visibility', v ? 'visible' : 'none'),
  pois: v => $$('.poi-marker').forEach(e => e.style.display = v ? '' : 'none'), reports: v => rptMarkers.forEach(m => m.getElement().style.display = v ? '' : 'none'), avoids: v => avoidMarkers.forEach(m => m.getElement().style.display = v ? '' : 'none'),
  car: v => { $('#cmpCar').checked = v; drawRoute(); }, sat: v => setSat(v) };
S.layers = { fuelAll: true, pois: true, wz: false, reports: true, avoids: true, car: false, sat: false, ...LS.get('layers', {}) };
function applyLayers() { for (const [k, f] of Object.entries(LAYERS)) { try { f(S.layers[k]); } catch {} } $$('[data-layer]').forEach(c => c.checked = !!S.layers[c.dataset.layer]); }
$$('[data-layer]').forEach(c => c.onchange = () => { S.layers[c.dataset.layer] = c.checked; LS.set('layers', S.layers); applyLayers(); });
$('#layersBtn').onclick = () => openPanel('layersPanel'); map.on('idle', () => { if (!S._layersApplied) { S._layersApplied = true; applyLayers(); } }); S.applyLayers = applyLayers;
// HUD windshield mode (mirrored for reflection on the glass at night)
function setHud(v) { S.hud = v; $('#hud').classList.toggle('hidden', !v); if (v) { toast('HUD: lay the phone flat under the windshield at night'); updateHud(); } }
updateHud = function () { if (!S.hud) return; $('#hudArrow').textContent = $('#bArrow').textContent; $('#hudDist').textContent = S.nav ? $('#bDist').textContent : '--'; $('#hudSpeed').textContent = $('#speed').textContent + ' mph'; }
$('#hudBtn').onclick = () => setHud(true); $('#hudExit').onclick = () => setHud(false); S.setHud = setHud; S.updateHud = () => updateHud();
S.setTruck = t => { Object.assign(S.truck, t); fillTruck(); LS.set('truck', S.truck); };

// ---------- Boot (resume after crash/reload) ----------
setFollow(true);
if (S.pos) truckMarker.setLngLat([S.pos.lon, S.pos.lat]).addTo(map);
if (S.dest) { $('#destLabel').textContent = S.dest.name; destMarker.setLngLat([S.dest.lon, S.dest.lat]).addTo(map); showGate(); }
const savedRoutes = LS.get('routes', null), savedRoute = LS.get('route', null);
if (savedRoutes?.length) { S.routes = savedRoutes.map(r => ({ ...r, cum: cumulative(r.line) })); S.sel = Math.min(LS.get('sel', 0), S.routes.length - 1); S.chosen = S.routes[S.sel];
  const c = LS.get('carRoute', null); if (c?.line) S.carRoute = { ...c, cum: cumulative(c.line) };
  S.route = savedRoute?.line ? { ...savedRoute, cum: cumulative(savedRoute.line) } : S.chosen; renderRoute(); ['#goBtn', '#demoBtn', '#facBtn', '#offlineBtn'].forEach(s => $(s).disabled = false); }
drawAvoids(); renderDock(); S.lastLevel = profile.level.index;
const na = LS.get('navActive', null);
if (na && S.route && Date.now() - na.t < 12 * H) { S.resumed = true; setTimeout(() => startNav(true), 300); toast('Resumed your navigation'); }
loadOverlays();
startGPS();
makeBackend().then(async b => { backend = b; S.backend = b; const u = await b.session().catch(() => null); if (u) profile.p.uid = u.id;
  const bb = S.pos ? [S.pos.lon - 3, S.pos.lat - 3, S.pos.lon + 3, S.pos.lat + 3] : null; S.reports = await b.listReports(bb).catch(() => []); S.reports.forEach(r => { if (u && r.user_id === u.id) r.mine = true; }); drawReports(); S.backendReady = true;
  b.subscribe?.((ev, r) => { if (!r) return; const i = S.reports.findIndex(x => x.id === r.id); if (r.mine = !!(S.auth?.user && r.user_id === S.auth.user.id), i >= 0) S.reports[i] = { ...S.reports[i], ...r, mine: S.reports[i].mine || r.mine }; else S.reports.push(r); drawReports(); }); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
window.addEventListener('offline', () => toast('Offline — current route keeps working; rerouting & search need signal', 5000));
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && S.nav && !wakeLock) try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} });
if (!LS.get('greeted', false)) { LS.set('greeted', true); setTimeout(() => mascot.say("Welcome to RigRoute GPS! I'm Ace 🚧 your co-pilot. Set your truck under 🚛, then tap Where to?", 'happy', 9000), 1500); }
else setTimeout(() => mascot.say(TIPS[Math.floor(Math.random() * TIPS.length)], 'calm', 6000), 4000);
setTimeout(() => $('#splash')?.classList.add('gone'), 900); setTimeout(() => $('#splash')?.remove(), 1600);
import('./hazards.js').then(m => m.init(S, { $, map, say, toast, report, openPanel, closePanels, esc })).catch(e => console.error('hazards', e));
import('./traffic.js').then(m => { m.init(S, { $, map, say, toast, esc, LS }); S.trafficReady = true; }).catch(e => console.error('traffic', e));
const H_ = { $, $$, LS, esc, toast, say, map, plan, openPanel, closePanels, alertBanner, mascot, fmtDist, fmtDur, U, MI, report, types: () => REPORT_TYPES };
import('./extras.js').then(m => m.init(S, H_)).catch(e => console.error('extras', e))
  .finally(() => import('./planner.js').then(m => m.init(S, { ...H_, truckCosting })).catch(e => console.error('planner', e)))
  .finally(() => import('./offline.js').then(m => { m.init(S, H_); S.offlineReady = true; }).catch(e => console.error('offline', e)));
S.openPanel = openPanel;
import('./account.js').then(m => m.init(S, H_)).catch(e => console.error('account', e));
S.ready = true;

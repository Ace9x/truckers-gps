// RigRoute GPS — Pro UI layer: SVG icon set (replaces emoji glyphs visually, keeps text for screen readers/tests),
// trucking map style, splash, help button, first-run tour with Ace. Styling/markup only — no feature logic.
import { ICONS } from './iconset.js';
import { HZ } from './hazlogic.js';
const S = window.TruckNav || (window.TruckNav = {}), $ = s => document.querySelector(s);
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('tn_' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('tn_' + k, JSON.stringify(v)); } catch {} } };
const svg = (n, cls = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${cls}">${n}</svg>`;

// ---------- Icons ----------
const keys = Object.keys(ICONS).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const RE = new RegExp(`(${keys.join('|')})\\uFE0F?`, 'gu');
const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|SELECT|TITLE|svg|path|BLOCKQUOTE)$/;
function iconize(root) {
  if (!root || root.nodeType === 3 && !root.parentElement) return;
  const walker = document.createTreeWalker(root.nodeType === 3 ? root.parentElement : root, NodeFilter.SHOW_TEXT);
  const todo = []; let n;
  while ((n = walker.nextNode())) { const p = n.parentElement; if (!p || SKIP.test(p.tagName) || p.closest('.pi,#map canvas,.maplibregl-ctrl-attrib')) continue; RE.lastIndex = 0; if (RE.test(n.data)) todo.push(n); }
  for (const t of todo) {
    const frag = document.createDocumentFragment(); let last = 0; const s = t.data; RE.lastIndex = 0; let m;
    while ((m = RE.exec(s))) { if (m.index > last) frag.append(s.slice(last, m.index)); const sp = document.createElement('span'); sp.className = 'pi'; sp.innerHTML = svg(ICONS[m[1]]) + `<span class="pi-t">${m[0]}</span>`; frag.append(sp); last = m.index + m[0].length; }
    if (last < s.length) frag.append(s.slice(last)); t.replaceWith(frag);
  }
}
let pending = new Set(), raf = 0;
new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') pending.add(m.target); else m.addedNodes.forEach(x => { if (x.nodeType === 1 && !x.classList?.contains('pi') || x.nodeType === 3) pending.add(x); }); }
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; const p = pending; pending = new Set(); p.forEach(x => x.isConnected && iconize(x)); laneState(); }); })
  .observe(document.body, { childList: true, subtree: true, characterData: true });
iconize(document.body);
function laneState() { const l = $('#lanes'); document.body.classList.toggle('lanes-on', !!l && !l.classList.contains('hidden') && !$('#banner').classList.contains('hidden')); }

// ---------- Splash / brand ----------
export const LOGO = `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><rect width="96" height="96" rx="22" fill="#161b22"/><rect x="1.5" y="1.5" width="93" height="93" rx="20.5" fill="none" stroke="#2b333f" stroke-width="3"/><path d="M30 78 L44 18 H52 L66 78" fill="none" stroke="#3a4350" stroke-width="5" stroke-linecap="round"/><path d="M48 26v8M48 44v8M48 62v8" stroke="#3a4350" stroke-width="3" stroke-linecap="round"/><path d="M48 22 L70 70 L48 59 L26 70 Z" fill="#ff9500" stroke="#161b22" stroke-width="3" stroke-linejoin="round"/></svg>`;
const sp = $('#splash'); if (sp) sp.innerHTML = `<div class="splashLogo">${LOGO}</div><h1>RigRoute <em>GPS</em></h1><p>Truck-safe navigation</p>`;

// ---------- Map style tuned for trucking ----------
const map = S?.map;
const DARK = { background: '#0f141b', water: '#0a2033', waterway: '#0a2033', building: '#151b24', landuse_park: '#122019', landcover_wood: '#122019', landuse_residential: '#121820',
  highway_minor: '#252d38', highway_major_inner: '#3a4452', highway_major_casing: '#0f141b', highway_major_subtle: '#3a4452', highway_motorway_inner: '#6b5434', highway_motorway_casing: '#0f141b', highway_motorway_subtle: '#4a3b26', highway_path: '#1c232c' };
function tuneStyle() {
  if (!map?.getStyle()) return; const dark = (S.truck?.theme || 'night') !== 'day';
  for (const l of map.getStyle().layers) { try {
    if (dark) { const c = DARK[l.id]; if (c) map.setPaintProperty(l.id, l.type === 'background' ? 'background-color' : l.type === 'fill' ? 'fill-color' : 'line-color', c);
      if (l.id === 'highway_motorway_inner') map.setPaintProperty(l.id, 'line-width', ['interpolate', ['exponential', 1.4], ['zoom'], 5, 1, 9, 1.6, 14, 5, 18, 16]);
      if (l.id === 'highway_major_inner') map.setPaintProperty(l.id, 'line-width', ['interpolate', ['exponential', 1.3], ['zoom'], 8, 1, 14, 5, 18, 16]);
      if (l.type === 'symbol' && /place_|highway_name/.test(l.id)) { map.setPaintProperty(l.id, 'text-color', /motorway/.test(l.id) ? '#c9a46e' : '#8f9aa8'); map.setPaintProperty(l.id, 'text-halo-color', '#0f141b'); map.setPaintProperty(l.id, 'text-halo-width', 1.5); } }
    else if (/^road_motorway$|^bridge_motorway$|^tunnel_motorway$/.test(l.id)) map.setPaintProperty(l.id, 'line-color', '#f4a53a');
    if (l.id === 'route-casing') map.setPaintProperty(l.id, 'line-color', dark ? '#0b3d91' : '#0d47a1');
  } catch {} }
}
if (map) { map.on('styledata', () => { clearTimeout(tuneStyle.t); tuneStyle.t = setTimeout(tuneStyle, 50); }); if (map.isStyleLoaded()) tuneStyle(); }

// ---------- Dock active state ----------
document.addEventListener('click', e => { const b = e.target.closest('#dock button'); if (!b) return; document.querySelectorAll('#dock button').forEach(x => x.classList.toggle('act', x === b)); });
document.addEventListener('click', e => { if (e.target.closest('.panel .close')) document.querySelectorAll('#dock button').forEach(x => x.classList.remove('act')); });

// ---------- Help button + first-run tour (Ace) ----------
const side = $('#sideBtns'); if (side && !$('#helpBtn')) side.insertAdjacentHTML('beforeend', '<button id="helpBtn" class="round" title="Help & tour" aria-label="Help and tour">?</button>');
const STEPS = [
  { t: 'Hi, I\'m Ace', b: 'I\'ll show you around RigRoute in under a minute. Six quick steps, then I get out of your way.' },
  { sel: '[data-panel=truckPanel]', t: 'Set your truck', b: 'Enter height, weight, length and hazmat once. Every route avoids low bridges and restricted roads for your rig.' },
  { sel: '#searchBtn', t: 'Search a destination', b: 'Type an address, warehouse or city. Long-press the map to drop a pin by hand.' },
  { sel: '[data-panel=routePanel]', t: 'Start navigation', b: 'Pick a route and tap Start. You get lane guidance, speed limits and truck-specific warnings by voice.' },
  { sel: '#reportBtn', t: 'Report hazards', b: 'One tap flags accidents, construction, police or debris. Drivers near you see it live.' },
  { sel: '#speedBox', t: 'Drive mode', b: 'Above 10 mph the screen switches to big glanceable buttons and voice commands, so you never have to type.' },
  { sel: '[data-panel=routePanel]', t: 'Offline maps', b: 'Under Route, save your route or a whole region for dead zones. Navigation keeps working with no signal.' },
  { ask: true, t: 'Want to keep me riding along?', b: 'I can give tips and heads-ups while you drive. You can change this anytime under Me > Fun & co-pilot, or tap ? for help.' },
];
export function startTour() {
  endTour(); let i = 0;
  document.body.insertAdjacentHTML('beforeend', '<div id="tourDim"></div><div id="tourRing" class="hidden"></div><div id="tourCard" role="dialog" aria-live="polite" aria-label="RigRoute tour"></div>');
  const card = $('#tourCard'), ring = $('#tourRing');
  const show = () => { const s = STEPS[i], el = s.sel && $(s.sel), r = el?.getBoundingClientRect();
    if (r && r.width) { ring.classList.remove('hidden'); Object.assign(ring.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' }); } else ring.classList.add('hidden');
    const low = r && r.top > innerHeight / 2; card.style.top = low || !r ? '' : Math.min(r.bottom + 16, innerHeight - 260) + 'px'; card.style.bottom = low ? innerHeight - r.top + 16 + 'px' : (!r ? 'calc(50% - 100px)' : '');
    card.innerHTML = `<div class="th"><div class="ava">ACE</div><div><div class="ts">${s.ask ? 'Your call' : i ? `Step ${i} of ${STEPS.length - 2}` : 'Welcome'}</div><div class="tt">${s.t}</div></div><div class="dots">${STEPS.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div></div><p>${s.b}</p>
      <div class="tb">${s.ask ? '<button id="tOff">Turn off Ace</button><button id="tKeep" class="primary">Keep Ace</button>' : `<button id="tSkip">Skip</button><button id="tNext" class="primary">${i ? 'Next' : 'Show me'}</button>`}</div>`;
    if (s.ask) { $('#tKeep').onclick = () => finish(true); $('#tOff').onclick = () => finish(false); } else { $('#tSkip').onclick = () => finish(false); $('#tNext').onclick = () => { i++; show(); }; } };
  show(); S.tour = { step: () => i };
}
function endTour() { ['#tourDim', '#tourRing', '#tourCard'].forEach(s => $(s)?.remove()); }
function finish(keep) { endTour(); LS.set('tourDone', true); LS.set('mascot', keep); if (S.mascot) { S.mascot.enabled = keep; if (!keep) S.mascot.hide(); else S.mascot.say('Great, I\'ll ride along. Tap ? anytime for help.', 'happy', 4000); }
  const c = $('#mascotOn'); if (c) c.checked = keep; S.tourResult = keep ? 'kept' : 'off'; }
S.startTour = startTour;
$('#helpBtn')?.addEventListener('click', startTour);
$('#replayTour')?.addEventListener('click', () => { document.querySelector('.panel:not(.hidden) .close')?.click(); startTour(); });
// First run: Ace is on as the onboarding guide; afterwards the user's choice (default off) rules.
if (!LS.get('tourDone', false) && (!navigator.webdriver || /[?&]tour=1/.test(location.search)) && !/[?&]notour/.test(location.search)) setTimeout(function go() { if ((S.pos?.speed || 0) > 2 || S.nav) return setTimeout(go, 5000); startTour(); }, 1700); // UX P16: only while parked

// ---------- Right rail: keep the essentials, collapse the rest into a "More" menu ----------
const RAIL_KEEP = new Set(['followBtn', 'reportBtn', 'layersBtn', 'moreBtn']); // UX P2: few floating buttons; SOS, satellite, HUD, voice etc. live in More
const MORE = '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>';
if (side && !$('#moreBtn')) {
  side.insertAdjacentHTML('beforeend', `<button id="moreBtn" class="round" title="More" aria-label="More map tools" aria-expanded="false">${svg(MORE)}</button>`);
  document.body.insertAdjacentHTML('beforeend', '<div id="railMenu" class="hidden" role="menu" aria-label="Map tools"></div>');
  const menu = $('#railMenu'), more = $('#moreBtn');
  const collapse = () => { for (const b of [...side.children]) if (b.tagName === 'BUTTON' && !RAIL_KEEP.has(b.id)) { if (!b.title) b.title = b.getAttribute('aria-label') || b.textContent.trim(); menu.appendChild(b); } const sos = $('#sosBtn'); if (sos && sos.parentElement === side && side.lastElementChild !== sos) side.appendChild(sos); if (more.nextElementSibling !== (sos?.parentElement === side ? sos : null)) side.insertBefore(more, sos?.parentElement === side ? sos : null); };
  collapse(); new MutationObserver(collapse).observe(side, { childList: true });
  const toggle = v => { menu.classList.toggle('hidden', !v); more.setAttribute('aria-expanded', v); more.classList.toggle('on', v); };
  more.onclick = e => { e.stopPropagation(); toggle(menu.classList.contains('hidden')); };
  menu.addEventListener('click', () => setTimeout(() => toggle(false), 120));
  document.addEventListener('click', e => { if (!e.target.closest('#railMenu,#moreBtn')) toggle(false); });
}

// ---------- Traffic legend: small, collapsible ----------
const tfLegendInit = () => { const L = $('#tfLegend'); if (!L || L.dataset.pro) return !!L; L.dataset.pro = 1; L.classList.add('min'); L.setAttribute('role', 'button'); L.setAttribute('aria-label', 'Traffic legend, tap to expand');
  L.addEventListener('click', () => L.classList.toggle('min')); return true; };
if (!tfLegendInit()) { const t = setInterval(() => tfLegendInit() && clearInterval(t), 500); setTimeout(() => clearInterval(t), 20000); }

// ---------- Map point layers: clustered GeoJSON + SVG icons (UX P8, code C3) ----------
const PIN = (bg, path, ring = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="${bg}" stroke="${ring}" stroke-width="2.5"/><g transform="translate(8 8) scale(.6667)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`;
const HZC = { red: '#d32f2f', blue: '#1565c0', green: '#2e7d32', '': '#d97706' };
const HZ_ICON = Object.fromEntries(Object.entries(HZ).map(([k, v]) => [k, /weigh/.test(k) ? '⚖' : v.icon.replace('\uFE0F', '')]));
const hzColor = t => ['accident', 'closed', 'clearance', 'weigh_closed'].includes(t) ? 'red' : t === 'police' || t === 'camera' ? 'blue' : t === 'weigh_open' ? 'green' : '';
const MAPICONS = { 'rr-fuel': PIN('#1f6f8b', ICONS['⛽']), 'rr-fuel-truck': PIN('#c96f00', ICONS['🚛']), 'rr-wz': PIN('#d97706', ICONS['🚧']), 'rr-closed': PIN('#c62828', ICONS['⛔']) };
for (const [t, g] of Object.entries(HZ_ICON)) if (ICONS[g]) MAPICONS['rr-hz-' + t] = PIN(HZC[hzColor(t)], ICONS[g]);
MAPICONS['rr-hz-other'] = PIN('#d97706', ICONS['⚠']);
const loadImg = (src) => new Promise(r => { const i = new Image(64, 64); i.onload = () => r(i); i.onerror = () => r(null); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src); });
const empty = { type: 'FeatureCollection', features: [] };
function clusterLayers(src, color, minzoom = 0, colorExpr = null) {
  if (!map.getLayer(src + '-cl')) map.addLayer({ id: src + '-cl', type: 'circle', source: src, minzoom, filter: ['has', 'point_count'], paint: { 'circle-color': colorExpr || color, 'circle-radius': ['step', ['get', 'point_count'], 14, 10, 17, 50, 21], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  if (!map.getLayer(src + '-cn')) map.addLayer({ id: src + '-cn', type: 'symbol', source: src, minzoom, filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
  if (!clusterLayers[src]) { clusterLayers[src] = 1; map.on('click', src + '-cl', async e => { const f = e.features[0]; const z = await map.getSource(src).getClusterExpansionZoom(f.properties.cluster_id); map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.5 }); }); }
}
async function addPoiIcons() { if (!map?.getStyle()) return;
  for (const [k, v] of Object.entries(MAPICONS)) if (!map.hasImage(k)) { const img = await loadImg(v); if (img && !map.hasImage(k)) map.addImage(k, img, { pixelRatio: 2 }); }
  const unc = ['!', ['has', 'point_count']];
  const mk = (id, src, icon, base, minzoom) => { if (!map.getSource(src) || map.getLayer(id)) return; map.addLayer({ id, type: 'symbol', source: src, minzoom, filter: unc, layout: { 'icon-image': icon, 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 1], 'icon-allow-overlap': true } });
    map.setPaintProperty(base, 'circle-opacity', 0); map.setPaintProperty(base, 'circle-stroke-opacity', 0); };
  try {
    mk('fuelAllIcon', 'fuelAll', ['case', ['==', ['get', 'truck'], true], 'rr-fuel-truck', 'rr-fuel'], 'fuelAll', 10); if (map.getSource('fuelAll')) clusterLayers('fuelAll', '#1f6f8b', 10);
    mk('wzIcon', 'wz', ['case', ['get', 'closed'], 'rr-closed', 'rr-wz'], 'wz', 11); if (map.getSource('wz')) clusterLayers('wz', '#d97706', 9, ['case', ['>', ['get', 'closed'], 0], '#c62828', '#d97706']);
    if (!map.getSource('hzPts')) map.addSource('hzPts', { type: 'geojson', data: hzGeo || empty, cluster: true, clusterRadius: 40, clusterMaxZoom: 14, clusterProperties: { sev: ['max', ['get', 'sev']] } });
    clusterLayers('hzPts', '#d97706', 0, ['case', ['>=', ['get', 'sev'], 2], '#d32f2f', '#d97706']);
    if (!map.getLayer('hzPts-i')) { map.addLayer({ id: 'hzPts-i', type: 'symbol', source: 'hzPts', filter: unc, layout: { 'icon-image': ['coalesce', ['image', ['concat', 'rr-hz-', ['get', 'type']]], ['image', 'rr-hz-other']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 15, 1], 'icon-allow-overlap': true }, paint: { 'icon-opacity': ['get', 'op'] } });
      map.on('click', 'hzPts-i', e => document.querySelector(`.hz-pin[data-id="${CSS.escape(e.features[0].properties.id)}"]`)?.click()); }
  } catch (e) { console.warn('pro layers', e); }
  for (const [ic, base] of [['fuelAllIcon', 'fuelAll'], ['wzIcon', 'wz']]) if (map.getLayer(ic) && map.getLayer(base)) { const v = map.getLayoutProperty(base, 'visibility') || 'visible';
    for (const id of [ic, base + '-cl', base + '-cn']) if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== v) map.setLayoutProperty(id, 'visibility', v); }
  const hv = S.layers?.reports === false ? 'none' : 'visible'; for (const id of ['hzPts-i', 'hzPts-cl', 'hzPts-cn']) if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== hv) map.setLayoutProperty(id, 'visibility', hv);
}
// Hazard reports → clustered source (DOM pins stay for popups/votes but are not drawn).
let hzGeo = empty;
function syncHazards() { const hz = S.hz; if (!hz?.visible || !map) return; const now = Date.now();
  hzGeo = { type: 'FeatureCollection', features: hz.visible(now).map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { id: r.id, type: r.type, sev: hzColor(r.type) === 'red' ? 2 : 1, op: +(document.querySelector(`.hz-pin[data-id="${CSS.escape(r.id)}"]`)?.dataset.op || 1) } })) };
  map.getSource('hzPts')?.setData(hzGeo); }
document.body.classList.add('pro-hz');
if (map) { map.on('styledata', () => { clearTimeout(addPoiIcons.t); addPoiIcons.t = setTimeout(addPoiIcons, 80); }); map.on('idle', addPoiIcons); setInterval(syncHazards, 2000);
  new MutationObserver(() => { clearTimeout(syncHazards.t); syncHazards.t = setTimeout(syncHazards, 150); }).observe(document.body, { childList: true }); }

// ---------- Driving-state layouts (UX P3, P10, P11) ----------
document.body.insertAdjacentHTML('beforeend', `<div id="navStack" aria-label="Driving controls">
  <button id="nsRecenter" class="ns64" aria-label="Recenter">${svg(ICONS['◎'])}</button>
  <button id="nsMute" class="ns64" aria-label="Mute voice">${svg(ICONS['🔊'])}</button>
  <button id="nsReport" class="ns76" aria-label="Report hazard">${svg(ICONS['⚠'])}</button></div>
  <button id="truckChip" aria-label="Truck profile, tap to edit"></button>`);
$('#nsReport').onclick = () => $('#reportBtn')?.click(); $('#nsMute').onclick = () => { $('#muteBtn')?.click(); setTimeout(state, 50); }; $('#nsRecenter').onclick = () => $('#followBtn')?.click();
$('#truckChip').onclick = () => document.querySelector('[data-panel=truckPanel]')?.click();
const ftIn = t => `${t.heightFt ?? 13}'${t.heightIn ?? 0}"`;
function state() { const b = document.body, mph = (S.pos?.speed || 0) * 2.23694, rem = S.route && S.nav ? (S.route.length - (S.along || 0)) : 1e9;
  const st = !S.nav ? 'browse' : rem < 805 ? 'arriving' : 'nav';
  for (const k of ['browse', 'nav', 'arriving']) b.classList.toggle('st-' + k, st === k); b.classList.toggle('moving', mph > 5); b.classList.toggle('mascot-opt', !!S.mascot?.enabled);
  b.classList.toggle('following', S.follow !== false); $('#nsMute').innerHTML = svg(ICONS[S.voiceObj?.enabled === false ? '🔇' : '🔊']); $('#nsMute').classList.toggle('off', S.voiceObj?.enabled === false);
  const t = S.truck || {}; const txt = `${ftIn(t)} · ${Number(t.weightLbs || 0).toLocaleString()} lb · ${t.hazmat ? 'Hazmat' : 'No hazmat'}`;
  const chip = $('#truckChip'); if (chip.dataset.t !== txt) { chip.dataset.t = txt; chip.innerHTML = svg(ICONS['🚛']) + `<span>${txt}</span>`; }
  try { if (S.truck) localStorage.setItem('tn_truckBak', JSON.stringify(S.truck)); } catch {}
  const rs = $('#routeSummary'); if (rs && !$('#rpTruck')) rs.insertAdjacentHTML('beforebegin', '<button id="rpTruck" class="small-btn"></button>');
  const rp = $('#rpTruck'); if (rp && rp.dataset.t !== txt) { rp.dataset.t = txt; rp.innerHTML = svg(ICONS['🚛']) + ` Routing for ${txt} <span class="muted">· edit</span>`; rp.onclick = () => document.querySelector('[data-panel=truckPanel]')?.click(); } }
function placeChip() { const row = $('#acctChips'), c = $('#truckChip'); if (row && c && c.parentElement !== row) { c.classList.add('chip'); row.prepend(c); } }
setInterval(() => { state(); placeChip(); }, 1000); state();

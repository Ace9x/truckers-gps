// NYC truck routes in the app: map layer, plan-time "leaves truck route" check, live off-truck-route warning (voice + haptic).
import { buildIndex, nearestRoute, offTruckRoute, inNYC } from './truckroutes.js';
let S; const $ = s => document.querySelector(s), LSK = 'tn_nycTruckLayer';
let ix = null, loading = null;
export function load() { if (ix) return Promise.resolve(ix); return loading ||= fetch('data/nyc-truck-routes.json').then(r => r.json()).then(d => (ix = buildIndex(d))).catch(e => { loading = null; throw e; }); }
const nearNYC = p => p && p.lon > -74.6 && p.lon < -73.4 && p.lat > 40.3 && p.lat < 41.1;
function geo() { return { type: 'FeatureCollection', features: ix.segs.map(s => ({ type: 'Feature', properties: { t: s.t, n: s.name }, geometry: { type: 'LineString', coordinates: s.pts } })) }; }
function layer(on) { const map = S.map; if (!map?.getStyle()) return;
  if (on && ix && !map.getSource('nycTruck')) { map.addSource('nycTruck', { type: 'geojson', data: geo() });
    map.addLayer({ id: 'nycTruck', type: 'line', source: 'nycTruck', minzoom: 11, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 't'], 'T', '#ff9500', 'X', '#a78bfa', '#38bdf8'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 3, 18, 6], 'line-opacity': 0.75 } }, map.getLayer('route-casing') ? 'route-casing' : undefined);
    map.on('click', 'nycTruck', e => { const f = e.features[0].properties; new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b style="color:#111">${String(f.n || 'Truck route').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';')}</b><br><span style="color:#333">NYC ${f.t === 'T' ? 'Through' : f.t === 'X' ? 'Limited Local' : 'Local'} truck route</span>`).addTo(map); }); }
  if (map.getLayer('nycTruck')) map.setLayoutProperty('nycTruck', 'visibility', on ? 'visible' : 'none'); }
function ui() { const lp = $('#layersPanel'); if (!lp || $('#nycTruckChk')) return; const anchor = lp.querySelector('[data-layer="fuelAll"]')?.closest('label');
  const l = document.createElement('label'); l.className = 'chk'; l.innerHTML = `<input type="checkbox" id="nycTruckChk"> NYC truck routes <small class="muted">(orange Through, blue Local)</small>`; (anchor || lp.lastChild).after(l);
  const c = $('#nycTruckChk'); c.checked = localStorage.getItem(LSK) === '1'; c.onchange = () => { localStorage.setItem(LSK, c.checked ? '1' : '0'); if (c.checked) load().then(() => layer(true)); else layer(false); }; }
// Plan-time: the route sheet says if (and where) the route leaves designated truck routes inside NYC
let lastRoute = null;
async function planCheck() { const r = S.route; if (!r || r === lastRoute) return; const line = r.line; S.nycIn = !!line?.some(p => inNYC(p[0], p[1])); if (!S.nycIn) { lastRoute = r; S.nycOff = []; render(); return; }
  await load(); lastRoute = r; S.nycOff = offTruckRoute(ix, line, r.cum); render(); }
function render() { const rp = $('#routePanel'); if (!rp) return; let n = $('#nycOff'); const off = S.nycOff || [], long = S.nycIn && (+S.truck?.lengthFt || 0) > 55;
  if (!off.length && !long) { n?.remove(); return; } if (!n) { n = document.createElement('div'); n.id = 'nycOff'; n.setAttribute('role', 'note'); ($('#hosEta') || $('#alts'))?.before(n); }
  const mi = off.reduce((a, o) => a + o.len, 0) / 1609.34, near = off.length ? nearestRoute(ix, off[0].at[0], off[0].at[1], 400) : null;
  n.innerHTML = (off.length ? `⚠ <b>Leaves NYC truck routes for ${mi.toFixed(1)} mi</b>${near ? ` near ${near.name}` : ''}. NYC tickets trucks off designated routes except to reach your stop.` : '')
    + (long ? `<div data-nyc53>📏 <b>${S.truck.lengthFt} ft rig in NYC:</b> 53′ trailers and rigs over 55 ft may only use the interstate network in the city — a NYC DOT oversize permit is needed to leave it.</div>` : ''); }
// Live: off a designated route for ~150 m inside NYC, not within 0.5 mi of start/destination -> voice + haptic, at most every 2 min
let offCount = 0, lastWarn = 0;
function live() { const p = S.pos; if (!S.nav || !p || !inNYC(p.lon, p.lat) || !ix) { offCount = 0; return; }
  const left = (S.route?.length || 0) - (S.along || 0), done = S.along || 0; if (left < 805 || done < 805) { offCount = 0; S.nycTruckStatus = 'access'; return; }
  const on = nearestRoute(ix, p.lon, p.lat, 30); S.nycTruckStatus = on ? 'on' : 'off'; offCount = on ? 0 : offCount + 1;
  if (offCount >= 3 && Date.now() - lastWarn > 120e3) { lastWarn = Date.now(); S.voiceObj?.say('You have left the New York City truck route. Return to a designated truck route.', 'danger');
    try { navigator.vibrate?.([200, 100, 200]); } catch {} const a = $('#alerts'); if (a) { const el = document.createElement('div'); el.className = 'alert warn'; el.textContent = '⚠ Off NYC truck route — return to a designated route'; a.appendChild(el); setTimeout(() => el.remove(), 12000); } } }
export function start() { S = window.TruckNav; S.nycOff = []; S.nycTruckStatus = null; setInterval(ui, 1000); setInterval(() => { planCheck().catch(() => {}); }, 1500); setInterval(live, 2000);
  setInterval(() => { if ((nearNYC(S.pos) || S.route?.line?.some(p => inNYC(p[0], p[1]))) && !ix) load().catch(() => {}); if (localStorage.getItem(LSK) === '1' && ix) layer(true); }, 3000);
  S.map?.on('styledata', () => { if (localStorage.getItem(LSK) === '1' && ix) setTimeout(() => layer(true), 300); }); S.nycTruck = { load, nearest: (lon, lat) => ix && nearestRoute(ix, lon, lat, 30) }; }

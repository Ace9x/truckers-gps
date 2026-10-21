// Pure trip helpers: IFTA miles by state, tolls, speed limits, lanes, fuel planning, weather, fatigue. All from real route data.
import { haversine } from './logic.js';
const MI = 1609.344;

// edges: [{length(m), along, toll, speed_limit(kph), end_node:{admin_index}}], admins: [{state_code,country_code}]
export function milesByState(edges, admins = []) {
  const out = {};
  for (const e of edges) { const a = admins[e.end_node?.admin_index ?? -1]; const k = a ? (a.state_code || a.country_code) : '??'; out[k] = (out[k] || 0) + (e.length || 0) / MI; }
  for (const k in out) out[k] = Math.round(out[k] * 10) / 10;
  return out;
}
export function tollMiles(edges) { return Math.round(edges.reduce((s, e) => s + (e.toll ? (e.length || 0) : 0), 0) / MI * 10) / 10; }
// Toll segments grouped into contiguous runs with names (so the driver sees WHICH toll roads/bridges)
export function tollSegments(edges) { const runs = []; let cur = null;
  for (const e of edges) { if (e.toll) { if (!cur) { cur = { along: e.along, miles: 0, names: new Set() }; runs.push(cur); } cur.miles += (e.length || 0) / MI; (e.names || []).forEach(n => cur.names.add(n)); } else cur = null; }
  return runs.map(r => ({ along: r.along, miles: Math.round(r.miles * 10) / 10, names: [...r.names].slice(0, 2) })); }

// Posted speed limit (kph from OSM via Valhalla) at a distance along the route
export function limitAt(edges, along) { let lim = null; for (const e of edges) { if (e.along > along) break; if (e.along + (e.length || 0) >= along - 1) lim = e.speed_limit || null; else lim = e.speed_limit ? lim : lim; if (e.along <= along && e.along + (e.length || 0) >= along) return e.speed_limit || null; } return lim; }
export const kphToMph = k => Math.round(k / 1.609344 / 5) * 5 || Math.round(k / 1.609344);
// Effective limit for this truck = min(posted, truck max). Speeding when > limit + tolerance for a while.
export function effectiveLimitMph(postedKph, truckMaxMph) { const p = postedKph ? kphToMph(postedKph) : null; if (p && truckMaxMph) return Math.min(p, truckMaxMph); return p || truckMaxMph || null; }
export function isSpeeding(mph, limitMph, tol = 5) { return !!limitMph && mph > limitMph + tol; }

// OSRM-format steps → [{along-ish location, lanes}] ; lanes rendered as arrows, valid ones highlighted
const LANE_ARROW = { left: '↰', 'slight left': '↖', 'sharp left': '↰', straight: '↑', right: '↱', 'slight right': '↗', 'sharp right': '↱', uturn: '↶', none: '↑' };
export function laneIntersections(osrmRoute) { const out = [];
  for (const leg of osrmRoute?.legs || []) for (const st of leg.steps || []) for (const x of st.intersections || []) if (x.lanes?.length > 1 && x.lanes.some(l => !l.valid)) out.push({ loc: x.location, lanes: x.lanes });
  return out; }
export function lanesHTML(lanes) { return lanes.map(l => `<span class="lane ${l.valid ? 'ok' : ''}">${(l.valid ? [l.valid_indication || l.indications[0]] : l.indications).map(i => LANE_ARROW[i] || '↑').join('')}</span>`).join(''); }

// Fuel plan: given route length (m), fuel stations already snapped {along, off, name}, range in miles, reserve fraction → suggested stops
export function fuelPlan(lengthM, stations, rangeMi, { reserve = 0.25, startFrac = 1 } = {}) {
  const usable = rangeMi * MI * (1 - reserve); const st = stations.filter(s => s.off < 1500).sort((a, b) => a.along - b.along); const stops = [];
  let pos = 0, tank = usable * startFrac;
  while (pos + tank < lengthM) { const cand = st.filter(s => s.along > pos && s.along <= pos + tank); if (!cand.length) { stops.push({ gap: true, along: pos + tank }); break; }
    const pick = cand[cand.length - 1]; stops.push(pick); tank = usable; pos = pick.along; }
  return stops;
}

// NWS alerts (api.weather.gov GeoJSON) → truck-relevant list, dedup by id
const TRUCK_EVENTS = /wind|blizzard|ice|freez|snow|winter|fog|dust|flood|tornado|hurricane|tropical|thunderstorm|avalanche|smoke/i;
export function weatherForTrucks(features = []) { const seen = new Set(), out = [];
  for (const f of features) { const p = f.properties || {}; if (seen.has(p.id || p.event + p.areaDesc)) continue; seen.add(p.id || p.event + p.areaDesc);
    if (!TRUCK_EVENTS.test(p.event || '')) continue; const wind = /wind|blizzard|hurricane|tropical|tornado/i.test(p.event);
    out.push({ event: p.event, severity: p.severity, area: p.areaDesc, ends: p.ends || p.expires, headline: p.headline, highWind: wind, advice: wind ? 'High-profile/empty trailers at risk of blow-over — slow down or wait it out.' : /ice|freez|snow|winter|blizzard/i.test(p.event) ? 'Slick roads: increase following distance, check chain laws on mountain passes.' : /fog|dust|smoke/i.test(p.event) ? 'Low visibility: slow down, lights on.' : 'Use caution.' }); }
  const rank = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 }; return out.sort((a, b) => (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4));
}

// Fatigue: minutes driving since last stop of ≥ 15 min → reminder thresholds every 2 h
export function fatigueDue(continuousMin, remindedAt = 0, every = 120) { const tier = Math.floor(continuousMin / every); return tier > 0 && tier > remindedAt ? tier : 0; }

// Remaining stops (multi-stop): drop stops already reached
export function remainingStops(stops, pos, reachedM = 150) { return stops.filter(s => haversine([s.lon, s.lat], [pos.lon, pos.lat]) > reachedM); }

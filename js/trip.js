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

// Posted speed limit (kph from OSM via Valhalla) on the exact edge at a distance along the route. No carry-over from other edges.
export function edgeAt(edges, along) { let best = null; for (const e of edges) { if (e.along > along + 1) break; if (e.along + (e.length || 0) >= along - 1) best = e; } return best; }
export function limitAt(edges, along) { return edgeAt(edges, along)?.speed_limit || null; }
export const kphToMph = k => Math.round(k / 1.609344 / 5) * 5 || Math.round(k / 1.609344);
// Statutory default limits (mph) when a road has no posted tag: [residential/urban street, other non-limited road, interstate/motorway].
// Shown only as an estimate ("est."); overspeed alerts are never raised on these. Motorway uses the URBAN interstate value (conservative).
// Sources: state statutes cited per row; IIHS "Speed limit laws" table (iihs.org, fetched 2026-10-29); Wikipedia "Speed limits in the United States by jurisdiction".
// "(unverified)" = no statutory default found; value is the common local practice.
export const STATE_DEFAULTS = {
  AL: [30, 55, 70], // Ala. Code 32-5A-171 (30 urban, 55 other); IIHS urban interstate 70
  AK: [25, 55, 55], // 13 AAC 02.275 (25 residential, 55 other); IIHS urban interstate 55
  AZ: [25, 65, 65], // ARS 28-702.04 (25 business/residence, 65 other); IIHS urban interstate 65
  AR: [30, 55, 65], // Ark. Code 27-51-201 (30 urban, 55 other); IIHS urban interstate 65
  CA: [25, 55, 65], // CVC 22352 (25 residence), 22349(b) (55 two-lane); IIHS urban interstate 65
  CO: [30, 55, 65], // CRS 42-4-1101 (30 residential, 55 open highway); IIHS urban interstate 65
  CT: [25, 50, 55], // CT OSTA practice (no statutory urban default) 25; 50 rural undivided; IIHS urban interstate 55
  DE: [25, 50, 55], // 21 Del.C. 4169 (25 urban, 50 two-lane rural); IIHS urban interstate 55
  DC: [20, 25, 55], // DC DDOT 2020 default 20 local / 25 arterial; IIHS urban interstate 55
  FL: [30, 55, 65], // Fla. Stat. 316.183 (30 business/residence, 55 other); IIHS urban interstate 65
  GA: [30, 55, 65], // OCGA 40-6-181 (30 urban, 55 other); IIHS urban interstate 70, Atlanta 65
  HI: [25, 45, 60], // HRS 291C-102 county limits; IIHS other roads 45, interstate 60
  ID: [35, 55, 65], // Idaho Code 49-654 (35 urban district); 55 other; Wikipedia urban freeway 65
  IL: [30, 55, 55], // 625 ILCS 5/11-601 (30 urban district, 55 other); IIHS urban interstate 55
  IN: [30, 55, 55], // IC 9-21-5-2 (30 urban district, 55 other); IIHS urban interstate 55
  IA: [25, 55, 65], // Iowa Code 321.285 (25 residence, 55 other); IIHS urban interstate 65
  KS: [30, 55, 75], // KSA 8-1558 (30 urban district, 55 other); IIHS urban interstate 75
  KY: [35, 55, 65], // KRS 189.390 (35 business district, 55 other, 65 interstate); IIHS
  LA: [25, 55, 70], // LRS 32:61 + parish practice 25 urban (unverified statute); 55 other; IIHS urban interstate 70
  ME: [25, 45, 75], // 29-A MRSA 2074 (25 business/residence, 45 other); IIHS urban interstate 75
  MD: [30, 50, 70], // Md. Transp. 21-801.1 (30 business/residence, 50 undivided); IIHS urban interstate 70
  MA: [30, 40, 65], // MGL c.90 s.17 (30 thickly settled, 40 other); IIHS urban interstate 65
  MI: [25, 55, 70], // MCL 257.627 (25 business/residence, 55 other); IIHS urban interstate 70
  MN: [30, 55, 65], // Minn. Stat. 169.14 (30 urban district, 55 other); IIHS urban interstate 65
  MS: [25, 55, 70], // Miss. Code 63-3-501 / municipal practice 25 (unverified); 55 other; IIHS urban interstate 70
  MO: [25, 55, 60], // RSMo 304.010 municipal practice 25 (unverified); 55 other; IIHS urban interstate 60
  MT: [25, 65, 65], // MCA 61-8-310 (25 urban district), 61-8-303 (70 day/65 night other); IIHS urban interstate 65
  NE: [25, 55, 70], // Neb. Rev. Stat. 60-6,186 (25 residence, 55 other); IIHS urban interstate 70
  NV: [25, 55, 65], // NRS 484B.600 basic rule, local 25 residential (unverified); 55 other; IIHS urban interstate 65
  NH: [30, 55, 65], // RSA 265:60 (30 urban residence, 55 other); IIHS urban interstate 65
  NJ: [25, 50, 55], // NJSA 39:4-98 (25 business/residence, 50 other, 55 interstate unposted)
  NM: [25, 55, 65], // NMSA 66-7-301 (55 other); local 25 residential (unverified); IIHS other ltd 65
  NY: [30, 55, 55], // NY VTL 1180(b) (55 unless posted incl. expressways), VTL 1643 cities/villages commonly 30; NYC 25 handled separately (VTL 1642)
  NC: [35, 55, 65], // NCGS 20-141 (35 municipal, 55 other); Wikipedia urban freeways 65
  ND: [25, 55, 75], // NDCC 39-09-02 (25 urban district, 55 gravel/other); IIHS urban interstate 75
  OH: [25, 55, 65], // ORC 4511.21 (25 municipal, 55 other, 65 urban freeway)
  OK: [25, 65, 70], // 47 OS 11-801 (25 urban district); 65 other state roads; IIHS urban interstate 70
  OR: [25, 55, 55], // ORS 811.111 (25 residence district, 55 other, 55 urban interstate); IIHS
  PA: [25, 55, 70], // 75 Pa.C.S. 3362 (25 urban/residence, 55 other); IIHS urban interstate 70
  RI: [25, 50, 55], // RIGL 31-14-2 (25 business/residence, 50 day other); IIHS urban interstate 55
  SC: [30, 55, 60], // SC Code 56-5-1520 (30 urban, 55 other); Wikipedia urban interstate 60
  SD: [25, 55, 80], // SDCL 32-25 local practice 25 (unverified); 55 other; IIHS urban interstate 80
  TN: [30, 55, 70], // TCA 55-8-152 (urban per municipal ordinance, commonly 30 - unverified); 55 other; IIHS urban interstate 70
  TX: [30, 60, 70], // Tex. Transp. Code 545.352 (30 urban district, 60 non-state rural, 70 state highway)
  UT: [25, 55, 70], // UCA 41-6a-603 (25 urban district, 55 other); IIHS urban interstate 70
  VT: [25, 50, 55], // 23 VSA 1081 (50 other); local 25 (unverified); IIHS urban interstate 55
  VA: [25, 55, 55], // Va. Code 46.2-874 (25 business/residence), 46.2-870 (55 default incl. interstate)
  WA: [25, 50, 60], // RCW 46.61.400 (25 city streets, 50 county roads, 60 state highways); IIHS urban interstate 60
  WV: [25, 55, 55], // WV Code 17C-6-1 (25 business/residence, 55 other); IIHS urban interstate 55
  WI: [25, 55, 55], // Wis. Stat. 346.57(4) (25 urban, 55 other, freeway default 55 without signs)
  WY: [30, 70, 75], // WS 31-5-301 (30 urban/residential, 70 other paved); IIHS urban interstate 75
  PR: [25, 45, 55], // PR Law 22-2000 Art. 6.01 (25 residential, 45 rural); 55 expressways (Wikipedia)
};
export const inNYC = (lon, lat) => lat > 40.495 && lat < 40.917 && lon > -74.259 && lon < -73.70 && !(lon < -74.05 && lat > 40.65); // 5 boroughs (excludes Hudson/NJ side)
// Default when untagged. NYC: 25 on every street unless posted (VTL §1642), 50 on untagged expressways.
export function defaultLimitMph(roadClass, state, pt) { const rc = String(roadClass || ''), nyc = pt && inNYC(pt[0], pt[1]);
  if (nyc) return /motorway/.test(rc) ? 50 : 25;
  const d = STATE_DEFAULTS[state] || [25, 55, 55];
  if (/motorway/.test(rc)) return d[2]; if (/trunk|primary|secondary/.test(rc)) return d[1]; if (/tertiary/.test(rc)) return Math.min(d[1], 45); return d[0]; }
// Always returns a limit: {mph, est, src}. Tagged posted value wins; else statutory default for road class + place. Truck max caps both.
export function limitInfo(edges, along, admins, pt, truckMaxMph) { const e = edgeAt(edges || [], along);
  const state = e && admins?.[e.end_node?.admin_index]?.state_code;
  let mph, est = false, src = 'posted'; if (e?.speed_limit) mph = kphToMph(e.speed_limit); else { mph = defaultLimitMph(e?.road_class, state, pt); est = true; src = 'est.'; }
  if (truckMaxMph && truckMaxMph < mph) { mph = truckMaxMph; src = 'truck max'; est = false; }
  return { mph, est, src, state: state || null, roadClass: e?.road_class || null }; }
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

// ===== Fuel prices: EIA weekly regional baseline + driver-reported station prices =====
const PADD = { '1A': 'CT ME MA NH RI VT', '1B': 'DE DC MD NJ NY PA', '1C': 'FL GA NC SC VA WV', '2': 'IL IN IA KS KY MI MN MO NE ND SD OH OK TN WI', '3': 'AL AR LA MS NM TX', '4': 'CO ID MT UT WY', '5': 'AK AZ CA HI NV OR WA' };
export function paddOf(st) { for (const [k, v] of Object.entries(PADD)) if (v.split(' ').includes(st)) return k; return null; }
export function eiaFor(state, eia) { if (!eia?.prices) return null; const p = eia.prices; let v = null, area = 'U.S.';
  if (state === 'CA' && p.CA) { v = p.CA; area = 'California'; } else { const k = paddOf(state); const key = k === '5' ? 'PADD5X' : k ? 'PADD' + k : null; if (key && p[key]) { v = p[key]; area = 'PADD ' + k; } }
  return { price: v ?? p.US, area, week: eia.week }; }
// latest non-expired driver price per station (24 h)
export function latestPrices(reports, now = Date.now(), ttlH = 24) { const out = {}; for (const r of reports) { if (r.type !== 'fuel_price' || !(r.price > 0) || now - r.t > ttlH * 3600e3) continue; if (!out[r.poi] || out[r.poi].t < r.t) out[r.poi] = r; } return out; }
// Rank stations ahead by net savings vs baseline, after the fuel burned on the detour (2× off-route distance) — gallons = how much you'll buy
export function bestFuel(stations, { gallons = 150, mpg = 6.5, baseline }) {
  return stations.filter(s => s.price > 0).map(s => { const detourMi = 2 * (s.off || 0) / 1609.344; const detourCost = detourMi / mpg * s.price;
    const save = baseline ? (baseline - s.price) * gallons - detourCost : -detourCost; return { ...s, detourMi: Math.round(detourMi * 10) / 10, save: Math.round(save) }; })
    .sort((a, b) => b.save - a.save || a.price - b.price);
}
export const ageText = (t, now = Date.now()) => { const m = Math.round((now - t) / 60e3); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

// NWS hourly forecast helpers: the period covering time t, and the top wind speed in a "15 to 25 mph" string
export function periodAt(periods = [], t = Date.now()) { return periods.find(p => Date.parse(p.startTime) <= t && t < Date.parse(p.endTime)) || null; }
export function windMph(s = '') { const n = String(s).match(/\d+/g); return n ? Math.max(...n.map(Number)) : null; }
export function wxRisk(p) { if (!p) return null; const w = windMph(p.windSpeed), f = (p.shortForecast || '').toLowerCase(); if (/freezing|ice|sleet/.test(f)) return 'Ice possible — slow down, extra following distance'; if (/snow|blizzard/.test(f)) return 'Snow — check chain laws'; if (w != null && w >= 30) return `Wind ${w} mph — crosswind risk for high-profile/empty trailers`; if (/thunder/.test(f)) return 'Thunderstorms'; if (/fog/.test(f)) return 'Fog — low visibility'; return null; }

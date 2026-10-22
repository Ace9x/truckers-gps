// Safety layer: parse OSM restriction tags, look-ahead dangers, curves, wrong-road checks, work zones. Pure functions (testable).
import { bearing, haversine } from './logic.js';
const FT = 0.3048, IN = 0.0254, LBS_T = 0.000453592, ST_T = 0.907185;

export function parseLengthM(v) { // maxheight / maxlength / maxwidth → meters
  if (v == null) return null; const s = String(v).trim().toLowerCase(); if (!s || /none|default|below_default|unsigned/.test(s)) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in)?)?$/); if (m) return +m[1] * FT + (m[2] ? +m[2] * IN : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inch|inches))?$/); if (m) return +m[1] * FT + (m[2] ? +m[2] * IN : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:m)?$/); if (m) return +m[1];
  return null;
}
export function parseWeightT(v) { // maxweight → metric tonnes
  if (v == null) return null; const s = String(v).trim().toLowerCase(); let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)$/))) return +m[1] * LBS_T;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:st|short tons?|tons)$/))) return +m[1] * ST_T;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:t|tonnes?|metric tons?)?$/))) return +m[1];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*kg$/))) return +m[1] / 1000;
  return null;
}
export const ftIn = m => { const tin = Math.round(m / IN); return `${Math.floor(tin / 12)} foot ${tin % 12}`.replace(/ 0$/, ''); };
export const ftInShort = m => { const tin = Math.round(m / IN); return `${Math.floor(tin / 12)}'${tin % 12 ? tin % 12 + '"' : ''}`; };

// truck: { heightM, weightT, lengthM, hazmat }. edges: [{along, way_id, max_upward_grade, max_downward_grade, tunnel, length(m), names}], tags: {wayId: {...}}
export function dangersAhead(edges, tags, truck) {
  const out = [], seen = new Set();
  const push = (e, kind, sev, text, short) => { const k = kind + e.way_id; if (seen.has(k)) return; seen.add(k); out.push({ along: e.along, kind, sev, text, short, way: e.way_id }); };
  for (const e of edges) {
    const t = tags[e.way_id] || {};
    const h = parseLengthM(t.maxheight);
    if (h) { const margin = h - truck.heightM; if (margin < 0) push(e, 'height', 'stop', `Low clearance ${ftIn(h)} ahead. Your truck is ${ftIn(truck.heightM)}. Rerouting.`, `Low bridge ${ftInShort(h)} – you're ${ftInShort(truck.heightM)}`);
      else if (margin < 0.31) push(e, 'height', 'warn', `Tight clearance ahead, ${ftIn(h)}. Your truck is ${ftIn(truck.heightM)}.`, `Tight clearance ${ftInShort(h)}`); }
    const w = parseWeightT(t.maxweight);
    if (w && w < truck.weightT) push(e, 'weight', 'stop', `Weight limit ${Math.round(w / LBS_T / 1000)} thousand pounds ahead. You're ${Math.round(truck.weightT / LBS_T / 1000)} thousand. Rerouting.`, `Weight limit ${Math.round(w / LBS_T / 1000)}k lbs`);
    const L = parseLengthM(t.maxlength);
    if (L && L < truck.lengthM) push(e, 'length', 'stop', `Length limit ${Math.round(L / FT)} feet ahead. Your rig is ${Math.round(truck.lengthM / FT)} feet. Rerouting.`, `Length limit ${Math.round(L / FT)} ft`);
    if (truck.hazmat && (t.hazmat === 'no' || t['hazmat:water'] === 'no' || (e.tunnel && /^[BCDE]$/.test(t['hazmat:adr_tunnel_cat'] || t.tunnel_category || '')))) push(e, 'hazmat', 'stop', 'Hazmat restriction ahead. Rerouting.', 'No hazmat');
    if (t.hgv === 'no') push(e, 'notrucks', 'stop', 'No trucks road ahead. Rerouting.', 'No trucks');
    const pk = parkwayBan(e.names || [], t); if (pk) push(e, 'parkway', 'stop', `Trucks are banned on the ${pk}. Rerouting.`, `No trucks: ${pk.replace(/ Parkway$/, ' Pkwy')}`);
    if (e.tunnel) push(e, 'tunnel', h ? 'warn' : 'info', `Tunnel ahead${h ? ', clearance ' + ftIn(h) : ''}.`, `Tunnel${h ? ' ' + ftInShort(h) : ''}`);
    const down = Math.abs(e.max_downward_grade || 0), up = e.max_upward_grade || 0, len = e.length || 0, incl = parseFloat(t.incline);
    if ((down >= 6 && len > 400) || (incl <= -6)) push(e, 'grade', 'warn', `Steep downgrade ahead, about ${Math.round(Math.max(down, -incl || 0))} percent. Gear down, check your brakes.`, `Downgrade ${Math.round(Math.max(down, -incl || 0))}%`);
    else if ((up >= 6 && len > 400) || incl >= 6) push(e, 'grade', 'info', `Steep upgrade ahead, about ${Math.round(Math.max(up, incl || 0))} percent.`, `Upgrade ${Math.round(Math.max(up, incl || 0))}%`);
  }
  return out.sort((a, b) => a.along - b.along);
}

// Sharp curves on the route geometry that are NOT turns (maneuvers): heading change ≥ 55° within 150 m.
export function detectCurves(line, cum, maneuverIdx = [], { minTurn = 55, window = 150 } = {}) {
  const out = [], nearSpan = (i, j) => maneuverIdx.some(m => cum[m] > cum[i] - 80 && cum[m] < cum[j] + 80);
  for (let i = 1, j = 1; i < line.length - 1; i++) {
    while (j < line.length - 1 && cum[j] - cum[i] < window) j++;
    if (j >= line.length - 1 || j <= i) continue;
    const b1 = bearing(line[i - 1], line[i]), b2 = bearing(line[j], line[j + 1]); let d = Math.abs(b2 - b1); if (d > 180) d = 360 - d;
    if (d >= minTurn && !nearSpan(i, j) && (!out.length || cum[i] - out.at(-1).along > 400)) out.push({ along: cum[i], kind: 'curve', sev: 'warn', deg: Math.round(d), text: `Sharp curve ahead. Slow down.`, short: `Sharp curve ${Math.round(d)}°` });
  }
  return out;
}

// Given a Valhalla /locate edge (truck costing) decide whether we're on a road a truck shouldn't be on.
export function wrongRoad(edge, { offRoute = false, nearDest = false } = {}) {
  if (!edge) return null; const e = edge.edge || edge;
  if (e.access && e.access.truck === false) return { sev: 'stop', text: 'Warning: this road is closed to trucks.', short: '⛔ No trucks on this road' };
  const cls = e.classification?.classification || e.road_class, use = e.classification?.use || e.use;
  if (offRoute && !nearDest && /residential|service_other|service/.test(cls || '') && use !== 'ramp') return { sev: 'warn', text: 'Caution: you are on a residential street, off the truck route.', short: '⚠ Residential street – off truck route' };
  if (e.destination_only_hgv && offRoute && !nearDest) return { sev: 'warn', text: 'Trucks: local delivery only on this road.', short: '⚠ Local delivery only' };
  return null;
}

// WZDx v4 feature → work zone / closure record (active now only)
export function wzdxToZones(feed, now = Date.now()) {
  const out = [];
  for (const f of feed.features || []) {
    const p = f.properties || {}, c = p.core_details || {}, s = Date.parse(p.start_date), e = Date.parse(p.end_date);
    if (Number.isFinite(s) && s > now + 3600e3) continue; if (Number.isFinite(e) && e < now) continue;
    const coords = f.geometry?.type === 'Point' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPoint' || f.geometry?.type === 'LineString' ? f.geometry.coordinates : [];
    if (!coords.length) continue;
    const desc = c.description || ''; const full = p.vehicle_impact === 'all-lanes-closed' || /\b(road|roadway|bridge|all lanes|ramp|exit)\b[^.]{0,40}\bclosed\b|\bfull closure\b|\bclosed in both directions\b/i.test(desc);
    out.push({ id: f.id || c.description?.slice(0, 40), coords, closed: full, desc, roads: c.road_names || [], end: p.end_date, source: c.data_source_id || feed.feed_info?.publisher });
  }
  return out;
}

// NY/CT parkway commercial-vehicle bans (NYS VTL §1630 / NYC DOT, CT DOT): name-based, because OSM hgv tags are incomplete. Garden State Pkwy (NJ) allows trucks south of exit 105, so it is not listed.
export const BANNED_PARKWAYS = ['Belt', 'Grand Central', 'Hutchinson River', 'Henry Hudson', 'Cross Island', 'Jackie Robinson', 'Interborough', 'Bronx River', 'Saw Mill River', 'Sprain Brook', 'Taconic State', 'Taconic', 'Southern State', 'Northern State', 'Meadowbrook State', 'Meadowbrook', 'Wantagh State', 'Wantagh', 'Sagtikos State', 'Sagtikos', 'Sunken Meadow State', 'Loop', 'Ocean', 'Laurelton', 'Shore', 'Leif Ericson', 'Mosholu', 'Pelham', 'Pelham Parkway', 'Palisades Interstate', 'Bear Mountain State', 'Merritt'];
const PK_RE = new RegExp(`\\b(${BANNED_PARKWAYS.map(x => x.replace(/ /g, '\\s+')).join('|')})\\s+(State\\s+)?(Parkway|Pkwy)\\b`, 'i');
export function parkwayBan(names, tags = {}) { for (const n of [...names, tags.name || '']) { const m = PK_RE.exec(n || ''); if (m && !/Garden State/i.test(n)) return n.replace(/\bPkwy\b/i, 'Parkway'); } return null; }

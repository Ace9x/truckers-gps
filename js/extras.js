// RigRoute v2.3 — features competitors paywall, free here: speed limits + truck-speed alerts, lane guidance, IFTA miles by state,
// toll roads on route, fuel-stop planner, multi-stop trips, NWS severe weather, runaway ramps, SOS, driving lockout, fatigue reminders, accessibility.
import { snapToRoute, sampleLine, haversine, pointAlong } from './logic.js';
import { eiaFor, latestPrices, bestFuel, ageText } from './trip.js';
import { milesByState, tollMiles, tollSegments, limitAt, effectiveLimitMph, isSpeeding, laneIntersections, lanesHTML, fuelPlan, weatherForTrucks, periodAt, wxRisk, fatigueDue, remainingStops } from './trip.js';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export function init(S, h) {
  const { $, $$, LS, esc, toast, say, map, plan, openPanel, closePanels, alertBanner, mascot, fmtDist, U, MI } = h;
  S.opts = { gallons: 150, mpg: 6.5, bestPrice: false, maxMph: 65, rangeMi: 1200, bigText: false, contrast: false, fatigue: true, lockout: true, ...LS.get('opts', {}) };
  S.stops = LS.get('stops', []);
  const saveOpts = () => { LS.set('opts', S.opts); applyA11y(); };
  const ins = (sel, pos, html) => document.querySelector(sel).insertAdjacentHTML(pos, html);

  // ---------- UI injection ----------
  ins('#speedBox', 'afterend', '<div id="limitSign" class="hidden" title="Speed limit for your truck"><small>LIMIT</small><b id="limitVal">--</b><i id="limitSrc"></i></div>');
  ins('#banner', 'afterend', '<div id="lanes" class="hidden" aria-label="Lane guidance"></div>');
  ins('#sideBtns', 'beforeend', '<button id="sosBtn" class="round sos" title="Emergency SOS" aria-label="Emergency SOS">SOS</button>');
  ins('#routeSummary', 'afterend', `<div id="stopsBox"><h3>Stops</h3><ol id="stopList" class="small"></ol>
    <div class="row"><input id="stopQ" placeholder="Add a stop (address, city)…" autocomplete="off"><button id="stopAdd" class="small-btn">＋ Add stop</button></div><ul id="stopRes" class="small"></ul></div>`);
  ins('#steps', 'beforebegin', `<details id="tripSheet" open><summary><b>📋 Trip sheet</b> — IFTA miles, tolls, fuel plan, weather</summary>
    <div id="iftaBox" class="small muted">Plan a route to see miles by state.</div><div id="tollBox" class="small muted"></div><div id="fuelBox" class="small muted"></div><div id="wxBox" class="small muted"></div>
    <div id="priceBox" class="small muted"></div><label class="chk"><input type="checkbox" id="optBest"> 💲 Best fuel price mode (rank stations ahead by net savings)</label>
    <button id="iftaCsv" class="small-btn" disabled>⬇ IFTA miles (CSV)</button></details>`);
  ins('#truckForm', 'beforeend', `<label>Truck max speed mph<input id="optMax" type="number" min="45" max="85" step="1"></label>
    <label>Fuel range miles (full tank)<input id="optRange" type="number" min="200" max="2500" step="50"></label>
    <label>Gallons per fill-up<input id="optGal" type="number" min="20" max="300" step="10"></label><label>Truck MPG<input id="optMpg" type="number" min="3" max="15" step="0.1"></label>
    <label class="chk"><input type="checkbox" id="optBig"> Large text</label><label class="chk"><input type="checkbox" id="optContrast"> High contrast</label>
    <label class="chk"><input type="checkbox" id="optFatigue"> Drowsy-driving break reminders</label><label class="chk"><input type="checkbox" id="optLock"> Lock typing while moving (voice only)</label>`);
  document.body.insertAdjacentHTML('beforeend', `<section id="sosPanel" class="panel hidden"><div class="phead"><h2>🆘 Emergency</h2><button class="close">✕</button></div>
    <a id="sos911" class="big btnlike danger" href="tel:911">📞 Call 911</a>
    <p id="sosWhere" class="big-where"></p>
    <div class="row"><button id="sosShare" class="big">📤 Share my location</button><a id="sosSms" class="big btnlike" href="#">💬 Text my location</a></div>
    <p class="muted small">Tell the dispatcher your highway, direction, nearest exit/mile marker and that you are in a commercial truck${''} (hazmat placard number if any).</p></section>
    <div id="lockout" class="hidden" role="dialog"><div><h2>🚛 Eyes on the road</h2><p>Typing is locked while the truck is moving.</p>
    <button id="voiceDest" class="primary big">🎤 Say a destination</button><button id="iAmPassenger" class="big">I'm the passenger</button><button id="lockClose" class="small-btn">Close</button></div></div>`);
  const fo = () => { $('#optMax').value = S.opts.maxMph; $('#optRange').value = S.opts.rangeMi; $('#optBig').checked = S.opts.bigText; $('#optContrast').checked = S.opts.contrast; $('#optFatigue').checked = S.opts.fatigue; $('#optLock').checked = S.opts.lockout; $('#optGal').value = S.opts.gallons; $('#optMpg').value = S.opts.mpg; $('#optBest').checked = S.opts.bestPrice; };
  fo();
  for (const [id, k, num] of [['optMax', 'maxMph', 1], ['optRange', 'rangeMi', 1], ['optBig', 'bigText'], ['optContrast', 'contrast'], ['optFatigue', 'fatigue'], ['optLock', 'lockout'], ['optGal', 'gallons', 1], ['optMpg', 'mpg', 1], ['optBest', 'bestPrice']])
    $('#' + id).addEventListener('change', e => { e.stopPropagation(); S.opts[k] = num ? +e.target.value : e.target.checked; saveOpts(); if (k === 'rangeMi' && S.route) renderFuel(); if (['bestPrice', 'gallons', 'mpg'].includes(k)) bestPrice(true); });
  function applyA11y() { document.body.classList.toggle('bigtext', !!S.opts.bigText); document.body.classList.toggle('contrast', !!S.opts.contrast); }
  applyA11y();
  $$('#sosPanel .close').forEach(b => b.onclick = closePanels);

  // ---------- Multi-stop ----------
  function renderStops() { $('#stopList').innerHTML = S.stops.length ? S.stops.map((s, i) => `<li>${esc(s.name)} <button class="small-btn" data-rs="${i}">✕</button></li>`).join('') : '<li class="muted">No extra stops — add pickups, fuel or breaks on the way.</li>';
    $$('[data-rs]').forEach(b => b.onclick = () => { S.stops.splice(+b.dataset.rs, 1); LS.set('stops', S.stops); renderStops(); if (S.dest && S.pos) plan(); }); }
  async function stopSearch() { const q = $('#stopQ').value.trim(); if (q.length < 3) return; const near = S.pos || { lat: 40.81, lon: -73.88 };
    try { const j = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=${near.lat}&lon=${near.lon}`)).json();
      $('#stopRes').innerHTML = ''; for (const f of j.features) { const p = f.properties, li = document.createElement('li'); const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city;
        li.textContent = `${name} — ${[p.city, p.state].filter(Boolean).join(', ')}`; li.onclick = () => addStop({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name }); $('#stopRes').appendChild(li); } }
    catch { $('#stopRes').innerHTML = '<li class="muted">Search unavailable</li>'; } }
  function addStop(s) { S.stops.push(s); LS.set('stops', S.stops); $('#stopRes').innerHTML = ''; $('#stopQ').value = ''; renderStops(); toast('Stop added: ' + s.name); if (S.dest && S.pos) plan(); }
  $('#stopAdd').onclick = stopSearch; $('#stopQ').addEventListener('keydown', e => { if (e.key === 'Enter') stopSearch(); });
  S.addStop = addStop; renderStops();

  // ---------- After route analysis: IFTA, tolls, fuel, weather, lanes, runaway ramps ----------
  S.onRouteAnalyzed = r => { const e = S.edges || [];
    S.ifta = milesByState(e, S.admins); S.tolls = { miles: tollMiles(e), segs: tollSegments(e) };
    const ent = Object.entries(S.ifta).sort((a, b) => b[1] - a[1]);
    $('#iftaBox').innerHTML = ent.length ? `<b>Miles by state (IFTA):</b> ${ent.map(([k, v]) => `${esc(k)} ${v.toFixed(1)}`).join(' · ')}` : 'State miles unavailable (road data server busy).';
    $('#iftaCsv').disabled = !ent.length;
    $('#tollBox').innerHTML = S.tolls.miles ? `<b>💲 Toll roads on route:</b> ${S.tolls.miles} mi — ${S.tolls.segs.map(t => esc(t.names.join(' / ') || 'toll road') + ` (${t.miles} mi)`).join(', ')}. ${S.truck.avoidTolls ? '' : 'Turn on “Avoid tolls” in 🚛 to skip them.'} <i>Dollar amounts vary by axle/E-ZPass and aren't in free data — check the toll authority.</i>` : '<b>💲 No toll roads</b> on this route.';
    renderFuel(); bestPrice(false); loadWeather(r); loadLanes(r); runawayRamps(r); };
  $('#iftaCsv').onclick = () => { const rows = [['state', 'miles'], ...Object.entries(S.ifta || {})]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = `rigroute-ifta-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); };

  function renderFuel() { const r = S.route; if (!r) return; const feats = S.fuelGeo?.features || [];
    const near = []; const bb = r.line.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]);
    for (const f of feats) { const [x, y] = f.geometry.coordinates; if (x < bb[0] - .02 || x > bb[2] + .02 || y < bb[1] - .02 || y > bb[3] + .02) continue; const sn = snapToRoute([x, y], r.line, r.cum, 0); if (sn.dist < 1500) near.push({ along: sn.along, off: sn.dist, name: f.properties.name || 'Diesel', truck: f.properties.truck }); }
    S.fuelNear = near; const plan_ = fuelPlan(r.length, near, S.opts.rangeMi, { reserve: 0.25 }); S.fuelStops = plan_;
    $('#fuelBox').innerHTML = `<b>⛽ Fuel plan</b> (range ${S.opts.rangeMi} mi, keep ¼ tank): ` + (r.length / MI < S.opts.rangeMi * 0.75 ? `no fuel stop needed for ${(r.length / MI).toFixed(0)} mi. ${near.length} diesel stations within 1 mi of route.` : plan_.map(s => s.gap ? `<span class="bad">⚠ no mapped diesel near ${fmtDist(s.along, U())}</span>` : `${esc(s.name)}${s.truck ? ' 🚛' : ''} at ${fmtDist(s.along, U())}`).join(' → ')) + ' <i>Prices are not in free open data — not shown rather than guessed.</i>'; }

  async function loadWeather(r) { const pts = sampleLine(r.line, Math.min(10, Math.max(2, Math.round(r.length / 40000)))); const feats = [];
    await Promise.all(pts.map(async ([lon, lat]) => { try { const j = await (await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(12000) })).json(); feats.push(...(j.features || [])); } catch { S.wxErr = (S.wxErr || 0) + 1; } }));
    if (S.route !== r) return; S.weather = weatherForTrucks(feats); S.wxChecked = pts.length;
    $('#wxBox').innerHTML = S.weather.length ? '<b>🌩 Weather alerts on route (NWS):</b><ul>' + S.weather.map(w => `<li class="${w.severity === 'Severe' || w.severity === 'Extreme' ? 'bad' : ''}"><b>${esc(w.event)}</b> — ${esc(w.area)}<br>${esc(w.advice)}</li>`).join('') + '</ul>'
      : `<b>🌤 No NWS weather warnings</b> along this route right now (${pts.length} points checked${S.wxErr ? ', some checks failed' : ''}).`;
    if (S.weather.length) { const w = S.weather[0]; alertBanner(`🌩 ${w.event} on your route`); say(`Weather alert on your route: ${w.event}. ${w.advice}`, 'danger'); } loadForecast(r); }
  // NWS hourly forecast at the time you reach start / middle / destination (api.weather.gov/points → forecastHourly)
  async function loadForecast(r) { const t0 = Date.now(), at = [[0, 'Start'], [0.5, 'Midway'], [1, 'Destination']].map(([f, n]) => { const p = pointAlong(r.line, r.cum, r.length * f); return { lon: p[0], lat: p[1], t: t0 + r.time * f * 1000, n }; });
    const rows = await Promise.all(at.map(async a => { try { const pt = await (await fetch(`https://api.weather.gov/points/${a.lat.toFixed(4)},${a.lon.toFixed(4)}`, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(12000) })).json();
      const fc = await (await fetch(pt.properties.forecastHourly, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(12000) })).json(); return { ...a, p: periodAt(fc.properties?.periods, a.t) }; } catch { return { ...a, p: null, err: true }; } }));
    if (S.route !== r) return; let fx = $('#wxFc'); if (!fx) { fx = document.createElement('div'); fx.id = 'wxFc'; $('#wxBox').after(fx); }
    const ok = rows.filter(x => x.p); if (!ok.length) { fx.innerHTML = '<span class="muted small">NWS forecast unavailable here (US only, or the service did not answer).</span>'; return; }
    fx.innerHTML = '<b>🌡 Forecast when you get there (NWS):</b><ul>' + rows.map(x => x.p ? `<li class="${wxRisk(x.p) ? 'bad' : ''}"><b>${x.n}</b> ~${new Date(x.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: ${esc(x.p.temperature)}°${esc(x.p.temperatureUnit)}, ${esc(x.p.shortForecast)}, wind ${esc(x.p.windSpeed)} ${esc(x.p.windDirection)}${wxRisk(x.p) ? ' — ⚠ ' + esc(wxRisk(x.p)) : ''}</li>` : `<li class="muted">${x.n}: no forecast</li>`).join('') + '</ul>';
    S.forecast = rows; const bad = ok.find(x => wxRisk(x.p)); if (bad) say(`Weather at ${bad.n.toLowerCase()}: ${wxRisk(bad.p)}.`, 'info'); }

  async function loadLanes(r) { S.lanes = []; S.lanesDone = false; try {
      const locs = [r.line[0], ...S.stops.map(s => [s.lon, s.lat]), r.line.at(-1)].map(([lon, lat]) => ({ lon, lat }));
      const body = { locations: locs, costing: S.costingFor?.() || 'truck', costing_options: S.costingOptions?.() || {}, format: 'osrm', banner_instructions: true };
      const j = await (await fetch(VALHALLA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })).json();
      const ro = j.routes?.[0]; if (!ro || S.route !== r) return;
      S.lanes = laneIntersections(ro).map(x => { const sn = snapToRoute(x.loc, r.line, r.cum, 0); return { ...x, along: sn.along, off: sn.dist }; }).filter(x => x.off < 30).sort((a, b) => a.along - b.along);
    } catch (e) { S.lanesErr = String(e); } finally { if (S.route === r) S.lanesDone = true; } }

  async function runawayRamps(r) { if (!(S.dangers || []).some(d => d.kind === 'grade') && !/(I-70|I-80|I-40|I-5|I-81|I-77|I-68)/.test(JSON.stringify(r.maneuvers.map(m => m.street_names)))) return;
    const pts = sampleLine(r.line, 40).map(([x, y]) => `${y.toFixed(4)},${x.toFixed(4)}`).join(',');
    for (const u of OVERPASS) { try { const res = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(`[out:json][timeout:20];(way[highway=escape](around:800,${pts});node[highway=escape](around:800,${pts}););out center;`), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue; const j = await res.json(); if (S.route !== r) return;
      for (const e of j.elements || []) { const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat; const sn = snapToRoute([lon, lat], r.line, r.cum, 0); if (sn.dist < 400) S.dangers.push({ along: sn.along, kind: 'grade', sev: 'info', text: 'Runaway truck ramp ahead.', short: 'Runaway truck ramp' }); }
      S.dangers.sort((a, b) => a.along - b.along); S.runaway = (j.elements || []).length; return; } catch {} } }

  // ---------- Per-fix: speed limit, speeding, lanes, stops reached, fatigue ----------
  let lastSpeedWarn = 0, moveSince = null, stopSince = null, fatigueTier = 0;
  S.onFixHook = (f, mph) => {
    // speed limit
    let lim = null, posted = null;
    if (S.nav && S.route && S.edges?.length) { posted = limitAt(S.edges, S.along); }
    lim = S.nav ? effectiveLimitMph(posted, S.opts.maxMph) : null; S.limitMph = lim; S.postedKph = posted;
    const sign = $('#limitSign'); if (lim) { sign.classList.remove('hidden'); $('#limitVal').textContent = U() === 'km' ? Math.round(lim * 1.609) : lim; $('#limitSrc').textContent = posted && (Math.round(posted / 1.609344 / 5) * 5) > lim ? 'truck max' : posted ? 'posted' : 'truck max'; } else sign.classList.add('hidden');
    const over = isSpeeding(mph, lim); $('#speedBox').classList.toggle('over', over);
    if (over && Date.now() - lastSpeedWarn > 60000) { lastSpeedWarn = Date.now(); say(`Slow down. Limit ${lim}.`, 'danger'); }
    // lanes: show within 1 km before a lane intersection
    const L = $('#lanes'); const nx = S.nav && (S.lanes || []).find(x => x.along > S.along && x.along - S.along < 1000);
    if (nx) { L.innerHTML = lanesHTML(nx.lanes); L.classList.remove('hidden'); S.laneShown = true; } else L.classList.add('hidden');
    // stops reached
    if (S.nav && S.stops.length) { const rem = remainingStops(S.stops, f); if (rem.length < S.stops.length) { const hit = S.stops.find(s => !rem.includes(s)); S.stops = rem; LS.set('stops', rem); renderStops(); say(`Stop reached: ${hit.name}.`, 'arrive'); toast('Stop reached: ' + hit.name); } }
    // fatigue: continuous moving time; a stop of ≥ 15 min resets
    const now = f.t || Date.now();
    if (mph > 5) { stopSince = null; moveSince ??= now; } else { stopSince ??= now; if (now - stopSince > 15 * 60e3) { moveSince = null; fatigueTier = 0; } }
    if (S.opts.fatigue && moveSince) { const t = fatigueDue((now - moveSince) / 60e3, fatigueTier); S.driveMin = (now - moveSince) / 60e3;
      if (t) { fatigueTier = t; const hrs = 2 * t; say(`You've been driving ${hrs} hours straight. If you feel drowsy, take a break at the next safe spot.`, 'info'); mascot.say(`${hrs} hours rolling! Stretch your legs soon — rest areas are under ⛽.`, 'calm', 9000); alertBanner(`😴 ${hrs} h driving — consider a break`); } }
  };
  S.fatigueState = () => ({ moveSince, fatigueTier });

  // ---------- Driving lockout ----------
  S.lockedOut = () => { if (!S.opts.lockout || S.passenger || !S.nav || (S.pos?.speed || 0) * 2.23694 <= 5) return false; $('#lockout').classList.remove('hidden'); say('Typing is locked while moving. Say a destination, or pull over.', 'info'); return true; };
  $('#lockClose').onclick = () => $('#lockout').classList.add('hidden');
  $('#iAmPassenger').onclick = () => { S.passenger = true; $('#lockout').classList.add('hidden'); setTimeout(() => S.passenger = false, 10 * 60e3); $('#searchBtn').click(); };
  $('#voiceDest').onclick = () => { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { toast('Voice input not supported in this browser — pull over to type'); return; }
    const rec = new SR(); rec.lang = 'en-US'; rec.onresult = async e => { const q = e.results[0][0].transcript; $('#lockout').classList.add('hidden'); toast('Searching: ' + q);
      try { const near = S.pos; const j = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=en&lat=${near.lat}&lon=${near.lon}`)).json(); const f = j.features[0];
        if (!f) { say('No result for ' + q, 'info'); return; } const name = f.properties.name || q; say('Adding stop ' + name, 'info'); addStop({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name }); } catch { say('Search failed', 'info'); } };
    rec.onerror = () => toast('Did not catch that'); rec.start(); say('Where to?', 'info'); };

  // ---------- SOS ----------
  $('#sosBtn').onclick = () => { const p = S.pos; const c = p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : 'unknown';
    const road = S.lastLocate?.[0] || S.route?.maneuvers?.[S.step]?.street_names?.[0] || '';
    const msg = `EMERGENCY - truck driver needs help. Location: ${c}${road ? ' on ' + road : ''}. https://www.openstreetmap.org/?mlat=${p?.lat}&mlon=${p?.lon}#map=17/${p?.lat}/${p?.lon}`; S.sosMsg = msg;
    $('#sosWhere').innerHTML = `<b>Your location:</b> ${esc(c)}${road ? '<br><b>Road:</b> ' + esc(road) : ''}${p?.heading != null ? `<br><b>Heading:</b> ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(p.heading / 45) % 8]}` : ''}`;
    $('#sosSms').href = `sms:?&body=${encodeURIComponent(msg)}`; openPanel('sosPanel'); };
  $('#sosShare').onclick = async () => { try { if (navigator.share) await navigator.share({ title: 'My location', text: S.sosMsg }); else { await navigator.clipboard.writeText(S.sosMsg); toast('Location copied'); } } catch {} };

  // ---------- Fuel prices: EIA weekly regional average (baseline) + driver-reported station prices ----------
  fetch('data/eia-diesel.json', { cache: 'no-cache' }).then(r => r.json()).then(j => { S.eia = j; if (S.route) bestPrice(false); }).catch(() => {});
  const routeState = () => { const e = Object.entries(S.ifta || {}).sort((a, b) => b[1] - a[1])[0]; return e?.[0] || 'US'; };
  S.prices = () => latestPrices(S.reports || []);
  S.priceFor = p => { const lp = S.prices()[p.id]; if (lp) return `<div class="price small">💲 $${lp.price.toFixed(3)} diesel · <i>driver-reported</i> ${S.ageHTML ? S.ageHTML(lp.t, 360) : ageText(lp.t)}</div>`;
    const b = S.eia && eiaFor(routeState(), S.eia); return b ? `<div class="price small muted">💲 no driver price yet · area avg $${b.price.toFixed(3)} (EIA ${esc(b.area)}, week of ${esc(b.week)})</div>` : ''; };
  S.reportPrice = async id => { if (S.lockedOut?.()) return; const v = parseFloat(prompt('Diesel price per gallon at this station (e.g. 5.79)') || ''); if (!(v > 1 && v < 15)) { toast('Price not saved'); return; }
    const p = S.pois.find(x => String(x.id) === String(id)); const r = { id: crypto.randomUUID?.() || String(Math.random()).slice(2), type: 'fuel_price', poi: id, price: Math.round(v * 1000) / 1000, lat: p?.lat, lon: p?.lon, t: Date.now(), up: 0, down: 0, mine: true };
    try { await S.backend?.addReport(r); } catch {} S.reports.push(r); toast(`Thanks! $${v.toFixed(3)} shared with drivers for 24 h`); S.refreshPois?.(); bestPrice(false); return r; };
  function bestPrice(speak) { const box = $('#priceBox'); if (!box || !S.route) return; const b = S.eia && eiaFor(routeState(), S.eia), lp = S.prices(), base = S.nav ? S.along : 0;
    const head = b ? `<b>💲 Diesel baseline:</b> $${b.price.toFixed(3)}/gal — EIA weekly average, ${esc(b.area)}, week of ${esc(b.week)}.` : '<b>💲</b> EIA average unavailable.';
    if (!S.opts.bestPrice) { box.innerHTML = head + ' Turn on Best fuel price mode to rank driver-reported prices ahead.'; return; }
    const st = (S.pois || []).filter(p => (p.kind === 'fuel' || p.kind === 'stop') && p.along > base && lp[p.id]).map(p => ({ ...p, price: lp[p.id].price, t: lp[p.id].t }));
    const ranked = bestFuel(st, { gallons: S.opts.gallons, mpg: S.opts.mpg, baseline: b?.price }); S.bestRanked = ranked;
    box.innerHTML = head + (ranked.length ? '<ol>' + ranked.slice(0, 5).map(s => `<li><b>$${s.price.toFixed(3)}</b> ${esc(s.name)} · ${fmtDist(s.along - base, U())} ahead · detour ${s.detourMi} mi · ${s.save >= 0 ? 'saves ≈$' + s.save : 'costs ≈$' + -s.save} on ${S.opts.gallons} gal <i>(driver-reported ${ageText(s.t)})</i></li>`).join('') + '</ol>'
      : ' <br>No driver-reported prices ahead in the last 24 h — tap 💲 on a station to add one. (No free station-level live price feed exists; we won\'t guess.)');
    if (speak && ranked[0]) { const s = ranked[0], mi = Math.round((s.along - base) / MI); const msg = `Cheapest diesel ahead: $${s.price.toFixed(2)} at ${s.name}, ${mi} miles${s.save > 0 ? `, saves about $${s.save}` : ''}.`; S.lastPriceMsg = msg; say(msg, 'info'); } }
  S.bestPrice = bestPrice;
}

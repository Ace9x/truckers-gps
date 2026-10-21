# RigRoute GPS — free truck GPS for drivers (web app)

**Live app:** https://ace9x.github.io/truckers-gps/ — open on your phone, tap *Share → Add to Home Screen* (iPhone Safari) or *Install app* (Android Chrome).

Built for drivers first: big buttons, night map, voice turn‑by‑turn, and routes that respect **your truck's height, weight, length, width, axles and hazmat**.

## Features
- **Live GPS** (browser Geolocation, high accuracy) with follow mode, heading‑up 3D camera that zooms out with speed, speedometer.
- **Truck‑specific routing** via [Valhalla](https://github.com/valhalla/valhalla) `truck` costing — avoids roads mapped in OpenStreetMap as too low (`maxheight`), too heavy (`maxweight`/axle load), too long/wide, closed to trucks (`hgv=no`) or to hazmat.
- **Turn‑by‑turn** banner with next maneuver, distance, "then" preview, full step list.
- **Voice guidance** (Web Speech API): early "in ½ mile…" and at‑turn prompts, timed to your speed.
- **Automatic reroute** when you leave the route (3 consecutive fixes beyond 60 m + GPS accuracy), respecting your current heading.
- **ETA, time and distance remaining.**
- **Truck vs car comparison** — see when and why the truck route differs.
- **Address search** (Photon/OpenStreetMap, biased to your location; Nominatim fallback), long‑press map to drop a pin.
- **Truck stops, fuel, rest areas, truck parking, weigh stations along your route** from OpenStreetMap (Overpass).
- **HOS helper clock**: 11‑hour drive, 14‑hour window, 30‑min break after 8h driving, 10‑hour reset (incl. off+sleeper). Auto‑switches to Driving above 5 mph during navigation, back to On‑duty after 5 min stopped. Spoken + on‑screen warnings. **Not an ELD.**
- **Load / trip card**: load #, BOL #, pickup/delivery + appointments, dispatcher phone (tap to call), notes; "Navigate to pickup/delivery". Stored only on the phone.
- **Truck presets**: 53' dry van 80k, 26' box truck, bobtail. Miles/km. Night/day map.
- **Demo drive**: simulates GPS along the planned route so you can see it work while parked.
- **PWA**: installable, works in portrait and landscape, screen stays awake while navigating, app shell + already‑viewed map tiles cached; an active route keeps navigating with no signal (reroute/search need data).


## New in v2 (RigRoute GPS)
- **Route options (up to 3)** with a "why this route" line (fastest / shortest / fewest turns / tolls / vs car). The route you pick is **locked**: reroutes rejoin *your* route via through‑points instead of snapping back to route #1.
- **Ferrostar‑style off‑route detection**: fixes worse than 30 m accuracy are ignored; 3 bad fixes > 50 m needed; steps don't advance while off route. Reroute falls back to a wider snap radius so it can get you out of lots and driveways.
- **Valhalla truck tuning**: `use_truck_route 0.8`, `low_class_penalty 60`, axle load/count.
- **Report a restriction** (low clearance, no trucks, weight limit, closed, hazard, police, scale open/closed). Restrictions are avoided **immediately** (`exclude_polygons`) and kept on the phone.
- **Look‑ahead dangers**: the planned route is matched to road segments (Valhalla `trace_attributes`) and checked against OSM `maxheight/maxweight/maxlength/hazmat/hgv` (built‑in US‑Northeast extract of 45k restricted roads, live OSM elsewhere), steep grades and sharp curves. Spoken at 2 mi and ½ mi against *your* truck ("Low clearance 11 foot 8 ahead. Your truck is 13 foot 6. Rerouting.") and auto‑rerouted if you don't fit.
- **Wrong‑road warning**: every 10 s the app checks the road you're on; a truck‑banned road (e.g. NY parkways) or a residential street off the route triggers a red banner plus voice.
- **Official closures / work zones**: NJ WZDx feed (NJDOT/TRANSCOM via NJIT, free, no key), refreshed every 30 min by GitHub Actions (the feed blocks browser CORS). Full closures are avoided in routing. 511NY and PennDOT need keys or registration, so they aren't included.
- **Fuel**: 2,400+ diesel and truck‑stop stations on the map (OSM), a filter for stops on the route (All / Diesel / Truck lanes / Scales / Rest), and the detour minutes for each stop ahead.
- **Weigh stations**: spoken alerts at 2 mi and 1 mi, open/closed status from driver reports, and an "Avoid scales" toggle (you must still stop when required). PrePass/Drivewyze bypass status isn't available to third‑party apps, so it isn't shown.
- **Last‑mile facility mode**: under 3 mi from the destination you get the facility card, a satellite view (Esri World Imagery), a truck‑entrance pin (later routes go to the gate) and driver notes for the facility.
- **Exit prompts at 2 mi, 1 mi and ¼ mi**, a bigger high‑contrast banner, and a dim night theme.
- **Offline**: tiles along the route are saved automatically when you start navigating (or tap "Save route map"). Navigation resumes after a crash or reload. GPS drops to battery saver after 3 min parked.
- **HOS**: 11 h / 14 h / 30‑min break plus the **70 h/8‑day (or 60/7) cycle with 34 h restart**. Still a helper, not an ELD.
- **Driver types**: OTR / Local / Owner‑Op / Fleet presets. Also a **Hazmat** quick toggle, a **HUD** mode (mirrored, to reflect on the windshield) and **map layer toggles**.
- **Voices**: pick any device voice plus speed and pitch, with personalities (Standard, Calm co‑pilot, Old‑school trucker, NYC dispatcher) and a preview button. Road names are read naturally ("I 278 W" → "Interstate 278 West", "NJ Tpke" → "New Jersey Turnpike").
- **Coney the co‑pilot**: an original animated cone mascot with tips, cheers and reactions. It hides whenever a turn is under 600 m away and can be switched off.
- **Garage**: original cartoon vehicles (semi, box, flatbed, tanker, reefer, pickup, sedan, taxi) in 9 colors. Some unlock as you level up.
- **Community & points** (Waze‑style): reports with 👍 Still there / 👎 Not there, points for miles, confirmed reports, on‑time arrivals, HOS breaks taken early and smooth trips (no hard braking, judged from GPS speed), plus levels, badges, streaks, a weekly leaderboard and a profile with a truck avatar and mood.
- **Accounts**: email magic link with an optional phone code, using a Supabase adapter (`js/config.js` + `supabase/schema.sql`). Until it's configured, everything stays on the phone and the leaderboard shows only you. No fake users.

### Data files
`data/truck-pois-northeast.geojson` (truck stops, rest areas, scales, truck parking), `data/diesel-northeast.geojson`, `data/restrictions-northeast.json` (way id → restriction tags) — © OpenStreetMap contributors (ODbL), extracted Oct 2026. `data/closures.geojson` is rebuilt by `scripts/build-closures.mjs` in CI.

## Data sources (all free, no API keys)
| What | Service | Notes |
|---|---|---|
| Map tiles | [OpenFreeMap](https://openfreemap.org) | © OpenStreetMap contributors |
| Routing | [FOSSGIS Valhalla](https://valhalla1.openstreetmap.de) | Public demo server, fair use |
| Search | [Photon](https://photon.komoot.io) / [Nominatim](https://nominatim.org) | Debounced, ≤1 req/s |
| POIs / restrictions | [Overpass API](https://overpass-api.de) + built‑in extracts | Cached per route, mirrors, 5‑min back‑off when busy |
| Closures | [NJ WZDx (NJIT)](https://smartworkzones.njit.edu/nj/wzdx) | CI refresh every 30 min |
| Satellite | Esri World Imagery | attribution shown |

## Honest limits
- Truck restrictions are only as good as **OpenStreetMap tags**. Unmapped low bridges won't be avoided, and an over‑strict tag can cause a detour (e.g. OSM currently tags the GWB upper level `maxweight=50000 lbs`, so an 80k‑lb profile is routed around it). **Always obey posted signs.**
- The public routing / POI servers are shared, rate‑limited and can be busy; for a whole fleet, self‑host Valhalla + Overpass (both open source).
- No live traffic. HOS clock is a personal helper, **not an ELD** and not a legal record of duty status.
- iPhone: keep the app on screen; browsers pause GPS in the background.

## Develop / test
```
npm install
npm test                     # unit tests: routing math, off-route, HOS rules, Valhalla options
python3 -m http.server 8765 & npm run e2e        # headless Chromium E2E w/ simulated GPS
BASE=https://ace9x.github.io/truckers-gps/ npm run e2e   # against the live site
```
The E2E test drives a simulated truck from Hunts Point (Bronx) toward Port Newark (NJ), checks the route draws, steps advance, voice prompts fire, auto‑reroute triggers off‑route, and that a 13'6" truck is routed around Durham NC's famous 11'8" Gregson St bridge while a car goes under it.

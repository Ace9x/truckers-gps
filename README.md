# Mitchell's TruckNav — free truck GPS for drivers (web app)

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

## Data sources (all free, no API keys)
| What | Service | Notes |
|---|---|---|
| Map tiles | [OpenFreeMap](https://openfreemap.org) | © OpenStreetMap contributors |
| Routing | [FOSSGIS Valhalla](https://valhalla1.openstreetmap.de) | Public demo server, fair use |
| Search | [Photon](https://photon.komoot.io) / [Nominatim](https://nominatim.org) | Debounced, ≤1 req/s |
| POIs | [Overpass API](https://overpass-api.de) | Cached per route, mirrors + back‑off |

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

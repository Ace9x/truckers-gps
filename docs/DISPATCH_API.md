# RigRoute Dispatch API v1

Lets any dispatch system (our own `dispatch.html` test console today, a full dispatcher app later) talk to the RigRoute GPS driver app.
Reference implementation: `js/dispatch.js` (both sides), `js/link.js` (transport).

## Transport
- **Today (free):** public Nostr relays (`wss://nos.lol`, `wss://relay.primal.net`, `wss://nostr.mom`, `wss://relay.damus.io`). Every message is a Nostr event
  of kind `7534` with tags `["t", <channel tag>]` and `["expiration", <unix s>]` (NIP-40, 30 days for loads/status, 1 day for pairing and location).
- `content` = base64(`iv(12) ‖ AES-256-GCM(JSON envelope)`). Relays only see ciphertext and a hashed tag. Messages are stored, so a driver who was
  offline catches up when they come back; both sides dedupe by `id` and rebuild state with `fold()` (ordered by `t`).
- **Later (Supabase):** the same envelopes become rows in `dispatch_messages(channel, sender, body jsonb, t)` with Realtime subscriptions; nothing in the schema changes.

### Envelope (every message)
```json
{ "id": "a1b2c3d4e5f60718", "t": 1761083000000, "type": "<type>", "...": "type-specific fields" }
```
`t` is the sender's clock, in ms. `id` is 16 hex characters and unique.

## 1. Pairing (dispatcher shows a code or QR, driver enters it)
1. Dispatcher generates a code `XXXX-XXXX` (31-symbol alphabet with no 0/O/1/I/L, about 40 bits). It's valid for **15 min** and works for **one driver**.
   QR = `https://ace9x.github.io/truckers-gps/?pair=XXXX-XXXX` (opens the app's Loads panel with the code filled in).
2. Pair channel: `tag = SHA256("rigroute-pair-v1|" + code)`, `key = HKDF(PBKDF2(code, "rigroute-pair", 60000))`.
3. Driver → `pair_request`: `{ "driverPk": "<hex>", "driver": { "name", "username", "truck": { ... } } }`
4. Dispatcher → `pair_accept`: `{ "session": "<64 hex random>", "driverPk": "<echo>", "dispatcher": { "name", "pk" } }`
5. From then on both sides use the **session channel**: `tag = SHA256("rigroute-ch-v1|dispatch|" + session)`, `key = HKDF(session, "dispatch")`.
   The code is worthless after this step. Either side may send `unpair`.

## 2. Load / contract (dispatcher → driver)
```json
{ "type": "load", "load": {
  "id": "L-7F3A21",                 "ref": "PO-55821",
  "pickup": { "name": "Hunts Point Produce Market", "address": "355 Food Center Dr, Bronx, NY 10474", "lat": 40.8085, "lon": -73.874,
              "window": { "start": "2026-10-22T04:00:00Z", "end": "2026-10-22T06:00:00Z" }, "contact": "optional", "ref": "optional pickup #" },
  "stops": [ { "...same as pickup...": "optional extra stops, in order" } ],
  "drop":   { "name": "Port Newark Terminal", "address": "1 Export St, Newark, NJ 07114", "lat": 40.693, "lon": -74.152, "window": { "start": "…", "end": "…" } },
  "rate": { "amount": 850, "currency": "USD", "per": "flat | mile" },
  "commodity": "Fresh produce", "weight_lb": 38000, "equipment": "53' reefer",
  "hazmat": { "is": true, "class": "3", "un": "UN1203" },
  "bol": ["BOL-77812"], "notes": "Check in at gate 3"
} }
```
Required: `id`, `pickup` and `drop` (each with `address`, `lat`, `lon`). If `hazmat.is` is true, `hazmat.class` is required too. Sending the same `id` again replaces the load (an amendment).
The dispatcher can send `{ "type": "cancel", "loadId" }`.

## 3. Driver responses
```json
{ "type": "response", "loadId": "L-7F3A21", "action": "accept" }
{ "type": "response", "loadId": "L-7F3A21", "action": "decline", "reason": "Out of hours" }
{ "type": "response", "loadId": "L-7F3A21", "action": "counter", "counter": { "amount": 950, "currency": "USD" } }
```
The dispatcher answers a counter with `{ "type": "counter_reply", "loadId", "accept": true|false }`.

## 4. Status updates (driver → dispatcher)
`{ "type": "status", "loadId", "status": "<s>", "lat"?, "lon"?, "pod"?: { "photo": "data:image/jpeg;base64,…", "at": ms } }`

The statuses, in order, are `en_route_pickup → arrived_pickup → loaded → en_route_drop → arrived_drop → delivered`.
A POD photo goes with `delivered`. It's shrunk to 480 px and JPEG 0.6, which keeps it around 20–40 KB so it fits relay size limits.
Load state = `offered | accepted | declined | countered | cancelled | <status>`, computed by `fold(messages)`.

## 5. Live location (opt-in, driver → dispatcher)
- `{ "type": "share", "on": true|false }` is sent when the driver flips the toggle. It's off by default.
- `{ "type": "location", "lat", "lon", "heading", "speed" }` is sent every 30 s while sharing is on, rounded to 5 decimals (about 1 m), with a 1-day expiry.

## Security notes
- Everything is end-to-end encrypted. Relays can't read loads, rates, locations or names.
- The pairing code is short-lived and single-use. Anyone who overhears it within those 15 min could pair instead of the driver, but the dispatcher would see an unexpected driver name.
- Events are Nostr-signed by the sender's key (the driver's account key, or a device key in guest mode).
- **Supabase adds:** server-verified identities, row-level security per carrier, audit history and a hosted dispatcher web app.

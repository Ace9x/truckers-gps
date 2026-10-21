// Server (Supabase ace-platform) round-trip: node test/supabase-roundtrip.mjs run   (needs ws + @supabase/supabase-js: npm i --no-save ws @supabase/supabase-js)
// Integration test against ace-platform (public publishable key only).
// Phase "signup": creates driver + dispatcher test users through the normal signUp API.
// Phase "run": signs in, hazard create/confirm/abuse, friend request/accept + live location visibility, load offer->accept->in_transit->delivered (with realtime), taxi booking fare, RLS denials, then deletes its rows.
import { createClient } from '@supabase/supabase-js'; import WebSocket from 'ws'; import fs from 'fs'; import assert from 'node:assert/strict';
const CFG = fs.readFileSync(new globalThis.URL('../js/config.js', import.meta.url), 'utf8'); const URL = CFG.match(/url: '([^']+)'/)[1], KEY = CFG.match(/anonKey: '([^']+)'/)[1];
const mk = () => createClient(URL, KEY, { realtime: { transport: WebSocket }, auth: { persistSession: false } });
// Test accounts (email-confirmed, passwords kept OUTSIDE the repo): RR_TEST_USERS=/path/testusers.json
const S = process.env.RR_TEST_USERS || '/workspace/.rr-secrets/testusers.json';
const phase = process.argv[2];
if (phase === 'signup') {
  const pw = () => 'T3st-' + crypto.randomUUID();
  const users = { driver: { email: 'tuprimo6+rr-test-driver2@gmail.com', password: pw() }, dispatcher: { email: 'tuprimo6+rr-test-dispatch@gmail.com', password: pw() } };
  for (const [role, u] of Object.entries(users)) { const { data, error } = await mk().auth.signUp({ ...u, options: { data: { display_name: 'RR Test ' + role, role } } }); if (error) throw error; u.id = data.user.id; console.log('signed up', role, 'session:', !!data.session); }
  fs.writeFileSync(S, JSON.stringify(users)); process.exit(0);
}
const users = JSON.parse(fs.readFileSync(S)); const ok = (n) => console.log('PASS', n);
const D = mk(), X = mk(), anon = mk();
for (const [c, u] of [[D, users.driver], [X, users.dispatcher]]) { const { error } = await c.auth.signInWithPassword(u); if (error) throw error; }
ok('sign in (email+password)');
const clean = async () => { await X.from('friendships').delete().or(`requester.eq.${users.driver.id},addressee.eq.${users.driver.id}`); await X.from('loads').delete().eq('dispatcher', users.dispatcher.id);
  await D.from('hazards').delete().eq('reporter', users.driver.id); await D.from('shared_routes').delete().eq('owner', users.driver.id); await D.from('live_locations').delete().eq('user_id', users.driver.id);
  await D.from('taxi_bookings').update({ status: 'cancelled_rider' }).eq('rider', users.driver.id).eq('status', 'requested'); };
await clean();
const { data: pD } = await D.from('profiles').select('role,display_name').eq('id', users.driver.id).single(); assert.equal(pD.role, 'driver');
const { data: pX } = await X.from('profiles').select('role').eq('id', users.dispatcher.id).single(); assert.equal(pX.role, 'dispatcher'); ok('profiles auto-created with roles');
const esc = await D.from('profiles').update({ role: 'admin' }).eq('id', users.driver.id); assert.ok(esc.error, 'role escalation must fail'); ok('cannot self-promote to admin');
await D.from('profiles').update({ truck: { height_ft: 13.5, weight_lb: 80000, length_ft: 72, hazmat: false } }).eq('id', users.driver.id);
// hazards
const { data: h, error: he } = await D.from('hazards').insert({ type: 'police', lat: 40.6, lng: -73.75, note: 'test hazard' }).select().single(); if (he) throw he;
const { data: seen } = await anon.from('hazards').select('id').eq('id', h.id); assert.equal(seen.length, 1); ok('hazard created, visible to public map');
const { data: v } = await X.rpc('vote_hazard', { p_hazard_id: h.id, p_dir: 'up' }); assert.equal(v.confirmations, 1); ok('hazard confirmation counted');
const self = await D.rpc('vote_hazard', { p_hazard_id: h.id, p_dir: 'up' }); assert.equal(self.data.confirmations, 1); ok('cannot confirm own hazard');
const ab = await X.rpc('report_hazard_abuse', { p_hazard_id: h.id, p_reason: 'test' }); assert.ok(!ab.error); ok('abuse report accepted');
const tamper = await X.from('hazards').update({ confirmations: 99 }).eq('id', h.id).select(); assert.equal(tamper.data?.length || 0, 0); ok('non-owner cannot edit hazard');
const anonIns = await anon.from('hazards').insert({ type: 'x', lat: 1, lng: 1 }); assert.ok(anonIns.error); ok('anonymous cannot post hazard');
// friends + live location
const { data: loc0 } = await D.from('live_locations').upsert({ user_id: users.driver.id, lat: 40.61, lng: -73.76, heading: 90 }).select(); assert.equal(loc0.length, 1);
let { data: before } = await X.from('live_locations').select('*').eq('user_id', users.driver.id); assert.equal(before.length, 0); ok('location hidden from non-friend');
const { data: fr } = await X.from('friendships').insert({ addressee: users.driver.id }).select().single();
const selfAccept = await X.rpc('respond_friend', { p_id: fr.id, p_action: 'accept' }); assert.ok(selfAccept.error); ok('requester cannot self-accept');
const acc = await D.rpc('respond_friend', { p_id: fr.id, p_action: 'accept' }); assert.equal(acc.data.status, 'accepted');
let { data: after } = await X.from('live_locations').select('*').eq('user_id', users.driver.id); assert.equal(after.length, 1); ok('friend accepted -> location visible');
await D.from('shared_routes').insert({ name: 'test', geometry: { type: 'LineString', coordinates: [[-73.7, 40.6], [-74, 40.7]] } });
const { data: rts } = await X.from('shared_routes').select('id').eq('owner', users.driver.id); assert.equal(rts.length, 1); ok('shared route visible to friend');
// loads round trip with realtime
await D.realtime.setAuth(); const got = []; const ch = D.channel('loads-test').on('postgres_changes', { event: '*', schema: 'public', table: 'loads', filter: 'driver=eq.' + users.driver.id }, p => got.push(p.new?.status));
await new Promise(r => ch.subscribe(s => s === 'SUBSCRIBED' && r()));
const drvLoad = await D.from('loads').insert({ driver: users.driver.id, pickup_address: 'a', dropoff_address: 'b' }); assert.ok(drvLoad.error); ok('driver cannot create loads');
const { data: L, error: le } = await X.from('loads').insert({ driver: users.driver.id, ref: 'TEST-1', pickup_address: 'Port Newark, NJ', dropoff_address: 'Hunts Point, Bronx, NY', rate_usd: 650 }).select().single(); if (le) throw le;
const { data: inbox } = await D.from('loads').select('*').eq('status', 'offered'); assert.ok(inbox.some(l => l.id === L.id)); ok('load offered -> in driver inbox');
const bad = await D.rpc('driver_update_load', { p_id: L.id, p_status: 'delivered' }); assert.ok(bad.error); ok('invalid status jump rejected');
for (const s of ['accepted', 'in_transit', 'delivered']) { const r = await D.rpc('driver_update_load', { p_id: L.id, p_status: s }); assert.equal(r.data.status, s); }
const { data: Lx } = await X.from('loads').select('status').eq('id', L.id).single(); assert.equal(Lx.status, 'delivered'); ok('load accepted -> in_transit -> delivered, dispatcher sees it');
await new Promise(r => setTimeout(r, 3000)); console.log('realtime events:', got.join(',')); assert.ok(got.length >= 1); ok('realtime load updates delivered'); await D.removeChannel(ch);
// taxi
const { data: tb } = await D.from('taxi_bookings').insert({ pickup_address: 'Far Rockaway', dropoff_address: 'Jamaica', est_miles: 6, est_minutes: 20, payment_method: 'zelle' }).select().single(); assert.equal(Number(tb.fare_estimate), 26.5);
const { data: jfk } = await D.from('taxi_bookings').insert({ pickup_address: 'Far Rockaway', dropoff_address: 'JFK', est_miles: 9, est_minutes: 25, flat_rate: 'JFK', payment_method: 'cash' }).select().single(); assert.equal(Number(jfk.fare_estimate), 75);
const { data: mn } = await D.from('taxi_bookings').insert({ pickup_address: 'a', dropoff_address: 'b', est_miles: 0.5, est_minutes: 2 }).select().single(); assert.equal(Number(mn.fare_estimate), 10); ok('taxi fares: metered 26.50, JFK flat 75, minimum 10');
const { data: q } = await X.from('taxi_bookings').select('id').in('id', [tb.id, jfk.id]); assert.equal(q.length, 2); ok('dispatcher sees ride queue');
const asg = await X.from('taxi_bookings').update({ status: 'assigned', assigned_driver: users.driver.id }).eq('id', tb.id).select().single(); assert.equal(asg.data.status, 'assigned'); ok('dispatcher assigns driver');
const { data: anonQ } = await anon.from('taxi_bookings').select('id'); assert.equal(anonQ.length, 0); ok('bookings hidden from public');
// Dispatch API v1 envelopes over dispatch_messages
const chan = 'test' + crypto.randomUUID().replace(/-/g, '');
assert.ok((await X.from('dispatch_messages').insert({ channel: chan, body: { type: 'load' } })).error, 'must join first'); 
await X.from('dispatch_channel_members').insert({ channel: chan }); await D.from('dispatch_channel_members').insert({ channel: chan });
await X.from('dispatch_messages').insert({ channel: chan, body: { id: 'x1', t: Date.now(), type: 'load' } });
const { data: dm } = await D.from('dispatch_messages').select('body').eq('channel', chan); assert.equal(dm.length, 1);
const { data: outsider } = await anon.from('dispatch_messages').select('id').eq('channel', chan); assert.equal(outsider.length, 0); ok('dispatch_messages: members only');
await X.from('dispatch_channel_members').delete().eq('channel', chan); await D.from('dispatch_channel_members').delete().eq('channel', chan);
const { data: dv } = await X.from('drivers').select('id').eq('id', users.driver.id); assert.equal(dv.length, 1); ok('drivers view');
// cleanup rows (users are removed afterwards by the operator)
await X.from('loads').delete().eq('id', L.id); await D.from('taxi_bookings').update({ status: 'cancelled_rider' }).in('id', [jfk.id, mn.id]);
await D.from('hazards').delete().eq('id', h.id); await D.from('shared_routes').delete().eq('owner', users.driver.id); await D.from('live_locations').delete().eq('user_id', users.driver.id);
await X.from('friendships').delete().eq('id', fr.id); ok('test rows cleaned'); process.exit(0);

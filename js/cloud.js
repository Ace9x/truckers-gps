// RigRoute ⇄ Supabase (ace-platform). One shared client per page. Everything here is optional: if the server is unreachable,
// callers fall back to the free Nostr-relay features (friends, dispatch, hazards) that already work without it.
let _sb = null, _cfg;
export async function sb() { if (_sb) return _sb; if (_cfg === undefined) { try { _cfg = (await import('./config.js')).SUPABASE; } catch { _cfg = null; } }
  if (!_cfg?.url || !_cfg?.anonKey) return null; const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.4');
  _sb = createClient(_cfg.url, _cfg.anonKey, { auth: { persistSession: true, storageKey: 'rr-sb-auth' } }); return _sb; }
export async function uid() { const c = await sb(); if (!c) return null; const { data } = await c.auth.getSession(); return data.session?.user?.id || null; }
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ---- hazards (row <-> app report shape)
export const toReport = h => ({ id: h.id, type: h.type, lat: h.lat, lon: h.lng, note: h.note, poi: h.poi, price: h.price, key: h.key, val: h.val, t: Date.parse(h.created_at), expires: Date.parse(h.expires_at), up: h.confirmations, down: h.dismissals, user_id: h.reporter, server: true });
export const toRow = r => ({ id: r.id, type: r.type, lat: r.lat, lng: r.lon, note: r.note ?? null, poi: r.poi ?? null, price: r.price ?? null, key: r.key ?? null, val: r.val ?? null });

// ---- friends
export async function friendsList() { const c = await sb(), me = await uid(); if (!me) return { friends: [], incoming: [], outgoing: [] };
  const rows = must(await c.from('friendships').select('*').order('created_at', { ascending: false }));
  const ids = [...new Set(rows.map(r => r.requester === me ? r.addressee : r.requester))];
  const profs = ids.length ? must(await c.rpc('peer_profiles', { p_ids: ids })) : []; const P = Object.fromEntries(profs.map(p => [p.id, { ...p, truck: { vehicle: p.vehicle } }]));
  const wrap = r => { const other = r.requester === me ? r.addressee : r.requester; return { ...r, other, name: P[other]?.display_name || 'Driver', username: P[other]?.username || '', truck: P[other]?.truck || {} }; };
  const all = rows.map(wrap);
  return { friends: all.filter(r => r.status === 'accepted'), incoming: all.filter(r => r.status === 'pending' && r.addressee === me), outgoing: all.filter(r => r.status === 'pending' && r.requester === me), blocked: all.filter(r => r.status === 'blocked') }; }
export async function friendRequest(q) { const c = await sb(); const found = must(await c.rpc('find_user', { p_query: String(q).replace(/^@/, '') })); const me = await uid();
  const t = found.find(u => u.id !== me); if (!t) throw new Error('No RigRoute account with that email or @username'); must(await c.from('friendships').insert({ addressee: t.id })); return t; }
export async function friendRespond(id, action) { const c = await sb(); return must(await c.rpc('respond_friend', { p_id: id, p_action: action })); }
export async function friendRemove(id) { const c = await sb(); must(await c.from('friendships').delete().eq('id', id)); }
export async function pushLocation(pos, sharing = true) { const c = await sb(), me = await uid(); if (!c || !me || !pos) return;
  await c.from('live_locations').upsert({ user_id: me, lat: pos.lat, lng: pos.lon, heading: pos.heading ?? null, speed_mph: pos.speed != null ? pos.speed * 2.237 : null, sharing, updated_at: new Date().toISOString() }); }
export async function friendLocations() { const c = await sb(), me = await uid(); if (!me) return []; return must(await c.from('live_locations').select('*').neq('user_id', me).gt('updated_at', new Date(Date.now() - 3600e3).toISOString())); }
export async function shareRoute(line, name = 'My route', eta = null) { const c = await sb(), me = await uid(); if (!me || !line?.length) return;
  await c.from('shared_routes').update({ active: false }).eq('owner', me).eq('active', true);
  // keep payload small: every Nth point, max ~400
  const step = Math.max(1, Math.ceil(line.length / 400)), g = { type: 'LineString', coordinates: line.filter((_, i) => i % step === 0 || i === line.length - 1) };
  must(await c.from('shared_routes').insert({ name, geometry: g, eta })); }
export async function friendRoutes() { const c = await sb(), me = await uid(); if (!me) return []; return must(await c.from('shared_routes').select('owner,name,geometry,eta,updated_at').neq('owner', me).eq('active', true)); }

// ---- loads (dispatcher -> driver contracts)
export const LOAD_NEXT = { offered: ['accepted', 'declined'] }; // after accept, the driver works stop by stop (driver_stop_event); delivery needs POD
export const LOAD_LABEL = { offered: 'Offered', accepted: 'Accepted', declined: 'Declined', in_transit: 'In transit', delivered: 'Delivered', cancelled: 'Cancelled' };
export async function myLoads() { const c = await sb(), me = await uid(); if (!me) return []; return must(await c.from('loads').select('*').or(`driver.eq.${me},dispatcher.eq.${me}`).order('created_at', { ascending: false }).limit(50)); }
export async function setLoadStatus(id, status) { const c = await sb(); return must(await c.rpc('driver_update_load', { p_id: id, p_status: status })); }
export async function offerLoad(l) { const c = await sb(); return must(await c.from('loads').insert(l).select().single()); }
export async function watchLoads(cb) { const c = await sb(), me = await uid(); if (!me) return () => {}; await c.realtime.setAuth();
  const ch = c.channel('loads-' + me).on('postgres_changes', { event: '*', schema: 'public', table: 'loads', filter: 'driver=eq.' + me }, p => cb(p.new, p.eventType))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loads', filter: 'dispatcher=eq.' + me }, p => cb(p.new, p.eventType)).subscribe();
  return () => c.removeChannel(ch); }
export async function myRole() { const c = await sb(), me = await uid(); if (!me) return null; return (await c.from('profiles').select('role').eq('id', me).maybeSingle()).data?.role || null; }

// ---- Dispatch API v1 over Supabase: the same envelopes as the relay transport, as rows in dispatch_messages(channel, sender, body, t).
// channel = the session channel tag from docs/DISPATCH_API.md (knowing it = being paired); bodies stay end-to-end encrypted by link.js.
export async function joinChannel(channel) { const c = await sb(); if (!(await uid())) throw new Error('sign in'); await c.from('dispatch_channel_members').upsert({ channel }); }
export async function sendEnvelope(channel, body) { const c = await sb(); must(await c.from('dispatch_messages').insert({ channel, body })); }
export async function channelHistory(channel, since = 0) { const c = await sb(); return must(await c.from('dispatch_messages').select('body,t,sender').eq('channel', channel).gt('t', new Date(since).toISOString()).order('t')); }
export async function watchChannel(channel, cb) { const c = await sb(); await c.realtime.setAuth(); const ch = c.channel('dm-' + channel.slice(0, 16)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dispatch_messages', filter: 'channel=eq.' + channel }, p => cb(p.new.body, p.new)).subscribe(); return () => c.removeChannel(ch); }

// ---- freight flow (supabase/010_freight_flow.sql)
export async function stopEvent(id, idx, event, pos, pod, pin) { const c = await sb(); return must(await c.rpc('driver_stop_event', { p_id: id, p_idx: idx, p_event: event, p_lat: pos?.lat ?? null, p_lng: pos?.lon ?? pos?.lng ?? null, p_pod: pod || null, p_pin: pin ?? null })); }
// fleets
export async function myFleets() { const c = await sb(), me = await uid(); if (!me) return []; return must(await c.from('fleet_members').select('fleet, role, unit, fleets(id, name, owner)').eq('user_id', me)); }
export async function joinFleet(code, unit) { const c = await sb(); return must(await c.rpc('join_fleet', { p_code: code, p_unit: unit || null })); }
export async function pushHos(h) { const c = await sb(), me = await uid(); if (!c || !me || !h) return; const m = x => Number.isFinite(x) ? Math.round(x / 60e3) : null;
  await c.from('driver_hos').upsert({ user_id: me, status: h.status, drive_left_min: m(h.driveLeft), window_left_min: m(h.windowLeft), cycle_left_min: m(h.cycleLeft), updated_at: new Date().toISOString() }); }
export async function loadEvents(ids) { const c = await sb(); if (!ids.length) return []; return must(await c.from('load_events').select('*').in('load_id', ids).order('t')); }
export async function postEvent(load_id, kind, body, pos) { const c = await sb(); return must(await c.from('load_events').insert({ load_id, kind, body, lat: pos?.lat ?? null, lng: pos?.lon ?? pos?.lng ?? null }).select().single()); }
export async function watchEvents(cb) { const c = await sb(); if (!(await uid())) return () => {}; await c.realtime.setAuth(); const ch = c.channel('lev-' + Math.random().toString(36).slice(2, 8)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'load_events' }, p => cb(p.new)).subscribe(); return () => c.removeChannel(ch); }
export async function updateLoad(id, patch) { const c = await sb(); return must(await c.from('loads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()); }
export async function addressBook() { const c = await sb(); return must(await c.from('address_book').select('*').order('name')); }
export async function saveAddress(a) { const c = await sb(); return must(await c.from('address_book').upsert(a).select().single()); }
export async function deleteAddress(id) { const c = await sb(); must(await c.from('address_book').delete().eq('id', id)); }
export async function stopUndo(id) { const c = await sb(); return must(await c.rpc('driver_stop_undo', { p_id: id })); }

// per-load document storage (bucket load-docs; RLS: any load party may read/add, staff delete)
export async function uploadLoadDoc(id, kind, blob, ext) { const c = await sb(); const path = `${id}/${kind}-${Date.now()}.${ext}`; const r = await c.storage.from('load-docs').upload(path, blob, { contentType: blob.type }); if (r.error) throw new Error(r.error.message); return path; }

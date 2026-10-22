// Accounts + Loads (dispatch) + Friends UI. Loaded from app.js; all transport is free (public Nostr relays), encrypted.
import { makeAuth, deviceKey } from './auth.js';
import { DriverDispatch, STATUS_LABEL, nextStatus, routeStops } from './dispatch.js';
import { Friends, passPrediction } from './friends.js';
import { bus } from './link.js';
import * as cloud from './cloud.js';
export async function init(S, h) {
  const { $, LS, esc, toast, say, map, openPanel, closePanels } = h;
  const css = document.createElement('style'); css.textContent = `.acct-tabs{display:flex;gap:6px;margin:8px 0}.acct-tabs button.on{background:var(--acc);color:#111}.acct input,.acct select{width:100%;margin:4px 0;min-height:44px;font-size:16px;box-sizing:border-box}
.load-card,.fr-card{border:1px solid #fff2;border-radius:12px;padding:10px;margin:8px 0}.load-card .row,.fr-card .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.pill{display:inline-block;padding:2px 8px;border-radius:9px;background:#fff2;font-size:12px}
.pill.hz{background:#c62828;color:#fff}#loadsBtn,#friendsBtn{position:relative}.badge{position:absolute;top:-4px;right:-4px;background:#e53935;color:#fff;border-radius:9px;font-size:12px;min-width:18px;line-height:18px}
.fr-pin{display:flex;flex-direction:column;align-items:center;font:600 12px system-ui;color:#fff;text-shadow:0 1px 3px #000}.fr-pin i{font-style:normal;font-size:24px;background:#1565c0;border-radius:50%;width:36px;height:36px;display:grid;place-items:center;border:2px solid #fff}.fr-pin small{font-weight:400;opacity:.85}
.acct input[type=checkbox]{width:22px;min-height:22px;height:22px;margin:0 6px 0 0;vertical-align:middle}#acctChips{display:flex;gap:6px;margin-top:6px}#acctChips .chip{min-height:40px;padding:6px 12px;border-radius:20px;font-size:14px;box-shadow:0 3px 10px #0006;position:relative}.code{font:700 26px ui-monospace,monospace;letter-spacing:2px}`; document.head.appendChild(css);
  const side = document.createElement('div'); side.id = 'acctChips'; $('#topbar').appendChild(side); const mk = (id, t, ic) => { const b = document.createElement('button'); b.id = id; b.className = 'chip'; b.title = t; b.setAttribute('aria-label', t); b.innerHTML = ic + ' ' + t.split(' ')[0] + '<span class="badge hidden"></span>'; side.appendChild(b); return b; };
  const acctBtn = mk('acctBtn', 'Account', '👤'), loadsBtn = mk('loadsBtn', 'Loads from dispatch', '📋'), friendsBtn = mk('friendsBtn', 'Friends', '👥');
  const panel = (id, title) => { const s = document.createElement('section'); s.id = id; s.className = 'panel hidden acct'; s.innerHTML = `<button class="close" aria-label="Close">✕</button><h2>${title}</h2><div class="body"></div>`; document.body.appendChild(s); s.querySelector('.close').onclick = closePanels; return s.querySelector('.body'); };
  const A = panel('acctPanel', 'Account'), Lp = panel('loadsPanel', 'Loads'), F = panel('friendsPanel', 'Friends');
  acctBtn.onclick = () => { openPanel('acctPanel'); renderAcct(); }; loadsBtn.onclick = () => { openPanel('loadsPanel'); renderLoads(); }; friendsBtn.onclick = () => { openPanel('friendsPanel'); renderFriends(); };
  const auth = await makeAuth(); S.auth = auth; S.openAccount = () => { openPanel('acctPanel'); renderAcct(); }; let tab = 'up', busy = false, pendingEmail = null; const SBA = auth.kind === 'supabase';
  const me = () => ({ name: auth.user?.name || LS.get('profile', {}).name || 'Driver', username: auth.user?.username || '', truck: { ...S.truck, icon: LS.get('vehicle', '🚛') } });
  const key = () => auth.secret?.() || deviceKey();
  // ---------- account
  function applyProfile(p) { if (!p) return; if (p.truck) { S.truck = { ...S.truck, ...p.truck }; LS.set('truck', S.truck); } const pr = LS.get('profile', {}); if (p.name) { pr.name = p.name; LS.set('profile', pr); } }
  function renderAcct() { const u = auth.user; if (u) pendingEmail = null; S.renderMeAcct?.();
    if (u) { A.dataset.state = 'signed-in'; A.innerHTML = `<p>Signed in as <b>${esc(u.name)}</b>${u.username ? ' (@' + esc(u.username) + ')' : ''}<br><span class="muted small">${esc(u.email || '')} · ${auth.kind === 'device' ? 'device + relay account (free)' : 'Supabase'} · id ${u.id.slice(0, 10)}…</span></p>
      <label>Display name<input id="acName" value="${esc(u.name)}"></label><label>Username (lets friends find you)<input id="acUser" value="${esc(u.username)}" placeholder="optional"></label>
      <p class="muted small">Truck profile: ${esc(S.truck.heightFt ? S.truck.heightFt + ' ft' : '')} ${S.truck.weightLb ? esc(S.truck.weightLb + ' lb') : ''} — saved with your account and restored on any phone.</p>
      <div class="row"><button id="acSave">Save profile</button> <button id="acRec">Show recovery code</button> <button id="acOut" class="danger">Sign out</button></div><pre id="acRecOut" class="small" style="white-space:pre-wrap"></pre>`;
      $('#acSave').onclick = async () => { try { await auth.saveProfile({ name: $('#acName').value.trim() || u.name, username: $('#acUser').value.trim().toLowerCase(), truck: S.truck }); fr?.publishUsername(auth.user.username).catch(() => {}); toast('Profile saved & synced'); renderAcct(); } catch (e) { toast(e.message); } };
      $('#acRec').onclick = () => { const c = auth.recoveryCode(); $('#acRecOut').textContent = c ? c + '\n\nKeep this somewhere safe. With it you can sign in on a new phone even if you forget your password. Anyone with it can use your account.' : 'Use email password reset.'; };
      $('#acOut').onclick = () => { auth.signOut(); toast('Signed out — guest mode'); renderAcct(); }; return; }
    if (pendingEmail) { A.dataset.state = 'check-email'; A.innerHTML = `<div id="acCheck" class="check-email"><h3>Check your email</h3><p>We sent a confirmation link to <b>${esc(pendingEmail)}</b>. Tap it, then come back and sign in.</p>
        <div class="row"><button id="acResend">Resend email</button><button id="acConfirmed" class="primary">I've confirmed, sign in</button></div><p id="acMsg" class="small"></p><button id="acBack" class="small-btn">Use a different email</button></div>`;
      $('#acResend').onclick = async () => { try { await auth.resendConfirmation(pendingEmail); $('#acMsg').textContent = 'Sent again. Check spam too.'; } catch (e) { $('#acMsg').textContent = '⚠ ' + e.message; } };
      $('#acConfirmed').onclick = () => { const em = pendingEmail; pendingEmail = null; tab = 'in'; renderAcct(); $('#acEmail').value = em; $('#acPass')?.focus(); };
      $('#acBack').onclick = () => { pendingEmail = null; renderAcct(); }; return; }
    A.dataset.state = 'signed-out';
    A.innerHTML = `<p class="muted small">Optional. Guest mode keeps everything working on this phone. An account saves your name + truck profile and lets you sign in on other phones, add friends and get loads from dispatch.</p>
      <div class="acct-tabs"><button data-t="up" class="${tab === 'up' ? 'on' : ''}">Sign up</button><button data-t="in" class="${tab === 'in' ? 'on' : ''}">Sign in</button><button data-t="rec" class="${tab === 'rec' ? 'on' : ''}">${SBA ? 'Forgot password' : 'Recovery code'}</button></div>
      ${tab === 'rec' ? (SBA ? '<input id="acEmail" type="email" placeholder="Your account email" autocomplete="username">' : '<input id="acCode" placeholder="RR1-XXXXXXXX-…" autocomplete="off">') : `${tab === 'up' ? '<input id="acName" placeholder="Display name">' : ''}<input id="acEmail" type="email" placeholder="Email" autocomplete="username"><input id="acPass" type="password" placeholder="Password (8+ characters)" autocomplete="${tab === 'up' ? 'new' : 'current'}-password">`}
      <button id="acGo" class="primary" style="width:100%">${tab === 'up' ? 'Create account' : tab === 'in' ? 'Sign in' : SBA ? 'Email me a reset link' : 'Restore account'}</button><p id="acMsg" class="small"></p>${SBA && tab !== 'rec' ? `<button id="acGoogle" class="oauth-google" hidden style="width:100%;margin-top:8px;align-items:center;justify-content:center;gap:8px;background:#fff;color:#1f1f1f;border:1px solid #dadce0"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.5z"/><path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.4 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.5 11.5 0 0 0 12 23.5z"/><path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4z"/><path fill="#EA4335" d="M12 4.6c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3c.9-2.8 3.4-5.2 6.4-5.2z"/></svg>Continue with Google</button>` : ''}
      <p class="muted small">${SBA ? 'Secure RigRoute account (email + password). New accounts get a confirmation email — tap the link, then sign in.' : 'No email is sent and no server stores your password: your email + password unlock an encrypted profile kept on free public relays.'}</p><button id="acGuest">Continue as guest</button>`;
    A.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; renderAcct(); }); $('#acGuest').onclick = closePanels;
    { const g = $('#acGoogle'); if (g) { auth.providers?.().then(p => { if (p.google && document.contains(g)) { g.hidden = false; g.style.display = 'flex'; } });
      g.onclick = () => auth.oauth('google').catch(e => { $('#acMsg').textContent = 'Google sign-in failed: ' + (e.message || e); }); } }
    $('#acGo').onclick = async () => { if (busy) return; busy = true; $('#acMsg').textContent = 'Working… (secure key derivation takes a few seconds)';
      try { let res = null; if (tab === 'up') res = await auth.signUp({ email: $('#acEmail').value, password: $('#acPass').value, name: $('#acName').value.trim(), truck: S.truck });
        else if (tab === 'in') { res = await auth.signIn({ email: $('#acEmail').value, password: $('#acPass').value }); if (!res?.pending) applyProfile(res.profile); }
        else if (SBA) { await auth.resetPassword($('#acEmail').value); $('#acMsg').textContent = '✅ Reset link sent — check your email.'; return; }
        else applyProfile((await auth.signInRecovery($('#acCode').value)).profile);
        if (res?.pending) { pendingEmail = res.email; renderAcct(); return; }
        toast('Welcome, ' + auth.user.name); renderAcct(); } catch (e) { $('#acMsg').textContent = '⚠ ' + e.message; } finally { busy = false; } }; }
  // ---------- dispatch (driver side)
  let dd = null, fr = null;
  async function wire() { dd = new DriverDispatch(key(), me); S.dispatch = dd; dd.onChange(() => { badge(loadsBtn, dd.allLoads().filter(l => l.state === 'offered').length); if (!$('#loadsPanel').classList.contains('hidden')) renderLoads(); notifyLoads(); });
    fr = auth.user ? await new Friends(key(), me).start() : null; S.friends = fr; if (fr) { fr.onChange(() => { badge(friendsBtn, fr.requests.length); drawFriends(); if (!$('#friendsPanel').classList.contains('hidden')) renderFriends(); }); if (auth.user.username) fr.publishUsername(auth.user.username).catch(() => {}); }
    await wireCloud(); drawFriends(); renderAcct(); }
  // ---------- server (Supabase) loads + friends; the relay versions above stay as fallback
  let cLoads = [], cFr = { friends: [], incoming: [], outgoing: [] }, cLocs = [], cRoutes = [], unwatch = null, cMarkers = {};
  const cOn = () => SBA && auth.user;
  async function wireCloud() { unwatch?.(); unwatch = null; cLoads = []; cFr = { friends: [], incoming: [], outgoing: [] }; cLocs = []; Object.values(cMarkers).forEach(m => m.remove()); cMarkers = {}; S.cloud = null; if (!cOn()) return;
    S.cloud = cloud; try { await refreshCloudLoads(); unwatch = await cloud.watchLoads(async (row, ev) => { const isNew = ev === 'INSERT' && row.driver === auth.user.id && row.status === 'offered';
      await refreshCloudLoads(); if (isNew) { say(`New load offer: ${row.pickup_address} to ${row.dropoff_address}.`, 'info'); toast('📋 New load offer'); } }); } catch (e) { console.warn('cloud loads', e); }
    refreshCloudFriends(); }
  async function refreshCloudLoads() { if (!cOn()) return; cLoads = await cloud.myLoads().catch(() => cLoads); const n = cLoads.filter(l => l.driver === auth.user.id && l.status === 'offered').length + (dd?.allLoads().filter(l => l.state === 'offered').length || 0);
    badge(loadsBtn, n); if (!$('#loadsPanel').classList.contains('hidden')) renderLoads(); }
  async function refreshCloudFriends() { if (!cOn()) return; try { cFr = await cloud.friendsList(); cLocs = await cloud.friendLocations(); cRoutes = await cloud.friendRoutes(); } catch (e) { console.warn('cloud friends', e); }
    badge(friendsBtn, (fr?.requests.length || 0) + cFr.incoming.length); drawCloudFriends(); if (!$('#friendsPanel').classList.contains('hidden')) renderFriends(); }
  function drawCloudFriends() { const names = Object.fromEntries(cFr.friends.map(f => [f.other, f])); const keep = new Set();
    for (const L of cLocs) { const f = names[L.user_id]; if (!f) continue; keep.add(L.user_id); let m = cMarkers[L.user_id];
      if (!m) { const el = document.createElement('div'); el.className = 'fr-pin'; el.dataset.cfriend = L.user_id; m = cMarkers[L.user_id] = new maplibregl.Marker({ element: el }).setLngLat([L.lng, L.lat]).addTo(map); }
      m.setLngLat([L.lng, L.lat]); m.getElement().innerHTML = `<i>${esc(f.truck?.icon || '🚛')}</i><b>${esc(f.name)}</b><small>${ago(Date.parse(L.updated_at))}</small>`;
      const p = passPrediction({ me: S.pos && { ...S.pos, t: Date.now() }, fr: { lat: L.lat, lon: L.lng, heading: L.heading, speed: (L.speed_mph || 0) / 2.237, t: Date.parse(L.updated_at) }, myRoute: S.route?.line, frRoute: cRoutes.find(r => r.owner === L.user_id)?.geometry?.coordinates, names: routeNames(), who: f.name });
      f.pass = p; if (p && (p.kind === 'near' || (p.kind === 'ahead' && p.miles < 5)) && !notified['c' + L.user_id]) { notified['c' + L.user_id] = Date.now(); say(p.text, 'info'); toast('👥 ' + p.text); } }
    for (const id of Object.keys(cMarkers)) if (!keep.has(id)) { cMarkers[id].remove(); delete cMarkers[id]; } }
  const cShareOK = () => cOn() && !(fr?.ghost) && LS.get('cloudShare', true);
  setInterval(() => { if (cShareOK() && S.pos) cloud.pushLocation(S.pos).catch(() => {}); if (cOn()) refreshCloudFriends(); }, 30000);
  let lastRouteSent = null; setInterval(() => { if (cShareOK() && (fr?.routeShare ?? LS.get('cloudRouteShare', false)) && S.route?.line && S.route.line !== lastRouteSent) { lastRouteSent = S.route.line; cloud.shareRoute(S.route.line, S.dest?.name || 'My route').catch(() => {}); } }, 30000);
  function cloudLoadsHTML() { if (!cOn()) return ''; const mine = cLoads.filter(l => l.driver === auth.user.id); if (!mine.length) return '<h3>RigRoute dispatch</h3><p class="muted small">No server loads yet. Your dispatcher can send loads to <b>' + esc(auth.user.email || '') + '</b>.</p><h3>Relay dispatch (code)</h3>';
    return '<h3>RigRoute dispatch</h3>' + mine.map(l => `<div class="load-card" data-cload="${l.id}"><b>Load ${esc(l.ref || l.id.slice(0, 8))}</b> <span class="pill" data-state>${esc(cloud.LOAD_LABEL[l.status] || l.status)}</span>
      <div class="small"><b>Pickup:</b> ${esc(l.pickup_address)}${l.pickup_at ? ' · ' + new Date(l.pickup_at).toLocaleString() : ''}</div><div class="small"><b>Deliver:</b> ${esc(l.dropoff_address)}${l.dropoff_at ? ' · ' + new Date(l.dropoff_at).toLocaleString() : ''}</div>
      <div class="small">${l.rate_usd != null ? '💵 $' + Number(l.rate_usd).toLocaleString() : ''} ${l.commodity ? '· ' + esc(l.commodity) : ''} ${l.weight_lb ? '· ' + l.weight_lb.toLocaleString() + ' lb' : ''}</div>${l.notes ? `<div class="small">📝 ${esc(l.notes)}</div>` : ''}
      <div class="row">${(cloud.LOAD_NEXT[l.status] || []).map(s => `<button class="${s === 'declined' ? '' : 'primary'}" data-cs="${s}">${s === 'accepted' ? 'Accept' : s === 'declined' ? 'Decline' : s === 'in_transit' ? 'Start trip' : 'Mark delivered'}</button>`).join('')}
      ${['accepted', 'in_transit'].includes(l.status) && l.dropoff_lat != null ? '<button data-cnav>Navigate</button>' : ''}</div></div>`).join('') + '<h3>Relay dispatch (code)</h3>'; }
  function wireCloudLoads() { Lp.querySelectorAll('[data-cload]').forEach(card => { const l = cLoads.find(x => x.id === card.dataset.cload);
    card.querySelectorAll('[data-cs]').forEach(b => b.onclick = async () => { try { await cloud.setLoadStatus(l.id, b.dataset.cs); toast('Load ' + cloud.LOAD_LABEL[b.dataset.cs].toLowerCase()); await refreshCloudLoads(); renderLoads(); } catch (e) { toast(e.message); } });
    const nb = card.querySelector('[data-cnav]'); if (nb) nb.onclick = async () => { const pre = l.status === 'accepted' && l.pickup_lat != null; S.stops = pre ? [{ lat: l.pickup_lat, lon: l.pickup_lng, name: 'Pickup: ' + l.pickup_address }] : []; LS.set('stops', S.stops); closePanels();
      if (l.status === 'accepted') cloud.setLoadStatus(l.id, 'in_transit').then(refreshCloudLoads).catch(() => {}); await S.setDest({ lat: l.dropoff_lat, lon: l.dropoff_lng, name: 'Deliver: ' + l.dropoff_address }); if (S.route) $('#goBtn')?.click(); }; }); }
  function cloudFriendsHTML() { if (!cOn()) return ''; return `<h3>RigRoute friends</h3><div class="row"><input id="cfAdd" placeholder="Friend's email or @username"><button id="cfSend" class="primary">Add</button></div><p id="cfMsg" class="small muted"></p>
    <label class="small"><input type="checkbox" id="cfShare" ${LS.get('cloudShare', true) ? 'checked' : ''}> Share my live location with accepted friends</label>
    ${cFr.incoming.map(r => `<div class="fr-card" data-cfr="${r.id}">🤝 <b>${esc(r.name)}</b>${r.username ? ' @' + esc(r.username) : ''} wants to be friends<div class="row"><button class="primary" data-cfa="accept">Accept</button><button data-cfa="remove">Decline</button><button class="danger" data-cfa="block">Block</button></div></div>`).join('')}
    ${cFr.outgoing.map(r => `<div class="small muted" data-cfr="${r.id}">⏳ Request sent to ${esc(r.name)} <button class="small-btn" data-cfa="remove">Cancel</button></div>`).join('')}
    ${cFr.friends.map(f => { const L = cLocs.find(x => x.user_id === f.other); return `<div class="fr-card" data-cfr="${f.id}" data-cuser="${f.other}"><b>${esc(f.truck?.icon || '🚛')} ${esc(f.name)}</b>${f.username ? ' @' + esc(f.username) : ''}<div class="small muted">${L ? 'Seen ' + ago(Date.parse(L.updated_at)) : 'Not sharing right now'}${cRoutes.some(r => r.owner === f.other) ? ' · route shared' : ''}</div>${f.pass ? `<div class="small">${esc(f.pass.text)}</div>` : ''}
      <div class="row"><button class="small-btn" data-cfloc>Show</button><button class="small-btn danger" data-cfa="remove">Remove</button><button class="small-btn danger" data-cfa="block">Block</button></div></div>`; }).join('') || '<p class="muted small">No RigRoute friends yet.</p>'}<h3>Relay friends (code)</h3>`; }
  function wireCloudFriends() { const send = $('#cfSend'); if (!send) return;
    send.onclick = async () => { $('#cfMsg').textContent = 'Sending…'; try { const t = await cloud.friendRequest($('#cfAdd').value.trim()); $('#cfMsg').textContent = 'Request sent to ' + (t.display_name || 'driver'); refreshCloudFriends(); } catch (e) { $('#cfMsg').textContent = '⚠ ' + (/duplicate/.test(e.message) ? 'You already have a request with this driver' : e.message); } };
    $('#cfShare').onchange = e => { LS.set('cloudShare', e.target.checked); if (e.target.checked && S.pos) cloud.pushLocation(S.pos); else cloud.pushLocation(S.pos || { lat: 0, lon: 0 }, false).catch(() => {}); };
    F.querySelectorAll('[data-cfr]').forEach(c => { c.querySelectorAll('[data-cfa]').forEach(b => b.onclick = async () => { try { const a = b.dataset.cfa, id = +c.dataset.cfr;
        if (a === 'remove') { if (!confirm('Remove?')) return; await cloud.friendRemove(id); } else await cloud.friendRespond(id, a); refreshCloudFriends(); } catch (e) { toast(e.message); } });
      const sh = c.querySelector('[data-cfloc]'); if (sh) sh.onclick = () => { const L = cLocs.find(x => x.user_id === c.dataset.cuser); if (L) { closePanels(); map.flyTo({ center: [L.lng, L.lat], zoom: 13 }); } else toast('Not sharing right now'); }; }); }
  auth.onChange(() => { Object.values(fMarkers).forEach(m => m.remove()); fMarkers = {}; wire(); });
  const badge = (b, n) => { const e = b.querySelector('.badge'); e.textContent = n; e.classList.toggle('hidden', !n); };
  const seenLoads = new Set(LS.get('seenLoads', []));
  function notifyLoads() { for (const l of dd.allLoads()) if (l.state === 'offered' && !seenLoads.has(l.load.id)) { seenLoads.add(l.load.id); LS.set('seenLoads', [...seenLoads]); say(`New load from ${l.dispatcher?.name || 'dispatch'}: ${l.load.pickup.name || 'pickup'} to ${l.load.drop.name || 'delivery'}.`, 'info'); toast('📋 New load offer'); } }
  const fmtW = w => w ? new Date(w.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (w.end ? '–' + new Date(w.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') : '';
  const stopHTML = (s, k) => `<div class="small"><b>${k}:</b> ${esc(s.name || '')} — ${esc(s.address)}${s.window ? '<br><span class="muted">' + esc(fmtW(s.window)) + '</span>' : ''}</div>`;
  function renderLoads() { const P = new URLSearchParams(location.search).get('pair') || '';
    Lp.innerHTML = cloudLoadsHTML() + `<div class="row"><input id="pairCode" placeholder="Dispatcher code e.g. K7QM-4XPA" value="${esc(P)}" autocomplete="off"><button id="pairGo" class="primary">Connect to dispatcher</button></div><p id="pairMsg" class="small muted"></p>
      ${dd.pairings.map(p => `<div class="small">✅ Connected: <b>${esc(p.dispatcher?.name || 'Dispatcher')}</b> <button class="small-btn" data-unpair="${p.session}">Disconnect</button></div>`).join('')}
      ${dd.pairings.length ? `<label class="small"><input type="checkbox" id="shareLoc" ${dd.share ? 'checked' : ''}> Share my live location with my dispatcher(s)</label>` : ''}
      ${dd.allLoads().map(L => { const l = L.load, nx = nextStatus(L.state); return `<div class="load-card" data-load="${esc(l.id)}"><b>Load ${esc(l.ref || l.id)}</b> <span class="pill" data-state>${esc(STATUS_LABEL[L.state] || L.state)}</span> ${l.hazmat?.is ? `<span class="pill hz">HAZMAT ${esc(l.hazmat.class)}${l.hazmat.un ? ' ' + esc(l.hazmat.un) : ''}</span>` : ''}
        ${stopHTML(l.pickup, 'Pickup')}${(l.stops || []).map(s => stopHTML(s, 'Stop')).join('')}${stopHTML(l.drop, 'Deliver')}
        <div class="small">${l.rate ? '💵 $' + l.rate.amount.toLocaleString() + (l.rate.per === 'mile' ? '/mi' : '') : ''} ${l.commodity ? '· ' + esc(l.commodity) : ''} ${l.weight_lb ? '· ' + l.weight_lb.toLocaleString() + ' lb' : ''} ${l.equipment ? '· ' + esc(l.equipment) : ''}</div>
        ${l.bol?.length ? `<div class="small muted">BOL: ${l.bol.map(esc).join(', ')}</div>` : ''}${l.notes ? `<div class="small">📝 ${esc(l.notes)}</div>` : ''}
        <div class="row">${L.state === 'offered' ? `<button class="primary" data-act="accept">Accept</button><button data-act="decline">Decline</button><button data-act="counter">Counter</button>` : ''}
        ${!['offered', 'declined', 'cancelled', 'delivered'].includes(L.state) ? `<button class="primary" data-act="nav">Navigate</button>` : ''}${nx && L.state !== 'offered' && L.state !== 'countered' ? `<button data-act="status" data-s="${nx}">${esc(STATUS_LABEL[nx])}</button>` : ''}
        ${L.state === 'arrived_drop' ? `<label class="small-btn">📷 POD photo<input type="file" accept="image/*" capture="environment" data-act="pod" hidden></label>` : ''}</div></div>`; }).join('') || '<p class="muted">No loads yet. Ask your dispatcher for a connect code.</p>'}`;
    $('#pairGo').onclick = async () => { $('#pairMsg').textContent = 'Connecting…'; try { const p = await dd.pair($('#pairCode').value); toast('Connected to ' + (p.dispatcher?.name || 'dispatcher')); renderLoads(); } catch (e) { $('#pairMsg').textContent = '⚠ ' + e.message; } };
    wireCloudLoads(); Lp.querySelectorAll('[data-unpair]').forEach(b => b.onclick = () => { dd.unpair(b.dataset.unpair); renderLoads(); });
    const sl = $('#shareLoc'); if (sl) sl.onchange = () => { dd.setShare(sl.checked); if (sl.checked) dd.location(S.pos); };
    Lp.querySelectorAll('[data-load]').forEach(card => { const L = dd.allLoads().find(x => x.load.id === card.dataset.load);
      card.querySelectorAll('[data-act]').forEach(b => { const go = async () => { const a = b.dataset.act; try {
        if (a === 'accept') await dd.respond(L.session, L.load.id, 'accept'); if (a === 'decline') await dd.respond(L.session, L.load.id, 'decline', { reason: prompt('Reason (optional)') || '' });
        if (a === 'counter') { const v = +prompt('Your counter rate ($)', L.load.rate?.amount || ''); if (v > 0) await dd.respond(L.session, L.load.id, 'counter', { counter: { amount: v, currency: 'USD' } }); }
        if (a === 'status') await dd.status(L.session, L.load.id, b.dataset.s, S.pos ? { lat: S.pos.lat, lon: S.pos.lon } : {});
        if (a === 'pod') { const pod = await shrink(b.files[0]); await dd.status(L.session, L.load.id, 'delivered', { pod: { photo: pod, at: Date.now() }, ...(S.pos ? { lat: S.pos.lat, lon: S.pos.lon } : {}) }); toast('Delivered — POD sent'); }
        if (a === 'nav') return navigate(L); } catch (e) { toast(e.message); } renderLoads(); }; if (b.dataset.act === 'pod') b.onchange = go; else b.onclick = go; }); }); }
  async function shrink(file) { const img = await createImageBitmap(file), k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.6); }
  async function navigate(L) { if ((L.load.stops || []).length) { closePanels(); window.dispatchEvent(new CustomEvent('rr:load', { detail: L.load })); return; } const st = routeStops(L.load), pre = ['accepted', 'en_route_pickup', 'arrived_pickup'].includes(L.state);
    const todo = pre ? st : st.filter(s => s.kind !== 'pickup'); const drop = todo.at(-1); S.stops = todo.slice(0, -1).map(s => ({ lat: s.lat, lon: s.lon, name: (s.kind === 'pickup' ? 'Pickup: ' : 'Stop: ') + (s.name || s.address) })); LS.set('stops', S.stops);
    S.activeLoad = { session: L.session, id: L.load.id }; closePanels(); if (L.state === 'accepted') dd.status(L.session, L.load.id, 'en_route_pickup').catch(() => {}); if (L.state === 'loaded') dd.status(L.session, L.load.id, 'en_route_drop').catch(() => {});
    await S.setDest({ lat: drop.lat, lon: drop.lon, name: 'Deliver: ' + (drop.name || drop.address) }); if (S.route) { $('#goBtn')?.click(); toast(`Navigating: ${S.stops.length ? S.stops[0].name + ' → ' : ''}${drop.name || drop.address}`); } }
  // ---------- friends
  let fMarkers = {}, notified = {};
  function ago(t) { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; }
  function routeNames() { const r = S.route; if (!r) return []; return r.maneuvers.map(m => { const ex = m.sign?.exit_number_elements?.[0]?.text; return { along: r.cum[m.begin_shape_index] || 0, name: ex ? 'Exit ' + ex : (m.street_names?.[0] || null) }; }); }
  function predictions() { if (!fr) return {}; const out = {}; for (const f of fr.friends) { const L = fr.live[f.pk]; if (!L?.loc) continue;
      out[f.pk] = passPrediction({ me: S.pos && { ...S.pos, t: Date.now() }, fr: L.loc, myRoute: S.route?.line, frRoute: L.route?.line, names: routeNames(), who: f.name || 'friend' }); } S.friendPass = out; return out; }
  function drawFriends() { if (!fr) return; const pr = predictions();
    for (const f of fr.friends) { const L = fr.live[f.pk]; if (!L?.loc || Date.now() - L.loc.t > 60 * 60e3) { fMarkers[f.pk]?.remove(); delete fMarkers[f.pk]; continue; }
      let m = fMarkers[f.pk]; if (!m) { const el = document.createElement('div'); el.className = 'fr-pin'; el.dataset.friend = f.pk; m = fMarkers[f.pk] = new maplibregl.Marker({ element: el }).setLngLat([L.loc.lon, L.loc.lat]).addTo(map); }
      m.setLngLat([L.loc.lon, L.loc.lat]); m.getElement().innerHTML = `<i>${esc(L.loc.truck || f.truck?.icon || '🚛')}</i><b>${esc(f.name || 'Friend')}</b><small>${ago(L.loc.t)}</small>`;
      const p = pr[f.pk]; if (p && (p.kind === 'near' || (p.kind === 'ahead' && p.miles < 5)) && !notified[f.pk]) { notified[f.pk] = Date.now(); say(p.text, 'info'); toast('👥 ' + p.text); } if (p && p.kind === 'behind' && p.miles > 10) delete notified[f.pk]; }
    drawFriendRoutes(); }
  function drawFriendRoutes() { if (!map.isStyleLoaded?.()) return; const feats = fr ? fr.friends.map(f => fr.live[f.pk]?.route?.line).filter(Boolean).map(line => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: line } })) : []; const data = { type: 'FeatureCollection', features: feats };
    if (map.getSource('frRoutes')) map.getSource('frRoutes').setData(data); else { map.addSource('frRoutes', { type: 'geojson', data }); map.addLayer({ id: 'frRoutes', type: 'line', source: 'frRoutes', paint: { 'line-color': '#42a5f5', 'line-width': 4, 'line-opacity': 0.55, 'line-dasharray': [2, 1.5] } }); } }
  function renderFriends() { if (!fr) { F.innerHTML = '<p>Sign in (👤) to add friends. Nothing is shared until you both accept and turn sharing on.</p><button id="frAcct" class="primary">Sign in / Sign up</button>'; $('#frAcct').onclick = () => acctBtn.click(); return; }
    const pr = predictions(), link = location.origin + location.pathname + '?friend=' + fr.code;
    F.innerHTML = cloudFriendsHTML() + `<p class="small">Your friend code: <span class="code" id="myFriendCode">${fr.code}</span>${auth.user.username ? ' · @' + esc(auth.user.username) : ''}<br><img id="frQR" alt="QR" width="120" height="120" style="background:#fff;margin-top:4px"></p>
      <div class="row"><input id="frAdd" placeholder="Friend's code or @username" value="${esc(new URLSearchParams(location.search).get('friend') || '')}"><button id="frSend" class="primary">Send request</button></div><p id="frMsg" class="small muted"></p>
      ${fr.requests.map((r, i) => `<div class="fr-card">🤝 <b>${esc(r.from?.name || 'Driver')}</b>${r.from?.username ? ' @' + esc(r.from.username) : ''} wants to be friends <div class="row"><button class="primary" data-acc="${i}">Accept</button><button data-dec="${i}">Decline</button></div></div>`).join('')}
      ${fr.outgoing.map(o => `<div class="small muted">⏳ Request sent to ${esc(o.label)}</div>`).join('')}
      <h3>Sharing</h3><label class="small"><input type="checkbox" id="frGhost" ${fr.ghost ? 'checked' : ''}> 👻 Ghost mode (pause all sharing)</label><br>
      <label class="small"><input type="checkbox" id="frRoute" ${fr.routeShare ? 'checked' : ''}> Share my planned route with friends I share with</label><br>
      <label class="small">Auto-off: <select id="frTimer"><option value="0">Never</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="720">12 hours</option></select></label> ${fr.shareUntil ? `<span class="small muted">until ${new Date(fr.shareUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>` : ''}
      <h3>Friends (${fr.friends.length})</h3>${fr.friends.map(f => { const L = fr.live[f.pk], p = pr[f.pk]; return `<div class="fr-card" data-fr="${f.pk}"><b>${esc(f.truck?.icon || '🚛')} ${esc(f.name || 'Friend')}</b>${f.username ? ' @' + esc(f.username) : ''}
        <div class="small muted">${L?.loc ? 'Seen ' + (S.ageHTML ? S.ageHTML(L.loc.t, 5) : ago(L.loc.t)) : 'Not sharing with you right now'}${L?.route ? ' · route shared' : ''}</div>${p ? `<div class="small" data-pass>${esc(p.text)}</div>` : ''}
        <div class="row"><label class="small"><input type="checkbox" data-share ${f.share ? 'checked' : ''}> Share my location with ${esc(f.name || 'them')}</label><button class="small-btn" data-loc>Show</button><button class="small-btn danger" data-rm>Remove</button></div></div>`; }).join('') || '<p class="muted small">No friends yet.</p>'}`;
    $('#frTimer').value = fr.shareUntil ? [60, 240, 720].find(m => Math.abs(fr.shareUntil - Date.now() - m * 60e3) < m * 60e3) || 0 : 0;
    import('https://esm.sh/qrcode@1.5.4').then(q => q.toDataURL(link, { margin: 1 })).then(u => { const i = $('#frQR'); if (i) i.src = u; }).catch(() => $('#frQR')?.remove());
    wireCloudFriends(); $('#frSend').onclick = async () => { $('#frMsg').textContent = 'Sending…'; try { await fr.request($('#frAdd').value); $('#frMsg').textContent = 'Request sent — they need to accept.'; renderFriends(); } catch (e) { $('#frMsg').textContent = '⚠ ' + e.message; } };
    F.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => fr.accept(fr.requests[+b.dataset.acc]).then(() => toast('Friend added')));
    F.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => fr.decline(fr.requests[+b.dataset.dec]));
    $('#frGhost').onchange = e => fr.setGhost(e.target.checked); $('#frRoute').onchange = e => { fr.setRouteShare(e.target.checked); share(); }; $('#frTimer').onchange = e => fr.setTimer(+e.target.value);
    F.querySelectorAll('[data-fr]').forEach(c => { const pk = c.dataset.fr; c.querySelector('[data-share]').onchange = e => { fr.setShare(pk, e.target.checked); share(); }; c.querySelector('[data-rm]').onclick = () => confirm('Remove friend?') && fr.remove(pk);
      c.querySelector('[data-loc]').onclick = () => { const L = fr.live[pk]; if (L?.loc) { closePanels(); map.flyTo({ center: [L.loc.lon, L.loc.lat], zoom: 13 }); } else toast('Not sharing right now'); }; }); }
  // ---------- periodic sharing (friends every 20 s while moving, dispatch every 30 s), plus deep links
  const share = () => { fr?.tick(S.pos, S.route?.line).then(() => drawFriends()); };
  S.shareNow = () => { share(); dd?.location(S.pos); }; setInterval(share, 20000); setInterval(() => dd?.location(S.pos), 30000); setInterval(drawFriends, 10000);
  await wire(); const q = new URLSearchParams(location.search); if (q.get('pair')) { openPanel('loadsPanel'); renderLoads(); } else if (q.get('friend')) { openPanel('friendsPanel'); renderFriends(); }
  S.accountReady = true; S.bus = bus();
}

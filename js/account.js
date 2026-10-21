// Accounts + Loads (dispatch) + Friends UI. Loaded from app.js; all transport is free (public Nostr relays), encrypted.
import { makeAuth, deviceKey } from './auth.js';
import { DriverDispatch, STATUS_LABEL, nextStatus, routeStops } from './dispatch.js';
import { Friends, passPrediction } from './friends.js';
import { bus } from './link.js';
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
  const auth = await makeAuth(); S.auth = auth; let tab = 'up', busy = false;
  const me = () => ({ name: auth.user?.name || LS.get('profile', {}).name || 'Driver', username: auth.user?.username || '', truck: { ...S.truck, icon: LS.get('vehicle', '🚛') } });
  const key = () => auth.secret?.() || deviceKey();
  // ---------- account
  function applyProfile(p) { if (!p) return; if (p.truck) { S.truck = { ...S.truck, ...p.truck }; LS.set('truck', S.truck); } const pr = LS.get('profile', {}); if (p.name) { pr.name = p.name; LS.set('profile', pr); } }
  function renderAcct() { const u = auth.user;
    if (u) { A.innerHTML = `<p>Signed in as <b>${esc(u.name)}</b>${u.username ? ' (@' + esc(u.username) + ')' : ''}<br><span class="muted small">${esc(u.email || '')} · ${auth.kind === 'device' ? 'device + relay account (free)' : 'Supabase'} · id ${u.id.slice(0, 10)}…</span></p>
      <label>Display name<input id="acName" value="${esc(u.name)}"></label><label>Username (lets friends find you)<input id="acUser" value="${esc(u.username)}" placeholder="optional"></label>
      <p class="muted small">Truck profile: ${esc(S.truck.heightFt ? S.truck.heightFt + ' ft' : '')} ${S.truck.weightLb ? esc(S.truck.weightLb + ' lb') : ''} — saved with your account and restored on any phone.</p>
      <div class="row"><button id="acSave">Save profile</button> <button id="acRec">Show recovery code</button> <button id="acOut" class="danger">Sign out</button></div><pre id="acRecOut" class="small" style="white-space:pre-wrap"></pre>`;
      $('#acSave').onclick = async () => { try { await auth.saveProfile({ name: $('#acName').value.trim() || u.name, username: $('#acUser').value.trim().toLowerCase(), truck: S.truck }); fr?.publishUsername(auth.user.username).catch(() => {}); toast('Profile saved & synced'); renderAcct(); } catch (e) { toast(e.message); } };
      $('#acRec').onclick = () => { const c = auth.recoveryCode(); $('#acRecOut').textContent = c ? c + '\n\nKeep this somewhere safe. With it you can sign in on a new phone even if you forget your password. Anyone with it can use your account.' : 'Use email password reset.'; };
      $('#acOut').onclick = () => { auth.signOut(); toast('Signed out — guest mode'); renderAcct(); }; return; }
    A.innerHTML = `<p class="muted small">Optional. Guest mode keeps everything working on this phone. An account saves your name + truck profile and lets you sign in on other phones, add friends and get loads from dispatch.</p>
      <div class="acct-tabs"><button data-t="up" class="${tab === 'up' ? 'on' : ''}">Sign up</button><button data-t="in" class="${tab === 'in' ? 'on' : ''}">Sign in</button><button data-t="rec" class="${tab === 'rec' ? 'on' : ''}">Recovery code</button></div>
      ${tab === 'rec' ? '<input id="acCode" placeholder="RR1-XXXXXXXX-…" autocomplete="off">' : `${tab === 'up' ? '<input id="acName" placeholder="Display name">' : ''}<input id="acEmail" type="email" placeholder="Email" autocomplete="username"><input id="acPass" type="password" placeholder="Password (8+ characters)" autocomplete="${tab === 'up' ? 'new' : 'current'}-password">`}
      <button id="acGo" class="primary" style="width:100%">${tab === 'up' ? 'Create account' : tab === 'in' ? 'Sign in' : 'Restore account'}</button><p id="acMsg" class="small"></p>
      <p class="muted small">No email is sent and no server stores your password: your email + password unlock an encrypted profile kept on free public relays.</p><button id="acGuest">Continue as guest</button>`;
    A.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; renderAcct(); }); $('#acGuest').onclick = closePanels;
    $('#acGo').onclick = async () => { if (busy) return; busy = true; $('#acMsg').textContent = 'Working… (secure key derivation takes a few seconds)';
      try { if (tab === 'up') await auth.signUp({ email: $('#acEmail').value, password: $('#acPass').value, name: $('#acName').value.trim(), truck: S.truck });
        else if (tab === 'in') applyProfile((await auth.signIn({ email: $('#acEmail').value, password: $('#acPass').value })).profile);
        else applyProfile((await auth.signInRecovery($('#acCode').value)).profile);
        toast('Welcome, ' + auth.user.name); renderAcct(); } catch (e) { $('#acMsg').textContent = '⚠ ' + e.message; } finally { busy = false; } }; }
  // ---------- dispatch (driver side)
  let dd = null, fr = null;
  async function wire() { dd = new DriverDispatch(key(), me); S.dispatch = dd; dd.onChange(() => { badge(loadsBtn, dd.allLoads().filter(l => l.state === 'offered').length); if (!$('#loadsPanel').classList.contains('hidden')) renderLoads(); notifyLoads(); });
    fr = auth.user ? await new Friends(key(), me).start() : null; S.friends = fr; if (fr) { fr.onChange(() => { badge(friendsBtn, fr.requests.length); drawFriends(); if (!$('#friendsPanel').classList.contains('hidden')) renderFriends(); }); if (auth.user.username) fr.publishUsername(auth.user.username).catch(() => {}); }
    drawFriends(); renderAcct(); }
  auth.onChange(() => { Object.values(fMarkers).forEach(m => m.remove()); fMarkers = {}; wire(); });
  const badge = (b, n) => { const e = b.querySelector('.badge'); e.textContent = n; e.classList.toggle('hidden', !n); };
  const seenLoads = new Set(LS.get('seenLoads', []));
  function notifyLoads() { for (const l of dd.allLoads()) if (l.state === 'offered' && !seenLoads.has(l.load.id)) { seenLoads.add(l.load.id); LS.set('seenLoads', [...seenLoads]); say(`New load from ${l.dispatcher?.name || 'dispatch'}: ${l.load.pickup.name || 'pickup'} to ${l.load.drop.name || 'delivery'}.`, 'info'); toast('📋 New load offer'); } }
  const fmtW = w => w ? new Date(w.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (w.end ? '–' + new Date(w.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') : '';
  const stopHTML = (s, k) => `<div class="small"><b>${k}:</b> ${esc(s.name || '')} — ${esc(s.address)}${s.window ? '<br><span class="muted">' + esc(fmtW(s.window)) + '</span>' : ''}</div>`;
  function renderLoads() { const P = new URLSearchParams(location.search).get('pair') || '';
    Lp.innerHTML = `<div class="row"><input id="pairCode" placeholder="Dispatcher code e.g. K7QM-4XPA" value="${esc(P)}" autocomplete="off"><button id="pairGo" class="primary">Connect to dispatcher</button></div><p id="pairMsg" class="small muted"></p>
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
    Lp.querySelectorAll('[data-unpair]').forEach(b => b.onclick = () => { dd.unpair(b.dataset.unpair); renderLoads(); });
    const sl = $('#shareLoc'); if (sl) sl.onchange = () => { dd.setShare(sl.checked); if (sl.checked) dd.location(S.pos); };
    Lp.querySelectorAll('[data-load]').forEach(card => { const L = dd.allLoads().find(x => x.load.id === card.dataset.load);
      card.querySelectorAll('[data-act]').forEach(b => { const go = async () => { const a = b.dataset.act; try {
        if (a === 'accept') await dd.respond(L.session, L.load.id, 'accept'); if (a === 'decline') await dd.respond(L.session, L.load.id, 'decline', { reason: prompt('Reason (optional)') || '' });
        if (a === 'counter') { const v = +prompt('Your counter rate ($)', L.load.rate?.amount || ''); if (v > 0) await dd.respond(L.session, L.load.id, 'counter', { counter: { amount: v, currency: 'USD' } }); }
        if (a === 'status') await dd.status(L.session, L.load.id, b.dataset.s, S.pos ? { lat: S.pos.lat, lon: S.pos.lon } : {});
        if (a === 'pod') { const pod = await shrink(b.files[0]); await dd.status(L.session, L.load.id, 'delivered', { pod: { photo: pod, at: Date.now() }, ...(S.pos ? { lat: S.pos.lat, lon: S.pos.lon } : {}) }); toast('Delivered — POD sent'); }
        if (a === 'nav') return navigate(L); } catch (e) { toast(e.message); } renderLoads(); }; if (b.dataset.act === 'pod') b.onchange = go; else b.onclick = go; }); }); }
  async function shrink(file) { const img = await createImageBitmap(file), k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.6); }
  async function navigate(L) { const st = routeStops(L.load), pre = ['accepted', 'en_route_pickup', 'arrived_pickup'].includes(L.state);
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
    F.innerHTML = `<p class="small">Your friend code: <span class="code" id="myFriendCode">${fr.code}</span>${auth.user.username ? ' · @' + esc(auth.user.username) : ''}<br><img id="frQR" alt="QR" width="120" height="120" style="background:#fff;margin-top:4px"></p>
      <div class="row"><input id="frAdd" placeholder="Friend's code or @username" value="${esc(new URLSearchParams(location.search).get('friend') || '')}"><button id="frSend" class="primary">Send request</button></div><p id="frMsg" class="small muted"></p>
      ${fr.requests.map((r, i) => `<div class="fr-card">🤝 <b>${esc(r.from?.name || 'Driver')}</b>${r.from?.username ? ' @' + esc(r.from.username) : ''} wants to be friends <div class="row"><button class="primary" data-acc="${i}">Accept</button><button data-dec="${i}">Decline</button></div></div>`).join('')}
      ${fr.outgoing.map(o => `<div class="small muted">⏳ Request sent to ${esc(o.label)}</div>`).join('')}
      <h3>Sharing</h3><label class="small"><input type="checkbox" id="frGhost" ${fr.ghost ? 'checked' : ''}> 👻 Ghost mode (pause all sharing)</label><br>
      <label class="small"><input type="checkbox" id="frRoute" ${fr.routeShare ? 'checked' : ''}> Share my planned route with friends I share with</label><br>
      <label class="small">Auto-off: <select id="frTimer"><option value="0">Never</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="720">12 hours</option></select></label> ${fr.shareUntil ? `<span class="small muted">until ${new Date(fr.shareUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>` : ''}
      <h3>Friends (${fr.friends.length})</h3>${fr.friends.map(f => { const L = fr.live[f.pk], p = pr[f.pk]; return `<div class="fr-card" data-fr="${f.pk}"><b>${esc(f.truck?.icon || '🚛')} ${esc(f.name || 'Friend')}</b>${f.username ? ' @' + esc(f.username) : ''}
        <div class="small muted">${L?.loc ? 'Seen ' + ago(L.loc.t) : 'Not sharing with you right now'}${L?.route ? ' · route shared' : ''}</div>${p ? `<div class="small" data-pass>${esc(p.text)}</div>` : ''}
        <div class="row"><label class="small"><input type="checkbox" data-share ${f.share ? 'checked' : ''}> Share my location with ${esc(f.name || 'them')}</label><button class="small-btn" data-loc>Show</button><button class="small-btn danger" data-rm>Remove</button></div></div>`; }).join('') || '<p class="muted small">No friends yet.</p>'}`;
    $('#frTimer').value = fr.shareUntil ? [60, 240, 720].find(m => Math.abs(fr.shareUntil - Date.now() - m * 60e3) < m * 60e3) || 0 : 0;
    import('https://esm.sh/qrcode@1.5.4').then(q => q.toDataURL(link, { margin: 1 })).then(u => { const i = $('#frQR'); if (i) i.src = u; }).catch(() => $('#frQR')?.remove());
    $('#frSend').onclick = async () => { $('#frMsg').textContent = 'Sending…'; try { await fr.request($('#frAdd').value); $('#frMsg').textContent = 'Request sent — they need to accept.'; renderFriends(); } catch (e) { $('#frMsg').textContent = '⚠ ' + e.message; } };
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

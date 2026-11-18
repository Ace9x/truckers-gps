// Get dispatched, Driver Deals, and listing inquiries. RigRoute stays free. Nothing here charges a driver.
import { sb } from './cloud.js';
import { DEAL_CATS, withUtm } from './dealslogic.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OFFER = 'Ace Apps Dispatch: we find loads, negotiate rates and handle paperwork. 5% of linehaul, no contract.';
const SEEN = 'tn_dispatchSeen';

function openPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== id));
}

async function loadLists() {
  const S = window.TruckNav;
  const c = await sb();
  if (!c) { if (S) { S.partners = []; S.featured = []; } return; }
  const [partners, featured] = await Promise.all([
    c.from('rr_partners').select('name,category,blurb,url,logo_url,active,sort').order('sort'),
    c.from('rr_featured_listings').select('name,type,lat,lng,phone,url,active,expires_at'),
  ]);
  if (S) {
    S.partners = partners.error ? [] : (partners.data || []);
    S.featured = featured.error ? [] : (featured.data || []);
  }
}

function renderDeals() {
  const box = $('#dealsBody'); if (!box) return;
  const rows = (window.TruckNav?.partners || []).filter(r => r.active);
  if (!rows.length) { box.innerHTML = '<p id="dealsEmpty">Deals coming soon</p>'; return; }
  box.innerHTML = DEAL_CATS.map(cat => {
    const list = rows.filter(r => r.category === cat.id);
    if (!list.length) return '';
    return `<h3>${esc(cat.label)}</h3>` + list.map(r => {
      const href = withUtm(r.url);
      const name = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name);
      return `<div class="deal"><b>${name}</b>${r.blurb ? `<p class="small">${esc(r.blurb)}</p>` : ''}</div>`;
    }).join('');
  }).join('') || '<p id="dealsEmpty">Deals coming soon</p>';
}

function showCard() {
  if (localStorage.getItem(SEEN)) return;
  if (window.TruckNav?.nav || document.body.classList.contains('nav')) return;
  localStorage.setItem(SEEN, '1');
  let el = $('#dispatchAsk');
  if (!el) {
    el = document.createElement('aside');
    el.id = 'dispatchAsk';
    el.setAttribute('role', 'note');
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
  el.innerHTML = `<b>Get dispatched</b><p>${esc(OFFER)}</p><button type="button" id="dispatchAskGo">Tell us about your truck</button>`;
  $('#dispatchAskGo').onclick = () => { el.classList.add('hidden'); openPanel('dispatchPanel'); };
}

async function sendLead(row, table) {
  const c = await sb();
  if (!c) throw new Error('Can\'t reach the server right now. Try again in a minute.');
  const { error } = await c.from(table).insert(row, { returning: 'minimal' });
  if (error) throw new Error('Could not send that. Try again in a minute.');
}

function mount() {
  const me = $('#mePanel'); if (!me || $('#openDispatch')) return;
  const head = me.querySelector('.phead');
  head?.insertAdjacentHTML('afterend', `<div id="revEntry"><button type="button" id="openDispatch" class="big">Get dispatched</button><button type="button" id="openDeals" class="big">Driver Deals</button></div>`);
  $('#openDispatch').onclick = () => openPanel('dispatchPanel');
  $('#openDeals').onclick = () => { openPanel('dealsPanel'); renderDeals(); };
  if (!$('#dispatchPanel')) {
    document.body.insertAdjacentHTML('beforeend', `<section id="dispatchPanel" class="panel hidden"><div class="phead"><h2>Get dispatched</h2><button class="close" type="button">✕</button></div>
      <p>${esc(OFFER)}</p><p class="small">RigRoute stays free. This is a dispatch service, not a charge for the map.</p>
      <form id="dispatchForm">
        <label>Name<input id="dlName" required maxlength="80" autocomplete="name"></label>
        <label>Phone<input id="dlPhone" required maxlength="40" autocomplete="tel" inputmode="tel"></label>
        <label>Email<input id="dlEmail" required type="email" maxlength="120" autocomplete="email"></label>
        <label>MC / DOT number<input id="dlMc" maxlength="40" autocomplete="off"></label>
        <label>Equipment<select id="dlEq"><option value="dry van">Dry van</option><option value="reefer">Reefer</option><option value="flatbed">Flatbed</option><option value="box truck">Box truck</option><option value="hotshot">Hotshot</option></select></label>
        <label>Home base<input id="dlBase" maxlength="120" placeholder="City, state"></label>
        <label>Preferred lanes<input id="dlLanes" maxlength="400" placeholder="Example: NJ to the Southeast"></label>
        <input id="dlHp" tabindex="-1" autocomplete="off" aria-hidden="true" hidden>
        <button class="big" type="submit">Send</button><p id="dlMsg" class="small" role="status"></p>
      </form></section>
      <section id="dealsPanel" class="panel hidden"><div class="phead"><h2>Driver Deals</h2><button class="close" type="button">✕</button></div>
        <p class="small" id="dealsDisc">We may earn a commission.</p><div id="dealsBody"><p id="dealsEmpty">Deals coming soon</p></div>
        <button type="button" id="listBiz" class="big">List your business</button></section>
      <section id="listPanel" class="panel hidden"><div class="phead"><h2>List your business</h2><button class="close" type="button">✕</button></div>
        <p class="small">Tell us about a truck stop, shop, or other place drivers use. This does not put a pin on the navigation map.</p>
        <form id="listForm">
          <label>Your name<input id="lsName" required maxlength="80" autocomplete="name"></label>
          <label>Business<input id="lsBiz" required maxlength="120"></label>
          <label>Phone<input id="lsPhone" maxlength="40" inputmode="tel"></label>
          <label>Email<input id="lsEmail" required type="email" maxlength="120" autocomplete="email"></label>
          <label>What you offer<input id="lsKind" maxlength="80" placeholder="Truck stop, repair, parking"></label>
          <label>City<input id="lsCity" maxlength="80"></label>
          <label>Note<textarea id="lsNote" maxlength="500" rows="3"></textarea></label>
          <input id="lsHp" tabindex="-1" autocomplete="off" aria-hidden="true" hidden>
          <button class="big" type="submit">Send</button><p id="lsMsg" class="small" role="status"></p>
        </form></section>`);
    document.querySelectorAll('#dispatchPanel .close, #dealsPanel .close, #listPanel .close').forEach(b => b.onclick = () => document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden')));
    $('#listBiz').onclick = () => openPanel('listPanel');
    $('#dispatchForm').onsubmit = async e => { e.preventDefault(); const msg = $('#dlMsg'); if ($('#dlHp').value) { msg.textContent = "We'll call you."; return; }
      const row = { name: $('#dlName').value.trim(), phone: $('#dlPhone').value.trim(), email: $('#dlEmail').value.trim(), mc_dot: $('#dlMc').value.trim() || null, equipment: $('#dlEq').value, home_base: $('#dlBase').value.trim() || null, lanes: $('#dlLanes').value.trim() || null };
      if (row.name.length < 1 || row.phone.length < 7 || !row.email.includes('@')) { msg.textContent = 'Add your name, a phone number, and an email.'; return; }
      msg.textContent = 'Sending…';
      try { await sendLead(row, 'rr_dispatch_leads'); $('#dispatchForm').innerHTML = '<p id="dlDone">We\'ll call you.</p>'; } catch (err) { msg.textContent = err.message; } };
    $('#listForm').onsubmit = async e => { e.preventDefault(); const msg = $('#lsMsg'); if ($('#lsHp').value) { msg.textContent = 'Thanks. We got it.'; return; }
      const row = { name: $('#lsName').value.trim(), business: $('#lsBiz').value.trim(), phone: $('#lsPhone').value.trim() || null, email: $('#lsEmail').value.trim(), kind: $('#lsKind').value.trim() || null, city: $('#lsCity').value.trim() || null, note: $('#lsNote').value.trim() || null };
      if (row.name.length < 1 || row.business.length < 1 || !row.email.includes('@')) { msg.textContent = 'Add your name, the business, and an email.'; return; }
      msg.textContent = 'Sending…';
      try { await sendLead(row, 'rr_listing_inquiries'); $('#listForm').innerHTML = '<p id="lsDone">Thanks. We got it.</p>'; } catch (err) { msg.textContent = err.message; } };
  }
  const S = window.TruckNav; if (!S || S.endNav?.__deals) return;
  const prev = S.endNav; if (typeof prev !== 'function') return;
  const wrapped = (...a) => { const arrived = !!S.arrived; const r = prev(...a); if (arrived && !S.nav) showCard(); return r; };
  wrapped.__deals = true; S.endNav = wrapped;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mount(); loadLists(); });
else { mount(); loadLists(); }

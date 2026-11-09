// Growth: deep links (?to=lat,lng&name=), Share ETA, invite-a-driver (?ref= saved on this phone), and Add to Home Screen.
let S; const $ = s => document.querySelector(s);
export const APP_URL = 'https://ace9x.github.io/truckers-gps/';
export function cleanRef(s) { const v = String(s || '').trim(); return /^[a-z0-9_-]{1,24}$/i.test(v) ? v : ''; }
export function installMilestone(n) { return n >= 10 ? 10 : n >= 3 ? 3 : n >= 1 ? 1 : 0; }
export function myRefCode() { let c = ''; try { c = localStorage.getItem('tn_ref_code') || ''; } catch {} if (!cleanRef(c)) { c = Math.random().toString(36).slice(2, 8); try { localStorage.setItem('tn_ref_code', c); } catch {} } return c; }
export const inviteLink = () => `${APP_URL}welcome/?ref=${myRefCode()}`;
function rememberRef(search) { const ref = cleanRef(new URLSearchParams(search).get('ref')); if (!ref) return; try { localStorage.setItem('tn_ref_from', ref); } catch {} }
export function parseTo(search) { const q = new URLSearchParams(search), to = q.get('to'); if (!to) return null; const [lat, lon] = to.split(',').map(Number);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || isNaN(lat) || isNaN(lon)) return null; return { lat, lon, name: (q.get('name') || 'Shared destination').slice(0, 120) }; }
export const routeLink = (lat, lon, name) => `${APP_URL}?to=${(+lat).toFixed(5)},${(+lon).toFixed(5)}&name=${encodeURIComponent(name || '')}`;
function deepLink() { const d = parseTo(location.search); if (!d) return; const u = new URL(location.href); u.searchParams.delete('to'); u.searchParams.delete('name'); history.replaceState(null, '', u);
  const go = () => S.ready && S.setDest ? (S.setDest(d), S.toast?.(`📍 Route to ${d.name} from your dispatcher's link`)) : setTimeout(go, 300); go(); }
function etaText() { const r = S.route; if (!r || !S.dest) return null; const left = S.nav ? Math.max(0, r.length - (S.along || 0)) : r.length, sec = r.time * left / r.length, eta = new Date(Date.now() + sec * 1000);
  return `🚛 Heading to ${S.dest.name}. ETA ${eta.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (${Math.round(left / 1609.34)} mi) — routed truck-safe with RigRoute`; }
async function shareEta() { const text = etaText(); if (!text) return; const url = routeLink(S.dest.lat, S.dest.lon, S.dest.name); S.lastShare = { text, url };
  try { if (navigator.share) { await navigator.share({ title: 'My ETA', text, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); S.toast?.('ETA copied — paste it in a text'); } catch { S.toast?.(text); } }
function shareBtn() { const rp = $('#routePanel'); if (!rp || $('#shareEta')) return; const go = $('#goBtn'); if (!go) return; const b = document.createElement('button'); b.id = 'shareEta'; b.className = 'link-btn'; b.textContent = '↗ Share ETA'; b.onclick = shareEta; (($('#demoBtn')) || go).after(b); }
// Install: a button in Me always, plus a prompt after completed trips 1, 3 and 10. Never while driving.
let deferred = null; const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const iosGuide = () => `<ol class="a2hs">${[
  ['↗', 'Tap Share', 'The square with an arrow, in the Safari bar.'],
  ['＋', 'Add to Home Screen', 'Scroll the share sheet and tap Add to Home Screen.'],
  ['🚛', 'Open RigRoute', 'Tap Add, then open the icon on your home screen.'],
].map(([ic, t, d]) => `<li><b aria-hidden="true">${ic}</b><span><strong>${t}</strong><small>${d}</small></span></li>`).join('')}</ol>`;
function loadMarks() { let m = null; try { m = JSON.parse(localStorage.getItem('tn_installMarks') || 'null'); } catch { m = null; } if (!Array.isArray(m)) m = localStorage.getItem('tn_installAsked') ? [1] : []; return m; }
function noteInstall(auto) { if (!auto) return; const m = installMilestone(S.trips?.().length || 0); const marks = loadMarks(); if (m && !marks.includes(m)) { marks.push(m); try { localStorage.setItem('tn_installMarks', JSON.stringify(marks)); localStorage.setItem('tn_installAsked', String(Date.now())); } catch {} } }
export async function shareInvite() {
  const url = inviteLink(), text = 'Free truck GPS. No account. Set your height and it routes around low bridges. Works when the signal dies.';
  try { if (navigator.share) { await navigator.share({ title: 'RigRoute GPS', text, url }); return 'shared'; } } catch (e) { if (e?.name === 'AbortError') return 'abort'; }
  try { await navigator.clipboard.writeText(text + ' ' + url); S.toast?.('Invite link copied'); return 'copied'; } catch { S.toast?.(url); return 'shown'; }
}
function openInstall({ auto = false } = {}) {
  $('#installCard')?.remove();
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const c = document.createElement('div'); c.id = 'installCard'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Add to Home Screen');
  const native = !!deferred && !installed();
  c.innerHTML = `<b>${installed() ? 'RigRoute is on your home screen' : 'Add RigRoute to your home screen'}</b><p>Opens full screen and keeps working when the signal dies. Helper, not an ELD. Always obey posted signs.</p>${installed() || native ? '' : (ios ? iosGuide() : '<p class="small">Open the browser menu and choose Install app.</p>')}<div class="row">${native ? '<button class="primary" data-inst>Install</button>' : ''}<button class="primary" data-invite>Invite a driver</button><button data-instno>Not now</button></div>`;
  document.body.appendChild(c);
  const done = () => { noteInstall(auto); c.remove(); };
  c.querySelector('[data-instno]').onclick = done;
  c.querySelector('[data-invite]').onclick = () => { shareInvite(); };
  const i = c.querySelector('[data-inst]'); if (i) i.onclick = async () => { try { deferred.prompt(); const r = await deferred.userChoice.catch(() => ({})); S.installChoice = r?.outcome; if (r?.outcome === 'accepted') { const { mark } = await import('./funnel.js'); mark('install'); } deferred = null; } catch {} done(); };
  return c;
}
function installCard() {
  if (installed()) { if (!installCard.noted) { installCard.noted = true; import('./funnel.js').then(m => m.mark('install')).catch(() => {}); } return; }
  const busy = S.nav || document.querySelector('.panel:not(.hidden), #truckWiz, #tourCard');
  if (busy || $('#installCard')) return;
  const n = S.trips?.().length || 0, mile = installMilestone(n);
  if (!mile || loadMarks().includes(mile)) return;
  openInstall({ auto: true });
}
function mountSettings() {
  const me = $('#mePanel'); if (!me || $('#installSettings')) return;
  const row = document.createElement('div'); row.className = 'grow-row';
  row.innerHTML = `<button type="button" id="installSettings" class="big">Add to Home Screen</button><button type="button" id="inviteDriver" class="big">Invite a driver</button>`;
  me.querySelector('.phead')?.after(row);
  $('#installSettings').onclick = () => openInstall({ auto: false });
  $('#inviteDriver').onclick = () => shareInvite();
}
export function start() { S = window.TruckNav; rememberRef(location.search); try { const u = new URL(location.href); if (u.searchParams.has('ref')) { u.searchParams.delete('ref'); history.replaceState(null, '', u); } } catch {} addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; S.canInstall = true; });
  S.growth = { shareEta, etaText, routeLink, parseTo, shareInvite, inviteLink, openInstall, myRefCode };
  import('./funnel.js').then(m => m.tickFunnel()).catch(() => {});
  deepLink(); setInterval(() => { shareBtn(); mountSettings(); installCard(); }, 1500); }

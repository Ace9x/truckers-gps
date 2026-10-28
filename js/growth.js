// Growth: deep links (?to=lat,lng&name=) so dispatchers can text a route, "Share ETA" via the share sheet, install prompt after the first real trip.
let S; const $ = s => document.querySelector(s);
export const APP_URL = 'https://ace9x.github.io/truckers-gps/';
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
// install prompt: only after the first completed (non-demo) trip, never while driving
let deferred = null; const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function installCard() { const busy = S.nav || document.querySelector('.panel:not(.hidden)'); if (busy) { $('#installCard')?.remove(); return; } if (installed() || S.nav || localStorage.getItem('tn_installAsked') || $('#installCard') || !(S.trips?.().length >= 1)) return; if (!$('#tripReceipt') && document.querySelector('.panel:not(.hidden)')) return;
  const ios = /iPhone|iPad/.test(navigator.userAgent) && !deferred; if (!deferred && !ios) return;
  const c = document.createElement('div'); c.id = 'installCard'; c.setAttribute('role', 'dialog'); c.innerHTML = `<b>Keep RigRoute on your home screen</b><p>Opens full screen, keeps voice and maps working in dead zones.</p>${ios ? '<p class="small">Tap <b>Share</b> → <b>Add to Home Screen</b>.</p>' : ''}<div class="row">${ios ? '' : '<button class="primary" data-inst>Install</button>'}<button data-instno>Not now</button></div>`;
  document.body.appendChild(c); const done = () => { localStorage.setItem('tn_installAsked', Date.now()); c.remove(); };
  c.querySelector('[data-instno]').onclick = done; const i = c.querySelector('[data-inst]'); if (i) i.onclick = async () => { deferred.prompt(); const r = await deferred.userChoice.catch(() => ({})); S.installChoice = r?.outcome; deferred = null; done(); }; }
export function start() { S = window.TruckNav; addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; S.canInstall = true; }); S.growth = { shareEta, etaText, routeLink, parseTo };
  deepLink(); setInterval(() => { shareBtn(); installCard(); }, 1500); }

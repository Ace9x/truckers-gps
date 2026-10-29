// Plain-language help: a "?" Help button on every panel (with Read aloud), tap-to-explain terms (HOS, ETA, POD, BOL…),
// and empty-state hints. All text goes through t(), so it follows the chosen language.
import { t, speechLang, I18N } from './i18n.js';
const $ = (s, r = document) => r.querySelector(s);
export const TERMS = {
  HOS: 'HOS means Hours of Service. These are the rules for how long you may drive and work before you must rest.',
  ETA: 'ETA means the time we think you will get there.',
  POD: 'POD means proof of delivery. It is the paper or photo that shows you dropped off the load.',
  BOL: 'BOL means bill of lading. It is the paper that lists what you are hauling and who it is for.',
  CDL: 'CDL means commercial driver\'s license. You need it to drive a big truck.',
  ELD: 'ELD means electronic logging device. It is the box or app that keeps your legal driving log.',
  OTR: 'OTR means over the road. You drive long trips and are away from home for days.',
  Hazmat: 'Hazmat means dangerous goods, like fuel or chemicals. Some roads and tunnels do not allow them.',
  Reefer: 'A reefer is a trailer or van with a cooler that keeps the load cold.',
  Bobtail: 'Bobtail means driving the truck with no trailer.',
  PO: 'PO means purchase order. It is the number the shipper uses for this load.',
  DOT: 'DOT means Department of Transportation. They make and check the road rules for trucks.',
};
const RE = new RegExp(`(^|[^A-Za-z])(${Object.keys(TERMS).join('|')})(?![A-Za-z])`, 'i');
export const HELP = {
  searchPanel: ['Find a place', 'Type an address, a city, or a company name. Tap a result to see the route. You can also press and hold the map to pick a spot.', 'Nothing here yet. Type where you want to go.'],
  routePanel: ['Your route', 'Pick a route, then tap Start. The phone will tell you each turn out loud. The route keeps away from low bridges and roads closed to trucks.', 'No route yet. Tap "Where to?" and pick a place.'],
  hosPanel: ['Driving hours', 'This shows how long you can still drive today. Tap the button that matches what you are doing now. This is a helper only. Your company\'s ELD is your legal log.', 'No hours logged today. Tap Driving when you start.'],
  loadPanel: ['Your load', 'Write down the load number, pickup, and drop-off. Tap a button to get the route there. This is saved only on this phone.', 'No load yet. Fill in the pickup and drop-off.'],
  truckPanel: ['Your truck', 'Enter how tall, heavy, and long your truck is. We use this to keep you off roads that are too low or not allowed for trucks.', 'Pick a truck type or enter your sizes.'],
  reportPanel: ['Report a problem', 'Tap a picture to tell other drivers about a crash, police, road work, or a closed road just ahead of you.', 'You have not blocked any roads yet.'],
  facPanel: ['Gate and notes', 'Move the map so the + is on the truck gate. Then tap Set truck entrance. Next time, the route goes right to that gate.', 'No notes yet. Add the gate code or dock number.'],
  mePanel: ['Me', 'See your points and badges. Change your name, language, and voice here.', 'No badges yet. Drive and report problems to earn them.'],
  dispatch: ['Dispatch console', 'Add your drivers. Make a load with a pickup and a drop-off, then send it to a driver. You can see where each driver is and if the load is done.', 'No loads yet. Tap New load to make one.'],
  layersPanel: ['Map layers', 'Turn things on or off on the map, like traffic, fuel, and driver reports.', ''],
};
const EMPTY = { avoidList: 'You have not blocked any roads yet.', hosLog: 'No hours logged today. Tap Driving when you start.', badges: 'No badges yet. Drive and report problems to earn them.', leader: 'No one on the board yet this week.', results: 'Nothing here yet. Type where you want to go.' };

export function speak(text) {
  const v = window.TruckNav?.voice; try { if (v?.say) return v.say(text, 'help', true); } catch {}
  try { const u = new SpeechSynthesisUtterance(text); u.lang = I18N.speakEnglish ? 'en-US' : speechLang(); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
}
function sheet(title, body, extra = '') {
  $('#helpSheet')?.remove(); const d = document.createElement('div'); d.id = 'helpSheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.innerHTML = `<div class="hs-card"><h2><span aria-hidden="true">💡</span> <span class="hs-t"></span></h2><p class="hs-b"></p>${extra}<div class="row"><button type="button" class="big hs-read">🔊 <span>Read aloud</span></button><button type="button" class="big primary hs-close">✓ <span>Got it</span></button></div></div>`;
  $('.hs-t', d).textContent = title; $('.hs-b', d).textContent = body;
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('.hs-close')) { try { speechSynthesis.cancel(); } catch {} d.remove(); } });
  $('.hs-read', d).onclick = () => speak(`${t(title)}. ${t(body)}`);
  document.body.appendChild(d); $('.hs-close', d).focus(); return d;
}
export function showHelp(id) { const h = HELP[id]; if (!h) return;
  const d = sheet(h[0], h[1], `<button type="button" class="small-btn hs-tour">▶ <span>Show me how (tour)</span></button>`);
  $('.hs-tour', d).onclick = () => { d.remove(); document.querySelector('.panel:not(.hidden) .close')?.click(); window.TruckNav?.startTour?.(); }; }
export function explain(term) { const k = Object.keys(TERMS).find(x => x.toLowerCase() === term.toLowerCase()); if (k) sheet(k, TERMS[k]); }

function addHelpButtons() { const dh = document.querySelector('.fx-tabs'); if (dh && !document.querySelector('.help-q[data-help=dispatch]')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'help-q help-disp'; b.dataset.help = 'dispatch'; b.setAttribute('aria-label', 'Help'); b.innerHTML = '? <span>Help</span>'; dh.before(b); }
  for (const id of Object.keys(HELP)) { const head = $(`#${id} .phead`); if (!head || $('.help-q', head)) continue;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'help-q'; b.dataset.help = id; b.setAttribute('aria-label', 'Help'); b.title = 'Help'; b.textContent = '?';
  head.insertBefore(b, $('.close', head)); } }
const SKIP = 'button,select,option,input,textarea,a,script,style,[translate=no],.gl,#helpSheet,#tourCard,#langFirst,svg';
function addTerms(root = document.body) {
  const els = root.querySelectorAll('.panel label, .panel h2, .panel h3, .panel summary, .panel .warnnote b, .panel .hosGrid span, .fx-tabs + * label, .fx-panel h3, .fx-panel label, .fx-panel th');
  for (const el of els) { if (el.closest(SKIP) || el.querySelector(':scope > .gl')) continue;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' '); const m = txt.match(RE); if (!m) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'gl'; b.dataset.term = m[2]; b.setAttribute('aria-label', `What is ${m[2]}?`); b.textContent = '?';
    const firstCtl = el.querySelector(':scope > input, :scope > select, :scope > textarea'); el.insertBefore(b, firstCtl || null); } }
function emptyHints() { for (const [id, msg] of Object.entries(EMPTY)) { const c = document.getElementById(id); if (!c) continue;
  let h = c.nextElementSibling?.classList.contains('empty-hint') ? c.nextElementSibling : null;
  if (!h) { h = document.createElement('p'); h.className = 'empty-hint'; h.innerHTML = `<span aria-hidden="true">👉</span> <span></span>`; h.lastChild.textContent = msg; c.after(h); }
  const empty = !c.children.length && !c.textContent.trim(); if (h.hidden === empty) h.hidden = !empty; } }
let pending = 0;
function scan() { pending = 0; addHelpButtons(); addTerms(); emptyHints(); }
const CSS = "/* ---- plain-language help, glossary, empty states, bigger tap targets ---- */.help-q{margin-inline-start:auto;min-width:44px;min-height:44px;border-radius:50%;font-weight:800;font-size:20px;background:#2b6cff;color:#fff;border:0}.phead .help-q + .close{margin-inline-start:6px}.help-disp{position:fixed;inset-inline-end:12px;bottom:14px;z-index:50;border-radius:22px;padding:0 16px;width:auto;box-shadow:0 2px 10px #0006}.gl{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;min-height:26px;padding:0;margin:0 6px;border-radius:50%;border:2px solid #2b6cff;background:transparent;color:#2b6cff;font-weight:800;font-size:14px;vertical-align:middle;position:relative}.gl::after{content:'';position:absolute;inset:-9px} /* 44px tap area */#helpSheet{position:fixed;inset:0;z-index:3000;background:#000a;display:flex;align-items:flex-end;justify-content:center}#helpSheet .hs-card{background:#14181f;color:#fff;max-width:560px;width:100%;border-radius:18px 18px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom))}#helpSheet h2{margin:0 0 8px;font-size:22px} #helpSheet .hs-b{font-size:19px;line-height:1.5;margin:0 0 14px}#helpSheet .row{gap:10px} #helpSheet .row button{flex:1;min-height:52px;font-size:18px} #helpSheet .hs-tour{margin-bottom:12px;min-height:44px}.empty-hint{color:#9fb3c8;font-size:16px;margin:6px 0;padding:10px 12px;border:1px dashed #9fb3c866;border-radius:10px}#tourCard .tpic{font-size:56px;text-align:center;line-height:1.1;margin-bottom:6px}";
export function mount() {
  if (!document.getElementById('rrHelpCss')) { const st = document.createElement('style'); st.id = 'rrHelpCss'; st.textContent = CSS; document.head.appendChild(st); }
  scan(); new MutationObserver(() => { if (!pending) pending = setTimeout(scan, 400); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', e => { const g = e.target.closest('.gl'); if (g) { e.preventDefault(); e.stopPropagation(); return explain(g.dataset.term); }
    const h = e.target.closest('.help-q'); if (h) { e.preventDefault(); showHelp(h.dataset.help); } }, true);
}
if (typeof window !== 'undefined') window.RRHelp = { showHelp, explain, speak, TERMS, HELP };

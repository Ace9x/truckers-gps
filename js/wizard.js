// Truck profile wizard (app_polish_ideas §5; dispatcher: confirm height before the first route). 4 steps, 64px steppers, live silhouette.
let S; const $ = s => document.querySelector(s), DONE = 'tn_truckSetDone';
import { VEHICLES } from './logic.js';
const STEPS = [
  { k: 'vehicle', title: 'What are you driving?', hint: 'Sets how we route: cars use normal roads; vans and trucks get size, weight and commercial-vehicle rules.' },
  { k: 'height', title: 'How tall is your rig?', hint: 'Measure the highest point — trailer roof, reefer unit or load.', min: 96, max: 162, step: 1, fmt: v => `${Math.floor(v / 12)}′${v % 12}″` },
  { k: 'weight', title: 'Gross weight', hint: 'Loaded weight including trailer. Bridges post limits in tons or pounds.', min: 6000, max: 120000, step: 1000, fmt: v => `${v.toLocaleString()} lb` },
  { k: 'length', title: 'Overall length', hint: 'Bumper to bumper, tractor plus trailer.', min: 20, max: 100, step: 1, fmt: v => `${v} ft` },
  { k: 'hazmat', title: 'Hauling hazmat?', hint: 'Placarded loads are kept out of restricted tunnels and roads.' },
  { k: 'voice', title: 'Spoken directions?', hint: 'Voice keeps your eyes on the road: turns, low bridges, weigh stations and HOS warnings are read out. You can mute any time with 🔊.' }];
export const done = () => localStorage.getItem(DONE) === '1';
function silhouette(v) { const h = 20 + (v.height - 96) / 66 * 50, L = 120 + (v.length - 20) / 80 * 160;
  return `<svg viewBox="0 0 320 110" aria-hidden="true" class="wz-truck"><line x1="0" y1="100" x2="320" y2="100" stroke="#3a424d" stroke-width="2"/>
  <rect x="${300 - L}" y="${92 - h}" width="${L - 52}" height="${h}" rx="3" fill="#2b333f" stroke="#a3a9b3" stroke-width="2"/>
  <path d="M${250} 92 V${62} h26 l18 14 V92 Z" fill="#ff9500"/><circle cx="${308 - L + 18}" cy="96" r="7" fill="#111" stroke="#a3a9b3" stroke-width="2"/><circle cx="${238}" cy="96" r="7" fill="#111" stroke="#a3a9b3" stroke-width="2"/><circle cx="280" cy="96" r="7" fill="#111" stroke="#a3a9b3" stroke-width="2"/>
  ${v.hazmat ? `<path d="M${300 - L / 2 - 30} ${92 - h / 2 - 9} l9 -9 9 9 -9 9 Z" fill="#ff6b6b"/>` : ''}
  <line x1="${304}" y1="${92 - h}" x2="${316}" y2="${92 - h}" stroke="#facc15" stroke-width="2"/><line x1="310" y1="${92 - h}" x2="310" y2="100" stroke="#facc15" stroke-width="2" stroke-dasharray="3 3"/></svg>`; }
export function open(after) { if ($('#truckWiz')) return; const t = S.truck || {}; const v = { vehicle: VEHICLES[t.vehicle] ? t.vehicle : 'semi', height: (+t.heightFt || 13) * 12 + (+t.heightIn || 0), weight: +t.weightLbs || 80000, length: +t.lengthFt || 70, hazmat: !!t.hazmat, voice: S.voiceObj ? S.voiceObj.enabled !== false : true }; let i = 0; const steps = () => STEPS.filter(x => x.k === 'vehicle' || x.k === 'voice' || (v.vehicle !== 'car' && !(x.k === 'hazmat' && VEHICLES[v.vehicle].commercial)));
  const el = document.createElement('section'); el.id = 'truckWiz'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Set up your vehicle'); document.body.appendChild(el);
  const draw = () => { const ST = steps(), s = ST[i], last = i === ST.length - 1;
    el.innerHTML = `<div class="wz-card"><div class="wz-top"><span class="wz-step">Step ${i + 1} of ${ST.length}</span><button class="wz-x" aria-label="Close">✕</button></div>
      <div class="wz-dots">${ST.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div>${v.vehicle === 'car' || s.k === 'vehicle' ? '' : silhouette(v)}
      <h2>${s.title}</h2><p class="wz-hint">${s.hint}</p>
      ${s.k === 'vehicle' ? `<div class="wz-veh" role="radiogroup">${Object.entries(VEHICLES).map(([k, o]) => `<button role="radio" aria-checked="${v.vehicle === k}" data-vtype="${k}" class="${v.vehicle === k ? 'on' : ''}"><span>${o.icon}</span>${o.label}</button>`).join('')}</div>${VEHICLES[v.vehicle].commercial ? '<p class="wz-hint">Commercial plates: NYC parkways are closed to you — we route around them.</p>' : ''}` : s.k === 'voice' ? `<div class="wz-yn"><button data-vo="1" class="${v.voice ? 'on' : ''}">🔊 Voice on</button><button data-vo="0" class="${!v.voice ? 'on' : ''}">🔇 Silent</button></div><button class="wz-back" data-vprev type="button">▶ Hear a sample</button>` : s.k === 'hazmat' ? `<div class="wz-yn"><button data-hz="0" class="${!v.hazmat ? 'on' : ''}">No hazmat</button><button data-hz="1" class="${v.hazmat ? 'on' : ''}">Yes, placarded</button></div>`
        : `<div class="wz-stepper"><button data-d="-1" aria-label="Less">−</button><output aria-live="polite">${s.fmt(v[s.k])}</output><button data-d="1" aria-label="More">+</button></div>`}
      <div class="wz-nav"><button class="wz-back" ${i ? '' : 'disabled'}>Back</button><button class="wz-next">${last ? (v.vehicle === 'car' ? 'Save car' : 'Save vehicle') : 'Next'}</button></div></div>`;
    el.querySelector('.wz-x').onclick = () => el.remove(); el.querySelector('.wz-back').onclick = () => { i--; draw(); };
    el.querySelectorAll('[data-d]').forEach(b => { let rep; const bump = () => { v[s.k] = Math.max(s.min, Math.min(s.max, v[s.k] + +b.dataset.d * s.step)); el.querySelector('output').textContent = s.fmt(v[s.k]); el.querySelector('.wz-truck').outerHTML = silhouette(v); };
      b.onpointerdown = () => { bump(); rep = setTimeout(function r() { bump(); rep = setTimeout(r, 90); }, 450); }; b.onpointerup = b.onpointerleave = () => clearTimeout(rep); b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bump(); } }; });
    el.querySelectorAll('[data-vtype]').forEach(b => b.onclick = () => { v.vehicle = b.dataset.vtype; const p = VEHICLES[v.vehicle].preset; v.height = p.heightFt * 12 + (p.heightIn || 0); v.weight = p.weightLbs; v.length = p.lengthFt; if (p.hazmat === false) v.hazmat = false; draw(); });
    el.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => { v.hazmat = b.dataset.hz === '1'; draw(); });
    el.querySelectorAll('[data-vo]').forEach(b => b.onclick = () => { v.voice = b.dataset.vo === '1'; draw(); }); const vp = el.querySelector('[data-vprev]'); if (vp) vp.onclick = () => { try { const u = new SpeechSynthesisUtterance('In half a mile, keep right for the truck route. Low bridge ahead: 12 feet 6.'); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {} };
    el.querySelector('.wz-next').onclick = () => { if (!last) { i++; draw(); return; } save(); }; };
  const save = () => { S.setTruck({ ...VEHICLES[v.vehicle].preset, vehicle: v.vehicle, heightFt: Math.floor(v.height / 12), heightIn: v.height % 12, weightLbs: v.weight, lengthFt: v.length, hazmat: v.hazmat }); localStorage.setItem(DONE, '1'); if (S.voiceObj && S.voiceObj.enabled !== v.voice) { S.voiceObj.enabled = v.voice; try { localStorage.setItem('tn_voice', JSON.stringify(v.voice)); } catch {} const mb = $('#muteBtn'); if (mb) mb.textContent = v.voice ? '🔊' : '🔇'; }
    el.innerHTML = `<div class="wz-card wz-saved"><svg viewBox="0 0 52 52" class="wz-check" aria-hidden="true"><circle cx="26" cy="26" r="24" fill="none" stroke="#4ade80" stroke-width="3"/><path d="M15 27l7 7 15-16" fill="none" stroke="#4ade80" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>Profile saved</h2><p>Routes now avoid bridges under ${Math.floor(v.height / 12)}′${v.height % 12}″${v.weight ? ` and limits under ${Math.round(v.weight / 1000)}k lb` : ''}${v.hazmat ? ', plus hazmat-restricted roads' : ''}.</p><p class="wz-hint">Next: when you start, we ask for your location — it's only used on this phone to guide you and warn about hazards ahead.</p><button class="wz-next">Done</button></div>`;
    el.querySelector('.wz-next').onclick = () => { el.remove(); after?.(); }; };
  draw(); }
export function start() { S = window.TruckNav;
  // before the first route, confirm the truck (default height can be wrong)
  document.addEventListener('click', e => { const g = e.target.closest('#goBtn, #demoBtn'); if (!g || done() || navigator.webdriver) return; e.preventDefault(); e.stopImmediatePropagation(); open(async () => { if (S.dest && S.plan) { try { await S.plan(); } catch {} } g.click(); }); }, true);
  setInterval(() => { const tp = $('#truckPanel'); if (tp && !$('#wizOpen')) { const b = document.createElement('button'); b.id = 'wizOpen'; b.className = 'small-btn'; b.textContent = 'Step-by-step truck setup'; tp.querySelector('.phead')?.after(b); b.onclick = () => open(); } }, 1000);
  S.truckWizard = open; }

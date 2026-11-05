// ONE source of truth for explaining the app: the first-run tour, the "Show me around" walkthrough and Ask RigRoute answers
// are all generated from GUIDE (+ data/changelog.json for "what changed?"). Add a section here and it is explained everywhere.
import { t } from './i18n.js';
export const GUIDE = [
  { id: 'truck', pic: '🚛', sel: '[data-panel=truckPanel]', tour: true, t: 'Tell us about your truck', b: 'Tap Truck. Enter how tall, heavy, and long it is. Then we keep you away from low bridges and roads trucks can\'t use.', k: 'truck height weight length bridge setup size' },
  { id: 'search', pic: '🔍', sel: '#searchBtn', tour: true, t: 'Pick where to go', b: 'Tap here and type an address or a company name. Then tap Start. The phone tells you every turn out loud.', k: 'search address go destination start navigate' },
  { id: 'route', pic: '🧭', sel: '[data-panel=routePanel]', tour: true, t: 'Route: your trip', b: 'Tap Route to see your way there, how long it takes, tolls and fuel stops. You can save maps here for places with no signal.', k: 'route trip tolls fuel offline map eta' },
  { id: 'switch', pic: '⚡', sel: '[data-panel=routePanel]', tour: false, t: 'Faster route: Switch or Keep', b: 'If traffic builds up, RigRoute tells you about a faster truck-safe road. Tap Switch to take it or Keep to stay. It never changes your route by itself.', k: 'traffic faster reroute switch keep jam detour' },
  { id: 'hos', pic: '⏱', sel: '[data-panel=hosPanel]', tour: true, t: 'HOS: your driving clock', b: 'Tap HOS to see how many hours you can still drive today and when your break is due. It is a helper, not your legal log.', k: 'hos hours clock break drive time log' },
  { id: 'load', pic: '📦', sel: '[data-panel=loadPanel]', tour: true, t: 'Load: your job', b: 'Tap Load for your pickup, drop-off, times and papers like the BOL. Loads your dispatcher sends you show up here.', k: 'load pickup delivery bol dispatcher papers job' },
  { id: 'report', pic: '📣', sel: '#reportBtn', tour: true, t: 'Warn other drivers', b: 'See a crash, police, or road work? Tap here. Other drivers will see it on their map.', k: 'report crash police hazard warn road work' },
  { id: 'me', pic: '😎', sel: '#meBtn', tour: true, t: 'Me: you and your settings', b: 'Tap Me for your points, friends, account, language and voice. Something broken or have an idea? Use Report a Bug / Suggestion there.', k: 'me settings account language voice friends points' },
  { id: 'grow', pic: '📍', sel: '#meBtn', tour: false, t: 'Help RigRoute grow', b: 'In Me you can choose to share your city and state, never your exact spot. It is off unless you turn it on.', k: 'privacy city state share location grow area' },
  { id: 'bug', pic: '🐞', sel: '#meBtn', tour: false, t: 'Report a Bug / Suggestion', b: 'In Me, open Report a Bug / Suggestion. Say what went wrong or what to add. You can add a screenshot.', k: 'bug broken problem suggestion idea feedback' },
  { id: 'email', pic: '✉️', sel: '#meBtn', tour: false, t: 'Email us', b: 'In Me, under Report a Bug, tap Email us to write to the RigRoute team.', k: 'email contact support team help' },
  { id: 'help', pic: '❓', sel: '#helpBtn', tour: true, t: 'Need help?', b: 'Tap ? on any screen. It tells you what the screen does, and it can read it out loud. You can also type a question or tap Show me around.', k: 'help question ask explain' },
];
export const tourSteps = () => GUIDE.filter(g => g.tour);
export const walkSteps = () => GUIDE; // whole app, section by section
let CL = null; export async function changelog() { if (CL) return CL; try { CL = await fetch('data/changelog.json').then(r => r.json()); } catch { CL = []; } return CL; }
const STOP = new Set('how what when where why who can the and you your for are does with this that use get see tap'.split(' '));
const words = s => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => !STOP.has(w)).map(w => w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
export function answer(q, log = []) { const w = words(q); if (!w.length) return null;
  if (w.some(x => ['new', 'changed', 'change', 'update', 'updates', 'whats'].includes(x))) { const e = log[0]; if (e) return { t: t('What\'s new') + ` (${e.date})`, b: e.items.map(i => t(i)).join(' ') }; }
  let best = null, sc = 0; for (const g of GUIDE) { const hay = new Set(words(`${g.t} ${g.b} ${g.k}`)); const s = w.filter(x => x.length > 2 && hay.has(x)).length; if (s > sc) { sc = s; best = g; } }
  return best ? { t: t(best.t), b: t(best.b), id: best.id } : null; }
// "Show me around": highlight each section and explain it. While moving: voice only (no cards or rings on screen).
export function walk(S) { const say = s => { try { const u = new SpeechSynthesisUtterance(s); u.lang = document.documentElement.lang || 'en'; speechSynthesis.speak(u); } catch {} };
  const moving = () => (S?.pos?.speed || 0) > 2.2; let i = 0; const steps = walkSteps(); stop();
  if (moving()) { steps.forEach(g => say(`${t(g.t)}. ${t(g.b)}`)); return { voiceOnly: true, n: steps.length }; }
  document.body.insertAdjacentHTML('beforeend', '<div id="walkRing" style="position:fixed;z-index:70;border:4px solid #ff9500;border-radius:14px;pointer-events:none;box-shadow:0 0 0 9999px #0007"></div><div id="walkCard" role="dialog" aria-live="polite" style="position:fixed;left:12px;right:12px;bottom:calc(20px + env(safe-area-inset-bottom));z-index:71;background:#161b22;color:#e6edf3;border-radius:16px;padding:14px"></div>');
  const ring = document.getElementById('walkRing'), card = document.getElementById('walkCard');
  const show = () => { const g = steps[i], el = g.sel && document.querySelector(g.sel), r = el?.getBoundingClientRect();
    if (r?.width) Object.assign(ring.style, { display: '', left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' }); else ring.style.display = 'none';
    card.innerHTML = `<div style="font-size:28px">${g.pic}</div><b>${t(g.t)}</b><p>${t(g.b)}</p><div style="display:flex;gap:8px"><button class="big" id="walkStop" style="flex:1">${t('Stop')}</button><button class="big primary" id="walkNext" style="flex:1">${t(i < steps.length - 1 ? 'Next' : 'Done')}</button></div><div class="small muted">${i + 1} / ${steps.length}</div>`;
    try { speechSynthesis.cancel(); } catch {} say(`${t(g.t)}. ${t(g.b)}`);
    document.getElementById('walkStop').onclick = stop; document.getElementById('walkNext').onclick = () => { if (++i >= steps.length) stop(); else show(); }; };
  show(); return { voiceOnly: false, n: steps.length, step: () => i }; }
export function stop() { ['walkRing', 'walkCard'].forEach(id => document.getElementById(id)?.remove()); }

// Ask RigRoute AI (Supabase edge function, free model tier). Falls back to the keyword answer above if it errors or is off.
export async function askAI(q, S) { const log = await changelog(); let text = null, ai = false;
  try { const { SUPABASE } = await import('./config.js'); let dev = localStorage.getItem('rr_dev'); if (!dev) { dev = crypto.randomUUID(); localStorage.setItem('rr_dev', dev); }
    const r = await fetch(SUPABASE.url + '/functions/v1/ask-rigroute', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE.anonKey }, body: JSON.stringify({ q, device: dev, lang: document.documentElement.lang || 'en' }), signal: AbortSignal.timeout(20000) });
    const j = await r.json(); if (r.ok && j.answer) { text = j.answer; ai = !!j.ai; } } catch {}
  if (!text) { const a = answer(q, log); text = a ? `${a.t}: ${a.b}` : t('Sorry, I don\'t know that yet. Try Report a Bug in Me, or tap Show me around.'); }
  const moving = (S?.pos?.speed || 0) > 2.2; if (moving) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = document.documentElement.lang || 'en'; speechSynthesis.speak(u); } catch {} }
  return { text, ai, voiceOnly: moving }; }

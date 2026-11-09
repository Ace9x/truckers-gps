// What's New: data/changelog.json. Popup once per version, only while parked (deferred until stopped). Permanent dated list in Me.
import { t } from './i18n.js'; import { changelog } from './guide.js';
const SEEN = 'rr_whatsnew_seen', esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const list = log => log.map(e => `<li><b>${esc(e.date)}</b><ul>${e.items.map(i => `<li>${esc(t(i))}</li>`).join('')}</ul></li>`).join('');
export function start(S) { let log = null; changelog().then(l => { log = l; });
  setInterval(() => { if (!log?.length) return; const me = document.getElementById('mePanel');
    if (me && !document.getElementById('wnList')) me.insertAdjacentHTML('beforeend', `<details id="wnBox"><summary><b>🆕 ${t('What\'s new')}</b></summary><ul id="wnList" class="small">${list(log)}</ul></details>`);
    const v = log[0].version, parked = (S.pos?.speed || 0) < 2.2 && !S.nav;
    if (!localStorage.getItem(SEEN)) { localStorage.setItem(SEEN, v); return; } // first run: remember the version, don't cover the map
    if (localStorage.getItem(SEEN) !== v && parked && localStorage.getItem('tn_truckSetDone') && !document.querySelector('.wz-card,#tourCard,#walkCard,#areaAsk,#wnPop')) {
      localStorage.setItem(SEEN + '_prev', localStorage.getItem(SEEN) || ''); localStorage.setItem(SEEN, v); const d = document.createElement('div'); d.id = 'wnPop'; d.setAttribute('role', 'dialog');
      d.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(80px + env(safe-area-inset-top));z-index:65;background:#161b22;color:#e6edf3;border-radius:16px;padding:0;max-height:60vh;display:flex;flex-direction:column;box-shadow:0 8px 24px #000a';
      const prev = localStorage.getItem(SEEN + '_prev'), fresh = []; for (const e of log) { if (e.version === prev) break; fresh.push(...e.items); }
      const lines = fresh.slice(0, 3).map(i => t(i).slice(0, 60));
      d.innerHTML = `<div style="padding:14px 14px 0"><b>🆕 ${t('What\'s new')} · ${esc(log[0].date)}</b></div><ul class="small" style="overflow:auto;margin:8px 0;padding:0 22px">${lines.map(i => `<li>${esc(i)}</li>`).join('')}</ul><button class="big primary" style="width:100%;min-height:56px;border-radius:0 0 16px 16px">${t('Got it')}</button>`;
      d.querySelector('button').onclick = () => d.remove(); document.body.appendChild(d); }
    if ((S.pos?.speed || 0) >= 2.2) document.getElementById('wnPop')?.remove(); // never on screen while moving
  }, 3000); }

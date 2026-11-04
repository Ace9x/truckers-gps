// What's New: data/changelog.json. Popup once per version, only while parked (deferred until stopped). Permanent dated list in Me.
import { t } from './i18n.js'; import { changelog } from './guide.js';
const SEEN = 'rr_whatsnew_seen', esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const list = log => log.map(e => `<li><b>${esc(e.date)}</b><ul>${e.items.map(i => `<li>${esc(t(i))}</li>`).join('')}</ul></li>`).join('');
export function start(S) { let log = null; changelog().then(l => { log = l; });
  setInterval(() => { if (!log?.length) return; const me = document.getElementById('mePanel');
    if (me && !document.getElementById('wnList')) me.insertAdjacentHTML('beforeend', `<details id="wnBox"><summary><b>🆕 ${t('What\'s new')}</b></summary><ul id="wnList" class="small">${list(log)}</ul></details>`);
    const v = log[0].version, parked = (S.pos?.speed || 0) < 2.2 && !S.nav;
    if (localStorage.getItem(SEEN) !== v && parked && localStorage.getItem('tn_truckSetDone') && !document.querySelector('.wz-card,#tourCard,#walkCard,#areaAsk,#wnPop')) {
      localStorage.setItem(SEEN, v); const d = document.createElement('div'); d.id = 'wnPop'; d.setAttribute('role', 'dialog');
      d.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(80px + env(safe-area-inset-top));z-index:65;background:#161b22;color:#e6edf3;border-radius:16px;padding:14px;max-height:60vh;overflow:auto;box-shadow:0 8px 24px #000a';
      d.innerHTML = `<b>🆕 ${t('What\'s new')} · ${esc(log[0].date)}</b><ul class="small">${log[0].items.map(i => `<li>${esc(t(i))}</li>`).join('')}</ul><button class="big primary" style="width:100%">${t('Got it')}</button>`;
      d.querySelector('button').onclick = () => d.remove(); document.body.appendChild(d); }
    if ((S.pos?.speed || 0) >= 2.2) document.getElementById('wnPop')?.remove(); // never on screen while moving
  }, 3000); }

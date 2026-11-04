// "Help RigRoute grow": opt-in (default OFF) to add city/state to the anonymous daily count. Asked once after truck setup; toggle lives in Me.
import { t } from './i18n.js';
export const KEY = 'rr_area_ok', ASKED = 'rr_area_asked';
export const TITLE = 'Help RigRoute grow', LINE = 'Share your city/state, never your exact spot, so we can bring RigRoute and dispatch help to more drivers near you.';
export const on = () => localStorage.getItem(KEY) === '1';
const set = v => { localStorage.setItem(KEY, v ? '1' : '0'); localStorage.setItem(ASKED, '1'); const c = document.getElementById('areaOptChk'); if (c) c.checked = v; };
function toggle() { const me = document.getElementById('mePanel'); if (!me || document.getElementById('areaOptChk')) return;
  me.insertAdjacentHTML('beforeend', `<h3 id="areaOptH">${t(TITLE)}</h3><label class="chk"><input type="checkbox" id="areaOptChk"> ${t(LINE)}</label>`);
  const c = document.getElementById('areaOptChk'); c.checked = on(); c.onchange = () => set(c.checked); }
function ask() { if (localStorage.getItem(ASKED) || !localStorage.getItem('tn_truckSetDone') || document.querySelector('.wz-card, #areaAsk')) return;
  const d = document.createElement('div'); d.id = 'areaAsk'; d.setAttribute('role', 'dialog');
  d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(90px + env(safe-area-inset-bottom));z-index:60;background:#161b22;color:#e6edf3;border-radius:16px;padding:14px;box-shadow:0 8px 24px #000a';
  d.innerHTML = `<b>${t(TITLE)}</b><p>${t(LINE)}</p><div style="display:flex;gap:8px"><button class="big" data-a="1" style="flex:1">${t('Yes, share my city')}</button><button class="big" data-a="0" style="flex:1">${t('No thanks')}</button></div>`;
  d.querySelectorAll('button').forEach(b => b.onclick = () => { set(b.dataset.a === '1'); d.remove(); }); document.body.appendChild(d); }
export function start() { setInterval(toggle, 1500); setInterval(ask, 3000); }

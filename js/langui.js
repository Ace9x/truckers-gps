// Language picker: settings (Me panel / dispatch header), first-run chooser, profile sync. Beta languages get a "report a translation" link.
import { I18N, LANGS, META_, setLang, t } from './i18n.js';
const $ = s => document.querySelector(s);
const REPORT = c => `https://github.com/Ace9x/truckers-gps/issues/new?labels=translation&title=${encodeURIComponent(`Translation (${c}): `)}&body=${encodeURIComponent('Screen:\nWhat it says now:\nWhat it should say:\n')}`;
const label = c => `${LANGS[c]}${META_[c]?.beta ? ' · beta' : ''}`;
const order = () => Object.keys(LANGS).sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : LANGS[a].localeCompare(LANGS[b])));
export function picker(id = 'langSel') { const w = document.createElement('div'); w.className = 'lang-row'; w.setAttribute('translate', 'no');
  w.innerHTML = `<label for="${id}"><span aria-hidden="true">🌐</span> <span class="lang-lbl">${t('Language')}</span></label><select id="${id}">${order().map(c => `<option value="${c}" lang="${c}" ${c === I18N.lang ? 'selected' : ''}>${label(c)}</option>`).join('')}</select><a class="lang-report textlink" target="_blank" rel="noopener"></a>`;
  const sel = w.querySelector('select'), rep = w.querySelector('.lang-report');
  const sync = () => { sel.value = LANGS[I18N.lang] ? I18N.lang : 'en'; const b = META_[sel.value]?.beta; rep.hidden = !b; rep.href = REPORT(sel.value); rep.textContent = t('Report a translation'); w.querySelector('.lang-lbl').textContent = t('Language'); };
  sel.onchange = async () => { await choose(sel.value); }; addEventListener('rr-lang', sync); sync(); return w; }
export async function choose(c) { await setLang(c); const S = window.TruckNav, a = S?.auth; try { if (a?.user && S.truck) { S.truck.lang = c; await a.saveProfile({ truck: S.truck }); } } catch {}
  window.TruckNav?.voice?.refresh?.(); notice(); }
function notice() { const v = window.TruckNav?.voice; setTimeout(() => { if (I18N.speakEnglish && I18N.lang !== 'en') window.TruckNav?.toast?.(t('No voice for this language on this phone. Voice will speak English.')); }, 1200); }
// first run: pick a language before anything else (skipped for automated browsers and once chosen)
export function firstRun(after) { let saved = null; try { saved = localStorage.getItem('tn_lang'); } catch {}
  if (saved || navigator.webdriver) return after?.();
  const d = document.createElement('div'); d.id = 'langFirst'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Language'); d.setAttribute('translate', 'no');
  const guess = I18N.lang;
  d.innerHTML = `<div class="lf-card"><div class="lf-globe" aria-hidden="true">🌐</div><h2>${t('Choose your language')}</h2><div class="lf-grid">${order().map(c => `<button type="button" data-l="${c}" lang="${c}" class="${c === guess ? 'on' : ''}">${LANGS[c]}${META_[c]?.beta ? ' <small>beta</small>' : ''}</button>`).join('')}</div></div>`;
  document.body.appendChild(d); d.querySelectorAll('[data-l]').forEach(b => b.onclick = async () => { await choose(b.dataset.l); d.remove(); after?.(); }); }
// restore a signed-in user's language on a new phone
addEventListener('rr-auth', e => { const l = e.detail?.profile?.truck?.lang; let saved = null; try { saved = localStorage.getItem('tn_lang'); } catch {} if (l && !saved && LANGS[l]) setLang(l); });
export function mount() { const me = $('#mePanel .phead') || $('#mePanel'); if (me && !$('#langSel')) me.after(picker('langSel'));
  const dh = $('#dispHead, header .row, header'); if (!me && dh && !$('#langSelD')) dh.appendChild(picker('langSelD')); }

// Every note stays a small card on the map: a 44px close button, a swipe-away, and a short timer.
// Sheets the driver opened on purpose (Route, Me, Search) are not notes.

const KEEP = new Set(['toast', 'wrongRoad', 'lockout', 'lastMile', 'netPill']);
const NO_TIMER = new Set(['tourCard', 'walkCard', 'langFirst']);

function rootOf(el) {
  return el.closest('#shareAsk,#tripReceipt,#lockout,#wnPop,#areaAsk,#tourCard,#walkCard,#toast,#wrongRoad,#lastMile,#netPill,#hzBanner,#tfBanner,#langFirst') || el;
}

export function dismiss(el) {
  const root = rootOf(el);
  if (!root) return;
  if (root.dataset.rrClosing) return;
  root.dataset.rrClosing = '1';
  clearTimeout(root._rrT);
  if (root.id === 'shareAsk') { root.querySelector('[data-no]')?.click(); return; }
  if (root.id === 'areaAsk') { const no = root.querySelector('[data-a="0"]'); if (no) no.click(); else root.remove(); return; }
  if (root.id === 'tourCard') { const s = document.querySelector('#tSkip'); if (s) s.click(); else root.remove(); return; }
  if (root.id === 'walkCard') { const s = document.querySelector('#walkStop'); if (s) s.click(); else root.remove(); return; }
  if (root.id === 'langFirst') { document.querySelector('#lfGo')?.click(); return; }
  if (root.id === 'mtLock') { root.hidden = true; root.dataset.rrClosing = ''; root.dataset.rrArmed = ''; return; }
  if (KEEP.has(root.id)) { root.classList.add('hidden'); root.dataset.rrClosing = ''; root.dataset.rrArmed = ''; return; }
  root.remove();
}

export function arm(el, opt = {}) {
  if (!el) return;
  const host = opt.host || el;
  if (!host.querySelector(':scope > .rr-x') && !host.querySelector('#lockClose')) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rr-x'; b.setAttribute('aria-label', 'Close'); b.textContent = '✕';
    b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); dismiss(el); });
    host.appendChild(b);
  }
  host.classList.add('rr-note');
  if (host.dataset.rrArmed && !opt.fresh) return;
  host.dataset.rrArmed = '1';
  if (!host.dataset.rrSwipe) {
    host.dataset.rrSwipe = '1';
    let x0 = 0, y0 = 0, armed = false;
    host.addEventListener('pointerdown', e => {
      if (e.target.closest('button,a,input,textarea,select')) { if (opt.hold) clearTimeout(rootOf(el)._rrT); return; }
      armed = true; x0 = e.clientX; y0 = e.clientY;
      if (opt.hold) clearTimeout(rootOf(el)._rrT);
    });
    host.addEventListener('pointerup', e => {
      if (!armed) return; armed = false;
      if (Math.abs(e.clientX - x0) > 56 && Math.abs(e.clientX - x0) > Math.abs(e.clientY - y0) + 8) dismiss(el);
    });
  }
  const id = rootOf(el).id;
  const ms = opt.ms ?? (NO_TIMER.has(id) ? 0 : opt.critical ? 8000 : 5000);
  const root = rootOf(el);
  clearTimeout(root._rrT);
  if (ms > 0) root._rrT = setTimeout(() => dismiss(el), ms);
}

const SCAN = [
  ['#toast', {}],
  ['#wrongRoad:not(.hidden)', { critical: true }],
  ['#lockout:not(.hidden)', { ms: 5000 }],
  ['#lastMile:not(.hidden)', {}],
  ['#wnPop', { ms: 5000 }],
  ['#shareAsk .sa-card', { ms: 20000, hold: true }],
  ['#areaAsk', { ms: 8000 }],
  ['#tripReceipt .trc-paper', { ms: 8000, hold: true }],
  ['#tourCard', { ms: 0 }],
  ['#walkCard', { ms: 0 }],
  ['#langFirst .lf-card', { ms: 0 }],
  ['#hzBanner', { critical: true }],
  ['#tfBanner', { critical: true }],
  ['#mascot .mBubble', { ms: 5000 }],
  ['#alerts .alert', {}],
  ['#detourWarn', { ms: 8000 }],
  ['#mtLock:not([hidden])', { ms: 5000 }],
];

function scan() {
  for (const [sel, opt] of SCAN) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.classList.contains('hidden') || el.hidden) continue;
      arm(el, opt);
    }
  }
  const live = document.querySelector('#hzLive'), tf = document.querySelector('#tfLegend');
  const chip = document.querySelector('#liveChip');
  if (chip && live) {
    const on = /live/i.test(`${live.textContent} ${tf?.textContent || ''}`) && !/offline|connecting|unavailable/i.test(`${live.textContent} ${tf?.textContent || ''}`);
    chip.classList.toggle('ok', on); chip.classList.toggle('wait', !on);
  }
}

export function mountLiveChip() {
  if (document.querySelector('#liveChip')) return;
  const chip = document.createElement('button');
  chip.type = 'button'; chip.id = 'liveChip'; chip.setAttribute('aria-expanded', 'false'); chip.setAttribute('aria-label', 'Live status. Tap for details.');
  chip.innerHTML = '<i class="ldot" aria-hidden="true"></i><span>Live</span>';
  const detail = document.createElement('div');
  detail.id = 'liveDetail'; detail.hidden = true; detail.setAttribute('role', 'status');
  document.body.appendChild(chip); document.body.appendChild(detail);
  const park = () => {
    const h = document.querySelector('#hzLive'), t = document.querySelector('#tfLegend');
    if (h && h.parentElement !== detail) detail.appendChild(h);
    if (t && t.parentElement !== detail) detail.appendChild(t);
  };
  let timer;
  const shut = () => { detail.hidden = true; chip.setAttribute('aria-expanded', 'false'); };
  chip.addEventListener('click', () => {
    park();
    const open = detail.hidden;
    detail.hidden = !open;
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    clearTimeout(timer);
    if (open) timer = setTimeout(shut, 4000);
  });
  setInterval(park, 700); park();
}

export function watchNotices() {
  mountLiveChip();
  scan();
  const obs = new MutationObserver(() => { clearTimeout(watchNotices._t); watchNotices._t = setTimeout(scan, 60); });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  setInterval(scan, 2000);
}

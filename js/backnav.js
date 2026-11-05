// Phone back button / swipe-back closes the top sheet or panel instead of leaving the app.
// While anything is open we keep one extra history entry; Back pops it and we close the top layer.
const LAYERS = [['#shareAsk', '[data-no]'], ['#legendSheet', '.close'], ['#helpSheet', '.hs-close, [data-close], .close'], ['#walkCard', '#walkStop'], ['#tourCard', '#tSkip'], ['#hzSheet', '#hzX'], ['#wnPop', 'button.close, [data-close]'], ['#fxPodSheet', '.close, [data-close]'], ['#installCard', '.close, [data-close]'], ['#areaAsk', '.close, [data-close]'], ['#lockout:not(.hidden)', '#lockClose'], ['.panel:not(.hidden)', '.phead .close']];
const top = () => { for (const [sel, btn] of LAYERS) { const el = document.querySelector(sel); if (el && el.getClientRects().length) return [el, btn]; } return null; };
let armed = false, skip = 0;
function closeTop() { const t = top(); if (!t) return false; const [el, btn] = t; const b = el.querySelector(btn);
  if (b) b.click(); else if (el.classList.contains('panel')) el.classList.add('hidden'); else el.remove(); return true; }
function sync() { const open = !!top();
  if (open && !armed) { armed = true; history.pushState({ rrSheet: 1 }, ''); }
  else if (!open && armed) { armed = false; if (history.state?.rrSheet) { skip++; history.back(); } } }
addEventListener('popstate', () => { if (skip) { skip--; return; } if (!armed) return; armed = false; closeTop(); setTimeout(sync, 50); /* re-arm if another layer is still open */ });
let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; sync(); }); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
export const backnav = { closeTop, sync };

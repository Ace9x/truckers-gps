/* Ace9x ad slot + consent (v1). © 2026 Ace9x. All rights reserved.
 * Usage: <div class="ax-slot" data-ax-place="home"></div> and
 *   <script src="js/ads.js" data-provider="none|adsense|ethicalads" data-client="" data-slot=""
 *           data-house='[{"t":"..","u":".."}]' data-driving-gate="1" defer></script>
 * - No third-party ad code loads until the visitor accepts in the consent banner.
 * - provider "none" (default until a network approves the site) shows our own house promos only; they load nothing third-party.
 * - data-driving-gate: slots hide while navigating (body.nav) or when speed > 5 mph; shown only when parked/slow.
 * - Gambling ads: EdgePro must also turn on the Gambling & betting block in the network dashboard (AdSense: Blocking controls > Sensitive categories);
 *   the client cannot enforce that alone. */
(() => {
  const me = document.currentScript, cfg = me.dataset, KEY = 'ax_consent_v1';
  const provider = cfg.provider || 'none', gate = cfg.drivingGate === '1';
  let house = []; try { house = JSON.parse(cfg.house || '[]'); } catch {}
  const consent = () => localStorage.getItem(KEY); // 'yes' | 'no' | null
  let mph = 0;
  const css = document.createElement('style');
  css.textContent = `.ax-slot{margin:10px auto;max-width:728px;font:14px/1.4 system-ui,sans-serif}.ax-slot[hidden]{display:none!important}
.ax-card{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid rgba(255,255,255,.15);border-radius:12px;background:rgba(20,23,28,.92);color:#eef}
.ax-card a{color:inherit;text-decoration:none;font-weight:600}.ax-tag{font-size:10px;opacity:.6;text-transform:uppercase;letter-spacing:.1em}
.ax-x{background:none;border:0;color:inherit;font-size:18px;cursor:pointer;opacity:.6}
#ax-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:560px;margin:auto;padding:14px 16px;border-radius:14px;background:#14171c;color:#eef;border:1px solid #333;box-shadow:0 10px 40px rgba(0,0,0,.5);font:14px/1.45 system-ui,sans-serif}
#ax-consent button{margin:8px 8px 0 0;padding:8px 14px;border-radius:10px;border:1px solid #555;background:#222;color:#eef;font-weight:600;cursor:pointer}#ax-consent .ok{background:#f5c518;color:#111;border:0}`;
  document.head.appendChild(css);
  const slots = () => [...document.querySelectorAll('.ax-slot')];
  const allowed = () => !(gate && (document.body.classList.contains('nav') || mph > 5)) && !sessionStorage.getItem('ax_closed');
  function renderHouse(el) {
    if (!house.length) { el.hidden = true; return; }
    const h = house[Math.floor(Math.random() * house.length)];
    el.innerHTML = `<div class="ax-card"><div><div class="ax-tag">From us</div><a href="${h.u}" target="_blank" rel="noopener">${h.t}</a></div><button class="ax-x" aria-label="Hide">×</button></div>`;
    el.querySelector('.ax-x').onclick = () => { sessionStorage.setItem('ax_closed', '1'); refresh(); };
  }
  let netLoaded = false;
  function renderNetwork(el) {
    if (provider === 'adsense' && cfg.client) {
      if (!netLoaded) { const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.client); document.head.appendChild(s); netLoaded = true; }
      if (!el.dataset.filled) { el.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.client}" data-ad-slot="${cfg.slot || ''}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
        (window.adsbygoogle = window.adsbygoogle || []).push({}); el.dataset.filled = 1; }
    } else if (provider === 'ethicalads' && cfg.client) {
      if (!netLoaded) { const s = document.createElement('script'); s.async = true; s.src = 'https://media.ethicalads.io/media/client/ethicalads.min.js'; document.head.appendChild(s); netLoaded = true; }
      if (!el.dataset.filled) { el.innerHTML = `<div data-ea-publisher="${cfg.client}" data-ea-type="text"></div>`; el.dataset.filled = 1; }
    } else renderHouse(el);
  }
  function refresh() {
    for (const el of slots()) {
      if (!allowed()) { el.hidden = true; continue; }
      el.hidden = false;
      if (provider !== 'none' && consent() === 'yes') renderNetwork(el); else if (!el.dataset.filled) renderHouse(el);
    }
  }
  function banner() {
    if (provider === 'none' || consent()) return; // house promos need no consent: nothing third-party loads
    const b = document.createElement('div'); b.id = 'ax-consent'; b.setAttribute('role', 'dialog');
    b.innerHTML = `This free app shows ads to pay for itself. With your OK, our ad partner may use cookies to show and measure ads. <a href="privacy.html#ads" style="color:#f5c518">Details</a><br><button class="ok">Accept</button><button>Decline</button>`;
    const [ok, no] = b.querySelectorAll('button');
    ok.onclick = () => { localStorage.setItem(KEY, 'yes'); b.remove(); refresh(); };
    no.onclick = () => { localStorage.setItem(KEY, 'no'); b.remove(); refresh(); };
    document.body.appendChild(b);
  }
  window.AxAds = { refresh, resetConsent: () => { localStorage.removeItem(KEY); banner(); } };
  if (gate && navigator.permissions && navigator.geolocation) navigator.permissions.query({ name: 'geolocation' }).then(p => {
    if (p.state === 'granted') navigator.geolocation.watchPosition(x => { mph = (x.coords.speed || 0) * 2.23694; refresh(); }, () => {}, { maximumAge: 5000 });
  }).catch(() => {});
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const start = () => { banner(); refresh(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();

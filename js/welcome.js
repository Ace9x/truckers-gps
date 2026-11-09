const ref = new URLSearchParams(location.search).get('ref');
if (ref && /^[a-z0-9_-]{1,24}$/i.test(ref)) { try { localStorage.setItem('tn_ref_from', ref); } catch {} }
let deferred = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
const btn = document.querySelector('#installBtn');
const guide = document.querySelector('#iosGuide');
if (btn) btn.addEventListener('click', async () => {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) { btn.textContent = 'Already on your home screen'; return; }
  if (deferred) { try { deferred.prompt(); await deferred.userChoice; } catch {} deferred = null; return; }
  if (guide) guide.hidden = false;
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('../sw.js').catch(() => {});

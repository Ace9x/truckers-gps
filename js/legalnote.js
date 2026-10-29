// Legal pages stay in English. If the user picked another language, show one line in that language saying English controls.
(async () => { let l = 'en'; try { l = JSON.parse(localStorage.getItem('tn_lang') || '"en"'); } catch {} if (!l || l === 'en' || l === 'src') return;
  const K = 'This page is only in English. The English version is the one that counts.'; let msg = K;
  try { const d = await (await fetch(`i18n/${l}.json`)).json(); msg = d[K] || K; if (d._meta?.dir === 'rtl') var rtl = true; } catch {}
  const p = document.createElement('p'); p.className = 'legal-note'; p.setAttribute('translate', 'no'); p.lang = l; if (rtl) p.dir = 'rtl';
  p.style.cssText = 'background:#fff3cd;color:#222;border:1px solid #e0c060;border-radius:8px;padding:10px 12px;margin:12px 0;font-size:16px';
  p.textContent = `🌐 ${msg}` + (msg === K ? '' : ` (${K})`); document.body.prepend(p); })();

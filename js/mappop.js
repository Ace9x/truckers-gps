// One plain-language popup for every map marker: what it is, who reported it, and how long ago.
// Also the map legend (🗺 Map key) sheet. Labels go through t() so Spanish (and every other language file) applies.
import { t } from './i18n.js';
import { HZ, HZ_ORDER } from './hazlogic.js';
import { REPORT_TYPES } from './community.js';
// TomTom Traffic incident iconCategory (Incident Details v5 docs): 0..11 and 14; 12/13 are unused and shown as Unknown.
export const TT = { 0: ['❗', 'Unknown incident'], 1: ['💥', 'Accident'], 2: ['🌫', 'Fog'], 3: ['⚠', 'Dangerous conditions'], 4: ['💧', 'Rain'], 5: ['❄', 'Ice on the road'],
  6: ['🚗', 'Traffic jam'], 7: ['〰️', 'Lane closed'], 8: ['🚫', 'Road closed'], 9: ['🚧', 'Road work'], 10: ['💨', 'Strong wind'], 11: ['🌊', 'Flooding'], 14: ['🚘', 'Broken-down vehicle'] };
export const ttInfo = c => TT[+c] || TT[0];
export const SRC = { tomtom: 'TomTom traffic', driver: 'RigRoute driver', friend: 'Friend', you: 'You' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function ago(ts, now = Date.now()) { const ms = now - (typeof ts === 'string' ? Date.parse(ts) : +ts); if (!Number.isFinite(ms)) return '';
  if (ms < 0 && ms > -15 * 60e3) return t('just now'); /* GPS / device clocks can run slightly ahead */ if (ms < 0) return t('starts at {0}', [new Date(now - ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })]);
  const m = Math.round(ms / 60e3); return m < 1 ? t('just now') : m < 60 ? t('{0} min ago', [m]) : m < 1440 ? t('{0} h ago', [Math.round(m / 60)]) : t('{0} d ago', [Math.round(m / 1440)]); }
// kind: tomtom | hazard | friend | you.  when: ms or ISO time.  whenKind: 'reported' (default) or 'started'
export function head({ kind, icon, label, src, when, whenKind = 'reported', detail }) { const a = when != null && when !== '' ? ago(when) : '';
  return `<div class="mp" translate="no" data-mp-kind="${esc(kind)}"><b class="mp-label" style="color:#111;font-size:16px">${esc(icon)} ${esc(t(label))}</b>` +
    `<div class="mp-src" style="color:#333;font-size:14px">${esc(t('Source'))}: ${esc(t(src))}</div>` +
    `<div class="mp-age" style="color:#333;font-size:14px">${a ? esc(whenKind === 'started' ? t('Started {0}', [a]) : t('Reported {0}', [a])) : esc(t('Time not given'))}</div>` +
    (detail ? `<div class="mp-detail" style="color:#444;font-size:13px">${esc(detail)}</div>` : '') + '</div>'; }
// TomTom incident tap: label at once, then start / last-report time from Incident Details (by id) when TomTom has it
export function wireTomTom(map, S) {
  map.on('click', 'ttinc', e => { const f = e.features?.[0]; if (f) showTomTom(map, S, f.properties || {}, e.lngLat); });
  map.on('mouseenter', 'ttinc', () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', 'ttinc', () => map.getCanvas().style.cursor = ''); }
export async function showTomTom(map, S, p, lngLat) { const c = +(p.icon_category ?? p.icon_category_0 ?? 0), [icon, label] = ttInfo(c);
    const pop = new maplibregl.Popup({ offset: 14, className: 'mp-pop' }).setLngLat(lngLat).setHTML(head({ kind: 'tomtom', icon, label, src: SRC.tomtom, when: null, detail: p.description_0 || p.description || '' })).addTo(map);
    const key = S.traffic?.keys?.tomtom || S.keys?.tomtom; if (!key || p.noLookup) return pop; const ll = lngLat.lng != null ? lngLat : { lng: lngLat[0], lat: lngLat[1] };
    try { const j = await (await fetch(`https://api.tomtom.com/traffic/services/5/incidentDetails?${p.id ? 'ids=' + encodeURIComponent(p.id) : `bbox=${(ll.lng - 0.004).toFixed(5)},${(ll.lat - 0.003).toFixed(5)},${(ll.lng + 0.004).toFixed(5)},${(ll.lat + 0.003).toFixed(5)}`}&fields={incidents{geometry{type,coordinates},properties{iconCategory,startTime,lastReportTime,from,to,events{description}}}}&language=${document.documentElement.lang === 'es' ? 'es-ES' : 'en-US'}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) })).json();
      const near = i => { const g = i.geometry?.coordinates; const c0 = i.geometry?.type === 'Point' ? g : g?.[0]; return c0 ? (c0[0] - ll.lng) ** 2 + (c0[1] - ll.lat) ** 2 : 9; }; const cands = (j.incidents || []).filter(i => i && (p.id || i.properties.iconCategory === c)).sort((a, b) => near(a) - near(b)); const q = cands[0]?.properties; /* vector tiles carry no id/time: match the nearest incident of the same type */ if (!q || !pop.isOpen()) return pop; const [i2, l2] = ttInfo(q.iconCategory ?? c);
      pop.setHTML(head({ kind: 'tomtom', icon: i2, label: l2, src: SRC.tomtom, when: q.lastReportTime || q.startTime || null, whenKind: q.lastReportTime ? 'reported' : 'started', detail: [q.events?.[0]?.description, q.from && q.to ? `${q.from} → ${q.to}` : q.from].filter(Boolean).join(' · ') })); } catch {} return pop; }
// Markers open their popup from their own click/Enter, not only through MapLibre's map-click path: that path ignores
// clicks that are not part of a pointer sequence (VoiceOver/TalkBack activation, keyboard, any synthetic click after touch input).
export function tapToOpen(marker, label) { const el = marker.getElement(); if (el.__mpTap) return marker; el.__mpTap = 1;
  el.setAttribute('role', 'button'); el.tabIndex = 0; if (label) el.setAttribute('aria-label', t(label));
  const open = e => { e.stopPropagation(); e.preventDefault?.(); const pop = marker.getPopup(); if (!pop) return; if (pop.isOpen()) pop.remove(); else marker.togglePopup(); };
  el.addEventListener('click', open); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(e); }); return marker; }
// Map key sheet: every icon the map can show
export function legendItems() { const out = [];
  for (const c of [1, 6, 14, 3, 7, 8, 9, 2, 4, 5, 10, 11, 0]) out.push({ key: 'tt-' + c, icon: TT[c][0], label: TT[c][1], src: SRC.tomtom });
  for (const k of HZ_ORDER) out.push({ key: 'hz-' + k, icon: HZ[k].icon, label: HZ[k].label, src: SRC.driver });
  for (const [k, r] of Object.entries(REPORT_TYPES)) if (!HZ[k] && !out.some(o => o.label === r.label)) out.push({ key: 'rp-' + k, icon: r.icon, label: r.label, src: SRC.driver });
  out.push({ key: 'friend', icon: '👥', label: 'Friend sharing their location', src: SRC.friend }, { key: 'you', icon: '🚛', label: 'Your truck (live GPS)', src: SRC.you }); return out; }
export function openLegend() { document.querySelector('#legendSheet')?.remove(); const d = document.createElement('div'); d.id = 'legendSheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', t('Map key'));
  d.innerHTML = `<div class="lg-card"><div class="lg-head"><h2>🗺 ${esc(t('Map key'))}</h2><button type="button" class="close" aria-label="${esc(t('Close'))}">✕</button></div><p class="lg-sub">${esc(t('Tap any icon on the map to see what it is, who reported it and when.'))}</p><ul class="lg-list">` +
    legendItems().map(i => `<li class="lg-item" data-key="${esc(i.key)}"><span class="lg-ic" aria-hidden="true">${esc(i.icon)}</span><span><b class="lg-label">${esc(t(i.label))}</b><small class="lg-src">${esc(t(i.src))}</small></span></li>`).join('') + '</ul></div>';
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('.close')) d.remove(); }); document.body.appendChild(d); d.querySelector('.close').focus(); return d; }
export function mountLegendButton() { const side = document.querySelector('#sideBtns'); if (!side || document.querySelector('#legendBtn')) return;
  side.insertAdjacentHTML('beforeend', `<button id="legendBtn" class="round" title="${esc(t('Map key'))}" aria-label="${esc(t('Map key: what the map icons mean'))}">🗺</button>`); document.querySelector('#legendBtn').onclick = openLegend; }
const CSS = '#legendSheet{position:fixed;inset:0;z-index:3000;background:#000a;display:flex;align-items:flex-end;justify-content:center}#legendSheet .lg-card{background:#14181f;color:#fff;max-width:560px;width:100%;max-height:82vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 18px calc(18px + env(safe-area-inset-bottom))}#legendSheet .lg-head{display:flex;align-items:center;justify-content:space-between}#legendSheet h2{margin:0;font-size:21px}#legendSheet .close{min-width:44px;min-height:44px;border-radius:50%;font-size:18px}#legendSheet .lg-sub{color:#c9d3df;font-size:15px;margin:6px 0 10px}#legendSheet .lg-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}#legendSheet .lg-item{display:flex;gap:12px;align-items:center;min-height:44px;padding:4px 6px;border-radius:10px;background:#1c222b}#legendSheet .lg-ic{font-size:24px;width:36px;text-align:center}#legendSheet .lg-item b{display:block;font-size:16px}#legendSheet .lg-item small{color:#b8c4d2;font-size:13px}.mp{min-width:180px;line-height:1.35}';
if (!document.querySelector('#mpCss')) { const s = document.createElement('style'); s.id = 'mpCss'; s.textContent = CSS; document.head.appendChild(s); }
// BUG-029: pins drawn on top of each other (and half off the screen edge) on a phone. Keep the truck, then friends, then the rest in order;
// hide any pin that overlaps one already shown or is cut off by the screen edge. Hidden pins leave the tab order too. Zoom in to see them all.
export function declutter(map) { if (!map) return; const box = map.getContainer(); let t = 0;
  const run = () => { t = 0; const W = box.clientWidth, H = box.clientHeight, kept = [];
    const all = [...box.querySelectorAll('.maplibregl-marker')], rank = e => e.classList.contains('truck-marker') ? 0 : /friend/.test(e.className) ? 1 : 2;
    all.sort((a, b) => rank(a) - rank(b));
    for (const el of all) { el.classList.remove('mp-hide'); const r = el.getBoundingClientRect(), c = box.getBoundingClientRect(); const x0 = r.left - c.left, y0 = r.top - c.top, x1 = x0 + r.width, y1 = y0 + r.height;
      let hide = false; if (rank(el) > 0) { if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) hide = true; // off the map: out of reach for screen readers and taps too
        else if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) hide = true;
        else hide = kept.some(k => Math.min(k[2], x1) - Math.max(k[0], x0) > 2 && Math.min(k[3], y1) - Math.max(k[1], y0) > 2); }
      el.classList.toggle('mp-hide', hide); if (el.getAttribute('role') === 'button') { el.tabIndex = hide ? -1 : 0; hide ? el.setAttribute('aria-hidden', 'true') : el.removeAttribute('aria-hidden'); }
      if (!hide && !(x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H)) kept.push([x0, y0, x1, y1]); } };
  const later = () => { if (!t) t = setTimeout(run, 120); };
  map.on('move', later); map.on('moveend', run); map.on('zoomend', run); map.on('resize', later);
  new MutationObserver(later).observe(map.getCanvasContainer(), { childList: true });
  setInterval(run, 2000); run(); }

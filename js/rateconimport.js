// Drop a rate con / BOL / load tender (PDF or image) → read it in the browser → review form → fills the New load form. Never saves by itself.
// Free + client-side only: pdf.js (text layer) and tesseract.js (OCR for scans/images). Nothing is uploaded until the dispatcher sends the load.
import { parseRateCon } from './rateconparse.js';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/', TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let pdfjs, tess, pending = null;
// Geocode with checks: only accept a hit whose house number + street (or at least street + ZIP) match what the document says. Otherwise null — never a guessed town centroid.
const ABBR = { st: 'street', dr: 'drive', rd: 'road', ave: 'avenue', av: 'avenue', blvd: 'boulevard', pl: 'place', ln: 'lane', ct: 'court', hwy: 'highway', pkwy: 'parkway', cir: 'circle', ter: 'terrace', way: 'way', n: 'north', s: 'south', e: 'east', w: 'west' };
const nst = t => String(t || '').toLowerCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean).map(w => ABBR[w] || w).join(' ');
let lastNom = 0; const nomGap = async () => { const w = lastNom + 1100 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); lastNom = Date.now(); };
export async function geocode(addr) { const m = /^\s*(\d+[A-Za-z]?)\s+(.+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5})/.exec(addr || ''); if (!m) return null; const [, num, street, city, st, zip] = m, want = nst(street);
  const roadOk = r => { const a = nst(r); return a === want || a.startsWith(want) || want.startsWith(a); };
  const nom = async q => { await nomGap(); const u = new URL('https://nominatim.openstreetmap.org/search'); Object.entries({ ...q, country: 'us', format: 'jsonv2', addressdetails: 1, limit: 3 }).forEach(([k, v]) => u.searchParams.set(k, v)); const r = await fetch(u); return r.ok ? r.json() : []; };
  const label = a => [a.house_number && a.road ? a.house_number + ' ' + a.road : a.road, a.city || a.town || a.village || a.borough || a.suburb, a['ISO3166-2-lvl4']?.slice(3), a.postcode].filter(Boolean).join(', ');
  try { for (const h of await nom({ street: `${num} ${street}`, city, state: st, postalcode: zip })) { const a = h.address || {}; if (a.house_number === num && roadOk(a.road) && (a.postcode?.startsWith(zip) || label(a).toLowerCase().includes(city.toLowerCase()))) return { address: label(a), lat: +h.lat, lng: +h.lon, c: 'high', note: 'exact address' }; } } catch {}
  try { const r = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(`${num} ${street}, ${city} ${st}`)}&limit=5&lang=en`)).json();
    for (const f of r.features || []) { const p = f.properties; if (p.housenumber === num && roadOk(p.street) && (p.postcode === zip || (p.city || '').toLowerCase() === city.toLowerCase())) return { address: [`${num} ${p.street}`, p.city, st, p.postcode].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], c: 'high', note: 'exact address' }; } } catch {}
  try { for (const h of await nom({ street, postalcode: zip })) { const a = h.address || {}; if (roadOk(a.road) && a.postcode?.startsWith(zip)) return { address: `${num} ${a.road}, ${a.city || a.town || a.village || a.borough || city}, ${st} ${zip}`, lat: +h.lat, lng: +h.lon, c: 'med', note: 'street found, house number not on the map — check the pin' }; } } catch {}
  return null; }

async function pdfLib() { if (pdfjs) return pdfjs; pdfjs = await import(PDFJS + 'pdf.min.mjs');
  const src = await (await fetch(PDFJS + 'pdf.worker.min.mjs')).text(); const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' }); return pdfjs; }
async function ocrLib() { if (tess) return tess; await new Promise((ok, no) => { const s = document.createElement('script'); s.src = TESS + 'tesseract.min.js'; s.onload = ok; s.onerror = () => no(new Error('OCR library failed to load')); document.head.appendChild(s); });
  tess = await window.Tesseract.createWorker('eng', 1, { workerPath: TESS + 'worker.min.js' }); return tess; }
// group positioned text pieces into rows → cells (big horizontal gap = new cell)
export function toRows(items) { items = items.filter(i => i.t.trim()).sort((a, b) => b.y - a.y || a.x - b.x); const rows = [];
  for (const it of items) { const r = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, Math.max(r.h, it.h) * 0.45)); if (r) { r.items.push(it); if (it.h > r.h) { r.h = it.h; r.y = it.y; } } else rows.push({ y: it.y, h: it.h, items: [it] }); }
  return rows.sort((a, b) => b.y - a.y).map(r => { const s = r.items.sort((a, b) => a.x - b.x), cells = []; for (const it of s) { const last = cells.at(-1); if (last && it.x - last.end < Math.max(4, it.h * 1.3)) { last.t += (it.x - last.end > it.h * 0.15 ? ' ' : '') + it.t; last.end = it.x + it.w; } else cells.push({ x: it.x, t: it.t, end: it.x + it.w, h: it.h }); } return { y: r.y, cells }; }); }
async function ocrRows(src, status) { status('Reading the scan (OCR)… this can take 10–30 s the first time'); const w = await ocrLib(); const { data } = await w.recognize(src); const items = [];
  for (const l of data.lines || []) for (const wd of l.words) items.push({ x: wd.bbox.x0, y: -wd.bbox.y0 - (wd.bbox.y1 - wd.bbox.y0) / 2, w: wd.bbox.x1 - wd.bbox.x0, h: wd.bbox.y1 - wd.bbox.y0, t: wd.text });
  return { rows: toRows(items), ocr: true, conf: data.confidence }; }
export async function readFile(file, status = () => {}) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { status('Reading PDF…'); const lib = await pdfLib(); const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; let rows = [], chars = 0;
    for (let p = 1; p <= Math.min(doc.numPages, 4); p++) { const pg = await doc.getPage(p), tc = await pg.getTextContent(), off = (p - 1) * 2000; const items = tc.items.filter(i => i.str).map(i => ({ x: i.transform[4], y: i.transform[5] - off, w: i.width, h: Math.abs(i.transform[3]) || i.height || 10, t: i.str })); chars += items.reduce((n, i) => n + i.t.trim().length, 0); rows = rows.concat(toRows(items)); }
    if (chars >= 40) return { rows, ocr: false, pages: doc.numPages };
    const out = []; let conf = 0; for (let p = 1; p <= Math.min(doc.numPages, 3); p++) { const pg = await doc.getPage(p), vp = pg.getViewport({ scale: 2.5 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; const r = await ocrRows(cv, status); out.push(...r.rows.map(x => ({ ...x, y: x.y - p * 1e5 }))); conf += r.conf; }
    return { rows: out, ocr: true, conf: Math.round(conf / Math.min(doc.numPages, 3)), pages: doc.numPages }; }
  if (/^image\//.test(file.type)) return ocrRows(file, status);
  throw new Error('Use a PDF, JPG, PNG or WEBP file'); }
const CL = c => c ? 'rc-' + c : 'rc-none', V = f => f?.v ?? '', TIP = { high: 'Found with a clear label', med: 'Found by pattern — check it', low: 'Weak guess — check it' };
const fld = (k, label, f, type = 'text') => `<label class="${CL(f?.c)}" title="${f ? TIP[f.c] : 'Not found in the document — left blank'}">${label}<input data-rc="${k}" type="${type}" value="${esc(V(f))}" placeholder="${f ? '' : 'not found'}"></label>`;
function review(r, meta, file) { const box = $('#rcReview'); const docKind = /bill\s+of\s+lading|\bB\/L\b/i.test(meta.text) ? 'bol' : 'ratecon';
  box.innerHTML = `<form method="dialog" class="rc-form"><h3>Check what was read from ${esc(file.name)}</h3>
    <p class="small">${meta.ocr ? `Scanned file read with OCR (${meta.conf ?? '?'}% text confidence). ` : 'Read from the PDF text layer. '}<span class="rc-high">green</span> = clear label, <span class="rc-med">amber</span> = pattern match, <span class="rc-low">red</span> = weak, <span class="rc-none">grey</span> = not found (left blank). Nothing is saved until you press Send load.</p>
    ${r.warnings.length ? `<p class="rc-warn">⚠ ${r.warnings.map(esc).join(' · ')}</p>` : ''}
    <div class="grid">${fld('customer', 'Customer / broker', r.customer)}${fld('ref', 'Load ref #', r.ref)}${fld('commodity', 'Commodity', r.commodity)}${fld('weight_lb', 'Weight (lb)', r.weight_lb, 'number')}
    ${fld('equipment', 'Equipment (as written)', r.equipment)}<label class="${CL(r.vehicle?.c)}">Vehicle<select data-rc="vehicle"><option value="">— not sure —</option>${['car', 'van', 'reefervan', 'box', 'semi'].map(v => `<option ${r.vehicle?.v === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    ${fld('rate_usd', 'Rate $ (total)', r.rate_usd, 'number')}${fld('reefer_setpoint', 'Reefer setpoint °F', r.reefer_setpoint, 'number')}${fld('det_rate', 'Detention $/hr', r.detention && { v: r.detention.v.rate_hr, c: r.detention.c }, 'number')}${fld('det_free', 'Detention free min', r.detention && { v: r.detention.v.free_min, c: r.detention.c }, 'number')}</div>
    <h4>Stops (${r.stops.length})</h4>${r.stops.map((s, i) => `<fieldset class="rc-stop" data-rcs="${i}"><legend>Stop ${i + 1}</legend><div class="grid">
      <label class="${CL(s.kind?.c)}">Type<select data-rk><option value="pickup" ${s.kind?.v === 'pickup' ? 'selected' : ''}>Pickup</option><option value="drop" ${s.kind?.v === 'drop' ? 'selected' : ''}>Drop</option></select></label>
      ${fld('name', 'Facility', s.name)}<label class="${CL(s.address?.c)}" data-geo>Address<input data-rc="address" value="${esc(V(s.address))}" placeholder="${s.address ? '' : 'not found'}"><span class="small" data-geomsg>checking map…</span></label>
      ${fld('appt', 'Appointment', s.appt, 'datetime-local')}${fld('appt_end', 'Window ends', s.appt_end, 'datetime-local')}${fld('contact', 'Contact', s.contact)}${fld('phone', 'Phone', s.phone)}${fld('sref', 'Stop ref / PO', s.ref)}</div></fieldset>`).join('')}
    <label class="${CL(r.notes?.c)}">Notes<textarea data-rc="notes" rows="2" placeholder="${r.notes ? '' : 'not found'}">${esc(V(r.notes))}</textarea></label>
    <p class="small">Accessorials: ${r.accessorials.length ? r.accessorials.map(a => `<span class="rc-${a.c}">${esc(a.text)}</span>`).join(' · ') : '<span class="rc-none">none found</span>'}</p>
    <label class="small"><input type="checkbox" id="rcAttach" checked> Attach the original file to the load's documents as <select id="rcKind"><option value="ratecon" ${docKind === 'ratecon' ? 'selected' : ''}>Rate con</option><option value="bol" ${docKind === 'bol' ? 'selected' : ''}>BOL</option><option value="other">Other</option></select> when sent</label>
    <div class="row"><button type="button" id="rcApply">Fill the new-load form</button><button type="button" class="ghost" id="rcCancel">Cancel</button></div></form>`;
  box.showModal?.() ?? box.setAttribute('open', '');
  const geos = r.stops.map(() => null);
  (async () => { for (const [i, s] of r.stops.entries()) { const fs = box.querySelector(`[data-rcs="${i}"]`); if (!fs) return; const m = fs.querySelector('[data-geomsg]'), lab = fs.querySelector('[data-geo]'); if (!s.address) { m.textContent = 'no address — pick it on the form'; continue; }
    try { const h = await geocode(s.address.v); if (h) { geos[i] = h; m.textContent = `📍 ${h.note}: ${h.address}`; lab.className = CL(h.c === 'high' && s.address.c === 'high' ? 'high' : 'med'); } else { m.textContent = '⚠ the map could not confirm this address — you will pick it from the list'; lab.className = 'rc-low'; } }
    catch { m.textContent = '⚠ geocoder unavailable — pick it from the list'; lab.className = 'rc-low'; } } })();
  $('#rcCancel').onclick = () => { box.close?.(); box.removeAttribute('open'); };
  $('#rcApply').onclick = () => { const g = k => box.querySelector(`.rc-form > .grid [data-rc="${k}"]`)?.value.trim() || '', set = (sel, v) => { const e = $(sel); if (e && v !== '') { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('#bRef', g('ref')); set('#bComm', g('commodity')); set('#bWt', g('weight_lb')); set('#bRate', g('rate_usd')); set('#bVeh', g('vehicle')); set('#bDetR', g('det_rate')); set('#bFree', g('det_free'));
    if (g('reefer_setpoint') !== '') { const rf = $('#bReefer'); if (rf) { rf.checked = true; rf.dispatchEvent(new Event('change', { bubbles: true })); } set('#bSet', g('reefer_setpoint')); }
    const cust = g('customer'), opt = cust && [...($('#bCust')?.options || [])].find(o => o.value && (o.textContent.toLowerCase().includes(cust.toLowerCase()) || cust.toLowerCase().includes(o.textContent.trim().toLowerCase())));
    if (opt) set('#bCust', opt.value);
    const stops = [...box.querySelectorAll('[data-rcs]')].map((fs, i) => { const q = k => fs.querySelector(`[data-rc="${k}"]`)?.value.trim() || ''; const addr = q('address'), hit = geos[i] && addr === (r.stops[i].address?.v || '') ? geos[i] : null;
      return { kind: fs.querySelector('[data-rk]').value, address: hit ? hit.address : addr, lat: hit?.lat ?? null, lng: hit?.lng ?? null, _appt: q('appt'), name: q('name') || null, contact: [q('contact'), q('phone')].filter(Boolean).join(' ') || null, ref: q('sref') || null, _apptEnd: q('appt_end') }; });
    const acc = r.accessorials.map(a => a.text).join('; '), extra = [box.querySelector('[data-rc="notes"]').value.trim(), cust && !opt ? `Customer: ${cust} (not in contacts yet)` : '', acc ? `Accessorials: ${acc}` : '', ...stops.map((s, i) => [s.contact && `Stop ${i + 1} contact: ${s.contact}`, s._apptEnd && `Stop ${i + 1} window ends ${s._apptEnd.replace('T', ' ')}`, s.ref && `Stop ${i + 1} ref: ${s.ref}`].filter(Boolean).join('; '))].filter(Boolean).join('\n');
    set('#bNotes', extra.slice(0, 1500)); window.RRB?.setDraft?.(stops);
    pending = $('#rcAttach').checked ? { file, kind: $('#rcKind').value } : null;
    box.close?.(); box.removeAttribute('open'); const miss = stops.filter(s => s.lat == null).length;
    $('#bMsg').textContent = `📄 Filled from ${file.name}. Check every field${miss ? ` and pick ${miss} address${miss > 1 ? 'es' : ''} from the list (⚠)` : ''}, choose a driver, then press Send load. Nothing has been saved yet.`; }; }
async function handle(file) { const st = $('#rcStatus'), status = t => { st.textContent = t; }; if (!file) return; if (file.size > 15 * 1024 * 1024) return status('⚠ File too large (max 15 MB)');
  try { const meta = await readFile(file, status); meta.text = meta.rows.map(r => r.cells.map(c => c.t).join(' ')).join('\n'); const r = parseRateCon(meta.rows); window.RRI.last = { r, meta: { ocr: meta.ocr, conf: meta.conf }, text: meta.text };
    status(`Read ${file.name}: ${r.stops.length} stop(s)${r.rate_usd ? ', rate $' + r.rate_usd.v : ''}. Check the form.`); review(r, meta, file); } catch (e) { status('⚠ Could not read the file: ' + e.message); } }
export function start() { const z = $('#rcDrop'), f = $('#rcFile'); if (!z) return; window.RRI = { get pending() { return pending; }, clear: () => { pending = null; }, last: null };
  ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('rc-over'); }));
  ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('rc-over'); }));
  z.addEventListener('drop', e => handle(e.dataTransfer.files[0])); f.addEventListener('change', () => { handle(f.files[0]); f.value = ''; });
  z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.click(); } }); }

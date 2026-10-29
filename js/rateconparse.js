// Rate con / BOL / load-tender text → load draft. Pure + testable. Every field carries a confidence: 'high' | 'med' | 'low'.
// Never invents values: a field it cannot find is null (left blank for the dispatcher).
// Input: rows = [{ y, cells: [{ x, t, h? }] }] in reading order (from pdf.js text items or tesseract words), or a plain string.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const HDR = /^(?:stop\s*#?\s*\d+\s*[-–:(]?\s*)?(pick\s*-?\s*up(?:\s+(?:at|from|location|info))?|pu\s*\d*|shipper(?:\s+info)?|origin|load\s+at|ship\s+from|consignee(?:\s+info)?|deliver(?:y|ies)?(?:\s+(?:to|at|location|info))?|drop(?:\s*-?\s*off)?(?:\s+at)?|receiver|destination|ship\s+to|so\s*\d*|stop\s*#?\s*\d+)\)?\s*:?$/i;
const KNOWN = 'equipment|equip|trailer|commodity|description|product|weight|temp|temperature|pallets|pieces|qty|rate|total|fuel|stop\\s*off|date|time|contact|phone|tel|appt|appointment|ref|po|pickup|deliver|driver|carrier|load\\s*#|order|pro|mc#|dot#|email|fax|hours|window|notes|bill\\s*to';
const TOPLAB = /^(equipment|equip|trailer|commodity|weight|rate|total|line\s*haul|charges|special\s+instructions|notes|comments|instructions|detention|accessorials?|terms|carrier\s+pay|agreed\s+rate|tonu|fuel)\b/i;
const PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;
const CITY = /([A-Za-z][A-Za-z .'-]*?),?\s+([A-Z][A-Za-z])\.?\s+(\d{5})(?:-\d{4})?\b/;
const pad = n => String(n).padStart(2, '0');
export const C = (v, c) => (v == null || v === '' ? null : { v, c });
export function rowsFromText(s) { return String(s).split(/\r?\n/).map((l, y) => { const cells = []; const re = /\S+(?:\s{1,2}\S+)*/g; let m; while ((m = re.exec(l))) cells.push({ x: m.index, t: m[0] }); return { y, cells }; }).filter(r => r.cells.length); }
const clean = s => String(s || '').replace(/[\u2018\u2019\u00B4`]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
function field(line, lab, opt = false) { const re = new RegExp(`(?:^|[\\s|])(?:${lab})\\b\\s*(?:#|no\\.?|number|num)?\\s*[:#]${opt ? '?' : ''}\\s*`, 'i'); const m = re.exec(line); if (!m) return null; let v = line.slice(m.index + m[0].length);
  const stop = new RegExp(`\\s{3,}|\\s\\|\\s|\\s(?:${KNOWN})\\s*(?:#|no\\.?)?\\s*:`, 'i'); const k = v.search(stop); if (k >= 0) v = v.slice(0, k); v = v.trim().replace(/[,;]$/, ''); return v || null; }
export function parseDate(s, yHint = new Date().getFullYear()) { s = clean(s); let m;
  if ((m = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(s))) return { d: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, i: m.index, len: m[0].length };
  if ((m = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(s))) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[1] <= 12 && +m[2] <= 31) return { d: `${y}-${pad(m[1])}-${pad(m[2])}`, i: m.index, len: m[0].length }; }
  if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})?\b/i.exec(s))) return { d: `${m[3] || yHint}-${pad(MON[m[1].toLowerCase()])}-${pad(m[2])}`, i: m.index, len: m[0].length, guessYear: !m[3] };
  if ((m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s*(20\d{2})?\b/i.exec(s))) return { d: `${m[3] || yHint}-${pad(MON[m[2].toLowerCase()])}-${pad(m[1])}`, i: m.index, len: m[0].length, guessYear: !m[3] };
  return null; }
function hm(h, m, ap) { h = +h; m = +m; if (ap) { ap = ap.toLowerCase()[0]; if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0; } return h < 24 && m < 60 ? `${pad(h)}:${pad(m)}` : null; }
export function parseTimes(s, labelled) { s = clean(s).replace(new RegExp(PHONE.source, 'g'), ' '); const T = '(\\d{1,2}):(\\d{2})\\s*([ap]\\.?m\\.?)?', M = '([01]\\d|2[0-3])([0-5]\\d)', A = '(\\d{1,2})\\s*([ap]\\.?m\\.?)';
  let m = new RegExp(`${T}\\s*(?:-|to|until|thru)\\s*${T}`, 'i').exec(s); if (m) { const ap2 = m[6]; return [hm(m[1], m[2], m[3] || (ap2 && +m[1] <= +m[4] ? ap2 : null)), hm(m[4], m[5], ap2)]; }
  if (labelled && (m = new RegExp(`\\b${M}\\s*(?:-|to)\\s*${M}\\b`, 'i').exec(s))) return [hm(m[1], m[2]), hm(m[3], m[4])];
  if ((m = new RegExp(`\\b${A}\\s*(?:-|to)\\s*${A}`, 'i').exec(s))) return [hm(m[1], 0, m[2]), hm(m[3], 0, m[4])];
  if ((m = new RegExp(T, 'i').exec(s))) return [hm(m[1], m[2], m[3]), null];
  if ((m = new RegExp(`\\b${A}\\b`, 'i').exec(s))) return [hm(m[1], 0, m[2]), null];
  if (labelled && (m = new RegExp(`(?:appt|time|appointment|window|hours)\\s*:?\\s*${M}\\b`, 'i').exec(s))) return [hm(m[1], m[2]), null];
  return null; }
const money = s => { const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(s) || /\b([\d,]{1,7}\.\d{2})\b/.exec(s); if (!m) return null; const n = +m[1].replace(/,/g, ''); return isFinite(n) && n > 0 ? n : null; };
export function vehicleOf(eq) { const e = (eq || '').toLowerCase(); if (!e) return null;
  if (/box\s*truck|straight\s*truck|\b(16|20|22|24|26)\s*'?\s*(ft)?\s*(box|straight)/.test(e)) return 'box';
  if (/reefer\s*van|refrigerated\s*(cargo\s*)?van|sprinter.*(reefer|refriger)/.test(e) && !/53|48|trailer/.test(e)) return 'reefervan';
  if (/sprinter|cargo\s*van|transit\s*van|\bhot\s*shot/.test(e)) return 'van';
  if (/53|48|dry\s*van|reefer|flat\s*bed|flatbed|step\s*deck|conestoga|tanker|trailer|tractor|lowboy|rgn|intermodal|container/.test(e)) return 'semi';
  return null; }
function splitColumns(rows, i0, heads) { // side-by-side stop blocks: assign each following cell to the header column to its left
  const xs = heads.map(h => h.x), cols = heads.map(() => []); let i = i0 + 1;
  for (; i < rows.length; i++) { const r = rows[i], first = clean(r.cells[0].t); if (TOPLAB.test(first) && r.cells[0].x < xs[1] - 5 && r.cells.length === 1) break; if (r.cells.some(c => HDR.test(clean(c.t)))) break;
    const per = heads.map(() => []); for (const c of r.cells) { let k = 0; for (let j = 0; j < xs.length; j++) if (c.x >= xs[j] - 8) k = j; per[k].push(clean(c.t)); }
    per.forEach((p, k) => p.length && cols[k].push(p.join(' '))); if (!r.cells.length) break; }
  return { cols, next: i }; }
function parseStop(kindTxt, lines, yHint) { const kind = /pick|shipper|origin|load\s+at|ship\s+from|^pu/i.test(kindTxt) ? 'pickup' : /stop\s*#?\s*\d+$/i.test(kindTxt) ? null : 'drop';
  const s = { kind: C(kind, kind ? 'high' : 'low'), name: null, address: null, appt: null, appt_end: null, phone: null, contact: null, ref: null };
  let street = null, city = null, date = null, times = null;
  for (const raw of lines) { const l = clean(raw); if (!l) continue; let m;
    if (/^(contact|attn|phone|tel|ph)\b/i.test(l) || (PHONE.test(l) && !CITY.test(l) && !parseDate(l))) { const p = PHONE.exec(l); if (p && !s.phone) s.phone = C(p[0], 'high'); const nm = clean(l.replace(PHONE, '').replace(/^(contact|attn|phone|tel|ph)\s*:?\s*/i, '').replace(/[,:-]+$/, '')); if (nm && !/^(phone|tel)/i.test(nm) && !s.contact && /^(contact|attn)/i.test(l)) s.contact = C(nm, 'med'); continue; }
    if (/^(ref|po|pu\s*#|del\s*#|confirmation|appt\s*#)\b/i.test(l) && !parseDate(l)) { if (!s.ref) s.ref = C(l.replace(/^(ref|po)\s*[:#]?\s*/i, ''), 'med'); continue; }
    const d = parseDate(l, yHint); const lab = /\b(appt|time|appointment|window|hours)\b/i.test(l);
    if (d || lab) { if (d && !date) date = d; const t = parseTimes(d ? l.slice(0, d.i) + ' ' + l.slice(d.i + d.len) : l, lab || !!d); if (t && !times) times = t; continue; }
    if ((m = /^(\d+[A-Za-z]?\s+[^,]+?),\s*([A-Za-z][A-Za-z .'-]+),\s*([A-Z][A-Za-z])\.?\s+(\d{5})/.exec(l))) { street = m[1]; city = `${m[2]}, ${m[3].toUpperCase()} ${m[4]}`; continue; }
    if ((m = CITY.exec(l)) && m.index < 3 && !street && /^\d/.test(l)) { street = l.slice(0, m.index).replace(/,\s*$/, '') || null; city = `${m[1]}, ${m[2].toUpperCase()} ${m[3]}`; continue; }
    if ((m = CITY.exec(l)) && m.index === 0 && /^[A-Za-z]/.test(l)) { city = `${m[1].trim()}, ${m[2].toUpperCase()} ${m[3]}`; continue; }
    if (/^\d+[A-Za-z]?\s+\S+/.test(l) && !street) { street = l; continue; }
    if (/^(p\.?o\.?\s*box|one|two)\s/i.test(l) && !street && s.name) { street = l; continue; }
    if (!s.name && !/:/.test(l) && /[A-Za-z]{2}/.test(l)) { s.name = C(l, street || city ? 'med' : 'med'); continue; } }
  if (street || city) s.address = C([street, city].filter(Boolean).join(', '), street && city ? 'high' : 'low');
  if (date) { s.appt = times?.[0] ? C(`${date.d}T${times[0]}`, date.guessYear ? 'med' : 'high') : C(`${date.d}T00:00`, 'low'); if (times?.[1]) s.appt_end = C(`${date.d}T${times[1]}`, date.guessYear ? 'med' : 'high'); }
  return s; }
export function parseRateCon(input, opts = {}) { const rows = typeof input === 'string' ? rowsFromText(input) : input.filter(r => r.cells?.length).map(r => ({ ...r, cells: [...r.cells].sort((a, b) => a.x - b.x) }));
  const yHint = opts.year || new Date().getFullYear(); const lines = rows.map(r => clean(r.cells.map(c => c.t).join('   '))), raw = rows.map(r => r.cells.map(c => clean(c.t)).join('   '));
  const out = { customer: null, ref: null, stops: [], commodity: null, weight_lb: null, equipment: null, vehicle: null, reefer_setpoint: null, rate_usd: null, accessorials: [], detention: null, notes: null, warnings: [] };
  // stops
  const inStop = new Set(); let i = 0;
  while (i < rows.length) { const heads = rows[i].cells.filter(c => HDR.test(clean(c.t)));
    if (heads.length >= 2) { const { cols, next } = splitColumns(rows, i, heads); heads.forEach((h, k) => out.stops.push(parseStop(clean(h.t), cols[k], yHint))); for (let j = i; j < next; j++) inStop.add(j); i = next; continue; }
    if (heads.length === 1 && rows[i].cells.length <= 2) { const body = []; let j = i + 1; for (; j < rows.length; j++) { const f = clean(rows[j].cells[0].t); if (rows[j].cells.some(c => HDR.test(clean(c.t))) || (TOPLAB.test(f) && !/^(contact|date|time)/i.test(f))) break; body.push(raw[j]); if (body.length > 10) break; }
      out.stops.push(parseStop(clean(heads[0].t), body, yHint)); for (let k = i; k < j; k++) inStop.add(k); i = j; continue; }
    i++; }
  out.stops = out.stops.filter(s => s.address || s.name);
  out.stops.forEach((s, k) => { if (!s.kind) s.kind = C(k === 0 ? 'pickup' : 'drop', 'low'); });
  if (out.stops.length && out.stops[0].kind.v !== 'pickup') out.warnings.push('First stop is not a pickup — check the order');
  const top = lines.map((l, k) => ({ l, k })).filter(x => !inStop.has(x.k)), all = top.map(x => x.l).join('\n');
  // reference (priority order)
  for (const [lab, c] of [['load', 'high'], ['order', 'high'], ['pro', 'high'], ['confirmation', 'high'], ['tender', 'high'], ['shipment', 'high'], ['trip', 'med'], ['reference|ref', 'med'], ['bol|b/l', 'med']]) {
    for (const { l } of top) { const re = new RegExp(`\\b(?:${lab})\\s*(?:#|no\\.?|number|num|id)?\\s*[:#]\\s*([A-Z0-9][A-Z0-9-]{3,})\\b`, 'i'), m = re.exec(l); if (m && /\d/.test(m[1]) && !/^\d{1,2}\/\d/.test(m[1])) { out.ref = C(m[1].toUpperCase(), c); break; } }
    if (out.ref) break; }
  // customer / broker
  for (const { l } of top) { const v = field(l, 'broker|customer|bill\\s*to|billed\\s*to|shipper\\s*of\\s*record'); if (v) { out.customer = C(clean(v.split(/,\s*(?=\d)/)[0]).replace(/,\s*$/, ''), /broker|customer/i.test(l) ? 'high' : 'med'); break; } }
  if (!out.customer) { const first = rows.find(r => r.cells.length && /[A-Za-z]{3}/.test(r.cells[0].t)); const t = first && clean(first.cells[0].t);
    if (t && /\b(llc|inc\.?|co\.?|corp\.?|company|logistics|brokerage|freight|transport(ation)?|brokers?|dispatch|trucking|express|carriers?|lines|services|group)\b/i.test(t) && !/rate\s+con|confirmation|tender|bill\s+of\s+lading/i.test(t)) out.customer = C(t, 'med'); }
  // load fields
  for (const { l } of top) { let v;
    if (!out.commodity && (v = field(l, 'commodity|description|product'))) out.commodity = C(v, 'high');
    if (!out.weight_lb && (v = /\b(?:weight|wt|gross\s*wt)\.?\s*:?\s*([\d,]{2,7}(?:\.\d+)?)\s*(lbs?|pounds|#|kg)?/i.exec(l))) { let n = +v[1].replace(/,/g, ''); if (/kg/i.test(v[2] || '')) n = Math.round(n * 2.20462); if (n > 0 && n < 200000) out.weight_lb = C(n, v[2] ? 'high' : 'med'); }
    if (!out.equipment && (v = field(l, 'equipment|equip|trailer\\s*type|trailer|truck\\s*type'))) { out.equipment = C(v.replace(/\s+temp.*$/i, ''), 'high'); const vh = vehicleOf(v); out.vehicle = vh ? C(vh, 'high') : null; }
    if (out.reefer_setpoint == null && (v = /\b(?:temp(?:erature)?|set\s*-?point|reefer)\s*:?\s*(-?\d{1,3})\s*°?\s*([FC])\b/i.exec(l))) { let n = +v[1]; if (v[2].toUpperCase() === 'C') n = Math.round(n * 9 / 5 + 32); out.reefer_setpoint = C(n, 'high'); }
    if (!out.detention && (v = /detention[^\n]*?\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(?:h(?:ou)?r|hr)s?\b[^\n]*?(?:after|following|beyond)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|min(?:utes)?)/i.exec(l))) out.detention = C({ rate_hr: +v[1], free_min: Math.round(+v[2] * (/min/i.test(v[3]) ? 1 : 60)) }, 'high'); }
  if (!out.equipment) { const m = /\b(53|48)\s*'?\s*(?:ft)?\s*(dry\s*van|reefer|flatbed|van)\b|\b(dry\s*van|reefer|flatbed|box\s*truck|sprinter|cargo\s*van)\b/i.exec(all); if (m) { out.equipment = C(clean(m[0]), 'low'); const vh = vehicleOf(m[0]); out.vehicle = vh ? C(vh, 'low') : null; } }
  // rate: total wins over line haul
  const RATE = [[/\btotal\s+(?:carrier\s+)?(?:pay|rate|amount|charges?|due)\b/i, 'high'], [/\b(?:agreed|all[\s-]?in|flat)\s+rate\b/i, 'high'], [/\bcarrier\s+pay\b/i, 'high'], [/\btotal\b/i, 'high'], [/\brate\b/i, 'med'], [/\bline\s*haul\b/i, 'med']];
  for (const [re, c] of RATE) { for (const { l } of top) { const m = re.exec(l); if (!m) continue; const n = money(l.slice(m.index)); if (n) { out.rate_usd = C(n, c); break; } } if (out.rate_usd) break; }
  const ACC = [['fuel', /fuel(\s*surcharge)?|fsc\b/i], ['lumper', /lumper/i], ['detention', /detention/i], ['layover', /layover/i], ['tonu', /\btonu\b|truck\s+ordered\s+not\s+used/i], ['stop', /stop[\s-]?off|extra\s+stop|additional\s+stop/i], ['liftgate', /liftgate\s*(fee|charge)/i], ['driver assist', /driver\s+assist|unload\s*fee/i], ['overnight', /overnight/i]];
  for (const { l } of top) for (const [k, re] of ACC) { const m = re.exec(l); if (!m || out.accessorials.some(a => a.type === k)) continue; const seg = l.slice(m.index, m.index + 80); const amt = money(seg.split(/\s{3,}(?=[A-Z])/)[0]) ?? money(seg);
    if (/included|n\/a|none/i.test(seg.slice(0, 30)) && !amt) continue; out.accessorials.push({ type: k, amount: amt, text: clean(seg.split(/\s{3,}/)[0]).slice(0, 80), c: amt ? 'high' : 'med' }); }
  // notes: labelled instructions + following unlabeled lines
  for (let k = 0; k < top.length; k++) { const v = field(top[k].l, 'special\\s+instructions|instructions|notes|comments|remarks'); if (v) { let n = v; for (let j = k + 1; j < Math.min(top.length, k + 4); j++) { if (TOPLAB.test(top[j].l) || /:/.test(top[j].l.slice(0, 25))) break; n += ' ' + top[j].l; } out.notes = C(n.slice(0, 500), 'high'); break; } }
  if (!out.stops.length) out.warnings.push('No pickup/delivery sections found — add stops by hand');
  if (!out.rate_usd) out.warnings.push('No rate found');
  return out; }
// geocode check: compare the geocoder's result with the parsed ZIP / city to grade confidence
export function geoConfidence(parsed, hit) { if (!hit) return 'low'; const z = /\b(\d{5})\b/.exec(parsed)?.[1]; if (z && hit.address.includes(z)) return 'high'; const city = /,\s*([A-Za-z .'-]+),\s*[A-Z]{2}/.exec(parsed)?.[1]?.trim().toLowerCase(); return city && hit.address.toLowerCase().includes(city) ? 'med' : 'low'; }

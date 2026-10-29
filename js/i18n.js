// RigRoute i18n: English source strings are the keys. The DOM translator swaps visible text + placeholder/title/aria-label/alt
// (originals kept, so switching language re-translates from English). Strings with numbers match "{0}" pattern keys and get
// locale-formatted numbers back. Untranslated visible strings are collected in I18N.missing (the no-untranslated-strings test reads it).
// Languages come from i18n/index.json (built from each i18n/<code>.json "_meta" by scripts/i18n-index.mjs):
// adding a language = adding one JSON file. _meta: { name, dir, beta, locale, speech, valhalla }.
const BASE = new URL('../i18n/', import.meta.url);
let META = {}; try { META = await (await fetch(new URL('index.json', BASE))).json(); } catch {}
META.en ||= { name: 'English', locale: 'en-US', speech: 'en-US', valhalla: 'en-US' };
export const LANGS = Object.fromEntries(Object.entries(META).map(([k, v]) => [k, v.name]));
export const LOCALE = new Proxy({}, { get: (_, k) => META[k]?.locale || 'en-US' });
export const SPEECH = new Proxy({}, { get: (_, k) => META[k]?.speech || META[k]?.locale || 'en-US' });
const VALHALLA = new Proxy({}, { get: (_, k) => META[k]?.valhalla || 'en-US' });
export const META_ = META;
export const RTL = new Set(Object.entries(META).filter(([, v]) => v.dir === 'rtl').map(([k]) => k));
export function detect(list = (typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [])) {
  for (const l of list || []) { const b = String(l || '').toLowerCase().split(/[-_]/)[0]; if (b === 'kr' || b === 'cpf') return 'ht'; if (LANGS[b]) return b; } return 'en'; }
const LSK = 'tn_lang';
let lang = 'en', dict = {}, base = {}, pats = [], hasEn = false, done = new Set(), words = new Set(), long = [];
let saved = null; try { saved = JSON.parse(localStorage.getItem(LSK) || 'null'); } catch {}
const WD = typeof navigator !== 'undefined' && navigator.webdriver === true; // automated tests: raw source strings unless a language is set (legacy e2e assert source text)
lang = LANGS[saved] ? saved : WD ? 'src' : detect();
const q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lang'); if (q && (LANGS[q] || q === 'xx' || q === 'src')) lang = q; // xx = string-collection mode (empty dictionary)
const TRAIL = /[^\p{L}\p{N})"”'»]+$/u, LEAD = /^[^\p{L}\p{N}"“(¿¡«]+/u;
const NUM = /(?<![\p{L}])\d+(?:[.,:]\d+)*/gu;
const norm = s => s.replace(/\s+/g, ' ').trim();
function index() { pats = []; done = new Set(); words = new Set(); long = []; const addD = (v, mine = true) => { done.add(v); const b = v.replace(TRAIL, '').replace(LEAD, ''); done.add(b); done.add(keyOf(b)); done.add(keyOf(v)); const e = v.split(/\s*[🔒\u{1F300}-\u{1FAFF}]/u)[0].trim(); if (e) done.add(e); if (mine) for (const w of v.split(/\s+/)) if (w.length > 1) words.add(w.replace(TRAIL, '').replace(LEAD, '')); long.push(v); }; Object.values(dict).forEach(addD); if (lang !== 'en') Object.values(base).forEach(v => addD(v, false)); const mk = d => { for (const [k, v] of Object.entries(d)) if (k.includes('{0}') && !/^\{\d\}$/.test(k)) pats.push([new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d)\}/g, '((?:(?! · ).)+?)') + '$'), v, d === dict]); }; mk(dict); if (base !== dict) mk(base); }
const fmtNum = s => { if (lang === 'en' || /:/.test(s)) return s; const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) && !/^0\d/.test(s) ? new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(n) : s; };
export const I18N = { missing: new Set(), get lang() { return lang; } };
// t(): translate one English string (exact, then number-pattern). Returns English if unknown (and records it).
let quiet = false, nativeOnly = false; export const tq = s => { quiet = true; try { return t(s); } finally { quiet = false; } };
const own = (d, k) => Object.hasOwn(d, k) ? d[k] : null;
// one lookup in one dictionary: exact, then numbers -> {0}, then {0}-pattern keys (captured parts translated too)
function look(d, k) { let v = own(d, k); if (v != null) return v;
  const nums = []; const pk = k.replace(NUM, m => `{${nums.push(m) - 1}}`);
  if (nums.length && (v = own(d, pk)) != null) return v.replace(/\{(\d)\}/g, (_, i) => fmtNum(nums[+i] ?? ''));
  for (const [re, val, mine] of pats) { if (mine !== (d === dict)) continue; const m = k.match(re); if (m) return val.replace(/\{(\d)\}/g, (_, i) => tq(m[+i + 1])); }
  return null; }
// proper names, brands, hosts and codes are never translated (and never "missing")
const KEEP = /^(ACE|Ace|RigRoute( GPS| Dispatch)?|Apple Maps|Google Maps|Waze|OpenFreeMap|OpenStreetMap contributors|Overpass|Photon|Valhalla|USGS The National Map|Map ©|Port Newark|Pilot Travel Center|Whitney Houston Service Area|TomTom|HERE|ElevenLabs|NYC DOT|GPS|SOS|OK|MPH|CDL|TWIC|E-ZPass|PrePass|Drivewyze)$|^(wss:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+$|^([A-Z]{2,3} \{\d\}( · )?)+$/;
function isDone(k) { if (done.has(k) || KEEP.test(k)) return true;
  if (!/\s/.test(k) && words.has(k.replace(TRAIL, '').replace(LEAD, ''))) return true; // one translated word left alone by markup
  if (k.length > 12 && long.some(v => v.includes(k.replace(TRAIL, '')))) return true; // piece of a translated sentence split by markup
  if (k.includes(' · ')) return k.split(' · ').every(p => !/\p{L}{2}/u.test(p) || isDone(p.trim())); const pk = keyOf(k); if (done.has(pk) || KEEP.test(pk)) return true;
  const m = k.match(/^([^\p{L}\p{N}"“(¿¡]*)(.*?)([^\p{L}\p{N})"”']*)$/u); if (m && m[2]) { if (done.has(m[2]) || KEEP.test(m[2]) || done.has(keyOf(m[2]))) return true; if (done.has(m[2] + m[3].trim()) || done.has(keyOf(m[2] + m[3].trim()))) return true; } return false; }
const keyOf = k => { const nums = []; const pk = k.replace(NUM, m => `{${nums.push(m) - 1}}`); return nums.length ? pk : k; };
export function t(s, vars) { if (s == null) return s; let out = String(s);
  if ((lang !== 'en' && lang !== 'src') || hasEn) { const k0 = norm(out); if (!k0 || (own(dict, k0) == null && own(dict, k0.replace(TRAIL, '').replace(LEAD, '')) == null && isDone(k0))) return s; // already in the target language (app code re-wrote translated text)
    // icons/emoji/bullets in front and . : … ! ? at the end stay as written when the bare words are the key
    const pm = k0.match(/^([^\p{L}\p{N}"“(¿¡]*)(.*?)([^\p{L}\p{N})"”']*)$/u), cands = [[k0, '', '']];
    if (pm && pm[1]) cands.push([k0.slice(pm[1].length), pm[1], '']); if (pm && pm[3] && pm[2]) cands.push([pm[2], pm[1], pm[3]]);
    let hit = null;
    if (k0.includes(' · ') && look(dict, k0) == null && look(base, k0) == null) return String(s).match(/^\s*/)[0] + k0.split(' · ').map(p => t(p)).join(' · ');
    for (const [k, pre, post] of cands) { const v = look(dict, k); if (v != null) { hit = pre + v + post; break; } }
    if (hit == null) { for (const [k, pre, post] of cands) { const v = base === dict ? null : look(base, k); if (v != null) { hit = pre + v + post; break; } }
      if (lang !== 'en' && !quiet && /\p{L}{2}/u.test(k0)) I18N.missing.add(keyOf(cands.at(-1)[0])); }
    if (hit != null) out = (String(s).match(/^\s*/)[0]) + hit; }
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? `{${n}}`); return out; }
// ---- locale formatting: calls with no locale (or []) use the chosen language
if (typeof Date !== 'undefined' && !Date.prototype.__i18n) { Date.prototype.__i18n = 1;
  for (const f of ['toLocaleTimeString', 'toLocaleDateString', 'toLocaleString']) { const o = Date.prototype[f]; Date.prototype[f] = function (l, opt) { return o.call(this, l == null || (Array.isArray(l) && !l.length) ? LOCALE[lang] : l, opt); }; }
  const n = Number.prototype.toLocaleString; Number.prototype.toLocaleString = function (l, opt) { return n.call(this, l == null || (Array.isArray(l) && !l.length) ? LOCALE[lang] : l, opt); }; }
// ---- DOM translation
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'], orig = new WeakMap(), oattr = new WeakMap();
const SKIP = 'script,style,noscript,code,pre,[translate=no],.notranslate,.maplibregl-ctrl-attrib,textarea,svg';
function trNode(n) { const p = n.parentElement; if (!p || p.closest(SKIP)) return; const cur = n.nodeValue; if (!/\p{L}/u.test(cur)) return;
  let o = orig.get(n); if (o == null || (cur !== o.en && cur !== o.tr)) { o = { en: cur, tr: null }; orig.set(n, o); }
  const lead = o.en.match(/^\s*/)[0], trail = o.en.match(/\s*$/)[0], body = o.en.trim(); const v = lang === 'en' && !hasEn ? o.en : lead + t(body) + trail; o.tr = v; if (v !== cur) n.nodeValue = v; }
function trEl(el) { if (el.closest?.(SKIP)) return; let o = oattr.get(el); if (!o) oattr.set(el, o = {});
  for (const a of ATTRS) { if (!el.hasAttribute(a)) continue; const cur = el.getAttribute(a); if (o[a] == null || (cur !== o[a].en && cur !== o[a].tr)) o[a] = { en: cur, tr: null };
    const v = lang === 'en' && !hasEn ? o[a].en : t(o[a].en); o[a].tr = v; if (v !== cur) el.setAttribute(a, v); }
  if (el.tagName === 'INPUT' && /^(button|submit)$/.test(el.type) && el.value) { const k = '_v'; if (o[k] == null || (el.value !== o[k].en && el.value !== o[k].tr)) o[k] = { en: el.value }; const v = lang === 'en' && !hasEn ? o[k].en : t(o[k].en); o[k].tr = v; if (v !== el.value) el.value = v; } }
export function translateTree(root = document.body) { if (!root) return; if (root.nodeType === 3) return trNode(root); if (root.nodeType !== 1) return; trEl(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n; while ((n = w.nextNode())) n.nodeType === 3 ? trNode(n) : trEl(n); }
let mo, pend = new Set(), sched = false;
function flush() { sched = false; const s = pend; pend = new Set(); mo?.disconnect(); for (const n of s) if (n.isConnected) translateTree(n); observe(); }
function observe() { mo ||= new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') pend.add(m.target); else if (m.type === 'attributes') pend.add(m.target); else m.addedNodes.forEach(x => pend.add(x)); }
  if (!sched) { sched = true; queueMicrotask(flush); } });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('value') }); }
function applyDir() { const h = document.documentElement; h.lang = lang === 'ar' ? 'ar' : LOCALE[lang].split('-u-')[0]; h.dir = RTL.has(lang) ? 'rtl' : 'ltr'; document.body?.classList.toggle('rtl', RTL.has(lang)); }
const getJ = async c => { try { const j = await (await fetch(new URL(c + '.json', BASE))).json(); delete j._meta; return j; } catch { return {}; } };
async function load(l) { if (l === 'src') { dict = {}; base = {}; hasEn = false; index(); return; }
  base = await getJ('en'); dict = l === 'en' ? base : l === 'xx' ? {} : await getJ(l); if (l === 'xx') base = {}; hasEn = l === 'en' && Object.keys(dict).length > 0; index(); }
export async function setLang(l, { save = true } = {}) { if (!LANGS[l]) l = 'en'; lang = l; I18N.missing.clear(); if (save) try { localStorage.setItem(LSK, JSON.stringify(l)); } catch {}
  await load(l); applyDir(); translateTree(document.body); if (document.title) document.title = t(I18N.title0 ||= document.title); dispatchEvent(new CustomEvent('rr-lang', { detail: l })); }
export const valhallaLang = () => VALHALLA[lang] || 'en-US';
export const speechLang = () => SPEECH[lang] || 'en-US';
export const locale = () => LOCALE[lang];
await load(lang);
if (typeof document !== 'undefined') { const go = () => { applyDir(); I18N.title0 = document.title; if (lang !== 'en' || hasEn) { translateTree(document.body); document.title = t(document.title); } observe(); };
  document.body ? go() : addEventListener('DOMContentLoaded', go, { once: true }); }
Object.assign(I18N, { t, tq, setLang, LANGS, translateTree, valhallaLang, speechLang, locale }); globalThis.RRI18N = I18N;
// native dialogs carry English text built in code: translate them too
if (typeof window !== 'undefined' && !window.__i18nDlg) { window.__i18nDlg = 1;
  for (const f of ['alert', 'confirm', 'prompt']) { const o = window[f]; window[f] = function (m, ...a) { return (window[f].__raw || o).call(window, t(m == null ? '' : String(m)), ...a); }; window[f].__raw = o; } }
// geocoders: Photon only has en/de/fr/it place names; Nominatim + TomTom take the app language
I18N.photonLang = () => ['de', 'fr', 'it'].includes(lang) ? lang : 'en';
I18N.geoLang = () => (lang === 'src' || lang === 'xx' ? 'en' : lang);

// Flesch-Kincaid grade of the English UI text (keys with en.json plain rewrites applied).
// usage: node scripts/readability.mjs [maxGradeToList]
import fs from 'node:fs';
const keys = JSON.parse(fs.readFileSync('i18n/_keys.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('i18n/en.json', 'utf8'));
export function syl(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, ''); if (!w) return 0; if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g); return Math.max(1, m ? m.length : 1);
}
const words = s => s.replace(/\{\d\}/g, '5').match(/[A-Za-z][A-Za-z']*/g) || [];
export function fk(texts) {
  let W = 0, S = 0, Y = 0;
  for (const t of texts) { const w = words(t); if (w.length < 3) continue; S += Math.max(1, (t.match(/[.!?]+(\s|$)/g) || []).length); W += w.length; Y += w.reduce((a, x) => a + syl(x), 0); }
  return { grade: 0.39 * W / S + 11.8 * Y / W - 15.59, words: W, sentences: S };
}
const vals = keys.map(k => en[k] ?? k);
const r = fk(vals);
console.log(`Flesch-Kincaid grade (English UI, ${r.words} words, ${r.sentences} sentences): ${r.grade.toFixed(2)}`);
const lim = process.argv[2];
if (lim) vals.map((v, i) => [fk([v]).grade, i, v]).filter(x => words(x[2]).length >= 4 && x[0] > +lim).sort((a, b) => b[0] - a[0]).forEach(([g, i, v]) => console.log(`${i}|${g.toFixed(0)}|${v}`));
const long = vals.filter(v => words(v).length >= 8), rl = fk(long);
console.log(`Help/sentence text only (${long.length} strings of 8+ words): ${rl.grade.toFixed(2)}`);

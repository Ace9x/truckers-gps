// Builds i18n/index.json from every i18n/<code>.json "_meta" block, so adding a language = adding one JSON file.
// Also prints coverage vs i18n/_keys.json (the visible-string inventory from test/i18n-crawl.mjs).
import fs from 'fs'; const dir = new URL('../i18n/', import.meta.url);
const keys = JSON.parse(fs.readFileSync(new URL('_keys.json', dir), 'utf8')); const idx = {};
for (const f of fs.readdirSync(dir).filter(f => /^[a-z]{2,3}(-[A-Za-z]+)?\.json$/.test(f)).sort()) {
  const j = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')), code = f.replace('.json', ''); if (!j._meta) continue;
  const have = keys.filter(k => Object.hasOwn(j, k)).length; idx[code] = { ...j._meta, coverage: code === 'en' ? 1 : +(have / keys.length).toFixed(3) };
  console.log(code.padEnd(4), j._meta.name.padEnd(16), code === 'en' ? 'source' : `${have}/${keys.length}`); }
fs.writeFileSync(new URL('index.json', dir), JSON.stringify(idx, null, 1) + '\n');

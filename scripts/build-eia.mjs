// Fetch EIA weekly retail on-highway diesel averages (U.S. + PADD regions + California). Free public data, no key. Runs in CI.
import { writeFileSync } from 'node:fs';
const url = 'https://www.eia.gov/dnav/pet/pet_pri_gnd_a_epd2d_pte_dpgal_w.htm';
const s = await (await fetch(url, { headers: { 'User-Agent': 'RigRoute/2.3 (github.com/Ace9x/truckers-gps)' } })).text();
const t = s.replace(/<[^>]+>/g, '|').replace(/&nbsp;/g, ' ').replace(/\|[\s|]*/g, '|');
const dates = [...t.matchAll(/\|(\d\d\/\d\d\/\d\d)(?=\|)/g)].map(m => m[1]); const last = dates.at(-1);
const areas = { US: 'U.S.', PADD1A: 'New England (PADD 1A)', PADD1B: 'Central Atlantic (PADD 1B)', PADD1C: 'Lower Atlantic (PADD 1C)', PADD2: 'Midwest (PADD 2)', PADD3: 'Gulf Coast (PADD 3)', PADD4: 'Rocky Mountain (PADD 4)', PADD5: 'West Coast (PADD 5)', PADD5X: 'West Coast less California', CA: 'California' };
const out = { source: 'U.S. Energy Information Administration, weekly retail on-highway diesel (all types), $/gal', url, week: last, fetched: new Date().toISOString(), prices: {} };
for (const [k, label] of Object.entries(areas)) { const i = t.indexOf('|' + label + '|'); if (i < 0) continue; const nums = t.slice(i + label.length + 2).split('|').slice(0, 6).map(Number); const v = nums.filter(Number.isFinite).at(-1); if (v) out.prices[k] = v; }
if (!out.prices.US) { console.error('EIA parse failed'); process.exit(1); }
writeFileSync(new URL('../data/eia-diesel.json', import.meta.url), JSON.stringify(out, null, 1)); console.log(out);

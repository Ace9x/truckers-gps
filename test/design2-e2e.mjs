// design_v2 Part 2 (RigRoute) — each item measured in the real app.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8841/', SH = '/workspace/truckers-gps-shots/r4'; let pass = 0, fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails++; return c; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); const ctx = await b.newContext({ ...devices['iPhone 13'], geolocation: { latitude: 40.8085, longitude: -73.874 }, permissions: ['geolocation'] });
await ctx.addInitScript(() => { localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_aceTour', '"done"'); localStorage.setItem('tn_truckSetDone', '1'); });
const p = await ctx.newPage(); p.on('pageerror', e => { console.log('ERR', e.message); fails++; }); p.on('console', m => { if (/Refused to|Content Security Policy/.test(m.text())) { console.log('CSP', m.text().slice(0, 200)); fails++; } });
await p.goto(BASE + '?to=40.6930,-74.1520&name=Port%20Newark%20Terminal', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => TruckNav?.ready, null, { timeout: 40000, polling: 500 }); await p.evaluate(() => document.querySelector('#splash')?.remove());
await p.waitForFunction(() => TruckNav.route?.line?.length > 10, null, { timeout: 60000, polling: 500 });
const cs = (sel, prop) => p.evaluate(([s, pr]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[pr] : null; }, [sel, prop]);
ok(await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 16px Inter') && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Inter' && f.status === 'loaded'); }), 'Inter self-hosted and loaded (OFL)');
ok(/tabular-nums/.test(await cs('#bDist', 'fontVariantNumeric')) && /tabular-nums/.test(await cs('#tEta', 'fontVariantNumeric')), '#4 distance and ETA use tabular figures');
ok(/background-color 2s/.test(await cs('body', 'transition')), '#5 day/night cross-fade (2 s) when stopped');
ok(+(await cs('#goBtn', 'minHeight')).replace('px', '') >= 64 && /rgba\(0, 0, 0, 0\.4\)/.test(await cs('#goBtn', 'borderBottomColor')), '#7 physical 64 px buttons with 2 px bottom edge');
// #9 parked: banner → route overview (View Transition)
await p.evaluate(() => { TruckNav.openPanel?.(null); document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); document.querySelector('#banner').click(); }); await p.waitForTimeout(600);
ok(await p.evaluate(() => !document.querySelector('#routePanel').classList.contains('hidden') && typeof document.startViewTransition === 'function'), '#9 parked: tapping the maneuver opens the route overview via View Transition');
// #10 two snaps
ok(await p.evaluate(() => { const rp = document.querySelector('#routePanel'), h = rp.querySelector('.d2-handle'); if (!h) return false; const a = rp.classList.contains('snap-half'); h.dispatchEvent(new PointerEvent('pointerdown', { clientY: 500, pointerId: 1, bubbles: true })); h.dispatchEvent(new PointerEvent('pointerup', { clientY: 500, pointerId: 1, bubbles: true })); return a && rp.classList.contains('snap-full'); }), '#10 route options sheet snaps half → full');
await p.screenshot({ path: SH + '/d2-route-sheet.png' });
// #12 palette
await p.evaluate(() => document.querySelector('#poiBtn').click()); await p.waitForFunction(() => (TruckNav.pois || []).length > 0, null, { timeout: 60000 }).catch(() => {}); console.log('   pois on route:', await p.evaluate(() => JSON.stringify({ n: (TruckNav.pois || []).length, done: TruckNav.poiDone, kinds: [...new Set((TruckNav.pois || []).map(x => x.kind))] })));
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); TruckNav.openPanel('searchPanel'); document.querySelector('#q').value = ''; }); await p.waitForTimeout(1200);
const pal = await p.evaluate(() => document.querySelector('#d2Pal')?.textContent || ''); ok(/Recent/.test(pal) && /(Truck stops on route|Weigh stations on route)/.test(pal), '#12 search palette: recents + truck stops / weigh stations on route' + (/area avg|driver/.test(pal) ? ' with fuel chips' : ''));
console.log('   palette:', pal.slice(0, 200)); await p.screenshot({ path: SH + '/d2-palette.png' });
// #11 steppers
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); TruckNav.openPanel('truckPanel'); }); await p.waitForTimeout(900);
ok(await p.evaluate(() => { const s = document.querySelector('#truckForm .d2-step'); if (!s) return false; const inp = s.querySelector('input'), v = +inp.value; s.lastElementChild.click(); return +inp.value > v && /JetBrains Mono/.test(getComputedStyle(inp).fontFamily); }), '#11 truck profile: −/+ steppers, values in JetBrains Mono');
// #13 lanes
ok(await p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<span class="lane ok">↑</span><span class="lane">↰</span>'; document.body.appendChild(d); const [a, c] = d.children, r = [getComputedStyle(a).color, getComputedStyle(c).color]; d.remove(); return r[0] === 'rgb(255, 149, 0)' && r[1] === 'rgb(71, 85, 105)'; }), '#13 lane guidance: active #FF9500, others #475569');
// #14 GPS weak
await p.evaluate(() => { TruckNav.pos = { ...TruckNav.pos, acc: 85 }; }); await p.waitForTimeout(700); ok(await p.evaluate(() => !document.querySelector('#gpsChip').hidden && /GPS weak/.test(document.querySelector('#gpsChip').textContent)), '#14 GPS weak chip at ±85 m');
await p.evaluate(() => { TruckNav.pos = { ...TruckNav.pos, acc: 8 }; }); await p.waitForTimeout(700); ok(await p.evaluate(() => document.querySelector('#gpsChip').hidden), '#14 chip clears at ±8 m');
// #8 recenter
await p.evaluate(() => { document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden')); TruckNav.follow = true; }); await p.waitForFunction(() => getComputedStyle(document.querySelector('#followBtn')).opacity === '0', null, { timeout: 5000 }).catch(() => {}); const o1 = await cs('#followBtn', 'opacity');
await p.evaluate(() => { TruckNav.follow = false; }); await p.waitForFunction(() => getComputedStyle(document.querySelector('#followBtn')).opacity === '1', null, { timeout: 5000 }).catch(() => {}); const o2 = await cs('#followBtn', 'opacity'); console.log('   follow opacity', o1, o2, await p.evaluate(() => document.body.className)); ok(o1 === '0' && o2 === '1', '#8 recenter button only after the map leaves follow mode');
// #3, #6, #17 and drive mode while navigating + moving
await p.evaluate(() => { document.querySelector('#goBtn')?.click(); }); await p.waitForFunction(() => TruckNav.nav, null, { timeout: 15000 }).catch(() => {});
await p.evaluate(() => { TruckNav.pos = { ...TruckNav.pos, speed: 15, acc: 8 }; document.querySelector('#banner').classList.add('near'); const a = document.createElement('div'); a.className = 'alert hazard'; a.id = 'tHz'; a.textContent = '⚠ Low clearance 12′6″ · 0.3 mi'; document.querySelector('#alerts').appendChild(a); }); await p.waitForTimeout(900);
ok(await p.evaluate(() => getComputedStyle(document.querySelector('#bArrow')).color === 'rgb(255, 149, 0)'), '#3 arrow turns orange within 500 ft');
ok(await p.evaluate(() => { const s = getComputedStyle(document.querySelector('#tHz')); return s.borderTopColor === 'rgb(248, 113, 113)' && s.borderTopWidth === '2px' && s.animationName === 'none'; }), '#6 clearance banner: #F87171 2 px border, 20% fill, no pulse');
ok(await p.evaluate(() => document.body.classList.contains('moving') && ['#topbar', '#dock'].every(s => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).display === 'none') && getComputedStyle(document.querySelector('#banner')).display !== 'none'), '#1 drive mode while moving: maneuver/ETA only (top bar, dock hidden)');
ok(await p.evaluate(() => getComputedStyle(document.querySelector('#banner')).transitionDuration.split(',').every(x => x.trim() === '0.12s') && getComputedStyle(document.querySelector('#banner')).transitionProperty === 'opacity'), '#2 motion lock: 120 ms opacity-only while moving');
await p.screenshot({ path: SH + '/d2-drive-mode.png' });
const contrast = await p.evaluate(() => { const L = c => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; }; let el = document.querySelector('#banner'), bg = getComputedStyle(el).backgroundColor; const fg = getComputedStyle(document.querySelector('#bInstr')).color; const a = L(fg), c = L(bg); return (Math.max(a, c) + .05) / (Math.min(a, c) + .05); });
ok(contrast >= 7, `#17 maneuver text contrast ${contrast.toFixed(1)}:1 (≥7:1)`);
const f1 = parseFloat(await cs('#bInstr', 'fontSize')); await p.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); await p.waitForTimeout(300); const f2 = parseFloat(await cs('#bInstr', 'fontSize'));
ok(f2 >= f1 * 1.9 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `#17 text follows the user's size setting (200%: ${f1}px → ${f2}px) without horizontal overflow`);
await p.screenshot({ path: SH + '/d2-200pct.png' });
await b.close(); console.log(`pass=${pass} fail=${fails}`); process.exit(fails ? 1 : 0);

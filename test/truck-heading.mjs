// Follow-mode heading gate. The rendered cab axis stays with the route, and the road ahead points up the screen.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8765/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, permissions: ['geolocation'], geolocation: { latitude: 40.75, longitude: -73.99 } });
await ctx.addInitScript(() => { localStorage.setItem('tn_locWhySeen', '1'); localStorage.setItem('tn_tourDone', 'true'); localStorage.setItem('tn_lang', '"en"'); localStorage.setItem('tn_truckSetDone', '1'); localStorage.setItem('rr_area_asked', '1'); localStorage.setItem('tn_greeted', 'true'); localStorage.setItem('rr_whatsnew_seen', '3.33.3'); localStorage.setItem('tn_hos', '[]'); });
const p = await ctx.newPage();
p.setDefaultTimeout(90000);
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.TruckNav?.map, null, { timeout: 30000 });
if (await p.$('#lfGo')) await p.click('#lfGo');
if (await p.$('#tSkip')) await p.click('#tSkip');
const lines = {
  straight: Array.from({ length: 7 }, (_, i) => [-73.99 + i * 0.00055, 40.752]),
  turn: [...Array.from({ length: 6 }, (_, i) => [-73.985, 40.748 + i * 0.00045]), ...Array.from({ length: 5 }, (_, i) => [-73.985 - (i + 1) * 0.00055, 40.748 + 5 * 0.00045])],
  curve: Array.from({ length: 11 }, (_, i) => { const a = (i / 10) * Math.PI / 2, R = 0.004; return [-73.978 + R * (1 - Math.cos(a)), 40.756 + R * Math.sin(a)]; }),
};
const cases = [
  { name: 'straight segment', line: lines.straight, seg: 3, gps: 250 },
  { name: '90° turn', line: lines.turn, seg: 6, gps: 0 },
  { name: 'curve', line: lines.curve, seg: 5, gps: 180 },
];
let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) failed++; };
const results = await p.evaluate(async (cases) => {
  const S = window.TruckNav;
  await S.truckModel?.ready;
  const { bearing, cumulative } = await import('./js/logic.js');
  const ang = (ax, ay, bx, by) => Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180 / Math.PI);
  const up = (x, y) => Math.atan2(x, -y) * 180 / Math.PI;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out = [];
  for (const c of cases) {
    const line = c.line, seg = c.seg, at = mid(line[seg], line[seg + 1]);
    const cum = cumulative(line);
    S.route = { line, cum, length: cum.at(-1), time: 120, maneuvers: [{ type: 8, begin_shape_index: 0, end_shape_index: line.length - 1, length: 1, instruction: 'Continue', street_names: ['Test Road'] }, { type: 4, begin_shape_index: line.length - 1, end_shape_index: line.length - 1, length: 0, instruction: 'Arrive' }] };
    S.hint = seg; S.nav = true; S.view3d = true; S.follow = true; S.camBearing = null; S.spoken = {};
    document.querySelectorAll('.panel').forEach(x => x.classList.add('hidden'));
    S.onFix({ lon: at[0], lat: at[1], speed: 0, heading: c.gps, acc: 5, t: Date.now() });
    await new Promise(r => setTimeout(r, 700));
    S.map.stop(); S.camera(true);
    const axis = S.truckModel.axis();
    const a = line[seg], b = line[seg + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const ahead = [at[0] + dx / L * 0.00028, at[1] + dy / L * 0.00028];
    const p0 = S.map.project(at), p1 = S.map.project(ahead);
    const rx = p1.x - p0.x, ry = p1.y - p0.y;
    const h = S.map.getCanvas().clientHeight, truckY = p0.y / h;
    out.push({
      name: c.name,
      model: !!S.truckModel?.ok,
      axis: !!axis && Math.hypot(axis.x, axis.y) > 4,
      align: axis ? +ang(axis.x, axis.y, rx, ry).toFixed(2) : null,
      up: +up(rx, ry).toFixed(2),
      truckY: +truckY.toFixed(3),
      rot: +S.truckMarker.getRotation().toFixed(1),
      segB: +bearing(a, b).toFixed(1),
      cam: +S.map.getBearing().toFixed(1),
      gps: c.gps,
    });
  }
  return out;
}, cases);
for (const r of results) {
  ok(r.model && r.axis, `${r.name}: truck model drew an axis`);
  ok(r.align != null && r.align <= 10, `${r.name}: cab axis within 10° of the route (${r.align}°, rot ${r.rot} vs segment ${r.segB}, stale GPS ${r.gps})`);
  ok(Math.abs(r.up) <= 15, `${r.name}: route ahead points up the screen (${r.up}°, camera ${r.cam})`);
  ok(r.truckY > 0.6 && r.truckY < 0.85, `${r.name}: truck sits in the lower third (${r.truckY})`);
}
ok(!errs.length, 'truck heading run has no page errors' + (errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close();
if (failed) process.exit(1);

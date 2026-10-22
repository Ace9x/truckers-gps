// NYC DOT designated truck routes (Through / Local / Limited Local) — data/nyc-truck-routes.json, built from NYC Open Data jjja-shxy.
// Trucks must stay on designated routes in NYC except to reach an origin/destination via the shortest route off it (NYC Traffic Rules 4-13).
export const NYC = [-74.26, 40.49, -73.69, 40.92];
export const inNYC = (lon, lat) => lon >= NYC[0] && lon <= NYC[2] && lat >= NYC[1] && lat <= NYC[3];
const CELL = 0.002; // ~170 m x 220 m
export function buildIndex(data) { const segs = [], grid = new Map();
  for (const [t, ni, dc] of data.segs) { const pts = []; let x = 0, y = 0; for (let i = 0; i < dc.length; i += 2) { x += dc[i]; y += dc[i + 1]; pts.push([x / 1e5, y / 1e5]); }
    const id = segs.length; segs.push({ t, name: data.names[ni], pts });
    for (let i = 1; i < pts.length; i++) { const [a, b] = [pts[i - 1], pts[i]];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL), y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = gx + ':' + gy; let c = grid.get(k); if (!c) grid.set(k, c = []); if (c.at(-1) !== id) c.push(id); } } }
  return { segs, grid, src: data.src }; }
function segDist(p, a, b) { const k = Math.cos(p[1] * Math.PI / 180), ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0; const x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y) * 111320; }
// nearest designated truck route within maxM (meters), or null
export function nearestRoute(ix, lon, lat, maxM = 30) { const gx = Math.floor(lon / CELL), gy = Math.floor(lat / CELL); let best = null;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const id of ix.grid.get((gx + i) + ':' + (gy + j)) || []) { const s = ix.segs[id];
    for (let q = 1; q < s.pts.length; q++) { const d = segDist([lon, lat], s.pts[q - 1], s.pts[q]); if (d <= maxM && (!best || d < best.d)) best = { d, t: s.t, name: s.name }; } }
  return best; }
// Plan-time check: stretches of a route inside NYC that leave designated truck routes, ignoring the first/last `exemptM` (origin / destination access).
export function offTruckRoute(ix, line, cum, { exemptM = 805, stepM = 40, minM = 120 } = {}) { const total = cum.at(-1) || 0, out = []; let cur = null;
  for (let s = exemptM, i = 1; s <= total - exemptM; s += stepM) { while (i < cum.length - 1 && cum[i] < s) i++; const a = line[i - 1], b = line[i], f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const off = inNYC(p[0], p[1]) && !nearestRoute(ix, p[0], p[1], 30);
    if (off) { if (!cur) cur = { from: s, to: s, at: p }; cur.to = s; } else if (cur) { if (cur.to - cur.from + stepM >= minM) out.push({ ...cur, len: cur.to - cur.from + stepM }); cur = null; } }
  if (cur && cur.to - cur.from + stepM >= minM) out.push({ ...cur, len: cur.to - cur.from + stepM }); return out; }

// Exact FMCSA property-carrying HOS planning engine (49 CFR 395.3, 395.1(e)(1), 395.1(b)(1), 395.1(g)(1)(ii)).
// PLANNING AID — NOT AN ELD, NOT A RECORD OF DUTY STATUS.
// events: [{ t: ms, s: 'off'|'sb'|'on'|'drive' }]. opts: { cycle: 70|60, adverse: bool, shortHaul: bool }.
export const H = 3600e3, M = 60e3;
const REST = s => s === 'off' || s === 'sb';
function segments(events, now) { const ev = events.filter(e => e.t <= now).sort((a, b) => a.t - b.t); const out = [];
  for (let i = 0; i < ev.length; i++) { const a = ev[i].t, b = i + 1 < ev.length ? ev[i + 1].t : now; if (b <= a) continue;
    const last = out.at(-1); if (last && last.s === ev[i].s && last.b === a) last.b = b; else out.push({ s: ev[i].s, a, b }); } return out; }
// consecutive rest runs (off and/or sleeper), with the longest continuous sleeper stretch inside
function restRuns(segs) { const runs = []; let cur = null;
  for (const g of segs) { if (REST(g.s)) { if (!cur) cur = { a: g.a, b: g.b, sbMax: 0, sbRun: 0, allSb: true }; cur.b = g.b; if (g.s === 'sb') { cur.sbRun += g.b - g.a; cur.sbMax = Math.max(cur.sbMax, cur.sbRun); } else { cur.sbRun = 0; cur.allSb = false; } }
    else if (cur) { runs.push(cur); cur = null; } }
  if (cur) runs.push(cur); return runs.map(r => ({ ...r, len: r.b - r.a })); }
export function hosEngine(events, now = Date.now(), opts = {}) {
  const cycle = opts.cycle === 60 ? 60 : 70, days = cycle === 60 ? 7 : 8, segs = segments(events, now), runs = restRuns(segs);
  // 1. last full reset: >= 10 consecutive hours off duty / sleeper (or 34h restart)
  let resetEnd = -Infinity, restartEnd = -Infinity;
  for (const r of runs) { if (r.len >= 10 * H) resetEnd = r.b; if (r.len >= 34 * H) restartEnd = r.b; }
  // a rest run still in progress that has reached 10h resets right now
  const shiftSegs = segs.filter(g => g.b > resetEnd).map(g => ({ ...g, a: Math.max(g.a, resetEnd) }));
  const firstWork = shiftSegs.find(g => !REST(g.s)); const shiftStart = firstWork ? firstWork.a : null;
  // 2. split sleeper (395.1(g)(1)(ii)): one period >= 7h in the berth + one >= 2h off/berth, together >= 10h, either order.
  //    Once paired, neither period counts against the 14h window and the 11/14 are recalculated from the end of the first period.
  let calcStart = shiftStart, excluded = 0, split = null;
  if (shiftStart != null) { const q = runs.filter(r => r.a >= shiftStart && r.len >= 2 * H && r.len < 10 * H); let prev = null;
    for (const p of q) { if (prev && prev.len + p.len >= 10 * H && ((prev.sbMax >= 7 * H && p.len >= 2 * H) || (p.sbMax >= 7 * H && prev.len >= 2 * H))) { calcStart = prev.b; excluded = p.len; split = { first: prev, second: p }; }
      prev = p; } }
  // 3. 11h driving / 14h window from the calculation point (adverse conditions: +2h to both, 395.1(b)(1))
  const add = opts.adverse ? 2 * H : 0; let drive = 0;
  for (const g of segs) if (g.s === 'drive' && calcStart != null) { const a = Math.max(g.a, calcStart); if (g.b > a) drive += g.b - a; }
  // a pending first split period (>=7h sb or >=2h) after calcStart pauses nothing until paired — conservative: counts against 14h
  const windowEnd = calcStart == null ? null : calcStart + 14 * H + excluded + add;
  const windowLeft = calcStart == null ? 14 * H + add : Math.max(0, windowEnd - now);
  // 4. 30-minute break after 8h cumulative driving without a >=30 consecutive-minute interruption (any non-driving status). Short-haul exempt.
  let sinceBreak = 0, nd = 0; for (const g of shiftSegs) { if (g.s === 'drive') { sinceBreak += g.b - g.a; nd = 0; } else { nd += g.b - g.a; if (nd >= 30 * M) sinceBreak = 0; } }
  const breakLeft = opts.shortHaul ? Infinity : Math.max(0, 8 * H - sinceBreak);
  // 5. 60/70 in 7/8 days, 34h restart
  const from = Math.max(now - days * 24 * H, restartEnd); let onDuty = 0;
  for (const g of segs) if (!REST(g.s)) { const a = Math.max(g.a, from); if (g.b > a) onDuty += g.b - a; }
  const cycleLeft = Math.max(0, cycle * H - onDuty);
  const driveLeft = Math.max(0, Math.min(11 * H + add - drive, windowLeft, cycleLeft));
  const warnings = [];
  if (driveLeft <= 0) warnings.push(cycleLeft <= 0 ? `${cycle}-hour cycle used up — 34-hour restart needed` : windowLeft <= 0 ? '14-hour duty window ended' : '11-hour driving limit reached');
  else if (driveLeft < H) warnings.push('Under 1 hour of driving left');
  if (shiftStart != null && windowLeft > 0 && windowLeft < H) warnings.push('14-hour window closes in under 1 hour');
  if (breakLeft <= 0) warnings.push('30-minute break required now'); else if (breakLeft < 0.5 * H) warnings.push('30-minute break due soon');
  if (cycleLeft > 0 && cycleLeft < 3 * H) warnings.push(`Under 3 hours left on your ${cycle}-hour cycle`);
  const status = segs.length ? segs.at(-1).s : 'off';
  return { status, driveUsed: drive, driveLeft, windowLeft, breakLeft, cycleUsed: onDuty, cycleLeft, shiftStarted: shiftStart, calcStart, split, adverse: !!opts.adverse, shortHaul: !!opts.shortHaul, warnings, label: 'Planning aid — not an ELD' }; }
// Short-haul eligibility (395.1(e)(1)): within 150 air-miles of the work reporting location and released within 14h.
export function shortHaulOk(maxAirMi, dutyHours) { return maxAirMi <= 150 && dutyHours <= 14; }
// Drive time -> required stops: returns { totalSec, breaks:[{atSec, kind:'30min'|'10h', durSec}] } given current HOS status.
export function planBreaks(driveSec, st) { let t = 0, left = driveSec, toBreak = st.breakLeft === Infinity ? Infinity : st.breakLeft / 1000, toLimit = st.driveLeft / 1000, out = [], elapsed = 0;
  while (left > 0 && out.length < 20) { const step = Math.min(left, toBreak, toLimit); elapsed += step; left -= step; toBreak -= step; toLimit -= step; if (left <= 0) break;
    if (toLimit <= 0) { out.push({ atSec: elapsed, kind: '10h', durSec: 10 * 3600 }); elapsed += 10 * 3600; toLimit = 11 * 3600; toBreak = st.breakLeft === Infinity ? Infinity : 8 * 3600; }
    else if (toBreak <= 0) { out.push({ atSec: elapsed, kind: '30min', durSec: 1800 }); elapsed += 1800; toBreak = 8 * 3600; } }
  return { totalSec: elapsed, breaks: out }; }

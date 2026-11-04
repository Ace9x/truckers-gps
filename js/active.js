// Privacy-safe active-user count: once a day, send a random device id (made on this phone, not linked to your account), today's date,
// and a coarse area (state + city). The area comes from your location rounded to ~10 km, only if you already allowed location,
// otherwise from a free IP-region lookup done in the browser. Coordinates and IP addresses are never sent to or stored by RigRoute.
import { sb } from './cloud.js';
async function area() {
  try { const st = await navigator.permissions?.query({ name: 'geolocation' }); const p = window.TruckNav?.pos;
    if (st?.state === 'granted' && p) { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${p.lat.toFixed(1)}&lon=${p.lon.toFixed(1)}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json());
      const a = r.address || {}; return { region: a.state || a.country, metro: a.city || a.town || a.county || a.village }; } } catch {}
  try { const r = await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: AbortSignal.timeout(6000) }).then(r => r.json()); return { region: r.region || r.country, metro: r.city }; } catch {}
  return {}; }
export async function ping() { try { if (navigator.webdriver && !localStorage.getItem('rr_ping_test')) return; const day = new Date().toISOString().slice(0, 10); if (localStorage.getItem('rr_ping_day') === day) return;
  let id = localStorage.getItem('rr_dev'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('rr_dev', id); }
  const c = await sb(); if (!c) return; const a = await area(); const { error } = await c.rpc('active_ping', { p_id: id, p_region: a.region || null, p_metro: a.metro || null }); if (!error) localStorage.setItem('rr_ping_day', day); } catch {} }

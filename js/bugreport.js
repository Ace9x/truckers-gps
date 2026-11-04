// Report a Bug / Suggestion. Saves to public.bug_reports (RLS: you only see your own; admins see all).
// Optional screenshot goes to the private "bug-shots" bucket (images only, max 5MB). Server-side rate limit + a client cooldown and honeypot.
import { sb, uid } from './cloud.js';
const $ = s => document.querySelector(s), MAX = 5 * 1024 * 1024, TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function checkShot(f) { if (!f) return null; if (!TYPES.includes(f.type)) return 'Screenshot must be a PNG, JPG or WebP image.'; if (f.size > MAX) return 'Screenshot must be 5MB or smaller.'; return null; }
export async function submitReport({ kind, description, page_url, contact, file, app = 'truckers-gps' }) {
  const c = await sb(); if (!c) throw new Error('Can\'t reach the server right now. Try again in a minute.');
  description = String(description || '').trim(); if (description.length < 5) throw new Error('Please describe the problem or idea (at least 5 characters).');
  const bad = checkShot(file); if (bad) throw new Error(bad);
  const last = +localStorage.getItem('tn_bugLast') || 0; if (Date.now() - last < 30e3) throw new Error('Thanks! Please wait 30 seconds before sending another.');
  const me = await uid(); let screenshot_path = null;
  if (file) { const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${me || 'anon'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await c.storage.from('bug-shots').upload(path, file, { contentType: file.type, upsert: false }); if (error) throw new Error('Screenshot upload failed: ' + error.message); screenshot_path = path; }
  const row = { kind: kind === 'suggestion' ? 'suggestion' : 'bug', app, description: description.slice(0, 4000), page_url: String(page_url || '').slice(0, 500) || null,
    contact: String(contact || '').trim().slice(0, 200) || null, screenshot_path, user_agent: navigator.userAgent.slice(0, 400), user_id: me };
  const { error } = await c.from('bug_reports').insert(row); // no .select(): guests can't read rows back
  if (error) throw new Error(/rate limited/i.test(error.message) ? 'Too many reports right now. Please try again in a few minutes.' : error.message);
  localStorage.setItem('tn_bugLast', String(Date.now())); return true; }
export async function myReports() { const c = await sb(); if (!c || !(await uid())) return [];
  const { data, error } = await c.from('bug_reports').select('id,created_at,kind,description,status').order('created_at', { ascending: false }).limit(20); if (error) throw error; return data; }
function mount() { const me = $('#mePanel'); if (!me || $('#bugBox')) return;
  me.insertAdjacentHTML('beforeend', `<details id="bugBox"><summary><b>🐞 Report a Bug / Suggestion</b> — tell us what's broken or what to add</summary>
  <form id="bugForm" novalidate>
    <label>Type<select id="bugKind"><option value="bug">Something is broken (bug)</option><option value="suggestion">Idea / suggestion</option></select></label>
    <label>What happened, or what's your idea?<textarea id="bugDesc" rows="4" maxlength="4000" required placeholder="Example: The route button did nothing after I picked a stop."></textarea></label>
    <label>Where in the app? (page or link)<input id="bugPage" maxlength="500"></label>
    <label>Screenshot (optional, PNG/JPG/WebP, up to 5MB)<input id="bugShot" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <label>Contact (optional, email or phone if you want a reply)<input id="bugContact" maxlength="200" autocomplete="email"></label>
    <input id="bugHp" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <button id="bugSend" class="big" type="submit">Send report</button><p id="bugMsg" class="small" role="status"></p>
  </form><div id="bugMine" class="small"></div></details>`);
  $('#bugPage').value = location.href;
  $('#bugShot').addEventListener('change', e => { const m = checkShot(e.target.files[0]); $('#bugMsg').textContent = m || ''; if (m) e.target.value = ''; });
  const listMine = async () => { try { const r = await myReports(); $('#bugMine').innerHTML = r.length ? '<b>Your reports</b><ul>' + r.map(x => `<li>${esc(x.kind)} · ${esc(x.status)} · ${esc(x.description.slice(0, 60))}</li>`).join('') + '</ul>' : ''; } catch { } };
  $('#bugBox').addEventListener('toggle', listMine);
  $('#bugForm').addEventListener('submit', async e => { e.preventDefault(); const msg = $('#bugMsg'), btn = $('#bugSend');
    if ($('#bugHp').value) { msg.textContent = 'Thanks! Your report was sent.'; return; } // bots fill the hidden field
    btn.disabled = true; msg.textContent = 'Sending…';
    try { await submitReport({ kind: $('#bugKind').value, description: $('#bugDesc').value, page_url: $('#bugPage').value, contact: $('#bugContact').value, file: $('#bugShot').files[0] });
      msg.textContent = 'Thanks! Your report was sent. We review every one for the next update.'; $('#bugDesc').value = ''; $('#bugShot').value = ''; listMine(); window.TruckNav && (window.TruckNav.bugSent = true); }
    catch (err) { msg.textContent = err.message; } finally { btn.disabled = false; } }); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

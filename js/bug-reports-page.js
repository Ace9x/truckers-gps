import { adminGate } from './adminlogin.js';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const c = await adminGate($('#who'));
async function load() { if (!c) return;
  const { data: admin } = await c.rpc('is_rr_admin'); $('#who').textContent = admin ? 'Signed in as admin.' : 'Not an admin account.';
  let q = c.from('bug_reports').select('*').order('created_at', { ascending: false }).limit(200); if ($('#f').value) q = q.eq('status', $('#f').value);
  const { data, error } = await q; if (error) { $('#who').textContent = error.message; return; }
  const rows = await Promise.all(data.map(async r => { let shot = ''; if (r.screenshot_path) { const { data: u } = await c.storage.from('bug-shots').createSignedUrl(r.screenshot_path, 3600); if (u) shot = `<a href="${esc(u.signedUrl)}" target="_blank" rel="noopener">view</a>`; }
    const st = admin ? `<select data-id="${r.id}">${['new', 'triaged', 'fixed', 'wontfix'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : esc(r.status);
    return `<tr><td>${new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td><td>${esc(r.kind)}</td><td>${esc(r.app)}</td><td>${esc(r.description)}</td><td class="muted">${esc(r.page_url)}</td><td>${esc(r.contact)}</td><td>${shot}</td><td>${st}</td></tr>`; }));
  $('#t').innerHTML = rows.join('') || '<tr><td colspan="8" class="muted">No reports.</td></tr>';
  document.querySelectorAll('select[data-id]').forEach(s => s.onchange = async () => { const { error } = await c.from('bug_reports').update({ status: s.value }).eq('id', s.dataset.id); if (error) alert(error.message); }); }
$('#r').onclick = load; $('#f').onchange = load; load();

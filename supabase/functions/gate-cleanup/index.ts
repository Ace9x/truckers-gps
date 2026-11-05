// Release-gate cleanup: deletes the bug reports (and uploaded screenshots) the automated gate just sent.
// Only rows whose description starts with "[automated gate test] <the gate's random token>" and are under 1 hour old,
// so this cannot touch real driver reports. Uses the Storage API (not SQL) so the stored file is really deleted.
// Returns how many rows matched, so the gate can also prove a triple tap sent exactly one report.
import { createClient } from 'npm:@supabase/supabase-js@2';
const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Content-Type': 'application/json' };
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  try { const { token } = await req.json(); if (!/^[0-9a-f-]{36}$/i.test(String(token))) return out({ error: 'bad token' }, 400);
    const c = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rows, error: e1 } = await c.from('bug_reports').select('id,screenshot_path').like('description', `[automated gate test] ${token}%`).gte('created_at', new Date(Date.now() - 3600e3).toISOString());
    if (e1) return out({ error: e1.message }, 500);
    const files = rows.map(r => r.screenshot_path).filter(Boolean);
    let left = null; if (files.length) { const { error } = await c.storage.from('bug-shots').remove(files); if (error) return out({ error: 'file: ' + error.message }, 500);
      const { data: chk } = await c.storage.from('bug-shots').list(files[0].split('/')[0], { search: files[0].split('/')[1] }); left = chk?.length ?? null; }
    if (rows.length) { const { error } = await c.from('bug_reports').delete().in('id', rows.map(r => r.id)); if (error) return out({ error: error.message }, 500); }
    return out({ rows: rows.length, files, filesLeft: left });
  } catch (e) { return out({ error: String(e) }, 500); }
});

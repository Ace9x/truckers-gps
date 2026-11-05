// Hidden admin-only sign-in (email link). Drivers never see this: RigRoute has no driver accounts.
// redirectTo is passed explicitly (project Site URL is not this site). No typed-code option (not available on the Free plan).
import { sb } from './cloud.js';
export async function adminGate(who) { const c = await sb(); if (!c) { who.textContent = 'Server unreachable.'; return null; }
  const { data } = await c.auth.getSession(); if (data.session) { const out = document.createElement('button'); out.textContent = 'Sign out'; out.style.marginLeft = '8px'; out.onclick = async () => { await c.auth.signOut(); location.reload(); }; who.after(out); return c; }
  who.innerHTML = 'Admin sign-in. Enter the admin email and tap the link we send.<br><input id="adEmail" type="email" autocomplete="email" placeholder="admin email" style="min-height:40px;font-size:16px;width:260px"> <button id="adGo" style="min-height:40px">Email me a sign-in link</button> <span id="adMsg"></span>';
  document.getElementById('adGo').onclick = async () => { const em = document.getElementById('adEmail').value.trim(), m = document.getElementById('adMsg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { m.textContent = 'Enter a valid email'; return; }
    const { error } = await c.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + location.pathname } });
    m.textContent = error ? '⚠ ' + error.message : 'Check your email and tap the link. It opens this page signed in.'; };
  return null; }

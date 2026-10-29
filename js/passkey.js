// Passkeys: sign in with Face ID / Touch ID / Windows Hello / a security key (WebAuthn).
// The fingerprint or face scan happens on your device and never leaves it; the server only keeps a public key.
const FN = 'https://czjwiudbasqwlwvezmaz.supabase.co/functions/v1/passkey', APIKEY = 'sb_publishable_I9N8lydmQ1h6NQD6JT-jDQ_PQkjsBAK';
const b2u = b => { const s = btoa(String.fromCharCode(...new Uint8Array(b))); return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const u2b = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); const r = atob(s + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(r, c => c.charCodeAt(0)).buffer; };
export const supported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;
export async function platformAvailable() { try { return supported() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; } }
export const label = () => /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'Face ID / Touch ID' : /Android/.test(navigator.userAgent) ? 'fingerprint / face unlock' : /Windows/.test(navigator.userAgent) ? 'Windows Hello' : 'passkey';
async function call(body, token) { const r = await fetch(FN, { method: 'POST', headers: { apikey: APIKEY, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'Passkey service unavailable. Use email sign-in.' })); if (!r.ok || j.error) throw new Error(j.error || 'Passkey service unavailable. Use email sign-in.'); return j; }
const nice = e => e?.name === 'NotAllowedError' ? new Error('Passkey cancelled or timed out.') : e?.name === 'InvalidStateError' ? new Error('This device already has a passkey for your account.') : e;
function credJSON(c) { const r = c.response, o = { id: c.id, rawId: b2u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults?.() || {}, authenticatorAttachment: c.authenticatorAttachment || undefined, response: { clientDataJSON: b2u(r.clientDataJSON) } };
  if (r.attestationObject) { o.response.attestationObject = b2u(r.attestationObject); o.response.transports = r.getTransports?.() || []; }
  else { o.response.authenticatorData = b2u(r.authenticatorData); o.response.signature = b2u(r.signature); if (r.userHandle) o.response.userHandle = b2u(r.userHandle); } return o; }
/** Add a passkey to the signed-in account. sb = supabase client. */
export async function register(sb, { app = '', name } = {}) {
  if (!supported()) throw new Error('This browser does not support passkeys.');
  const { data } = await sb.auth.getSession(); const tok = data.session?.access_token; if (!tok) throw new Error('Sign in first to add a passkey.');
  const { options: o, challengeId } = await call({ action: 'register-options' }, tok);
  const pk = { ...o, challenge: u2b(o.challenge), user: { ...o.user, id: u2b(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: u2b(c.id) })) };
  let c; try { c = await navigator.credentials.create({ publicKey: pk }); } catch (e) { throw nice(e); }
  return call({ action: 'register-verify', challengeId, response: credJSON(c), app, name: name || `${label()} · ${app || 'app'} · ${new Date().toLocaleDateString()}` }, tok);
}
/** Sign in with a passkey; sets the Supabase session. */
export async function signIn(sb) {
  if (!supported()) throw new Error('This browser does not support passkeys.');
  const { options: o, challengeId } = await call({ action: 'auth-options' });
  const pk = { ...o, challenge: u2b(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: u2b(c.id) })) };
  let c; try { c = await navigator.credentials.get({ publicKey: pk, mediation: 'optional' }); } catch (e) { throw nice(e); }
  const s = await call({ action: 'auth-verify', challengeId, response: credJSON(c) });
  const { data, error } = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }); if (error) throw error; return data.session;
}
export async function list(sb) { const { data, error } = await sb.from('webauthn_credentials').select('id,name,app,created_at,last_used_at').order('created_at', { ascending: false }); if (error) throw error; return data || []; }
export async function remove(sb, id) { const { error } = await sb.from('webauthn_credentials').delete().eq('id', id); if (error) throw error; }

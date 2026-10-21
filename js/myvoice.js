// "My voice": clone the driver's own voice with ElevenLabs Instant Voice Cloning, cache clips in IndexedDB,
// fall back to Web Speech when offline / on error. The API key is entered by the driver and stays on this device.
export const API = 'https://api.elevenlabs.io/v1';
export const MODEL = 'eleven_flash_v2_5'; // lowest-latency ElevenLabs model (~75 ms)
export const SCRIPT = `Hey, this is my voice for RigRoute. In one mile, take the exit on the right toward Interstate 95 South. Weigh station ahead, two miles. Low bridge ahead, thirteen feet six, stay in the left lane. You have arrived. Keep the shiny side up, and I'll see you on the next load. Recalculating, hang tight. Thirty minute break due in fifteen minutes. Diesel at the next truck stop, five miles ahead.`;
export const COMMON = ['Recalculating, hang tight.', 'You have arrived.', 'Weigh station ahead.', 'Low bridge ahead.', 'Voice guidance on',
  'In a quarter mile, turn right.', 'In a quarter mile, turn left.', 'Turn right.', 'Turn left.', 'Keep right.', 'Keep left.', 'Take the exit on the right.', 'Continue straight.'];
export const cacheKey = (voiceId, text) => voiceId + '|' + text.trim().toLowerCase();

const DB = 'rr-myvoice', ST = 'clips';
function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export const clipStore = {
  async get(k) { const d = await idb(); return new Promise(r => { const q = d.transaction(ST).objectStore(ST).get(k); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); },
  async put(k, v) { const d = await idb(); return new Promise(r => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(v, k); t.oncomplete = () => r(true); t.onerror = () => r(false); }); },
  async clear() { const d = await idb(); return new Promise(r => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).clear(); t.oncomplete = () => r(true); }); },
  async count() { const d = await idb(); return new Promise(r => { const q = d.transaction(ST).objectStore(ST).count(); q.onsuccess = () => r(q.result); }); },
};

export class MyVoice {
  constructor({ store = clipStore, fetchFn = (...a) => fetch(...a), storage = globalThis.localStorage } = {}) {
    this.store = store; this.fetch = fetchFn; this.ls = storage; this.mem = new Map();
    const c = JSON.parse(this.ls?.getItem('myVoice') || '{}'); this.key = c.key || ''; this.voiceId = c.voiceId || ''; this.on = !!c.on; this.consent = !!c.consent;
  }
  save() { this.ls?.setItem('myVoice', JSON.stringify({ key: this.key, voiceId: this.voiceId, on: this.on, consent: this.consent })); }
  get ready() { return !!(this.on && this.key && this.voiceId); }
  async clone(blob, name = 'RigRoute driver') {
    if (!this.consent) throw new Error('Consent required: only clone your own voice.');
    if (!this.key) throw new Error('Enter your ElevenLabs API key first.');
    const fd = new FormData(); fd.append('name', name); fd.append('description', 'Cloned in RigRoute GPS with owner consent'); fd.append('remove_background_noise', 'true');
    fd.append('files', blob, 'sample.' + (/mp4/.test(blob.type) ? 'm4a' : 'webm'));
    const r = await this.fetch(API + '/voices/add', { method: 'POST', headers: { 'xi-api-key': this.key }, body: fd });
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json(); this.voiceId = j.voice_id; this.on = true; this.save(); return this.voiceId;
  }
  async tts(text) {
    const k = cacheKey(this.voiceId, text);
    const hit = this.mem.get(k) || await this.store.get(k).catch(() => null); if (hit) { this.mem.set(k, hit); return { blob: hit, cached: true }; }
    if (globalThis.navigator && navigator.onLine === false) throw new Error('offline');
    const r = await this.fetch(`${API}/text-to-speech/${this.voiceId}?output_format=mp3_44100_64`, { method: 'POST',
      headers: { 'xi-api-key': this.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.8 } }) });
    if (!r.ok) throw new Error(await errText(r));
    const blob = await r.blob(); this.mem.set(k, blob); await this.store.put(k, blob).catch(() => {}); return { blob, cached: false };
  }
  async pregenerate(lines = COMMON, onProgress) { let n = 0; for (const t of lines) { try { await this.tts(t); } catch (e) { if (/401|quota|offline/i.test(e.message)) throw e; } n++; onProgress?.(n, lines.length); } return n; }
  async play(text) { const { blob, cached } = await this.tts(text); this.audio?.pause(); const a = new Audio(URL.createObjectURL(blob)); this.audio = a; await a.play(); return cached; }
  async remove() { if (this.key && this.voiceId) await this.fetch(`${API}/voices/${this.voiceId}`, { method: 'DELETE', headers: { 'xi-api-key': this.key } }).catch(() => {});
    await this.store.clear().catch(() => {}); this.mem.clear(); this.voiceId = ''; this.on = false; this.save(); }
}
async function errText(r) { let m = ''; try { const j = await r.json(); m = j.detail?.message || j.detail?.status || JSON.stringify(j.detail || j); } catch { } return `ElevenLabs ${r.status}${m ? ': ' + m : ''}`; }

// Pick the best MediaRecorder format this browser supports (Safari = mp4, Chrome = webm/opus).
export const recMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => globalThis.MediaRecorder?.isTypeSupported?.(t)) || '';

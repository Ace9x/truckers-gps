// E2E for Settings > My voice. ElevenLabs is mocked at the network layer; mic is Chromium's fake device.
import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8765/', SHOTS = (process.env.SHOTS || '/workspace/truckers-gps-shots') + '/voice';
mkdirSync(SHOTS, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['microphone', 'geolocation'], geolocation: { latitude: 40.81, longitude: -73.88 } });
const page = await ctx.newPage(); page.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
const hits = { add: 0, tts: 0, keys: new Set() }; let online = true;
const mp3 = readFileSync(new URL('./silence.mp3', import.meta.url));
await ctx.route('https://api.elevenlabs.io/**', async r => {
  if (!online) return r.abort();
  hits.keys.add(r.request().headers()['xi-api-key']);
  if (r.request().url().endsWith('/voices/add')) { hits.add++; return r.fulfill({ json: { voice_id: 'mockVoice42' } }); }
  if (/text-to-speech/.test(r.request().url())) { hits.tts++; return r.fulfill({ body: mp3, contentType: 'audio/mpeg' }); }
  return r.fulfill({ json: {} });
});
const shot = n => page.screenshot({ path: `${SHOTS}/${n}.png` });
await page.goto(BASE); await page.waitForFunction(() => window.TruckNav?.ready);
await page.click('#meBtn'); await page.click('#myVoiceBox summary'); await page.locator('#myVoiceBox').scrollIntoViewIfNeeded();
ok(await page.isVisible('#mvScript') && (await page.textContent('#mvScript')).length > 200, 'script to read is shown'); await shot('01-my-voice');
ok(await page.isDisabled('#mvCreate'), 'Create disabled before consent/key/recording');
await page.fill('#mvKey', 'TEST-KEY'); await page.dispatchEvent('#mvKey', 'change'); await page.check('#mvConsent');
await page.click('#mvRec'); await page.waitForTimeout(3200); await shot('02-recording'); await page.click('#mvRec');
await page.waitForFunction(() => !document.querySelector('#mvPlayback').classList.contains('hidden'));
ok(/Recorded \ds/.test(await page.textContent('#mvStatus')), 'recorded sample, short-sample hint: ' + await page.textContent('#mvStatus'));
ok(!(await page.isDisabled('#mvCreate')), 'Create enabled after consent + key + sample'); await shot('03-recorded');
await page.click('#mvCreate'); await page.waitForFunction(() => /ready/.test(document.querySelector('#mvStatus').textContent), null, { timeout: 20000 });
const st = await page.evaluate(() => ({ id: TruckNav.myVoice.voiceId, ls: JSON.parse(localStorage.myVoice), on: document.querySelector('#mvOn').checked }));
ok(hits.add === 1 && st.id === 'mockVoice42' && st.ls.voiceId === 'mockVoice42' && st.on, 'voice profile created, voice_id saved on device, enabled');
ok(hits.tts >= 13 && [...hits.keys].every(k => k === 'TEST-KEY'), `common phrases pre-generated (${hits.tts} TTS calls), key sent only in header to ElevenLabs`); await shot('04-ready');
const before = hits.tts; await page.evaluate(() => TruckNav.voiceObj.say('Recalculating, hang tight.', 'info', true)); await page.waitForTimeout(800);
ok(hits.tts === before && await page.evaluate(() => TruckNav.voiceObj.lastSource) === 'myvoice-cache', 'nav line played from IndexedDB cache, no network');
online = false; await page.evaluate(() => TruckNav.voiceObj.say('Brand new sentence never cached.', 'info', true)); await page.waitForTimeout(800);
ok(await page.evaluate(() => TruckNav.voiceObj.lastSource) === 'webspeech-fallback', 'uncached line offline -> Web Speech fallback');
await page.reload(); await page.waitForFunction(() => window.TruckNav?.ready);
ok(await page.evaluate(() => TruckNav.myVoice.ready), 'voice profile survives reload');
await page.click('#meBtn'); await page.click('#myVoiceBox summary'); online = true; await page.click('#mvPreview'); await page.waitForTimeout(800); await shot('05-preview');
ok(/Played/.test(await page.textContent('#mvStatus')), 'preview plays: ' + await page.textContent('#mvStatus'));
await browser.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);

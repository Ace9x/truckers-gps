// Voice options: any Web Speech voice + rate/pitch, plus personalities that re-phrase prompts.
import { speakable } from './logic.js';

export const PERSONALITIES = {
  standard: { name: 'Standard', rate: 1, pitch: 1, wrap: t => t },
  copilot: { name: 'Calm co-pilot', rate: 0.92, pitch: 0.95,
    wrap: (t, k) => k === 'arrive' ? 'Nice and easy. You have arrived. Good job today.' : k === 'reroute' ? "No problem, I've got a new route for you." : k === 'turn' ? `When you're ready, ${lc(t)}` : t },
  oldschool: { name: 'Old-school trucker', rate: 1.02, pitch: 0.85,
    wrap: (t, k) => k === 'arrive' ? "That's a big ten-four, driver. You're at the dock. Keep the shiny side up." : k === 'reroute' ? 'Missed your hole, good buddy. Recalculating, hang tight.' : k === 'weigh' ? `Heads up driver, chicken coop ahead. ${t}` : k === 'turn' ? `${t} Ten-four?` : t },
  nyc: { name: 'NYC dispatcher', rate: 1.15, pitch: 1.05,
    wrap: (t, k) => k === 'arrive' ? "You're there. Back it in, call me when you're empty." : k === 'reroute' ? "Whaddya doin'? Fine, fine, I'm rerouting you." : k === 'hos' ? `Listen to me, ${lc(t)}. Don't make me write you up.` : k === 'turn' ? `Ay, ${lc(t)}` : t },
};
const lc = t => t ? t[0].toLowerCase() + t.slice(1) : t;

export class Voice {
  constructor(settings = {}) { this.s = { voiceURI: '', rate: 1, pitch: 1, personality: 'standard', ...settings }; this.voices = []; this.log = []; this.enabled = true;
    if ('speechSynthesis' in globalThis) { this.refresh(); speechSynthesis.onvoiceschanged = () => this.refresh(); } }
  // voices for the chosen app language; none installed -> English voice + English text (I18N.speakEnglish) and a one-time notice
  refresh() { const all = speechSynthesis.getVoices(), L = (globalThis.RRI18N?.speechLang?.() || 'en').toLowerCase().split('-')[0];
    const mine = all.filter(v => v.lang.toLowerCase().replace('_', '-').split('-')[0] === L); this.noLangVoice = L !== 'en' && all.length > 0 && !mine.length;
    this.voices = mine.length ? mine : all.filter(v => /^en/i.test(v.lang)); if (!this.voices.length) this.voices = all; if (globalThis.RRI18N) globalThis.RRI18N.speakEnglish = !!this.noLangVoice; this.onchange?.(); }
  pick() { const v = this.voices; return v.find(x => x.voiceURI === this.s.voiceURI) || v.find(x => /en-US/i.test(x.lang) && /natural|google|samantha|aria/i.test(x.name)) || v.find(x => /natural|google|premium|enhanced/i.test(x.name)) || v[0] || null; }
  phrase(text, kind = 'info') { const p = PERSONALITIES[this.s.personality] || PERSONALITIES.standard; return speakable(p.wrap(text, kind)); }
  say(text, kind, force) {
    const I = globalThis.RRI18N; if (I && !I.speakEnglish) text = I.tq(text); // spoken in the app language (Valhalla turn text already is)
    const t = this.phrase(text, kind); this.log.push(t); this.last = t;
    if (!(this.enabled || force) || !('speechSynthesis' in globalThis)) return t;
    if (this.custom?.ready && !this.noCustom) { this.custom.play(t).then(c => { this.lastSource = c ? 'myvoice-cache' : 'myvoice'; }).catch(() => { this.lastSource = 'webspeech-fallback'; this.speakWeb(t); }); return t; }
    this.speakWeb(t); return t;
  }
  speakWeb(t) {
    if (!('speechSynthesis' in globalThis)) return;
    const p = PERSONALITIES[this.s.personality] || PERSONALITIES.standard;
    const u = new SpeechSynthesisUtterance(t); const v = this.pick(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = globalThis.RRI18N?.speakEnglish === false ? globalThis.RRI18N.speechLang() : 'en-US';
    u.rate = this.s.rate * p.rate; u.pitch = this.s.pitch * p.pitch;
    speechSynthesis.cancel(); speechSynthesis.speak(u); if (!this.lastSource?.startsWith('webspeech-fallback')) this.lastSource = 'webspeech';
  }
}

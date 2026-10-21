// "Coney" — original cartoon traffic-cone co-pilot (our own SVG art). Tips, cheers, reactions. Never covers the map near a turn.
const SVG = `<svg viewBox="0 0 80 96" width="64" height="77" aria-hidden="true">
 <ellipse cx="40" cy="90" rx="30" ry="5" fill="#0005"/>
 <g class="coneBody"><rect x="10" y="78" width="60" height="9" rx="3" fill="#e65100" stroke="#111" stroke-width="2.5"/>
 <path d="M40 6 L64 79 H16 Z" fill="#ff7a1a" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/>
 <path d="M30 37 H50 L54 50 H26 Z" fill="#fff"/><path d="M22 62 H58 L61 71 H19 Z" fill="#fff"/>
 <g class="eyes"><ellipse cx="33" cy="30" rx="4" ry="5" fill="#fff" stroke="#111" stroke-width="1.5"/><ellipse cx="47" cy="30" rx="4" ry="5" fill="#fff" stroke="#111" stroke-width="1.5"/>
 <circle class="pupil" cx="34" cy="31" r="2" fill="#111"/><circle class="pupil" cx="48" cy="31" r="2" fill="#111"/></g>
 <path class="mouth" d="M34 42 Q40 48 46 42" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"/>
 <path class="armL" d="M24 56 Q12 52 8 44" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/><path class="armR" d="M56 56 Q68 52 72 44" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>
 <rect x="27" y="2" width="26" height="6" rx="3" fill="#ffca28" stroke="#111" stroke-width="2" class="cap"/></g></svg>`;
const MOUTH = { happy: 'M34 42 Q40 48 46 42', party: 'M33 41 Q40 51 47 41 Z', worried: 'M34 46 Q40 41 46 46', calm: 'M35 44 H45', wow: 'M37 44 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0' };
export const TIPS = [
  'Tip: set your truck height & weight under 🚛 Truck so I can keep you off low bridges.',
  'Tip: long-press the map to drop a destination pin.',
  'Tip: hit ⚠ to report a low bridge or "no trucks" road. I\'ll steer around it right away.',
  'Tip: in the last mile, tap Facility to pin the truck gate on satellite.',
  'Tip: ⛽ shows truck stops ahead on your route, with the detour time.',
  'Tip: try Demo drive to see a route play out while you\'re parked.',
  'Tip: pick a voice personality under 😎 Me. The NYC dispatcher has opinions.',
];
export class Mascot {
  constructor({ enabled = true, isBusy = () => false } = {}) {
    this.enabled = enabled; this.isBusy = isBusy; this.queue = []; this.log = [];
    const el = document.createElement('div'); el.id = 'mascot'; el.className = 'hidden'; el.innerHTML = `<div class="mBubble"><span class="mText"></span><button class="mX" aria-label="Hide co-pilot">✕</button></div><div class="mFig">${SVG}</div>`;
    document.body.appendChild(el); this.el = el; el.querySelector('.mX').onclick = e => { e.stopPropagation(); this.hide(); };
    el.querySelector('.mFig').onclick = () => this.say(TIPS[Math.floor(Math.random() * TIPS.length)], 'happy');
  }
  say(text, mood = 'happy', ms = 6000) {
    this.log.push({ text, mood }); if (!this.enabled) return;
    if (this.isBusy()) { this.queue = [{ text, mood, ms }]; clearTimeout(this._q); this._q = setTimeout(() => this.flush(), 4000); return; } // wait until no turn is close
    const el = this.el; el.querySelector('.mText').textContent = text; el.querySelector('.mouth').setAttribute('d', MOUTH[mood] || MOUTH.happy);
    el.className = 'show ' + mood; this.visible = true; clearTimeout(this._t); this._t = setTimeout(() => this.hide(), ms);
  }
  flush() { const q = this.queue.shift(); if (q) this.say(q.text, q.mood, q.ms); }
  hide() { this.el.className = 'hidden'; this.visible = false; }
  watchBusy() { if (this.visible && this.isBusy()) this.hide(); }
}

// One pre-drawn truck sprite, rotated by the map marker. No per-frame WebGL and no extra model download.
// Rear view stands upright in the tilted camera. Top view lies on the map in the flat north-up view.

export const DRIVE_PITCH = 58;

// Focal point sits in the lower third: MapLibre places the center in the padded viewport.
export function driveFrame(height) {
  const h = Math.max(320, height || 800);
  const top = Math.round(h * 0.42), bottom = 56;
  const truckY = (h + top - bottom) / 2;
  return { pitch: DRIVE_PITCH, top, bottom, truckY, ratio: truckY / h };
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shadow(g, x, y, rx, ry) {
  g.save();
  g.fillStyle = 'rgba(0,0,0,.38)';
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function wheel(g, x, y, rx, ry) {
  g.fillStyle = '#14181d';
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8d98a3';
  g.beginPath(); g.ellipse(x, y, rx * 0.38, ry * 0.38, 0, 0, Math.PI * 2); g.fill();
}

// Elevated view from behind: trailer nearest, cab ahead. The nose points up so heading rotation stays honest.
function drawRear(g, color, long) {
  shadow(g, 46, 118, 28, 8);
  const back = long ? 96 : 78;
  g.fillStyle = '#8e99a4';
  g.beginPath(); g.moveTo(62, 46); g.lineTo(74, 38); g.lineTo(74, back - 8); g.lineTo(62, back); g.closePath(); g.fill();
  g.fillStyle = '#f2f5f8';
  g.beginPath(); g.moveTo(20, 46); g.lineTo(62, 46); g.lineTo(74, 38); g.lineTo(32, 38); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.stroke();
  const body = g.createLinearGradient(20, 46, 20, back);
  body.addColorStop(0, '#f7f9fb'); body.addColorStop(1, '#b7c2cc');
  g.fillStyle = body; rr(g, 18, 46, 44, back - 46, 4); g.fill();
  g.strokeStyle = '#1c2430'; g.lineWidth = 1.6; g.stroke();
  g.beginPath(); g.moveTo(40, 52); g.lineTo(40, back - 8); g.strokeStyle = '#8ea0ae'; g.stroke();
  g.strokeStyle = '#9aabba'; g.strokeRect(23, 56, 13, long ? 26 : 14); g.strokeRect(44, 56, 13, long ? 26 : 14);
  g.fillStyle = '#e53935'; rr(g, 20, back - 10, 8, 5, 1); g.fill(); rr(g, 52, back - 10, 8, 5, 1); g.fill();
  g.fillStyle = '#5d6872';
  g.beginPath(); g.moveTo(56, 22); g.lineTo(66, 16); g.lineTo(66, 42); g.lineTo(56, 48); g.closePath(); g.fill();
  g.fillStyle = color; rr(g, 24, 16, 32, 30, 5); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 1.4; g.stroke();
  g.fillStyle = '#b9e4ff'; rr(g, 28, 12, 24, 10, 3); g.fill();
  g.fillStyle = '#fff4'; rr(g, 30, 14, 8, 4, 1); g.fill();
  wheel(g, 14, long ? 70 : 60, 5, 8); wheel(g, 14, back - 10, 5, 8);
  wheel(g, 72, long ? 62 : 54, 4.5, 7); wheel(g, 72, back - 16, 4.5, 7);
  g.fillStyle = '#ffe082'; g.fillRect(22, 40, 4, 3); g.fillRect(54, 40, 4, 3);
}

function drawTop(g, color, long) {
  shadow(g, 42, 78, 22, 34);
  const bed = long ? 86 : 64;
  g.fillStyle = '#d5dde4'; rr(g, 22, 28, 36, bed - 28, 3); g.fill();
  g.strokeStyle = '#1c2430'; g.lineWidth = 1.5; g.stroke();
  g.strokeStyle = '#aeb8c2'; g.beginPath(); g.moveTo(26, 36); g.lineTo(54, 36); g.moveTo(26, bed - 10); g.lineTo(54, bed - 10); g.stroke();
  g.fillStyle = color; rr(g, 20, 8, 40, 24, 6); g.fill(); g.strokeStyle = '#111'; g.stroke();
  g.fillStyle = '#10202c'; rr(g, 26, 12, 28, 10, 3); g.fill();
  g.fillStyle = '#ffe082'; g.beginPath(); g.arc(24, 12, 2.2, 0, 7); g.arc(56, 12, 2.2, 0, 7); g.fill();
  wheel(g, 16, 34, 4, 7); wheel(g, 64, 34, 4, 7);
  wheel(g, 16, bed - 16, 4, 7); wheel(g, 64, bed - 16, 4, 7);
  if (long) { wheel(g, 16, bed - 32, 4, 7); wheel(g, 64, bed - 32, 4, 7); }
}

const LONG = new Set(['pro', 'semi', 'flatbed', 'tanker', 'reefer']);

export function paintTruck(canvas, { color = '#fb8c00', view = 'rear', kind = 'semi', dpr = 2 } = {}) {
  const long = LONG.has(kind);
  const w = 88, h = view === 'rear' ? 128 : 112;
  const ratio = Math.min(2, dpr || 1);
  canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const g = canvas.getContext('2d');
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, w, h);
  if (view === 'rear') drawRear(g, color, long); else drawTop(g, color, long);
  return canvas;
}

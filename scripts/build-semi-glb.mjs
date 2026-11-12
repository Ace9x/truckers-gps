// Original low-poly semi for RigRoute. Geometry is generated here and dedicated to the public domain (CC0).
// Y-up, nose points +Z. Wheels rest on y = 0. Units are meters. 53 ft trailer.
import fs from 'node:fs';
const faces = []; // { color:[r,g,b], metal, rough, verts: Float32Array interleaved pos+normal, idx: Uint16Array }
function addMesh(color, metal, rough, positions, normals, indices) {
  const n = positions.length / 3, buf = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { buf.set(positions.subarray(i * 3, i * 3 + 3), i * 6); buf.set(normals.subarray(i * 3, i * 3 + 3), i * 6 + 3); }
  faces.push({ color, metal, rough, buf, indices });
}
function box(cx, cy, cz, sx, sy, sz, color, metal = 0.05, rough = 0.55) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const p = [], nrm = [], ix = [];
  const sides = [
    [[1, 0, 0], [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]]],
    [[-1, 0, 0], [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]]],
    [[0, 1, 0], [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]]],
    [[0, -1, 0], [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
    [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
  ];
  for (const [nm, corners] of sides) {
    const b = p.length / 3;
    for (const c of corners) { p.push(cx + c[0], cy + c[1], cz + c[2]); nrm.push(...nm); }
    ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  addMesh(color, metal, rough, Float32Array.from(p), Float32Array.from(nrm), Uint16Array.from(ix));
}
function cyl(cx, cy, cz, r, len, axis, color, metal = 0.02, rough = 0.7, sides = 10) {
  const p = [], nrm = [], ix = [];
  const ring = (end) => { const b = p.length / 3; for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2, nx = Math.cos(a), ny = Math.sin(a); const o = [nx * r, ny * r, 0]; const c = [cx, cy, cz]; c[axis] += end; c[(axis + 1) % 3] += o[0]; c[(axis + 2) % 3] += o[1]; const nn = [0, 0, 0]; nn[(axis + 1) % 3] = nx; nn[(axis + 2) % 3] = ny; p.push(...c); nrm.push(...nn); } return b; };
  const a0 = ring(-len / 2), a1 = ring(len / 2);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; ix.push(a0 + i, a1 + i, a1 + j, a0 + i, a1 + j, a0 + j); }
  addMesh(color, metal, rough, Float32Array.from(p), Float32Array.from(nrm), Uint16Array.from(ix));
}
const ORANGE = [1, 0.48, 0.06], WHITE = [0.96, 0.97, 0.98], BLACK = [0.08, 0.09, 0.1], GLASS = [0.15, 0.45, 0.72], CHROME = [0.82, 0.84, 0.86], RUBBER = [0.02, 0.02, 0.025], AMBER = [1, 0.72, 0.1];
// Chassis
box(0, 0.55, -6.2, 1.15, 0.28, 16.4, BLACK, 0.2, 0.45);
// 53 ft trailer body. Rear at -z.
box(0, 2.55, -9.6, 2.55, 3.55, 16.15, WHITE, 0.08, 0.42);
// Rear door seam
box(0, 2.5, -17.64, 2.4, 3.2, 0.06, [0.78, 0.8, 0.82], 0.1, 0.4);
// Cab
box(0, 1.85, 0.55, 2.45, 2.55, 2.35, ORANGE, 0.12, 0.38);
// Hood
box(0, 1.15, 1.85, 2.2, 1.05, 0.85, ORANGE, 0.12, 0.38);
// Sleeper / roof fairing
box(0, 3.35, -0.15, 2.35, 0.55, 1.5, ORANGE, 0.1, 0.4);
// Windshield
box(0, 2.35, 1.62, 2.15, 0.95, 0.08, GLASS, 0.0, 0.15);
// Grille
box(0, 1.15, 2.26, 1.5, 0.7, 0.06, CHROME, 0.6, 0.25);
// Bumper
box(0, 0.55, 2.15, 2.35, 0.28, 0.18, CHROME, 0.5, 0.3);
// Mirrors
box(-1.4, 2.15, 1.15, 0.12, 0.42, 0.22, BLACK, 0.1, 0.4);
box(1.4, 2.15, 1.15, 0.12, 0.42, 0.22, BLACK, 0.1, 0.4);
// Marker lights
box(-0.9, 0.55, 2.28, 0.16, 0.1, 0.06, AMBER, 0, 0.3);
box(0.9, 0.55, 2.28, 0.16, 0.1, 0.06, AMBER, 0, 0.3);
box(-1.05, 1.15, -17.7, 0.14, 0.18, 0.05, [0.8, 0.05, 0.05], 0, 0.3);
box(1.05, 1.15, -17.7, 0.14, 0.18, 0.05, [0.8, 0.05, 0.05], 0, 0.3);
// Wheels: steer, drive, trailer
const wheels = [[1.15, 1.35], [1.15, -0.15], [-1.15, -0.15], [-7.2, -7.2], [-8.5, -8.5], [-14.6, -14.6], [-15.9, -15.9]];
for (const [z, z2] of [[1.35, null], [-0.2, null], [-7.4, -8.6], [-14.8, -16.0]]) {
  for (const side of [-1, 1]) {
    cyl(side * 1.22, 0.52, z, 0.52, 0.38, 0, RUBBER);
    cyl(side * 1.22, 0.52, z, 0.28, 0.4, 0, CHROME, 0.7, 0.25);
    if (z2 != null) { cyl(side * 1.22, 0.52, z2, 0.52, 0.38, 0, RUBBER); cyl(side * 1.22, 0.52, z2, 0.28, 0.4, 0, CHROME, 0.7, 0.25); }
  }
}
// Pack glTF
const bins = []; let byteLen = 0; const views = [], accessors = [], primitives = [], materials = [];
function align(n) { const p = (4 - (byteLen % 4)) % 4; if (p) { bins.push(Buffer.alloc(p)); byteLen += p; } return n; }
for (const f of faces) {
  align(); const posOff = byteLen; const posBytes = Buffer.from(f.buf.buffer, f.buf.byteOffset, f.buf.byteLength); bins.push(posBytes); byteLen += posBytes.length;
  const posView = views.length; views.push({ buffer: 0, byteOffset: posOff, byteLength: posBytes.length, byteStride: 24, target: 34962 });
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < f.buf.length; i += 6) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], f.buf[i + k]); max[k] = Math.max(max[k], f.buf[i + k]); }
  const posAcc = accessors.length; accessors.push({ bufferView: posView, byteOffset: 0, componentType: 5126, count: f.buf.length / 6, type: 'VEC3', min, max });
  const nrmAcc = accessors.length; accessors.push({ bufferView: posView, byteOffset: 12, componentType: 5126, count: f.buf.length / 6, type: 'VEC3' });
  align(); const iOff = byteLen; const iBytes = Buffer.from(f.indices.buffer, f.indices.byteOffset, f.indices.byteLength); bins.push(iBytes); byteLen += iBytes.length;
  const iView = views.length; views.push({ buffer: 0, byteOffset: iOff, byteLength: iBytes.length, target: 34963 });
  const iAcc = accessors.length; accessors.push({ bufferView: iView, byteOffset: 0, componentType: 5123, count: f.indices.length, type: 'SCALAR' });
  const mat = materials.length; materials.push({ name: 'm' + mat, pbrMetallicRoughness: { baseColorFactor: [...f.color, 1], metallicFactor: f.metal, roughnessFactor: f.rough }, doubleSided: false });
  primitives.push({ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: iAcc, material: mat });
}
align();
const bin = Buffer.concat(bins);
const json = Buffer.from(JSON.stringify({
  asset: { version: '2.0', generator: 'RigRoute CC0', copyright: 'CC0-1.0 RigRoute original geometry' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'semi' }],
  meshes: [{ primitives }], materials, buffers: [{ byteLength: bin.length }], bufferViews: views, accessors,
}));
const jPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);
const total = 12 + 8 + json.length + jPad.length + 8 + bin.length + binPad.length;
const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
const jc = Buffer.alloc(8); jc.writeUInt32LE(json.length + jPad.length, 0); jc.writeUInt32LE(0x4E4F534A, 4);
const bc = Buffer.alloc(8); bc.writeUInt32LE(bin.length + binPad.length, 0); bc.writeUInt32LE(0x004E4942, 4);
const out = Buffer.concat([header, jc, json, jPad, bc, bin, binPad]);
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/semi.glb', out);
fs.writeFileSync('data/semi-license.txt', `semi.glb
RigRoute original low-poly semi (cab and 53 ft trailer).
Generated by scripts/build-semi-glb.mjs. No third-party mesh.
Dedicated to the public domain under CC0 1.0.
https://creativecommons.org/publicdomain/zero/1.0/
`);
console.log('semi.glb', out.length, 'bytes', primitives.length, 'parts');

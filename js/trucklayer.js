// Lit semi on the road. three.js and the model load only after the map is up.
// The glTF is original geometry (CC0), see data/semi-license.txt. A flat chevron shows if this cannot start.
const THREE_URL = 'https://esm.sh/three@0.160.1';
const MODEL = new URL('../data/semi.glb', import.meta.url).href;

function meshesFromGlb(buf, THREE) {
  const view = new DataView(buf);
  if (view.getUint32(0, false) !== 0x676c5446) throw new Error('not a glb');
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binOff = 20 + jsonLen;
  const binLen = view.getUint32(binOff, true);
  const bin = new Uint8Array(buf, binOff + 8, binLen);
  const out = [];
  const deinterleave = acc => {
    const bv = json.bufferViews[acc.bufferView];
    const comps = acc.type === 'VEC3' ? 3 : 1;
    const stride = bv.byteStride || comps * 4;
    const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const src = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const arr = new Float32Array(acc.count * comps);
    for (let i = 0; i < acc.count; i++) for (let k = 0; k < comps; k++) arr[i * comps + k] = src.getFloat32(start + i * stride + k * 4, true);
    return arr;
  };
  const indicesOf = acc => {
    const bv = json.bufferViews[acc.bufferView];
    const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const Ctor = acc.componentType === 5125 ? Uint32Array : Uint16Array;
    return new Ctor(bin.buffer, bin.byteOffset + off, acc.count);
  };
  for (const prim of json.meshes[0].primitives) {
    const pos = deinterleave(json.accessors[prim.attributes.POSITION]);
    const nrm = deinterleave(json.accessors[prim.attributes.NORMAL]);
    const idx = indicesOf(json.accessors[prim.indices]);
    const mat = json.materials[prim.material]?.pbrMetallicRoughness || {};
    const c = mat.baseColorFactor || [1, 1, 1, 1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]) });
    out.push(new THREE.Mesh(geo, material));
  }
  return out;
}

export function attachTruckModel(map, marker) {
  const api = { ok: false, ready: null };
  let scene, camera, renderer, layer;
  async function mount() {
    const THREE = await import(THREE_URL);
    const buf = await (await fetch(MODEL)).arrayBuffer();
    scene = new THREE.Scene();
    const group = new THREE.Group();
    let minZ = Infinity, maxZ = -Infinity;
    for (const mesh of meshesFromGlb(buf, THREE)) {
      group.add(mesh);
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z);
    }
    api.lengthM = Math.max(6, maxZ - minZ);
    const disc = (rgba, opacity) => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
      grd.addColorStop(0, rgba); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity }));
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    };
    const mid = (minZ + maxZ) / 2;
    const shadow = disc('rgba(0,0,0,0.92)', 1);
    shadow.scale.set(5.2, 12.2, 1); shadow.position.set(0, 0.02, mid); group.add(shadow);
    const glow = disc('rgba(255,140,0,0.5)', 0.9);
    glow.material.blending = THREE.AdditiveBlending;
    glow.scale.set(4.6, 11.2, 1); glow.position.set(0, 0.05, mid); group.add(glow);
    group.position.z = -maxZ; // nose of the cab sits on the GPS point
    scene.add(group);
    camera = new THREE.Camera();
    layer = {
      id: 'rr-truck',
      type: 'custom',
      renderingMode: '3d',
      onAdd(m, gl) {
        renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl });
        renderer.autoClear = false;
      },
      render(gl, matrix) {
        if (!renderer || !marker.getLngLat) return;
        const ll = marker.getLngLat();
        if (!ll) return;
        const heading = marker.getRotation() || 0;
        const mc = maplibregl.MercatorCoordinate.fromLngLat([ll.lng, ll.lat], 0);
        const meters = mc.meterInMercatorCoordinateUnits();
        const rad = heading * Math.PI / 180;
        const dNorth = (api.lengthM || 20) / 111320;
        const ahead = [ll.lng + Math.sin(rad) * dNorth / Math.cos(ll.lat * Math.PI / 180), ll.lat + Math.cos(rad) * dNorth];
        const pa = map.project([ll.lng, ll.lat]), pb = map.project(ahead);
        const px = Math.max(8, Math.hypot(pb.x - pa.x, pb.y - pa.y));
        const s = meters * (36 / px); // projected body stays inside 56–72px at every zoom
        api.px = px; api.scale = s;
        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z || 0)
          .scale(new THREE.Vector3(s, -s, s))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
          .multiply(new THREE.Matrix4().makeRotationY(heading * Math.PI / 180 - Math.PI / 2));
        camera.projectionMatrix.copy(m.multiply(l));
        renderer.resetState();
        renderer.render(scene, camera);
      },
    };
    if (!map.getLayer('rr-truck')) map.addLayer(layer);
    api.ok = true;
    api.relight = () => map.triggerRepaint();
  }
  api.ready = mount().catch(e => { api.ok = false; console.warn('3D truck unavailable', e && e.message ? e.message : e); });
  api.remount = () => { if (api.ok && layer && !map.getLayer('rr-truck')) { try { map.addLayer(layer); } catch (e) { console.warn('3D truck layer', e && e.message ? e.message : e); } } };
  return api;
}

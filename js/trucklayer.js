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
    const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(c[0], c[1], c[2]) });
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
    scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const sun = new THREE.DirectionalLight(0xfff6ea, 0.85);
    sun.position.set(40, 70, 24);
    scene.add(sun);
    const group = new THREE.Group();
    for (const mesh of meshesFromGlb(buf, THREE)) group.add(mesh);
    group.position.z = -0.6; // cab sits on the GPS point; the trailer trails behind
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
        const s = mc.meterInMercatorCoordinateUnits();
        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z || 0)
          .scale(new THREE.Vector3(s, -s, s))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
          .multiply(new THREE.Matrix4().makeRotationZ(Math.PI - heading * Math.PI / 180));
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

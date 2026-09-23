// Helpers for scattering instanced scenery.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paint a geometry with a flat vertex colour (optionally varied by height) and return it.
export function colored(geo, hex, topHex = null) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const c = new THREE.Color(hex), c2 = topHex !== null ? new THREE.Color(topHex) : null;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const arr = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    tmp.copy(c);
    if (c2) tmp.lerp(c2, (pos.getY(i) - min.y) / Math.max(1e-3, max.y - min.y));
    arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return g;
}

export function merge(parts) {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  return mergeGeometries(clean, false);
}

// Build an InstancedMesh from a list of {x,y,z,ry,s,sy} transforms.
export function instanced(geo, mat, list, { cast = true, receive = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((t, i) => {
    e.set(t.rx || 0, t.ry || 0, t.rz || 0);
    q.setFromEuler(e);
    p.set(t.x, t.y, t.z);
    s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (t.color !== undefined) mesh.setColorAt(i, new THREE.Color(t.color));
  });
  mesh.count = list.length;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

// Random points in a rectangle accepted by `test(x, z)`; test returns a transform or null.
export function scatter(count, rand, [x0, x1, z0, z1], test, maxTries = count * 12) {
  const out = [];
  for (let k = 0; k < maxTries && out.length < count; k++) {
    const x = x0 + (x1 - x0) * rand(), z = z0 + (z1 - z0) * rand();
    const t = test(x, z);
    if (t) out.push(t);
  }
  return out;
}

// Points along the track at a lateral band on both sides.
export function alongTrack(track, spacing, rand, fn) {
  const out = [];
  for (let s = 0; s < track.length; s += spacing * (0.6 + rand() * 0.8)) {
    const r = fn(s, rand);
    if (r) out.push(r);
  }
  return out;
}

// Builds the visible track from a TrackPath: road, kerbs, barriers (with optional neon strip),
// embankments, start line and gantry.
import * as THREE from 'three';
import { checkerTexture, kerbTexture, textTexture } from './textures.js';
import { addWorldDetail } from './detail.js';

// Ribbon along the track between two (lateral, height) profiles.
function ribbon(track, a, b, { vScale = 1 / 40, uFrom = 0, uTo = 1, yOff = 0 } = {}) {
  const n = track.n;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const s = i * track.step;
    for (let j = 0; j < 2; j++) {
      const [lat, h] = j === 0 ? a : b;
      const o = (i * 2 + j) * 3;
      pos[o] = track.x[k] + track.rx[k] * lat;
      pos[o + 1] = track.y[k] + h + yOff;
      pos[o + 2] = track.z[k] + track.rz[k] * lat;
      uv[(i * 2 + j) * 2] = j === 0 ? uFrom : uTo;
      uv[(i * 2 + j) * 2 + 1] = s * vScale;
    }
    if (i < n) {
      const p = i * 2;
      idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fixWinding(g, wantUp) {
  // make sure the ribbon faces the intended way (up for road, inward for walls)
  const n = g.attributes.normal;
  let sum = 0;
  for (let i = 0; i < n.count; i++) sum += n.getY(i);
  if ((sum < 0) === wantUp) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

// asphalt: { map, normalMap, roughnessMap } from getAsphalt()
export function buildTrackMeshes(track, style, maxAniso, asphalt) {
  const group = new THREE.Group();
  const hw = track.halfWidth;

  // Road: procedural asphalt (albedo + normal + roughness) plus world-space grit and tone variation
  const at = asphalt;
  for (const t of [at.map, at.normalMap, at.roughnessMap]) t.anisotropy = maxAniso;
  const roadMat = new THREE.MeshStandardMaterial({
    map: at.map,
    normalMap: at.normalMap,
    normalScale: new THREE.Vector2(1, 1).multiplyScalar(style.road.normalScale ?? (style.road.wet ? 0.4 : 0.7)),
    roughnessMap: at.roughnessMap,
    roughness: 1,
    metalness: style.road.metalness ?? 0.0,
    envMapIntensity: style.road.envIntensity ?? 1,
  });
  addWorldDetail(roadMat, { fine: [1.4, 0.14], macro: [0.011, 0.26], rough: 0.12 });
  const road = new THREE.Mesh(fixWinding(ribbon(track, [-hw, 0], [hw, 0], { vScale: 1 / 40 }), true), roadMat);
  road.receiveShadow = true;
  group.add(road);

  // Shoulders just outside the road, under the barrier
  // gravel shoulders
  const shoulderMat = addWorldDetail(new THREE.MeshStandardMaterial({ color: style.shoulder ?? 0x3a3835, roughness: 0.95 }), { fine: [2.2, 0.7], macro: [0.05, 0.35], rough: 0.1 });
  for (const side of [-1, 1]) {
    const a = [side * hw, -0.01], b = [side * (hw + 2.2), -0.05];
    const g = fixWinding(ribbon(track, side < 0 ? b : a, side < 0 ? a : b), true);
    const m = new THREE.Mesh(g, shoulderMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // Kerbs
  if (style.kerb) {
    const kt = kerbTexture(style.kerb[0], style.kerb[1]);
    const kMat = new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const a = [side * (hw - 1.1), 0.03], b = [side * (hw + 0.2), 0.08];
      const g = fixWinding(ribbon(track, side < 0 ? b : a, side < 0 ? a : b, { vScale: 1 / 6 }), true);
      const m = new THREE.Mesh(g, kMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Embankment down to the terrain
  if (style.embankment) {
    const eMat = addWorldDetail(new THREE.MeshStandardMaterial({ color: style.embankment, roughness: 1 }), { fine: [0.45, 0.45], macro: [0.03, 0.35], rough: 0 });
    for (const side of [-1, 1]) {
      const a = [side * (hw + 2.2), -0.05], b = [side * (hw + 14), -7];
      const g = fixWinding(ribbon(track, side < 0 ? b : a, side < 0 ? a : b), true);
      const m = new THREE.Mesh(g, eMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Barriers
  const bs = style.barrier;
  const wallOff = hw + 0.5;
  if (bs.type === 'wall') {
    const wMat = addWorldDetail(new THREE.MeshStandardMaterial({ color: bs.color, roughness: 0.8, metalness: 0.05 }), { fine: [1.2, 0.35], macro: [0.04, 0.25], rough: 0.2, triplanar: true });
    for (const side of [-1, 1]) {
      // inner face, top, outer face
      const inner = ribbon(track, [side * wallOff, 0], [side * wallOff, bs.height]);
      const top = ribbon(track, [side * wallOff, bs.height], [side * (wallOff + 0.6), bs.height]);
      const outer = ribbon(track, [side * (wallOff + 0.6), bs.height], [side * (wallOff + 0.6), -4]);
      for (const g of [inner, top, outer]) {
        const m = new THREE.Mesh(g, wMat);
        m.material.side = THREE.DoubleSide;
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
    }
  } else {
    // guardrail: metal band on posts
    const railMat = new THREE.MeshStandardMaterial({ color: bs.color, roughness: 0.6, metalness: 0.45, envMapIntensity: 0.6, side: THREE.DoubleSide });
    const postMat = new THREE.MeshStandardMaterial({ color: bs.postColor ?? 0x555555, roughness: 0.7, metalness: 0.4 });
    for (const side of [-1, 1]) {
      const g = ribbon(track, [side * wallOff, 0.45], [side * wallOff, 0.95]);
      const m = new THREE.Mesh(g, railMat);
      m.castShadow = true;
      group.add(m);
    }
    const every = Math.max(1, Math.round(4 / track.step));
    const count = Math.ceil(track.n / every) * 2;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), postMat, count);
    const mtx = new THREE.Matrix4();
    let c = 0;
    for (let i = 0; i < track.n; i += every) {
      for (const side of [-1, 1]) {
        mtx.makeTranslation(track.x[i] + track.rx[i] * side * (wallOff + 0.12), track.y[i] + 0.5, track.z[i] + track.rz[i] * side * (wallOff + 0.12));
        posts.setMatrixAt(c++, mtx);
      }
    }
    posts.count = c;
    posts.castShadow = true;
    group.add(posts);
  }

  // Glowing strip along the barrier top (neon / reflectors)
  if (bs.glow) {
    for (const side of [-1, 1]) {
      const h = bs.type === 'wall' ? bs.height + 0.02 : 1.0;
      const g = ribbon(track, [side * (wallOff + 0.05), h], [side * (wallOff + 0.05), h + 0.12]);
      const col = new THREE.Color(side < 0 ? bs.glow[0] : bs.glow[1] ?? bs.glow[0]);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col.multiplyScalar(bs.glowIntensity ?? 4), side: THREE.DoubleSide, toneMapped: true }));
      group.add(m);
    }
  }

  // Start / finish
  const p0 = track.pointAt(0, 0);
  const head = p0.heading;
  const check = new THREE.Mesh(new THREE.PlaneGeometry(track.width, 3), new THREE.MeshStandardMaterial({ map: checkerTexture(16, 2), roughness: 0.7 }));
  check.rotation.order = 'YXZ';
  check.rotation.set(-Math.PI / 2, head, 0);
  check.position.set(p0.x, p0.y + 0.04, p0.z);
  check.receiveShadow = true;
  group.add(check);

  const gantry = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.7 });
  for (const side of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.5, 0.8), pillarMat);
    pil.position.set(side * (hw + 1.6), 4.25, 0);
    pil.castShadow = true;
    gantry.add(pil);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(track.width + 4, 1.8, 0.8), pillarMat);
  beam.position.y = 8.2;
  beam.castShadow = true;
  gantry.add(beam);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width * 0.8, 1.5),
    new THREE.MeshBasicMaterial({ map: textTexture('APEX RUSH', { accent: style.accent ?? '#ff2d55' }), toneMapped: false }),
  );
  sign.position.set(0, 8.2, -0.41);
  sign.rotation.y = Math.PI;
  gantry.add(sign);
  const sign2 = sign.clone();
  sign2.position.z = 0.41;
  sign2.rotation.y = 0;
  gantry.add(sign2);
  // light bar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(track.width + 3.8, 0.12, 0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(style.accent ?? '#ff2d55').multiplyScalar(5) }));
  bar.position.y = 7.25;
  gantry.add(bar);
  gantry.position.set(p0.x, p0.y, p0.z);
  gantry.rotation.y = head;
  group.add(gantry);

  return group;
}

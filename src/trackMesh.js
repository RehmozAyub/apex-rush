// Builds the visible track from a TrackPath: road, kerbs, barriers (with optional neon strip),
// embankments, start line and gantry - plus the shortcut (its own dirt road and barriers, with
// gaps in the main barrier where it forks off and merges back).
import * as THREE from 'three';
import { checkerTexture, kerbTexture, textTexture } from './textures.js';
import { addWorldDetail } from './detail.js';

// Ribbon along the track between two (lateral, height) profiles.
// closed: loop back to the start (main road); keep(i): leave out segments touching sample i.
function ribbon(track, a, b, { vScale = 1 / 40, uFrom = 0, uTo = 1, yOff = 0, closed = true, keep = null } = {}) {
  const n = track.n;
  const last = closed ? n : n - 1;
  const pos = new Float32Array((last + 1) * 2 * 3);
  const uv = new Float32Array((last + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= last; i++) {
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
    if (i < last && (!keep || (keep(k) && keep((i + 1) % n)))) {
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
// shortcuts: ShortcutSet (or null)
export function buildTrackMeshes(track, style, maxAniso, asphalt, shortcuts = null) {
  const group = new THREE.Group();
  const hw = track.halfWidth;
  // per side: which main-road samples keep their roadside (no gap for the shortcut)
  const sideKeep = (side) => (shortcuts ? shortcuts.mainKeep(side) : null);

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
    const g = fixWinding(ribbon(track, side < 0 ? b : a, side < 0 ? a : b, { keep: sideKeep(side) }), true);
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
      const g = fixWinding(ribbon(track, side < 0 ? b : a, side < 0 ? a : b, { vScale: 1 / 6, keep: sideKeep(side) }), true);
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
      const g = fixWinding(ribbon(track, side < 0 ? b : a, side < 0 ? a : b, { keep: sideKeep(side) }), true);
      const m = new THREE.Mesh(g, eMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Barriers
  addBarriers(group, track, style.barrier, hw + 0.5, sideKeep, true);

  if (shortcuts) for (const sc of shortcuts.list) group.add(buildShortcut(sc, style));

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

// Barriers along both sides of a path. keepFor(side) -> null (all) or a sample filter.
function addBarriers(group, track, bs, wallOff, keepFor, closed) {
  const opt = (side, extra = {}) => ({ closed, keep: keepFor(side), ...extra });
  if (bs.type === 'wall') {
    const wMat = addWorldDetail(new THREE.MeshStandardMaterial({ color: bs.color, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }), { fine: [1.2, 0.35], macro: [0.04, 0.25], rough: 0.2, triplanar: true });
    for (const side of [-1, 1]) {
      // inner face, top, outer face
      const inner = ribbon(track, [side * wallOff, 0], [side * wallOff, bs.height], opt(side));
      const top = ribbon(track, [side * wallOff, bs.height], [side * (wallOff + 0.6), bs.height], opt(side));
      const outer = ribbon(track, [side * (wallOff + 0.6), bs.height], [side * (wallOff + 0.6), -4], opt(side));
      for (const g of [inner, top, outer]) {
        const m = new THREE.Mesh(g, wMat);
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
      const m = new THREE.Mesh(ribbon(track, [side * wallOff, 0.45], [side * wallOff, 0.95], opt(side)), railMat);
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
        const keep = keepFor(side);
        if (keep && !keep(i)) continue;
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
      const g = ribbon(track, [side * (wallOff + 0.05), h], [side * (wallOff + 0.05), h + 0.12], opt(side));
      const col = new THREE.Color(side < 0 ? bs.glow[0] : bs.glow[1] ?? bs.glow[0]);
      group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col.multiplyScalar(bs.glowIntensity ?? 4), side: THREE.DoubleSide, toneMapped: true })));
    }
  }
}

// The shortcut: a narrow dirt (or style-coloured) road with shoulders, embankments, barriers
// and a sign at the fork.
function buildShortcut(sc, style) {
  const group = new THREE.Group();
  const path = sc.path, shw = path.halfWidth;
  const cfg = style.shortcut || {};
  const keepFor = (side) => { const g = sc.pathGap[side < 0 ? 0 : 1]; return (j) => !g[j]; };
  // drawn behind the main road where the two overlap at the fork and the merge
  const dirt = addWorldDetail(new THREE.MeshStandardMaterial({ color: cfg.color ?? 0x6e5a44, roughness: 1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), { fine: [1.8, 0.55], macro: [0.03, 0.35], rough: 0.05 });
  const road = new THREE.Mesh(fixWinding(ribbon(path, [-shw, -0.03], [shw, -0.03], { closed: false }), true), dirt);
  road.receiveShadow = true;
  group.add(road);
  // wheel ruts
  const rut = new THREE.MeshStandardMaterial({ color: new THREE.Color(cfg.color ?? 0x6e5a44).multiplyScalar(0.6), roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  for (const lat of [-2.2, 2.2]) {
    const m = new THREE.Mesh(fixWinding(ribbon(path, [lat - 0.45, -0.02], [lat + 0.45, -0.02], { closed: false }), true), rut);
    m.receiveShadow = true;
    group.add(m);
  }
  const shoulderMat = addWorldDetail(new THREE.MeshStandardMaterial({ color: style.shoulder ?? 0x3a3835, roughness: 0.95 }), { fine: [2.2, 0.7], macro: [0.05, 0.35], rough: 0.1 });
  const eMat = addWorldDetail(new THREE.MeshStandardMaterial({ color: style.embankment ?? 0x4a4a40, roughness: 1 }), { fine: [0.45, 0.45], macro: [0.03, 0.35], rough: 0 });
  for (const side of [-1, 1]) {
    const keep = keepFor(side);
    const a = [side * shw, -0.04], b = [side * (shw + 2), -0.07];
    group.add(new THREE.Mesh(fixWinding(ribbon(path, side < 0 ? b : a, side < 0 ? a : b, { closed: false, keep }), true), shoulderMat));
    const c = [side * (shw + 2), -0.07], d = [side * (shw + 12), -6];
    const e = new THREE.Mesh(fixWinding(ribbon(path, side < 0 ? d : c, side < 0 ? c : d, { closed: false, keep }), true), eMat);
    e.receiveShadow = true;
    group.add(e);
  }
  addBarriers(group, path, style.barrier, shw + 0.5, keepFor, false);

  for (const r of sc.ramps) group.add(rampMesh(path, r, shw));
  if (sc.fence) return group; // hidden shortcuts: no sign, a fence across the way in instead

  // sign at the fork
  const u = Math.min(path.length * 0.3, sc.overlapIn + 10);
  const p = path.pointAt(u, -sc.side * (shw + 1.8));
  const sign = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ map: textTexture('SHORTCUT ›', { accent: style.accent ?? '#ff2d55', font: 'italic 900 140px Bahnschrift, "Segoe UI", sans-serif' }), toneMapped: false, side: THREE.DoubleSide }));
  board.position.y = 2.4;
  sign.add(board);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.6, metalness: 0.5 });
  for (const sx of [-1.7, 1.7]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), postMat);
    post.position.set(sx, 1.2, -0.05);
    sign.add(post);
  }
  sign.position.set(p.x, p.y, p.z);
  // face back toward oncoming cars on the main road
  const back = sc.track.pointAt(sc.a - 60, 0);
  sign.rotation.y = Math.atan2(back.x - p.x, back.z - p.z);
  group.add(sign);
  return group;
}

// Ramp texture: wooden planks with a hazard band at the lip.
let rampTex = null;
function rampTexture() {
  if (rampTex) return rampTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const l = 92 + ((i * 37) % 23);
    g.fillStyle = `rgb(${l + 40},${l + 10},${l - 30})`;
    g.fillRect(0, i * 16, 256, 15);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, i * 16 + 15, 256, 1);
  }
  // hazard stripes at the lip end (v = 1 at the top of the canvas)
  for (let x = -64; x < 256; x += 32) {
    g.fillStyle = '#f2c21a';
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 48, 36); g.lineTo(x + 32, 36); g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.85)';
  g.fillRect(0, 36, 256, 4);
  rampTex = new THREE.CanvasTexture(c);
  rampTex.colorSpace = THREE.SRGBColorSpace;
  return rampTex;
}

// A kicker on the shortcut: a sloped deck rising to height r.h, ending in a vertical drop.
// Half ramps cover one side of the road (r.half = -1 / +1).
function rampMesh(path, r, shw) {
  const lat0 = r.half > 0 ? -0.3 : -shw, lat1 = r.half < 0 ? 0.3 : shw;
  const pos = [], uv = [], idx = [];
  const n = Math.max(4, Math.ceil(r.len / 0.5));
  const P = {};
  const vert = (u, lat, h, uu, vv) => { path.pointAt(u, lat, P); pos.push(P.x, P.y + h - 0.02, P.z); uv.push(uu, vv); return pos.length / 3 - 1; };
  // deck
  for (let i = 0; i <= n; i++) {
    const k = i / n, u = r.u0 + r.len * k, h = r.h * k;
    vert(u, lat0, h, 0, k); vert(u, lat1, h, 1, k);
    if (i < n) { const p = i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  }
  // lip face and the two sides
  const end = r.u0 + r.len;
  const a = vert(end, lat0, r.h, 0, 0.9), b = vert(end, lat1, r.h, 1, 0.9), c = vert(end, lat1, 0, 1, 0.6), d = vert(end, lat0, 0, 0, 0.6);
  idx.push(a, c, b, a, d, c);
  for (const lat of [lat0, lat1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const k = i / n, u = r.u0 + r.len * k;
      vert(u, lat, r.h * k, k, 0.5); vert(u, lat, 0, k, 0.4);
      if (i < n) { const p = base + i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: rampTexture(), roughness: 0.85, side: THREE.DoubleSide }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

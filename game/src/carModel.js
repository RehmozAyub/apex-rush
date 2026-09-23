// Procedural car models. Each style has a lofted body + canopy (cross-section keyframes) and a
// feature set (wing, lights, exhausts, stripes, scoops, decals, wheels...). Static parts are
// merged per material so a car costs only a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { radialTexture } from './textures.js';

// keyframes: [u, hwBottom, hwTop, yBottom, yTop]  (u: 0 = rear, 1 = front)
const STYLES = {
  wedge: { // VIPER: angular supercar
    length: 4.5, wheelBase: 2.7, wheelR: 0.36, tyreW: 0.32, track: 1.0, rideY: 0, n: 5,
    body: [
      [0.0, 0.84, 0.72, 0.32, 0.78], [0.05, 0.96, 0.84, 0.27, 0.93], [0.22, 0.99, 0.87, 0.25, 0.96],
      [0.45, 0.97, 0.85, 0.25, 0.9], [0.62, 0.98, 0.86, 0.25, 0.8], [0.8, 0.97, 0.84, 0.25, 0.68],
      [0.93, 0.9, 0.76, 0.26, 0.54], [1.0, 0.76, 0.6, 0.3, 0.42],
    ],
    cabin: [
      [0.25, 0.8, 0.6, 0.82, 0.9], [0.33, 0.82, 0.62, 0.82, 1.2], [0.48, 0.83, 0.64, 0.8, 1.25],
      [0.58, 0.82, 0.6, 0.76, 1.1], [0.7, 0.78, 0.5, 0.7, 0.76],
    ],
    f: {
      wing: 'swan', stripes: 'dual', hoodVents: true, sideIntakes: true, canards: true, fins: true,
      head: 'strip', headY: 0.5, headU: 0.975, tail: 'bar', tailY: 0.74, exhaust: 'center2',
      wheel: { style: 'spoke5', rim: 'gunmetal' }, caliper: 0xd01818, mirrors: true,
    },
  },
  gt: { // BOLT: long-nose grand tourer, rounder and chrome-trimmed
    length: 4.85, wheelBase: 2.95, wheelR: 0.37, tyreW: 0.32, track: 0.99, rideY: 0, n: 3.6,
    body: [
      [0.0, 0.8, 0.68, 0.34, 0.8], [0.05, 0.93, 0.8, 0.28, 0.9], [0.18, 0.97, 0.83, 0.26, 0.93],
      [0.4, 0.95, 0.82, 0.26, 0.86], [0.58, 0.96, 0.84, 0.26, 0.8], [0.8, 0.95, 0.8, 0.26, 0.76],
      [0.94, 0.88, 0.7, 0.28, 0.64], [1.0, 0.7, 0.52, 0.32, 0.5],
    ],
    cabin: [
      [0.1, 0.76, 0.54, 0.84, 0.88], [0.2, 0.8, 0.58, 0.84, 1.1], [0.36, 0.82, 0.62, 0.82, 1.22],
      [0.46, 0.81, 0.58, 0.8, 1.15], [0.55, 0.77, 0.48, 0.77, 0.83],
    ],
    f: {
      wing: 'duck', stripes: 'none', powerDome: true, chromeStrip: true, gills: true,
      head: 'round', headY: 0.56, headU: 0.972, tail: 'round', tailY: 0.72, exhaust: 'quad',
      wheel: { style: 'mesh', rim: 'chrome' }, caliper: 0xd8d8d8, mirrors: true, plate: true, grille: 'chrome',
    },
  },
  hatch: { // RAPTOR: compact hot hatch, two-tone roof
    length: 4.05, wheelBase: 2.5, wheelR: 0.35, tyreW: 0.3, track: 0.99, rideY: 0.02, n: 5,
    body: [
      [0.0, 0.86, 0.78, 0.34, 0.96], [0.04, 0.96, 0.86, 0.29, 1.0], [0.25, 0.98, 0.88, 0.27, 0.98],
      [0.5, 0.97, 0.86, 0.27, 0.95], [0.72, 0.96, 0.84, 0.27, 0.86], [0.88, 0.94, 0.8, 0.28, 0.76],
      [1.0, 0.82, 0.66, 0.32, 0.6],
    ],
    cabin: [
      [0.03, 0.84, 0.66, 0.92, 1.36], [0.12, 0.85, 0.68, 0.92, 1.44], [0.45, 0.85, 0.68, 0.9, 1.46],
      [0.58, 0.84, 0.64, 0.88, 1.34], [0.7, 0.8, 0.54, 0.84, 0.94],
    ],
    f: {
      wing: 'roof', stripes: 'side', roofTrim: true, fogLamps: true, number: true, grille: 'dark',
      head: 'swept', headY: 0.66, headU: 0.98, tail: 'split', tailY: 0.84, exhaust: 'side',
      wheel: { style: 'spoke5', rim: 'white' }, caliper: 0xffb000, mirrors: true, plate: true,
    },
  },
  muscle: { // TITAN: boxy muscle car, long hood, big scoop
    length: 4.95, wheelBase: 3.0, wheelR: 0.38, tyreW: 0.36, track: 1.03, rideY: 0.02, n: 7,
    body: [
      [0.0, 0.92, 0.84, 0.3, 0.9], [0.04, 0.99, 0.9, 0.27, 0.97], [0.25, 1.01, 0.92, 0.26, 0.98],
      [0.5, 1.0, 0.9, 0.26, 0.95], [0.75, 1.01, 0.92, 0.26, 0.93], [0.95, 0.99, 0.9, 0.28, 0.88],
      [1.0, 0.95, 0.86, 0.3, 0.8],
    ],
    cabin: [
      [0.2, 0.84, 0.66, 0.9, 0.98], [0.26, 0.86, 0.7, 0.9, 1.3], [0.44, 0.86, 0.7, 0.88, 1.34],
      [0.52, 0.85, 0.66, 0.86, 1.2], [0.58, 0.82, 0.6, 0.84, 0.96],
    ],
    f: {
      wing: 'lip', stripes: 'wide', hoodScoop: true, number: true, grille: 'full',
      head: 'rect', headY: 0.62, headU: 0.99, tail: 'wide', tailY: 0.78, exhaust: 'dual',
      wheel: { style: 'dish', rim: 'black' }, caliper: 0x333333, mirrors: true, plate: true,
    },
  },
  hyper: { // PHANTOM: ultra-low hypercar with fighter canopy and shark fin
    length: 4.7, wheelBase: 2.75, wheelR: 0.36, tyreW: 0.34, track: 1.04, rideY: 0, n: 4.5,
    body: [
      [0.0, 0.9, 0.8, 0.3, 0.82], [0.06, 0.99, 0.88, 0.24, 0.86], [0.25, 1.02, 0.9, 0.22, 0.84],
      [0.45, 0.98, 0.86, 0.22, 0.78], [0.65, 1.0, 0.88, 0.22, 0.7], [0.82, 0.98, 0.84, 0.22, 0.58],
      [0.94, 0.9, 0.74, 0.22, 0.46], [1.0, 0.76, 0.58, 0.24, 0.36],
    ],
    cabin: [
      [0.34, 0.5, 0.3, 0.74, 0.8], [0.42, 0.64, 0.44, 0.72, 1.08], [0.54, 0.68, 0.46, 0.7, 1.12],
      [0.64, 0.64, 0.4, 0.66, 0.98], [0.74, 0.54, 0.3, 0.6, 0.64],
    ],
    f: {
      wing: 'hyper', fin: true, stripes: 'center', sideIntakes: true, canards: true, fins: true, roofScoop: true,
      head: 'bar', headY: 0.42, headU: 0.985, tail: 'bar', tailY: 0.7, exhaust: 'center1',
      wheel: { style: 'turbine', rim: 'gunmetal' }, caliper: 0xffd000, mirrors: false,
    },
  },
  rally: { // ROGUE: lifted rally hatch with roof lights and mud flaps
    length: 4.2, wheelBase: 2.55, wheelR: 0.39, tyreW: 0.36, track: 1.0, rideY: 0.14, n: 5.5,
    body: [
      [0.0, 0.86, 0.8, 0.36, 1.0], [0.04, 0.96, 0.88, 0.31, 1.04], [0.25, 0.98, 0.9, 0.3, 1.02],
      [0.5, 0.97, 0.88, 0.3, 1.0], [0.72, 0.96, 0.86, 0.3, 0.92], [0.9, 0.94, 0.82, 0.31, 0.82],
      [1.0, 0.86, 0.72, 0.34, 0.66],
    ],
    cabin: [
      [0.04, 0.84, 0.68, 0.96, 1.4], [0.12, 0.86, 0.7, 0.96, 1.5], [0.46, 0.86, 0.7, 0.94, 1.52],
      [0.6, 0.84, 0.64, 0.92, 1.38], [0.72, 0.8, 0.54, 0.88, 0.98],
    ],
    f: {
      wing: 'rally', stripes: 'center', roofRack: true, mudFlaps: true, number: true, hoodVents: true, bashPlate: true,
      head: 'quad', headY: 0.7, headU: 0.985, tail: 'split', tailY: 0.86, exhaust: 'side', fogLamps: true,
      wheel: { style: 'rally', rim: 'gold' }, caliper: 0xd01818, mirrors: true, grille: 'dark',
    },
  },
};

export const CAR_STYLES = Object.keys(STYLES);

function interp(keys, u) {
  if (u <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (u <= b[0]) {
      let t = (u - a[0]) / (b[0] - a[0]);
      t = 0.5 - 0.5 * Math.cos(t * Math.PI);
      return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t);
    }
  }
  return keys[keys.length - 1].slice(1);
}

// Loft rounded-rectangle sections (superellipse) along z.
function loft(keys, length, { stations = 30, M = 28, n = 4.5 } = {}) {
  const ua = keys[0][0], ub = keys[keys.length - 1][0];
  const pos = [], idx = [];
  for (let i = 0; i < stations; i++) {
    const u = ua + (ub - ua) * (i / (stations - 1));
    const [hwB, hwT, yB, yT] = interp(keys, u);
    const z = (u - 0.5) * length;
    const mid = (yB + yT) / 2, half = (yT - yB) / 2;
    for (let j = 0; j < M; j++) {
      const phi = (j / M) * Math.PI * 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      const yy = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      const xx = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const hw = hwB + (hwT - hwB) * ((yy + 1) / 2);
      pos.push(xx * hw, mid + half * yy, z);
    }
  }
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, b, c, b, d, c);
    }
  }
  for (const [ring, front] of [[0, false], [stations - 1, true]]) {
    const base = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < M; j++) {
      const k = (ring * M + j) * 3;
      cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2];
      pos.push(pos[k], pos[k + 1], pos[k + 2]);
    }
    pos.push(cx / M, cy / M, cz / M);
    const center = base + M;
    for (let j = 0; j < M; j++) {
      const a = base + j, b = base + ((j + 1) % M);
      if (front) idx.push(center, a, b); else idx.push(center, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- geometry helpers -----------------------------------------------------------
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), SC = new THREE.Vector3();
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  M4.compose(V.set(x, y, z), Q, SC.set(sx, sy, sz));
  return geo.applyMatrix4(M4);
}

function mergeClean(list, keepUv = false) {
  const clean = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (!n.attributes.normal) n.computeVertexNormals();
    for (const k of Object.keys(n.attributes)) if (!(k === 'position' || k === 'normal' || (keepUv && k === 'uv'))) n.deleteAttribute(k);
    if (keepUv && !n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  return mergeGeometries(clean, false);
}

class Parts {
  constructor() { this.b = {}; }
  add(key, geo) { (this.b[key] ||= []).push(geo); return geo; }
  box(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { return this.add(key, xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz)); }
  // cylinder whose axis points along z (lamps, exhausts)
  tube(key, r, len, seg, x, y, z, r2 = r, open = false) { return this.add(key, xf(new THREE.CylinderGeometry(r, r2, len, seg, 1, open), x, y, z, Math.PI / 2)); }
  build(mats, parent, { cast = true, receive = false } = {}) {
    const meshes = {};
    for (const [key, list] of Object.entries(this.b)) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeClean(list), mats[key]);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
      meshes[key] = mesh;
    }
    return meshes;
  }
}

// --- shared materials / textures --------------------------------------------------
const shared = {};
const texCache = new Map();
function sharedMats() {
  if (shared.glass) return shared;
  shared.glass = new THREE.MeshPhysicalMaterial({ color: 0x07090d, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  shared.tire = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.85 });
  shared.trim = new THREE.MeshStandardMaterial({ color: 0x0d0e11, metalness: 0.3, roughness: 0.55 });
  shared.carbon = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.5, roughness: 0.3 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.14 });
  shared.rimMats = {
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8dce4, metalness: 1, roughness: 0.16 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.9, roughness: 0.3 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf0f0f0, metalness: 0.3, roughness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.6, roughness: 0.35 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a32a, metalness: 1, roughness: 0.28 }),
  };
  shared.rimDark = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, metalness: 0.6, roughness: 0.4 });
  shared.calipers = new Map();
  shared.shadowTex = radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');
  shared.tireGeo = new THREE.TorusGeometry(0.78, 0.22, 14, 30).rotateY(Math.PI / 2);
  shared.rimGeo = new THREE.CylinderGeometry(0.64, 0.64, 1, 22, 1).rotateZ(Math.PI / 2);
  shared.plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 });
  return shared;
}

function caliperMat(hex) {
  if (!shared.calipers.has(hex)) shared.calipers.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, metalness: 0.3 }));
  return shared.calipers.get(hex);
}

function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1e6'; g.fillRect(0, 0, 256, 72);
  g.strokeStyle = '#222'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 66);
  g.fillStyle = '#1a1a1a'; g.font = 'bold 48px Bahnschrift, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('APX·RSH', 128, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function numberTexture(num, square) {
  const key = `${num}-${square}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f6f6';
  if (square) { g.beginPath(); g.roundRect(6, 14, 116, 100, 14); g.fill(); } else { g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#111';
  g.font = 'italic 900 78px Bahnschrift, "Segoe UI", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

// --- wheels -----------------------------------------------------------------------
const WHEEL_STYLES = {
  spoke5: { spokes: 5, w: 0.15 },
  mesh: { spokes: 12, w: 0.05 },
  dish: { spokes: 0, dish: true },
  turbine: { spokes: 16, w: 0.045, twist: 0.35 },
  rally: { spokes: 6, w: 0.12 },
};

function makeWheel(r, width, cfg, caliperHex, mats) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const tire = new THREE.Mesh(mats.tireGeo, mats.tire);
  tire.scale.set(width / 0.44, r, r);
  tire.castShadow = true;
  spin.add(tire);
  const ws = WHEEL_STYLES[cfg.style];
  const rimMat = mats.rimMats[cfg.rim];
  const inner = new THREE.Mesh(mats.rimGeo, ws.dish ? rimMat : mats.rimDark);
  inner.scale.set(width * 0.9, r, r);
  spin.add(inner);
  const p = new Parts();
  // spokes run from the hub outwards on both wheel faces
  for (let k = 0; k < ws.spokes; k++) {
    const a = (k / ws.spokes) * Math.PI * 2;
    p.add('rim', xf(new THREE.BoxGeometry(width * 0.94, 0.3 * r, ws.w * r).translate(0, 0.33 * r, 0), 0, 0, 0, a, 0, ws.twist || 0));
  }
  if (ws.dish) {
    for (const sx of [-1, 1]) p.add('chrome', xf(new THREE.TorusGeometry(0.6 * r, 0.035 * r, 6, 24), sx * width * 0.45, 0, 0, 0, Math.PI / 2));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      for (const sx of [-1, 1]) p.add('chrome', xf(new THREE.CylinderGeometry(0.03 * r, 0.03 * r, 0.04, 6), sx * width * 0.46, Math.cos(a) * 0.22 * r, Math.sin(a) * 0.22 * r, 0, 0, Math.PI / 2));
    }
  }
  p.add('chrome', xf(new THREE.CylinderGeometry(0.15 * r, 0.15 * r, width * 0.98, 10), 0, 0, 0, 0, 0, Math.PI / 2));
  p.build({ rim: rimMat, chrome: mats.chrome }, spin, { cast: false });
  // brake caliper: steers with the wheel but does not spin
  const cal = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 0.28 * r, 0.42 * r), caliperMat(caliperHex));
  cal.position.set(0, 0.34 * r, -0.12 * r);
  group.add(cal);
  return { group, spin };
}

// --- the car --------------------------------------------------------------------
export function buildCar(styleId, paintHex, { underglow = null, number = null } = {}) {
  const S = STYLES[styleId] || STYLES.wedge;
  const F = S.f;
  const mats = sharedMats();
  const L = S.length;
  const zOf = (u) => (u - 0.5) * L;
  const at = (u) => interp(S.body, u); // [hwB, hwT, yB, yT]
  const topY = (u) => at(u)[3];
  const slope = (u) => (topY(Math.min(1, u + 0.02)) - topY(Math.max(0, u - 0.02))) / (0.04 * L);
  const sideX = (u, y) => {
    const [hwB, hwT, yB, yT] = at(u);
    const mid = (yB + yT) / 2, half = (yT - yB) / 2;
    const yy = Math.max(-1, Math.min(1, (y - mid) / half));
    const hw = hwB + (hwT - hwB) * ((yy + 1) / 2);
    return hw * Math.pow(1 - Math.pow(Math.abs(yy), S.n), 1 / S.n);
  };
  const cab = S.cabin;
  const cabRoofU = cab[Math.floor(cab.length / 2)][0];
  const cabTop = (u) => interp(cab, u)[3];

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25, side: THREE.DoubleSide });
  const pc = new THREE.Color(paintHex);
  const lum = 0.2126 * pc.r + 0.7152 * pc.g + 0.0722 * pc.b;
  const stripe = new THREE.MeshPhysicalMaterial({ color: lum > 0.45 ? 0x121316 : 0xf2f2f2, metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8f2ff).multiplyScalar(5) });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1028).multiplyScalar(2.5) });
  const amberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb040).multiplyScalar(3) });

  const p = new Parts();
  p.add('paint', loft(S.body, L, { n: S.n }));
  p.add('glass', loft(cab, L, { n: 4, stations: 18, M: 24 }));
  const roofKeys = cab.slice(1, -1).map(([u, , hwT, , yT]) => [u, hwT * 0.98, hwT * 0.86, yT - 0.06, yT + 0.015]);
  p.add(F.roofTrim ? 'carbon' : 'paint', loft(roofKeys, L, { n: 4, stations: 12, M: 20 }));

  // stripes: thin lofts hugging the top centre-line
  const stripeLoft = (keys, w, lift, off) => {
    const k = keys.map(([u, , , , yT]) => [u, w, w * 0.95, yT - 0.05, yT + lift]);
    return xf(loft(k, L, { n: 6, stations: 30, M: 16 }), off);
  };
  if (F.stripes === 'dual' || F.stripes === 'wide') {
    const w = F.stripes === 'wide' ? 0.14 : 0.1, off = F.stripes === 'wide' ? 0.24 : 0.19;
    for (const sx of [-1, 1]) {
      p.add('stripe', stripeLoft(S.body, w, 0.012, sx * off));
      p.add('stripe', stripeLoft(roofKeys.map(([u, a, b, c, d]) => [u, a, b, c, d]), w, 0.013, sx * off));
    }
  } else if (F.stripes === 'center') {
    p.add('stripe', stripeLoft(S.body, 0.16, 0.012, 0));
    p.add('stripe', stripeLoft(roofKeys, 0.16, 0.013, 0));
  } else if (F.stripes === 'side') {
    for (const sx of [-1, 1]) p.box('stripe', 0.02, 0.09, L * 0.66, sx * (sideX(0.5, 0.5) + 0.006), 0.5, -0.05);
  }

  // lower trim: splitter, diffuser, skirts
  const [hwNose] = at(0.98);
  p.box('carbon', hwNose * 1.9, 0.05, 0.42, 0, 0.24, L / 2 - 0.14);
  p.box('trim', 1.7, 0.18, 0.32, 0, 0.35, -L / 2 + 0.12);
  if (F.fins) for (let k = -2; k <= 2; k++) p.box('carbon', 0.03, 0.2, 0.36, k * 0.3, 0.3, -L / 2 + 0.08);
  for (const sx of [-1, 1]) p.box('carbon', 0.08, 0.12, L * 0.46, sx * (sideX(0.5, 0.32) - 0.01), 0.3, 0);

  // front grille
  if (F.grille === 'full') {
    p.box('trim', 1.78, 0.3, 0.06, 0, 0.58, L / 2 - 0.02);
    for (let k = 0; k < 6; k++) p.box('chrome', 1.7, 0.012, 0.02, 0, 0.47 + k * 0.045, L / 2 + 0.01);
  } else if (F.grille === 'chrome') {
    p.box('trim', 0.9, 0.2, 0.05, 0, 0.42, L / 2 - 0.03);
    p.box('chrome', 0.96, 0.03, 0.05, 0, 0.53, L / 2 - 0.025);
    p.box('chrome', 0.96, 0.03, 0.05, 0, 0.31, L / 2 - 0.025);
  } else if (F.grille === 'dark') {
    p.box('trim', 1.1, 0.18, 0.05, 0, 0.44, L / 2 - 0.02);
  }

  // headlights
  const hu = F.headU, hz = zOf(hu) + 0.03;
  const [hwF] = at(hu);
  if (F.head === 'strip') {
    for (const sx of [-1, 1]) p.add('head', xf(new THREE.BoxGeometry(0.46, 0.07, 0.08), sx * (hwF - 0.3), F.headY, hz, 0, sx * -0.35));
  } else if (F.head === 'swept') {
    for (const sx of [-1, 1]) {
      p.add('head', xf(new THREE.BoxGeometry(0.5, 0.12, 0.08), sx * (hwF - 0.32), F.headY, hz, 0, sx * -0.3, sx * 0.08));
      p.add('head', xf(new THREE.BoxGeometry(0.34, 0.025, 0.06), sx * (hwF - 0.32), F.headY - 0.1, hz + 0.01, 0, sx * -0.3));
    }
  } else if (F.head === 'round' || F.head === 'quad') {
    for (const sx of [-1, 1]) for (const k of [0, 1]) {
      const x = sx * (hwF - 0.2 - k * 0.24);
      p.tube('head', 0.085, 0.06, 16, x, F.headY, hz + 0.01);
      p.tube('chrome', 0.105, 0.05, 16, x, F.headY, hz - 0.01);
    }
  } else if (F.head === 'bar') {
    p.box('head', hwF * 1.7, 0.035, 0.06, 0, F.headY, hz);
    for (const sx of [-1, 1]) p.box('head', 0.035, 0.16, 0.06, sx * (hwF - 0.12), F.headY - 0.06, hz - 0.02);
  } else if (F.head === 'rect') {
    for (const sx of [-1, 1]) for (const k of [0, 1]) p.box('head', 0.2, 0.12, 0.05, sx * (0.52 + k * 0.26), F.headY, L / 2 + 0.02);
  }
  if (F.fogLamps) for (const sx of [-1, 1]) p.tube('head', 0.06, 0.05, 12, sx * 0.62, 0.34, zOf(0.99) + 0.02);

  // tail lights
  const tz = -L / 2;
  if (F.tail === 'bar') {
    p.box('tail', 1.5, 0.06, 0.05, 0, F.tailY, tz);
    for (const sx of [-1, 1]) p.box('tail', 0.28, 0.15, 0.05, sx * 0.62, F.tailY - 0.04, tz);
  } else if (F.tail === 'round') {
    for (const sx of [-1, 1]) for (const k of [0, 1]) {
      p.tube('tail', 0.075, 0.05, 16, sx * (0.46 + k * 0.22), F.tailY, tz - 0.01);
      p.tube('chrome', 0.09, 0.04, 16, sx * (0.46 + k * 0.22), F.tailY, tz + 0.01);
    }
  } else if (F.tail === 'split' || F.tail === 'wide') {
    const w = F.tail === 'wide' ? 0.62 : 0.4;
    for (const sx of [-1, 1]) {
      p.box('tail', w, 0.14, 0.05, sx * (0.78 - w / 2), F.tailY, tz);
      p.box('amber', 0.12, 0.14, 0.05, sx * (0.78 - w - 0.08), F.tailY, tz);
    }
  }

  // exhausts (also used as flame emitters)
  const exhausts = [];
  const ex = (x, y, r, seg = 12) => {
    p.tube('chrome', r, 0.24, seg, x, y, tz - 0.02, r * 1.1);
    p.tube('trim', r * 0.72, 0.02, seg, x, y, tz - 0.14);
    exhausts.push(new THREE.Vector3(x, y, tz - 0.16));
  };
  if (F.exhaust === 'center2') { ex(-0.13, 0.36, 0.08); ex(0.13, 0.36, 0.08); }
  else if (F.exhaust === 'quad') { for (const sx of [-1, 1]) { ex(sx * 0.52, 0.32, 0.055); ex(sx * 0.68, 0.32, 0.055); } }
  else if (F.exhaust === 'side') { ex(0.55, 0.32, 0.07); }
  else if (F.exhaust === 'dual') { ex(-0.7, 0.33, 0.1); ex(0.7, 0.33, 0.1); }
  else if (F.exhaust === 'center1') { ex(0, 0.52, 0.14, 6); }

  // wings / spoilers
  if (F.wing === 'swan') {
    const wz = zOf(0.05) + 0.1, wy = 1.2;
    p.add('carbon', xf(new THREE.BoxGeometry(1.9, 0.045, 0.42), 0, wy, wz, -0.12));
    for (const sx of [-1, 1]) {
      p.box('carbon', 0.03, 0.3, 0.52, sx * 0.95, wy - 0.06, wz);
      p.box('carbon', 0.05, 0.3, 0.1, sx * 0.35, wy - 0.13, wz + 0.1, 0.35);
    }
  } else if (F.wing === 'duck') {
    p.add('paint', xf(new THREE.BoxGeometry(1.55, 0.07, 0.32), 0, topY(0.03) + 0.03, zOf(0.03) + 0.1, -0.28));
  } else if (F.wing === 'lip') {
    p.add('trim', xf(new THREE.BoxGeometry(1.7, 0.05, 0.18), 0, topY(0.02) + 0.03, zOf(0.02) + 0.06, -0.35));
  } else if (F.wing === 'roof' || F.wing === 'rally') {
    const big = F.wing === 'rally';
    const u = cab[0][0] + 0.01;
    const y = cabTop(cab[1][0]) + 0.02;
    p.add('paint', xf(new THREE.BoxGeometry(big ? 1.6 : 1.45, 0.05, big ? 0.4 : 0.3), 0, y, zOf(u) - 0.05, -0.18));
    if (big) for (const sx of [-1, 1]) p.box('paint', 0.03, 0.22, 0.42, sx * 0.8, y - 0.08, zOf(u) - 0.05);
  } else if (F.wing === 'hyper') {
    const wz = zOf(0.03) + 0.25, wy = 1.0;
    p.add('carbon', xf(new THREE.BoxGeometry(2.0, 0.04, 0.38), 0, wy, wz, -0.1));
    for (const sx of [-1, 1]) {
      p.box('carbon', 0.03, 0.36, 0.52, sx * 1.0, wy - 0.12, wz);
      p.box('carbon', 0.05, 0.22, 0.14, sx * 0.48, wy - 0.12, wz + 0.02);
    }
  }
  if (F.fin) {
    const zc = zOf(cab[1][0]), ze = zOf(0.05);
    const sh = new THREE.Shape([new THREE.Vector2(zc, cabTop(cab[1][0]) - 0.02), new THREE.Vector2(ze, 1.0), new THREE.Vector2(ze, 0.78), new THREE.Vector2(zc + 0.3, 0.8)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(0.015, 0, 0);
    p.add('paint', g);
  }

  // hood details
  if (F.hoodVents) {
    const u = 0.8, y = topY(u) + 0.004, s = slope(u);
    for (const sx of [-1, 1]) for (const k of [0, 1]) p.add('trim', xf(new THREE.BoxGeometry(0.3, 0.02, 0.07), sx * 0.3, y + k * s * 0.1 * -1, zOf(u) + k * 0.1, -Math.atan(s)));
  }
  if (F.hoodScoop) {
    const u = 0.8, s = slope(u);
    p.add('paint', xf(new THREE.BoxGeometry(0.62, 0.14, 0.8), 0, topY(u) + 0.04, zOf(u), -Math.atan(s)));
    p.add('trim', xf(new THREE.BoxGeometry(0.5, 0.08, 0.03), 0, topY(u + 0.08) + 0.07, zOf(u) + 0.41, -Math.atan(s)));
  }
  if (F.powerDome) {
    const u = 0.8, s = slope(u);
    p.add('paint', xf(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 0.28, 1), 0, topY(u) - 0.005, zOf(u), -Math.atan(s)));
  }
  if (F.roofScoop) p.box('carbon', 0.28, 0.12, 0.34, 0, cabTop(cab[1][0]) + 0.02, zOf(cab[1][0]) + 0.05);

  // sides
  if (F.sideIntakes) {
    for (const sx of [-1, 1]) p.add('trim', xf(new THREE.BoxGeometry(0.06, 0.22, 0.6), sx * (sideX(0.3, 0.55) - 0.01), 0.55, zOf(0.3), 0, sx * 0.12));
  }
  if (F.chromeStrip) for (const sx of [-1, 1]) p.box('chrome', 0.02, 0.03, L * 0.6, sx * (sideX(0.5, 0.58) + 0.005), 0.58, 0.05);
  if (F.gills) for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) p.add('chrome', xf(new THREE.BoxGeometry(0.02, 0.16, 0.025), sx * (sideX(0.7, 0.6) + 0.005), 0.6, zOf(0.7) - k * 0.07, 0.35));
  if (F.canards) for (const sx of [-1, 1]) for (const k of [0, 1]) p.add('carbon', xf(new THREE.BoxGeometry(0.28, 0.02, 0.15), sx * (hwNose - 0.02), 0.32 + k * 0.1, L / 2 - 0.25, 0, 0, sx * (0.25 + k * 0.1)));
  if (F.mirrors) {
    const u = cab[cab.length - 1][0] - 0.05;
    const [cbw] = interp(cab, u);
    const y = interp(cab, u)[2] + 0.12;
    for (const sx of [-1, 1]) {
      p.box('paint', 0.14, 0.09, 0.14, sx * (cbw + 0.1), y - 0.05, zOf(u));
      p.box('trim', 0.08, 0.03, 0.05, sx * (cbw + 0.03), y - 0.07, zOf(u));
    }
  }
  if (F.bashPlate) p.box('rim', 1.4, 0.04, 0.5, 0, 0.18, L / 2 - 0.35, 0.25);
  if (F.roofRack) {
    const ry = cabTop(cab[2][0]) + 0.06;
    const u0 = cab[1][0], u1 = cab[cab.length - 2][0];
    for (const sx of [-1, 1]) p.box('trim', 0.04, 0.04, zOf(u1) - zOf(u0), sx * 0.55, ry, (zOf(u0) + zOf(u1)) / 2);
    for (const u of [u0 + 0.04, u1 - 0.02]) p.box('trim', 1.14, 0.03, 0.04, 0, ry + 0.02, zOf(u));
    const lz = zOf(u1) - 0.02;
    p.box('trim', 1.2, 0.13, 0.12, 0, ry + 0.1, lz);
    for (let k = 0; k < 4; k++) p.tube('head', 0.05, 0.03, 12, -0.42 + k * 0.28, ry + 0.1, lz + 0.065);
  }
  if (F.mudFlaps) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box('trim', 0.3, 0.28, 0.02, sx * S.track, 0.2 - S.rideY + 0.08, sz * S.wheelBase / 2 - S.wheelR - 0.06);
  }

  // wheels + fender flares
  const wheels = [];
  const wr = S.wheelR;
  const halfBase = S.wheelBase / 2;
  const flareR = wr + (S.rideY > 0.05 ? 0.1 : 0.05);
  const flareDrop = S.rideY > 0.05 ? 0 : 0.06; // sit the arch lower so it blends into low noses
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = makeWheel(wr, S.tyreW, F.wheel, F.caliper, mats);
    w.group.position.set(sx * S.track, wr, sz * halfBase);
    root.add(w.group);
    wheels.push({ ...w, front: sz > 0, side: sx });
    p.add('paint', xf(new THREE.CylinderGeometry(flareR, flareR, S.tyreW + 0.04, 18, 1, true, -0.12, Math.PI + 0.24), sx * (S.track - 0.01), wr - S.rideY - flareDrop, sz * halfBase, 0, 0, Math.PI / 2));
  }

  const meshes = p.build({
    paint, glass: mats.glass, trim: mats.trim, carbon: mats.carbon, chrome: mats.chrome, stripe,
    head: headMat, tail: tailMat, amber: amberMat, rim: mats.rimMats.gunmetal,
  }, body);
  for (const k of ['head', 'tail', 'amber']) if (meshes[k]) meshes[k].castShadow = false;
  if (meshes.paint) meshes.paint.receiveShadow = true;

  // decals: racing numbers, licence plate
  const decals = [];
  if (F.number && number !== null) {
    const m = new THREE.MeshBasicMaterial({ map: numberTexture(number, styleId === 'rally'), transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const sx of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), m);
      d.position.set(sx * (sideX(0.48, 0.62) + 0.008), 0.62, zOf(0.48));
      d.rotation.y = sx * Math.PI / 2;
      body.add(d);
    }
    decals.push(m);
  }
  if (F.plate) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.13), mats.plateMat);
    pl.position.set(0, 0.5, tz - 0.012);
    pl.rotation.y = Math.PI;
    body.add(pl);
  }

  // contact shadow
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, L + 0.8), new THREE.MeshBasicMaterial({ map: mats.shadowTex, transparent: true, depthWrite: false, opacity: 0.75 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  shadow.renderOrder = 1;
  root.add(shadow);

  if (underglow) {
    const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    const ug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, L + 1.4), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(underglow).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ug.rotation.x = -Math.PI / 2;
    ug.position.y = 0.06;
    root.add(ug);
    decals.push(ug.material);
  }

  body.position.y = S.rideY;
  return {
    root, body, wheels, paint, tailMat, headMat, exhausts, shadow,
    length: L, wheelR: wr, halfBase, rideY: S.rideY,
    ownMaterials: [paint, stripe, headMat, tailMat, amberMat, shadow.material, ...decals],
    setBrake(on) { tailMat.color.setHex(0xff1028).multiplyScalar(on ? 7 : 2.5); },
    setGhost(on) { root.visible = on ? (Math.floor(performance.now() / 90) % 2 === 0) : true; },
  };
}

export function disposeCar(car) {
  const keep = new Set([shared.tireGeo, shared.rimGeo]);
  car.root.traverse((o) => { if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose(); });
  for (const m of car.ownMaterials) m.dispose();
}

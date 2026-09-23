// Heightfield terrain that blends smoothly down to the road, plus a spatial index of the track
// for "distance to track" queries used when scattering scenery.
import * as THREE from 'three';
import { addWorldDetail } from './detail.js';

// Value noise + fbm (deterministic)
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 5) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise2(x * f, z * f); f *= 2.02; a *= 0.5; }
  return v;
}

export class TrackIndex {
  constructor(track, cell = 40) {
    this.track = track;
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < track.n; i += 2) {
      const k = this.key(Math.floor(track.x[i] / cell), Math.floor(track.z[i] / cell));
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    }
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  // Nearest distance to the centreline and that sample's height (Infinity if > radius cells away)
  nearest(x, z, radiusCells = 3) {
    const t = this.track;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = Infinity, by = 0, bi = -1;
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      for (let dz = -radiusCells; dz <= radiusCells; dz++) {
        const list = this.map.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
          if (d < best) { best = d; by = t.y[i]; bi = i; }
        }
      }
    }
    return { dist: Math.sqrt(best), y: by, idx: bi };
  }
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function makeHeightFn(index, natural, { hw, near = -1.4, blendStart = 14, blendEnd = 90 }) {
  return (x, z) => {
    const n = index.nearest(x, z, 3);
    const nat = natural(x, z);
    if (!isFinite(n.dist)) return nat;
    const k = smooth(hw + blendStart, hw + blendEnd, n.dist);
    return (n.y + near) * (1 - k) + nat * k;
  };
}

export function buildTerrain({ size, res, center = [0, 0], heightAt, colorAt, material }) {
  const g = new THREE.PlaneGeometry(size, size, res, res);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + center[0], z = pos.getZ(i) + center[1];
    const h = heightAt(x, z);
    pos.setXYZ(i, x, h, z);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    colorAt(col, pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getY(i));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = material || addWorldDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), { fine: [0.32, 0.42], macro: [0.012, 0.35], rough: 0.1, triplanar: true });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// Distant mountain ring for backdrops.
export function mountainRing({ inner = 1400, outer = 3200, segs = 160, rings = 10, peak = 500, snowLine = 260, rock = 0x6d6a70, snow = 0xf4f7ff, grass = 0x4a6a3a, seed = 0, baseY = -20 }) {
  const pos = [], colors = [], idx = [];
  const c = new THREE.Color(), cr = new THREE.Color(rock), cs = new THREE.Color(snow), cg = new THREE.Color(grass);
  for (let r = 0; r <= rings; r++) {
    const rad = inner + (outer - inner) * (r / rings);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const ridge = Math.sin((r / rings) * Math.PI);
      const n = fbm(x * 0.0022 + seed, z * 0.0022 - seed, 5);
      const h = baseY + ridge * (Math.pow(n, 1.6) * peak * 1.6 + 30);
      pos.push(x, h, z);
      if (h > snowLine + (n - 0.5) * 80) c.copy(cs);
      else if (h > snowLine * 0.45) c.copy(cr);
      else c.copy(cg).lerp(cr, h / (snowLine * 0.45));
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s, b = r * segs + ((s + 1) % segs), c2 = (r + 1) * segs + s, d = (r + 1) * segs + ((s + 1) % segs);
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure normals face up
  const nrm = g.attributes.normal;
  let sum = 0;
  for (let i = 0; i < nrm.count; i++) sum += nrm.getY(i);
  if (sum < 0) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; }
    g.computeVertexNormals();
  }
  return new THREE.Mesh(g, addWorldDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), { fine: [0.03, 0.35], macro: [0.004, 0.3], rough: 0, triplanar: true }));
}

// SCORCHED CANYON: desert highway through red mesas, cacti, power lines and blowing dust.
import * as THREE from 'three';
import { LAYOUTS } from './layouts.js';
import { fbm, noise2, makeHeightFn, buildTerrain, mountainRing } from '../terrain.js';
import { rng, colored, merge, instanced, scatter } from '../scenery.js';

function natural(x, z) {
  const dunes = Math.sin(x * 0.011 + Math.sin(z * 0.004) * 2) * 3 + fbm(x * 0.004, z * 0.004, 4) * 28;
  const r = Math.hypot(x, z);
  const edge = Math.pow(Math.max(0, (r - 900) / 600), 1.4) * 160;
  return dunes - 8 + edge;
}

// Banded sandstone butte: jittered cylinder with flat top, coloured in strata.
function mesaGeometry(seed) {
  const g = new THREE.CylinderGeometry(1, 1.22, 1, 11, 8);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + (noise2(Math.cos(a) * 2 + seed, y * 3 + Math.sin(a) * 2) - 0.5) * 0.35;
    if (Math.hypot(x, z) > 0.05) { p.setX(i, x * k); p.setZ(i, z * k); }
  }
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  const pos = ng.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const bands = [0xb4532e, 0xc86a3a, 0x9a4428, 0xd88a52, 0xa84a2c, 0xe0a070].map((h) => new THREE.Color(h));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    c.copy(bands[Math.floor(y * 7 + seed) % bands.length]);
    if (y > 0.98) c.setHex(0xc89060);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function cactusGeometry() {
  const green = 0x3d6b3a, tip = 0x5f8f4a;
  const parts = [colored(new THREE.CylinderGeometry(0.32, 0.38, 6, 8).translate(0, 3, 0), green, tip)];
  for (const [sx, h, y] of [[1, 2.2, 2.6], [-1, 1.6, 3.4]]) {
    parts.push(colored(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 7).rotateZ(Math.PI / 2).translate(sx * 0.8, y, 0), green));
    parts.push(colored(new THREE.CylinderGeometry(0.22, 0.24, h, 7).translate(sx * 1.3, y + h / 2, 0), green, tip));
  }
  return merge(parts);
}

export default {
  id: 'canyon',
  name: 'SCORCHED CANYON',
  tagline: 'Desert highway through the red mesas',
  weatherLabel: 'DUST STORM',
  layout: LAYOUTS.canyon,
  exposure: 0.98,
  envIntensity: 1.0,
  bloom: { strength: 0.32, radius: 0.5, threshold: 1.05 },
  fog: { color: 0xd4a878, density: 0.00085 },
  sky: {
    top: 0x3a74c0, horizon: 0xecc294, bottom: 0xc8a070,
    sunDir: new THREE.Vector3(-0.35, 0.72, 0.42), sunColor: 0xfff0d0, sunSize: 0.0014, sunIntensity: 8, glow: 0.45,
    clouds: 0.18, cloudColor: 0xfff4e4, horizonSharp: 0.55,
  },
  sun: { color: 0xfff0d6, intensity: 3.8 },
  hemi: { sky: 0xa8c8f0, ground: 0xb07848, intensity: 1.0 },
  smoke: [0.86, 0.7, 0.5],
  weather: { type: 'dust', count: 1400, wind: [9, 3], color: 0xd8b080, spray: [0.85, 0.68, 0.46] },
  trackStyle: {
    road: { base: '#56504a', line: '#f2c21a', edge: '#e8e2d4', lanes: 2, roughness: 0.92, dust: true, cracks: 2.4, patches: 3, wear: 0.6, aggregate: 1.25, oil: 1, seed: 66 }, // baked and cracked
    kerb: null,
    barrier: { type: 'guardrail', color: 0x9a8f84, postColor: 0x6a5a48 },
    embankment: 0xc89060,
    shoulder: 0xb88a5a,
    accent: '#ff8a00',
  },

  build({ scene, track, index, density, envScene }) {
    const rand = rng(313);
    const hw = track.halfWidth;
    const heightAt = makeHeightFn(index, natural, { hw, near: -1.2, blendStart: 12, blendEnd: 90 });

    const sand = new THREE.Color(0xdcaa6c), sand2 = new THREE.Color(0xc4834a), rock = new THREE.Color(0xa0522d);
    scene.add(buildTerrain({
      size: 3000, res: 220, center: [0, 0], heightAt,
      colorAt: (c, x, y, z, ny) => {
        c.copy(sand).lerp(sand2, fbm(x * 0.006, z * 0.006, 3));
        if (ny < 0.8) c.lerp(rock, Math.min(1, (0.8 - ny) * 4));
      },
    }));
    scene.add(mountainRing({ inner: 1500, outer: 3800, peak: 420, snowLine: 9999, rock: 0xa4583a, grass: 0xc8844e, seed: 8, baseY: -10 }));

    // mesas and spires, well away from the road
    const mesaGeos = [mesaGeometry(1), mesaGeometry(4), mesaGeometry(9)];
    const mesaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const buckets = [[], [], []];
    scatter(Math.round(60 * density) + 12, rand, [-1500, 1500, -1500, 1500], (x, z) => {
      const d = index.nearest(x, z, 4).dist;
      const spire = rand() < 0.3;
      const w = spire ? 8 + rand() * 10 : 40 + rand() * 90;
      if (d < hw + 30 + w * 1.3) return null;
      const t = { x, y: heightAt(x, z) - 4, z, ry: rand() * 6.28, sx: w, sz: w * (0.7 + rand() * 0.6), sy: spire ? 50 + rand() * 60 : 35 + rand() * 110 };
      buckets[Math.floor(rand() * 3)].push(t);
      return t;
    });
    buckets.forEach((b, i) => { if (b.length) scene.add(instanced(mesaGeos[i], mesaMat, b, { receive: true })); });

    // cacti and dry scrub
    const cacti = scatter(Math.round(320 * density), rand, [-1100, 1100, -1100, 1100], (x, z) => {
      const d = index.nearest(x, z, 3).dist;
      if (d < hw + 6 || d > hw + 180) return null;
      const s = 0.7 + rand() * 0.7;
      return { x, y: heightAt(x, z) - 0.2, z, ry: rand() * 6.28, s };
    });
    scene.add(instanced(cactusGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), cacti));
    const scrub = scatter(Math.round(500 * density), rand, [-1100, 1100, -1100, 1100], (x, z) => {
      if (index.nearest(x, z, 2).dist < hw + 5) return null;
      const s = 0.6 + rand() * 1.4;
      return { x, y: heightAt(x, z), z, ry: rand() * 6.28, sx: s * 1.4, sy: s * 0.6, sz: s * 1.4 };
    });
    scene.add(instanced(colored(new THREE.IcosahedronGeometry(1, 0), 0x7a6a3a, 0x9a8a50), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), scrub, { cast: false }));

    // wooden power poles with sagging wires along one side
    const poles = [], wire = [];
    let prev = null;
    for (let s = 0; s < track.length; s += 55) {
      const p = track.pointAt(s, hw + 9);
      const top = { x: p.x, y: p.y + 9, z: p.z };
      poles.push({ x: p.x, y: p.y + 4.5, z: p.z, ry: p.heading });
      if (prev) {
        for (const off of [-1.1, 1.1]) {
          const ox = Math.cos(p.heading) * off, oz = -Math.sin(p.heading) * off;
          for (let k = 0; k < 6; k++) {
            const t0 = k / 6, t1 = (k + 1) / 6;
            const sag = (t) => -Math.sin(t * Math.PI) * 1.2;
            wire.push(prev.x + (top.x - prev.x) * t0 + ox, prev.y + (top.y - prev.y) * t0 + sag(t0) + 0.3, prev.z + (top.z - prev.z) * t0 + oz);
            wire.push(prev.x + (top.x - prev.x) * t1 + ox, prev.y + (top.y - prev.y) * t1 + sag(t1) + 0.3, prev.z + (top.z - prev.z) * t1 + oz);
          }
        }
      }
      prev = top;
    }
    const poleGeo = merge([colored(new THREE.CylinderGeometry(0.16, 0.2, 9, 6), 0x5a4230), colored(new THREE.BoxGeometry(2.8, 0.18, 0.18).translate(0, 4.1, 0), 0x5a4230)]);
    scene.add(instanced(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), poles));
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2420 })));

    // water tower landmark
    const tp = track.pointAt(track.length * 0.35, -(hw + 40));
    const tower = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.45 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 7, 20), metal);
    tank.position.y = 22;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(6.3, 2.4, 20), metal);
    cap.position.y = 26.7;
    tower.add(tank, cap);
    for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 19, 6), metal);
      leg.position.set(lx, 9.5, lz);
      tower.add(leg);
    }
    tower.traverse((o) => { o.castShadow = true; });
    tower.position.set(tp.x, heightAt(tp.x, tp.z) - 0.5, tp.z);
    scene.add(tower);

    const envGround = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb07848 }));
    envGround.position.y = -6;
    envScene.add(envGround);
    return {};
  },
};

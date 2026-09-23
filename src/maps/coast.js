// SUNSET COAST: golden-hour cliffs, palm trees, animated ocean, a lighthouse and sailboats.
import * as THREE from 'three';
import { LAYOUTS } from './layouts.js';
import { fbm, makeHeightFn, buildTerrain, mountainRing } from '../terrain.js';
import { rng, colored, merge, instanced, scatter } from '../scenery.js';
import { waterMaterial } from '../water.js';

const SEA = -1.2;
const shoreX = (z) => 430 + 70 * Math.sin(z * 0.0042 + 0.6) + 30 * Math.sin(z * 0.013);

function natural(x, z) {
  const d = shoreX(z) - x; // + inland
  const inland = 6 + fbm(x * 0.0035 + 3, z * 0.0035) * 80 + Math.max(0, -x - 300) * 0.12;
  if (d < 0) return SEA - 3 + d * 0.06;
  const beach = Math.min(1, d / 50);
  return SEA - 2 + beach * 3 + Math.pow(Math.min(1, d / 260), 1.5) * inland;
}

export function palmGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 9, 7, 8);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 4.5;
    p.setX(i, p.getX(i) + Math.pow(y / 9, 2) * 1.6);
    p.setY(i, y);
  }
  trunk.computeVertexNormals();
  parts.push(colored(trunk, 0x6b4e33, 0x8a6a45));
  for (let k = 0; k < 8; k++) {
    const leaf = new THREE.PlaneGeometry(1.1, 4.6, 1, 5);
    const lp = leaf.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const t = (lp.getY(i) + 2.3) / 4.6; // 0 at base, 1 at tip
      const w = Math.sin(t * Math.PI) * 0.9 + 0.1;
      lp.setX(i, lp.getX(i) * w);
      lp.setZ(i, -t * t * 1.8); // droop
      lp.setY(i, t * 4.6);
    }
    leaf.rotateX(-Math.PI / 2 + 0.35);
    leaf.rotateY((k / 8) * Math.PI * 2);
    leaf.translate(1.6, 9, 0);
    leaf.computeVertexNormals();
    parts.push(colored(leaf, 0x2f5a1c, 0x5f8f2a));
  }
  return merge(parts);
}

function houseGeometries() {
  const walls = colored(new THREE.BoxGeometry(8, 5, 7).translate(0, 2.5, 0), 0xf1e9dc);
  const roof = colored(new THREE.ConeGeometry(6.2, 2.6, 4).rotateY(Math.PI / 4).translate(0, 6.3, 0), 0xb4532e);
  return merge([walls, roof]);
}

export default {
  id: 'coast',
  name: 'SUNSET COAST',
  tagline: 'Golden-hour cliffs above the ocean',
  layout: LAYOUTS.coast,
  exposure: 0.97,
  envIntensity: 1.0,
  bloom: { strength: 0.38, radius: 0.55, threshold: 1.05 },
  fog: { color: 0xc98a66, density: 0.0005 },
  sky: {
    top: 0x28305e, horizon: 0xf09050, bottom: 0x6a4a5a,
    sunDir: new THREE.Vector3(0.82, 0.07, -0.35), sunColor: 0xffb060, sunSize: 0.0016, sunIntensity: 4.5, glow: 0.5,
    clouds: 0.45, cloudColor: 0xff9f7a, horizonSharp: 0.55,
  },
  sun: { color: 0xffb070, intensity: 3.6 },
  hemi: { sky: 0x9fb0ff, ground: 0x6a4030, intensity: 0.9 },
  smoke: [0.85, 0.78, 0.72],
  trackStyle: {
    road: { base: '#3a3a40', line: '#f2f2f2', edge: '#f2f2f2', lanes: 3, roughness: 0.8 },
    kerb: ['#d01818', '#f2f2f2'],
    barrier: { type: 'guardrail', color: 0xd8dde4 },
    embankment: 0x7a6a4a,
    shoulder: 0x5a5046,
    accent: '#ff5a2d',
  },

  build({ scene, track, index, density, envScene, sunDir }) {
    const rand = rng(42);
    const hw = track.halfWidth;
    const heightAt = makeHeightFn(index, natural, { hw, near: -1.2 });

    const sand = new THREE.Color(0xd9bd88), grass = new THREE.Color(0x6f8a3a), dry = new THREE.Color(0xa99a55), rock = new THREE.Color(0x8a7058), wet = new THREE.Color(0x8a7550);
    const terrain = buildTerrain({
      size: 2800, res: 220, center: [60, 0], heightAt,
      colorAt: (c, x, y, z, ny) => {
        if (y < SEA + 0.4) c.copy(wet);
        else if (y < SEA + 2.2) c.copy(sand);
        else {
          c.copy(grass).lerp(dry, fbm(x * 0.01, z * 0.01, 3));
          if (y < SEA + 4) c.lerp(sand, 1 - (y - SEA - 2.2) / 1.8);
        }
        if (ny < 0.82) c.lerp(rock, Math.min(1, (0.82 - ny) * 5));
      },
    });
    scene.add(terrain);

    const ringMat = mountainRing({ inner: 1500, outer: 3400, peak: 380, snowLine: 9999, rock: 0x8a6a5a, grass: 0x5f6a3a, seed: 4, baseY: -30 });
    scene.add(ringMat);

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), waterMaterial({ sunDir, spec: 10 }));
    ocean.position.y = SEA;
    scene.add(ocean);

    // palms along the road and on the beach
    const palms = scatter(Math.round(520 * density), rand, [-900, 900, -900, 900], (x, z) => {
      const n = index.nearest(x, z, 2);
      if (n.dist < hw + 5 || (n.dist > hw + 60 && rand() < 0.75)) return null;
      const y = heightAt(x, z);
      if (y < SEA + 1.2) return null;
      return { x, y: y - 0.2, z, ry: rand() * Math.PI * 2, s: 0.8 + rand() * 0.6, rz: (rand() - 0.5) * 0.15 };
    });
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    scene.add(instanced(palmGeometry(), leafMat, palms));

    // rocks by the shore
    const rocks = scatter(Math.round(160 * density), rand, [0, 900, -900, 900], (x, z) => {
      const d = shoreX(z) - x;
      if (d < -30 || d > 50) return null;
      if (index.nearest(x, z, 2).dist < hw + 6) return null;
      return { x, y: heightAt(x, z) - 0.5, z, rx: rand() * 3, ry: rand() * 3, s: 1.2 + rand() * 4 };
    });
    scene.add(instanced(colored(new THREE.DodecahedronGeometry(1, 0), 0x7d6b5c), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), rocks));

    // villas on the hills
    const villas = scatter(Math.round(70 * density), rand, [-1100, 300, -1000, 1000], (x, z) => {
      const n = index.nearest(x, z, 3);
      if (n.dist < hw + 30) return null;
      const y = heightAt(x, z);
      if (y < SEA + 5) return null;
      return { x, y: y - 0.5, z, ry: rand() * Math.PI, s: 0.8 + rand() * 0.6 };
    });
    scene.add(instanced(houseGeometries(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), villas, { receive: true }));

    // lighthouse on the shore, far enough from the road
    let best = null;
    for (let z = -900; z <= 900; z += 20) {
      const x = shoreX(z) - 18;
      const d = index.nearest(x, z, 4).dist;
      if (d > hw + 60 && d < 260 && (!best || d < best.d)) best = { x, z, d };
    }
    const beams = [];
    if (best) {
      const lh = new THREE.Group();
      const y0 = heightAt(best.x, best.z) - 0.5;
      const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
      const red = new THREE.MeshStandardMaterial({ color: 0xc0282a, roughness: 0.6 });
      for (let i = 0; i < 5; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - i * 0.3, 2.9 - i * 0.3, 5, 16), i % 2 ? red : white);
        seg.position.y = 2.5 + i * 5;
        seg.castShadow = true;
        lh.add(seg);
      }
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c0).multiplyScalar(8) }));
      lamp.position.y = 26.4;
      lh.add(lamp);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 12), red);
      cap.position.y = 28.8;
      lh.add(cap);
      const beamGeo = new THREE.ConeGeometry(5, 120, 24, 1, true).translate(0, -60, 0).rotateZ(Math.PI / 2);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 26.4;
      lh.add(beam);
      beams.push(beam);
      lh.position.set(best.x, y0, best.z);
      scene.add(lh);
    }

    // sailboats
    const boats = [];
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xfff6ea, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.2, 8), hullMat);
      hull.position.y = 0.4;
      b.add(hull);
      const sailShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 11), new THREE.Vector2(4.5, 0)]);
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat);
      sail.rotation.y = Math.PI / 2;
      sail.position.set(0, 1.2, -1.5);
      b.add(sail);
      const z = -1200 + rand() * 2400;
      b.position.set(shoreX(z) + 250 + rand() * 900, SEA, z);
      b.rotation.y = rand() * Math.PI * 2;
      b.userData.ph = rand() * 10;
      boats.push(b);
      scene.add(b);
    }

    // environment: warm ground bounce for reflections
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a2a24 }));
    envGround.position.y = -8;
    envScene.add(envGround);

    return {
      update(dt, time) {
        ocean.material.uniforms.uTime.value = time;
        for (const b of beams) b.rotation.y = time * 0.9;
        for (const b of boats) {
          b.position.y = SEA + Math.sin(time * 0.9 + b.userData.ph) * 0.25;
          b.rotation.z = Math.sin(time * 0.7 + b.userData.ph) * 0.05;
        }
      },
    };
  },
};

// MONSOON JUNGLE: thunderstorm over a rainforest valley, flooded river, temple ruins.
import * as THREE from 'three';
import { LAYOUTS } from './layouts.js';
import { fbm, makeHeightFn, buildTerrain, mountainRing } from '../terrain.js';
import { rng, colored, merge, instanced, scatter } from '../scenery.js';
import { waterMaterial } from '../water.js';
import { palmGeometry } from './coast.js';

const WATER_Y = -2;
const riverZ = (x) => 260 * Math.sin(x * 0.0032 + 0.8) + 60 * Math.sin(x * 0.011);

function natural(x, z) {
  const hills = fbm(x * 0.003 + 2, z * 0.003 - 6, 5) * 90 - 5;
  const r = Math.hypot(x, z);
  const edge = Math.pow(Math.max(0, (r - 700) / 650), 1.5) * 300;
  const dr = Math.abs(z - riverZ(x));
  const channel = Math.min(1, dr / 90);
  return (hills + edge) * (0.25 + 0.75 * channel * channel) - 9 * (1 - channel);
}

function broadleafTree(rand) {
  const parts = [colored(new THREE.CylinderGeometry(0.35, 0.6, 9, 7).translate(0, 4.5, 0), 0x4a3a2a, 0x5a4a34)];
  const greens = [0x1f4a1c, 0x2a5a22, 0x335f26];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rand();
    const r = k === 0 ? 0 : 2.4;
    const blob = new THREE.IcosahedronGeometry(2.6 + rand() * 1.4, 1);
    blob.scale(1, 0.7, 1);
    blob.translate(Math.cos(a) * r, 9.5 + rand() * 2.5, Math.sin(a) * r);
    parts.push(colored(blob, greens[k % 3], 0x4a7a30));
  }
  return merge(parts);
}

function templeGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const w = 34 - i * 5;
    parts.push(colored(new THREE.BoxGeometry(w, 4, w).translate(0, 2 + i * 4, 0), i % 2 ? 0x6f7060 : 0x62645a, 0x4f6a3a));
  }
  parts.push(colored(new THREE.BoxGeometry(6, 5, 6).translate(0, 26.5, 0), 0x55574e));
  parts.push(colored(new THREE.BoxGeometry(4, 24, 3).translate(0, 12, 17), 0x5a5c52));
  return merge(parts);
}

export default {
  id: 'jungle',
  name: 'MONSOON JUNGLE',
  tagline: 'Thunderstorm over the rainforest valley',
  weatherLabel: 'THUNDERSTORM',
  layout: LAYOUTS.jungle,
  exposure: 1.1,
  envIntensity: 0.8,
  bloom: { strength: 0.45, radius: 0.6, threshold: 0.9 },
  fog: { color: 0x3c4640, density: 0.0024 },
  sky: {
    top: 0x161c20, horizon: 0x46524c, bottom: 0x283028,
    sunDir: new THREE.Vector3(0.3, 0.5, -0.4), sunColor: 0x8090a0, sunSize: 0.004, sunIntensity: 0, glow: 0,
    clouds: 1.0, cloudColor: 0x2c3434, horizonSharp: 0.45,
  },
  sun: { color: 0xb0c0cc, intensity: 0.9 },
  hemi: { sky: 0x8a9aa4, ground: 0x2a3a22, intensity: 1.3 },
  smoke: [0.7, 0.74, 0.76],
  headlights: true,
  weather: { type: 'rain', count: 3200, wind: [3, 1], color: 0xa8b8c8, lightning: true, spray: [0.72, 0.76, 0.8] },
  trackStyle: {
    road: { base: '#26282a', line: '#e0e0d8', edge: '#e0e0d8', lanes: 2, roughness: 0.28, wet: true, envIntensity: 1.2 },
    kerb: ['#e0c020', '#1a1a1a'],
    barrier: { type: 'wall', color: 0x5a5c52, height: 0.9, glow: [0xffd23f, 0xffd23f], glowIntensity: 1.2 },
    embankment: 0x3a4a2a,
    shoulder: 0x3a3a30,
    accent: '#3dff8a',
  },

  build({ scene, track, index, density, envScene, sunDir }) {
    const rand = rng(555);
    const hw = track.halfWidth;
    const heightAt = makeHeightFn(index, natural, { hw, near: -1.3, blendStart: 12, blendEnd: 100 });

    const moss = new THREE.Color(0x2f5a24), lush = new THREE.Color(0x44782c), mud = new THREE.Color(0x4a3e2c), rock = new THREE.Color(0x55574c);
    scene.add(buildTerrain({
      size: 3000, res: 230, center: [0, 0], heightAt,
      colorAt: (c, x, y, z, ny) => {
        c.copy(moss).lerp(lush, fbm(x * 0.009, z * 0.009, 3));
        if (y < WATER_Y + 2.5) c.lerp(mud, Math.min(1, (WATER_Y + 2.5 - y) / 2));
        if (ny < 0.75) c.lerp(rock, Math.min(1, (0.75 - ny) * 4));
      },
    }));
    scene.add(mountainRing({ inner: 1450, outer: 3800, peak: 520, snowLine: 9999, rock: 0x3c463a, grass: 0x2a4a24, seed: 31, baseY: 0 }));

    const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), waterMaterial({
      sunDir, deep: 0x1c2a1c, shallow: 0x3a4a32, skyTop: 0x1c2226, skyHorizon: 0x4a5650, sunColor: 0x8090a0, spec: 0, ripple: 1.5, rain: 1,
    }));
    water.position.y = WATER_Y;
    scene.add(water);

    // rainforest
    const treeGeos = [broadleafTree(rand), broadleafTree(rand)];
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    const tb = [[], []];
    scatter(Math.round(1400 * density), rand, [-1250, 1250, -1250, 1250], (x, z) => {
      const d = index.nearest(x, z, 3).dist;
      if (d < hw + 8) return null;
      const y = heightAt(x, z);
      if (y < WATER_Y + 1.5) return null;
      if (d > hw + 90 && rand() < 0.5) return null;
      const s = 0.8 + rand() * 0.7;
      const t = { x, y: y - 0.5, z, ry: rand() * 6.28, s, sy: s * (0.9 + rand() * 0.5) };
      tb[Math.floor(rand() * 2)].push(t);
      return t;
    });
    tb.forEach((b, i) => { if (b.length) scene.add(instanced(treeGeos[i], treeMat, b)); });

    const palms = scatter(Math.round(260 * density), rand, [-1000, 1000, -1000, 1000], (x, z) => {
      const d = index.nearest(x, z, 2).dist;
      if (d < hw + 5 || d > hw + 45) return null;
      const y = heightAt(x, z);
      return y > WATER_Y + 1 ? { x, y: y - 0.2, z, ry: rand() * 6.28, s: 0.7 + rand() * 0.5 } : null;
    });
    scene.add(instanced(palmGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), palms));

    // ferns / undergrowth
    const ferns = scatter(Math.round(900 * density), rand, [-1000, 1000, -1000, 1000], (x, z) => {
      const d = index.nearest(x, z, 2).dist;
      if (d < hw + 3.5 || d > hw + 70) return null;
      const y = heightAt(x, z);
      if (y < WATER_Y + 1) return null;
      const s = 0.6 + rand() * 1.2;
      return { x, y: y, z, ry: rand() * 6.28, sx: s * 1.6, sy: s * 0.8, sz: s * 1.6 };
    });
    scene.add(instanced(colored(new THREE.IcosahedronGeometry(1, 0), 0x2a5a20, 0x4a8a30), treeMat, ferns, { cast: false }));

    // temple ruins
    const temples = scatter(3, rand, [-1000, 1000, -1000, 1000], (x, z) => {
      const d = index.nearest(x, z, 4).dist;
      if (d < hw + 70 || d > 400) return null;
      const y = heightAt(x, z);
      return y > WATER_Y + 2 ? { x, y: y - 2, z, ry: rand() * 6.28, s: 0.9 + rand() * 0.5 } : null;
    }, 4000);
    scene.add(instanced(templeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), temples, { receive: true }));
    // broken pillars by the road
    const pillars = scatter(Math.round(40 * density) + 6, rand, [-1000, 1000, -1000, 1000], (x, z) => {
      const d = index.nearest(x, z, 2).dist;
      if (d < hw + 5 || d > hw + 25) return null;
      return { x, y: heightAt(x, z) - 0.3, z, ry: rand() * 6.28, sx: 1, sy: 0.4 + rand() * 1.2, sz: 1, rz: (rand() - 0.5) * 0.3 };
    });
    scene.add(instanced(colored(new THREE.CylinderGeometry(0.9, 1.0, 6, 8).translate(0, 3, 0), 0x6a6c60, 0x4a6a3a), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), pillars));

    const envGround = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1e2a1c }));
    envGround.position.y = -6;
    envScene.add(envGround);

    return {
      update(dt, time) { water.material.uniforms.uTime.value = time; },
    };
  },
};

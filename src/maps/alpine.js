// ALPINE PASS: bright mountain day, pine forests, snowy peaks and hot-air balloons.
import * as THREE from 'three';
import { LAYOUTS } from './layouts.js';
import { fbm, makeHeightFn, buildTerrain, mountainRing } from '../terrain.js';
import { rng, colored, merge, instanced, scatter } from '../scenery.js';

function natural(x, z) {
  const r = Math.hypot(x, z);
  const hills = fbm(x * 0.003 + 10, z * 0.003 - 4, 5) * 110 - 20;
  const ridges = Math.pow(1 - Math.abs(fbm(x * 0.0016, z * 0.0016, 4) * 2 - 1), 3) * 140;
  const edge = Math.pow(Math.max(0, (r - 650) / 700), 1.6) * 420;
  return hills + ridges * 0.6 + edge;
}

function pineGeometry() {
  const parts = [colored(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6).translate(0, 1.2, 0), 0x4a3422)];
  const tiers = [[3.2, 4.2, 2.0], [2.5, 3.6, 4.2], [1.7, 3.0, 6.2], [0.9, 2.4, 8.0]];
  for (const [r, h, y] of tiers) {
    parts.push(colored(new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2 - 0.6, 0), 0x1d3a22, 0x3a6a3a));
  }
  return merge(parts);
}

function balloon(color, rand) {
  const g = new THREE.Group();
  const env = new THREE.Mesh(new THREE.SphereGeometry(8, 20, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  env.scale.y = 1.2;
  g.add(env);
  const band = new THREE.Mesh(new THREE.SphereGeometry(8.05, 20, 4, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
  band.scale.y = 1.2;
  g.add(band);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 }));
  basket.position.y = -13;
  g.add(basket);
  g.userData.ph = rand() * 10;
  return g;
}

export default {
  id: 'alpine',
  name: 'ALPINE PASS',
  tagline: 'Mountain switchbacks under a clear sky',
  layout: LAYOUTS.alpine,
  exposure: 0.95,
  envIntensity: 1.0,
  bloom: { strength: 0.32, radius: 0.5, threshold: 1.0 },
  fog: { color: 0xbcd2e8, density: 0.00045 },
  sky: {
    top: 0x1f5fcf, horizon: 0xcfe4f7, bottom: 0x8aa0b0,
    sunDir: new THREE.Vector3(0.45, 0.62, 0.35), sunColor: 0xfff4de, sunSize: 0.0012, sunIntensity: 14, glow: 0.7,
    clouds: 0.75, cloudColor: 0xffffff, horizonSharp: 0.6,
  },
  sun: { color: 0xfff1dc, intensity: 3.4 },
  hemi: { sky: 0xb8d4ff, ground: 0x4a5a3a, intensity: 1.0 },
  smoke: [0.9, 0.9, 0.92],
  trackStyle: {
    road: { base: '#35363c', line: '#f5c400', edge: '#f2f2f2', lanes: 2, roughness: 0.85, dash: false },
    kerb: null,
    barrier: { type: 'guardrail', color: 0xc8ccd2, glow: [0xff8a00, 0xff8a00], glowIntensity: 1.4 },
    embankment: 0x4f6a36,
    shoulder: 0x55524a,
    accent: '#2d8cff',
  },

  build({ scene, track, index, density, envScene }) {
    const rand = rng(99);
    const hw = track.halfWidth;
    const heightAt = makeHeightFn(index, natural, { hw, near: -1.3, blendStart: 12, blendEnd: 110 });

    const grass = new THREE.Color(0x4f7a34), meadow = new THREE.Color(0x7a9a3e), rock = new THREE.Color(0x7a746c), snow = new THREE.Color(0xf2f5fa), dirt = new THREE.Color(0x6a5a40);
    const terrain = buildTerrain({
      size: 3000, res: 230, center: [0, 0], heightAt,
      colorAt: (c, x, y, z, ny) => {
        c.copy(grass).lerp(meadow, fbm(x * 0.008, z * 0.008, 3));
        if (ny < 0.85) c.lerp(dirt, Math.min(1, (0.85 - ny) * 4));
        if (ny < 0.72) c.lerp(rock, Math.min(1, (0.72 - ny) * 5));
        const snowLine = 170 + (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 60;
        if (y > snowLine) c.lerp(snow, Math.min(1, (y - snowLine) / 25) * (ny > 0.6 ? 1 : 0.5));
      },
    });
    scene.add(terrain);
    scene.add(mountainRing({ inner: 1450, outer: 3900, peak: 800, snowLine: 320, rock: 0x6d6a72, grass: 0x40603a, seed: 12, baseY: 40 }));

    // pine forest
    const pines = scatter(Math.round(2000 * density), rand, [-1300, 1300, -1300, 1300], (x, z) => {
      const n = index.nearest(x, z, 3);
      if (n.dist < hw + 7) return null;
      const y = heightAt(x, z);
      if (y > 175) return null;
      // forest clumping
      if (fbm(x * 0.006 + 50, z * 0.006, 3) < 0.45) return null;
      const s = 0.8 + rand() * 0.9;
      return { x, y: y - 0.3, z, ry: rand() * 6.28, s, sy: s * (0.85 + rand() * 0.4) };
    });
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    scene.add(instanced(pineGeometry(), pineMat, pines));

    // boulders
    const rocks = scatter(Math.round(220 * density), rand, [-1300, 1300, -1300, 1300], (x, z) => {
      if (index.nearest(x, z, 2).dist < hw + 6) return null;
      return { x, y: heightAt(x, z) - 0.6, z, rx: rand() * 3, ry: rand() * 3, s: 1 + rand() * 3.5 };
    });
    scene.add(instanced(colored(new THREE.DodecahedronGeometry(1, 0), 0x8a857c), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), rocks));

    // chalets
    const chaletGeo = merge([
      colored(new THREE.BoxGeometry(9, 5, 7).translate(0, 2.5, 0), 0x7a5234),
      colored(new THREE.CylinderGeometry(0.01, 6.5, 3.6, 4, 1).rotateY(Math.PI / 4).scale(1.25, 1, 1).translate(0, 6.8, 0), 0x3a2a24),
    ]);
    const chalets = scatter(Math.round(30 * density), rand, [-900, 900, -900, 900], (x, z) => {
      const d = index.nearest(x, z, 3).dist;
      if (d < hw + 25 || d > hw + 140) return null;
      const y = heightAt(x, z);
      return y < 150 ? { x, y: y - 0.4, z, ry: rand() * 6.28 } : null;
    });
    scene.add(instanced(chaletGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), chalets, { receive: true }));

    // hot-air balloons
    const balloons = [];
    const cols = [0xff3b3b, 0xffb000, 0x2d8cff, 0x2ee86a, 0xb04dff];
    for (let i = 0; i < 6; i++) {
      const b = balloon(cols[i % cols.length], rand);
      const a = rand() * Math.PI * 2, r = 250 + rand() * 600;
      b.position.set(Math.cos(a) * r, 160 + rand() * 120, Math.sin(a) * r);
      b.userData.base = b.position.y;
      balloons.push(b);
      scene.add(b);
    }

    // env: green ground so car paint reflects a landscape
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a5230 }));
    envGround.position.y = -6;
    envScene.add(envGround);

    return {
      update(dt, time) {
        for (const b of balloons) {
          b.position.y = b.userData.base + Math.sin(time * 0.2 + b.userData.ph) * 6;
          b.rotation.y += dt * 0.05;
        }
      },
    };
  },
};

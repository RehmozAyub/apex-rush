// WHITEOUT SUMMIT: snowfall at dusk, snowy peaks, frosted pines, frozen lake, warm road lamps.
import * as THREE from 'three';
import { LAYOUTS } from './layouts.js';
import { fbm, makeHeightFn, buildTerrain, mountainRing } from '../terrain.js';
import { rng, colored, merge, instanced, scatter } from '../scenery.js';
import { radialTexture } from '../textures.js';

const LAKE_Y = 8;

function natural(x, z) {
  const r = Math.hypot(x, z);
  const hills = fbm(x * 0.0028 - 7, z * 0.0028 + 3, 5) * 120 - 10;
  const ridges = Math.pow(1 - Math.abs(fbm(x * 0.0017 + 5, z * 0.0017, 4) * 2 - 1), 3) * 160;
  const edge = Math.pow(Math.max(0, (r - 620) / 650), 1.5) * 460;
  const basin = -90 * Math.exp(-(x * x + z * z) / (190 * 190));
  return hills + ridges * 0.55 + edge + basin;
}

function snowPine() {
  const parts = [colored(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6).translate(0, 1.2, 0), 0x3a2a1c)];
  const tiers = [[3.2, 4.2, 2.0], [2.5, 3.6, 4.2], [1.7, 3.0, 6.2], [0.9, 2.4, 8.0]];
  for (const [r, h, y] of tiers) parts.push(colored(new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2 - 0.6, 0), 0x1a3326, 0xeef3f8));
  return merge(parts);
}

export default {
  id: 'snow',
  name: 'WHITEOUT SUMMIT',
  tagline: 'Blizzard over the high pass at dusk',
  weatherLabel: 'SNOWFALL',
  layout: LAYOUTS.snow,
  exposure: 1.0,
  envIntensity: 0.9,
  bloom: { strength: 0.45, radius: 0.6, threshold: 0.95 },
  fog: { color: 0xaeb8c8, density: 0.0021 },
  sky: {
    top: 0x4a566c, horizon: 0xaab4c4, bottom: 0xc8d0da,
    sunDir: new THREE.Vector3(-0.5, 0.18, -0.6), sunColor: 0xffc890, sunSize: 0.006, sunIntensity: 1.2, glow: 0.35,
    clouds: 1.0, cloudColor: 0xb8c0cc, horizonSharp: 0.5,
  },
  sun: { color: 0xffd8b0, intensity: 1.3 },
  hemi: { sky: 0xd8e2f0, ground: 0x8a94a4, intensity: 1.5 },
  smoke: [0.96, 0.97, 1.0],
  weather: { type: 'snow', count: 6000, wind: [2.5, 0.8], color: 0xffffff, spray: [0.97, 0.98, 1.0] },
  trackStyle: {
    road: { base: '#3e4148', line: '#dfe3ea', edge: '#dfe3ea', lanes: 2, roughness: 0.6, snowEdges: true, wet: true, envIntensity: 1.0, cracks: 1.2, seed: 55 }, // slushy
    kerb: null,
    barrier: { type: 'guardrail', color: 0xb8bec8, glow: [0xff3a1a, 0xff3a1a], glowIntensity: 1.6 },
    embankment: 0xe6ebf2,
    shoulder: 0xd8dee8,
    accent: '#7ac8ff',
  },

  build({ scene, track, index, density, envScene, sunDir }) {
    const rand = rng(77);
    const hw = track.halfWidth;
    const heightAt = makeHeightFn(index, natural, { hw, near: -1.3, blendStart: 12, blendEnd: 110 });

    const snow = new THREE.Color(0xeef2f8), shade = new THREE.Color(0xc4cedc), rock = new THREE.Color(0x4e5058), ice = new THREE.Color(0xa8c4dc);
    scene.add(buildTerrain({
      size: 3000, res: 230, center: [0, 0], heightAt,
      colorAt: (c, x, y, z, ny) => {
        c.copy(snow).lerp(shade, fbm(x * 0.01, z * 0.01, 3) * 0.6);
        if (ny < 0.72) c.lerp(rock, Math.min(1, (0.72 - ny) * 4.5));
        if (y < LAKE_Y + 1.5) c.lerp(ice, 0.5);
      },
    }));
    scene.add(mountainRing({ inner: 1450, outer: 3900, peak: 850, snowLine: 60, rock: 0x5a5c66, snow: 0xf0f4fa, grass: 0xdfe6ee, seed: 21, baseY: 60 }));

    // frozen lake in the basin inside the loop
    const lake = new THREE.Mesh(new THREE.CircleGeometry(420, 64).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xbfd6ea, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }));
    lake.position.y = LAKE_Y;
    lake.receiveShadow = true;
    scene.add(lake);

    // frosted pine forest
    const pines = scatter(Math.round(1800 * density), rand, [-1300, 1300, -1300, 1300], (x, z) => {
      const n = index.nearest(x, z, 3);
      if (n.dist < hw + 7) return null;
      const y = heightAt(x, z);
      if (y < LAKE_Y + 2 || y > 210) return null;
      if (fbm(x * 0.006 + 30, z * 0.006, 3) < 0.42) return null;
      const s = 0.8 + rand() * 0.9;
      return { x, y: y - 0.3, z, ry: rand() * 6.28, s, sy: s * (0.85 + rand() * 0.4) };
    });
    scene.add(instanced(snowPine(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }), pines));

    // snow-capped boulders
    const rocks = scatter(Math.round(200 * density), rand, [-1300, 1300, -1300, 1300], (x, z) => {
      if (index.nearest(x, z, 2).dist < hw + 6) return null;
      return { x, y: heightAt(x, z) - 0.6, z, rx: rand() * 3, ry: rand() * 3, s: 1 + rand() * 3.5 };
    });
    scene.add(instanced(colored(new THREE.DodecahedronGeometry(1, 0), 0x5a5c64, 0xf0f4fa), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), rocks));

    // orange snow poles along both edges + warm sodium lamps
    const poles = [], lamps = [], heads = [], pools = [];
    for (let s = 0; s < track.length; s += 22) {
      for (const side of [-1, 1]) {
        const p = track.pointAt(s, side * (hw + 1.6));
        poles.push({ x: p.x, y: p.y + 0.9, z: p.z });
      }
    }
    for (let s = 30, side = 1; s < track.length; s += 70, side = -side) {
      const p = track.pointAt(s, side * (hw + 2.4));
      lamps.push({ x: p.x, y: p.y + 4.5, z: p.z });
      const a = track.pointAt(s, side * (hw - 0.4));
      heads.push({ x: a.x, y: p.y + 8.8, z: a.z, ry: p.heading });
      const b = track.pointAt(s, side * (hw - 2.5));
      pools.push({ x: b.x, y: b.y + 0.07, z: b.z, ry: p.heading });
    }
    const poleGeo = merge([colored(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 5), 0xff5a10), colored(new THREE.CylinderGeometry(0.052, 0.052, 0.3, 5).translate(0, 0.55, 0), 0x111111)]);
    scene.add(instanced(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), poles, { cast: false }));
    scene.add(instanced(new THREE.CylinderGeometry(0.15, 0.22, 9, 8), new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.7, roughness: 0.5 }), lamps));
    scene.add(instanced(new THREE.BoxGeometry(4.8, 0.25, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa850).multiplyScalar(6) }), heads, { cast: false }));
    const pool = instanced(new THREE.PlaneGeometry(16, 22).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,170,90,0.5)', 'rgba(255,150,80,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), pools, { cast: false });
    pool.renderOrder = 1;
    scene.add(pool);

    // cabins with glowing windows
    const cabinGeo = merge([
      colored(new THREE.BoxGeometry(9, 5, 7).translate(0, 2.5, 0), 0x6a4630),
      colored(new THREE.CylinderGeometry(0.01, 6.5, 3.6, 4, 1).rotateY(Math.PI / 4).scale(1.25, 1, 1).translate(0, 6.8, 0), 0xf2f5fa),
    ]);
    const cabins = scatter(Math.round(26 * density) + 4, rand, [-900, 900, -900, 900], (x, z) => {
      const d = index.nearest(x, z, 3).dist;
      if (d < hw + 25 || d > hw + 150) return null;
      const y = heightAt(x, z);
      return y > LAKE_Y + 3 && y < 170 ? { x, y: y - 0.4, z, ry: rand() * 6.28 } : null;
    });
    scene.add(instanced(cabinGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), cabins, { receive: true }));
    const win = [];
    for (const c of cabins) for (const k of [-1, 1]) {
      win.push({ x: c.x + Math.cos(c.ry) * 2.2 * k + Math.sin(c.ry) * 3.52, y: c.y + 2.6, z: c.z - Math.sin(c.ry) * 2.2 * k + Math.cos(c.ry) * 3.52, ry: c.ry });
    }
    scene.add(instanced(new THREE.BoxGeometry(1.6, 1.3, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(3) }), win, { cast: false }));

    const envGround = new THREE.Mesh(new THREE.CircleGeometry(300, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc8d0dc }));
    envGround.position.y = -6;
    envScene.add(envGround);
    return {};
  },
};

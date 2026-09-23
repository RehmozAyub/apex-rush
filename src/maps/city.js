// NEON CITY: night streets, glowing towers, neon signs and arches, wet reflective asphalt.
import * as THREE from 'three';
import { LAYOUTS } from './layouts.js';
import { rng, instanced } from '../scenery.js';
import { addWorldDetail } from '../detail.js';
import { windowTextures, neonSignTexture, radialTexture } from '../textures.js';

const NEON = [0xff2d95, 0x19e3ff, 0xffd23f, 0x8a3cff, 0x3dff8a, 0xff6a2d];
const SIGNS = ['NEON', 'HOTEL', 'RAMEN', 'CLUB 88', 'ARCADE', 'TURBO', 'NITRO', 'KARAOKE', 'APEX', 'DINER', 'OPEN 24H', 'SUSHI'];

// Box with UVs scaled so a window tile covers 32 m x 64 m regardless of building size.
function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (fw === 0) uv.setXY(i, 0.01, 0.01);
      else uv.setXY(i, uv.getX(i) * (fw / 32), uv.getY(i) * (fh / 64));
    }
  }
  return g;
}

export default {
  id: 'city',
  name: 'NEON CITY',
  tagline: 'Midnight streets. Wet asphalt. Neon everywhere.',
  layout: LAYOUTS.city,
  exposure: 1.1,
  envIntensity: 1.0,
  bloom: { strength: 0.7, radius: 0.6, threshold: 0.9 },
  fog: { color: 0x150c26, density: 0.0016 },
  sky: {
    top: 0x03040c, horizon: 0x3a1548, bottom: 0x0a0812,
    sunDir: new THREE.Vector3(-0.4, 0.45, 0.6), sunColor: 0xcfe0ff, sunSize: 0.0009, sunIntensity: 10, glow: 0.25,
    stars: 1, horizonSharp: 0.35,
  },
  sun: { color: 0x8fa8ff, intensity: 0.9 },
  hemi: { sky: 0x6a5ab0, ground: 0x3a2040, intensity: 1.3 },
  smoke: [0.55, 0.5, 0.65],
  underglow: true,
  headlights: true,
  trackStyle: {
    road: { base: '#222228', line: '#d8d8e0', edge: '#e0c040', lanes: 3, roughness: 0.55, metalness: 0.05, wet: true, envIntensity: 1.15, wear: 1.3, oil: 6, patches: 3, seed: 33 }, // wet, worn city streets
    kerb: null,
    barrier: { type: 'wall', color: 0x5a5c66, height: 1.05, glow: [0xff2d95, 0x19e3ff], glowIntensity: 3 },
    embankment: null,
    shoulder: 0x2a2a30,
    accent: '#19e3ff',
  },

  build({ scene, track, index, density, envScene }) {
    const rand = rng(7);
    const hw = track.halfWidth;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), addWorldDetail(new THREE.MeshStandardMaterial({ color: 0x121218, roughness: 0.55, metalness: 0.3 }), { fine: [0.5, 0.5], macro: [0.02, 0.4], rough: 0.3 }));
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    scene.add(ground);

    // towers
    const warm = windowTextures({ lit: ['#ffcf8a', '#ffe2b8', '#ffffff'], litChance: 0.4, seedValue: 3 });
    const cool = windowTextures({ lit: ['#8fd8ff', '#c8a8ff', '#ffffff'], litChance: 0.35, wall: '#141824', seedValue: 9 });
    const mats = [warm, cool].map((t) => new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.5,
    }));
    const protos = [[30, 70, 30], [40, 120, 34], [24, 46, 24], [52, 36, 44], [22, 170, 22], [36, 90, 60]];
    const buckets = protos.map(() => [[], []]);
    const tops = [];
    const signSpots = [];
    const cell = 64;
    for (let gx = -1500; gx <= 1500; gx += cell) {
      for (let gz = -1300; gz <= 1300; gz += cell) {
        if (rand() < 0.12) continue;
        const pi = Math.floor(rand() * protos.length);
        const [w, h, d] = protos[pi];
        const x = gx + (rand() - 0.5) * 14, z = gz + (rand() - 0.5) * 14;
        const n = index.nearest(x, z, 3);
        const foot = Math.hypot(w, d) / 2;
        if (n.dist < hw + 10 + foot) continue;
        const centre = Math.hypot(x, z);
        const hs = (0.6 + rand() * 0.8) * (centre < 700 ? 1.3 : 0.8);
        const ry = (Math.floor(rand() * 4) * Math.PI) / 2;
        buckets[pi][rand() < 0.5 ? 0 : 1].push({ x, y: -0.1, z, ry, sx: 1, sy: hs, sz: 1 });
        if (h * hs > 90) tops.push({ x, y: h * hs + 1, z, s: 1 });
        if (n.dist < hw + 70 + foot && signSpots.length < 70 * density + 10) signSpots.push({ x, z, w, d, h: h * hs, ry, n });
      }
    }
    protos.forEach(([w, h, d], pi) => {
      const geo = buildingGeo(w, h, d);
      for (let m = 0; m < 2; m++) if (buckets[pi][m].length) scene.add(instanced(geo, mats[m], buckets[pi][m], { cast: false, receive: false }));
    });

    // blinking aircraft lights on the tallest towers
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(6) });
    if (tops.length) scene.add(instanced(new THREE.SphereGeometry(0.9, 8, 6), beaconMat, tops, { cast: false }));

    // neon signs on facades facing the track
    const signMeshes = [];
    for (const sp of signSpots) {
      const text = SIGNS[Math.floor(rand() * SIGNS.length)];
      const col = NEON[Math.floor(rand() * NEON.length)];
      const tex = neonSignTexture(text, '#' + new THREE.Color(col).getHexString());
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0xffffff).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const w = 16 + rand() * 10;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.31), mat);
      // face the nearest track point
      const tx = track.x[sp.n.idx], tz = track.z[sp.n.idx];
      const ang = Math.atan2(tx - sp.x, tz - sp.z);
      const r = Math.max(sp.w, sp.d) / 2 + 0.8;
      sign.position.set(sp.x + Math.sin(ang) * r, 12 + rand() * Math.min(30, sp.h - 18), sp.z + Math.cos(ang) * r);
      sign.rotation.y = ang;
      sign.userData.flicker = rand() < 0.2;
      sign.userData.base = 2.2;
      signMeshes.push(sign);
      scene.add(sign);
    }

    // street lights + fake light pools on the wet road
    const poles = [], heads = [], pools = [];
    let side = 1;
    for (let s = 20; s < track.length; s += 38) {
      side = -side;
      const p = track.pointAt(s, side * (hw + 2.2));
      poles.push({ x: p.x, y: 4.5, z: p.z, s: 1 });
      const arm = track.pointAt(s, side * (hw - 0.2));
      heads.push({ x: arm.x, y: 8.8, z: arm.z, ry: p.heading });
      const pool = track.pointAt(s, side * (hw - 2.5));
      pools.push({ x: pool.x, y: 0.05, z: pool.z, ry: p.heading });
    }
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.5, metalness: 0.7 });
    scene.add(instanced(new THREE.CylinderGeometry(0.15, 0.22, 9, 8), poleMat, poles));
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc48a).multiplyScalar(6) });
    scene.add(instanced(new THREE.BoxGeometry(4.8, 0.25, 0.6), headMat, heads, { cast: false }));
    const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,190,120,0.55)', 'rgba(255,160,90,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const poolMesh = instanced(new THREE.PlaneGeometry(16, 22).rotateX(-Math.PI / 2), poolMat, pools, { cast: false });
    poolMesh.renderOrder = 1;
    scene.add(poolMesh);

    // neon arches over the road
    const arches = [];
    for (let k = 0; k < 11; k++) {
      const s = (k + 0.5) * (track.length / 11);
      const p = track.pointAt(s, 0);
      const col = NEON[k % 2 ? 0 : 1];
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(5) });
      const g = new THREE.Group();
      const span = track.width + 3;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.35, 0.35), m);
      beam.position.y = 9;
      g.add(beam);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 9, 0.35), m);
        post.position.set((sx * span) / 2, 4.5, 0);
        g.add(post);
      }
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.heading;
      g.userData.mat = m;
      g.userData.col = new THREE.Color(col);
      arches.push(g);
      scene.add(g);
    }

    // env map: neon blocks around the horizon so paint and wet road reflect colour
    for (let i = 0; i < 18; i++) {
      const a = (i / 26) * Math.PI * 2;
      const col = NEON[i % NEON.length];
      const b = new THREE.Mesh(new THREE.BoxGeometry(18 + rand() * 20, 6 + rand() * 30, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(0.9) }));
      b.position.set(Math.cos(a) * 150, 5 + rand() * 40, Math.sin(a) * 150);
      b.lookAt(0, b.position.y, 0);
      envScene.add(b);
    }
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(30, 60 + rand() * 120, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1a1830).multiplyScalar(1) }));
      b.position.set(Math.cos(a) * 250, 0, Math.sin(a) * 250);
      envScene.add(b);
    }

    return {
      update(dt, time) {
        const blink = Math.sin(time * 3) > 0.6 ? 6 : 0.4;
        beaconMat.color.setRGB(blink, 0.12 * blink, 0.12 * blink);
        for (const s of signMeshes) {
          if (!s.userData.flicker) continue;
          const on = Math.sin(time * 23 + s.id) > -0.7 || Math.sin(time * 1.3 + s.id) > 0;
          s.material.color.setScalar(on ? s.userData.base : 0.3);
        }
        arches.forEach((g, i) => {
          const k = 3.5 + Math.sin(time * 2 + i) * 1.5;
          g.userData.mat.color.copy(g.userData.col).multiplyScalar(k);
        });
      },
    };
  },
};

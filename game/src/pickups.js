// Visuals for road pickups (boost rings, power-up crystals) and power-up effects
// (shockwave ring, ricochet orb, oil slick, lightning bolt).
import * as THREE from 'three';
import { radialTexture } from './textures.js';

// Swirled rainbow rings that fade out at the rim - the sheen on spilled oil.
function oilSheenTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = x / 128 - 1, dy = y / 128 - 1;
      const r = Math.hypot(dx, dy);
      const swirl = r * 9 + Math.sin(dx * 5.3 + dy * 3.1) * 1.4 + Math.sin(dy * 7.7 - dx * 2.2) * 0.8;
      const band = 0.5 + 0.5 * Math.sin(swirl);
      const fade = Math.max(0, 1 - r) * (0.35 + 0.65 * band);
      const o = (y * 256 + x) * 4;
      img.data[o] = 128 + 127 * Math.sin(swirl);
      img.data[o + 1] = 128 + 127 * Math.sin(swirl + 2.1);
      img.data[o + 2] = 128 + 127 * Math.sin(swirl + 4.2);
      img.data[o + 3] = 255 * fade * fade;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const glowTex = () => radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');

export class PickupVisuals {
  constructor(scene, track, items) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const tex = glowTex();
    this.boostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x19e3ff).multiplyScalar(4) });
    this.chevMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3) });
    this.powerMats = [0xff2d95, 0xffd400, 0x8a3cff].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3.5) }));
    this.cageMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.5), transparent: true, opacity: 0.8 });
    this.poolMats = {
      boost: new THREE.MeshBasicMaterial({ map: tex, color: 0x19e3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      power: new THREE.MeshBasicMaterial({ map: tex, color: 0xff2d95, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    const ring = new THREE.TorusGeometry(1.25, 0.09, 8, 36);
    const chev = new THREE.BoxGeometry(0.16, 0.8, 0.12);
    const pool = new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2);
    const crystal = new THREE.OctahedronGeometry(0.9, 0);
    const cage = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.1, 2.1, 2.1));
    this.geos = [ring, chev, pool, crystal, cage];
    this.nodes = new Map();
    for (const it of items) {
      const p = track.pointAt(it.s, it.lateral);
      it.x = p.x; it.z = p.z; it.y = p.y;
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.heading;
      const float = new THREE.Group();
      float.position.y = 1.45;
      g.add(float);
      if (it.kind === 'boost') {
        float.add(new THREE.Mesh(ring, this.boostMat));
        // double "^^" chevron inside the ring, facing the driver
        for (const dy of [-0.28, 0.22]) {
          for (const sx of [-1, 1]) {
            const c = new THREE.Mesh(chev, this.chevMat);
            c.position.set(sx * 0.2, dy, 0);
            c.rotation.z = -sx * 0.75;
            float.add(c);
          }
        }
      } else {
        const cr = new THREE.Mesh(crystal, this.powerMats[it.id % 3]);
        float.add(cr);
        float.add(new THREE.LineSegments(cage, this.cageMat));
        float.userData.spin = cr;
      }
      const pl = new THREE.Mesh(pool, this.poolMats[it.kind]);
      pl.position.y = 0.06;
      pl.renderOrder = 1;
      g.add(pl);
      g.userData = { float, grow: 1 };
      this.group.add(g);
      this.nodes.set(it.id, g);
    }

    // effect meshes
    this.shockMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x19e3ff).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2), this.shockMat);
    this.shock.visible = false;
    scene.add(this.shock);
    this.shockT = -1;
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4c0).multiplyScalar(8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bolt = new THREE.Group();
    scene.add(this.bolt);
    this.boltT = -1;
    this.boltGeo = new THREE.BoxGeometry(0.25, 1, 0.25);
    // ricochet orb
    this.shotMats = [
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb040).multiplyScalar(7) }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a00).multiplyScalar(3), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(4) }),
    ];
    this.shot = new THREE.Group();
    this.shot.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 2), this.shotMats[0]));
    this.shot.add(new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 14), this.shotMats[1]));
    this.shotRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 32), this.shotMats[2]);
    this.shot.add(this.shotRing);
    this.shot.visible = false;
    scene.add(this.shot);

    // oil slicks: near-black puddle with a painted rainbow sheen (a glossy material would just
    // mirror the sky at racing-camera angles)
    this.oilMat = new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.5, metalness: 0, envMapIntensity: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.oilEdgeMat = new THREE.MeshBasicMaterial({ map: oilSheenTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.oilGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
    this.slicks = new Map();
  }

  showShot(x, y, z, time) {
    this.shot.visible = true;
    this.shot.position.set(x, y, z);
    this.shotRing.rotation.set(time * 9, time * 6, 0);
    const k = 1 + Math.sin(time * 30) * 0.12;
    this.shot.scale.setScalar(k);
  }

  hideShot() { this.shot.visible = false; }

  addSlick(id, x, y, z, heading, halfS, halfLat) {
    const g = new THREE.Group();
    // a few overlapping blobs so it reads as a spill, not a disc
    const blobs = [[0, 0, 1, 1], [0.45, 0.3, 0.55, 0.6], [-0.4, -0.35, 0.6, 0.5], [0.1, -0.55, 0.5, 0.45]];
    for (const [ox, oz, sx, sz] of blobs) {
      const m = new THREE.Mesh(this.oilGeo, this.oilMat);
      m.position.set(ox * halfLat * 0.6, 0.1, oz * halfS * 0.6);
      m.scale.set(halfLat * sx, 1, halfS * sz);
      m.receiveShadow = true;
      g.add(m);
    }
    const edge = new THREE.Mesh(this.oilGeo, this.oilEdgeMat);
    edge.scale.set(halfLat * 1.05, 1, halfS * 1.1);
    edge.position.y = 0.11;
    g.add(edge);
    g.position.set(x, y, z);
    g.rotation.y = heading;
    g.scale.setScalar(0.01);
    g.userData.grow = 0;
    this.scene.add(g);
    this.slicks.set(id, g);
  }

  removeSlick(id) {
    const g = this.slicks.get(id);
    if (g) { this.scene.remove(g); this.slicks.delete(id); }
  }

  setActive(it, on) {
    const g = this.nodes.get(it.id);
    if (!g) return;
    g.visible = on;
    if (on) g.userData.grow = 0;
  }

  shockwave(x, y, z) {
    this.shock.position.set(x, y + 0.4, z);
    this.shock.visible = true;
    this.shockT = 0;
  }

  lightning(from, to) {
    this.bolt.clear();
    const segs = 9;
    let prev = from.clone();
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const p = from.clone().lerp(to, t);
      if (i < segs) { p.x += (Math.random() - 0.5) * 4 * (1 - t); p.z += (Math.random() - 0.5) * 4 * (1 - t); }
      const m = new THREE.Mesh(this.boltGeo, this.boltMat);
      m.position.copy(prev).lerp(p, 0.5);
      m.scale.y = prev.distanceTo(p);
      m.lookAt(p);
      m.rotateX(Math.PI / 2);
      this.bolt.add(m);
      prev = p;
    }
    this.boltT = 0;
    this.bolt.visible = true;
  }

  update(dt, time) {
    for (const g of this.nodes.values()) {
      if (!g.visible) continue;
      const f = g.userData.float;
      f.position.y = 1.45 + Math.sin(time * 2.5 + g.id) * 0.15;
      if (f.userData.spin) { f.rotation.y = time * 1.6; f.userData.spin.rotation.x = time * 2.1; }
      else f.rotation.z = Math.sin(time * 3 + g.id) * 0.08;
      if (g.userData.grow < 1) {
        g.userData.grow = Math.min(1, g.userData.grow + dt * 3);
        const k = 1 - Math.pow(1 - g.userData.grow, 3);
        g.scale.setScalar(k);
      }
    }
    if (this.shockT >= 0) {
      this.shockT += dt;
      const k = Math.min(1, this.shockT / 0.5);
      this.shock.scale.setScalar(1 + k * 20);
      this.shockMat.opacity = 1 - k;
      if (k >= 1) { this.shockT = -1; this.shock.visible = false; }
    }
    if (this.boltT >= 0) {
      this.boltT += dt;
      this.boltMat.opacity = Math.max(0, 1 - this.boltT / 0.45) * (0.6 + Math.random() * 0.4);
      if (this.boltT > 0.45) { this.boltT = -1; this.bolt.visible = false; }
    }
    for (const g of this.slicks.values()) {
      if (g.userData.grow < 1) {
        g.userData.grow = Math.min(1, g.userData.grow + dt * 4);
        g.scale.setScalar(0.3 + 0.7 * (1 - Math.pow(1 - g.userData.grow, 3)));
      }
    }
  }

  dispose() {
    this.scene.remove(this.group, this.shock, this.bolt, this.shot);
    for (const id of [...this.slicks.keys()]) this.removeSlick(id);
    this.shot.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.oilGeo.dispose();
    for (const g of this.geos) g.dispose();
    this.boltGeo.dispose();
    for (const m of [this.boostMat, this.chevMat, ...this.powerMats, this.cageMat, this.poolMats.boost, this.poolMats.power, this.shockMat, this.boltMat, ...this.shotMats, this.oilMat, this.oilEdgeMat]) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    this.shock.geometry.dispose();
  }
}

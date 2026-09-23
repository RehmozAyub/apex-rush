// Visuals for road pickups (boost rings, power-up crystals) and power-up effects
// (shockwave ring, ram shield, lightning bolt).
import * as THREE from 'three';
import { radialTexture } from './textures.js';

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
    this.shieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a00).multiplyScalar(1.4), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.shieldMat);
    this.shield.scale.set(1.6, 1.0, 3.0);
    this.shield.visible = false;
  }

  attachShield(root) { root.add(this.shield); this.shield.position.y = 0.7; }

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

  update(dt, time, ramActive) {
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
    this.shield.visible = ramActive;
    if (ramActive) this.shieldMat.opacity = 0.18 + Math.sin(time * 14) * 0.07;
  }

  dispose() {
    this.scene.remove(this.group, this.shock, this.bolt);
    this.shield.parent?.remove(this.shield);
    for (const g of this.geos) g.dispose();
    this.boltGeo.dispose();
    for (const m of [this.boostMat, this.chevMat, ...this.powerMats, this.cageMat, this.poolMats.boost, this.poolMats.power, this.shockMat, this.boltMat, this.shieldMat]) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    this.shock.geometry.dispose();
    this.shield.geometry.dispose();
  }
}

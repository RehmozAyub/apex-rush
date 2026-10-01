// Breakable wooden fences across the entrance of hidden shortcuts. A car driving through smashes
// the planks into tumbling debris; the fence is rebuilt once nobody is near.
import * as THREE from 'three';

const PLANK = new THREE.BoxGeometry(1, 0.22, 0.07);
const POST = new THREE.BoxGeometry(0.16, 1.4, 0.16);

export class FenceProps {
  constructor(scene, shortcuts) {
    this.scene = scene;
    this.mat = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9 });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 });
    this.fences = shortcuts.filter((sc) => sc.fence).map((sc) => this.build(sc));
  }

  build(sc) {
    const path = sc.path, shw = path.halfWidth;
    const p = path.pointAt(sc.fenceU, 0);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    // posts at the edges, three rails of planks in between, with a slight sag
    const span = shw * 2 - 0.4;
    for (const x of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(POST, this.dark);
      post.position.set(x, 0.7, 0);
      post.castShadow = true;
      g.add(post);
    }
    const planks = [];
    const segs = 4;
    for (const y of [0.35, 0.75, 1.15]) {
      for (let k = 0; k < segs; k++) {
        const w = span / segs;
        const m = new THREE.Mesh(PLANK, this.mat);
        m.scale.x = w * 0.98;
        m.position.set(-span / 2 + w * (k + 0.5), y - Math.sin(((k + 0.5) / segs) * Math.PI) * 0.04, 0);
        m.rotation.z = (Math.random() - 0.5) * 0.06;
        m.castShadow = true;
        g.add(m);
        planks.push({ m, home: m.position.clone(), homeRot: m.rotation.clone(), v: new THREE.Vector3(), w: new THREE.Vector3() });
      }
    }
    this.scene.add(g);
    return { sc, group: g, planks, broken: false, t: 0, groundY: p.y };
  }

  // car at shortcut position u crossing from prevU: smash the fence. Returns true when it broke.
  hit(sc, prevU, u, vehicle) {
    const f = this.fences.find((x) => x.sc === sc);
    if (!f || f.broken || !(prevU < sc.fenceU && u >= sc.fenceU)) return false;
    f.broken = true;
    f.t = 0;
    const fx = Math.sin(vehicle.heading), fz = Math.cos(vehicle.heading);
    // planks fly in the car's direction (in the fence's local frame: +z is along the road)
    const inv = new THREE.Quaternion().copy(f.group.quaternion).invert();
    const dir = new THREE.Vector3(fx, 0, fz).applyQuaternion(inv);
    const sp = vehicle.speed;
    for (const pl of f.planks) {
      pl.v.set(dir.x * sp * (0.4 + Math.random() * 0.4) + (Math.random() - 0.5) * 4, 3 + Math.random() * 5, dir.z * sp * (0.4 + Math.random() * 0.4));
      pl.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    }
    return true;
  }

  update(dt, cars) {
    for (const f of this.fences) {
      if (!f.broken) continue;
      f.t += dt;
      for (const pl of f.planks) {
        if (pl.m.position.y <= 0.05 && pl.v.y <= 0) { pl.v.multiplyScalar(Math.exp(-6 * dt)); pl.w.multiplyScalar(Math.exp(-6 * dt)); }
        else pl.v.y -= 20 * dt;
        pl.m.position.addScaledVector(pl.v, dt);
        if (pl.m.position.y < 0.05) { pl.m.position.y = 0.05; if (pl.v.y < 0) pl.v.y *= -0.25; }
        pl.m.rotation.x += pl.w.x * dt; pl.m.rotation.y += pl.w.y * dt; pl.m.rotation.z += pl.w.z * dt;
      }
      // rebuilt after a while, when no car is close
      const p = f.group.position;
      const clear = cars.every((c) => (c.vehicle.x - p.x) ** 2 + (c.vehicle.z - p.z) ** 2 > 60 * 60);
      if (f.t > 10 && clear) {
        f.broken = false;
        for (const pl of f.planks) { pl.m.position.copy(pl.home); pl.m.rotation.copy(pl.homeRot); }
      }
    }
  }

  dispose() {
    for (const f of this.fences) this.scene.remove(f.group);
    this.mat.dispose();
    this.dark.dispose();
  }
}

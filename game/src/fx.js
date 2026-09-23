// Particle effects: sparks + exhaust flames (additive), tyre smoke (alpha), wreck debris
// (instanced boxes) and skid marks (ring-buffer ribbons).
import * as THREE from 'three';

class ParticlePool {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.aScale = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = pcolor; vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: additive ? /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a * vAlpha, 1.0);
        }
      ` : /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, { drag = 1, grav = 0, grow = 0, alpha = 1 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.drag[i] = drag; this.grav[i] = grav; this.grow[i] = grow;
    this.alpha[i] = alpha;
    this.aScale[i] = alpha;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      const d = Math.pow(this.drag[i], dt);
      this.vel[o] *= d; this.vel[o + 1] = this.vel[o + 1] * d - this.grav[i] * dt; this.vel[o + 2] *= d;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t * this.aScale[i];
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.pcolor.needsUpdate = true; a.psize.needsUpdate = true; a.palpha.needsUpdate = true;
  }
}

class Debris {
  constructor(max = 220) {
    this.max = max;
    const g = new THREE.BoxGeometry(0.42, 0.1, 0.55);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.6 });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.p = Array.from({ length: max }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, q: new THREE.Quaternion(), w: new THREE.Vector3(), ground: 0, s: 1 }));
    this.cursor = 0;
    this.m4 = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpE = new THREE.Euler();
    this.tmpV = new THREE.Vector3();
    this.tmpP = new THREE.Vector3();
    this.tmpS = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const c = new THREE.Color(0x222222);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, this.zero); this.mesh.setColorAt(i, c); }
  }
  spawn(x, y, z, vx, vy, vz, color, ground) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = this.p[i];
    Object.assign(p, { life: 4 + Math.random() * 2, x, y, z, vx, vy, vz, ground, s: 0.4 + Math.random() * 0.9 });
    p.q.setFromEuler(this.tmpE.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    p.w.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vy -= 22 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.ground + 0.05) {
        p.y = p.ground + 0.05;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.6; p.vz *= 0.6; p.w.multiplyScalar(0.5);
      }
      const wl = p.w.length();
      if (wl > 0.01) {
        this.tmpQ.setFromAxisAngle(this.tmpV.copy(p.w).divideScalar(wl), wl * dt);
        p.q.premultiply(this.tmpQ);
      }
      const sc = p.life < 0.5 ? p.s * (p.life / 0.5) : p.s;
      this.m4.compose(this.tmpP.set(p.x, p.y, p.z), p.q, this.tmpS.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, p.life > 0 ? this.m4 : this.zero);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

class SkidMarks {
  constructor(maxSeg = 2400) {
    this.max = maxSeg;
    this.pos = new Float32Array(maxSeg * 6 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.cursor = 0;
    this.last = new Map();
    this.dirty = false;
  }
  // key identifies one wheel; call every frame with active=true while skidding
  add(key, x, y, z, dirx, dirz, active) {
    const prev = this.last.get(key);
    if (!active) { this.last.delete(key); return; }
    if (!prev) { this.last.set(key, { x, y, z }); return; }
    const dx = x - prev.x, dz = z - prev.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.7) return;
    if (d > 6) { this.last.set(key, { x, y, z }); return; }
    const w = 0.15;
    const px = -dz / d * w, pz = dx / d * w;
    const o = this.cursor * 18;
    const yy = y + 0.035, py = prev.y + 0.035;
    const v = [prev.x - px, py, prev.z - pz, prev.x + px, py, prev.z + pz, x + px, yy, z + pz,
      prev.x - px, py, prev.z - pz, x + px, yy, z + pz, x - px, yy, z - pz];
    this.pos.set(v, o);
    this.cursor = (this.cursor + 1) % this.max;
    this.last.set(key, { x, y, z });
    this.dirty = true;
  }
  update() {
    if (this.dirty) { this.mesh.geometry.attributes.position.needsUpdate = true; this.dirty = false; }
  }
}

export class Effects {
  constructor(scene) {
    this.glow = new ParticlePool(2600, true);
    this.smoke = new ParticlePool(1600, false);
    this.debris = new Debris();
    this.skids = new SkidMarks();
    scene.add(this.skids.mesh, this.smoke.points, this.glow.points, this.debris.mesh);
    this.smokeColor = [0.75, 0.75, 0.78];
  }

  setScale(px) {
    this.glow.material.uniforms.uScale.value = px;
    this.smoke.material.uniforms.uScale.value = px;
  }

  sparks(x, y, z, vx, vz, count = 10, power = 1) {
    for (let i = 0; i < count; i++) {
      const s = 4 + Math.random() * 10 * power;
      this.glow.spawn(x, y, z,
        vx * 0.6 + (Math.random() - 0.5) * s, Math.random() * 6 * power, vz * 0.6 + (Math.random() - 0.5) * s,
        0.25 + Math.random() * 0.4, 0.12 + Math.random() * 0.12, 9, 5, 1.6, { drag: 0.2, grav: 14 });
    }
  }

  tyreSmoke(x, y, z, vx, vz, amount = 1) {
    const c = this.smokeColor;
    this.smoke.spawn(x + (Math.random() - 0.5) * 0.4, y + 0.25, z + (Math.random() - 0.5) * 0.4,
      vx * 0.25 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, vz * 0.25 + (Math.random() - 0.5) * 2,
      1.1 + Math.random() * 0.9, 1.0 * amount, c[0], c[1], c[2], { drag: 0.3, grow: 3.5 });
  }

  flame(x, y, z, bx, bz, vx, vz) {
    const blue = Math.random() < 0.55;
    const sp = 7 + Math.random() * 5;
    this.glow.spawn(x, y, z, vx + bx * sp + (Math.random() - 0.5), (Math.random() - 0.3) * 0.8, vz + bz * sp + (Math.random() - 0.5),
      0.08 + Math.random() * 0.08, 0.35 + Math.random() * 0.25,
      blue ? 1.2 : 6, blue ? 2.5 : 2.2, blue ? 9 : 0.4, { drag: 0.02 });
  }

  explosion(x, y, z, vx, vz, color, ground) {
    this.sparks(x, y, z, vx, vz, 60, 2);
    for (let i = 0; i < 26; i++) {
      this.smoke.spawn(x + (Math.random() - 0.5) * 2, y + Math.random(), z + (Math.random() - 0.5) * 2,
        vx * 0.3 + (Math.random() - 0.5) * 6, 1 + Math.random() * 4, vz * 0.3 + (Math.random() - 0.5) * 6,
        1.6 + Math.random() * 1.2, 1.6, 0.22, 0.21, 0.2, { drag: 0.25, grow: 4 });
    }
    for (let i = 0; i < 12; i++) {
      this.glow.spawn(x + (Math.random() - 0.5), y + 0.5, z + (Math.random() - 0.5),
        vx * 0.4 + (Math.random() - 0.5) * 8, 2 + Math.random() * 5, vz * 0.4 + (Math.random() - 0.5) * 8,
        0.35 + Math.random() * 0.3, 1.4, 8, 3.2, 0.6, { drag: 0.1, grow: 2 });
    }
    const c1 = new THREE.Color(color), c2 = new THREE.Color(0x1b1c20);
    for (let i = 0; i < 18; i++) {
      this.debris.spawn(x, y + 0.4, z,
        vx * 0.7 + (Math.random() - 0.5) * 14, 3 + Math.random() * 8, vz * 0.7 + (Math.random() - 0.5) * 14,
        Math.random() < 0.6 ? c1 : c2, ground);
    }
  }

  update(dt) {
    this.glow.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.skids.update();
  }
}

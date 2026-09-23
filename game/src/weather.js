// Weather particles that live in a box around the camera: rain streaks (with lightning),
// snowflakes, or drifting desert dust.
import * as THREE from 'three';
import { radialTexture } from './textures.js';

export class Weather {
  // layer: camera layer this weather box renders on (each split-screen player has their own)
  constructor(scene, cfg, layer = 1) {
    this.cfg = cfg;
    this.type = cfg.type;
    this.box = cfg.box || (this.type === 'rain' ? [70, 36, 70] : this.type === 'snow' ? [90, 44, 90] : [140, 30, 140]);
    const n = this.count = cfg.count;
    this.pos = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    const [bx, by, bz] = this.box;
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * bx;
      this.pos[i * 3 + 1] = (Math.random() - 0.5) * by;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * bz;
      this.phase[i] = Math.random() * 100;
    }
    this.lastCam = null;
    this.camVel = new THREE.Vector3();
    this.flash = 0;
    this.nextStrike = 5 + Math.random() * 8;
    this.onThunder = null;

    if (this.type === 'rain') {
      this.lines = new Float32Array(n * 6);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.lines, 3).setUsage(THREE.DynamicDrawUsage));
      this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: cfg.color ?? 0xaabbd0, transparent: true, opacity: 0.3, depthWrite: false }));
    } else {
      this.pts = new Float32Array(n * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pts, 3).setUsage(THREE.DynamicDrawUsage));
      this.mesh = new THREE.Points(g, new THREE.PointsMaterial({
        color: cfg.color ?? 0xffffff,
        size: this.type === 'snow' ? 0.22 : 1.6,
        map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64),
        transparent: true,
        opacity: this.type === 'snow' ? 0.95 : 0.22,
        depthWrite: false,
        sizeAttenuation: true,
      }));
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.layers.set(layer);
    scene.add(this.mesh);
  }

  update(dt, time, camera) {
    const c = camera.position;
    if (this.lastCam && dt > 0) this.camVel.copy(c).sub(this.lastCam).divideScalar(dt);
    if (!this.lastCam) this.lastCam = c.clone(); else this.lastCam.copy(c);
    if (this.camVel.lengthSq() > 200 * 200) this.camVel.set(0, 0, 0); // teleport (respawn / camera cut)
    const [bx, by, bz] = this.box;
    const n = this.count, p = this.pos;
    const wind = this.cfg.wind || [0, 0];
    const fall = this.type === 'rain' ? 28 : this.type === 'snow' ? 2.2 : 0.4;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let vx = wind[0], vz = wind[1], vy = -fall;
      if (this.type === 'snow') { vx += Math.sin(time * 0.9 + this.phase[i]) * 0.8; vz += Math.cos(time * 0.7 + this.phase[i]) * 0.8; }
      if (this.type === 'dust') { vy = Math.sin(time * 0.5 + this.phase[i]) * 0.6; }
      p[o] += vx * dt; p[o + 1] += vy * dt; p[o + 2] += vz * dt;
      // keep inside the box centred on the camera (positions are world-space)
      let rx = p[o] - c.x, ry = p[o + 1] - c.y, rz = p[o + 2] - c.z;
      if (rx > bx / 2) p[o] -= bx; else if (rx < -bx / 2) p[o] += bx;
      if (ry > by / 2) p[o + 1] -= by; else if (ry < -by / 2) p[o + 1] += by;
      if (rz > bz / 2) p[o + 2] -= bz; else if (rz < -bz / 2) p[o + 2] += bz;
      if (this.type === 'rain') {
        // streak along the drop's velocity relative to the camera
        const k = 0.016;
        const sx = (vx - this.camVel.x) * k, sy = (vy - this.camVel.y) * k, sz = (vz - this.camVel.z) * k;
        const l = i * 6;
        this.lines[l] = p[o]; this.lines[l + 1] = p[o + 1]; this.lines[l + 2] = p[o + 2];
        this.lines[l + 3] = p[o] - sx; this.lines[l + 4] = p[o + 1] - sy; this.lines[l + 5] = p[o + 2] - sz;
      } else {
        this.pts[o] = p[o]; this.pts[o + 1] = p[o + 1]; this.pts[o + 2] = p[o + 2];
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;

    // lightning
    if (this.cfg.lightning) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = 6 + Math.random() * 10;
        this.flash = 1;
        this.flicker = 0.25;
        const delay = 300 + Math.random() * 1400;
        if (this.onThunder) setTimeout(() => this.onThunder(1 - delay / 2500), delay);
      }
      if (this.flicker > 0) {
        this.flicker -= dt;
        if (Math.random() < 0.3) this.flash = Math.max(this.flash, 0.6 + Math.random() * 0.4);
      }
      this.flash *= Math.exp(-dt * 7);
    }
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    if (this.mesh.material.map) this.mesh.material.map.dispose();
    this.mesh.material.dispose();
  }
}

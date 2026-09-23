// Arcade vehicle dynamics on the ground plane, kept on the road by the track barriers.
// Also handles the tumbling "wreck" state used for crashes and takedowns.
import { wrapAngle } from './trackMath.js';
import { BOOST_SPEED, BOOST_ACCEL } from './config.js';

export class Vehicle {
  constructor(spec) {
    this.spec = spec;
    this.mass = spec.mass;
    this.x = 0; this.y = 0; this.z = 0;
    this.heading = 0;
    this.vx = 0; this.vz = 0;
    this.vF = 0; this.vR = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.drifting = false;
    this.slip = 0;
    this.boosting = false;
    this.braking = false;
    this.throttle = 0;
    this.idx = -1;
    this.s = 0; this.lateral = 0; this.grade = 0;
    this.pitch = 0; this.roll = 0;
    this.bodyPitch = 0; this.bodyRoll = 0;
    this.wheelSpin = 0;
    this.scraping = 0;
    this.wrecked = false;
    this.ghost = 0; // seconds of no-collision after respawn
    this.proj = {};
    this.wreck = { vy: 0, wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1, t: 0, ground: 0 };
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fx() { return Math.sin(this.heading); }
  get fz() { return Math.cos(this.heading); }

  placeOnTrack(track, s, lateral, speed = 0) {
    const p = track.pointAt(s, lateral);
    this.x = p.x; this.z = p.z; this.y = p.y;
    this.heading = p.heading;
    this.vx = Math.sin(p.heading) * speed;
    this.vz = Math.cos(p.heading) * speed;
    this.yawRate = 0; this.steer = 0;
    this.drifting = false;
    this.wrecked = false;
    this.idx = p.idx;
    this.bodyPitch = this.bodyRoll = 0;
    this.constrain(track);
  }

  update(dt, c, mul = 1) {
    if (this.wrecked) { this.updateWreck(dt); return; }
    if (this.ghost > 0) this.ghost -= dt;
    const sp = this.spec;
    this.boosting = !!c.boost;
    this.throttle = c.throttle;

    // steering (smoothed input, weaker at speed)
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 7);
    const fx0 = Math.sin(this.heading), fz0 = Math.cos(this.heading);
    const vF0 = this.vx * fx0 + this.vz * fz0;
    const spd = Math.abs(vF0);
    const low = Math.min(1, spd / 9);
    const hiDamp = 1 - 0.5 * Math.min(1, spd / sp.topSpeed);
    let yawTarget = this.steer * sp.turn * low * hiDamp * (vF0 < -0.5 ? -1 : 1);

    // drift state
    if (c.handbrake && spd > 13 && Math.abs(this.steer) > 0.25) {
      if (!this.drifting) this.yawRate += Math.sign(this.steer) * 0.6;
      this.drifting = true;
    }
    if (this.drifting) {
      yawTarget *= 1.45;
      if (!c.handbrake && (Math.abs(this.slip) < 0.1 || spd < 9)) this.drifting = false;
      if (spd < 6) this.drifting = false;
    }
    this.yawRate += (yawTarget - this.yawRate) * Math.min(1, dt * (this.drifting ? 3.5 : 9));
    this.heading = wrapAngle(this.heading - this.yawRate * dt);

    // velocity in the new car frame
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const oldMag = Math.hypot(vF, vR);

    const top = sp.topSpeed * mul * (this.boosting ? BOOST_SPEED : 1) * (c.draft ? 1.05 : 1);
    const acc = sp.accel * mul * (this.boosting ? BOOST_ACCEL : 1);
    this.braking = false;
    if (c.throttle > 0) {
      if (vF < top) {
        const k = Math.max(0.08, 1 - Math.pow(Math.max(vF, 0) / top, 2));
        vF += acc * c.throttle * k * dt;
      } else vF -= (vF - top) * 1.2 * dt;
    }
    if (c.brake > 0) {
      if (vF > 0.5) { vF -= 34 * c.brake * dt; this.braking = true; }
      else if (c.throttle === 0) vF = Math.max(vF - 13 * c.brake * dt, -17);
    }
    if (c.throttle === 0 && c.brake === 0) {
      const d = (1.5 + 0.004 * vF * vF) * dt;
      vF = Math.abs(vF) <= d ? 0 : vF - Math.sign(vF) * d;
    }
    if (c.handbrake) { vF -= Math.sign(vF) * Math.min(Math.abs(vF), 5 * dt); this.braking = true; }

    // lateral grip
    const grip = this.drifting ? sp.grip * 0.2 : c.handbrake ? sp.grip * 0.3 : sp.grip;
    vR *= Math.exp(-grip * dt);
    // arcade: keep most of the speed through corners instead of scrubbing it
    const keep = this.drifting ? 0.72 : 0.9;
    const newMag = Math.hypot(vF, vR);
    if (newMag > 0.1 && oldMag > newMag && c.throttle > 0) {
      const target = newMag + (oldMag - newMag) * keep;
      const f2 = Math.max(0, target * target - vR * vR);
      vF = Math.sign(vF || 1) * Math.sqrt(f2);
    }
    this.slip = Math.atan2(vR, Math.max(Math.abs(vF), 1));
    // drift hurts a little less than straight-line when throttle is held
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;

    // body motion (visual)
    const accLong = (vF - this.vF) / Math.max(dt, 1e-4);
    this.bodyPitch += (Math.max(-0.06, Math.min(0.06, accLong * 0.0028)) - this.bodyPitch) * Math.min(1, dt * 6);
    const latAcc = this.yawRate * spd;
    this.bodyRoll += (Math.max(-0.09, Math.min(0.09, -latAcc * 0.0035)) - this.bodyRoll) * Math.min(1, dt * 6);
    this.vF = vF; this.vR = vR;

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.wheelSpin += (vF / 0.36) * dt;
  }

  // Keep inside the barriers. Returns impact info when the car hits a wall this step.
  constrain(track) {
    const p = track.project(this.x, this.z, this.idx, this.proj);
    this.idx = p.idx; this.s = p.s; this.lateral = p.lateral; this.grade = p.grade;
    const th = Math.atan2(p.tx, p.tz);
    const rel = wrapAngle(this.heading - th);
    this.roadY = p.y;
    if (!this.wrecked) {
      this.y = p.y;
      this.pitch = -Math.atan(p.grade * Math.cos(rel));
      this.roll = Math.atan(p.grade * Math.sin(rel)) * 0.5;
    }
    this.scraping = Math.max(0, this.scraping - 0.1);
    const lim = track.halfWidth - 1.1;
    if (Math.abs(p.lateral) <= lim) return null;
    const side = Math.sign(p.lateral);
    const pen = Math.abs(p.lateral) - lim;
    const nx = -side * p.rx, nz = -side * p.rz; // inward normal
    this.x += nx * pen; this.z += nz * pen;
    this.lateral = side * lim;
    const vn = -(this.vx * nx + this.vz * nz);
    if (vn <= 0) return null;
    const speed = Math.hypot(this.vx, this.vz);
    const angle = Math.asin(Math.min(1, vn / Math.max(speed, 1e-3))) * 180 / Math.PI;
    this.vx += nx * vn * 1.3;
    this.vz += nz * vn * 1.3;
    const fr = Math.min(0.6, vn * 0.016);
    this.vx *= 1 - fr; this.vz *= 1 - fr;
    if (!this.wrecked) {
      // glance off: align with the wall
      const target = Math.abs(rel) > Math.PI / 2 ? th + Math.PI : th;
      const d = wrapAngle(target - this.heading);
      this.heading = wrapAngle(this.heading + d * Math.min(0.5, vn * 0.03));
      this.yawRate *= 0.6;
      this.scraping = 1;
    }
    return {
      vn, angle, speed, nx, nz,
      x: this.x - nx * 1.0, y: this.y + 0.5, z: this.z - nz * 1.0,
    };
  }

  crash(pushX = 0, pushZ = 0, power = 1) {
    if (this.wrecked) return;
    this.wrecked = true;
    const w = this.wreck;
    const speed = this.speed;
    w.t = 0;
    w.ground = this.y;
    w.vy = 5 + Math.min(12, speed * 0.16) * power;
    this.vx = this.vx * 0.75 + pushX * speed * 0.35;
    this.vz = this.vz * 0.75 + pushZ * speed * 0.35;
    const r = () => (Math.random() - 0.5) * 2;
    w.wx = r() * 5 * power + 3 * Math.sign(r());
    w.wy = r() * 4;
    w.wz = r() * 7 * power + 4 * Math.sign(r());
    // start from current orientation
    const h = this.heading / 2;
    w.qx = 0; w.qy = Math.sin(h); w.qz = 0; w.qw = Math.cos(h);
    this.wreckY = this.y + 0.6; // pivot at the body centre
    this.drifting = false;
    this.boosting = false;
  }

  updateWreck(dt) {
    const w = this.wreck;
    w.t += dt;
    w.vy -= 24 * dt;
    this.wreckY += w.vy * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const ground = (this.roadY ?? this.y) + 0.55;
    if (this.wreckY < ground) {
      this.wreckY = ground;
      if (w.vy < -2) {
        w.vy = -w.vy * 0.38;
        w.wx *= 0.65; w.wy *= 0.7; w.wz *= 0.65;
        this.vx *= 0.72; this.vz *= 0.72;
        this.bounced = true;
      } else {
        w.vy = 0;
        this.vx *= Math.exp(-3 * dt); this.vz *= Math.exp(-3 * dt);
        w.wx *= Math.exp(-4 * dt); w.wy *= Math.exp(-4 * dt); w.wz *= Math.exp(-4 * dt);
      }
    }
    // integrate orientation quaternion with world angular velocity
    const { wx, wy, wz } = w;
    let { qx, qy, qz, qw } = w;
    const hx = 0.5 * dt;
    const dx = hx * (wx * qw + wy * qz - wz * qy);
    const dy = hx * (wy * qw + wz * qx - wx * qz);
    const dz = hx * (wz * qw + wx * qy - wy * qx);
    const dw = hx * (-wx * qx - wy * qy - wz * qz);
    qx += dx; qy += dy; qz += dz; qw += dw;
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    w.qx = qx / l; w.qy = qy / l; w.qz = qz / l; w.qw = qw / l;
  }
}

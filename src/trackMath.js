// Pure track geometry (no three.js): a closed centripetal Catmull-Rom spline resampled at a
// uniform step, with "track-space" queries: world (x, z) <-> (s along track, lateral offset).

function catmull(p0, p1, p2, p3, t, alpha = 0.5) {
  const d = (a, b) => Math.max(1e-4, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), alpha));
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a1 = ((t1 - tt) * p0[k] + (tt - t0) * p1[k]) / (t1 - t0);
    const a2 = ((t2 - tt) * p1[k] + (tt - t1) * p2[k]) / (t2 - t1);
    const a3 = ((t3 - tt) * p2[k] + (tt - t2) * p3[k]) / (t3 - t2);
    const b1 = ((t2 - tt) * a1 + (tt - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - tt) * a2 + (tt - t1) * a3) / (t3 - t1);
    out[k] = ((t2 - tt) * b1 + (tt - t1) * b2) / (t2 - t1);
  }
  return out;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class TrackPath {
  constructor(points, { width = 18, step = 2 } = {}) {
    this.width = width;
    this.halfWidth = width / 2;
    this.step = step;

    // Dense raw polyline along the closed spline.
    const raw = [];
    const m = points.length;
    const sub = 40;
    for (let i = 0; i < m; i++) {
      const p0 = points[(i - 1 + m) % m], p1 = points[i], p2 = points[(i + 1) % m], p3 = points[(i + 2) % m];
      for (let j = 0; j < sub; j++) raw.push(catmull(p0, p1, p2, p3, j / sub));
    }
    raw.push(raw[0]);
    const cum = [0];
    for (let i = 1; i < raw.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1], raw[i][2] - raw[i - 1][2]));
    }
    const total = cum[cum.length - 1];
    const n = Math.max(16, Math.round(total / step));
    this.n = n;
    this.step = total / n;
    this.length = total;

    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.rx = new Float32Array(n); this.rz = new Float32Array(n);
    this.curv = new Float32Array(n); this.grade = new Float32Array(n);

    let r = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.step;
      while (cum[r + 1] < s) r++;
      const f = (s - cum[r]) / Math.max(1e-6, cum[r + 1] - cum[r]);
      this.x[i] = raw[r][0] + (raw[r + 1][0] - raw[r][0]) * f;
      this.y[i] = raw[r][1] + (raw[r + 1][1] - raw[r][1]) * f;
      this.z[i] = raw[r][2] + (raw[r + 1][2] - raw[r][2]) * f;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      this.rx[i] = -dz; this.rz[i] = dx;
      this.grade[i] = (this.y[b] - this.y[a]) / (2 * this.step);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      // signed turn: positive = turning right
      const cross = this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
      const dot = this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b];
      this.curv[i] = Math.atan2(cross, dot) / (2 * this.step);
    }
    // light smoothing of curvature so AI speed targets are stable
    const c = Float32Array.from(this.curv);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += c[(i + k + n) % n];
      this.curv[i] = sum / 7;
    }
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  // signed shortest distance from a to b along the loop
  deltaS(a, b) {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  headingAt(i) {
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  nearestIndex(x, z, hint = -1) {
    const n = this.n;
    let best = -1, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + n) % n;
        const dx = x - this.x[i], dz = z - this.z[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD < (this.step * 30) ** 2) return best;
    }
    for (let i = 0; i < n; i++) {
      const dx = x - this.x[i], dz = z - this.z[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Project a world point to track space. Writes into `out` and returns it.
  project(x, z, hint = -1, out = {}) {
    const n = this.n;
    const i = this.nearestIndex(x, z, hint);
    let bestA = i, bestT = 0, bestD = Infinity;
    for (const a of [(i - 1 + n) % n, i]) {
      const b = (a + 1) % n;
      const ex = this.x[b] - this.x[a], ez = this.z[b] - this.z[a];
      const len2 = ex * ex + ez * ez || 1;
      let t = ((x - this.x[a]) * ex + (z - this.z[a]) * ez) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = this.x[a] + ex * t, cz = this.z[a] + ez * t;
      const d = (x - cx) ** 2 + (z - cz) ** 2;
      if (d < bestD) { bestD = d; bestA = a; bestT = t; }
    }
    const a = bestA, b = (a + 1) % n, t = bestT;
    const cx = this.x[a] + (this.x[b] - this.x[a]) * t;
    const cz = this.z[a] + (this.z[b] - this.z[a]) * t;
    let rx = this.rx[a] + (this.rx[b] - this.rx[a]) * t;
    let rz = this.rz[a] + (this.rz[b] - this.rz[a]) * t;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    out.idx = t < 0.5 ? a : b;
    out.s = this.wrapS((a + t) * this.step);
    out.lateral = (x - cx) * rx + (z - cz) * rz;
    out.y = this.y[a] + (this.y[b] - this.y[a]) * t;
    out.rx = rx; out.rz = rz;
    out.tx = rz; out.tz = -rx;
    out.grade = this.grade[a] + (this.grade[b] - this.grade[a]) * t;
    return out;
  }

  // World position at (s, lateral). Writes into `out` and returns it.
  pointAt(s, lateral = 0, out = {}) {
    const n = this.n;
    const u = this.wrapS(s) / this.step;
    const a = Math.floor(u) % n, b = (a + 1) % n, t = u - Math.floor(u);
    let rx = this.rx[a] + (this.rx[b] - this.rx[a]) * t;
    let rz = this.rz[a] + (this.rz[b] - this.rz[a]) * t;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    out.x = this.x[a] + (this.x[b] - this.x[a]) * t + rx * lateral;
    out.z = this.z[a] + (this.z[b] - this.z[a]) * t + rz * lateral;
    out.y = this.y[a] + (this.y[b] - this.y[a]) * t;
    out.rx = rx; out.rz = rz;
    out.tx = rz; out.tz = -rx;
    out.heading = Math.atan2(out.tx, out.tz);
    out.idx = t < 0.5 ? a : b;
    return out;
  }

  // Largest |curvature| over the next `dist` metres from s.
  maxCurvatureAhead(s, dist) {
    const n = this.n;
    const i0 = Math.floor(this.wrapS(s) / this.step);
    const steps = Math.max(1, Math.ceil(dist / this.step));
    let m = 0;
    for (let k = 0; k < steps; k += 2) m = Math.max(m, Math.abs(this.curv[(i0 + k) % n]));
    return m;
  }

  minRadius() {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.abs(this.curv[i]));
    return 1 / m;
  }
}

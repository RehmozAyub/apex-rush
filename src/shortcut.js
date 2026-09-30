// One shortcut per track: a narrower dirt road that forks off the inside of a long bend and
// rejoins further on. It is found automatically from the track shape (pure logic, no three.js).
//
// The shortcut is an open path with the same track-space queries as TrackPath (project,
// pointAt, curvature), so the vehicle constraint and the AI can drive on it. Where it overlaps
// the main road (the fork and the merge) the barriers between the two are left out.
import { TrackIndex } from './terrain-index.js';

export const SHORTCUT = {
  width: 11,
  minStartS: 220, // keep clear of the start line and grid
  endMargin: 160,
  minSpan: 140, maxSpan: 620, // main-road distance the shortcut replaces (m)
  minSaving: 75, maxSaving: 170, // metres saved
  minRadius: 45,
  clearance: 16, // gap to any other part of the main road (beyond both half widths)
  maxGrade: 0.1,
};

// Open polyline resampled at a uniform step, with TrackPath-like queries.
export class OpenPath {
  constructor(pts, { width = 11, step = 2 } = {}) {
    this.width = width;
    this.halfWidth = width / 2;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    const total = cum[cum.length - 1];
    const n = Math.max(4, Math.round(total / step) + 1);
    this.n = n;
    this.step = total / (n - 1);
    this.length = total;
    for (const k of ['x', 'y', 'z', 'tx', 'tz', 'rx', 'rz', 'curv', 'grade']) this[k] = new Float32Array(n);
    let r = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.step;
      while (r < pts.length - 2 && cum[r + 1] < s) r++;
      const f = Math.min(1, (s - cum[r]) / Math.max(1e-6, cum[r + 1] - cum[r]));
      for (let k = 0; k < 3; k++) this['xyz'[k]][i] = pts[r][k] + (pts[r + 1][k] - pts[r][k]) * f;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      this.rx[i] = -dz; this.rz[i] = dx;
      this.grade[i] = (this.y[b] - this.y[a]) / ((b - a) * this.step || 1);
    }
    for (let i = 1; i < n - 1; i++) {
      const cross = this.tx[i - 1] * this.tz[i + 1] - this.tz[i - 1] * this.tx[i + 1];
      const dot = this.tx[i - 1] * this.tx[i + 1] + this.tz[i - 1] * this.tz[i + 1];
      this.curv[i] = Math.atan2(cross, dot) / (2 * this.step);
    }
  }

  wrapS(s) { return Math.max(0, Math.min(this.length, s)); }
  deltaS(a, b) { return b - a; }
  headingAt(i) { return Math.atan2(this.tx[i], this.tz[i]); }

  nearestIndex(x, z, hint = -1) {
    let best = 0, bestD = Infinity;
    const from = hint >= 0 ? Math.max(0, hint - 30) : 0, to = hint >= 0 ? Math.min(this.n - 1, hint + 30) : this.n - 1;
    for (let i = from; i <= to; i++) {
      const d = (x - this.x[i]) ** 2 + (z - this.z[i]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (hint >= 0 && (best === from || best === to) && from !== 0 && to !== this.n - 1) return this.nearestIndex(x, z, -1);
    return best;
  }

  // Project a world point onto the path. s is clamped to [0, length]; `beyond` says how far past
  // either end the point lies (negative before the start, positive after the end).
  project(x, z, hint = -1, out = {}) {
    const n = this.n;
    const i = this.nearestIndex(x, z, hint);
    let bestA = 0, bestT = 0, bestD = Infinity, bestRaw = 0;
    for (const a of [Math.max(0, i - 1), Math.min(n - 2, i)]) {
      const b = a + 1;
      const ex = this.x[b] - this.x[a], ez = this.z[b] - this.z[a];
      const len2 = ex * ex + ez * ez || 1;
      const raw = ((x - this.x[a]) * ex + (z - this.z[a]) * ez) / len2;
      const t = Math.max(0, Math.min(1, raw));
      const d = (x - (this.x[a] + ex * t)) ** 2 + (z - (this.z[a] + ez * t)) ** 2;
      if (d < bestD) { bestD = d; bestA = a; bestT = t; bestRaw = raw; }
    }
    const a = bestA, b = a + 1, t = bestT;
    const cx = this.x[a] + (this.x[b] - this.x[a]) * t, cz = this.z[a] + (this.z[b] - this.z[a]) * t;
    let rx = this.rx[a] + (this.rx[b] - this.rx[a]) * t, rz = this.rz[a] + (this.rz[b] - this.rz[a]) * t;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    out.idx = t < 0.5 ? a : b;
    out.s = (a + t) * this.step;
    out.beyond = a === 0 && bestRaw < 0 ? bestRaw * this.step : b === n - 1 && bestRaw > 1 ? (bestRaw - 1) * this.step : 0;
    out.lateral = (x - cx) * rx + (z - cz) * rz;
    out.y = this.y[a] + (this.y[b] - this.y[a]) * t;
    out.rx = rx; out.rz = rz;
    out.tx = rz; out.tz = -rx;
    out.grade = this.grade[a] + (this.grade[b] - this.grade[a]) * t;
    return out;
  }

  pointAt(s, lateral = 0, out = {}) {
    const u = this.wrapS(s) / this.step;
    const a = Math.min(this.n - 2, Math.floor(u)), b = a + 1, t = u - a;
    let rx = this.rx[a] + (this.rx[b] - this.rx[a]) * t, rz = this.rz[a] + (this.rz[b] - this.rz[a]) * t;
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

  maxCurvatureAhead(s, dist) {
    const i0 = Math.floor(this.wrapS(s) / this.step);
    const i1 = Math.min(this.n - 1, i0 + Math.ceil(dist / this.step));
    let m = 0;
    for (let i = i0; i <= i1; i++) m = Math.max(m, Math.abs(this.curv[i]));
    return m;
  }
}

const smoothstep = (t) => t * t * (3 - 2 * t);

// Cubic Bezier from the inside edge of the main road at s=a to s=b, leaving and joining along
// the road direction so the fork and the merge are gentle.
function bezierPoints(track, a, b, side, width) {
  const inset = side * (track.halfWidth - width * 0.35);
  const P = track.pointAt(a, inset), Q = track.pointAt(b, inset);
  const chord = Math.hypot(Q.x - P.x, Q.z - P.z);
  const D = chord * 0.3;
  const c1 = [P.x + P.tx * D, P.z + P.tz * D], c2 = [Q.x - Q.tx * D, Q.z - Q.tz * D];
  const pts = [];
  const N = Math.max(40, Math.ceil(chord / 1.5));
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const x = u * u * u * P.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * Q.x;
    const z = u * u * u * P.z + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * Q.z;
    pts.push([x, P.y + (Q.y - P.y) * smoothstep(t), z]);
  }
  return { pts, chord };
}

// Search the track for the best corner to cut. Returns null when nothing suitable exists.
export function findShortcut(track, index = new TrackIndex(track), R = SHORTCUT, stats = {}) {
  const L = track.length, hw = track.halfWidth;
  let best = null;
  for (let a = R.minStartS; a < L - R.endMargin - R.minSpan; a += 10) {
    for (let span = R.minSpan; span <= R.maxSpan && a + span < L - R.endMargin; span += 10) {
      const b = a + span;
      // cut the inside of the bend
      let turn = 0;
      for (let s = a; s < b; s += track.step * 2) turn += track.curv[Math.floor(s / track.step) % track.n];
      const side = Math.sign(turn) || 1;
      const P = track.pointAt(a), Q = track.pointAt(b);
      const chord = Math.hypot(Q.x - P.x, Q.z - P.z);
      const saving = span - chord * 1.05;
      if (saving < R.minSaving || saving > R.maxSaving || (best && saving <= best.saving)) continue;
      if (Math.abs(Q.y - P.y) / chord > R.maxGrade) continue;
      const cand = bezierPoints(track, a, b, side, R.width);
      const path = new OpenPath(cand.pts, { width: R.width });
      const realSaving = span - path.length;
      if (realSaving < R.minSaving || realSaving > R.maxSaving) { stats.real = (stats.real || 0) + 1; continue; }
      let ok = true;
      for (let i = 0; i < path.n && ok; i++) if (Math.abs(path.curv[i]) > 1 / R.minRadius) ok = false;
      if (!ok) { stats.radius = (stats.radius || 0) + 1; continue; }
      // off the bend it cuts (except at the fork and merge), and well away from every other
      // stretch of main road
      const i0 = a / track.step - 25, i1 = b / track.step + 25;
      const other = (i) => i >= i0 && i <= i1;
      for (let i = 0; i < path.n && ok; i++) {
        const u = i * path.step;
        if (u > 60 && u < path.length - 60 && index.nearest(path.x[i], path.z[i], 2).dist < hw + path.halfWidth) { ok = false; stats.onRoad = (stats.onRoad || 0) + 1; }
        else if (index.nearest(path.x[i], path.z[i], 3, other).dist < hw + path.halfWidth + R.clearance) ok = false;
      }
      if (!ok) { stats.shape = (stats.shape || 0) + 1; continue; }
      best = { a, b, side, saving: realSaving, path };
    }
  }
  return best ? new Shortcut(track, best) : null;
}

export class Shortcut {
  constructor(track, { a, b, side, path, saving }) {
    this.track = track;
    this.a = a; this.b = b; this.side = side; this.path = path; this.saving = saving;
    const hw = track.halfWidth, shw = path.halfWidth;
    // main-road barrier samples on the shortcut's side that lie inside the shortcut are gaps
    this.mainGap = new Uint8Array(track.n);
    const q = {};
    for (let i = 0; i < track.n; i++) {
      const s = i * track.step;
      if (s < a - 30 || s > b + 30) continue;
      const bx = track.x[i] + track.rx[i] * side * (hw + 0.5), bz = track.z[i] + track.rz[i] * side * (hw + 0.5);
      path.project(bx, bz, -1, q);
      if (Math.abs(q.lateral) < shw + 1.5 && q.beyond === 0) this.mainGap[i] = 1;
    }
    // widen each gap a touch so no post sticks out into the fork
    const g = Uint8Array.from(this.mainGap);
    for (let i = 0; i < track.n; i++) if (g[i]) for (let k = -3; k <= 3; k++) this.mainGap[(i + k + track.n) % track.n] = 1;
    // shortcut barrier samples that lie on the main road are left out
    this.pathGap = [new Uint8Array(path.n), new Uint8Array(path.n)]; // [left(-1), right(+1)]
    const p = {};
    for (let j = 0; j < path.n; j++) {
      for (const [k, sd] of [[0, -1], [1, 1]]) {
        const bx = path.x[j] + path.rx[j] * sd * (shw + 0.5), bz = path.z[j] + path.rz[j] * sd * (shw + 0.5);
        track.project(bx, bz, -1, p);
        if (Math.abs(p.lateral) < hw + 1.5 && Math.abs(track.deltaS(p.s, (a + b) / 2)) < (b - a) / 2 + 40) this.pathGap[k][j] = 1;
      }
    }
    for (const arr of this.pathGap) {
      const c = Uint8Array.from(arr);
      for (let j = 0; j < path.n; j++) if (c[j]) for (let k = -2; k <= 2; k++) if (j + k >= 0 && j + k < path.n) arr[j + k] = 1;
    }
    // the stretch at each end where the two roads overlap
    let first = 0, last = path.n - 1;
    while (first < path.n - 1 && (this.pathGap[0][first] || this.pathGap[1][first])) first++;
    while (last > 0 && (this.pathGap[0][last] || this.pathGap[1][last])) last--;
    this.overlapIn = first * path.step;
    this.overlapOut = path.length - last * path.step;
  }

  // main-road s for a distance u along the shortcut (progress is linear, so it gains on the loop)
  mainS(u) { return this.track.wrapS(this.a + (this.b - this.a) * (u / this.path.length)); }

  // is there no main-road barrier at (s, side) because the shortcut forks off there?
  isGap(s, side) {
    if (side !== this.side) return false;
    return !!this.mainGap[Math.round(this.track.wrapS(s) / this.track.step) % this.track.n];
  }

  // is a world point on the shortcut's surface?
  contains(x, z, out = {}) {
    this.path.project(x, z, -1, out);
    return out.beyond === 0 && Math.abs(out.lateral) <= this.path.halfWidth;
  }
}

// Keeps a vehicle on whichever road it is on. At the fork and the merge the barrier between the
// roads is open, and a car crossing that edge switches roads. On the shortcut, v.s is mapped
// back onto the main road (so race progress keeps working) and v.scU / v.scIdx hold the
// position along the shortcut. Returns the wall hit (if any) like Vehicle.constrain.
export function constrainOnRoads(v, track, sc, tmpP = {}, tmpQ = {}) {
  if (!sc) return v.constrain(track);
  const path = sc.path;
  if (v.onSC) {
    const q = path.project(v.x, v.z, v.scIdx ?? -1, tmpQ);
    const atEnd = q.beyond !== 0 || q.s < sc.overlapIn + 6 || q.s > path.length - sc.overlapOut - 6;
    if (atEnd) {
      const p = track.project(v.x, v.z, v.idx, tmpP);
      if (q.beyond !== 0 || Math.abs(p.lateral) <= track.halfWidth - 1.1) { v.onSC = false; return v.constrain(track); }
    }
    v.idx = v.scIdx ?? q.idx;
    const hit = v.constrain(path);
    v.scIdx = v.idx;
    v.scU = v.s;
    v.s = sc.mainS(v.scU);
    v.idx = Math.round(v.s / track.step) % track.n;
    v.lateral = sc.side * (track.halfWidth + 25); // off the main road for track-space checks
    return hit;
  }
  const p = track.project(v.x, v.z, v.idx, tmpP);
  if (Math.abs(p.lateral) > track.halfWidth - 1.1 && sc.isGap(p.s, Math.sign(p.lateral))) {
    const q = path.project(v.x, v.z, -1, tmpQ);
    if (q.beyond === 0 && Math.abs(q.lateral) <= path.halfWidth - 1.1) {
      v.onSC = true;
      v.scIdx = q.idx;
      return constrainOnRoads(v, track, sc, tmpP, tmpQ);
    }
  }
  return v.constrain(track);
}

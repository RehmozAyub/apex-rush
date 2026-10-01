// Shortcuts (2-3 per track): narrower dirt roads that fork off the inside of long bends and
// rejoin further on, some with ramps, some hidden behind a fence. They are found automatically
// from the track shape (pure logic, no three.js). Also the airborne physics for ramps.
//
// The shortcut is an open path with the same track-space queries as TrackPath (project,
// pointAt, curvature), so the vehicle constraint and the AI can drive on it. Where it overlaps
// the main road (the fork and the merge) the barriers between the two are left out.
import { TrackIndex } from './terrain-index.js';
import { wrapAngle } from './trackMath.js';

export const SHORTCUT = {
  width: 11,
  minStartS: 220, // keep clear of the start line and grid
  endMargin: 160,
  minSpan: 140, maxSpan: 850, // main-road distance the shortcut replaces (m)
  minSaving: 70, maxSaving: 170, // metres saved (the first shortcut)
  minSavingExtra: 40, // later ones (they get ramps / boost rings on top)
  minRadius: 45,
  clearance: 16, // gap to any other part of the main road (beyond both half widths)
  maxGrade: 0.1,
  separation: 120, // between two shortcuts along the main road (m)
  searchStep: 20,
  forkLength: 60, // the shortcut must leave the main road within this distance (m)
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

// Search the track for the best corner to cut, away from the shortcuts already `taken`.
// Returns null when nothing suitable exists.
export function findShortcut(track, index = new TrackIndex(track), R = SHORTCUT, stats = {}, taken = []) {
  const L = track.length, hw = track.halfWidth;
  let best = null;
  const clashes = (a, b, path) => taken.some((t) => {
    if (a < t.b + R.separation && b > t.a - R.separation) return true;
    for (let i = 0; i < path.n; i += 3) {
      const q = t.path.project(path.x[i], path.z[i]);
      if (Math.hypot(q.lateral, q.beyond) < path.width * 3) return true;
    }
    return false;
  });
  for (let a = R.minStartS; a < L - R.endMargin - R.minSpan; a += R.searchStep) {
    for (let span = R.minSpan; span <= R.maxSpan && a + span < L - R.endMargin; span += R.searchStep) {
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
        if (u > R.forkLength && u < path.length - R.forkLength && index.nearest(path.x[i], path.z[i], 2).dist < hw + path.halfWidth) { ok = false; stats.onRoad = (stats.onRoad || 0) + 1; }
        else if (index.nearest(path.x[i], path.z[i], 3, other).dist < hw + path.halfWidth + R.clearance) ok = false;
      }
      if (!ok) { stats.shape = (stats.shape || 0) + 1; continue; }
      if (clashes(a, b, path)) continue;
      best = { a, b, side, saving: realSaving, path };
    }
  }
  return best ? new Shortcut(track, best) : null;
}

// Up to `count` shortcuts per track, each with its own character:
//   1st: open, with a full-width ramp       2nd: hidden behind a fence, with a half ramp
//   3rd: hidden behind a fence, with a boost ring
export function findShortcuts(track, index = new TrackIndex(track), count = 3, R = SHORTCUT) {
  const list = [];
  for (let k = 0; k < count; k++) {
    const sc = findShortcut(track, index, k === 0 ? R : { ...R, minSaving: R.minSavingExtra, minRadius: R.minRadius * 0.85, clearance: R.clearance * 0.7, forkLength: 95 }, {}, list);
    if (!sc) break;
    list.push(sc);
  }
  list.sort((p, q) => q.saving - p.saving);
  return withFeatures(list);
}

// Rebuild shortcuts from saved { a, b, side } specs (skips the search; see world.js cache).
export function shortcutsFromSpecs(track, specs, R = SHORTCUT) {
  return withFeatures(specs.map(({ a, b, side }) => {
    const path = new OpenPath(bezierPoints(track, a, b, side, R.width).pts, { width: R.width });
    return new Shortcut(track, { a, b, side, path, saving: b - a - path.length });
  }));
}

// Lip position for a ramp: the middle stretch of the shortcut with the straightest landing
// zone ahead (a car in the air flies straight).
function straightestLip(sc) {
  const p = sc.path;
  let best = p.length * 0.5, bestC = Infinity;
  for (let u = p.length * 0.3; u < p.length * 0.65; u += 4) {
    const c = p.maxCurvatureAhead(u - 12, 75);
    if (c < bestC) { bestC = c; best = u; }
  }
  return best;
}

function withFeatures(list) {
  list.forEach((sc, k) => {
    sc.id = k;
    sc.fence = k > 0;
    const lip = straightestLip(sc);
    if (k === 0) sc.ramps = [{ u0: lip - 10, len: 10, h: 1.7, half: 0 }];
    else if (k === 1) sc.ramps = [{ u0: lip - 8, len: 8, h: 1.4, half: -sc.side }];
    else { sc.ramps = []; sc.boostRing = true; }
  });
  return list;
}

export class Shortcut {
  constructor(track, { a, b, side, path, saving }) {
    this.track = track;
    this.a = a; this.b = b; this.side = side; this.path = path; this.saving = saving;
    this.ramps = [];
    this.fence = false;
    const hw = track.halfWidth, shw = path.halfWidth;
    // height: where the shortcut runs on or beside the main road (fork and merge) it follows the
    // main road's surface exactly, then eases into a straight grade across the corner
    const q0 = {};
    const chordY = Float32Array.from(path.y);
    for (let j = 0; j < path.n; j++) {
      track.project(path.x[j], path.z[j], -1, q0);
      const w = 1 - smoothstep(Math.max(0, Math.min(1, (Math.abs(q0.lateral) - hw * 0.5) / 30)));
      path.y[j] = q0.y * w + chordY[j] * (1 - w);
    }
    const ys = Float32Array.from(path.y);
    for (let j = 2; j < path.n - 2; j++) path.y[j] = (ys[j - 2] + ys[j - 1] + ys[j] + ys[j + 1] + ys[j + 2]) / 5;
    for (let j = 0; j < path.n; j++) {
      const i0 = Math.max(0, j - 1), i1 = Math.min(path.n - 1, j + 1);
      path.grade[j] = (path.y[i1] - path.y[i0]) / ((i1 - i0) * path.step || 1);
    }
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
    this.fenceU = this.overlapIn + 10; // where a fence blocks the way in (fenced shortcuts)
  }

  // main-road s for a distance u along the shortcut (progress is linear, so it gains on the loop)
  mainS(u) { return this.track.wrapS(this.a + (this.b - this.a) * (u / this.path.length)); }

  // is there no main-road barrier at (s, side) because the shortcut forks off there?
  isGap(s, side) {
    if (side !== this.side) return false;
    return !!this.mainGap[Math.round(this.track.wrapS(s) / this.track.step) % this.track.n];
  }

  // extra surface height of a ramp at (u, lateral); 0 off the ramps. Each ramp rises linearly
  // and ends in a drop (the kicker). A half ramp only covers one side of the road.
  rampHeight(u, lat) {
    for (const r of this.ramps) {
      if (u < r.u0 || u > r.u0 + r.len) continue;
      if (r.half && lat * r.half < -0.3) continue;
      return r.h * ((u - r.u0) / r.len);
    }
    return 0;
  }

  rampAt(u) { return this.ramps.find((r) => u >= r.u0 - 1 && u <= r.u0 + r.len + 1) || null; }
}

// All the shortcuts of a track, queried together (barrier gaps, scenery clearance).
export class ShortcutSet {
  constructor(track, list) {
    this.track = track;
    this.list = list;
  }

  isGap(s, side) { return this.list.some((sc) => sc.isGap(s, side)); }

  // keep(side) -> filter for main-road roadside samples (null when nothing is cut on that side)
  mainKeep(side) {
    const cuts = this.list.filter((sc) => sc.side === side);
    if (!cuts.length) return null;
    return (i) => cuts.every((sc) => !sc.mainGap[i]);
  }

  // is a world point on (or within `margin` of) any shortcut's road?
  near(x, z, margin = 0) {
    const q = {};
    return this.list.some((sc) => { sc.path.project(x, z, -1, q); return q.beyond === 0 && Math.abs(q.lateral) < sc.path.halfWidth + margin; });
  }
}

export const AIR = { gravity: 22, lipDrop: 0.3, minLaunch: 2, maxLaunch: 8, airTurn: 1.2 };

// Ground height under the car (road + ramp) and the airborne state. A car leaving a ramp lip
// flies; while airborne it keeps its momentum and lands back on the ground. With drift held
// and steering at take-off it does a trick: a flat spin (full ramp) or a barrel roll (half
// ramp), timed to finish on landing. Landings push { type: 'land', airTime, trick, clean }
// to v.events.
// tangent: road direction under the car ({tx, tz}); airborne cars turn toward it (air control)
function airStep(v, ground, dt, ramp, tangent = null) {
  if (v.wrecked) { v.air = false; v.lastGround = ground; v.roadY = ground; return; }
  v.roadY = ground;
  if (!v.air) {
    const last = v.lastGround ?? ground;
    const vyG = (ground - last) / Math.max(dt, 1e-4);
    if (ground < last - AIR.lipDrop && (v.vyGround ?? 0) > AIR.minLaunch) {
      // off the lip: take off
      v.air = true;
      v.vy = Math.min(AIR.maxLaunch, v.vyGround);
      v.airY = last;
      v.airTime = 0;
      v.trick = null;
      if (v.inHandbrake && Math.abs(v.inSteer) > 0.3) {
        const drop = last - ground;
        const T = (v.vy + Math.sqrt(v.vy * v.vy + 2 * AIR.gravity * drop)) / AIR.gravity;
        v.trick = { kind: ramp && ramp.half ? 'roll' : 'spin', dir: Math.sign(v.inSteer), rate: (Math.PI * 2) / Math.max(0.35, T), angle: 0 };
      }
    } else {
      v.vyGround = vyG;
      v.y = ground;
    }
  }
  if (v.air) {
    v.vy -= AIR.gravity * dt;
    v.airY += v.vy * dt;
    v.airTime += dt;
    if (tangent) {
      // arcade air control: the car (and its flight) eases round to follow the road below
      const want = Math.atan2(tangent.tx, tangent.tz);
      const back = Math.abs(wrapAngle(v.heading - want)) > Math.PI / 2;
      const target = back ? want + Math.PI : want;
      const d = Math.max(-AIR.airTurn * dt, Math.min(AIR.airTurn * dt, wrapAngle(target - v.heading)));
      v.heading = wrapAngle(v.heading + d);
      const c = Math.cos(d), sn = Math.sin(d);
      const vx = v.vx * c + v.vz * sn, vz = -v.vx * sn + v.vz * c;
      v.vx = vx; v.vz = vz;
    }
    if (v.trick) v.trick.angle = Math.min(Math.PI * 2, v.trick.angle + v.trick.rate * dt);
    if (v.airY <= ground) {
      v.air = false;
      v.vyGround = 0;
      const t = v.trick;
      (v.events || (v.events = [])).push({ type: 'land', airTime: v.airTime, trick: t ? t.kind : null, clean: !t || t.angle > Math.PI * 1.6, impact: -v.vy });
      v.trick = null;
      v.y = ground;
    } else {
      v.y = v.airY;
      const sp = Math.hypot(v.vx, v.vz) || 1;
      v.pitch = Math.max(-0.5, Math.min(0.5, -Math.atan2(v.vy, sp) * 0.7));
    }
  }
  v.trickYaw = v.trick && v.trick.kind === 'spin' ? v.trick.angle * v.trick.dir : 0;
  v.trickRoll = v.trick && v.trick.kind === 'roll' ? v.trick.angle * v.trick.dir : 0;
  v.lastGround = ground;
}

// Keeps a vehicle on whichever road it is on. At the fork and the merge the barrier between the
// roads is open, and a car crossing that edge switches roads. On a shortcut, v.s is mapped back
// onto the main road (so race progress keeps working) and v.sc / v.scU / v.scIdx hold the
// position along it. Returns the wall hit (if any) like Vehicle.constrain.
export function constrainOnRoads(v, track, set, dt = 1 / 120, tmpP = {}, tmpQ = {}) {
  const list = set ? set.list : [];
  if (v.onSC && v.sc) {
    const sc = v.sc, path = sc.path;
    const q = path.project(v.x, v.z, v.scIdx ?? -1, tmpQ);
    const atEnd = q.beyond !== 0 || q.s < sc.overlapIn + 6 || q.s > path.length - sc.overlapOut - 6;
    let leave = false;
    if (atEnd && !v.air) {
      const p = track.project(v.x, v.z, v.idx, tmpP);
      leave = q.beyond !== 0 || Math.abs(p.lateral) <= track.halfWidth - 1.1;
    }
    if (!leave) {
      v.idx = v.scIdx ?? q.idx;
      const hit = v.constrain(path);
      v.scIdx = v.idx;
      v.scU = v.s;
      v.s = sc.mainS(v.scU);
      v.idx = Math.round(v.s / track.step) % track.n;
      airStep(v, v.y + sc.rampHeight(v.scU, v.lateral), dt, sc.rampAt(v.scU), tmpQ);
      v.lateral = sc.side * (track.halfWidth + 25); // off the main road for track-space checks
      return hit;
    }
    v.onSC = false;
    v.sc = null;
  }
  const p = track.project(v.x, v.z, v.idx, tmpP);
  if (Math.abs(p.lateral) > track.halfWidth - 1.1) {
    for (const sc of list) {
      if (!sc.isGap(p.s, Math.sign(p.lateral))) continue;
      const q = sc.path.project(v.x, v.z, -1, tmpQ);
      if (q.beyond === 0 && Math.abs(q.lateral) <= sc.path.halfWidth - 1.1) {
        v.onSC = true;
        v.sc = sc;
        v.scIdx = q.idx;
        return constrainOnRoads(v, track, set, dt, tmpP, tmpQ);
      }
    }
  }
  const hit = v.constrain(track);
  airStep(v, v.y, dt, null);
  return hit;
}

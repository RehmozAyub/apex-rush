// Showing a car driven on the other device. States arrive ~60 times a second, each a little old,
// so the car is drawn predicted forward to "now" (dead reckoning: it keeps its speed and turn
// rate). When a new state disagrees with what is on screen, the difference is blended out over
// SMOOTH.blend seconds instead of snapping, unless it is a big jump (a respawn).
export const SMOOTH = {
  blend: 0.15, // s to blend out a correction
  snap: 12, // m: a correction bigger than this snaps
  maxPredict: 0.25, // s: never predict further ahead than this (a stalled connection)
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// state `st` (see protocol.js) moved forward by dt seconds; writes x, z, heading, vx, vz into out
export function predict(st, dt, out) {
  const turn = st.yawRate * dt;
  const half = turn / 2, c = Math.cos(half), s = Math.sin(half);
  // average velocity over the step: the velocity turned by half the heading change
  const ax = st.vx * c + st.vz * s, az = st.vz * c - st.vx * s;
  out.x = st.x + ax * dt;
  out.z = st.z + az * dt;
  out.heading = st.heading + turn;
  const c2 = Math.cos(turn), s2 = Math.sin(turn);
  out.vx = st.vx * c2 + st.vz * s2;
  out.vz = st.vz * c2 - st.vx * s2;
  return out;
}

export class RemoteCar {
  constructor() {
    this.last = null; // latest state
    this.lastT = -Infinity; // its shared time
    this.err = { x: 0, z: 0, y: 0, h: 0 };
    this.shown = null; // what was drawn last (x, y, z, heading, ...)
    this.tmp = {};
  }

  // a new state stamped `t`; `now` is the current shared time. Returns false if it is stale.
  push(t, st, now) {
    if (t <= this.lastT) return false;
    const e = this.err;
    const had = this.last;
    // where the old state (plus the correction still being blended) puts the car now...
    let ox = 0, oz = 0, oy = 0, oh = 0;
    if (had) { const o = this.at(now, this.tmp); ox = o.x + e.x; oz = o.z + e.z; oy = o.y + e.y; oh = o.heading + e.h; }
    this.last = st;
    this.lastT = t;
    if (!had) return true;
    // ...versus where the new one does: blend that difference out
    const p = this.at(now, this.tmp);
    e.x = ox - p.x; e.z = oz - p.z; e.y = oy - p.y; e.h = wrap(oh - p.heading);
    if (Math.hypot(e.x, e.z) > SMOOTH.snap || (st.flags & 1) !== (had.flags & 1)) e.x = e.z = e.y = e.h = 0;
    return true;
  }

  // predicted state (no correction blending) at shared time `now`
  at(now, out = {}) {
    const st = this.last;
    const wrecked = st.flags & 1;
    const dt = wrecked ? 0 : Math.max(0, Math.min(SMOOTH.maxPredict, now - this.lastT));
    predict(st, dt, out);
    out.y = st.y;
    return out;
  }

  // the state to draw at shared time `now`, `dt` seconds after the last call
  sample(now, dt) {
    if (!this.last) return null;
    const st = this.last;
    const out = this.shown || (this.shown = {});
    Object.assign(out, st);
    this.at(now, out);
    const e = this.err, k = Math.exp(-dt / (SMOOTH.blend / 3)); // ~95% gone after `blend`
    e.x *= k; e.z *= k; e.y *= k; e.h *= k;
    out.x += e.x; out.z += e.z; out.y += e.y; out.heading += e.h;
    return out;
  }
}

// Recent positions of a car, for checking a hit claim against where the car really was.
export class History {
  constructor(seconds = 1.5) { this.keep = seconds; this.list = []; }
  add(t, x, z, speed) {
    this.list.push({ t, x, z, speed });
    while (this.list.length > 2 && this.list[0].t < t - this.keep) this.list.shift();
  }
  // position at shared time t (interpolated; clamped to the ends)
  at(t) {
    const L = this.list;
    if (!L.length) return null;
    if (t <= L[0].t) return L[0];
    for (let i = 1; i < L.length; i++) {
      if (L[i].t < t) continue;
      const a = L[i - 1], b = L[i], f = (t - a.t) / (b.t - a.t || 1);
      return { t, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, speed: a.speed + (b.speed - a.speed) * f };
    }
    return L[L.length - 1];
  }
}

// Takedown replay: keeps the last few seconds of every car's pose, and when a player scores a
// takedown it saves a clip around it. The best clip of the race is replayed on the results screen.
const FIELDS = 11; // position (3), quaternion (4), body lift, body pitch, body roll, wrecked
const RATE = 30;

export class ReplayRecorder {
  constructor(carCount, { keep = 7, before = 2.6, after = 2.2 } = {}) {
    this.n = carCount;
    this.keep = keep; this.before = before; this.after = after;
    this.frames = []; // { t, data }
    this.next = 0;
    this.pending = [];
    this.best = null;
  }

  record(time, cars) {
    if (time < this.next) return;
    this.next = time + 1 / RATE;
    const d = new Float32Array(this.n * FIELDS);
    cars.forEach((c, i) => {
      const r = c.model.root, b = c.model.body, o = i * FIELDS;
      d[o] = r.position.x; d[o + 1] = r.position.y; d[o + 2] = r.position.z;
      d[o + 3] = r.quaternion.x; d[o + 4] = r.quaternion.y; d[o + 5] = r.quaternion.z; d[o + 6] = r.quaternion.w;
      d[o + 7] = b.position.y; d[o + 8] = b.rotation.x; d[o + 9] = b.rotation.z; d[o + 10] = c.vehicle.wrecked ? 1 : 0;
    });
    this.frames.push({ t: time, data: d });
    while (this.frames.length && this.frames[0].t < time - this.keep) this.frames.shift();
    this.update(time);
  }

  // a takedown happened: info = { victim (car index), score, label, name }
  mark(time, info) {
    if (this.best && this.best.score >= info.score && this.pending.every((p) => p.score < info.score)) return;
    this.pending.push({ ...info, t: time });
  }

  update(time) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (time < p.t + this.after) continue;
      this.pending.splice(i, 1);
      if (this.best && this.best.score >= p.score) continue;
      const frames = this.frames.filter((f) => f.t >= p.t - this.before && f.t <= p.t + this.after);
      if (frames.length > 10) this.best = { ...p, frames, t0: frames[0].t, t1: frames[frames.length - 1].t };
    }
  }

  // finish clips still waiting for their "after" part (race over)
  flush() {
    for (const p of this.pending.splice(0)) {
      if (this.best && this.best.score >= p.score) continue;
      const frames = this.frames.filter((f) => f.t >= p.t - this.before);
      if (frames.length > 10) this.best = { ...p, frames, t0: frames[0].t, t1: frames[frames.length - 1].t };
    }
  }
}

// Pose car models from a clip at time t (interpolated).
export function applyClip(clip, t, cars) {
  const fr = clip.frames;
  let k = 0;
  while (k < fr.length - 2 && fr[k + 1].t < t) k++;
  const a = fr[k], b = fr[Math.min(fr.length - 1, k + 1)];
  const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  cars.forEach((c, i) => {
    const o = i * FIELDS, A = a.data, B = b.data;
    const lerp = (j) => A[o + j] + (B[o + j] - A[o + j]) * f;
    const m = c.model;
    m.root.position.set(lerp(0), lerp(1), lerp(2));
    m.root.quaternion.set(lerp(3), lerp(4), lerp(5), lerp(6)).normalize();
    m.body.position.y = lerp(7);
    m.body.rotation.set(lerp(8), 0, lerp(9));
    const wrecked = (f < 0.5 ? A : B)[o + 10] > 0.5;
    for (const w of m.wheels) w.group.position.y = wrecked ? m.wheelR - 0.6 : m.wheelR;
    m.shadow.visible = !wrecked;
    m.root.visible = true;
  });
}

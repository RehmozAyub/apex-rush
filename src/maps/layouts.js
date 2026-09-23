// Track centreline control points for each map (pure data, no three.js).

// Star-shaped loop: radius varies with a few harmonics, so it can never self-intersect.
function radial({ count, R, harmonics, sx = 1, sz = 1, elevation, rot = 0 }) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2;
    let r = 1;
    for (const [k, amp, ph] of harmonics) r += amp * Math.sin(k * th + ph);
    r *= R;
    const a = th + rot;
    pts.push([Math.cos(a) * r * sx, elevation(th), Math.sin(a) * r * sz]);
  }
  return pts;
}

// Polyline with every corner replaced by a circular fillet; straights get evenly spaced points.
function filleted(corners, radius, y = () => 0, spacing = 45) {
  const m = corners.length;
  const arcs = [];
  for (let i = 0; i < m; i++) {
    const A = corners[(i - 1 + m) % m], P = corners[i], B = corners[(i + 1) % m];
    let d1x = P[0] - A[0], d1z = P[1] - A[1];
    let d2x = B[0] - P[0], d2z = B[1] - P[1];
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    const turn = Math.atan2(d1x * d2z - d1z * d2x, d1x * d2x + d1z * d2z);
    const r = Array.isArray(radius) ? radius[i] : radius;
    const t = r * Math.tan(Math.abs(turn) / 2);
    const S = [P[0] - d1x * t, P[1] - d1z * t];
    // left normal of d1 is (-d1z, d1x); centre lies on the inside of the turn
    const side = Math.sign(turn);
    const C = [S[0] - d1z * r * side, S[1] + d1x * r * side];
    const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]);
    const steps = Math.max(2, Math.ceil(Math.abs(turn) / (Math.PI / 10)));
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const a = a0 + turn * (k / steps);
      pts.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]);
    }
    arcs.push(pts);
  }
  const out = [];
  for (let i = 0; i < m; i++) {
    const arc = arcs[i];
    for (const p of arc) out.push(p);
    const end = arc[arc.length - 1], next = arcs[(i + 1) % m][0];
    const len = Math.hypot(next[0] - end[0], next[1] - end[1]);
    const k = Math.floor(len / spacing);
    for (let j = 1; j < k; j++) {
      const f = j / k;
      out.push([end[0] + (next[0] - end[0]) * f, end[1] + (next[1] - end[1]) * f]);
    }
  }
  return out.map(([x, z]) => [x, y(x, z), z]);
}

export const LAYOUTS = {
  coast: {
    width: 20,
    points: radial({
      count: 36,
      R: 400,
      sx: 1.25,
      sz: 1.0,
      harmonics: [[2, 0.14, 0.4], [3, 0.1, 1.9], [4, 0.05, 2.6], [5, 0.05, 0.2], [7, 0.025, 1.3]],
      elevation: (th) => 14 + 9 * Math.sin(2 * th + 1.2) + 5 * Math.sin(3 * th + 0.3),
    }),
  },
  city: {
    width: 20,
    points: filleted(
      [
        [-420, -260], [140, -260], [140, -110], [430, -110], [430, 300],
        [70, 300], [70, 130], [-190, 130], [-190, 300], [-420, 300],
      ],
      [60, 42, 42, 60, 55, 42, 42, 42, 42, 60],
    ),
  },
  alpine: {
    width: 18,
    points: radial({
      count: 40,
      R: 380,
      sx: 1.0,
      sz: 1.2,
      harmonics: [[2, 0.18, 2.1], [3, 0.13, 0.2], [4, 0.07, 1.1], [6, 0.045, 0.5], [8, 0.02, 2.0]],
      elevation: (th) => 30 + 20 * Math.sin(th + 0.5) + 7 * Math.sin(3 * th + 1),
    }),
  },
  snow: {
    width: 18,
    points: radial({
      count: 40,
      R: 370,
      sx: 1.12,
      sz: 1.0,
      harmonics: [[2, 0.16, 1.0], [3, 0.12, 2.4], [5, 0.05, 0.8], [7, 0.025, 0.2]],
      elevation: (th) => 42 + 18 * Math.sin(th + 2) + 8 * Math.sin(2 * th + 0.4),
    }),
  },
  canyon: {
    width: 20,
    points: filleted(
      [[-640, -200], [180, -330], [640, -110], [580, 270], [150, 170], [-100, 390], [-580, 300]],
      [130, 115, 105, 95, 85, 95, 120],
      (x, z) => 10 + 7 * Math.sin(x * 0.004) + 5 * Math.cos(z * 0.005),
      50,
    ),
  },
  jungle: {
    width: 18,
    points: radial({
      count: 44,
      R: 350,
      sx: 1.0,
      sz: 1.25,
      harmonics: [[2, 0.2, 0.3], [3, 0.1, 1.2], [4, 0.07, 2.2], [6, 0.035, 1.0], [9, 0.012, 0.4]],
      elevation: (th) => 20 + 10 * Math.sin(2 * th) + 6 * Math.sin(3 * th + 1),
    }),
  },
};

// Procedural asphalt pixels for one 40 m road tile: albedo + normal + roughness.
// Stone aggregate, pits, cracks, tar crack-sealing, repair patches, oil stains, tyre-worn wheel
// paths, chipped paint, edge grime / snow / sand, optional wet puddles. Tiles along the road (v).
// Pure maths (no DOM, no three.js) so it runs in a Web Worker and in node tests.
// Row 0 of the output is v = 0 (DataTexture orientation).

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// '#rrggbb' or 0xrrggbb -> sRGB 0..1 (the canvas is sRGB, so no linear conversion here)
const hex = (h) => {
  const n = typeof h === 'number' ? h : parseInt(String(h).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Tileable value noise at a given cell size (period wraps in both axes).
function noiseLayer(W, H, cell) {
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(W * H);
  const X0 = new Int32Array(W), X1 = new Int32Array(W), SX = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const gx = x / cell, ix = Math.floor(gx), fx = gx - ix;
    X0[x] = ix % gw; X1[x] = (ix + 1) % gw; SX[x] = fx * fx * (3 - 2 * fx);
  }
  for (let y = 0; y < H; y++) {
    const gy = y / cell, iy = Math.floor(gy), fy = gy - iy;
    const sy = fy * fy * (3 - 2 * fy);
    const y0 = (iy % gh) * gw, y1 = ((iy + 1) % gh) * gw;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const sx = SX[x];
      const a = grid[y0 + X0[x]], b = grid[y0 + X1[x]], c = grid[y1 + X0[x]], d = grid[y1 + X1[x]];
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      out[row + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

export function generatePixels(o = {}, size = 'high') {
  seed = o.seed ?? 11;
  const W = size === 'low' ? 512 : size === 'high' ? 1024 : size, H = W * 2; // across x along
  const S = W / 1024; // scale for pixel sizes
  const N = W * H;
  const alb = new Float32Array(N * 3);
  const hgt = new Float32Array(N);
  const rough = new Float32Array(N);
  const base = hex(o.base ?? '#2e2e33');
  const baseRough = o.roughness ?? 0.85;
  const lanes = o.lanes ?? 3;

  // 1) base tone: large blotches + fine grain
  const n256 = noiseLayer(W, H, 256 * S), n64 = noiseLayer(W, H, 64 * S), n8 = noiseLayer(W, H, Math.max(2, 8 * S)), n3 = noiseLayer(W, H, Math.max(2, 4 * S)); // cell sizes divide H so the tile wraps seamlessly
  for (let i = 0; i < N; i++) {
    const macro = n256[i] * 0.6 + n64[i] * 0.4;
    const fine = n8[i] * 0.5 + n3[i] * 0.5;
    const k = (0.84 + 0.2 * macro) * (0.86 + 0.28 * fine);
    alb[i * 3] = base[0] * k; alb[i * 3 + 1] = base[1] * k; alb[i * 3 + 2] = base[2] * k;
    hgt[i] = fine * 0.35;
    rough[i] = baseRough + (fine - 0.5) * 0.08;
  }

  const disc = (cx, cy, r, fn) => {
    const r2 = r * r;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      const y = ((Math.round(cy) + dy) % H + H) % H;
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const x = Math.round(cx) + dx;
        if (x < 0 || x >= W) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        fn(y * W + x, 1 - d2 / r2);
      }
    }
  };
  const tint = (i, k, add = 0) => { alb[i * 3] = alb[i * 3] * k + add; alb[i * 3 + 1] = alb[i * 3 + 1] * k + add; alb[i * 3 + 2] = alb[i * 3 + 2] * k + add; };

  // 2) stone aggregate and pits
  const aggregate = o.aggregate ?? 1;
  const stones = Math.round((N / 42) * aggregate);
  for (let s = 0; s < stones; s++) {
    const light = rnd() < 0.62;
    const r = (0.7 + rnd() * 1.8) * S + 0.3;
    const k = light ? 1.07 + rnd() * 0.2 : 0.62 + rnd() * 0.18;
    disc(rnd() * W, rnd() * H, r, (i, f) => { tint(i, 1 + (k - 1) * Math.min(1, f * 2)); hgt[i] += f * 0.5; });
  }
  for (let s = 0; s < N / 500; s++) {
    disc(rnd() * W, rnd() * H, (0.8 + rnd() * 1.4) * S + 0.3, (i, f) => { tint(i, 1 - 0.55 * f); hgt[i] -= f * 1.1; });
  }

  // 3) tyre-worn wheel paths: darker, polished, stones worn flat
  const wear = o.wear ?? 1;
  const laneW = W / lanes;
  const paths = [];
  for (let l = 0; l < lanes; l++) for (const off of [-0.2, 0.2]) paths.push((l + 0.5) * laneW + off * laneW);
  const halfPath = laneW * 0.075;
  const cols = [], colP = [];
  for (let x = 0; x < W; x++) {
    let p = 0;
    for (const c of paths) p = Math.max(p, Math.max(0, 1 - Math.abs(x - c) / halfPath));
    if (p > 0) { cols.push(x); colP.push(p * p * (3 - 2 * p) * wear); }
  }
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < cols.length; k++) {
      const i = y * W + cols[k], p = colP[k];
      const v = 0.75 + 0.5 * n64[i];
      const f = 1 - 0.16 * p * v;
      alb[i * 3] *= f; alb[i * 3 + 1] *= f; alb[i * 3 + 2] *= f;
      hgt[i] *= 1 - 0.55 * p;
      rough[i] -= 0.2 * p * v;
    }
  }

  // 4) repair patches
  const patches = Math.round((o.patches ?? 2) * (0.6 + rnd() * 0.8));
  for (let k = 0; k < patches; k++) {
    const pw = (80 + rnd() * 220) * S, ph = (120 + rnd() * 500) * S;
    const px = rnd() * (W - pw), py = rnd() * H;
    const tone = 0.72 + rnd() * 0.22;
    for (let dy = 0; dy < ph; dy++) {
      const y = Math.floor(py + dy) % H;
      for (let dx = 0; dx < pw; dx++) {
        const i = y * W + Math.floor(px + dx);
        const edge = Math.min(dx, dy, pw - dx, ph - dy);
        if (edge < 2 * S) { tint(i, 0.45); hgt[i] -= 0.6; continue; }
        tint(i, tone);
        hgt[i] = hgt[i] * 0.6 + 0.15;
        rough[i] -= 0.05;
      }
    }
  }

  // 5) cracks and black tar crack-sealing (random walks, mostly along the road)
  const walk = (x, y, steps, r, fn) => {
    let a = Math.PI / 2 + (rnd() - 0.5) * 0.6; // mostly longitudinal
    if (rnd() < 0.25) a = (rnd() - 0.5) * 0.8; // some transverse
    for (let k = 0; k < steps; k++) {
      a += (rnd() - 0.5) * 0.7;
      x += Math.cos(a) * 2.2 * S; y += Math.sin(a) * 2.2 * S;
      if (x < 4 || x > W - 4) break;
      disc(x, y, r, fn);
      if (rnd() < 0.02) walk(x, y, Math.floor(steps * 0.3), r * 0.8, fn); // branch
    }
  };
  const cracks = o.cracks ?? 1;
  for (let k = 0; k < 10 * cracks; k++) {
    const nearLine = rnd() < 0.5;
    const x0 = nearLine ? Math.round(rnd() * lanes) * laneW + (rnd() - 0.5) * 20 * S : rnd() * W;
    walk(Math.max(6, Math.min(W - 6, x0)), rnd() * H, 40 + Math.floor(rnd() * 180), (0.7 + rnd() * 0.5) * S + 0.3, (i, f) => { tint(i, 1 - 0.7 * f); hgt[i] -= f * 1.6; });
  }
  for (let k = 0; k < 5 * cracks; k++) {
    walk(rnd() * W, rnd() * H, 60 + Math.floor(rnd() * 200), (2.4 + rnd() * 1.6) * S + 0.5, (i, f) => {
      const t = Math.min(1, f * 3);
      alb[i * 3] += (0.035 - alb[i * 3]) * t; alb[i * 3 + 1] += (0.035 - alb[i * 3 + 1]) * t; alb[i * 3 + 2] += (0.04 - alb[i * 3 + 2]) * t;
      hgt[i] = hgt[i] * (1 - t) + 0.25 * t;
      rough[i] += (0.62 - rough[i]) * t;
    });
  }

  // 6) oil stains near the lane centres
  for (let k = 0; k < (o.oil ?? 3); k++) {
    const cx = (Math.floor(rnd() * lanes) + 0.5) * laneW + (rnd() - 0.5) * laneW * 0.2, cy = rnd() * H;
    const r = (30 + rnd() * 60) * S;
    disc(cx, cy, r, (i, f) => { const t = f * (0.5 + 0.5 * n8[i]); tint(i, 1 - 0.3 * t); rough[i] -= 0.25 * t; });
  }

  // 7) paint: edge lines + lane dividers, worn and chipped
  const paint = (x0, x1, y0, y1, col) => {
    const c = hex(col);
    for (let y = y0; y < y1; y++) {
      const yy = ((y % H) + H) % H;
      for (let x = Math.floor(x0); x < x1; x++) {
        const i = yy * W + x;
        // chips: medium blotches plus per-pixel speckle so worn edges look gritty, not blocky
        const wearMask = n3[i] * 0.45 + n64[i] * 0.35 + rnd() * 0.2;
        if (wearMask < 0.26) continue; // chipped away
        const t = Math.min(1, (wearMask - 0.26) * 5) * 0.9;
        alb[i * 3] += (c[0] * 0.9 - alb[i * 3]) * t; alb[i * 3 + 1] += (c[1] * 0.9 - alb[i * 3 + 1]) * t; alb[i * 3 + 2] += (c[2] * 0.9 - alb[i * 3 + 2]) * t;
        hgt[i] += 0.35 * t;
        rough[i] += (0.55 - rough[i]) * t;
      }
    }
  };
  const lw = 12 * S * 2;
  paint(28 * S, 28 * S + lw, 0, H, o.edge ?? '#e8e8e8');
  paint(W - 28 * S - lw, W - 28 * S, 0, H, o.edge ?? '#e8e8e8');
  for (let l = 1; l < lanes; l++) {
    const x = (l / lanes) * W - 10 * S;
    if (o.dash === false) paint(x, x + 20 * S, 0, H, o.line ?? '#e8e8e8');
    else for (let y = 0; y < H; y += H / 4) paint(x, x + 20 * S, y + 80 * S, y + 380 * S, o.line ?? '#e8e8e8');
  }

  // 8) edge grime, or snow / blown sand creeping in from the edges
  const edgeCol = o.snowEdges ? [0.93, 0.95, 0.98] : o.dust ? [0.72, 0.55, 0.36] : [0.16, 0.14, 0.12];
  const edgeW = (o.snowEdges || o.dust ? 150 : 70) * S;
  const edgeStr = o.snowEdges || o.dust ? 0.95 : 0.35;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.min(x, W - 1 - x);
      if (d > edgeW) continue;
      const i = y * W + x;
      const f = Math.pow(1 - d / edgeW, 1.6) * (0.55 + 0.9 * n8[i] * n64[i]);
      const t = Math.min(1, f * edgeStr);
      alb[i * 3] += (edgeCol[0] - alb[i * 3]) * t; alb[i * 3 + 1] += (edgeCol[1] - alb[i * 3 + 1]) * t; alb[i * 3 + 2] += (edgeCol[2] - alb[i * 3 + 2]) * t;
      if (o.snowEdges || o.dust) { hgt[i] += t * 0.4; rough[i] += (0.9 - rough[i]) * t; }
    }
  }

  // 9) wet: puddles in the low spots (dark, mirror-smooth)
  if (o.wet) {
    for (let i = 0; i < N; i++) {
      hgt[i] *= 0.45; // water fills the texture: much softer relief, fewer glinting stones
      const p = n256[i] * 0.7 + n64[i] * 0.3;
      if (p < 0.58) { rough[i] = Math.max(0.12, rough[i] * 0.6); continue; }
      const t = Math.min(1, (p - 0.58) * 6);
      tint(i, 1 - 0.35 * t);
      rough[i] += (0.03 - rough[i]) * t;
      hgt[i] *= 1 - 0.85 * t;
    }
  }

  // --- pack into RGBA byte arrays ---
  const albedo = new Uint8ClampedArray(N * 4), normal = new Uint8ClampedArray(N * 4), roughOut = new Uint8ClampedArray(N * 4);
  const strength = (o.normalStrength ?? 1.4) / S;
  for (let y = 0; y < H; y++) {
    const yu = ((y - 1 + H) % H) * W, yd = ((y + 1) % H) * W;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x, o4 = i * 4;
      albedo[o4] = alb[i * 3] * 255; albedo[o4 + 1] = alb[i * 3 + 1] * 255; albedo[o4 + 2] = alb[i * 3 + 2] * 255; albedo[o4 + 3] = 255;
      const hl = hgt[row + (x > 0 ? x - 1 : 0)], hr = hgt[row + (x < W - 1 ? x + 1 : x)];
      const nx = -(hr - hl) * strength, ny = -(hgt[yd + x] - hgt[yu + x]) * strength; // row index grows with v
      const il = 127.5 / Math.sqrt(nx * nx + ny * ny + 1);
      normal[o4] = nx * il + 127.5; normal[o4 + 1] = ny * il + 127.5; normal[o4 + 2] = il + 127.5; normal[o4 + 3] = 255;
      const rv = rough[i];
      roughOut[o4] = roughOut[o4 + 1] = roughOut[o4 + 2] = (rv < 0.02 ? 0.02 : rv) * 255;
      roughOut[o4 + 3] = 255;
    }
  }
  return { W, H, albedo, normal, rough: roughOut };
}

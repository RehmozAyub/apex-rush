// Canvas-generated textures (road, checker, windows, gradients) so the game ships no image files.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

let seed = 1;
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

// Road: asphalt grain + edge lines + dashed lane lines. u = across, v = along (one tile = 40 m).
export function roadTexture({ base = '#2a2a2e', line = '#e8e8e8', edge = '#e8e8e8', lanes = 3, wet = false, dash = true, snowEdges = false, dust = false }) {
  seed = 7;
  const [c, g] = canvas(512, 1024);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 1024);
  const img = g.getImageData(0, 0, 512, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 34 + (rnd() < 0.02 ? 30 : 0);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // tyre-wear bands
  g.globalAlpha = 0.18;
  g.fillStyle = '#101012';
  for (let l = 0; l < lanes; l++) {
    const cx = ((l + 0.5) / lanes) * 512;
    g.fillRect(cx - 70, 0, 26, 1024);
    g.fillRect(cx + 44, 0, 26, 1024);
  }
  g.globalAlpha = 1;
  // patches
  for (let i = 0; i < 14; i++) {
    g.globalAlpha = 0.07 + rnd() * 0.08;
    g.fillStyle = rnd() < 0.5 ? '#000' : '#555';
    g.fillRect(rnd() * 512, rnd() * 1024, 30 + rnd() * 120, 20 + rnd() * 90);
  }
  g.globalAlpha = 1;
  g.fillStyle = edge;
  g.fillRect(14, 0, 12, 1024);
  g.fillRect(512 - 26, 0, 12, 1024);
  g.fillStyle = line;
  for (let l = 1; l < lanes; l++) {
    const x = (l / lanes) * 512 - 5;
    if (dash) for (let y = 0; y < 1024; y += 256) g.fillRect(x, y + 40, 10, 150);
    else g.fillRect(x, 0, 10, 1024);
  }
  if (snowEdges || dust) {
    // packed snow / blown sand creeping in from both edges, plus tyre tracks left clear
    const col = snowEdges ? '240,244,250' : '214,170,110';
    for (const side of [0, 1]) {
      const grd = g.createLinearGradient(side ? 512 : 0, 0, side ? 512 - 110 : 110, 0);
      grd.addColorStop(0, `rgba(${col},0.95)`);
      grd.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = grd;
      g.fillRect(side ? 402 : 0, 0, 110, 1024);
    }
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * 512, y = rnd() * 1024;
      const edgeness = Math.max(0, 1 - Math.min(x, 512 - x) / 170);
      if (rnd() > edgeness * 0.9 + 0.04) continue;
      g.fillStyle = `rgba(${col},${0.35 + rnd() * 0.5})`;
      g.fillRect(x, y, 2 + rnd() * 7, 2 + rnd() * 7);
    }
  }
  const t = tex(c, { aniso: 16 });
  if (wet) {
    // puddle mask for roughness: darker = glossier
    const [c2, g2] = canvas(256, 512);
    g2.fillStyle = '#b0b0b0';
    g2.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 40; i++) {
      g2.fillStyle = `rgba(20,20,20,${0.4 + rnd() * 0.5})`;
      g2.beginPath();
      g2.ellipse(rnd() * 256, rnd() * 512, 10 + rnd() * 50, 20 + rnd() * 90, 0, 0, Math.PI * 2);
      g2.fill();
    }
    t.userData.roughness = tex(c2, { srgb: false });
  }
  return t;
}

export function checkerTexture(cells = 8, rows = 2) {
  const [c, g] = canvas(cells * 32, rows * 32);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cells; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  const t = tex(c, { repeat: false });
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Building facade with lit windows. Returns { map, emissive }.
export function windowTextures({ cols = 8, rows = 16, wall = '#1a1d24', lit = ['#ffd9a0', '#9fd8ff', '#ffffff'], litChance = 0.45, frame = '#0c0e12', seedValue = 3 }) {
  seed = seedValue;
  const cw = 32, rh = 32;
  const [c, g] = canvas(cols * cw, rows * rh);
  const [e, ge] = canvas(cols * cw, rows * rh);
  g.fillStyle = wall;
  g.fillRect(0, 0, c.width, c.height);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, e.width, e.height);
  for (let y = 0; y < rows; y++) {
    const rowLit = rnd() < 0.85;
    for (let x = 0; x < cols; x++) {
      const px = x * cw + 5, py = y * rh + 6, w = cw - 10, h = rh - 12;
      g.fillStyle = frame;
      g.fillRect(px - 1, py - 1, w + 2, h + 2);
      g.fillStyle = '#20252e';
      g.fillRect(px, py, w, h);
      if (rowLit && rnd() < litChance) {
        const col = lit[Math.floor(rnd() * lit.length)];
        const k = 0.5 + rnd() * 0.5;
        ge.globalAlpha = k;
        ge.fillStyle = col;
        ge.fillRect(px, py, w, h);
        g.fillStyle = col;
        g.globalAlpha = 0.5;
        g.fillRect(px, py, w, h);
        g.globalAlpha = 1;
      }
    }
  }
  ge.globalAlpha = 1;
  return { map: tex(c), emissive: tex(e) };
}

// Daytime concrete/glass facade (no emissive).
export function facadeTexture({ cols = 6, rows = 12, wall = '#c9c4ba', glass = '#5a6a7a' }) {
  seed = 11;
  const [c, g] = canvas(cols * 32, rows * 32);
  g.fillStyle = wall;
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const v = 0.8 + rnd() * 0.3;
    g.fillStyle = glass;
    g.globalAlpha = v;
    g.fillRect(x * 32 + 5, y * 32 + 7, 22, 18);
  }
  g.globalAlpha = 1;
  return tex(c);
}

// Soft radial blob, used for fake light pools and car contact shadows.
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return tex(c, { repeat: false });
}

// Text banner (start gantry, billboards).
export function textTexture(text, { w = 1024, h = 256, bg = '#0b0b10', fg = '#ffffff', accent = '#ff2d55', font = 'italic 900 150px Bahnschrift, "Segoe UI", sans-serif', stripes = true } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (stripes) {
    g.fillStyle = accent;
    g.fillRect(0, 0, w, 14);
    g.fillRect(0, h - 14, w, 14);
  }
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = fg;
  g.fillText(text, w / 2, h / 2 + 6);
  return tex(c, { repeat: false });
}

// Simple vertical gradient texture for skies behind billboards / neon signs.
export function neonSignTexture(text, color) {
  const [c, g] = canvas(512, 160);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 160);
  g.font = 'italic 800 104px Bahnschrift, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeText(text, 256, 84);
  g.fillStyle = '#fff';
  g.fillText(text, 256, 84);
  g.strokeRect(10, 10, 492, 140);
  return tex(c, { repeat: false });
}

export function kerbTexture(a = '#d01818', b = '#f2f2f2') {
  const [c, g] = canvas(64, 128);
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  g.fillRect(0, 64, 64, 64);
  const t = tex(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

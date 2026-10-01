// Draws the APEX RUSH icon (dark rounded tile with a slanted "A" chevron and speed stripes) and writes
// every size the builds use: electron/icon.png, the web-app icons in game/icons and the Android
// launcher icons (legacy tiles plus adaptive background/foreground layers).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mix = (a, b, t) => a + (b - a) * t;
const hot = [255, 45, 85], orange = [255, 138, 0];

function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// artwork in a 256 x 256 design space: slanted chevron "A", crossbar and two speed stripes
const sk = (x, y) => [x + (200 - y) * 0.28, y];
const chevron = [[40, 210], [118, 40], [160, 40], [238, 210], [196, 210], [139, 84], [82, 210]].map(([x, y]) => sk(x, y));
const bar = [[98, 150], [180, 150], [192, 176], [86, 176]].map(([x, y]) => sk(x, y));
const stripes = [[[6, 120], [60, 120], [55, 130], [1, 130]], [[0, 146], [44, 146], [39, 156], [0, 156]]];

const background = (x, y) => {
  const g = y / 256;
  return [mix(22, 8, g), mix(14, 8, g), mix(34, 16, g), 255];
};
const mark = (x, y) => {
  const t = Math.min(1, Math.max(0, (x + y) / (256 * 1.6)));
  if (inPoly(x, y, chevron) || inPoly(x, y, bar)) return [mix(hot[0], orange[0], t), mix(hot[1], orange[1], t), mix(hot[2], orange[2], t), 255];
  if (stripes.some((s) => inPoly(x, y, s))) return [25, 227, 255, 255];
  return null;
};
const rounded = (x, y) => {
  const r = 44, cx = Math.min(Math.max(x, r), 255 - r), cy = Math.min(Math.max(y, r), 255 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// layers: 'tile' = rounded icon, 'bg' = full-bleed background, 'fg' = the mark alone, shrunk into
// the adaptive-icon safe zone on a transparent canvas
const LAYERS = {
  tile: (x, y) => (rounded(x, y) ? mark(x, y) || background(x, y) : [0, 0, 0, 0]),
  bg: (x, y) => background(x, y),
  fg: (x, y) => mark((x - 128) / 0.56 + 128, (y - 128) / 0.56 + 128) || [0, 0, 0, 0],
};

function render(N, layer, ss = 4) {
  const f = LAYERS[layer];
  const px = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = f(((x + (sx + 0.5) / ss) * 256) / N, ((y + (sy + 0.5) / ss) * 256) / N);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const o = (y * N + x) * 4;
      px[o] = a ? r / a : 0; px[o + 1] = a ? g / a : 0; px[o + 2] = a ? b / a : 0; px[o + 3] = a / (ss * ss);
    }
  }
  return png(N, px);
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(N, px) {
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const root = fileURLToPath(new URL('..', import.meta.url));
function out(path, N, layer) {
  const file = root + path;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(N, layer));
  console.log('wrote', path);
}

out('electron/icon.png', 256, 'tile');
out('game/icons/icon-192.png', 192, 'tile');
out('game/icons/icon-512.png', 512, 'tile');
out('game/icons/apple-touch-icon.png', 180, 'bg');
const res = 'android/app/src/main/res/';
for (const [dpi, s] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  out(`${res}mipmap-${dpi}/ic_launcher.png`, 48 * s, 'tile');
  out(`${res}mipmap-${dpi}/ic_launcher_background.png`, 108 * s, 'bg');
  out(`${res}mipmap-${dpi}/ic_launcher_foreground.png`, 108 * s, 'fg');
}
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
mkdirSync(root + res + 'mipmap-anydpi-v26', { recursive: true });
writeFileSync(root + res + 'mipmap-anydpi-v26/ic_launcher.xml', adaptive);
console.log('wrote', res + 'mipmap-anydpi-v26/ic_launcher.xml');

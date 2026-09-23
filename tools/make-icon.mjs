// Writes electron/icon.png (256x256): dark rounded tile with a slanted "A" chevron and speed stripes.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const N = 256;
const px = Buffer.alloc(N * N * 4);
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

// slanted chevron "A" and crossbar
const sk = (x, y) => [x + (200 - y) * 0.28, y];
const chevron = [[40, 210], [118, 40], [160, 40], [238, 210], [196, 210], [139, 84], [82, 210]].map(([x, y]) => sk(x, y));
const bar = [[98, 150], [180, 150], [192, 176], [86, 176]].map(([x, y]) => sk(x, y));
const stripes = [[[6, 120], [60, 120], [55, 130], [1, 130]], [[0, 146], [44, 146], [39, 156], [0, 156]]];

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const o = (y * N + x) * 4;
    // rounded square mask
    const r = 44, cx = Math.min(Math.max(x, r), N - 1 - r), cy = Math.min(Math.max(y, r), N - 1 - r);
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    if (!inside) { px[o + 3] = 0; continue; }
    const g = y / N;
    let c = [mix(22, 8, g), mix(14, 8, g), mix(34, 16, g)];
    const t = Math.min(1, Math.max(0, (x + y) / (N * 1.6)));
    if (inPoly(x, y, chevron) || inPoly(x, y, bar)) c = [mix(hot[0], orange[0], t), mix(hot[1], orange[1], t), mix(hot[2], orange[2], t)];
    else if (stripes.some((s) => inPoly(x, y, s))) c = [25, 227, 255];
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
}

const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../electron/icon.png', import.meta.url), png);
console.log('icon written', png.length, 'bytes');

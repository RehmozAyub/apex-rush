// One icon per power-up, drawn on a canvas so the road blocks and the HUD use the same picture:
// shockwave = burst rings, ricochet = bouncing arrow, lightning strike = bolt, oil slick = drop.
import { POWERS } from './powerups.js';

export function drawPowerIcon(g, id, S, color = POWERS[id].color) {
  const k = S / 64;
  g.save();
  g.scale(k, k);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.fillStyle = color;
  g.strokeStyle = color;
  const outline = (path) => {
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.stroke(path);
    g.fill(path);
    g.lineWidth = 2.2; g.strokeStyle = '#fff'; g.stroke(path);
  };
  if (id === 'shockwave') {
    g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,0.7)';
    for (const r of [15, 26]) { g.beginPath(); g.arc(32, 32, r, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 4.5; g.strokeStyle = color;
    for (const r of [15, 26]) { g.beginPath(); g.arc(32, 32, r, 0, Math.PI * 2); g.stroke(); }
    const c = new Path2D(); c.arc(32, 32, 7.5, 0, Math.PI * 2);
    outline(c);
  } else if (id === 'ricochet') {
    const zig = [[6, 50], [20, 16], [34, 46], [46, 20]];
    for (const [w, col] of [[10, 'rgba(0,0,0,0.7)'], [5, color]]) {
      g.lineWidth = w; g.strokeStyle = col; g.beginPath();
      zig.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    const ball = new Path2D(); ball.arc(50, 13, 9, 0, Math.PI * 2);
    outline(ball);
  } else if (id === 'strike') {
    outline(new Path2D('M38 3 L12 36 L29 36 L22 61 L52 25 L35 25 L43 3 Z'));
  } else {
    outline(new Path2D('M32 5 C32 5 11 30 11 42 A21 20 0 0 0 53 42 C53 30 32 5 32 5 Z'));
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.ellipse(24, 42, 3.5, 7, -0.3, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

const urls = {};
// PNG data URL of an icon, cached (for the HUD and How to Play screen).
export function powerIconURL(id, S = 128) {
  if (!urls[id]) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    drawPowerIcon(c.getContext('2d'), id, S);
    urls[id] = c.toDataURL();
  }
  return urls[id];
}

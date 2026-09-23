// 2D minimap canvas: pre-rendered track outline + car dots.
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
  }

  setTrack(track, accent = '#ff2d55') {
    const size = this.canvas.width;
    this.bg.width = this.bg.height = size;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < track.n; i++) {
      x0 = Math.min(x0, track.x[i]); x1 = Math.max(x1, track.x[i]);
      z0 = Math.min(z0, track.z[i]); z1 = Math.max(z1, track.z[i]);
    }
    const pad = 14;
    this.scale = (size - pad * 2) / Math.max(x1 - x0, z1 - z0);
    this.ox = size / 2 - ((x0 + x1) / 2) * this.scale;
    this.oz = size / 2 - ((z0 + z1) / 2) * this.scale;
    const g = this.bg.getContext('2d');
    g.clearRect(0, 0, size, size);
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= track.n; i += 3) {
        const k = i % track.n;
        const [px, py] = this.map(track.x[k], track.z[k]);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
    };
    g.lineJoin = 'round';
    path(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 9; g.stroke();
    path(); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 4; g.stroke();
    // start line
    const [sx, sy] = this.map(track.x[0], track.z[0]);
    g.fillStyle = accent;
    g.fillRect(sx - 4, sy - 4, 8, 8);
    this.accent = accent;
  }

  // world x/z -> canvas; flip x so the map matches the view when looking north
  map(x, z) {
    return [this.canvas.width - (x * this.scale + this.ox), this.canvas.height - (z * this.scale + this.oz)];
  }

  draw(cars, player) {
    const g = this.ctx, size = this.canvas.width;
    g.clearRect(0, 0, size, size);
    g.drawImage(this.bg, 0, 0);
    for (const c of cars) {
      if (c.isPlayer) continue;
      const [px, py] = this.map(c.vehicle.x, c.vehicle.z);
      g.beginPath();
      g.arc(px, py, 4, 0, Math.PI * 2);
      g.fillStyle = c.vehicle.wrecked ? '#555' : '#' + c.paint.toString(16).padStart(6, '0');
      g.fill();
      g.lineWidth = 1.5; g.strokeStyle = '#000'; g.stroke();
    }
    const v = player.vehicle;
    const [px, py] = this.map(v.x, v.z);
    g.save();
    g.translate(px, py);
    g.rotate(-v.heading);
    g.beginPath();
    g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath();
    g.fillStyle = '#ffd400';
    g.fill();
    g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    g.restore();
  }
}

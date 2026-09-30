// Floating "RIVAL" tag above the car who last wrecked a player. Each player's tag is on that
// player's camera layer, so in split screen you only see your own rival marked.
import * as THREE from 'three';

function tagTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.font = "italic 800 52px Bahnschrift, 'Arial Narrow', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText('RIVAL', 128, 44);
  g.fillStyle = '#ff2d40';
  g.fillText('RIVAL', 128, 44);
  // arrow pointing down at the car
  g.beginPath();
  g.moveTo(104, 84); g.lineTo(152, 84); g.lineTo(128, 118); g.closePath();
  g.lineWidth = 6;
  g.stroke();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RivalMarkers {
  constructor(scene, count) {
    this.scene = scene;
    this.tex = tagTexture();
    this.mat = new THREE.SpriteMaterial({ map: this.tex, depthTest: false, depthWrite: false, toneMapped: false, sizeAttenuation: true });
    this.sprites = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(this.mat);
      s.scale.set(4.4, 2.2, 1);
      s.layers.set(i + 1);
      s.renderOrder = 10;
      s.visible = false;
      scene.add(s);
      this.sprites.push(s);
    }
  }

  // targets[i]: player i's rival (or null)
  update(targets, time) {
    this.sprites.forEach((s, i) => {
      const c = targets[i];
      s.visible = !!c && !c.vehicle.wrecked;
      if (!s.visible) return;
      const v = c.vehicle;
      s.position.set(v.x, v.y + 3.4 + Math.sin(time * 5) * 0.2, v.z);
    });
  }

  dispose() {
    for (const s of this.sprites) this.scene.remove(s);
    this.mat.dispose();
    this.tex.dispose();
  }
}

// Spatial index of a road centreline for fast "distance to the road" queries (pure, no three.js).
export class TrackIndex {
  constructor(track, cell = 40) {
    this.track = track;
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < track.n; i += 2) {
      const k = this.key(Math.floor(track.x[i] / cell), Math.floor(track.z[i] / cell));
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    }
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  // Nearest distance to the centreline and that sample's height (Infinity if > radius cells away)
  // skip(i): optional filter of centreline samples to ignore
  nearest(x, z, radiusCells = 3, skip = null) {
    const t = this.track;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = Infinity, by = 0, bi = -1;
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      for (let dz = -radiusCells; dz <= radiusCells; dz++) {
        const list = this.map.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          if (skip && skip(i)) continue;
          const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
          if (d < best) { best = d; by = t.y[i]; bi = i; }
        }
      }
    }
    return { dist: Math.sqrt(best), y: by, idx: bi };
  }
}

// Nearest of several indexes (main road + shortcut), same interface as TrackIndex.
export class CompositeIndex {
  constructor(list) { this.list = list; }
  // where two roads come close (a shortcut's fork / merge) the height is the lower road's, so
  // the terrain never pokes through either surface
  nearest(x, z, radiusCells = 3) {
    let best = null, low = Infinity;
    const all = this.list.map((ix) => ix.nearest(x, z, radiusCells));
    for (const n of all) if (!best || n.dist < best.dist) best = n;
    for (const n of all) if (n.dist < best.dist + 30) low = Math.min(low, n.y);
    return isFinite(low) ? { ...best, y: low } : best;
  }
}

// Road pickups (pure logic): boost pickups that respawn, and takedown power-ups.

export const POWERS = {
  shockwave: { name: 'SHOCKWAVE', desc: 'Wrecks every rival close to you', color: '#19e3ff' },
  ricochet: { name: 'RICOCHET', desc: 'Bouncing shot that hunts down the road', color: '#ff8a00' },
  strike: { name: 'LIGHTNING STRIKE', desc: 'Hits the car ahead', color: '#ffd400' },
  oil: { name: 'OIL SLICK', desc: 'Drop it behind you - chasers crash', color: '#b04dff' },
};
export const POWER_IDS = Object.keys(POWERS);

export const PICKUP_RULES = {
  boostAmount: 25, // player boost gained
  aiBoostFuel: 30,
  boostRespawn: 6, // seconds
  powerRespawn: 12,
  radius: 2.7, // pickup radius (m)
  shockRadius: 18,
  shotSpeed: 45, // m/s faster than the player (min shotMinSpeed)
  shotMinSpeed: 80,
  shotLife: 6, // seconds
  shotHitS: 2.6, // hit box along the track (m)
  shotHitLat: 1.9, // hit box across the track (m)
  slickLife: 3, // seconds before the spill evaporates
  slickHalfS: 2.8,
  slickHalfLat: 3.6,
  slickBehind: 7, // dropped this far behind the player
  strikeRange: 280, // metres of track ahead
};

// Pickup positions along the track: mostly boosts, every third slot a power-up.
export function layoutPickups(trackLength, halfWidth, { spacing = 240, startGap = 140, endGap = 60 } = {}) {
  const lanes = [-0.45, 0, 0.45, 0.2, -0.2];
  const out = [];
  let k = 0;
  for (let s = startGap; s < trackLength - endGap; s += spacing, k++) {
    if (k % 3 === 2) {
      out.push({ kind: 'power', s, lateral: 0 });
    } else {
      const lat = lanes[k % lanes.length] * halfWidth;
      out.push({ kind: 'boost', s, lateral: lat });
      // a second boost on the other side on some slots, so there is a choice of line
      if (k % 2 === 0) out.push({ kind: 'boost', s: s + 45, lateral: -lat || halfWidth * 0.4 });
    }
  }
  return out;
}

export class PickupState {
  constructor(list, rules = PICKUP_RULES) {
    this.r = rules;
    this.items = list.map((p, i) => ({ ...p, id: i, active: true, timer: 0 }));
  }

  update(dt) {
    const respawned = [];
    for (const it of this.items) {
      if (it.active) continue;
      it.timer -= dt;
      if (it.timer <= 0) { it.active = true; respawned.push(it); }
    }
    return respawned;
  }

  // Returns the first active item within reach of (x, z), or null.
  near(x, z, filter = null) {
    const r2 = this.r.radius * this.r.radius;
    for (const it of this.items) {
      if (!it.active || (filter && it.kind !== filter)) continue;
      if ((it.x - x) ** 2 + (it.z - z) ** 2 < r2) return it;
    }
    return null;
  }

  take(it) {
    it.active = false;
    it.timer = it.kind === 'boost' ? this.r.boostRespawn : this.r.powerRespawn;
  }
}

export function randomPower(rand = Math.random) {
  return POWER_IDS[Math.floor(rand() * POWER_IDS.length) % POWER_IDS.length];
}

// Pick the strike target: the closest rival ahead (by race progress) within range.
export function strikeTarget(playerProgress, rivals, range = PICKUP_RULES.strikeRange) {
  let best = null;
  for (const r of rivals) {
    if (r.wrecked) continue;
    const gap = r.progress - playerProgress;
    if (gap > 0 && gap < range && (!best || gap < best.gap)) best = { ...r, gap };
  }
  return best;
}

// Ricochet shot in track space: {s, lat, vs, vl, t}. Advances it, bouncing off the barriers.
// Returns true when it bounced this step.
export function stepShot(p, dt, halfWidth, target = null) {
  if (target) {
    // gentle homing toward the next rival ahead
    p.vl += Math.max(-1, Math.min(1, (target.lat - p.lat) / 4)) * 22 * dt;
  }
  p.vl = Math.max(-16, Math.min(16, p.vl));
  p.s += p.vs * dt;
  p.lat += p.vl * dt;
  p.t += dt;
  const lim = halfWidth - 0.8;
  if (Math.abs(p.lat) > lim) {
    p.lat = Math.sign(p.lat) * (2 * lim - Math.abs(p.lat));
    p.vl = -p.vl;
    return true;
  }
  return false;
}

// Does a car at (ds along track from the object, lateral) touch a box of the given half sizes?
export function inBox(ds, lat, objLat, halfS, halfLat) {
  return Math.abs(ds) < halfS && Math.abs(lat - objLat) < halfLat;
}

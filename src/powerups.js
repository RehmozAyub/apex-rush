// Road pickups (pure logic): boost pickups that respawn, and takedown power-ups.

export const POWERS = {
  shockwave: { name: 'SHOCKWAVE', desc: 'Wrecks every rival close to you', color: '#2ee86a' },
  ricochet: { name: 'RICOCHET', desc: 'Bouncing shot that hunts down the road', color: '#ff8a00' },
  strike: { name: 'LIGHTNING STRIKE', desc: 'Hits the car ahead', color: '#ffd400' },
  oil: { name: 'OIL SLICK', desc: 'Drop it behind you - chasers crash', color: '#b04dff' },
};
export const POWER_IDS = Object.keys(POWERS);

export const PICKUP_RULES = {
  boostAmount: 25, // player boost gained
  aiBoostFuel: 30,
  respawnMin: 0.5, // seconds before a taken pickup (boost or power-up) comes back
  respawnMax: 0.5,
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

// Pickup positions along the track: mostly boosts; every third slot is a pair of power-up blocks
// side by side, each showing the power it holds, so the driver can pick one (or dodge both).
export function layoutPickups(trackLength, halfWidth, { spacing = 240, startGap = 140, endGap = 60, rand = Math.random } = {}) {
  const lanes = [-0.45, 0, 0.45, 0.2, -0.2];
  const out = [];
  let k = 0;
  for (let s = startGap; s < trackLength - endGap; s += spacing, k++) {
    if (k % 3 === 2) {
      const a = randomPower(rand);
      out.push({ kind: 'power', s, lateral: -0.42 * halfWidth, slot: k, power: a });
      out.push({ kind: 'power', s, lateral: 0.42 * halfWidth, slot: k, power: randomPower(rand, a) });
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

  // Returns the items that came back this tick. A returning power block rolls a new power,
  // different from the block beside it.
  update(dt, rand = Math.random) {
    const respawned = [];
    for (const it of this.items) {
      if (it.active) continue;
      it.timer -= dt;
      if (it.timer > 0) continue;
      it.active = true;
      if (it.kind === 'power') {
        const other = this.items.find((o) => o !== it && o.kind === 'power' && o.slot === it.slot);
        it.power = randomPower(rand, other && other.active ? other.power : null);
      }
      respawned.push(it);
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
    it.timer = this.r.respawnMin + Math.random() * (this.r.respawnMax - this.r.respawnMin);
  }
}

// A random power, optionally different from `not`.
export function randomPower(rand = Math.random, not = null) {
  const ids = not ? POWER_IDS.filter((p) => p !== not) : POWER_IDS;
  return ids[Math.floor(rand() * ids.length) % ids.length];
}

// How AI rivals use power-ups: they wait a moment after grabbing one, fire only when it will
// probably hit someone, and share a cooldown so the race doesn't turn into a war zone. A human
// wrecked by an AI power-up is left alone for a while (`shielded`).
export const AI_POWER = {
  minHold: 2, // seconds before an AI uses what it picked up
  maxHold: 24, // after this it fires at anything in reach
  cooldown: 18, // seconds between power-ups used by any AI
  pickChance: 0.5, // chance an AI grabs a block it drives through
  respawnSetback: 15, // a wrecked AI comes back this far behind where it crashed (m)
  useRate: 0.9, // chance per second of acting once a target is lined up
  shockRange: 12,
  shotMin: 15, shotMax: 150, // ricochet: rival ahead between these distances (m)
  oilMin: 8, oilMax: 45, oilLat: 4, // oil: rival behind, roughly in line
  humanShield: 12, // seconds a human is spared after an AI power-up wrecked them
};

// ctx: { held, near: [{dist, shielded}], ahead: [{gap, lat, shielded}] sorted by gap,
//        behind: [{gap, lat, shielded}], myLat, strike: {shielded} | null }
export function aiWantsPower(kind, ctx, R = AI_POWER) {
  const patient = ctx.held < R.maxHold;
  if (kind === 'shockwave') {
    if (ctx.near.some((c) => c.shielded && c.dist < PICKUP_RULES.shockRadius)) return false;
    return ctx.near.some((c) => c.dist < (patient ? R.shockRange : PICKUP_RULES.shockRadius));
  }
  if (kind === 'ricochet') {
    const t = ctx.ahead[0];
    return !!t && !t.shielded && t.gap >= (patient ? R.shotMin : 4) && t.gap <= R.shotMax;
  }
  if (kind === 'strike') return !!ctx.strike && !ctx.strike.shielded;
  if (kind === 'oil') {
    return ctx.behind.some((c) => !c.shielded && c.gap >= R.oilMin && c.gap <= (patient ? R.oilMax : R.oilMax * 2) && Math.abs(c.lat - ctx.myLat) < (patient ? R.oilLat : 8));
  }
  return false;
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

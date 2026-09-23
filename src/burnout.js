// Burnout-style rules: boost meter, adrenaline chain, near misses, drafting, takedowns (pure logic).

export const RULES = {
  maxBoost: 100,
  minBoostToStart: 6,
  boostDrain: 24, // per second
  driftGain: 11, // per second while drifting
  draftGain: 9, // per second while slipstreaming
  nearMissGain: 9,
  takedownGain: 35,
  driftBonusGain: 6, // on finishing a long drift
  chainWindow: 4, // seconds
  maxMultiplier: 5,
  takedownImpact: 12, // m/s closing speed that wrecks an AI outright
  pushImpact: 3.5, // m/s closing speed that counts as a push
  pushWindow: 0.9, // seconds for a pushed car to hit a wall
  pushWallSpeed: 5, // m/s into the wall after a push
  playerRamImpact: 17, // AI ram strong enough to wreck the player
  wallCrashSpeed: 31, // m/s (~112 km/h)
  wallCrashAngle: 48, // degrees
};

export class BoostSystem {
  constructor(rules = RULES) {
    this.r = rules;
    this.boost = 30;
    this.multiplier = 1;
    this.chainTimer = 0;
    this.boosting = false;
    this.driftTime = 0;
  }

  // Register a scoring event; returns the boost actually gained.
  event(base) {
    if (this.chainTimer > 0) this.multiplier = Math.min(this.r.maxMultiplier, this.multiplier + 1);
    else this.multiplier = 1;
    this.chainTimer = this.r.chainWindow;
    return this.add(base * this.multiplier);
  }

  add(amount) {
    const before = this.boost;
    this.boost = Math.min(this.r.maxBoost, this.boost + amount);
    return this.boost - before;
  }

  resetChain() {
    this.multiplier = 1;
    this.chainTimer = 0;
  }

  // Returns events that happened this tick, e.g. [{type:'drift', gained}]
  update(dt, { drifting, drafting, boostHeld }) {
    const events = [];
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) { this.chainTimer = 0; this.multiplier = 1; }
    }
    const m = this.multiplier;
    if (drifting) {
      this.driftTime += dt;
      this.add(this.r.driftGain * dt * m);
    } else if (this.driftTime > 0) {
      if (this.driftTime > 1.2) events.push({ type: 'drift', gained: this.event(this.r.driftBonusGain), time: this.driftTime });
      this.driftTime = 0;
    }
    if (drafting) this.add(this.r.draftGain * dt * m);

    if (boostHeld && (this.boosting ? this.boost > 0 : this.boost >= this.r.minBoostToStart)) {
      this.boosting = true;
      this.boost = Math.max(0, this.boost - this.r.boostDrain * dt);
      if (this.boost <= 0) this.boosting = false;
    } else {
      this.boosting = false;
    }
    return events;
  }
}

// A near miss: the player overtakes an AI (it goes from ahead to behind) with a small side gap.
export function isNearMiss({ prevFwd, fwd, lat, relSpeed, sinceContact }) {
  const gap = Math.abs(lat);
  return prevFwd > 0 && fwd <= 0 && gap > 2.05 && gap < 3.4 && relSpeed > 7 && sinceContact > 1.0;
}

// Directly behind another car, close enough to slipstream.
export function isDrafting({ fwd, lat, speed }) {
  return fwd > 3 && fwd < 16 && Math.abs(lat) < 1.9 && speed > 22;
}

// Classify a player <-> AI impact.
// closing: relative speed along the contact normal (m/s, positive = approaching)
// playerShare: fraction of the closing speed contributed by the player's motion (0..1)
export function classifyImpact({ closing, playerShare }, r = RULES) {
  if (closing >= r.takedownImpact && playerShare >= 0.45) return 'takedown';
  if (closing >= r.playerRamImpact && playerShare < 0.3) return 'playerWrecked';
  if (closing >= r.pushImpact && playerShare >= 0.35) return 'push';
  return null;
}

// A pushed car slamming into a wall shortly after contact with the player.
export function isPushTakedown({ sincePush, wallSpeed }, r = RULES) {
  return sincePush <= r.pushWindow && wallSpeed >= r.pushWallSpeed;
}

export function isWallCrash({ speed, angleDeg }, r = RULES) {
  return speed >= r.wallCrashSpeed && angleDeg >= r.wallCrashAngle;
}

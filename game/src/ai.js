// AI driver: follows a racing line with look-ahead steering, brakes for curvature, avoids
// traffic, rubber-bands to the player, boosts on straights and sometimes rams the player.
import { wrapAngle } from './trackMath.js';

export class AIDriver {
  constructor(vehicle, track, { lane = 0, skill = 1, aggression = 0.3, refTopSpeed = null } = {}) {
    // pull AI cars most of the way toward the player's car performance so no pick is unwinnable
    // (fully for slow player cars, only a little for fast ones so a fast pick still pays off)
    const ratio = refTopSpeed ? refTopSpeed / vehicle.spec.topSpeed : 1;
    this.norm = 1 + (ratio - 1) * (ratio > 1 ? 0.35 : 0.8);
    this.v = vehicle;
    this.track = track;
    this.lane = lane;
    this.laneTarget = lane;
    this.skill = skill;
    this.aggression = aggression;
    this.boostFuel = 40;
    this.boostCooldown = 3 + Math.random() * 4;
    this.stuckTime = 0;
    this.ramTimer = 0;
    this.pt = {};
    this.mul = 1;
  }

  think(dt, cars, player, playerProgress, myProgress) {
    const v = this.v, track = this.track;
    const speed = v.speed;
    const hw = track.halfWidth - 2.2;

    // rubber band against the player
    const gap = playerProgress - myProgress; // + = player ahead
    // AI far ahead ease off more than trailing AI speed up
    const band = Math.max(-1, Math.min(1, gap / 320));
    this.mul = Math.max(0.86, Math.min(1.07, this.skill + (band > 0 ? band * 0.07 : band * 0.12))) * this.norm;

    // traffic avoidance / aggression
    let desired = this.lane;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const rx = -fz, rz = fx;
    this.ramTimer -= dt;
    for (const o of cars) {
      if (o.vehicle === v || o.vehicle.wrecked) continue;
      const dx = o.vehicle.x - v.x, dz = o.vehicle.z - v.z;
      const fwd = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      if (o.isPlayer && this.aggression > 0.5 && fwd > -3 && fwd < 6 && Math.abs(lat) < 6 && this.ramTimer < 0 && Math.random() < dt * this.aggression * 1.2) {
        this.ramTimer = 1.2; // side-swipe the player
        this.ramSide = Math.sign(lat);
      }
      if (fwd > 2 && fwd < 22 && Math.abs(lat) < 2.6 && o.vehicle.speed < speed + 2) {
        const otherLat = o.vehicle.lateral;
        desired = otherLat > 0 ? Math.max(-hw, otherLat - 4.2) : Math.min(hw, otherLat + 4.2);
      }
    }
    let ramming = false;
    if (this.ramTimer > 0.4 && player && !player.wrecked) {
      desired = player.lateral;
      ramming = true;
    }
    this.laneTarget += (desired - this.laneTarget) * Math.min(1, dt * 1.8);
    this.laneTarget = Math.max(-hw, Math.min(hw, this.laneTarget));

    // look-ahead point on the racing line
    const look = 10 + speed * 0.55;
    const p = track.pointAt(v.s + look, this.laneTarget, this.pt);
    const ang = Math.atan2(p.x - v.x, p.z - v.z);
    const err = wrapAngle(ang - v.heading); // + = target to the left
    let steer = Math.max(-1, Math.min(1, -err * 2.6));

    // target speed from curvature ahead
    const curv = track.maxCurvatureAhead(v.s, 20 + speed * 1.6);
    // fastest speed at which the car's yaw rate (turn * (1 - 0.5 v/top)) can follow this curve
    const k = 0.74 * this.skill, turn = v.spec.turn, top = v.spec.topSpeed;
    const vCurve = (k * turn) / (curv + (0.5 * k * turn) / top);
    const target = Math.min(v.spec.topSpeed * this.mul * 1.02, vCurve);
    let throttle = speed < target ? 1 : 0;
    let brake = speed > target + 3 ? Math.min(1, (speed - target) / 8) : 0;

    // boost on straights
    this.boostCooldown -= dt;
    this.boostFuel = Math.min(100, this.boostFuel + dt * 5);
    let boost = false;
    if (this.boosting) {
      this.boostFuel -= dt * 24;
      if (this.boostFuel <= 0 || curv > 0.006) this.boosting = false;
    } else if (this.boostCooldown < 0 && this.boostFuel > 50 && curv < 0.003 && speed > 30) {
      this.boosting = true;
      this.boostCooldown = 6 + Math.random() * 6;
    }
    boost = this.boosting;
    if (ramming) { throttle = 1; brake = 0; }

    // recover when stuck or facing the wrong way
    const backwards = Math.abs(wrapAngle(v.heading - track.headingAt(v.idx))) > 1.8;
    if (speed < 3 || backwards) this.stuckTime += dt; else this.stuckTime = 0;
    const needsReset = this.stuckTime > (backwards ? 1.5 : 3);
    if (needsReset) this.stuckTime = 0;

    return { steer, throttle, brake, handbrake: false, boost, needsReset };
  }
}

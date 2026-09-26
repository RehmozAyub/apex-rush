// Drive assist (on by default, per player): makes the car easy to drive without taking it over.
//  - hands off the steering and the car follows the road in its current lane
//  - steering still moves the car freely; the assist only steps in near the walls and when the
//    car is turning much further than the road does
//  - lifts off / brakes for corners too tight to make at the current speed
//  - wall hits and AI rams need to be much harder to wreck an assisted car (see ASSIST_RULES)
import { wrapAngle } from './trackMath.js';
import { RULES } from './burnout.js';

export const ASSIST = {
  wallMargin: 3.0, // keep the car's centre this far inside the barrier line (m)
  gain: 2.4, // steering per radian of heading error
  lookBase: 9, lookSpeed: 0.5, // look-ahead distance (m) = base + speed * factor
  predict: 0.45, // seconds ahead used to see a wall coming
  overRotate: 0.6, // radians off the road direction before steering further is damped
  cornerK: 0.9, // share of the car's full turning ability the speed control plans for
};

// Crash thresholds for assisted players (defaults in burnout.js RULES).
export const ASSIST_RULES = { ...RULES, wallCrashSpeed: 38, wallCrashAngle: 62, playerRamImpact: 23 };

export class DriveAssist {
  constructor(track, opts = ASSIST) {
    this.track = track;
    this.o = opts;
    this.lane = null;
    this.pt = {};
    this.pr = {};
  }

  // Returns the controls to feed the vehicle for driver input `c`.
  apply(v, c) {
    const o = this.o, track = this.track;
    const out = { ...c };
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const vF = v.vx * fx + v.vz * fz;
    const speed = Math.abs(vF);
    const rel = wrapAngle(v.heading - track.headingAt(v.idx));
    // reversing, crawling, facing backwards: the driver is on their own
    if (v.wrecked || vF < 3 || Math.abs(rel) > 1.6) { this.lane = null; return out; }

    const hw = track.halfWidth - o.wallMargin;
    const clamp = (x) => Math.max(-hw, Math.min(hw, x));
    const steering = Math.abs(c.steer) > 0.1;
    const sliding = c.handbrake || v.drifting;
    // hold the lane the driver leaves the car in
    if (steering || sliding || this.lane === null) this.lane = clamp(v.lateral);
    this.lane = clamp(this.lane);

    const auto = this.steerTo(v, this.lane, speed);
    if (!steering && !sliding) out.steer = auto;
    else {
      let s = c.steer;
      // turning much further than the road: soften it (steer > 0 turns right and lowers `rel`)
      if (!sliding && s * rel < 0 && Math.abs(rel) > o.overRotate) s *= Math.max(0.25, 1 - (Math.abs(rel) - o.overRotate) * 2.5);
      // heading for a wall: blend toward the lane-keeping line
      const q = track.project(v.x + v.vx * o.predict, v.z + v.vz * o.predict, v.idx, this.pr);
      const over = Math.abs(q.lateral) - (track.halfWidth - 1.6);
      if (over > 0 && Math.sign(q.lateral) === Math.sign(q.lateral - v.lateral)) {
        const w = Math.min(1, over / 2.5);
        s += (this.steerTo(v, clamp(v.lateral), speed) - s) * w;
      }
      out.steer = s;
    }

    // corner speed: ease off (then brake) when the next bend is tighter than the car can turn
    if (!sliding) {
      const curv = track.maxCurvatureAhead(v.s, 15 + speed * 1.4);
      const k = o.cornerK * v.spec.turn;
      const vCurve = k / (curv + (0.5 * k) / v.spec.topSpeed);
      if (speed > vCurve + 1.5) out.throttle = 0;
      if (speed > vCurve + 5) out.brake = Math.max(c.brake, Math.min(1, (speed - vCurve) / 10));
    }
    return out;
  }

  // steering that points the car at the lane `lane` a little way up the road
  steerTo(v, lane, speed) {
    const p = this.track.pointAt(v.s + this.o.lookBase + speed * this.o.lookSpeed, lane, this.pt);
    const err = wrapAngle(Math.atan2(p.x - v.x, p.z - v.z) - v.heading); // + = target to the left
    return Math.max(-1, Math.min(1, -err * this.o.gain));
  }
}

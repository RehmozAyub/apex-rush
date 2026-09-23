// One race: cars, AI, collisions, Burnout events (boost, near miss, draft, takedowns, crashes),
// power-ups, effects, cameras, audio and HUD feed. Supports one or two human players
// (split screen); each human has their own boost meter, power-up, camera and HUD.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { AIDriver } from './ai.js';
import { buildCar, disposeCar } from './carModel.js';
import { Effects } from './fx.js';
import { RaceTracker } from './race.js';
import { BoostSystem, RULES, isNearMiss, isDrafting, classifyImpact, isPushTakedown, isWallCrash } from './burnout.js';
import { CARS, PAINTS, AI_NAMES, AI_COUNT, LAPS } from './config.js';
import { wrapAngle } from './trackMath.js';
import { PickupState, layoutPickups, randomPower, strikeTarget, stepShot, inBox, POWERS, PICKUP_RULES } from './powerups.js';
import { PickupVisuals } from './pickups.js';

const CIRCLE_R = 1.05;
const CIRCLE_OFF = 1.2;
const SUB_DT = 1 / 120;

export class RaceSession {
  constructor(game, world, opts) {
    this.game = game;
    this.world = world;
    this.track = world.track;
    this.def = world.def;
    this.laps = opts.laps ?? LAPS;
    const humanDefs = opts.players || [{ carIndex: opts.carIndex, paintIndex: opts.paintIndex }];
    this.split = humanDefs.length > 1;
    this.fx = new Effects(world.scene);
    this.fx.smokeColor = this.def.smoke;
    this.state = 'countdown';
    this.countdown = 3.6;
    this.lastCount = 4;
    this.time = 0;
    this.timeScale = 1;
    this.slowmo = 0;
    this.finishTimer = 0;
    this.firstFinishAt = null;
    this.impactCooldown = 0;
    this.tmpV = new THREE.Vector3();

    // grid: 8 cars; one player starts mid-pack, two players share a row
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    const aiSkill = [0.98, 0.955, 0.995, 0.94, 0.97, 0.95, 0.985];
    const aiAggro = [0.3, 0.7, 0.2, 0.85, 0.5, 0.4, 0.6];
    const humanPaints = humanDefs.map((h) => h.paintIndex);
    const paints = PAINTS.filter((p, i) => !humanPaints.includes(i)).sort(() => Math.random() - 0.5);
    const numbers = [3, 7, 11, 13, 21, 44, 77, 88, 99].sort(() => Math.random() - 0.5);
    const refTop = humanDefs.reduce((a, h) => a + CARS[h.carIndex].topSpeed, 0) / humanDefs.length;
    const humanSlots = this.split ? [4, 5] : [5];
    const aiCount = AI_COUNT + 1 - humanDefs.length;
    const L = this.track.length;
    this.cars = [];
    this.humans = [];
    let ai = 0;
    for (let slot = 0; slot < aiCount + humanDefs.length; slot++) {
      const row = Math.floor(slot / 2), col = slot % 2;
      const s = L - 12 - row * 11 - col * 5;
      const lat = col ? 4.2 : -4.2;
      const hi = humanSlots.indexOf(slot);
      const isPlayer = hi >= 0;
      const hd = isPlayer ? humanDefs[hi] : null;
      const spec = isPlayer ? CARS[hd.carIndex] : CARS[Math.floor(Math.random() * CARS.length)];
      const paint = isPlayer ? PAINTS[hd.paintIndex].hex : paints[ai % paints.length].hex;
      const v = new Vehicle(spec);
      v.placeOnTrack(this.track, s, lat, 0);
      const model = buildCar(spec.style, paint, { underglow: this.def.underglow ? paint : null, number: isPlayer ? hi + 1 : numbers[ai] });
      model.root.rotation.order = 'YXZ';
      world.scene.add(model.root);
      const car = {
        id: isPlayer ? (hi === 0 ? 'player' : 'player2') : `ai${ai}`,
        name: isPlayer ? (this.split ? `P${hi + 1}` : 'YOU') : names[ai],
        isPlayer, vehicle: v, model, spec, paint, human: null,
        ai: isPlayer ? null : new AIDriver(v, this.track, { lane: lat * 0.6, skill: aiSkill[ai % aiSkill.length], aggression: aiAggro[ai % aiAggro.length], refTopSpeed: refTop }),
        controls: { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false },
        pushedAt: -99, pushedBy: null, lastContact: -99, prevFwd: [0, 0], respawn: 0, mul: 1,
      };
      if (isPlayer) {
        const H = {
          index: hi, car, boost: new BoostSystem(), power: null, powerHeld: false, drafting: false,
          wrongWayTime: 0, takedowns: 0, boostVis: 0, flash: 0, wasBoosting: false, finished: false,
          rig: game.rigs[hi], input: null,
        };
        car.human = H;
        this.humans[hi] = H;
      } else ai++;
      this.cars.push(car);
    }
    this.player = this.humans[0].car; // primary player (debug hooks, single-player code paths)
    this.race = new RaceTracker(L, this.laps, this.cars.map((c) => c.id));
    for (const c of this.cars) this.race.update(c.id, c.vehicle.s, 0);

    // road pickups and power-up objects
    this.pickState = new PickupState(layoutPickups(L, this.track.halfWidth));
    this.pickVis = new PickupVisuals(world.scene, this.track, this.pickState.items);
    this.shots = []; // ricochet shots: {owner, s, lat, vs, vl, t}
    this.slicks = []; // oil slicks: {owner, id, s, lat, t}
    this.slickId = 0;
    this.pendingStrikes = [];

    if (this.def.headlights) {
      for (const H of this.humans) {
        const spot = new THREE.SpotLight(0xe8f0ff, 120, 90, 0.55, 0.6, 1.4);
        spot.position.set(0, 0.8, 2.0);
        spot.target.position.set(0, 0, 30);
        H.car.model.root.add(spot, spot.target);
      }
    }
    for (const H of this.humans) H.rig.snap = true;
  }

  dispose() {
    for (const c of this.cars) {
      this.world.scene.remove(c.model.root);
      disposeCar(c.model);
    }
    this.pickVis.dispose();
    for (const o of [this.fx.skids.mesh, this.fx.smoke.points, this.fx.glow.points, this.fx.debris.mesh]) {
      this.world.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }

  // --- single-player compatibility accessors (debug hooks and tests) ---------------------
  get playerVehicle() { return this.player.vehicle; }
  get boost() { return this.humans[0].boost; }
  get power() { return this.humans[0].power; }
  set power(v) { this.humans[0].power = v; }
  get takedowns() { return this.humans.reduce((a, H) => a + H.takedowns, 0); }
  get shot() { return this.shots.find((s) => s.owner === this.humans[0]) || null; }

  popup(title, sub = '', kind = '', H = this.humans[0]) { this.game.ui.popup(title, sub, kind, H ? H.index : 0); }
  popupAll(title, sub = '', kind = '') { for (const H of this.humans) this.popup(title, sub, kind, H); }

  humanProgress() {
    let sum = 0;
    for (const H of this.humans) sum += this.race.byId.get(H.car.id).progress;
    return sum / this.humans.length;
  }

  nearestHuman(v) {
    let best = null, bd = Infinity;
    for (const H of this.humans) {
      const hv = H.car.vehicle;
      const d = (hv.x - v.x) ** 2 + (hv.z - v.z) ** 2;
      if (d < bd) { bd = d; best = H; }
    }
    return { H: best, d2: bd };
  }

  // --- main update ----------------------------------------------------------------
  update(realDt) {
    const game = this.game;
    this.slowmo = Math.max(0, this.slowmo - realDt);
    const targetScale = this.slowmo > 0 ? 0.22 : 1;
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, realDt * (this.slowmo > 0 ? 12 : 3));
    const dt = realDt * this.timeScale;
    this.time += dt;
    this.impactCooldown -= realDt;

    for (const H of this.humans) H.input = game.input.drive(H.index, this.split);

    // countdown
    if (this.state === 'countdown') {
      this.countdown -= realDt;
      const n = Math.ceil(this.countdown - 0.6);
      if (n < this.lastCount && n >= 1) { this.lastCount = n; game.ui.countdown(String(n)); game.audio.blip(520, 0.12, 0.25); }
      if (this.countdown <= 0.6 && this.lastCount > 0) {
        this.lastCount = 0;
        game.ui.countdown('GO!');
        game.audio.blip(1040, 0.35, 0.3);
        this.state = 'racing';
        this.race.start(this.time);
        for (const H of this.humans) {
          if (H.input.throttle > 0.5) { H.boost.add(15); this.popup('PERFECT START', '+BOOST', 'good', H); }
        }
      }
    }
    const racing = this.state === 'racing' || this.state === 'finished';

    // boost meters
    for (const H of this.humans) {
      const pv = H.car.vehicle;
      let drafting = false;
      if (racing && !pv.wrecked) {
        for (const c of this.cars) {
          if (c === H.car || c.vehicle.wrecked) continue;
          const r = this.relative(pv, c.vehicle);
          if (isDrafting({ fwd: r.fwd, lat: r.lat, speed: pv.speed })) drafting = true;
        }
      }
      H.drafting = drafting;
      const events = H.boost.update(dt, {
        drifting: racing && pv.drifting && pv.speed > 15,
        drafting,
        boostHeld: this.state === 'racing' && !H.finished && H.input.boost && !pv.wrecked,
      });
      for (const e of events) if (e.type === 'drift') this.scoreEvent(H, 'DRIFT', e.gained);
      if (H.boost.boosting && !H.wasBoosting) { game.audio.whoosh(true, 0.35); H.rig.addShake(0.3); }
      H.wasBoosting = H.boost.boosting;
    }

    // controls
    const hp = this.humanProgress();
    for (const c of this.cars) {
      const v = c.vehicle;
      if (!racing) {
        c.controls = { steer: 0, throttle: 0, brake: 1, handbrake: false, boost: false };
        continue;
      }
      const H = c.human;
      if (H && this.state === 'racing' && !H.finished && !this.autopilot) {
        c.controls = { ...H.input, boost: H.boost.boosting, draft: H.drafting };
        c.mul = 1;
      } else {
        if (!c.ai) c.ai = new AIDriver(v, this.track, { lane: v.lateral, skill: 0.8, aggression: 0 });
        const me = this.race.byId.get(c.id);
        const target = H ? null : this.nearestHuman(v).H;
        const ctl = c.ai.think(dt, this.cars, target ? target.car.vehicle : null, H ? me.progress : hp, me.progress);
        c.mul = H ? (this.autopilotMul ?? 0.85) : c.ai.mul;
        c.controls = ctl;
        if (ctl.needsReset && !v.wrecked) { v.placeOnTrack(this.track, v.s, 0, 10); v.ghost = 1.5; }
      }
    }

    // physics substeps (cars are held on the grid during the countdown)
    const steps = racing ? Math.min(8, Math.max(1, Math.ceil(dt / SUB_DT))) : 0;
    const h = dt / steps;
    for (let k = 0; k < steps; k++) {
      for (const c of this.cars) {
        c.vehicle.update(h, c.controls, c.mul);
        const hit = c.vehicle.constrain(this.track);
        if (hit) this.onWallHit(c, hit);
      }
      this.collide();
    }

    for (const c of this.cars) {
      if (!c.vehicle.wrecked) continue;
      c.respawn -= dt;
      if (c.respawn <= 0) this.respawn(c);
    }

    if (racing) this.updateRaceEvents(dt);
    if (racing) this.updatePickups(dt);
    this.pickVis.update(dt, this.time);
    this.updateFx(dt);
    this.syncModels();
    this.updatePresentation(realDt, dt);
  }

  // --- road pickups and power-ups -------------------------------------------------
  updatePickups(dt) {
    const game = this.game;
    for (const it of this.pickState.update(dt)) this.pickVis.setActive(it, true);
    for (const c of this.cars) {
      const v = c.vehicle;
      if (v.wrecked) continue;
      const it = this.pickState.near(v.x, v.z);
      if (!it) continue;
      const H = c.human;
      if (it.kind === 'boost') {
        this.pickState.take(it);
        this.pickVis.setActive(it, false);
        if (H) {
          const gained = H.boost.add(PICKUP_RULES.boostAmount);
          this.popup('BOOST PICKUP', `+${Math.round(gained)} BOOST`, 'good', H);
          game.audio.pickup(false);
        } else if (c.ai) c.ai.boostFuel = Math.min(100, c.ai.boostFuel + PICKUP_RULES.aiBoostFuel);
      } else if (H && !H.power) {
        this.pickState.take(it);
        this.pickVis.setActive(it, false);
        H.power = randomPower();
        this.popup(POWERS[H.power].name, `PRESS ${this.powerKey(H)} TO UNLEASH`, 'power', H);
        game.audio.pickup(true);
      }
    }

    this.updateShots(dt);
    this.updateSlicks(dt);
    for (let i = this.pendingStrikes.length - 1; i >= 0; i--) {
      const ps = this.pendingStrikes[i];
      ps.t -= dt;
      if (ps.t > 0) continue;
      this.pendingStrikes.splice(i, 1);
      const v = ps.car.vehicle;
      if (!v.wrecked) this.takedown(ps.car, Math.sin(v.heading), Math.cos(v.heading), 'STRUCK DOWN', false, ps.owner);
    }

    // fire on key press (edge)
    for (const H of this.humans) {
      const pressed = H.input.power && !H.powerHeld;
      H.powerHeld = !!H.input.power;
      if (pressed && H.power && this.state === 'racing' && !H.finished && !H.car.vehicle.wrecked) this.usePower(H);
    }
  }

  powerKey(H) {
    if (this.game.input.lastDevice === 'pad') return 'LB';
    return this.split && H.index === 1 ? 'ENTER' : 'E';
  }

  usePower(H = this.humans[0]) {
    const game = this.game;
    const pv = H.car.vehicle;
    const kind = H.power;
    const others = this.cars.filter((c) => c !== H.car);
    if (kind === 'shockwave') {
      H.power = null;
      this.pickVis.shockwave(pv.x, pv.y, pv.z);
      this.fx.sparks(pv.x, pv.y + 0.6, pv.z, pv.vx, pv.vz, 50, 2);
      game.audio.shockwave();
      H.rig.addShake(0.9);
      H.flash = Math.max(H.flash, 0.3);
      let hits = 0;
      for (const c of others) {
        if (c.vehicle.wrecked || c.vehicle.ghost > 0) continue;
        const dx = c.vehicle.x - pv.x, dz = c.vehicle.z - pv.z;
        const d = Math.hypot(dx, dz);
        if (d < PICKUP_RULES.shockRadius) { this.takedown(c, dx / (d || 1), dz / (d || 1), 'SHOCKWAVE', true, H); hits++; }
      }
      if (!hits) this.popup('SHOCKWAVE', 'NO ONE IN RANGE', '', H);
      else {
        this.popup(hits > 1 ? `SHOCKWAVE ×${hits}` : 'SHOCKWAVE', `${hits} TAKEDOWN${hits > 1 ? 'S' : ''}`, 'takedown', H);
        this.slowmo = this.split ? 0.8 : 1.4;
        H.flash = 0.5;
        H.rig.addShake(1);
      }
    } else if (kind === 'ricochet') {
      H.power = null;
      const R = PICKUP_RULES;
      this.shots.push({
        owner: H, s: pv.s + 4, lat: pv.lateral,
        vs: Math.max(R.shotMinSpeed, pv.speed + R.shotSpeed),
        vl: (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 4),
        t: 0,
        vis: this.pickVis.addShot(),
      });
      this.popup('RICOCHET', 'FIRED!', 'power', H);
      game.audio.fire();
      H.rig.addShake(0.25);
    } else if (kind === 'oil') {
      H.power = null;
      const R = PICKUP_RULES;
      const s = this.track.wrapS(pv.s - R.slickBehind);
      const edge = this.track.halfWidth - R.slickHalfLat * 0.75; // keep the spill on the tarmac
      const lat = Math.max(-edge, Math.min(edge, pv.lateral));
      const p = this.track.pointAt(s, lat);
      const sl = { owner: H, id: ++this.slickId, s, lat, t: R.slickLife };
      this.slicks.push(sl);
      this.pickVis.addSlick(sl.id, p.x, p.y, p.z, p.heading, R.slickHalfS, R.slickHalfLat);
      this.popup('OIL SLICK', 'DROPPED BEHIND YOU', 'power', H);
      game.audio.splat();
    } else if (kind === 'strike') {
      const pe = this.race.byId.get(H.car.id);
      const rivals = others.filter((c) => c.vehicle.ghost <= 0).map((c) => ({ car: c, wrecked: c.vehicle.wrecked, progress: this.race.byId.get(c.id).progress }));
      const t = strikeTarget(pe.progress, rivals);
      if (!t) { this.popup('LIGHTNING STRIKE', 'NO TARGET AHEAD', '', H); return; }
      H.power = null;
      const v = t.car.vehicle;
      this.pickVis.lightning(new THREE.Vector3(v.x + 6, v.y + 70, v.z - 4), new THREE.Vector3(v.x, v.y + 0.8, v.z));
      game.audio.thunder(1);
      H.flash = Math.max(H.flash, 0.45);
      this.pendingStrikes.push({ car: t.car, owner: H, t: 0.12 });
    }
  }

  // ricochet shots: fly ahead, bounce off the barriers, wreck the first rival they touch
  updateShots(dt) {
    const R = PICKUP_RULES, track = this.track;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      const valid = (c) => c !== sh.owner.car && !c.vehicle.wrecked && c.vehicle.ghost <= 0;
      let target = null, best = 90;
      for (const c of this.cars) {
        if (!valid(c)) continue;
        const ds = track.deltaS(sh.s, c.vehicle.s);
        if (ds > -1 && ds < best) { best = ds; target = { lat: c.vehicle.lateral }; }
      }
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      let hitCar = null;
      for (let k = 0; k < steps && !hitCar; k++) {
        if (stepShot(sh, dt / steps, track.halfWidth, target)) {
          const p = track.pointAt(sh.s, sh.lat);
          this.fx.sparks(p.x + p.rx * Math.sign(sh.lat) * 0.6, p.y + 0.7, p.z + p.rz * Math.sign(sh.lat) * 0.6, 0, 0, 14, 1);
          this.game.audio.ping();
        }
        for (const c of this.cars) {
          if (valid(c) && inBox(track.deltaS(sh.s, c.vehicle.s), c.vehicle.lateral, sh.lat, R.shotHitS, R.shotHitLat)) { hitCar = c; break; }
        }
      }
      if (hitCar || sh.t > R.shotLife) {
        this.pickVis.removeShot(sh.vis);
        this.shots.splice(i, 1);
        const p = track.pointAt(sh.s, hitCar ? 0 : sh.lat);
        if (hitCar) this.takedown(hitCar, p.tx, p.tz, 'RICOCHET TAKEDOWN', false, sh.owner);
        else this.fx.sparks(p.x, p.y + 0.7, p.z, 0, 0, 30, 1.5);
        continue;
      }
      const p = track.pointAt(sh.s, sh.lat);
      this.pickVis.showShot(sh.vis, p.x, p.y + 0.75, p.z, this.time);
      if (Math.random() < 0.9) this.fx.glow.spawn(p.x, p.y + 0.75, p.z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 0.35, 0.7, 6, 2.6, 0.4, { drag: 0.1 });
    }
  }

  // oil slicks: anyone except the owner driving through spins out and crashes; they evaporate fast
  updateSlicks(dt) {
    const R = PICKUP_RULES;
    for (let i = this.slicks.length - 1; i >= 0; i--) {
      const sl = this.slicks[i];
      sl.t -= dt;
      if (sl.t <= 0) { this.pickVis.removeSlick(sl.id); this.slicks.splice(i, 1); continue; }
      for (const c of this.cars) {
        if (c === sl.owner.car || c.vehicle.wrecked || c.vehicle.ghost > 0 || c.vehicle.speed < 8) continue;
        if (inBox(this.track.deltaS(sl.s, c.vehicle.s), c.vehicle.lateral, sl.lat, R.slickHalfS, R.slickHalfLat)) {
          const v = c.vehicle;
          v.yawRate += (Math.random() < 0.5 ? -1 : 1) * 6;
          this.takedown(c, -Math.cos(v.heading), Math.sin(v.heading), 'SLICKED', false, sl.owner);
        }
      }
    }
  }

  relative(from, to) {
    const fx = Math.sin(from.heading), fz = Math.cos(from.heading);
    const dx = to.x - from.x, dz = to.z - from.z;
    return { fwd: dx * fx + dz * fz, lat: dx * -fz + dz * fx };
  }

  scoreEvent(H, label, gained) {
    const m = H.boost.multiplier;
    this.popup(label, `+${Math.round(gained)} BOOST${m > 1 ? `  ×${m}` : ''}`, 'good', H);
    this.game.audio.chime(m);
  }

  updateRaceEvents(dt) {
    for (const c of this.cars) {
      const r = this.race.update(c.id, c.vehicle.s, this.time);
      const H = c.human;
      if (!H || !r) continue;
      const e = this.race.byId.get(c.id);
      if (r === 'lap') {
        const lt = e.lapTimes[e.lapTimes.length - 1];
        const lap = e.maxLap + 1;
        this.popup(lap === this.laps ? 'FINAL LAP' : `LAP ${lap}`, `${e.bestLap === lt && e.lapTimes.length > 1 ? 'BEST ' : ''}${this.game.fmt(lt)}`, lap === this.laps ? 'hot' : '', H);
      } else if (r === 'finish') {
        H.finished = true;
        if (this.firstFinishAt === null) this.firstFinishAt = this.time;
        const pos = this.race.position(c.id);
        this.popup(pos === 1 ? 'VICTORY' : `FINISHED P${pos}`, this.game.fmt(e.finishTime), pos === 1 ? 'hot' : '', H);
        this.game.audio.whoosh(false, 0.3);
      }
    }
    // the race ends when every human has finished (or 40 s after the first one did)
    if (this.state === 'racing' && this.firstFinishAt !== null && (this.humans.every((H) => H.finished) || this.time - this.firstFinishAt > 40)) {
      this.state = 'finished';
      this.finishTimer = 0;
    }
    if (this.state === 'finished') {
      this.finishTimer += dt;
      if (this.finishTimer > 4 && !this.resultsShown) {
        this.resultsShown = true;
        this.game.showResults(this.results());
      }
    }

    for (const H of this.humans) {
      const pv = H.car.vehicle;
      if (!pv.wrecked) {
        for (const c of this.cars) {
          if (c === H.car) continue;
          const ov = c.vehicle;
          const r = this.relative(pv, ov);
          const rel = this.relative(ov, pv);
          if (!ov.wrecked && Math.abs(r.lat) < 6 && isNearMiss({ prevFwd: c.prevFwd[H.index], fwd: -rel.fwd, lat: r.lat, relSpeed: pv.speed - ov.speed, sinceContact: this.time - c.lastContact })) {
            this.scoreEvent(H, 'NEAR MISS', H.boost.event(RULES.nearMissGain));
            this.game.audio.whoosh(false, 0.25);
          }
          c.prevFwd[H.index] = -rel.fwd; // + while the other car is ahead of this human
        }
      }
      const th = this.track.headingAt(pv.idx);
      const off = Math.abs(wrapAngle(pv.heading - th));
      if (off > 1.9 && pv.speed > 4 && !pv.wrecked) H.wrongWayTime += dt; else H.wrongWayTime = 0;
    }
  }

  // --- collisions ---------------------------------------------------------------
  collide() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const A = cars[i].vehicle, B = cars[j].vehicle;
        if (A.ghost > 0 || B.ghost > 0) continue;
        if (A.wrecked && B.wrecked) continue;
        const dx0 = B.x - A.x, dz0 = B.z - A.z;
        if (dx0 * dx0 + dz0 * dz0 > 36) continue;
        let best = null;
        for (const sa of [-1, 1]) {
          const ax = A.x + Math.sin(A.heading) * CIRCLE_OFF * sa, az = A.z + Math.cos(A.heading) * CIRCLE_OFF * sa;
          for (const sb of [-1, 1]) {
            const bx = B.x + Math.sin(B.heading) * CIRCLE_OFF * sb, bz = B.z + Math.cos(B.heading) * CIRCLE_OFF * sb;
            const dx = bx - ax, dz = bz - az;
            const d = Math.hypot(dx, dz);
            const pen = CIRCLE_R * 2 - d;
            if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (d || 1), nz: dz / (d || 1), cx: (ax + bx) / 2, cz: (az + bz) / 2 };
          }
        }
        if (!best) continue;
        const { pen, nx, nz } = best;
        const mA = A.wrecked ? 3 : A.mass, mB = B.wrecked ? 3 : B.mass;
        const tot = mA + mB;
        A.x -= nx * pen * (mB / tot); A.z -= nz * pen * (mB / tot);
        B.x += nx * pen * (mA / tot); B.z += nz * pen * (mA / tot);
        const pA = A.vx * nx + A.vz * nz; // A moving toward B
        const pB = -(B.vx * nx + B.vz * nz); // B moving toward A
        const closing = pA + pB;
        if (closing <= 0) continue;
        const jImp = (1.3 * closing) / (1 / mA + 1 / mB);
        A.vx -= (nx * jImp) / mA; A.vz -= (nz * jImp) / mA;
        B.vx += (nx * jImp) / mB; B.vz += (nz * jImp) / mB;
        const spin = Math.min(1.5, closing * 0.05);
        A.yawRate += (Math.random() - 0.5) * spin;
        B.yawRate += (Math.random() - 0.5) * spin;
        this.onCarHit(cars[i], cars[j], closing, nx, nz, best.cx, best.cz, pA, pB);
      }
    }
  }

  onCarHit(ca, cb, closing, nx, nz, cx, cz, pA, pB) {
    const y = (ca.vehicle.y + cb.vehicle.y) / 2 + 0.6;
    if (closing > 2) this.fx.sparks(cx, y, cz, (ca.vehicle.vx + cb.vehicle.vx) / 2, (ca.vehicle.vz + cb.vehicle.vz) / 2, Math.min(40, 6 + closing * 2), Math.min(2, closing / 10));
    if (!ca.human && !cb.human) return;
    if (this.state !== 'racing') return;
    if (closing > 3 && this.impactCooldown <= 0) {
      this.game.audio.impact(Math.min(1.2, closing / 15));
      for (const c of [ca, cb]) if (c.human) c.human.rig.addShake(Math.min(0.8, closing / 20));
      this.impactCooldown = 0.15;
    }
    ca.lastContact = cb.lastContact = this.time;
    if (ca.vehicle.wrecked || cb.vehicle.wrecked) return;
    // who is the aggressor? the car contributing most of the closing speed
    const shareA = Math.max(0, pA) / (Math.max(0, pA) + Math.max(0, pB) + 1e-3);
    const aAttacks = shareA >= 0.5;
    const attacker = aAttacks ? ca : cb, victim = aAttacks ? cb : ca;
    const share = aAttacks ? shareA : 1 - shareA;
    const dir = aAttacks ? 1 : -1; // normal points from ca to cb
    if (attacker.human) {
      const kind = classifyImpact({ closing, playerShare: share });
      if (kind === 'takedown') this.takedown(victim, nx * dir, nz * dir, 'TAKEDOWN!', false, attacker.human);
      else if (kind === 'push') { victim.pushedAt = this.time; victim.pushedBy = attacker.human; }
    } else {
      // an AI rammed a human: 'playerWrecked' when the AI supplied almost all the closing speed
      const kind = classifyImpact({ closing, playerShare: 1 - share });
      if (kind === 'playerWrecked') this.crashHuman(victim.human, 'TAKEN OUT', nx * dir, nz * dir, attacker);
    }
  }

  onWallHit(c, hit) {
    if (this.state === 'countdown') return;
    const v = c.vehicle;
    if (hit.vn > 3) this.fx.sparks(hit.x, hit.y, hit.z, v.vx, v.vz, Math.min(30, hit.vn * 2), Math.min(2, hit.vn / 12));
    if (v.wrecked || this.state !== 'racing') return;
    const H = c.human;
    if (H) {
      if (!H.finished && isWallCrash({ speed: hit.speed, angleDeg: hit.angle })) {
        this.crashHuman(H, 'WRECKED', hit.nx, hit.nz);
      } else if (hit.vn > 4 && this.impactCooldown <= 0) {
        this.game.audio.impact(Math.min(1, hit.vn / 18));
        H.rig.addShake(Math.min(0.6, hit.vn / 25));
        H.flash = Math.max(H.flash, Math.min(0.12, hit.vn / 150));
        this.impactCooldown = 0.15;
      }
    }
    if (c.pushedBy && c.pushedBy.car !== c && isPushTakedown({ sincePush: this.time - c.pushedAt, wallSpeed: hit.vn })) {
      this.takedown(c, hit.nx, hit.nz, 'TAKEDOWN!', false, c.pushedBy);
    }
  }

  // Wreck car `c` and credit human `by` with the takedown.
  takedown(c, dirX, dirZ, label = 'TAKEDOWN!', quiet = false, by = this.humans[0]) {
    const v = c.vehicle;
    if (v.wrecked) return;
    if (c.human) this.crashHuman(c.human, label === 'TAKEDOWN!' ? 'TAKEN OUT' : label, dirX, dirZ, by ? by.car : null);
    else {
      v.crash(dirX, dirZ, 1.3);
      c.respawn = 3.4;
      this.fx.explosion(v.x, v.y + 0.6, v.z, v.vx, v.vz, c.paint, v.y);
      this.game.audio.crash();
    }
    c.pushedAt = -99;
    c.pushedBy = null;
    if (!by || by.car === c) return;
    by.takedowns++;
    const gained = by.boost.event(RULES.takedownGain);
    if (quiet) return;
    const m = by.boost.multiplier;
    this.popup(label, `${c.name}${gained >= 1 ? `  +${Math.round(gained)} BOOST` : ''}${m > 1 ? `  ×${m}` : ''}`, 'takedown', by);
    this.slowmo = this.split ? 0.8 : 1.4;
    by.flash = 0.5;
    by.rig.startCrashCam(v, this.split ? 1.0 : 1.4, Math.random() < 0.5 ? 1 : -1);
    by.rig.addShake(1);
  }

  crashHuman(H, label, dirX, dirZ, byCar = null) {
    const car = H.car, v = car.vehicle;
    if (v.wrecked) return;
    v.crash(dirX, dirZ, 1);
    car.respawn = 2.4;
    H.boost.resetChain();
    this.fx.explosion(v.x, v.y + 0.6, v.z, v.vx, v.vz, car.paint, v.y);
    this.game.audio.crash();
    this.popup(label, byCar ? `by ${byCar.name}` : 'CRASH', 'bad', H);
    this.slowmo = Math.max(this.slowmo, this.split ? 0.8 : 1.8);
    H.flash = 0.35;
    H.rig.startCrashCam(v, this.split ? 1.2 : 1.8, 1);
  }

  respawn(c) {
    const v = c.vehicle;
    let s = v.s;
    if (!c.human) {
      for (const H of this.humans) {
        const d = this.track.deltaS(H.car.vehicle.s, s);
        if (Math.abs(d) < 30) s = this.track.wrapS(H.car.vehicle.s - 40);
      }
    }
    v.placeOnTrack(this.track, s, c.human ? 0 : c.ai.lane, c.human ? 24 : 20);
    v.ghost = 1.6;
    c.respawn = 0;
  }

  resetPlayer(i = 0) {
    const H = this.humans[i];
    if (!H) return;
    const v = H.car.vehicle;
    if (v.wrecked || this.state !== 'racing') return;
    v.placeOnTrack(this.track, v.s, 0, 0);
    v.ghost = 1.5;
  }

  // --- effects ------------------------------------------------------------------
  updateFx(dt) {
    const fx = this.fx;
    const spray = this.def.weather && this.def.weather.spray;
    for (const c of this.cars) {
      const v = c.vehicle;
      if (v.wrecked) {
        if (Math.random() < dt * 20) fx.smoke.spawn(v.x, v.wreckY + 0.5, v.z, 0, 2, 0, 1.5, 1.5, 0.15, 0.15, 0.16, { drag: 0.4, grow: 3 });
        for (const w of c.model.wheels) fx.skids.add(c.id + w.side + w.front, 0, 0, 0, 0, 0, false);
        continue;
      }
      const fxv = Math.sin(v.heading), fzv = Math.cos(v.heading);
      const rx = -fzv, rz = fxv;
      const skidding = (v.drifting || Math.abs(v.slip) > 0.2 || (v.braking && v.speed > 25)) && v.speed > 8;
      for (const side of [-1, 1]) {
        const wx = v.x + rx * side * 0.95 - fxv * c.model.halfBase;
        const wz = v.z + rz * side * 0.95 - fzv * c.model.halfBase;
        fx.skids.add(c.id + side, wx, v.y, wz, fxv, fzv, skidding);
        const sliding = v.drifting || Math.abs(v.slip) > 0.28;
        if (sliding && v.speed > 8 && Math.random() < dt * (v.drifting ? 40 : 14)) fx.tyreSmoke(wx, v.y, wz, v.vx, v.vz, v.drifting ? 1.1 : 0.6);
      }
      if (spray && v.speed > 16 && this.nearestHuman(v).d2 < 120 * 120 && Math.random() < dt * v.speed * (c.human ? 0.12 : 0.3)) {
        const side = Math.random() < 0.5 ? -1 : 1;
        fx.smoke.spawn(v.x + rx * side * 0.95 - fxv * (c.model.halfBase + 0.4), v.y + 0.3, v.z + rz * side * 0.95 - fzv * (c.model.halfBase + 0.4),
          v.vx * 0.35 + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, v.vz * 0.35 + (Math.random() - 0.5) * 2,
          0.3 + Math.random() * 0.25, 0.3, spray[0], spray[1], spray[2], { drag: 0.2, grow: 0.9, grav: 2, alpha: 0.22 });
      }
      if (v.scraping > 0.5 && v.speed > 8) {
        const side = Math.sign(v.lateral);
        fx.sparks(v.x + rx * side * 1.1, v.y + 0.4, v.z + rz * side * 1.1, v.vx, v.vz, 2, 0.6);
      }
    }
  }

  syncModels() {
    for (const c of this.cars) {
      const v = c.vehicle, m = c.model;
      if (v.wrecked) {
        m.root.position.set(v.x, v.wreckY, v.z);
        m.root.quaternion.set(v.wreck.qx, v.wreck.qy, v.wreck.qz, v.wreck.qw);
        m.body.position.y = m.rideY - 0.6;
        m.body.rotation.set(0, 0, 0);
        for (const w of m.wheels) w.group.position.y = m.wheelR - 0.6;
      } else {
        m.root.rotation.set(v.pitch, v.heading, v.roll, 'YXZ');
        m.root.position.set(v.x, v.y, v.z);
        m.body.position.y = m.rideY;
        m.body.rotation.set(v.bodyPitch, 0, v.bodyRoll);
        for (const w of m.wheels) {
          w.group.position.y = m.wheelR;
          w.spin.rotation.x = v.wheelSpin;
          if (w.front) w.group.rotation.y = -v.steer * 0.42;
        }
      }
      m.shadow.visible = !v.wrecked;
      m.setBrake(v.braking);
      m.setGhost(v.ghost > 0);
    }
  }

  emitFlames(c, count) {
    const v = c.vehicle, m = c.model;
    m.root.updateMatrixWorld();
    const bx = -Math.sin(v.heading), bz = -Math.cos(v.heading);
    for (const e of m.exhausts) {
      this.tmpV.copy(e);
      m.body.localToWorld(this.tmpV);
      for (let k = 0; k < count; k++) this.fx.flame(this.tmpV.x, this.tmpV.y, this.tmpV.z, bx, bz, v.vx, v.vz);
    }
  }

  updatePresentation(realDt, dt) {
    const game = this.game;
    for (const H of this.humans) {
      H.boostVis += ((H.boost.boosting ? 1 : 0) - H.boostVis) * Math.min(1, realDt * 5);
      if (H.boost.boosting && !H.car.vehicle.wrecked) this.emitFlames(H.car, 3);
    }
    for (const c of this.cars) {
      if (c.human || !c.ai || !c.ai.boosting || c.vehicle.wrecked) continue;
      if (this.nearestHuman(c.vehicle).d2 > 90 * 90) continue;
      this.emitFlames(c, 1);
    }
    this.fx.update(dt);

    const slowmoFx = Math.max(0, 1 - this.timeScale) / 0.78;
    for (const H of this.humans) {
      const pv = H.car.vehicle;
      const speedRatio = Math.min(1.2, pv.speed / 80);
      const driftDir = pv.drifting ? Math.sign(pv.slip) * Math.min(1, Math.abs(pv.slip) * 2.5) : 0;
      H.rig.update(dt, realDt, pv, { speedRatio, boost: H.boostVis, time: this.time, driftDir });

      // post fx for this player's view
      const s = Math.max(0, (speedRatio - 0.35) / 0.65);
      H.flash *= Math.exp(-realDt * 6);
      const fx = game.renderer.fxs[H.index];
      const cine = H.rig.inCrashCam ? 0.15 : 1;
      fx.blur = (s * s * 0.55 + H.boostVis * 0.65) * cine + (this.slowmo > 0 ? 0.2 : 0);
      fx.lines = (Math.max(0, (speedRatio - 0.6) / 0.4) * 0.5 + H.boostVis * 0.9) * cine;
      fx.ca = H.boostVis * 1.2 + H.flash * 3;
      fx.boost = H.boostVis;
      fx.flash = H.flash;
      fx.slowmo = slowmoFx;

      game.audio.updateEngine({
        speed: pv.wrecked ? 0 : pv.speed, top: pv.spec.topSpeed,
        throttle: this.state === 'countdown' ? H.input.throttle : pv.wrecked ? 0 : H.car.controls.throttle,
        boost: H.boostVis, slip: pv.drifting ? Math.min(1, Math.abs(pv.slip) * 2) : Math.max(0, Math.abs(pv.slip) - 0.15) * 2,
        scraping: pv.scraping > 0.5 && pv.speed > 5 ? Math.min(1, pv.speed / 40) : 0,
        active: !pv.wrecked, slowmo: slowmoFx, volume: this.split ? 0.7 : 1,
      }, H.index);

      const e = this.race.byId.get(H.car.id);
      const eng = game.audio.engineState(H.index);
      game.ui.hud({
        speed: pv.speed * 3.6,
        rpm: eng.rpm ?? Math.min(1, pv.speed / pv.spec.topSpeed),
        gear: eng.gear ?? 1,
        position: this.race.position(H.car.id),
        total: this.cars.length,
        lap: this.race.displayLap(H.car.id),
        laps: this.laps,
        lapTime: this.state === 'countdown' ? 0 : e.finished ? e.lapTimes[e.lapTimes.length - 1] : this.time - e.lapStart,
        bestLap: e.bestLap,
        boost: H.boost.boost / RULES.maxBoost,
        boosting: H.boost.boosting,
        multiplier: H.boost.multiplier,
        chain: H.boost.chainTimer / RULES.chainWindow,
        takedowns: H.takedowns,
        drafting: H.drafting && !H.boost.boosting,
        wrongWay: H.wrongWayTime > 1.2,
        camera: H.rig.inCrashCam,
        power: H.power,
        powerKey: this.powerKey(H),
      }, H.index);
      game.minimaps[H.index].draw(this.cars, H.car);
    }
    game.audio.setSlowmo(slowmoFx);
    this.world.update(dt, this.time, this.humans[0].car.vehicle, game.renderer.cameras[0]);
  }

  results() {
    return this.race.standings().map((e, i) => {
      const c = this.cars.find((k) => k.id === e.id);
      return {
        pos: i + 1, name: c.name, car: c.spec.name, isPlayer: c.isPlayer, paint: c.paint,
        time: e.finished ? e.finishTime : null, best: e.bestLap,
        takedowns: c.human ? c.human.takedowns : null,
      };
    });
  }

  // debug: jump the player to just before the line on the final lap
  debugFinalLap() {
    const e = this.race.byId.get('player');
    e.lap = this.laps - 1; e.maxLap = this.laps - 1;
    const v = this.player.vehicle;
    v.placeOnTrack(this.track, this.track.length - 60, 0, 50);
    e.lastS = v.s;
  }
}

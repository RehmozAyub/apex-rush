// One race: cars, AI, collisions, Burnout events (boost, near miss, draft, takedowns, crashes),
// effects, camera, audio and HUD feed.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { AIDriver } from './ai.js';
import { buildCar, disposeCar } from './carModel.js';
import { Effects } from './fx.js';
import { RaceTracker } from './race.js';
import { BoostSystem, RULES, isNearMiss, isDrafting, classifyImpact, isPushTakedown, isWallCrash } from './burnout.js';
import { CARS, PAINTS, AI_NAMES, AI_COUNT, LAPS } from './config.js';
import { wrapAngle } from './trackMath.js';
import { PickupState, layoutPickups, randomPower, strikeTarget, POWERS, PICKUP_RULES } from './powerups.js';
import { PickupVisuals } from './pickups.js';

const CIRCLE_R = 1.05;
const CIRCLE_OFF = 1.2;
const SUB_DT = 1 / 120;

export class RaceSession {
  constructor(game, world, { carIndex, paintIndex, laps = LAPS }) {
    this.game = game;
    this.world = world;
    this.track = world.track;
    this.def = world.def;
    this.laps = laps;
    this.fx = new Effects(world.scene);
    this.fx.smokeColor = this.def.smoke;
    this.boost = new BoostSystem();
    this.state = 'countdown';
    this.countdown = 3.6;
    this.lastCount = 4;
    this.time = 0;
    this.timeScale = 1;
    this.slowmo = 0;
    this.takedowns = 0;
    this.wrongWayTime = 0;
    this.finishTimer = 0;
    this.boostVis = 0;
    this.flash = 0;
    this.impactCooldown = 0;
    this.best = null;
    this.tmpV = new THREE.Vector3();

    // grid: 8 cars, player starts mid-pack
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    const aiSkill = [0.98, 0.955, 0.995, 0.94, 0.97, 0.95, 0.985];
    const aiAggro = [0.3, 0.7, 0.2, 0.85, 0.5, 0.4, 0.6];
    const paints = PAINTS.filter((p, i) => i !== paintIndex).sort(() => Math.random() - 0.5);
    const numbers = [3, 7, 11, 13, 21, 44, 77, 88, 99].sort(() => Math.random() - 0.5);
    const playerSpec = CARS[carIndex];
    const playerSlot = 5;
    const L = this.track.length;
    this.cars = [];
    let ai = 0;
    for (let slot = 0; slot < AI_COUNT + 1; slot++) {
      const row = Math.floor(slot / 2), col = slot % 2;
      const s = L - 12 - row * 11 - col * 5;
      const lat = col ? 4.2 : -4.2;
      const isPlayer = slot === playerSlot;
      const spec = isPlayer ? playerSpec : CARS[Math.floor(Math.random() * CARS.length)];
      const paint = isPlayer ? PAINTS[paintIndex].hex : paints[ai % paints.length].hex;
      const v = new Vehicle(spec);
      v.placeOnTrack(this.track, s, lat, 0);
      const model = buildCar(spec.style, paint, { underglow: this.def.underglow ? paint : null, number: isPlayer ? 1 : numbers[ai] });
      model.root.rotation.order = 'YXZ';
      world.scene.add(model.root);
      const car = {
        id: isPlayer ? 'player' : `ai${ai}`,
        name: isPlayer ? 'YOU' : names[ai],
        isPlayer, vehicle: v, model, spec, paint,
        ai: isPlayer ? null : new AIDriver(v, this.track, { lane: lat * 0.6, skill: aiSkill[ai], aggression: aiAggro[ai], refTopSpeed: playerSpec.topSpeed }),
        controls: { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false },
        pushedAt: -99, lastContact: -99, prevFwd: 0, respawn: 0, mul: 1, crashAt: -99,
      };
      if (!isPlayer) ai++;
      this.cars.push(car);
    }
    this.player = this.cars.find((c) => c.isPlayer);
    this.race = new RaceTracker(L, laps, this.cars.map((c) => c.id));
    for (const c of this.cars) this.race.update(c.id, c.vehicle.s, 0);

    // road pickups
    this.pickState = new PickupState(layoutPickups(L, this.track.halfWidth));
    this.pickVis = new PickupVisuals(world.scene, this.track, this.pickState.items);
    this.pickVis.attachShield(this.player.model.root);
    this.power = null;
    this.ramTime = 0;
    this.powerHeld = false;
    this.pendingStrike = null;

    if (this.def.headlights) {
      const spot = new THREE.SpotLight(0xe8f0ff, 120, 90, 0.55, 0.6, 1.4);
      spot.position.set(0, 0.8, 2.0);
      spot.target.position.set(0, 0, 30);
      this.player.model.root.add(spot, spot.target);
    }
    game.rig.snap = true;
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

  get playerVehicle() { return this.player.vehicle; }

  popup(title, sub = '', kind = '') { this.game.ui.popup(title, sub, kind); }

  // --- main update ----------------------------------------------------------------
  update(realDt) {
    const game = this.game;
    // slow motion
    this.slowmo = Math.max(0, this.slowmo - realDt);
    const targetScale = this.slowmo > 0 ? 0.22 : 1;
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, realDt * (this.slowmo > 0 ? 12 : 3));
    const dt = realDt * this.timeScale;
    this.time += dt;
    this.impactCooldown -= realDt;

    const pv = this.player.vehicle;
    const input = game.input.drive();

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
        if (input.throttle > 0.5) { this.boost.add(15); this.popup('PERFECT START', '+BOOST', 'good'); }
      }
    }
    const racing = this.state === 'racing' || this.state === 'finished';

    // player boost
    let drafting = false;
    if (racing && !pv.wrecked) {
      for (const c of this.cars) {
        if (c.isPlayer || c.vehicle.wrecked) continue;
        const r = this.relative(pv, c.vehicle);
        if (isDrafting({ fwd: r.fwd, lat: r.lat, speed: pv.speed })) drafting = true;
      }
    }
    this.drafting = drafting;
    const events = this.boost.update(dt, {
      drifting: racing && pv.drifting && pv.speed > 15,
      drafting,
      boostHeld: this.state === 'racing' && input.boost && !pv.wrecked,
    });
    for (const e of events) if (e.type === 'drift') this.scoreEvent('DRIFT', e.gained);
    const wasBoosting = this.wasBoosting;
    this.wasBoosting = this.boost.boosting;
    if (this.boost.boosting && !wasBoosting) { game.audio.whoosh(true, 0.35); game.rig.addShake(0.3); }

    // controls
    for (const c of this.cars) {
      const v = c.vehicle;
      if (!racing) {
        c.controls = { steer: 0, throttle: 0, brake: 1, handbrake: false, boost: false };
        continue;
      }
      if (c.isPlayer && this.state === 'racing' && !this.autopilot) {
        c.controls = { ...input, boost: this.boost.boosting, draft: drafting };
        c.mul = 1;
      } else {
        if (!c.ai) c.ai = new AIDriver(v, this.track, { lane: v.lateral, skill: 0.8, aggression: 0 });
        const pe = this.race.byId.get('player'), me = this.race.byId.get(c.id);
        const ctl = c.ai.think(dt, this.cars, c.isPlayer ? null : pv, pe.progress, me.progress);
        c.mul = c.isPlayer ? (this.autopilotMul ?? 0.85) : c.ai.mul;
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

    // respawns
    for (const c of this.cars) {
      if (!c.vehicle.wrecked) continue;
      c.respawn -= dt;
      if (c.respawn <= 0) this.respawn(c);
    }

    if (racing) this.updateRaceEvents(dt);
    if (racing) this.updatePickups(dt, input);
    this.pickVis.update(dt, this.time, this.ramTime > 0);
    this.updateFx(dt);
    this.syncModels();
    this.updatePresentation(realDt, dt, input);
  }

  // --- road pickups and power-ups -------------------------------------------------
  updatePickups(dt, input) {
    const game = this.game;
    for (const it of this.pickState.update(dt)) this.pickVis.setActive(it, true);
    for (const c of this.cars) {
      const v = c.vehicle;
      if (v.wrecked) continue;
      const it = this.pickState.near(v.x, v.z);
      if (!it) continue;
      if (it.kind === 'boost') {
        this.pickState.take(it);
        this.pickVis.setActive(it, false);
        if (c.isPlayer) {
          const gained = this.boost.add(PICKUP_RULES.boostAmount);
          this.popup('BOOST PICKUP', `+${Math.round(gained)} BOOST`, 'good');
          game.audio.pickup(false);
        } else if (c.ai) c.ai.boostFuel = Math.min(100, c.ai.boostFuel + PICKUP_RULES.aiBoostFuel);
      } else if (c.isPlayer && !this.power) {
        this.pickState.take(it);
        this.pickVis.setActive(it, false);
        this.power = randomPower();
        const p = POWERS[this.power];
        this.popup(p.name, 'PRESS E TO UNLEASH', 'power');
        game.audio.pickup(true);
      }
    }

    if (this.ramTime > 0) this.ramTime -= dt;
    if (this.pendingStrike) {
      this.pendingStrike.t -= dt;
      if (this.pendingStrike.t <= 0) {
        const c = this.pendingStrike.car;
        this.pendingStrike = null;
        if (!c.vehicle.wrecked) this.takedown(c, Math.sin(c.vehicle.heading), Math.cos(c.vehicle.heading), 'STRUCK DOWN');
      }
    }

    // fire on key press (edge)
    const pressed = input.power && !this.powerHeld;
    this.powerHeld = !!input.power;
    if (pressed && this.power && this.state === 'racing' && !this.player.vehicle.wrecked) this.usePower();
  }

  usePower() {
    const game = this.game;
    const pv = this.player.vehicle;
    const kind = this.power;
    if (kind === 'shockwave') {
      this.power = null;
      this.pickVis.shockwave(pv.x, pv.y, pv.z);
      this.fx.sparks(pv.x, pv.y + 0.6, pv.z, pv.vx, pv.vz, 50, 2);
      game.audio.shockwave();
      game.rig.addShake(0.9);
      this.flash = Math.max(this.flash, 0.3);
      let hits = 0;
      for (const c of this.cars) {
        if (c.isPlayer || c.vehicle.wrecked || c.vehicle.ghost > 0) continue;
        const dx = c.vehicle.x - pv.x, dz = c.vehicle.z - pv.z;
        const d = Math.hypot(dx, dz);
        if (d < PICKUP_RULES.shockRadius) { this.takedown(c, dx / (d || 1), dz / (d || 1), 'SHOCKWAVE', true); hits++; }
      }
      if (!hits) this.popup('SHOCKWAVE', 'NO ONE IN RANGE', '');
      else {
        this.popup(hits > 1 ? `SHOCKWAVE ×${hits}` : 'SHOCKWAVE', `${hits} TAKEDOWN${hits > 1 ? 'S' : ''}`, 'takedown');
        this.slowmo = 1.4;
        this.flash = 0.5;
        this.game.rig.addShake(1);
      }
    } else if (kind === 'ram') {
      this.power = null;
      this.ramTime = PICKUP_RULES.ramTime;
      this.popup('BATTERING RAM', 'SMASH THEM!', 'power');
      game.audio.whoosh(true, 0.4);
      game.audio.shockwave(0.5);
    } else if (kind === 'strike') {
      const pe = this.race.byId.get('player');
      const rivals = this.cars.filter((c) => !c.isPlayer && c.vehicle.ghost <= 0).map((c) => ({ car: c, wrecked: c.vehicle.wrecked, progress: this.race.byId.get(c.id).progress }));
      const t = strikeTarget(pe.progress, rivals);
      if (!t) { this.popup('LIGHTNING STRIKE', 'NO TARGET AHEAD', ''); return; }
      this.power = null;
      const v = t.car.vehicle;
      this.pickVis.lightning(new THREE.Vector3(v.x + 6, v.y + 70, v.z - 4), new THREE.Vector3(v.x, v.y + 0.8, v.z));
      game.audio.thunder(1);
      this.flash = Math.max(this.flash, 0.45);
      this.pendingStrike = { car: t.car, t: 0.12 };
    }
  }

  relative(from, to) {
    const fx = Math.sin(from.heading), fz = Math.cos(from.heading);
    const dx = to.x - from.x, dz = to.z - from.z;
    return { fwd: dx * fx + dz * fz, lat: dx * -fz + dz * fx };
  }

  scoreEvent(label, gained) {
    const m = this.boost.multiplier;
    this.popup(label, `+${Math.round(gained)} BOOST${m > 1 ? `  ×${m}` : ''}`, 'good');
    this.game.audio.chime(m);
  }

  updateRaceEvents(dt) {
    const pv = this.player.vehicle;
    // lap / finish
    for (const c of this.cars) {
      const r = this.race.update(c.id, c.vehicle.s, this.time);
      if (!c.isPlayer || !r) continue;
      const e = this.race.byId.get('player');
      if (r === 'lap') {
        const lt = e.lapTimes[e.lapTimes.length - 1];
        const isBest = e.bestLap === lt;
        const lap = e.maxLap + 1;
        this.popup(lap === this.laps ? 'FINAL LAP' : `LAP ${lap}`, `${isBest && e.lapTimes.length > 1 ? 'BEST ' : ''}${this.game.fmt(lt)}`, lap === this.laps ? 'hot' : '');
      } else if (r === 'finish') {
        this.state = 'finished';
        this.finishTimer = 0;
        const pos = this.race.position('player');
        this.popup(pos === 1 ? 'VICTORY' : `FINISHED P${pos}`, this.game.fmt(e.finishTime), pos === 1 ? 'hot' : '');
        this.game.audio.whoosh(false, 0.3);
      }
    }
    if (this.state === 'finished') {
      this.finishTimer += dt;
      if (this.finishTimer > 4 && !this.resultsShown) {
        this.resultsShown = true;
        this.game.showResults(this.results());
      }
    }

    // near misses
    if (!pv.wrecked) {
      for (const c of this.cars) {
        if (c.isPlayer) continue;
        const ov = c.vehicle;
        const r = this.relative(pv, ov);
        const rel = this.relative(ov, pv);
        if (!ov.wrecked && Math.abs(r.lat) < 6 && isNearMiss({ prevFwd: c.prevFwd, fwd: -rel.fwd, lat: r.lat, relSpeed: pv.speed - ov.speed, sinceContact: this.time - c.lastContact })) {
          this.scoreEvent('NEAR MISS', this.boost.event(RULES.nearMissGain));
          this.game.audio.whoosh(false, 0.25);
        }
        c.prevFwd = -rel.fwd; // + while the AI is ahead of the player
      }
    }

    // wrong way
    const th = this.track.headingAt(pv.idx);
    const off = Math.abs(wrapAngle(pv.heading - th));
    if (off > 1.9 && pv.speed > 4 && !pv.wrecked) this.wrongWayTime += dt; else this.wrongWayTime = 0;
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
        // a little spin from off-centre hits
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
    const involvesPlayer = ca.isPlayer || cb.isPlayer;
    if (!involvesPlayer) return;
    if (this.state !== 'racing') return;
    const other = ca.isPlayer ? cb : ca;
    // player share of the closing speed
    const pP = ca.isPlayer ? pA : pB, pO = ca.isPlayer ? pB : pA;
    const share = Math.max(0, pP) / (Math.max(0, pP) + Math.max(0, pO) + 1e-3);
    if (closing > 3 && this.impactCooldown <= 0) {
      this.game.audio.impact(Math.min(1.2, closing / 15));
      this.game.rig.addShake(Math.min(0.8, closing / 20));
      this.impactCooldown = 0.15;
    }
    other.lastContact = this.time;
    if (other.vehicle.wrecked || this.player.vehicle.wrecked) return;
    if (this.ramTime > 0) {
      if (closing > 1.5) this.takedown(other, (ca.isPlayer ? 1 : -1) * nx, (ca.isPlayer ? 1 : -1) * nz, 'RAM TAKEDOWN');
      return;
    }
    const kind = classifyImpact({ closing, playerShare: share });
    const dirSign = ca.isPlayer ? 1 : -1; // normal points from ca to cb
    if (kind === 'takedown') this.takedown(other, nx * dirSign, nz * dirSign);
    else if (kind === 'playerWrecked') this.crashPlayer('TAKEN OUT', -nx * dirSign, -nz * dirSign, other);
    else if (kind === 'push') other.pushedAt = this.time;
  }

  onWallHit(c, hit) {
    if (this.state === 'countdown') return;
    const v = c.vehicle;
    if (hit.vn > 3) this.fx.sparks(hit.x, hit.y, hit.z, v.vx, v.vz, Math.min(30, hit.vn * 2), Math.min(2, hit.vn / 12));
    if (c.isPlayer) {
      if (v.wrecked) return;
      if (this.state === 'racing' && this.ramTime <= 0 && isWallCrash({ speed: hit.speed, angleDeg: hit.angle })) {
        this.crashPlayer('WRECKED', hit.nx, hit.nz);
      } else if (hit.vn > 4 && this.impactCooldown <= 0) {
        this.game.audio.impact(Math.min(1, hit.vn / 18));
        this.game.rig.addShake(Math.min(0.6, hit.vn / 25));
        this.flash = Math.max(this.flash, Math.min(0.12, hit.vn / 150));
        this.impactCooldown = 0.15;
      }
    } else if (!v.wrecked && this.state === 'racing') {
      if (isPushTakedown({ sincePush: this.time - c.pushedAt, wallSpeed: hit.vn })) this.takedown(c, hit.nx, hit.nz);
    }
  }

  takedown(c, dirX, dirZ, label = 'TAKEDOWN!', quiet = false) {
    const v = c.vehicle;
    if (v.wrecked) return;
    v.crash(dirX, dirZ, 1.3);
    c.respawn = 3.4;
    c.pushedAt = -99;
    this.takedowns++;
    this.fx.explosion(v.x, v.y + 0.6, v.z, v.vx, v.vz, c.paint, v.y);
    this.game.audio.crash();
    const gained = this.boost.event(RULES.takedownGain);
    if (quiet) return;
    const m = this.boost.multiplier;
    this.popup(label, `${c.name}${gained >= 1 ? `  +${Math.round(gained)} BOOST` : ''}${m > 1 ? `  ×${m}` : ''}`, 'takedown');
    this.slowmo = 1.4;
    this.flash = 0.5;
    this.game.rig.startCrashCam(v, 1.4, Math.random() < 0.5 ? 1 : -1);
    this.game.rig.addShake(1);
  }

  crashPlayer(label, dirX, dirZ, by = null) {
    const v = this.player.vehicle;
    if (v.wrecked) return;
    v.crash(dirX, dirZ, 1);
    this.player.respawn = 2.4;
    this.boost.resetChain();
    this.fx.explosion(v.x, v.y + 0.6, v.z, v.vx, v.vz, this.player.paint, v.y);
    this.game.audio.crash();
    this.popup(label, by ? `by ${by.name}` : 'CRASH', 'bad');
    this.slowmo = 1.8;
    this.flash = 0.35;
    this.game.rig.startCrashCam(v, 1.8, 1);
  }

  respawn(c) {
    const v = c.vehicle;
    let s = v.s;
    if (!c.isPlayer) {
      const d = this.track.deltaS(this.player.vehicle.s, s);
      if (Math.abs(d) < 30) s = this.track.wrapS(this.player.vehicle.s - 40);
    }
    // keep lap bookkeeping consistent: never respawn across the start line backwards
    v.placeOnTrack(this.track, s, c.isPlayer ? 0 : c.ai.lane, c.isPlayer ? 24 : 20);
    v.ghost = 1.6;
    c.respawn = 0;
  }

  resetPlayer() {
    const c = this.player, v = c.vehicle;
    if (v.wrecked || this.state !== 'racing') return;
    v.placeOnTrack(this.track, v.s, 0, 0);
    v.ghost = 1.5;
  }

  // --- effects ------------------------------------------------------------------
  updateFx(dt) {
    const fx = this.fx;
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
      const spray = this.def.weather && this.def.weather.spray;
      if (spray && v.speed > 16 && (v.x - this.player.vehicle.x) ** 2 + (v.z - this.player.vehicle.z) ** 2 < 120 * 120 && Math.random() < dt * v.speed * (c.isPlayer ? 0.12 : 0.3)) {
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

  updatePresentation(realDt, dt, input) {
    const game = this.game;
    const pv = this.player.vehicle;
    const speedRatio = Math.min(1.2, pv.speed / 80);
    this.boostVis += ((this.boost.boosting ? 1 : 0) - this.boostVis) * Math.min(1, realDt * 5);

    // boost flames
    if (this.boost.boosting && !pv.wrecked) {
      const m = this.player.model;
      m.root.updateMatrixWorld();
      const bx = -Math.sin(pv.heading), bz = -Math.cos(pv.heading);
      for (const e of m.exhausts) {
        this.tmpV.copy(e);
        m.body.localToWorld(this.tmpV);
        for (let k = 0; k < 3; k++) this.fx.flame(this.tmpV.x, this.tmpV.y, this.tmpV.z, bx, bz, pv.vx, pv.vz);
      }
    }
    for (const c of this.cars) {
      if (c.isPlayer || !c.ai || !c.ai.boosting || c.vehicle.wrecked) continue;
      const v = c.vehicle, m = c.model;
      if ((v.x - pv.x) ** 2 + (v.z - pv.z) ** 2 > 90 * 90) continue;
      m.root.updateMatrixWorld();
      const bx = -Math.sin(v.heading), bz = -Math.cos(v.heading);
      for (const e of m.exhausts) {
        this.tmpV.copy(e);
        m.body.localToWorld(this.tmpV);
        this.fx.flame(this.tmpV.x, this.tmpV.y, this.tmpV.z, bx, bz, v.vx, v.vz);
      }
    }
    this.fx.update(dt);

    // camera + world
    const driftDir = pv.drifting ? Math.sign(pv.slip) * Math.min(1, Math.abs(pv.slip) * 2.5) : 0;
    game.rig.update(dt, realDt, pv, { speedRatio, boost: this.boostVis, time: this.time, driftDir });
    this.world.update(dt, this.time, pv, game.renderer.camera);

    // post fx
    const s = Math.max(0, (speedRatio - 0.35) / 0.65);
    this.flash *= Math.exp(-realDt * 6);
    const fx = game.renderer.fx;
    const cine = game.rig.inCrashCam ? 0.15 : 1;
    fx.blur = (s * s * 0.55 + this.boostVis * 0.65) * cine + (this.slowmo > 0 ? 0.2 : 0);
    fx.lines = (Math.max(0, (speedRatio - 0.6) / 0.4) * 0.5 + this.boostVis * 0.9) * cine;
    fx.ca = this.boostVis * 1.2 + this.flash * 3;
    fx.boost = this.boostVis;
    fx.flash = this.flash;
    fx.slowmo = Math.max(0, 1 - this.timeScale) / 0.78;

    // audio
    game.audio.updateEngine({
      speed: pv.wrecked ? 0 : pv.speed, top: pv.spec.topSpeed,
      throttle: this.state === 'countdown' ? input.throttle : pv.wrecked ? 0 : this.player.controls.throttle,
      boost: this.boostVis, slip: pv.drifting ? Math.min(1, Math.abs(pv.slip) * 2) : Math.max(0, Math.abs(pv.slip) - 0.15) * 2,
      scraping: pv.scraping > 0.5 && pv.speed > 5 ? Math.min(1, pv.speed / 40) : 0,
      active: !pv.wrecked, slowmo: fx.slowmo,
    });
    game.audio.setSlowmo(fx.slowmo);

    // HUD
    const e = this.race.byId.get('player');
    game.ui.hud({
      speed: pv.speed * 3.6,
      rpm: game.audio.rpm ?? Math.min(1, pv.speed / pv.spec.topSpeed),
      gear: game.audio.gear ?? 1,
      position: this.race.position('player'),
      total: this.cars.length,
      lap: this.race.displayLap('player'),
      laps: this.laps,
      lapTime: this.state === 'countdown' ? 0 : e.finished ? e.lapTimes[e.lapTimes.length - 1] : this.time - e.lapStart,
      bestLap: e.bestLap,
      boost: this.boost.boost / RULES.maxBoost,
      boosting: this.boost.boosting,
      multiplier: this.boost.multiplier,
      chain: this.boost.chainTimer / RULES.chainWindow,
      takedowns: this.takedowns,
      drafting: this.drafting && !this.boost.boosting,
      wrongWay: this.wrongWayTime > 1.2,
      camera: game.rig.inCrashCam,
      power: this.power,
      ram: this.ramTime > 0 ? this.ramTime / PICKUP_RULES.ramTime : 0,
    });
    game.minimap.draw(this.cars, this.player);
  }

  results() {
    return this.race.standings().map((e, i) => {
      const c = this.cars.find((k) => k.id === e.id);
      return {
        pos: i + 1, name: c.name, car: c.spec.name, isPlayer: c.isPlayer, paint: c.paint,
        time: e.finished ? e.finishTime : null, best: e.bestLap,
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

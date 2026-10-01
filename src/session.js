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
import { CARS, PAINTS, BASE_PAINTS, AI_NAMES, AI_COUNT, LAPS } from './config.js';
import { wrapAngle } from './trackMath.js';
import { PickupState, layoutPickups, strikeTarget, stepShot, inBox, aiWantsPower, POWERS, PICKUP_RULES, AI_POWER } from './powerups.js';
import { PickupVisuals } from './pickups.js';
import { DriveAssist, ASSIST_RULES } from './assist.js';
import { signatureAt, hairpinS } from './signatures.js';
import { constrainOnRoads } from './shortcut.js';
import { FenceProps } from './props.js';
import { RivalMarkers } from './markers.js';

// what a human sees when a power-up (or a rival) wrecks them
const VICTIM_LABEL = { 'TAKEDOWN!': 'TAKEN OUT', 'RICOCHET TAKEDOWN': 'RICOCHETED', SHOCKWAVE: 'SHOCKWAVED' };

const CIRCLE_R = 1.05;
const CIRCLE_OFF = 1.2;
const SUB_DT = 1 / 120;

export class RaceSession {
  constructor(game, world, opts) {
    this.game = game;
    this.world = world;
    this.track = world.track;
    this.def = world.def;
    this.shortcuts = world.shortcuts || null; // ShortcutSet
    this.landmark = world.landmark || null;
    this.hairpin = hairpinS(this.track);
    this.tmpP = {}; this.tmpQ = {};
    this.finalLap = false;
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
    this.aiPowerCooldown = 6; // AI rivals hold fire for the first seconds
    this.tmpV = new THREE.Vector3();

    // grid: 8 cars; one player starts mid-pack, two players share a row
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    const aiSkill = [0.98, 0.955, 0.995, 0.94, 0.97, 0.95, 0.985];
    const aiAggro = [0.3, 0.7, 0.2, 0.85, 0.5, 0.4, 0.6];
    const humanPaints = humanDefs.map((h) => h.paintIndex);
    const paints = PAINTS.slice(0, BASE_PAINTS).filter((p, i) => !humanPaints.includes(i)).sort(() => Math.random() - 0.5);
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
      const model = buildCar(spec.style, paint, { underglow: this.def.underglow ? paint : null, number: isPlayer ? hi + 1 : numbers[ai], finish: isPlayer ? PAINTS[hd.paintIndex].finish : null });
      model.root.rotation.order = 'YXZ';
      world.scene.add(model.root);
      const car = {
        id: isPlayer ? (hi === 0 ? 'player' : 'player2') : `ai${ai}`,
        name: isPlayer ? (this.split ? `P${hi + 1}` : 'YOU') : names[ai],
        isPlayer, vehicle: v, model, spec, paint, human: null,
        ai: isPlayer ? null : new AIDriver(v, this.track, { lane: lat * 0.6, skill: aiSkill[ai % aiSkill.length], aggression: aiAggro[ai % aiAggro.length], refTopSpeed: refTop, shortcuts: this.shortcuts ? this.shortcuts.list : [] }),
        controls: { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false },
        power: null, powerTime: 0,
        pushedAt: -99, pushedBy: null, lastContact: -99, prevFwd: [0, 0], respawn: 0, mul: 1,
      };
      if (isPlayer) {
        const H = {
          index: hi, car, boost: new BoostSystem(), powerHeld: false, drafting: false,
          wrongWayTime: 0, takedowns: 0, boostVis: 0, flash: 0, wasBoosting: false, finished: false,
          rig: game.rigs[hi], input: null, incoming: false, shieldUntil: -99,
          rival: null, crashes: 0, paybacks: 0, drama: '',
          assist: new DriveAssist(this.track), assistOn: game.assistOn(hi),
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
    const pickList = layoutPickups(L, this.track.halfWidth);
    for (const sc of this.shortcuts ? this.shortcuts.list : []) {
      if (!sc.boostRing) continue;
      // a boost ring halfway along: a reason to find this one
      const sp = sc.path.pointAt(sc.path.length / 2, 0);
      pickList.push({ kind: 'boost', s: sc.mainS(sc.path.length / 2), lateral: 0, pos: sp });
    }
    this.pickState = new PickupState(pickList);
    this.pickVis = new PickupVisuals(world.scene, this.track, this.pickState.items);
    this.shots = []; // ricochet shots: {owner, s, lat, vs, vl, t}
    this.slicks = []; // oil slicks: {owner, id, s, lat, t}
    this.slickId = 0;
    this.pendingStrikes = [];
    this.markers = new RivalMarkers(world.scene, this.humans.length);
    this.fences = new FenceProps(world.scene, this.shortcuts ? this.shortcuts.list : []);

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
    this.markers.dispose();
    this.fences.dispose();
    this.game.audio.setIntensity(0);
    for (const o of [this.fx.skids.mesh, this.fx.smoke.points, this.fx.glow.points, this.fx.debris.mesh]) {
      this.world.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }

  // --- single-player compatibility accessors (debug hooks and tests) ---------------------
  get playerVehicle() { return this.player.vehicle; }
  get boost() { return this.humans[0].boost; }
  get power() { return this.player.power; }
  set power(v) { this.player.power = v; }
  get takedowns() { return this.humans.reduce((a, H) => a + H.takedowns, 0); }
  get shot() { return this.shots.find((s) => s.owner === this.player) || null; }

  setAssist(i, on) { if (this.humans[i]) this.humans[i].assistOn = on; }

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
        const ctl = H.assistOn ? H.assist.apply(v, H.input) : H.input;
        c.controls = { ...ctl, boost: H.boost.boosting, draft: H.drafting };
        c.mul = 1;
      } else {
        if (!c.ai) c.ai = new AIDriver(v, this.track, { lane: v.lateral, skill: 0.8, aggression: 0, shortcuts: this.shortcuts ? this.shortcuts.list : [] });
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
        const v = c.vehicle, prevU = v.onSC ? v.scU : -1, prevSC = v.sc;
        v.update(h, c.controls, c.mul);
        const hit = this.constrainCar(c, h);
        if (hit) this.onWallHit(c, hit);
        if (v.onSC && v.sc === prevSC && v.sc.fence && this.fences.hit(v.sc, prevU, v.scU, v)) this.onFence(c);
      }
      this.collide();
    }
    for (const c of this.cars) if (c.vehicle.events && c.vehicle.events.length) this.onAirEvents(c);
    this.fences.update(dt, this.cars);

    for (const c of this.cars) {
      if (!c.vehicle.wrecked) continue;
      c.respawn -= dt;
      if (c.respawn <= 0) this.respawn(c);
    }

    if (racing) { this.updateRaceEvents(dt); this.updateFinalLap(dt); }
    if (racing) this.updatePickups(dt);
    this.pickVis.update(dt, this.time);
    this.updateFx(dt);
    this.syncModels();
    this.updatePresentation(realDt, dt);
  }

  // --- shortcut ---------------------------------------------------------------------
  // Keeps a car on whichever road it is on. At the fork and the merge the barrier between the
  // roads is open, and a car crossing that edge switches roads. On the shortcut, v.s is mapped
  // back onto the main road (so race progress keeps working) and v.scU / v.scIdx hold the
  // position along the shortcut.
  constrainCar(c, dt) {
    return constrainOnRoads(c.vehicle, this.track, this.shortcuts, dt, this.tmpP, this.tmpQ);
  }

  // smashed through a fence into a hidden shortcut
  onFence(c) {
    const v = c.vehicle;
    v.vx *= 0.94; v.vz *= 0.94;
    this.fx.sparks(v.x + Math.sin(v.heading) * 2, v.y + 0.8, v.z + Math.cos(v.heading) * 2, v.vx, v.vz, 10, 0.6);
    const vol = c.human ? 1 : this.audibility(v);
    if (vol > 0.05) this.game.audio.impact(0.6 * vol);
    if (c.human) {
      c.human.rig.addShake(0.5);
      this.popup('SMASHED THROUGH', 'SECRET SHORTCUT', 'good', c.human);
    }
  }

  // ramps: airtime fills the boost meter; a spin or barrel roll pays extra
  onAirEvents(c) {
    const H = c.human, v = c.vehicle;
    for (const e of v.events) {
      if (e.type !== 'land') continue;
      if (e.impact > 6) { this.fx.tyreSmoke(v.x, v.y, v.z, v.vx, v.vz, 1.2); if (H) H.rig.addShake(Math.min(0.6, e.impact / 25)); }
      if (!H || e.airTime < 0.35) continue;
      const air = Math.round(e.airTime * 10) / 10;
      if (e.trick && e.clean) {
        const name = { roll: 'BARREL ROLL', spin: 'FLAT SPIN', donut: 'AERIAL DONUT' }[e.trick];
        const bonus = e.trick === 'donut' ? 1.3 : 0.8;
        this.scoreEvent(H, name, H.boost.event(RULES.takedownGain * bonus + e.airTime * 10));
      } else {
        this.scoreEvent(H, `AIR TIME ${air.toFixed(1)}s`, H.boost.event(8 + e.airTime * 14));
      }
    }
    v.events.length = 0;
  }

  // road direction under a car (the shortcut's when it is on it)
  roadHeading(v) {
    return v.onSC && v.sc ? v.sc.path.headingAt(v.scIdx) : this.track.headingAt(v.idx);
  }

  // per-human race summary for stars and progress
  humanStats() {
    return this.humans.map((H) => ({ index: H.index, pos: this.race.position(H.car.id), takedowns: H.takedowns, crashes: H.crashes, finished: H.finished }));
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
      } else if (H) {
        // a new block always replaces the power-up you hold
        this.pickState.take(it);
        this.pickVis.setActive(it, false);
        const old = c.power;
        c.power = it.power;
        this.popup(POWERS[c.power].name, old && old !== c.power ? `REPLACED ${POWERS[old].name}` : `PRESS ${this.powerKey(H)} TO UNLEASH`, 'power', H);
        game.audio.pickup(true);
      } else if (!c.power) {
        // an AI grabs a block only some of the time (one roll per block it drives through)
        if (!c.blockRoll || c.blockRoll.id !== it.id || this.time - c.blockRoll.t > 3) c.blockRoll = { id: it.id, t: this.time, take: Math.random() < AI_POWER.pickChance };
        if (!c.blockRoll.take) continue;
        this.pickState.take(it);
        this.pickVis.setActive(it, false);
        c.power = it.power;
        c.powerTime = 0;
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
      if (pressed && H.car.power && this.state === 'racing' && !H.finished && !H.car.vehicle.wrecked) this.usePower(H.car);
    }
    if (this.state === 'racing') this.updateAIPowers(dt);

    // warn humans about a ricochet coming up behind them
    for (const H of this.humans) {
      const hv = H.car.vehicle;
      const me = this.roadPos(H.car);
      H.incoming = !hv.wrecked && this.shots.some((sh) => {
        if (sh.owner === H.car || sh.sc !== me.sc) return false;
        const d = this.roadOf(sh.sc).deltaS(sh.s, me.s);
        return d > 0 && d < 90;
      });
    }
  }

  // AI rivals fire the power-ups they picked up, now and then (see AI_POWER)
  updateAIPowers(dt) {
    const R = AI_POWER;
    this.aiPowerCooldown -= dt;
    for (const c of this.cars) {
      if (c.human || !c.power) continue;
      c.powerTime += dt;
      const v = c.vehicle;
      if (this.aiPowerCooldown > 0 || c.powerTime < R.minHold || v.wrecked || v.ghost > 0) continue;
      if (Math.random() > dt * R.useRate) continue;
      if (!aiWantsPower(c.power, this.aiPowerContext(c))) continue;
      this.usePower(c);
      this.aiPowerCooldown = R.cooldown * (0.8 + Math.random() * 0.5);
    }
  }

  aiPowerContext(me) {
    const v = me.vehicle, track = this.track;
    const myProg = this.race.byId.get(me.id).progress;
    const ctx = { held: me.powerTime, near: [], ahead: [], behind: [], myLat: v.lateral, strike: null };
    const rivals = [];
    for (const c of this.cars) {
      if (c === me || c.vehicle.wrecked || c.vehicle.ghost > 0) continue;
      const o = c.vehicle;
      const shielded = !!c.human && this.time < c.human.shieldUntil;
      const d = track.deltaS(v.s, o.s); // + = ahead on the road
      const info = { gap: Math.abs(d), lat: o.lateral, shielded, dist: Math.hypot(o.x - v.x, o.z - v.z) };
      ctx.near.push(info);
      (d > 0 ? ctx.ahead : ctx.behind).push(info);
      rivals.push({ car: c, shielded, wrecked: false, progress: this.race.byId.get(c.id).progress });
    }
    ctx.ahead.sort((a, b) => a.gap - b.gap);
    ctx.strike = strikeTarget(myProg, rivals);
    return ctx;
  }

  // how loud an event at position p is for the humans (1 close by, 0 far away)
  audibility(p) {
    return Math.max(0, Math.min(1, 1.15 - Math.sqrt(this.nearestHuman(p).d2) / 220));
  }

  powerKey(H) {
    if (this.game.input.lastDevice === 'pad') return 'LB';
    return this.split && H.index === 1 ? 'ENTER' : 'E';
  }

  // Fire car `me`'s power-up (human or AI).
  usePower(me = this.player) {
    const game = this.game;
    const H = me.human;
    const pv = me.vehicle;
    const kind = me.power;
    const vol = H ? 1 : this.audibility(pv);
    const others = this.cars.filter((c) => c !== me);
    if (kind === 'shockwave') {
      me.power = null;
      this.pickVis.shockwave(pv.x, pv.y, pv.z);
      this.fx.sparks(pv.x, pv.y + 0.6, pv.z, pv.vx, pv.vz, 50, 2);
      if (vol > 0.02) game.audio.shockwave(vol);
      if (H) { H.rig.addShake(0.9); H.flash = Math.max(H.flash, 0.3); }
      let hits = 0;
      for (const c of others) {
        if (c.vehicle.wrecked || c.vehicle.ghost > 0) continue;
        const dx = c.vehicle.x - pv.x, dz = c.vehicle.z - pv.z;
        const d = Math.hypot(dx, dz);
        if (d < PICKUP_RULES.shockRadius) { this.takedown(c, dx / (d || 1), dz / (d || 1), 'SHOCKWAVE', true, me); hits++; }
      }
      if (!H) return;
      if (!hits) this.popup('SHOCKWAVE', 'NO ONE IN RANGE', '', H);
      else {
        this.popup(hits > 1 ? `SHOCKWAVE ×${hits}` : 'SHOCKWAVE', `${hits} TAKEDOWN${hits > 1 ? 'S' : ''}`, 'takedown', H);
        this.slowmo = this.split ? 0.8 : 1.4;
        H.flash = 0.5;
        H.rig.addShake(1);
      }
    } else if (kind === 'ricochet') {
      me.power = null;
      const R = PICKUP_RULES;
      const at = this.roadPos(me);
      this.shots.push({
        owner: me, sc: at.sc, s: at.s + 4, lat: at.lat,
        vs: Math.max(R.shotMinSpeed, pv.speed + R.shotSpeed),
        vl: (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 4),
        t: 0,
        vis: this.pickVis.addShot(),
      });
      if (vol > 0.02) game.audio.fire(vol);
      if (H) { this.popup('RICOCHET', 'FIRED!', 'power', H); H.rig.addShake(0.25); }
    } else if (kind === 'oil') {
      me.power = null;
      const R = PICKUP_RULES;
      const at = this.roadPos(me), road = this.roadOf(at.sc);
      const s = at.sc ? Math.max(0, at.s - R.slickBehind) : this.track.wrapS(at.s - R.slickBehind);
      const edge = Math.max(0, road.halfWidth - R.slickHalfLat * 0.75); // keep the spill on the road
      const lat = Math.max(-edge, Math.min(edge, at.lat));
      const p = road.pointAt(s, lat);
      const sl = { owner: me, sc: at.sc, id: ++this.slickId, s, lat, t: R.slickLife };
      this.slicks.push(sl);
      this.pickVis.addSlick(sl.id, p.x, p.y, p.z, p.heading, R.slickHalfS, R.slickHalfLat);
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 3;
        this.fx.smoke.spawn(p.x + Math.cos(a) * 0.6, p.y + 0.3, p.z + Math.sin(a) * 0.6, Math.cos(a) * r, 2.5 + Math.random() * 2.5, Math.sin(a) * r,
          0.45 + Math.random() * 0.2, 0.22 + Math.random() * 0.15, 0.04, 0.04, 0.05, { drag: 0.2, grav: 14, alpha: 0.9 });
      }
      if (vol > 0.02) game.audio.splat(vol);
      if (H) this.popup('OIL SLICK', 'DROPPED BEHIND YOU', 'power', H);
    } else if (kind === 'strike') {
      const pe = this.race.byId.get(me.id);
      const rivals = others.filter((c) => c.vehicle.ghost <= 0).map((c) => ({ car: c, wrecked: c.vehicle.wrecked, progress: this.race.byId.get(c.id).progress }));
      const t = strikeTarget(pe.progress, rivals);
      if (!t) { if (H) this.popup('LIGHTNING STRIKE', 'NO TARGET AHEAD', '', H); return; }
      me.power = null;
      const v = t.car.vehicle;
      this.pickVis.lightning(new THREE.Vector3(v.x + 6, v.y + 70, v.z - 4), new THREE.Vector3(v.x, v.y + 0.8, v.z));
      game.audio.thunder(t.car.human ? 1 : Math.max(vol, this.audibility(v)));
      if (H) H.flash = Math.max(H.flash, 0.45);
      this.pendingStrikes.push({ car: t.car, owner: me, t: 0.12 });
    }
  }

  // ricochet shots: fly ahead, bounce off the barriers, wreck the first rival they touch
  // where a car is in the coordinates of the road it is on: { sc (null = main road), s, lat }
  roadPos(c) {
    const v = c.vehicle;
    return v.onSC && v.sc ? { sc: v.sc, s: v.scU, lat: v.scLat ?? 0 } : { sc: null, s: v.s, lat: v.lateral };
  }

  roadOf(sc) { return sc ? sc.path : this.track; }

  // ricochet shots follow whichever road they were fired on (a shortcut, then the main road
  // after it merges back); they only hit cars on that same road
  updateShots(dt) {
    const R = PICKUP_RULES;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      const valid = (c) => c !== sh.owner && !c.vehicle.wrecked && c.vehicle.ghost <= 0 && !c.vehicle.air;
      // along-road gap from the shot to car c, or null when c is on another road
      const gap = (c) => { const at = this.roadPos(c); return at.sc !== sh.sc ? null : { ds: this.roadOf(sh.sc).deltaS(sh.s, at.s), lat: at.lat }; };
      let target = null, best = 90;
      for (const c of this.cars) {
        if (!valid(c)) continue;
        const g = gap(c);
        if (g && g.ds > -1 && g.ds < best) { best = g.ds; target = { lat: g.lat }; }
      }
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      let hitCar = null;
      for (let k = 0; k < steps && !hitCar; k++) {
        const road = this.roadOf(sh.sc);
        if (stepShot(sh, dt / steps, road.halfWidth, target)) {
          const p = road.pointAt(sh.s, sh.lat);
          this.fx.sparks(p.x + p.rx * Math.sign(sh.lat) * 0.6, p.y + 0.7, p.z + p.rz * Math.sign(sh.lat) * 0.6, 0, 0, 14, 1);
          const vol = this.audibility(p);
          if (vol > 0.05) this.game.audio.ping(vol);
        }
        // off the end of a shortcut: carry on down the main road
        if (sh.sc && sh.s >= sh.sc.path.length - 1) {
          const p = sh.sc.path.pointAt(sh.s, sh.lat);
          const q = this.track.project(p.x, p.z);
          sh.sc = null; sh.s = q.s; sh.lat = Math.max(-this.track.halfWidth + 1, Math.min(this.track.halfWidth - 1, q.lateral));
        }
        for (const c of this.cars) {
          const g = valid(c) && gap(c);
          if (g && inBox(g.ds, g.lat, sh.lat, R.shotHitS, R.shotHitLat)) { hitCar = c; break; }
        }
      }
      const road = this.roadOf(sh.sc);
      if (hitCar || sh.t > R.shotLife) {
        this.pickVis.removeShot(sh.vis);
        this.shots.splice(i, 1);
        const p = road.pointAt(sh.s, hitCar ? 0 : sh.lat);
        if (hitCar) this.takedown(hitCar, p.tx, p.tz, 'RICOCHET TAKEDOWN', false, sh.owner);
        else this.fx.sparks(p.x, p.y + 0.7, p.z, 0, 0, 30, 1.5);
        continue;
      }
      const p = road.pointAt(sh.s, sh.lat);
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
        if (c === sl.owner || c.vehicle.wrecked || c.vehicle.ghost > 0 || c.vehicle.speed < 8 || c.vehicle.air) continue;
        const at = this.roadPos(c);
        if (at.sc !== sl.sc) continue; // on the other road
        if (inBox(this.roadOf(sl.sc).deltaS(sl.s, at.s), at.lat, sl.lat, R.slickHalfS, R.slickHalfLat)) {
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
      // a wreck tumbling down the road doesn't gain places (or cross the line)
      if (c.vehicle.wrecked) continue;
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
      const off = Math.abs(wrapAngle(pv.heading - this.roadHeading(pv)));
      if (off > 1.9 && pv.speed > 4 && !pv.wrecked) H.wrongWayTime += dt; else H.wrongWayTime = 0;
    }
  }

  // final lap: the music lifts, and a player right behind the leader gets pulled along
  updateFinalLap(dt) {
    let finalLap = false;
    const st = this.race.standings();
    for (const H of this.humans) {
      H.drama = '';
      const e = this.race.byId.get(H.car.id);
      if (H.finished || this.state !== 'racing' || this.race.displayLap(H.car.id) < this.laps || H.car.vehicle.wrecked) continue;
      finalLap = true;
      const pos = st.indexOf(e) + 1;
      if (pos > 1) {
        const ahead = st[pos - 2];
        const gap = ahead.progress - e.progress;
        if (!ahead.finished && gap > 0 && gap < 35) { H.drama = 'CATCH THEM!'; H.boost.add(8 * dt); }
      } else if (st[1] && !st[1].finished && e.progress - st[1].progress < 30) H.drama = 'HOLD THEM OFF!';
    }
    if (finalLap !== this.finalLap) { this.finalLap = finalLap; this.game.audio.setIntensity(finalLap ? 1 : 0); }
  }

  // --- collisions ---------------------------------------------------------------
  collide() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const A = cars[i].vehicle, B = cars[j].vehicle;
        if (A.ghost > 0 || B.ghost > 0) continue;
        if (A.air || B.air || Math.abs(A.y - B.y) > 1.6) continue; // in the air off a ramp: no contact
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
      if (kind === 'takedown') this.takedown(victim, nx * dir, nz * dir, 'TAKEDOWN!', false, attacker);
      else if (kind === 'push') { victim.pushedAt = this.time; victim.pushedBy = attacker; }
    } else {
      // an AI rammed a human: 'playerWrecked' when the AI supplied almost all the closing speed
      const kind = classifyImpact({ closing, playerShare: 1 - share }, victim.human.assistOn ? ASSIST_RULES : RULES);
      if (kind === 'playerWrecked') {
        attacker.kills = (attacker.kills || 0) + 1;
        this.crashHuman(victim.human, 'TAKEN OUT', nx * dir, nz * dir, attacker);
      }
    }
  }

  onWallHit(c, hit) {
    if (this.state === 'countdown') return;
    const v = c.vehicle;
    if (hit.vn > 3) this.fx.sparks(hit.x, hit.y, hit.z, v.vx, v.vz, Math.min(30, hit.vn * 2), Math.min(2, hit.vn / 12));
    if (v.wrecked || this.state !== 'racing') return;
    const H = c.human;
    const flying = v.air || v.landCool > 0; // off a ramp or just landed: walls only bounce
    if (H) {
      if (!H.finished && !flying && isWallCrash({ speed: hit.speed, angleDeg: hit.angle }, H.assistOn ? ASSIST_RULES : RULES)) {
        this.crashHuman(H, 'WRECKED', hit.nx, hit.nz);
      } else if (hit.vn > 4 && this.impactCooldown <= 0) {
        this.game.audio.impact(Math.min(1, hit.vn / 18));
        H.rig.addShake(Math.min(0.6, hit.vn / 25));
        H.flash = Math.max(H.flash, Math.min(0.12, hit.vn / 150));
        this.impactCooldown = 0.15;
      }
    }
    if (!flying && c.pushedBy && c.pushedBy !== c && isPushTakedown({ sincePush: this.time - c.pushedAt, wallSpeed: hit.vn })) {
      this.takedown(c, hit.nx, hit.nz, 'TAKEDOWN!', false, c.pushedBy);
    }
  }

  // Wreck car `c`; car `byCar` caused it (a human gets the takedown credited).
  takedown(c, dirX, dirZ, label = 'TAKEDOWN!', quiet = false, byCar = this.player) {
    const v = c.vehicle;
    if (v.wrecked) return;
    if (c.human) {
      this.crashHuman(c.human, VICTIM_LABEL[label] || label, dirX, dirZ, byCar);
      // an AI power-up just got this human: AIs leave them alone for a while
      if (byCar && !byCar.human && label !== 'TAKEDOWN!') c.human.shieldUntil = this.time + AI_POWER.humanShield;
    } else {
      c.crashS = v.s;
      v.crash(dirX, dirZ, 1.3);
      c.respawn = 3.4;
      this.fx.explosion(v.x, v.y + 0.6, v.z, v.vx, v.vz, c.paint, v.y);
      this.game.audio.crash();
    }
    c.pushedAt = -99;
    c.pushedBy = null;
    if (byCar && byCar !== c) byCar.kills = (byCar.kills || 0) + 1; // for the results table
    const by = byCar && byCar !== c ? byCar.human : null;
    if (!by) return;
    by.takedowns++;
    const payback = by.rival === c;
    if (payback) { by.rival = null; by.paybacks++; }
    const sig = this.signatureFor(c, byCar);
    let gained = by.boost.event(RULES.takedownGain);
    if (payback) gained += by.boost.add(RULES.takedownGain * 0.7);
    if (sig) gained += by.boost.add(15);
    if (sig) this.game.onSignature(by.index, sig, this.def.id);
    if (quiet && !sig && !payback) return;
    const m = by.boost.multiplier;
    const title = sig ? sig.name : payback ? 'PAYBACK!' : label;
    const tag = sig ? '  SIGNATURE' : payback ? '  RIVAL DOWN' : '';
    this.popup(title, `${c.name}${tag}${gained >= 1 ? `  +${Math.round(gained)} BOOST` : ''}${m > 1 ? `  ×${m}` : ''}`, 'takedown', by);
    if (quiet) return;
    this.slowmo = this.split ? 0.8 : 1.4;
    by.flash = 0.5;
    by.rig.startCrashCam(v, this.split ? 1.0 : 1.4, Math.random() < 0.5 ? 1 : -1);
    by.rig.addShake(1);
  }

  // named spot this takedown happened at (see signatures.js), or null
  signatureFor(c, byCar) {
    return signatureAt(this.def.id, {
      track: this.track, s: c.crashS ?? c.vehicle.s, hairpin: this.hairpin, landmark: this.landmark,
      onShortcut: !!(c.vehicle.onSC || (byCar && byCar.vehicle.onSC)),
    });
  }

  crashHuman(H, label, dirX, dirZ, byCar = null) {
    const car = H.car, v = car.vehicle;
    if (v.wrecked) return;
    car.crashS = v.s;
    v.crash(dirX, dirZ, 1);
    car.respawn = 2.4;
    H.boost.resetChain();
    H.crashes++;
    const grudge = byCar && !byCar.human;
    if (grudge) H.rival = byCar; // now your rival
    this.fx.explosion(v.x, v.y + 0.6, v.z, v.vx, v.vz, car.paint, v.y);
    this.game.audio.crash();
    this.popup(label, byCar ? `by ${byCar.name}${grudge ? ' · NEW RIVAL' : ''}` : 'CRASH', 'bad', H);
    this.slowmo = Math.max(this.slowmo, this.split ? 0.8 : 1.8);
    H.flash = 0.35;
    H.rig.startCrashCam(v, this.split ? 1.2 : 1.8, 1);
  }

  // back on the road where the car crashed (an AI a little further back), not where the wreck
  // stopped sliding
  respawn(c) {
    const v = c.vehicle;
    let s = c.crashS ?? v.s;
    if (!c.human) {
      s = this.track.wrapS(s - AI_POWER.respawnSetback);
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
      const skidding = !v.air && (v.drifting || Math.abs(v.slip) > 0.2 || (v.braking && v.speed > 25)) && v.speed > 8;
      for (const side of [-1, 1]) {
        const wx = v.x + rx * side * 0.95 - fxv * c.model.halfBase;
        const wz = v.z + rz * side * 0.95 - fzv * c.model.halfBase;
        fx.skids.add(c.id + side, wx, v.y, wz, fxv, fzv, skidding);
        const sliding = !v.air && (v.drifting || Math.abs(v.slip) > 0.28);
        if (sliding && v.speed > 8 && Math.random() < dt * (v.drifting ? 40 : 14)) fx.tyreSmoke(wx, v.y, wz, v.vx, v.vz, v.drifting ? 1.1 : 0.6);
      }
      if (spray && !v.air && v.speed > 16 && this.nearestHuman(v).d2 < 120 * 120 && Math.random() < dt * v.speed * (c.human ? 0.12 : 0.3)) {
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
        m.root.rotation.set(v.pitch, v.heading + (v.trickYaw || 0), v.roll + (v.trickRoll || 0), 'YXZ');
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
      // the results screen can switch split screen back to one view mid-update
      if (H.index >= game.renderer.fxs.length) continue;
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
        boost: H.boostVis, slip: pv.air ? 0 : pv.drifting ? Math.min(1, Math.abs(pv.slip) * 2) : Math.max(0, Math.abs(pv.slip) - 0.15) * 2,
        scraping: pv.scraping > 0.5 && pv.speed > 5 ? Math.min(1, pv.speed / 40) : 0,
        active: !pv.wrecked, slowmo: slowmoFx, volume: this.split ? 0.7 : 1, style: pv.spec.style,
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
        power: H.car.power,
        powerKey: this.powerKey(H),
        assist: H.assistOn,
        incoming: H.incoming,
        drama: H.drama,
      }, H.index);
      game.minimaps[H.index].draw(this.cars, H.car, H.rival);
    }
    this.markers.update(this.humans.map((H) => H.rival), this.time);
    game.audio.setSlowmo(slowmoFx);
    this.world.update(dt, this.time, this.humans[0].car.vehicle, game.renderer.cameras[0]);
  }

  results() {
    return this.race.standings().map((e, i) => {
      const c = this.cars.find((k) => k.id === e.id);
      return {
        pos: i + 1, name: c.name, car: c.spec.name, isPlayer: c.isPlayer, paint: c.paint,
        time: e.finished ? e.finishTime : null, best: e.bestLap,
        takedowns: c.human ? c.human.takedowns : c.kills || 0,
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

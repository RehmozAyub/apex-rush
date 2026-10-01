// Online play, during a connection: the shared clock, and during a race the glue between the
// RaceSession here and the one on the other device.
//
// Ownership (see session.js): the host's device runs its own car, the 6 AI and the pickups; the
// guest's device runs the guest's car. Each sends the cars it owns ~60 times a second; the other
// side draws them predicted and smoothed (remoteCar.js). Anything that wrecks a car is applied by
// that car's owner; a hit between the two players is judged by the earliest claim (hits.js).
import * as THREE from 'three';
import { NetClock } from './clock.js';
import { packStates, unpackStates, carState, FLAG } from './protocol.js';
import { RemoteCar, History } from './remoteCar.js';
import { HitJudge, plausibleContact } from './hits.js';
import { AIDriver } from '../ai.js';

export const NET_VERSION = 1; // bump when the protocol changes; both players need the same
const SEND_RATE = 60; // car states per second
const CLAIM_GAP = 0.4; // s between two hit claims from this device
const GO_DELAY = 3.4; // s from "both loaded" to GO (covers the 3-2-1)

export class Online {
  // handlers: { onMessage(msg) (lobby messages), onClosed() }
  constructor(link, role, handlers = {}) {
    this.link = link;
    this.role = role;
    this.handlers = handlers;
    this.clock = new NetClock(role === 'host');
    this.session = null;
    this.raceId = 0;
    this.early = []; // race messages that arrived before this device finished loading that race
    link.onMessage = (m) => this.onMessage(m);
    link.onState = (b) => this.onStateBuf(b);
    link.onClose = () => { this.closed = true; if (this.handlers.onClosed) this.handlers.onClosed(); };
  }

  get now() { return this.clock.shared(); }
  get pingMs() { return Math.round(this.clock.rtt * 1000); }
  send(m) { this.link.send(m); }
  close() { try { this.send({ type: 'bye' }); } catch {} setTimeout(() => this.link.close(), 100); }

  // every frame, race or not
  frame() {
    const p = this.clock.poll();
    if (p) this.send(p);
  }

  onMessage(m) {
    if (!m || !m.type) return;
    if (m.type === 'ping') { this.send(this.clock.reply(m)); return; }
    if (m.type === 'pong') { this.clock.onPong(m); return; }
    if (m.race !== undefined) {
      if (this.session && m.race === this.raceId) this.raceMessage(m);
      else if (m.race !== this.raceId) { this.early.push(m); if (this.early.length > 200) this.early.shift(); } // for a race still loading here
      return;
    }
    if (this.handlers.onMessage) this.handlers.onMessage(m);
  }

  // --- race --------------------------------------------------------------------------
  attach(session, raceId) {
    this.session = session;
    this.raceId = raceId;
    session.net = this;
    this.goAt = null;
    this.loaded = { host: false, guest: false };
    this.remote = new Map();
    for (const c of session.cars) if (c.remote) this.remote.set(c.index, new RemoteCar());
    this.hist = { host: new History(), guest: new History() };
    this.judge = this.role === 'host' ? new HitJudge() : null;
    this.sendAcc = 1;
    this.lastClaim = -99;
    this.startedAt = this.now;
    this.myCar = session.racers.find((c) => !c.remote);
    this.otherCar = session.racers.find((c) => c.remote) || null;
    this.loadedSent = -99;
    const early = this.early.filter((m) => m.race === raceId);
    this.early = [];
    for (const m of early) this.raceMessage(m);
  }

  detach() {
    if (this.session) this.session.net = null;
    this.session = null;
  }

  rsend(m) { m.race = this.raceId; this.send(m); }

  // this device has built the race; the host starts the countdown once both have
  raceLoaded() {
    this.loaded[this.role] = true;
    if (this.role === 'guest') { this.rsend({ type: 'loaded' }); this.loadedSent = this.now; }
    else this.tryGo();
  }

  tryGo() {
    if (this.goAt !== null || !this.loaded.host || !this.loaded.guest) return;
    this.goAt = this.now + GO_DELAY;
    this.rsend({ type: 'go', at: this.goAt });
  }

  // seconds of countdown left in RaceSession terms (GO when it reaches 0.6)
  countdownLeft() { return this.goAt === null ? Infinity : this.goAt - this.now + 0.6; }

  // before the physics step: draw the other device's cars where they are now
  beforePhysics(dt) {
    const S = this.session, now = this.now;
    for (const [idx, rc] of this.remote) {
      const st = rc.sample(now, dt);
      if (st) this.applyRemote(S.cars[idx], st, dt);
    }
  }

  applyRemote(c, st, dt) {
    const S = this.session, v = c.vehicle;
    const wrecked = !!(st.flags & FLAG.wrecked);
    if (wrecked && !v.wrecked) S.showRemoteWreck(c, Math.sin(st.heading), Math.cos(st.heading));
    if (!wrecked && v.wrecked) {
      if (S.time - (c.wreckShownAt ?? -99) < 1.2) return; // our own "wrecked" ran ahead of the owner's states
      v.wrecked = false;
    }
    if (v.wrecked) return; // tumbling here
    v.x = st.x; v.y = st.y; v.z = st.z;
    v.heading = st.heading; v.vx = st.vx; v.vz = st.vz; v.yawRate = st.yawRate;
    v.pitch = st.pitch; v.roll = st.roll; v.bodyPitch = st.bodyPitch; v.bodyRoll = st.bodyRoll;
    v.trickYaw = st.trickYaw; v.trickRoll = st.trickRoll; v.steer = st.steer; v.slip = st.slip;
    v.s = st.s; v.lateral = st.lateral;
    const onSC = !!(st.flags & FLAG.onSC) && S.shortcuts && S.shortcuts.list[st.scIdx];
    v.onSC = !!onSC; v.sc = onSC || null; v.scU = st.scU; v.scLat = onSC ? st.lateral : undefined;
    v.air = !!(st.flags & FLAG.air);
    v.ghost = st.flags & FLAG.ghost ? 0.3 : 0;
    v.boosting = !!(st.flags & FLAG.boosting);
    v.braking = !!(st.flags & FLAG.braking);
    v.drifting = !!(st.flags & FLAG.drifting);
    v.scraping = st.flags & FLAG.scraping ? 1 : 0;
    v.idx = Math.round(st.s / S.track.step) % S.track.n;
    v.wheelSpin += (Math.hypot(st.vx, st.vz) / 0.36) * dt;
  }

  // after the race update: send the cars owned here, judge lone hit claims
  afterUpdate(dt) {
    const S = this.session;
    if (!S) return;
    const now = this.now;
    // guest: keep saying 'loaded' until the countdown is set (the host may still have been loading)
    if (this.role === 'guest' && this.goAt === null && this.loaded.guest && now - this.loadedSent > 1) { this.rsend({ type: 'loaded' }); this.loadedSent = now; }
    if (this.myCar) { const v = this.myCar.vehicle; this.hist[this.role].add(now, v.x, v.z, v.speed); }
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SEND_RATE - 0.002) {
      this.sendAcc = 0;
      const list = this.sl || (this.sl = []);
      list.length = 0;
      const scs = S.shortcuts ? S.shortcuts.list : [];
      for (const c of S.cars) {
        if (c.remote) continue;
        list.push(carState(c.index, c.vehicle, c.vehicle.onSC ? scs.indexOf(c.vehicle.sc) : -1, c.vehicle.boosting));
      }
      this.link.sendState(packStates(now, list));
    }
    if (this.judge) {
      const rtt = this.clock.rtt;
      for (const o of this.judge.update(now, (cl) => plausibleContact(this.hist.host.at(cl.t), this.hist.guest.at(cl.t), rtt))) this.resolveHit(o);
    }
  }

  onStateBuf(buf) {
    const S = this.session;
    if (!S) return;
    const msg = unpackStates(buf);
    if (!msg || msg.t < this.startedAt - 1) return; // from the previous race
    const now = this.now;
    for (const st of msg.states) {
      const rc = this.remote.get(st.idx);
      if (!rc) continue;
      rc.push(msg.t, st, now);
      if (this.otherCar && st.idx === this.otherCar.index) this.hist[this.otherCar.owner].add(msg.t, st.x, st.z, Math.hypot(st.vx, st.vz));
    }
  }

  // --- hits between the two players ----------------------------------------------------
  claimHit(attacker, victim, kind, nx, nz, closing) {
    const now = this.now;
    if (now - this.lastClaim < CLAIM_GAP) return;
    this.lastClaim = now;
    const claim = { from: this.role, t: now, attacker: attacker.owner, kind, nx, nz, closing };
    if (this.role === 'host') { const o = this.judge.add(claim, now, this.clock.rtt); if (o) this.resolveHit(o); }
    else this.rsend({ type: 'claim', claim });
  }

  // host: the earliest claim decided this contact
  resolveHit(o) {
    const S = this.session;
    const by = S.racers.find((c) => c.owner === o.attacker), victim = S.racers.find((c) => c.owner === o.victim);
    if (!by || !victim || victim.vehicle.wrecked) return;
    if (o.kind === 'takedown') S.takedown(victim, o.nx, o.nz, 'TAKEDOWN!', false, by);
    else if (victim.remote) this.rsend({ type: 'push', car: victim.index, by: by.index });
    else { victim.pushedAt = S.time; victim.pushedBy = by; }
  }

  // --- wrecks and credit -------------------------------------------------------------------
  wreck(c, dx, dz, label, quiet, byCar) {
    this.rsend({ type: 'wreck', car: c.index, dx, dz, label, quiet, by: byCar ? byCar.index : -1 });
  }

  credit(byCar, c, label, quiet) {
    this.rsend({ type: 'credit', by: byCar.index, car: c.index, label, quiet });
  }

  // --- pickups, shots, slicks ----------------------------------------------------------------
  pickupTaken(it) {
    if (this.role === 'host') this.rsend({ type: 'item', id: it.id, on: false });
    else this.rsend({ type: 'take', id: it.id });
  }

  pickupBack(it) { this.rsend({ type: 'item', id: it.id, on: true, power: it.power || null }); }

  shotFired(sh) {
    const S = this.session;
    this.rsend({ type: 'shot', id: sh.id, owner: sh.owner.index, sc: sh.sc && S.shortcuts ? S.shortcuts.list.indexOf(sh.sc) : -1, s: sh.s, lat: sh.lat, vs: sh.vs, vl: sh.vl });
  }

  shotEnded(id) { this.rsend({ type: 'shotEnd', id }); }

  slickDropped(sl) {
    const S = this.session;
    this.rsend({ type: 'slick', id: sl.id, owner: sl.owner.index, sc: sl.sc && S.shortcuts ? S.shortcuts.list.indexOf(sl.sc) : -1, s: sl.s, lat: sl.lat, t: sl.t });
  }

  powerFx(fx) { this.rsend({ type: 'fx', fx }); }

  finished(time) { this.rsend({ type: 'finish', time }); }

  raceMessage(m) {
    const S = this.session, car = (i) => (i >= 0 ? S.cars[i] : null);
    const sc = (i) => (i >= 0 && S.shortcuts ? S.shortcuts.list[i] : null);
    switch (m.type) {
      case 'loaded': this.loaded.guest = true; if (this.goAt !== null) this.rsend({ type: 'go', at: this.goAt }); else this.tryGo(); break;
      case 'go': this.goAt = m.at; break;
      case 'claim': if (this.judge) { const o = this.judge.add(m.claim, this.now, this.clock.rtt); if (o) this.resolveHit(o); } break;
      case 'push': { const c = car(m.car); if (c && !c.remote) { c.pushedAt = S.time; c.pushedBy = car(m.by); } break; }
      case 'wreck': {
        const c = car(m.car);
        if (c && !c.remote) S.takedown(c, m.dx, m.dz, m.label, m.quiet, car(m.by), true);
        break;
      }
      case 'credit': {
        const by = car(m.by), c = car(m.car);
        if (!by || by.remote || !c) break;
        by.kills = (by.kills || 0) + 1;
        if (by.human) S.credit(by.human, c, m.label, m.quiet);
        break;
      }
      case 'take': {
        const it = S.pickState.items[m.id];
        if (it && it.active) { S.pickState.take(it); S.pickVis.setActive(it, false); }
        break;
      }
      case 'item': {
        const it = S.pickState.items[m.id];
        if (!it) break;
        if (m.on && m.power) it.power = m.power;
        it.active = m.on;
        S.pickVis.setActive(it, m.on);
        break;
      }
      case 'shot': {
        if (S.shots.some((s) => s.id === m.id)) break;
        S.addShot({ id: m.id, owner: car(m.owner), sc: sc(m.sc), s: m.s, lat: m.lat, vs: m.vs, vl: m.vl, t: 0 });
        const vol = S.audibility(car(m.owner).vehicle);
        if (vol > 0.02) S.game.audio.fire(vol);
        break;
      }
      case 'shotEnd': S.removeShot(m.id, true); break;
      case 'slick': {
        if (S.slicks.some((s) => s.id === m.id)) break;
        S.addSlick({ id: m.id, owner: car(m.owner), sc: sc(m.sc), s: m.s, lat: m.lat, t: m.t });
        const vol = S.audibility(car(m.owner).vehicle);
        if (vol > 0.02) S.game.audio.splat(vol);
        break;
      }
      case 'fx': this.showFx(m.fx); break;
      case 'finish': break; // the race tracker sees the line crossing from the car states
      case 'results': if (this.handlers.onResults) this.handlers.onResults(m.list); break;
      default: break;
    }
  }

  showFx(fx) {
    const S = this.session;
    if (fx.kind === 'shockwave') {
      S.pickVis.shockwave(fx.x, fx.y, fx.z);
      S.fx.sparks(fx.x, fx.y + 0.6, fx.z, 0, 0, 50, 2);
      const vol = S.audibility(fx);
      if (vol > 0.02) S.game.audio.shockwave(vol);
    } else if (fx.kind === 'strike') {
      const c = S.cars[fx.target];
      if (!c) return;
      const v = c.vehicle;
      S.pickVis.lightning(new THREE.Vector3(v.x + 6, v.y + 70, v.z - 4), new THREE.Vector3(v.x, v.y + 0.8, v.z));
      S.game.audio.thunder(c.human ? 1 : Math.max(0.2, S.audibility(v)));
    }
  }

  // the friend left mid-race (host): their car carries on as an AI rival
  takeOver() {
    const S = this.session;
    if (!S) return;
    for (const c of S.cars) {
      if (!c.remote) continue;
      c.remote = false;
      c.owner = this.role;
      if (c.isPlayer) {
        c.isPlayer = false;
        c.name = `${c.name} (AI)`;
        S.racers = S.racers.filter((r) => r !== c);
      }
      if (!c.ai) c.ai = new AIDriver(c.vehicle, S.track, { lane: c.vehicle.lateral, skill: 0.96, aggression: 0.4, shortcuts: S.shortcuts ? S.shortcuts.list : [] });
    }
    this.remote.clear();
    this.otherCar = null;
  }
}

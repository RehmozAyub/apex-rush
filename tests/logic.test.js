import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackPath } from '../game/src/trackMath.js';
import { LAYOUTS } from '../game/src/maps/layouts.js';
import { RaceTracker } from '../game/src/race.js';
import { BoostSystem, isNearMiss, classifyImpact, isPushTakedown, isWallCrash, RULES } from '../game/src/burnout.js';

const circle = (R, n = 32) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return [Math.cos(a) * R, 0, Math.sin(a) * R];
});

test('track length and radius of a circle are right', () => {
  const t = new TrackPath(circle(200), { width: 20 });
  assert.ok(Math.abs(t.length - 2 * Math.PI * 200) < 5, `length ${t.length}`);
  assert.ok(Math.abs(t.minRadius() - 200) < 20, `radius ${t.minRadius()}`);
});

test('project(pointAt(s, lat)) round-trips', () => {
  const t = new TrackPath(LAYOUTS.coast.points, { width: 20 });
  for (const s of [0, 123.4, 777, t.length - 3]) {
    for (const lat of [-7, 0, 5.5]) {
      const p = t.pointAt(s, lat);
      const q = t.project(p.x, p.z);
      assert.ok(Math.abs(t.deltaS(s, q.s)) < 0.5, `s ${s} -> ${q.s}`);
      assert.ok(Math.abs(q.lateral - lat) < 0.3, `lat ${lat} -> ${q.lateral}`);
    }
  }
});

test('right vector points to the right of travel direction', () => {
  // at angle 0 the loop travels +z; facing +z the right-hand side is -x, which is the inside,
  // so this loop turns right everywhere.
  const t = new TrackPath(circle(200));
  const p = t.pointAt(0, 5);
  assert.ok(p.x < 200, 'positive lateral should be toward the inside for a right-turning loop');
  assert.ok(t.curv[0] > 0, 'right-turning loop has positive curvature');
});

for (const [id, lay] of Object.entries(LAYOUTS)) {
  test(`layout ${id} is drivable`, () => {
    const t = new TrackPath(lay.points, { width: lay.width });
    assert.ok(t.length > 2000 && t.length < 4500, `length ${t.length.toFixed(0)}`);
    assert.ok(t.minRadius() > 30, `min radius ${t.minRadius().toFixed(1)}`);
    let maxGrade = 0;
    for (let i = 0; i < t.n; i++) maxGrade = Math.max(maxGrade, Math.abs(t.grade[i]));
    assert.ok(maxGrade < 0.16, `grade ${maxGrade}`);
    // no two non-neighbouring parts of the track closer than 2.5 road widths
    const step = 5;
    for (let i = 0; i < t.n; i += step) {
      for (let j = i + step; j < t.n; j += step) {
        const along = Math.min(j - i, t.n - (j - i)) * t.step;
        if (along < 150) continue;
        const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
        assert.ok(d > lay.width * 2.5, `sections ${i} and ${j} only ${d.toFixed(1)}m apart`);
      }
    }
  });
}

test('race counts laps, times and finish order', () => {
  const L = 1000;
  const r = new RaceTracker(L, 2, ['p', 'a']);
  r.start(0);
  let time = 0;
  const drive = (id, fromS, dist, dt = 1, speed = 50) => {
    let s = fromS;
    for (let d = 0; d < dist; d += speed * dt) {
      s = (s + speed * dt) % L;
      time += dt;
      r.update(id, s, time);
    }
    return s;
  };
  r.update('p', 990, 0);
  r.update('a', 980, 0);
  assert.equal(r.position('p'), 1);
  drive('p', 990, 20);
  assert.equal(r.displayLap('p'), 1);
  drive('p', 10, 1000);
  assert.equal(r.byId.get('p').lapTimes.length, 1);
  assert.equal(r.displayLap('p'), 2);
  drive('p', 10, 1000);
  assert.ok(r.byId.get('p').finished);
  assert.equal(r.standings()[0].id, 'p');
});

test('reversing over the line does not count laps', () => {
  const r = new RaceTracker(1000, 3, ['p']);
  r.start(0);
  r.update('p', 995, 0);
  r.update('p', 5, 1); // lap 1 starts
  r.update('p', 995, 2); // back over the line
  r.update('p', 5, 3); // forward again - still lap 1
  assert.equal(r.byId.get('p').lapTimes.length, 0);
  assert.equal(r.displayLap('p'), 1);
});

test('boost chain multiplier grows within window and resets after', () => {
  const b = new BoostSystem();
  b.boost = 0;
  b.event(5); // x1
  b.event(5); // x2
  assert.equal(b.multiplier, 2);
  assert.equal(b.boost, 15);
  b.update(RULES.chainWindow + 0.1, { drifting: false, drafting: false, boostHeld: false });
  assert.equal(b.multiplier, 1);
});

test('boost drains while held and needs a minimum to start', () => {
  const b = new BoostSystem();
  b.boost = 3;
  b.update(0.1, { boostHeld: true });
  assert.equal(b.boosting, false);
  b.boost = 50;
  b.update(1, { boostHeld: true });
  assert.equal(b.boosting, true);
  assert.equal(b.boost, 50 - RULES.boostDrain);
});

test('long drift awards a drift event', () => {
  const b = new BoostSystem();
  for (let i = 0; i < 20; i++) b.update(0.1, { drifting: true });
  const ev = b.update(0.1, { drifting: false });
  assert.equal(ev[0]?.type, 'drift');
});

test('near miss / impact / crash rules', () => {
  assert.ok(isNearMiss({ prevFwd: 0.5, fwd: -0.2, lat: 2.6, relSpeed: 12, sinceContact: 3 }));
  assert.ok(!isNearMiss({ prevFwd: 0.5, fwd: -0.2, lat: 5, relSpeed: 12, sinceContact: 3 }));
  assert.ok(!isNearMiss({ prevFwd: 0.5, fwd: -0.2, lat: 2.6, relSpeed: 12, sinceContact: 0.2 }));
  assert.equal(classifyImpact({ closing: 15, playerShare: 0.8 }), 'takedown');
  assert.equal(classifyImpact({ closing: 20, playerShare: 0.1 }), 'playerWrecked');
  assert.equal(classifyImpact({ closing: 5, playerShare: 0.6 }), 'push');
  assert.equal(classifyImpact({ closing: 2, playerShare: 0.6 }), null);
  assert.ok(isPushTakedown({ sincePush: 0.5, wallSpeed: 8 }));
  assert.ok(!isPushTakedown({ sincePush: 2, wallSpeed: 8 }));
  assert.ok(isWallCrash({ speed: 40, angleDeg: 70 }));
  assert.ok(!isWallCrash({ speed: 40, angleDeg: 20 }));
});

import { layoutPickups, PickupState, strikeTarget, randomPower, POWER_IDS, PICKUP_RULES } from '../game/src/powerups.js';

test('pickup layout mixes boosts and power-ups inside the track', () => {
  const list = layoutPickups(3000, 9);
  assert.ok(list.some((p) => p.kind === 'boost') && list.some((p) => p.kind === 'power'));
  for (const p of list) {
    assert.ok(p.s > 100 && p.s < 3000, `s ${p.s}`);
    assert.ok(Math.abs(p.lateral) < 9 - 1, `lateral ${p.lateral}`);
  }
});

test('pickups are taken and respawn after their timer', () => {
  const st = new PickupState([{ kind: 'boost', s: 0, lateral: 0 }, { kind: 'power', s: 10, lateral: 0 }]);
  st.items[0].x = 0; st.items[0].z = 0; st.items[1].x = 50; st.items[1].z = 0;
  const it = st.near(1, 1);
  assert.equal(it.kind, 'boost');
  st.take(it);
  assert.equal(st.near(1, 1), null);
  st.update(PICKUP_RULES.respawnMin - 0.1);
  assert.equal(st.near(1, 1), null);
  const back = st.update(PICKUP_RULES.respawnMax - PICKUP_RULES.respawnMin + 0.2);
  assert.equal(back.length, 1);
  assert.equal(st.near(1, 1).kind, 'boost');
});

test('strike targets the closest rival ahead within range', () => {
  const t = strikeTarget(1000, [
    { id: 'a', progress: 900, wrecked: false },
    { id: 'b', progress: 1150, wrecked: false },
    { id: 'c', progress: 1050, wrecked: true },
    { id: 'd', progress: 1600, wrecked: false },
  ]);
  assert.equal(t.id, 'b');
  assert.equal(strikeTarget(1000, [{ id: 'a', progress: 900, wrecked: false }]), null);
  assert.ok(POWER_IDS.includes(randomPower()));
  assert.deepEqual(POWER_IDS, ['shockwave', 'ricochet', 'strike', 'oil']);
});

import { stepShot, inBox } from '../game/src/powerups.js';

test('ricochet shot bounces off the barriers and stays on the road', () => {
  const hw = 9;
  const p = { s: 0, lat: 0, vs: 90, vl: 14, t: 0 };
  let bounces = 0;
  for (let i = 0; i < 600; i++) {
    if (stepShot(p, 1 / 120, hw)) bounces++;
    assert.ok(Math.abs(p.lat) <= hw - 0.8 + 1e-9, `lat ${p.lat}`);
  }
  assert.ok(bounces >= 2, `bounces ${bounces}`);
  assert.ok(Math.abs(p.s - 450) < 1, `s ${p.s}`);
});

test('ricochet homes toward a target lane', () => {
  const p = { s: 0, lat: -6, vs: 90, vl: 0, t: 0 };
  for (let i = 0; i < 60; i++) stepShot(p, 1 / 120, 9, { lat: 5 });
  assert.ok(p.vl > 0 && p.lat > -6);
});

test('hit boxes for the shot and oil slick', () => {
  assert.ok(inBox(1, 2, 1, 2.6, 1.9));
  assert.ok(!inBox(4, 2, 1, 2.6, 1.9));
  assert.ok(!inBox(0, 5, 1, 2.6, 1.9));
});

import { generatePixels } from '../game/src/asphalt-core.js';

test('asphalt generator produces full RGBA maps with sane normals', () => {
  const r = generatePixels({ base: '#3a3a40', wet: true, cracks: 1, patches: 1 }, 64);
  assert.equal(r.W, 64);
  assert.equal(r.H, 128);
  for (const k of ['albedo', 'normal', 'rough']) assert.equal(r[k].length, 64 * 128 * 4);
  let minZ = 255;
  for (let i = 0; i < 64 * 128; i++) {
    assert.equal(r.albedo[i * 4 + 3], 255);
    minZ = Math.min(minZ, r.normal[i * 4 + 2]);
  }
  assert.ok(minZ > 127, `normals should point out of the surface (min z ${minZ})`);
});

test('asphalt generation is deterministic per seed', () => {
  const a = generatePixels({ seed: 5 }, 32), b = generatePixels({ seed: 5 }, 32), c = generatePixels({ seed: 6 }, 32);
  assert.deepEqual(a.albedo, b.albedo);
  assert.notDeepEqual(a.albedo, c.albedo);
});

import { aiWantsPower, AI_POWER } from '../game/src/powerups.js';
import { DriveAssist, ASSIST_RULES } from '../game/src/assist.js';
import { Vehicle } from '../game/src/vehicle.js';
import { CARS, CAR_BUDGET } from '../game/src/config.js';

test('power-up blocks come in pairs showing two different powers, re-rolled on respawn', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const list = layoutPickups(3000, 9, { rand });
  const powers = list.filter((p) => p.kind === 'power');
  assert.ok(powers.length >= 4 && powers.length % 2 === 0);
  for (let i = 0; i < powers.length; i += 2) {
    assert.equal(powers[i].slot, powers[i + 1].slot);
    assert.notEqual(powers[i].power, powers[i + 1].power);
    assert.ok(POWER_IDS.includes(powers[i].power));
  }
  const st = new PickupState(powers.slice(0, 2));
  for (let k = 0; k < 30; k++) {
    st.take(st.items[0]);
    st.update(PICKUP_RULES.respawnMax + 0.1, rand);
    assert.notEqual(st.items[0].power, st.items[1].power);
  }
});

test('AI only fires power-ups that will likely hit, and spares shielded players', () => {
  const ctx = (o) => ({ held: 5, near: [], ahead: [], behind: [], myLat: 0, strike: null, ...o });
  assert.ok(aiWantsPower('shockwave', ctx({ near: [{ dist: 8, shielded: false }] })));
  assert.ok(!aiWantsPower('shockwave', ctx({ near: [{ dist: 30, shielded: false }] })));
  assert.ok(!aiWantsPower('shockwave', ctx({ near: [{ dist: 8, shielded: false }, { dist: 12, shielded: true }] })));
  assert.ok(aiWantsPower('ricochet', ctx({ ahead: [{ gap: 60, lat: 0, shielded: false }] })));
  assert.ok(!aiWantsPower('ricochet', ctx({ ahead: [{ gap: 60, lat: 0, shielded: true }] })));
  assert.ok(!aiWantsPower('ricochet', ctx({ ahead: [{ gap: 400, lat: 0, shielded: false }] })));
  assert.ok(aiWantsPower('oil', ctx({ behind: [{ gap: 20, lat: 1, shielded: false }] })));
  assert.ok(!aiWantsPower('oil', ctx({ behind: [{ gap: 20, lat: 7, shielded: false }] })));
  assert.ok(aiWantsPower('strike', ctx({ strike: { shielded: false } })));
  assert.ok(!aiWantsPower('strike', ctx({ strike: null })));
  assert.ok(AI_POWER.cooldown >= 5 && AI_POWER.humanShield >= 8);
});

// A sloppy keyboard driver: late, all-or-nothing steering toward a wandering line.
function sloppyLap(t, car, assist, seed) {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const v = new Vehicle(car);
  v.placeOnTrack(t, 0, 0, 0);
  const a = new DriveAssist(t), pt = {};
  let dist = 0, last = v.s, time = 0, hits = 0, crashes = 0, steer = 0, next = 0;
  while (dist < t.length && time < 150) {
    if (time >= next) {
      next = time + 0.1 + rnd() * 0.12;
      const p = t.pointAt(v.s + 10 + v.speed * 0.45, (rnd() - 0.5) * 6, pt);
      const err = Math.atan2(Math.sin(Math.atan2(p.x - v.x, p.z - v.z) - v.heading), Math.cos(Math.atan2(p.x - v.x, p.z - v.z) - v.heading));
      steer = Math.abs(err) < 0.07 ? 0 : -Math.sign(err);
    }
    let c = { steer, throttle: 1, brake: 0, handbrake: false, boost: true };
    if (assist) c = a.apply(v, c);
    v.update(1 / 120, c, 1);
    const h = v.constrain(t);
    if (h && h.vn > 3) hits++;
    if (h && isWallCrash({ speed: h.speed, angleDeg: h.angle }, assist ? ASSIST_RULES : RULES)) crashes++;
    dist += t.deltaS(last, v.s); last = v.s; time += 1 / 120;
  }
  return { time, hits, crashes };
}

test('drive assist helps a sloppy driver but does not steer for you', () => {
  let raw = 0, helped = 0, crashes = 0;
  for (const id of ['city', 'canyon', 'alpine']) {
    const lay = LAYOUTS[id];
    const t = new TrackPath(lay.points, { width: lay.width });
    for (const car of [CARS[1], CARS[4]]) {
      raw += sloppyLap(t, car, false, 5).hits;
      const h = sloppyLap(t, car, true, 5);
      helped += h.hits;
      crashes += h.crashes;
      // hands off the wheel the car is not driven round the track
      const v = new Vehicle(car);
      v.placeOnTrack(t, 0, 0, 0);
      const a = new DriveAssist(t);
      let hits = 0;
      for (let i = 0; i < 120 * 30; i++) {
        v.update(1 / 120, a.apply(v, { steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false }), 1);
        const w = v.constrain(t);
        if (w && w.vn > 3) hits++;
      }
      assert.ok(hits >= 3, `${id} ${car.name}: hands-off car only touched the wall ${hits} times`);
    }
  }
  assert.equal(crashes, 0);
  assert.ok(helped < raw * 0.85, `wall hits with assist ${helped} vs without ${raw}`);
});

test('a car steering away from the rail gets free quickly and keeps its speed', () => {
  const t = new TrackPath(circle(400), { width: 20 });
  const v = new Vehicle(CARS[0]);
  v.placeOnTrack(t, 0, 4, 0);
  v.heading -= 0.45; // angled toward the outside wall (positive lateral is the inside here)
  v.vx = Math.sin(v.heading) * 40; v.vz = Math.cos(v.heading) * 40;
  let hitAt = null, time = 0, freeAt = null;
  while (time < 4 && freeAt === null) {
    const steer = hitAt === null ? 0 : -0.8;
    v.update(1 / 120, { steer, throttle: 1, brake: 0, handbrake: false, boost: false }, 1);
    if (v.constrain(t) && hitAt === null) hitAt = time;
    if (hitAt !== null && time - hitAt > 0.05 && Math.abs(v.lateral) < t.halfWidth - 2.6) freeAt = time;
    time += 1 / 120;
  }
  assert.ok(hitAt !== null, 'never reached the wall');
  assert.ok(freeAt !== null && freeAt - hitAt < 1.0, `stuck for ${freeAt === null ? '>4' : (freeAt - hitAt).toFixed(2)} s`);
  assert.ok(v.speed > 25, `speed ${v.speed.toFixed(1)}`);
});

test('every car spends the points budget (within 10%), most exactly', () => {
  let exact = 0;
  for (const c of CARS) {
    assert.ok(Math.abs(c.total - CAR_BUDGET) <= CAR_BUDGET * 0.1, `${c.name} ${c.total}`);
    for (const v of Object.values(c.points)) assert.ok(v >= 1 && v <= 10);
    if (c.total === CAR_BUDGET) exact++;
  }
  assert.ok(exact > CARS.length / 2);
});

import { findShortcuts, constrainOnRoads, ShortcutSet, SHORTCUT } from '../game/src/shortcut.js';
import { AIDriver } from '../game/src/ai.js';
import { signatureAt, hairpinS, SIGNATURES, SIGNATURE_KINDS } from '../game/src/signatures.js';
import { recordRace, discoverSignature, unlockedPaints, emptyProgress, starsEarned } from '../game/src/progress.js';
import { PAINTS, BASE_PAINTS } from '../game/src/config.js';

const shortcutCache = new Map();
const shortcutsOf = (id) => {
  if (!shortcutCache.has(id)) {
    const lay = LAYOUTS[id];
    const t = new TrackPath(lay.points, { width: lay.width });
    shortcutCache.set(id, { t, list: findShortcuts(t) });
  }
  return shortcutCache.get(id);
};

test('every track gets 2-3 smooth shortcuts that save distance and do not overlap', () => {
  for (const id of Object.keys(LAYOUTS)) {
    const { t, list } = shortcutsOf(id);
    assert.ok(list.length >= 2 && list.length <= 3, `${id}: ${list.length} shortcuts`);
    for (const sc of list) {
      assert.ok(sc.saving >= SHORTCUT.minSavingExtra && sc.saving <= SHORTCUT.maxSaving, `${id}: saves ${sc.saving}`);
      for (let i = 0; i < sc.path.n; i++) assert.ok(Math.abs(sc.path.curv[i]) <= 1 / (SHORTCUT.minRadius * 0.85) + 1e-6, `${id}: tight at ${i}`);
      assert.ok(sc.mainGap.some(Boolean), `${id}: no barrier gap`);
      assert.ok(sc.a > 150 && sc.b < t.length - 100, `${id}: too close to the start line`);
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [p, q] = [list[i], list[j]];
      assert.ok(p.b + 100 < q.a || q.b + 100 < p.a, `${id}: shortcuts ${i} and ${j} overlap`);
    }
    // the first has a full ramp, later ones are hidden behind fences
    assert.ok(list[0].ramps.length === 1 && !list[0].ramps[0].half && !list[0].fence);
    assert.ok(list.slice(1).every((sc) => sc.fence));
  }
});

test('an AI that takes a shortcut drives through it cleanly and gains time', () => {
  for (const id of ['city', 'canyon']) {
    const { t, list } = shortcutsOf(id);
    const set = new ShortcutSet(t, list);
    const lapTime = (chance) => {
      const v = new Vehicle(CARS[1]);
      v.placeOnTrack(t, 0, 0, 0);
      const ai = new AIDriver(v, t, { skill: 1, aggression: 0, shortcuts: list, shortcutChance: chance });
      ai.boostCooldown = 1e9;
      let dist = 0, last = v.s, time = 0, entered = 0, was = false, hits = 0, airs = 0;
      while (dist < t.length && time < 160) {
        const c = ai.think(1 / 120, [], null, 0, 0);
        c.boost = false;
        assert.ok(!c.needsReset, `${id}: AI got stuck`);
        v.update(1 / 120, c, 1);
        const h = constrainOnRoads(v, t, set, 1 / 120);
        if (h && h.vn > 3) hits++;
        if (v.onSC && !was) entered++;
        was = v.onSC;
        if (v.events) { airs += v.events.filter((e) => e.type === 'land' && e.airTime > 0.3).length; v.events.length = 0; }
        dist += t.deltaS(last, v.s); last = v.s; time += 1 / 120;
      }
      return { time, entered, hits, airs };
    };
    const main = lapTime(0), cut = lapTime(2); // 2: certain even for the fenced ones (x0.6)
    assert.equal(main.entered, 0);
    assert.equal(cut.entered, list.length, `${id}: entered ${cut.entered} of ${list.length}`);
    assert.ok(cut.hits <= 1, `${id}: ${cut.hits} wall hits`);
    assert.ok(cut.airs >= 1, `${id}: never got airborne off a ramp`);
    assert.ok(cut.time < main.time, `${id}: shortcuts ${cut.time.toFixed(1)} vs ${main.time.toFixed(1)}`);
  }
});

test('ramp tricks: drift + steer at take-off spins the car round by landing', () => {
  const { t, list } = shortcutsOf('city');
  const set = new ShortcutSet(t, list);
  for (const sc of list.filter((x) => x.ramps.length)) {
    const r = sc.ramps[0];
    const v = new Vehicle(CARS[0]);
    const start = sc.path.pointAt(r.u0 - 25, r.half ? r.half * 2.5 : 0);
    v.placeOnTrack(t, sc.mainS(r.u0 - 25), 0, 0);
    Object.assign(v, { x: start.x, z: start.z, heading: start.heading, vx: Math.sin(start.heading) * 40, vz: Math.cos(start.heading) * 40, onSC: true, sc, scIdx: -1 });
    let landed = null;
    for (let i = 0; i < 600 && !landed; i++) {
      const u = v.onSC ? v.scU : 0;
      const trick = u > r.u0 - 3 && u < r.u0 + r.len + 1;
      v.update(1 / 120, { steer: trick ? 0.8 : 0, throttle: 1, brake: 0, handbrake: trick, boost: false }, 1);
      constrainOnRoads(v, t, set, 1 / 120);
      if (v.events && v.events.length) landed = v.events.find((e) => e.type === 'land');
    }
    assert.ok(landed, 'never landed');
    assert.ok(landed.airTime > 0.5, `air time ${landed.airTime}`);
    assert.equal(landed.trick, r.half ? 'roll' : 'spin');
    assert.ok(landed.clean, 'trick not finished by landing');
    assert.equal(v.trickYaw + v.trickRoll, 0);
  }
});

test('signature takedown spots', () => {
  const t = new TrackPath(LAYOUTS.coast.points, { width: LAYOUTS.coast.width });
  const hp = hairpinS(t);
  const ctx = (o) => ({ track: t, s: 1000, onShortcut: false, hairpin: hp, landmark: { s: [800], range: 80 }, ...o });
  assert.equal(signatureAt('coast', ctx({ s: 820 })).id, 'landmark');
  assert.equal(signatureAt('coast', ctx({ s: hp + 10 })).id, 'hairpin');
  assert.equal(signatureAt('coast', ctx({ s: t.length - 20 })).id, 'line');
  assert.equal(signatureAt('coast', ctx({ onShortcut: true })).id, 'shortcut');
  assert.equal(signatureAt('coast', ctx({ s: (hp + 1500) % t.length, landmark: null })), null);
  for (const defs of Object.values(SIGNATURES)) for (const k of SIGNATURE_KINDS) assert.ok(defs[k].name && defs[k].line);
});

test('stars, signatures and earned paints', () => {
  assert.deepEqual(starsEarned({ pos: 1, takedowns: 5, crashes: 0 }), [true, true, true]);
  assert.deepEqual(starsEarned({ pos: 2, takedowns: 4, crashes: 1 }), [false, false, false]);
  const p = emptyProgress();
  assert.ok(unlockedPaints(p, PAINTS).slice(0, BASE_PAINTS).every(Boolean));
  assert.ok(!unlockedPaints(p, PAINTS).slice(BASE_PAINTS).some(Boolean));
  let r = recordRace(p, 'coast', { pos: 1, takedowns: 12, crashes: 2 }, PAINTS);
  assert.deepEqual(r.stars, [0, 1]);
  assert.ok(r.paints.some((x) => x.unlock.takedowns === 10));
  r = recordRace(p, 'coast', { pos: 1, takedowns: 0, crashes: 0 }, PAINTS);
  assert.deepEqual(r.stars, [2]); // only the new one
  assert.deepEqual(p.stars.coast, [true, true, true]);
  assert.equal(p.totalTakedowns, 12);
  assert.ok(discoverSignature(p, 'coast', 'line'));
  assert.ok(!discoverSignature(p, 'coast', 'line'));
});

test('forks and merges: walls only where a barrier is drawn (no invisible walls)', () => {
  let r = 7;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  let drives = 0, hits = 0;
  for (const id of Object.keys(LAYOUTS)) {
    const { t, list } = shortcutsOf(id);
    const set = new ShortcutSet(t, list);
    for (const sc of list) {
      for (const atMerge of [false, true]) {
        for (let k = 0; k < 120; k++) {
          // drive at a random angle across the gap between the roads
          const v = new Vehicle(CARS[k % CARS.length]);
          if (k % 2) {
            // start on the main road near the fork / merge, close to the shortcut's edge
            const s = atMerge ? sc.b - 10 - rnd() * 60 : sc.a + rnd() * 60;
            v.placeOnTrack(t, s, sc.side * (t.halfWidth - 1.5 - rnd() * 6), 0);
          } else {
            // or on the shortcut itself, near its ends, heading back toward the main road
            const u = atMerge ? sc.path.length - sc.overlapOut - rnd() * 40 : sc.overlapIn * rnd() + 5;
            const p = sc.path.pointAt(u, (rnd() - 0.5) * 2 * (sc.path.halfWidth - 1.2));
            v.placeOnTrack(t, sc.mainS(u), 0, 0);
            Object.assign(v, { x: p.x, z: p.z, heading: p.heading, onSC: true, sc, scIdx: -1 });
          }
          const ang = v.heading + (rnd() - 0.5) * 0.9;
          const sp = 15 + rnd() * 35;
          v.heading = ang; v.vx = Math.sin(ang) * sp; v.vz = Math.cos(ang) * sp;
          drives++;
          for (let i = 0; i < 120; i++) {
            const steer = (rnd() - 0.5) * 2;
            v.update(1 / 120, { steer, throttle: 1, brake: 0, handbrake: false, boost: false }, 1);
            const h = constrainOnRoads(v, t, set, 1 / 120);
            if (!h) continue;
            hits++;
            // the barrier the car touched must exist where it touched
            if (v.onSC) {
              const q = v.sc.path.project(v.x, v.z);
              const side = Math.sign(q.lateral) < 0 ? 0 : 1;
              assert.ok(!v.sc.pathGap[side][q.idx], `${id}: invisible shortcut wall at u=${q.s.toFixed(0)}`);
            } else {
              const p = t.project(v.x, v.z);
              assert.ok(!set.isGap(p.s, Math.sign(p.lateral)), `${id}: invisible main-road wall at s=${p.s.toFixed(0)}`);
            }
          }
        }
      }
    }
  }
  assert.ok(drives > 500 && hits > 0, `drives ${drives} hits ${hits}`);
});

// drive a car up to a ramp lip and through the jump with the given drift / steer inputs
function jump(sc, inputs) {
  const { t, list } = shortcutsOf('city');
  const set = new ShortcutSet(t, list);
  const r = sc.ramps[0];
  const v = new Vehicle(CARS[0]);
  const start = sc.path.pointAt(r.u0 - 30, r.half ? r.half * 2.5 : 0);
  v.placeOnTrack(t, sc.mainS(r.u0 - 30), 0, 0);
  Object.assign(v, { x: start.x, z: start.z, heading: start.heading, vx: Math.sin(start.heading) * 42, vz: Math.cos(start.heading) * 42, onSC: true, sc, scIdx: -1 });
  for (let i = 0; i < 700; i++) {
    const u = v.onSC ? v.scU : 0;
    const c = inputs(u - (r.u0 + r.len), v.air);
    v.update(1 / 120, { throttle: 1, brake: 0, boost: false, steer: 0, handbrake: false, ...c }, 1);
    constrainOnRoads(v, t, set, 1 / 120);
    const e = v.events && v.events.find((x) => x.type === 'land');
    if (e) return e;
  }
  return null;
}

test('flat spin, aerial donut and barrel roll', () => {
  const { list } = shortcutsOf('city');
  const full = list.find((sc) => sc.ramps.length && !sc.ramps[0].half);
  const half = list.find((sc) => sc.ramps.length && sc.ramps[0].half);
  // drift into the lip, let go once airborne: one turn
  const spin = jump(full, (d, air) => ({ handbrake: d > -6 && !air, steer: d > -6 && !air ? 1 : 0 }));
  assert.equal(spin.trick, 'spin');
  assert.ok(spin.clean);
  // keep drift held through the jump: two turns
  const donut = jump(full, (d) => ({ handbrake: d > -6, steer: d > -6 ? -1 : 0 }));
  assert.equal(donut.trick, 'donut');
  assert.ok(donut.clean);
  // drift released a moment before the lip still counts
  const late = jump(full, (d) => ({ handbrake: d > -12 && d < -4, steer: d > -12 && d < -4 ? 1 : 0 }));
  assert.equal(late.trick, 'spin');
  // drift + steer just after take-off also starts one
  const air = jump(full, (d, inAir) => ({ handbrake: inAir && d < 6, steer: inAir && d < 6 ? 1 : 0 }));
  assert.ok(air.trick === 'spin' || air.trick === 'donut', `late start: ${air.trick}`);
  assert.ok(air.clean);
  // no input: just airtime
  assert.equal(jump(full, () => ({})).trick, null);
  if (half) {
    const roll = jump(half, (d, inAir) => ({ handbrake: d > -6 && !inAir, steer: d > -6 && !inAir ? 1 : 0 }));
    assert.equal(roll.trick, 'roll');
    assert.ok(roll.clean);
  }
});

test('fast jumps (with and without tricks) never crash and never hit a wall in the air', () => {
  for (const id of ['city', 'snow', 'jungle']) {
    const { t, list } = shortcutsOf(id);
    const set = new ShortcutSet(t, list);
    let runs = 0, landings = 0;
    for (const sc of list.filter((x) => x.ramps.length)) {
      const r = sc.ramps[0];
      for (let run = 0; run < 24; run++) {
        runs++;
        const v = new Vehicle(CARS[run % CARS.length]);
        const p = sc.path.pointAt(r.u0 - 50, r.half ? r.half * 2 : 0);
        v.placeOnTrack(t, sc.mainS(r.u0 - 50), 0, 0);
        const sp = 40 + (run % 8) * 6;
        Object.assign(v, { x: p.x, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * sp, vz: Math.cos(p.heading) * sp, onSC: true, sc, scIdx: -1 });
        constrainOnRoads(v, t, set, 1 / 120);
        const mode = run % 3, st = run % 2 ? 0.8 : -0.8;
        for (let k = 0; k < 400; k++) {
          const d = (v.onSC ? v.scU : 999) - (r.u0 + r.len);
          const hb = mode === 0 ? false : mode === 1 ? d > -8 && !v.air : d > -8 && d < 15;
          const road = v.onSC ? v.sc.path : t;
          const q = road.project(v.x, v.z);
          const aim = road.pointAt(q.s + 12 + v.speed * 0.35, d < 0 && r.half ? r.half * 2.2 : 0);
          let e = Math.atan2(aim.x - v.x, aim.z - v.z) - v.heading;
          e = Math.atan2(Math.sin(e), Math.cos(e));
          v.update(1 / 120, { throttle: 1, boost: true, brake: 0, steer: hb ? st : Math.max(-1, Math.min(1, -e * 2.4)), handbrake: hb }, 1.32);
          const h = constrainOnRoads(v, t, set, 1 / 120);
          assert.ok(!(h && v.air), `${id}: hit a wall in the air`);
          const flying = v.air || v.landCool > 0;
          assert.ok(!(h && !flying && isWallCrash({ speed: h.speed, angleDeg: h.angle }, RULES)), `${id}: crashed after a jump (run ${run})`);
          if (v.events) for (const ev of v.events.splice(0)) if (ev.type === 'land') { landings++; if (ev.trick) assert.ok(ev.clean, `${id}: sloppy ${ev.trick}`); }
          if (!v.onSC && d > 60) break;
        }
      }
    }
    assert.equal(landings, runs, `${id}: ${landings} landings from ${runs} jumps`);
  }
});

// --- phones: touch steering, the boost button, GRAPHICS AUTO ----------------------------------
import { sliderSteer, tiltAngle, tiltSteer, BoostLatch } from '../game/src/touch.js';
import { autoQuality } from '../game/src/config.js';

test('thumb slider: dead zone, analog in between, full lock, symmetric', () => {
  assert.equal(sliderSteer(0, 60), 0);
  assert.equal(sliderSteer(3, 60), 0);
  const half = sliderSteer(30, 60);
  assert.ok(half > 0.3 && half < 0.6, `half travel steers ${half}`);
  assert.ok(sliderSteer(15, 60) < half && half < sliderSteer(45, 60));
  assert.equal(sliderSteer(60, 60), 1);
  assert.equal(sliderSteer(500, 60), 1);
  assert.equal(sliderSteer(-30, 60), -half);
});

test('tilt: turning the phone clockwise like a wheel steers right, held either way round', () => {
  const g = 9.8, deg = Math.PI / 180;
  // reaction to gravity in device axes (x = right edge, y = top edge in portrait) when the phone
  // is turned clockwise by phi from how it is held in each orientation
  const readings = {
    0: (p) => [-g * Math.sin(p), g * Math.cos(p)], // portrait: top up
    90: (p) => [g * Math.cos(p), g * Math.sin(p)], // landscape, top of the phone to the left
    270: (p) => [-g * Math.cos(p), -g * Math.sin(p)], // landscape, top to the right
  };
  for (const [screen, read] of Object.entries(readings)) {
    for (const sign of [1, -1]) { // iOS reports the opposite sign
      const angle = (p) => { const [x, y] = read(p); return tiltAngle(sign * x, sign * y, Number(screen)); };
      const neutral = angle(0);
      assert.equal(tiltSteer(angle(0), neutral), 0, `${screen}: level`);
      assert.ok(tiltSteer(angle(10 * deg), neutral) > 0.2, `${screen}: clockwise turns right`);
      assert.ok(tiltSteer(angle(-10 * deg), neutral) < -0.2, `${screen}: anticlockwise turns left`);
      assert.equal(tiltSteer(angle(40 * deg), neutral), 1, `${screen}: full lock`);
      assert.equal(tiltSteer(angle(1 * deg), neutral), 0, `${screen}: a shaky hand does nothing`);
    }
  }
});

test('boost button: a tap fires it until the meter is empty, a hold boosts while held', () => {
  const b = new BoostLatch();
  b.down(0); b.up(100);
  assert.ok(b.on, 'tap latches');
  b.update(500, true);
  assert.ok(b.on, 'stays on while boosting');
  b.update(900, false);
  assert.ok(!b.on, 'lets go once the meter runs dry');
  b.down(1000); b.up(1100); b.down(1500); b.up(1600);
  assert.ok(!b.on, 'second tap stops it');
  b.down(2000);
  assert.ok(b.on, 'held');
  b.up(3000);
  assert.ok(!b.on, 'released after a hold');
});

test('graphics AUTO: desktops start high, phones by GPU class', () => {
  assert.equal(autoQuality('ANGLE (NVIDIA Quadro P2000)', false), 'high');
  assert.equal(autoQuality('Adreno (TM) 740', true), 'medium');
  assert.equal(autoQuality('Adreno (TM) 830', true), 'medium');
  assert.equal(autoQuality('Adreno (TM) 650', true), 'low');
  assert.equal(autoQuality('Mali-G715-Immortalis MC11', true), 'medium');
  assert.equal(autoQuality('Mali-G78 MP14', true), 'low');
  assert.equal(autoQuality('Apple GPU', true), 'medium');
  assert.equal(autoQuality('', true), 'low');
});

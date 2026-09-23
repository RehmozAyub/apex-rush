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
  st.update(PICKUP_RULES.boostRespawn - 0.1);
  assert.equal(st.near(1, 1), null);
  const back = st.update(0.2);
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
});

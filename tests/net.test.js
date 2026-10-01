// Online play: clock sync, state packing, remote-car smoothing and the earliest-hit rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetClock } from '../game/src/net/clock.js';
import { packStates, unpackStates, STATE_FIELDS, makeCode, CODE_CHARS } from '../game/src/net/protocol.js';
import { RemoteCar, predict, History, SMOOTH } from '../game/src/net/remoteCar.js';
import { HitJudge, plausibleContact, HIT } from '../game/src/net/hits.js';

let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('guest clock locks onto the host clock through jittery pings', () => {
  // the guest's local clock runs 1234.5 s behind the host's; one-way lag 50 ms +-30 ms
  let t = 0;
  const host = new NetClock(true, () => t + 1234.5);
  const guest = new NetClock(false, () => t);
  const lag = () => 0.05 + (rnd() * 2 - 1) * 0.03;
  for (let i = 0; i < 30; i++) {
    const ping = { type: 'ping', a: guest.now() };
    t += lag();
    const pong = host.reply(ping);
    t += lag();
    guest.onPong(pong);
    t += 1;
  }
  assert.ok(guest.synced);
  assert.ok(Math.abs(guest.shared() - host.shared()) < 0.01, `clock error ${(guest.shared() - host.shared()) * 1000} ms`);
  assert.ok(guest.rtt > 0.04 && guest.rtt < 0.17, `rtt ${guest.rtt}`);
});

test('a synced clock never jumps: corrections ease in', () => {
  let t = 0;
  const g = new NetClock(false, () => t);
  g.onPong({ a: -0.1, b: 100 });
  const before = g.shared();
  g.onPong({ a: t - 0.1, b: 100.05 + 0.05 }); // a later estimate 50 ms different
  assert.ok(Math.abs(g.shared() - before) < 0.0045);
});

test('car states pack and unpack', () => {
  const st = Object.fromEntries(STATE_FIELDS.map((k, i) => [k, i * 1.25]));
  Object.assign(st, { idx: 6, scIdx: -1, flags: 37 });
  const msg = unpackStates(packStates(123456.789, [st, { ...st, idx: 2, x: -500.5 }]));
  assert.equal(msg.states.length, 2);
  assert.ok(Math.abs(msg.t - 123456.789) < 1e-9);
  assert.equal(msg.states[0].idx, 6);
  assert.equal(msg.states[0].flags, 37);
  assert.equal(msg.states[0].scIdx, -1);
  assert.equal(msg.states[1].x, -500.5);
  assert.ok(Math.abs(msg.states[0].heading - st.heading) < 1e-5);
});

test('room codes use only unambiguous characters', () => {
  for (let i = 0; i < 200; i++) {
    const c = makeCode(rnd);
    assert.equal(c.length, 4);
    for (const ch of c) assert.ok(CODE_CHARS.includes(ch));
  }
});

// a car going round a 150 m radius bend at speed `v` (m/s): its true state at time t
function circle(t, v = 83, R = 150) {
  const w = v / R; // yaw rate (heading increases = turning left)
  const h = w * t;
  // heading = atan2(fx, fz); position on the circle that has that tangent
  return { x: R * (1 - Math.cos(h)), z: R * Math.sin(h), heading: h, vx: Math.sin(h) * v, vz: Math.cos(h) * v, yawRate: w, y: 0, flags: 0 };
}

test('prediction keeps a 300 km/h car close to where it really is', () => {
  // 60 ms old state, predicted forward: within half a metre (without prediction: 5 m behind)
  const old = circle(1), now = circle(1.06);
  const p = predict(old, 0.06, {});
  assert.ok(Math.hypot(p.x - now.x, p.z - now.z) < 0.5, `error ${Math.hypot(p.x - now.x, p.z - now.z)}`);
  assert.ok(Math.hypot(old.x - now.x, old.z - now.z) > 4.5);
});

test('remote car: states every 1/60 s with lag and jitter stay smooth and close', () => {
  const rc = new RemoteCar();
  const lag = 0.06, dt = 1 / 60;
  let worst = 0, worstJump = 0, prev = null;
  const arrivals = [];
  for (let k = 0; k < 600; k++) arrivals.push({ sent: k * dt, at: k * dt + lag + (rnd() * 2 - 1) * 0.02, lost: rnd() < 0.02 });
  arrivals.sort((a, b) => a.at - b.at);
  let i = 0;
  for (let f = 0; f < 600; f++) {
    const now = f * dt;
    while (i < arrivals.length && arrivals[i].at <= now) {
      const a = arrivals[i++];
      if (!a.lost) rc.push(a.sent, circle(a.sent), now);
    }
    const s = rc.sample(now, dt);
    if (!s || f < 30) continue;
    const truth = circle(now);
    worst = Math.max(worst, Math.hypot(s.x - truth.x, s.z - truth.z));
    if (prev) worstJump = Math.max(worstJump, Math.hypot(s.x - prev.x, s.z - prev.z));
    prev = { x: s.x, z: s.z };
  }
  assert.ok(worst < 1.0, `worst position error ${worst.toFixed(2)} m`);
  // at 83 m/s a frame moves the car 1.39 m; no frame should jump much more than that
  assert.ok(worstJump < 1.39 * 1.5, `worst jump ${worstJump.toFixed(2)} m`);
});

test('remote car: a respawn far away snaps instead of sliding across the map', () => {
  const rc = new RemoteCar();
  rc.push(0, circle(0), 0);
  rc.sample(0.016, 0.016);
  const far = { ...circle(0), x: 500, z: 500 };
  rc.push(0.02, far, 0.03);
  const s = rc.sample(0.033, 0.016);
  assert.ok(Math.hypot(s.x - 500, s.z - 500) < 2);
  assert.ok(SMOOTH.snap < 700);
});

test('remote car: stale (out of order) states are ignored', () => {
  const rc = new RemoteCar();
  assert.ok(rc.push(1, circle(1), 1));
  assert.equal(rc.push(0.9, circle(0.9), 1), false);
  assert.equal(rc.lastT, 1);
});

test('history interpolates positions', () => {
  const h = new History();
  h.add(0, 0, 0, 10); h.add(1, 10, 0, 20);
  const p = h.at(0.5);
  assert.equal(p.x, 5);
  assert.equal(p.speed, 15);
});

const claim = (from, t, attacker, kind = 'takedown') => ({ from, t, attacker, kind, nx: 1, nz: 0, closing: 20 });

test('earliest hit wins when both players claim the same contact', () => {
  const j = new HitJudge();
  // the guest saw itself ramming at t=10.00, the host saw itself ramming at t=10.03
  assert.equal(j.add(claim('host', 10.03, 'host'), 10.03, 0.1), null);
  const o = j.add(claim('guest', 10.0, 'guest'), 10.09, 0.1);
  assert.equal(o.attacker, 'guest');
  assert.equal(o.victim, 'host');
  assert.ok(o.paired);
  // ...and the other order of arrival gives the same answer
  const j2 = new HitJudge();
  j2.add(claim('guest', 10.0, 'guest'), 10.06, 0.1);
  assert.equal(j2.add(claim('host', 10.03, 'host'), 10.06, 0.1).attacker, 'guest');
});

test('the same side claiming twice keeps its earliest claim', () => {
  const j = new HitJudge();
  j.add(claim('host', 10.05, 'host'), 10.05, 0.1);
  assert.equal(j.add(claim('host', 10.02, 'guest', 'push'), 10.06, 0.1), null);
  const o = j.add(claim('guest', 10.04, 'guest'), 10.1, 0.1);
  assert.equal(o.attacker, 'guest'); // host's 10.02 claim said the guest attacked (a push)
  assert.equal(o.kind, 'push');
});

test('a lone claim stands only if the cars were really that close', () => {
  const j = new HitJudge();
  j.add(claim('guest', 20, 'guest'), 20.05, 0.1);
  assert.deepEqual(j.update(20.1, () => true), []); // still waiting for the host's claim
  const out = j.update(20.05 + 0.1 + HIT.extra + 0.01, () => true);
  assert.equal(out.length, 1);
  assert.equal(out[0].attacker, 'guest');
  assert.equal(out[0].paired, false);
  const j2 = new HitJudge();
  j2.add(claim('guest', 30, 'guest'), 30, 0.1);
  assert.deepEqual(j2.update(31, () => false), []);
});

test('claims right after a decided contact are ignored (cooldown)', () => {
  const j = new HitJudge();
  j.add(claim('host', 5, 'host'), 5, 0.1);
  assert.ok(j.add(claim('guest', 5.01, 'host'), 5.05, 0.1));
  assert.equal(j.add(claim('guest', 5.2, 'guest'), 5.25, 0.1), null);
  assert.deepEqual(j.update(9, () => true), []);
  // a new contact a second later counts again
  j.add(claim('guest', 6.2, 'guest'), 6.25, 0.1);
  assert.equal(j.update(7, () => true).length, 1);
});

test('plausible contact allows for lag at speed', () => {
  const a = { x: 0, z: 0, speed: 80 }, b = { x: 9, z: 0, speed: 60 };
  assert.ok(plausibleContact(a, b, 0.1)); // 5 + 80 * 0.05 + 1.5 = 10.5 m
  assert.ok(!plausibleContact(a, { ...b, x: 12 }, 0.1));
  assert.ok(!plausibleContact(null, b, 0.1));
});

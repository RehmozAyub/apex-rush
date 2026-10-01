// On-screen touch controls for phones and tablets. The car accelerates by itself; the left thumb
// steers (thumb slider, ◀ ▶ buttons, or tilt the phone) and the right thumb has BRAKE, DRIFT,
// BOOST and POWER. Pause, camera and car reset sit at the top. Several fingers work at once.
import { powerIconURL } from './powerIcons.js';

// --- steering maths (pure, tested) --------------------------------------------------------
// Thumb slider: dx = thumb offset from where it touched down; `range` px is full lock.
export function sliderSteer(dx, range, dead = 0.08) {
  const t = Math.min(1, Math.abs(dx) / range);
  if (t <= dead) return 0;
  return Math.sign(dx) * Math.pow((t - dead) / (1 - dead), 1.25);
}

// Tilt: angle of the phone in its screen plane (radians, + = turned clockwise like a wheel),
// from accelerationIncludingGravity (device axes) and the screen orientation angle (degrees).
export function tiltAngle(ax, ay, screenDeg) {
  const r = (screenDeg * Math.PI) / 180;
  const gx = ax * Math.cos(r) - ay * Math.sin(r); // "up" in screen axes
  const gy = ax * Math.sin(r) + ay * Math.cos(r);
  return Math.atan2(-gx, gy);
}

// Steering from a tilt angle relative to the neutral angle; full lock at `lock` radians.
export function tiltSteer(angle, neutral, lock = 0.42, dead = 0.025) {
  const d = Math.atan2(Math.sin(angle - neutral), Math.cos(angle - neutral));
  const t = Math.min(1, Math.abs(d) / lock);
  if (t * lock <= dead) return 0;
  return Math.sign(d) * Math.min(1, (Math.abs(d) - dead) / (lock - dead));
}

// --- boost button: tap to fire it until the meter runs dry (tap again to stop), or hold ---------
export class BoostLatch {
  constructor() { this.latched = false; this.held = false; this.downAt = 0; this.wasLatched = false; this.latchAt = 0; }
  down(now) { this.held = true; this.downAt = now; this.wasLatched = this.latched; this.latched = false; }
  up(now) {
    if (!this.held) return;
    this.held = false;
    if (now - this.downAt < 300) { this.latched = !this.wasLatched; this.latchAt = now; }
  }
  // boosting: whether the car is actually boosting; a latch that did not light up (empty meter,
  // wrecked) lets go
  update(now, boosting) { if (this.latched && !boosting && now - this.latchAt > 300) this.latched = false; }
  get on() { return this.held || this.latched; }
  reset() { this.latched = false; this.held = false; }
}

const RIGHT = ['brake', 'power', 'drift', 'boost']; // right-thumb buttons, smallest first
const SLIDE = new Set(['brake', 'drift', 'boost']); // a thumb can slide between these

export class TouchControls {
  // root: element to build into; onAction(action): pause / camera / reset taps
  constructor(root, onAction) {
    this.onAction = onAction;
    this.mode = 'slider';
    this.active = false;
    this.pointers = new Map(); // pointerId -> { kind: 'steer' | 'btn', btn, ox, x }
    this.held = {};
    this.boost = new BoostLatch();
    this.powerPulse = 0;
    this.tilt = { angle: 0, neutral: 0, ok: false, calibrating: true, smooth: null };
    this.hintShown = false;

    // each control has its own shape: BOOST a nitro canister, DRIFT a skewed slab with a sliding
    // car, BRAKE a stop-sign octagon, POWER a pickup-block slot, the slider knob a steering wheel
    const svg = (body, box = '0 0 24 24') => `<svg viewBox="${box}" aria-hidden="true">${body}</svg>`;
    const wheel = svg('<circle cx="20" cy="20" r="15.5" class="rim"/><path d="M5 19.5h30M20 23v12" class="spoke"/><circle cx="20" cy="20" r="5.2" class="hub"/><path d="M20 3.5v6" class="mark"/>', '0 0 40 40');
    const el = document.createElement('div');
    el.id = 'tc';
    el.innerHTML = /* html */ `
      <div class="tc-hint">◀ SLIDE TO STEER ▶</div>
      <div class="tc-stick"><i class="base"></i><i class="knob">${wheel}</i></div>
      <div class="tc-lr">
        <b class="tc-btn" data-b="left">${svg('<path d="M14 4l-8 8 8 8M20 4l-8 8 8 8"/>')}</b>
        <b class="tc-btn" data-b="right">${svg('<path d="M10 4l8 8-8 8M4 4l8 8-8 8"/>')}</b>
      </div>
      <div class="tc-tilt"><i class="tw">${wheel}</i><span>TILT</span></div>
      <b class="tc-btn tc-brake" data-b="brake"><span>BRAKE</span></b>
      <b class="tc-btn tc-drift" data-b="drift"><i>${svg('<path d="M2 21c5-.5 9-3 12-8M6 23.5c5-.5 9-2.5 12-7" class="skid"/><rect x="15" y="2.5" width="9" height="15" rx="3" transform="rotate(32 19.5 10)" class="car"/>', '0 0 30 26')}<span>DRIFT</span></i></b>
      <b class="tc-btn tc-boost" data-b="boost"><i class="core"></i><i class="shock"></i><i class="ico">${svg('<path d="M5 20l7-6 7 6"/><path d="M5 14l7-6 7 6"/><path d="M5 8l7-6 7 6"/>')}<span>BOOST</span></i></b>
      <b class="tc-btn tc-power" data-b="power"><i class="slot"></i><img alt=""><em>?</em></b>
      <div class="tc-top">
        <b class="tc-btn" data-b="reset">${svg('<path d="M19.5 12.5a7.5 7.5 0 1 1-2.4-6.1"/><path d="M18.5 3.5v4h-4"/>')}</b>
        <b class="tc-btn" data-b="pause">${svg('<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>')}</b>
        <b class="tc-btn" data-b="camera">${svg('<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><circle cx="12" cy="13.5" r="3.4"/><path d="M8.5 7.5l1.4-2.5h4.2l1.4 2.5"/>')}</b>
      </div>`;
    root.appendChild(el);
    this.el = el;
    this.btn = {};
    for (const b of el.querySelectorAll('[data-b]')) this.btn[b.dataset.b] = b;
    this.stick = el.querySelector('.tc-stick');
    this.knob = el.querySelector('.tc-stick .knob');
    this.tiltWheel = el.querySelector('.tc-tilt .tw');
    this.powerImg = this.btn.power.querySelector('img');

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('devicemotion', (e) => this.onMotion(e));
    this.setMode('slider');
  }

  setMode(mode) {
    this.mode = mode;
    this.el.classList.remove('m-slider', 'm-buttons', 'm-tilt');
    this.el.classList.add(`m-${mode}`);
    this.el.querySelector('.tc-hint').textContent = mode === 'tilt' ? 'TILT TO STEER' : '◀ SLIDE TO STEER ▶';
    this.releaseAll();
  }

  // iOS asks for motion access, and only inside a tap
  static async askMotion() {
    const D = window.DeviceMotionEvent;
    if (D && typeof D.requestPermission === 'function') {
      try { return (await D.requestPermission()) === 'granted'; } catch { return false; }
    }
    return true;
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    this.el.classList.toggle('on', on);
    if (on) { this.el.classList.remove('touched'); this.activeAt = performance.now(); } else this.releaseAll();
  }

  releaseAll() {
    this.pointers.clear();
    this.held = {};
    this.boost.reset();
    this.stick.classList.remove('show');
    for (const b of Object.values(this.btn)) b.classList.remove('down');
  }

  // --- pointers ---------------------------------------------------------------------------
  // which button is under (x, y)? exact for the top row and ◀ ▶, nearest within reach for the
  // round right-thumb buttons (so a slightly-off thumb still lands)
  hit(x, y, only = null) {
    const rect = (b) => this.btn[b].getBoundingClientRect();
    if (!only) {
      for (const b of ['reset', 'pause', 'camera']) {
        const r = rect(b);
        if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 10) return b;
      }
    }
    const list = only || RIGHT;
    // a thumb inside a button's box gets that button (small ones first, so the big DRIFT and
    // BOOST can't steal BRAKE's edge); in the gaps, the nearest one within reach
    for (const b of list) {
      const r = rect(b);
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return b;
    }
    let best = null, bd = only ? 1.0 : 1.3;
    for (const b of list) {
      const r = rect(b);
      if (!r.width) continue;
      const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2) / (Math.max(r.width, r.height) / 2);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  down(e) {
    e.preventDefault();
    const x = e.clientX, y = e.clientY, W = window.innerWidth;
    let b = this.hit(x, y);
    let p;
    if (b) p = { kind: 'btn', btn: b };
    else if (x < W * 0.46) {
      if (this.mode === 'buttons') {
        const l = this.btn.left.getBoundingClientRect(), r = this.btn.right.getBoundingClientRect();
        p = { kind: 'btn', btn: x < (l.right + r.left) / 2 ? 'left' : 'right' };
      } else {
        // slider (in tilt mode too: a thumb on the left overrides the tilt)
        for (const [id, q] of this.pointers) if (q.kind === 'steer') this.pointers.delete(id);
        p = { kind: 'steer', ox: x, oy: y, x };
        this.el.classList.add('touched');
      }
    } else return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    this.pointers.set(e.pointerId, p);
    if (p.kind === 'btn') this.press(p.btn, true);
    this.refresh();
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const x = e.clientX, y = e.clientY;
    if (p.kind === 'steer') {
      p.x = x;
      // the slider's centre follows a thumb that runs past full lock, so turning back is instant
      const R = this.range();
      if (p.x - p.ox > R) p.ox = p.x - R;
      if (p.x - p.ox < -R) p.ox = p.x + R;
    } else if (SLIDE.has(p.btn)) {
      const b = this.hit(x, y, [...SLIDE]);
      if (b && b !== p.btn) { this.press(p.btn, false); p.btn = b; this.press(b, true); }
    } else if (p.btn === 'left' || p.btn === 'right') {
      const l = this.btn.left.getBoundingClientRect(), r = this.btn.right.getBoundingClientRect();
      const b = x < (l.right + r.left) / 2 ? 'left' : 'right';
      if (b !== p.btn) { this.press(p.btn, false); p.btn = b; this.press(b, true); }
    }
    this.refresh();
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind === 'btn') this.press(p.btn, false);
    this.refresh();
  }

  press(b, on) {
    const now = performance.now();
    if (on) {
      if (b === 'boost') this.boost.down(now);
      else if (b === 'power') this.powerPulse = now + 150;
      else if (b === 'pause' || b === 'camera' || b === 'reset') this.onAction(b);
    } else if (b === 'boost') this.boost.up(now);
  }

  // recompute held buttons and the slider visuals from the live pointers
  refresh() {
    const held = {};
    let steer = null;
    for (const p of this.pointers.values()) {
      if (p.kind === 'btn') held[p.btn] = true;
      else steer = p;
    }
    this.held = held;
    this.steerPointer = steer;
    for (const [k, b] of Object.entries(this.btn)) b.classList.toggle('down', !!held[k] || (k === 'boost' && this.boost.on));
    this.stick.classList.toggle('show', !!steer);
    if (steer) {
      const R = this.range(), o = this.el.getBoundingClientRect(); // the layer sits inside the cutout insets
      this.stick.style.setProperty('--r', `${R}px`);
      this.stick.style.transform = `translate(${steer.ox - o.left}px, ${steer.oy - o.top}px)`;
      const dx = steer.x - steer.ox; // the wheel slides and turns with the thumb
      this.knob.style.transform = `translateX(${Math.max(-R, Math.min(R, dx))}px) rotate(${sliderSteer(dx, R) * 110}deg)`;
    }
  }

  range() { return Math.max(46, Math.min(96, window.innerHeight * 0.15)); }

  // --- tilt ---------------------------------------------------------------------------------
  onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null) return;
    const deg = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    const a = tiltAngle(g.x, g.y, deg);
    const t = this.tilt;
    // low-pass in angle space (wrapped) so a shaky hand does not twitch the car
    t.smooth = t.smooth === null ? a : t.smooth + Math.atan2(Math.sin(a - t.smooth), Math.cos(a - t.smooth)) * 0.35;
    t.angle = t.smooth;
    t.ok = true;
    if (t.calibrating) t.neutral = t.angle;
  }

  // while true, the current tilt is "straight ahead" (the race countdown)
  calibrate(on) { this.tilt.calibrating = on; }

  // --- per frame ------------------------------------------------------------------------------
  // H: the player (null outside a race)
  update(H) {
    const now = performance.now();
    if (!H) return;
    if (this.mode === 'tilt' && !this.tilt.ok && !this.tiltWarned && now - this.activeAt > 2500) {
      this.tiltWarned = true;
      this.onAction('notilt'); // no motion sensor: the slider still works
    }
    this.boost.update(now, H.boost.boosting);
    const fill = Math.min(1, H.boost.boost / 100);
    const b = this.btn.boost.classList;
    this.btn.boost.style.setProperty('--fill', fill.toFixed(3));
    b.toggle('lit', H.boost.boosting);
    b.toggle('ready', !H.boost.boosting && H.boost.boost >= 6); // enough in the tank to fire
    b.toggle('down', !!this.held.boost || this.boost.on);
    this.btn.drift.classList.toggle('sliding', !!H.car.vehicle.drifting);
    const pw = H.car.power || '';
    if (pw !== this.shownPower) {
      this.shownPower = pw;
      this.freshUntil = pw ? now + 2600 : 0; // a new power-up blinks TAP for a moment
      this.btn.power.className = `tc-btn tc-power${pw ? ` has p-${pw}` : ''}${this.held.power ? ' down' : ''}`;
      if (pw) this.powerImg.src = powerIconURL(pw);
    }
    this.btn.power.classList.toggle('fresh', now < this.freshUntil);
    if (this.mode === 'tilt') this.tiltWheel.style.transform = `rotate(${(this.lastSteer || 0) * 110}deg)`;
  }

  // controls for the car; null when touch isn't driving
  drive() {
    const h = this.held, now = performance.now();
    let steer = 0;
    if (this.steerPointer) steer = sliderSteer(this.steerPointer.x - this.steerPointer.ox, this.range());
    else if (this.mode === 'buttons') steer = (h.right ? 1 : 0) - (h.left ? 1 : 0);
    else if (this.mode === 'tilt' && this.tilt.ok) steer = tiltSteer(this.tilt.angle, this.tilt.neutral);
    this.lastSteer = steer;
    const brake = h.brake ? 1 : 0;
    return {
      steer,
      throttle: brake ? 0 : 1, // auto-accelerate
      brake,
      handbrake: !!h.drift,
      boost: this.boost.on,
      power: !!h.power || now < this.powerPulse,
      rev: this.boost.on ? 1 : 0, // BOOST held or tapped at GO = perfect start
    };
  }
}

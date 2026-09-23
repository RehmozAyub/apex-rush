// Keyboard + gamepad input. Drive controls are polled; menu actions are pushed as events.

const DRIVE_KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight', 'KeyN'],
  power: ['KeyE', 'KeyF'],
};

const MENU_KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
  Escape: 'back', Backspace: 'back',
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.listeners = [];
    this.padPrev = {};
    this.lastDevice = 'keyboard';
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (MENU_KEYS[e.code] && ['up', 'down', 'left', 'right'].includes(MENU_KEYS[e.code])) this.emit(MENU_KEYS[e.code], e.code);
        e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (MENU_KEYS[e.code]) this.emit(MENU_KEYS[e.code], e.code);
      if (e.code === 'KeyC') this.emit('camera', e.code);
      if (e.code === 'KeyR') this.emit('reset', e.code);
      if (e.code === 'KeyP') this.emit('pause', e.code);
      if (e.code === 'F11') this.emit('fullscreen', e.code);
      if (!e.ctrlKey && !e.altKey) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(action, code) {
    for (const fn of this.listeners) fn(action, code);
  }

  down(name) {
    return DRIVE_KEYS[name].some((k) => this.keys.has(k));
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // Call once per frame: turns gamepad button edges into menu events.
  poll() {
    const p = this.pad();
    if (!p) return;
    const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const state = {
      up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6,
      confirm: b(0), back: b(1), pause: b(9), camera: b(3),
    };
    for (const [k, v] of Object.entries(state)) {
      if (v && !this.padPrev[k]) {
        this.lastDevice = 'pad';
        this.emit(k, 'pad');
      }
    }
    this.padPrev = state;
  }

  drive() {
    if (this.override) return { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, ...this.override };
    let steer = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let throttle = this.down('throttle') ? 1 : 0;
    let brake = this.down('brake') ? 1 : 0;
    let handbrake = this.down('handbrake');
    let boost = this.down('boost');
    let power = this.down('power');
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88);
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      handbrake = handbrake || !!(p.buttons[2] && p.buttons[2].pressed) || !!(p.buttons[5] && p.buttons[5].pressed);
      boost = boost || !!(p.buttons[0] && p.buttons[0].pressed);
      power = power || !!(p.buttons[4] && p.buttons[4].pressed);
    }
    return { steer, throttle, brake, handbrake, boost, power };
  }
}

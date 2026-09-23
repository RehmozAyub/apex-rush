// Keyboard + gamepad input. Drive controls are polled; menu actions are pushed as events.

// Split-screen key sets. In single player every key works for the one player.
export const PLAYER_KEYS = [
  {
    throttle: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    handbrake: ['Space'], boost: ['ShiftLeft'], power: ['KeyE', 'KeyF'], camera: ['KeyC'], reset: ['KeyR'],
  },
  {
    throttle: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    handbrake: ['ControlRight', 'Numpad0', 'Slash'], boost: ['ShiftRight'], power: ['Enter', 'NumpadEnter', 'Period'],
    camera: ['Backslash'], reset: ['BracketRight'],
  },
];
const ALL_KEYS = {};
for (const set of PLAYER_KEYS) for (const [k, v] of Object.entries(set)) ALL_KEYS[k] = [...(ALL_KEYS[k] || []), ...v];
ALL_KEYS.boost.push('KeyN');

// which player a camera/reset key belongs to
export function keyPlayer(action, code) {
  for (let i = 0; i < PLAYER_KEYS.length; i++) if (PLAYER_KEYS[i][action].includes(code)) return i;
  return 0;
}

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
      if (ALL_KEYS.camera.includes(e.code)) this.emit('camera', e.code);
      if (ALL_KEYS.reset.includes(e.code)) this.emit('reset', e.code);
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

  down(name, set = ALL_KEYS) {
    return set[name].some((k) => this.keys.has(k));
  }

  pads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    return [...list].filter((p) => p && p.connected);
  }

  pad(i = 0) {
    return this.pads()[i] || null;
  }

  // Call once per frame: turns gamepad button edges into menu events.
  poll() {
    const pads = this.pads();
    pads.forEach((p, i) => this.pollPad(p, i));
  }

  pollPad(p, i) {
    this.padPrev[i] ||= {};
    const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const state = {
      up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6,
      confirm: b(0), back: b(1), pause: b(9), camera: b(3),
    };
    for (const [k, v] of Object.entries(state)) {
      if (v && !this.padPrev[i][k]) {
        this.lastDevice = 'pad';
        this.emit(k, `pad${i}`);
      }
    }
    this.padPrev[i] = state;
  }

  // Drive controls for player i. In split screen each player has their own keys and gamepad
  // (first pad = P1, second = P2); in single player everything controls the one car.
  drive(i = 0, split = false) {
    if (this.override) return { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, ...(Array.isArray(this.override) ? this.override[i] : this.override) };
    const set = split ? PLAYER_KEYS[i] : ALL_KEYS;
    let steer = (this.down('right', set) ? 1 : 0) - (this.down('left', set) ? 1 : 0);
    let throttle = this.down('throttle', set) ? 1 : 0;
    let brake = this.down('brake', set) ? 1 : 0;
    let handbrake = this.down('handbrake', set);
    let boost = this.down('boost', set);
    let power = this.down('power', set);
    const p = split ? this.pad(i) : this.pad(0);
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

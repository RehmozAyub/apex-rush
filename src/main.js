// APEX RUSH - boot, menus, game-state machine and main loop.
import * as THREE from 'three';
import { Renderer } from './renderer.js';
import { Input, keyPlayer } from './input.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { Minimap } from './minimap.js';
import { CameraRig } from './camera.js';
import { buildWorld } from './world.js';
import { getAsphalt, prewarm } from './asphalt.js';
import { buildCar, disposeCar } from './carModel.js';
import { RaceSession } from './session.js';
import { MAPS } from './maps/index.js';
import { TrackPath } from './trackMath.js';
import { CARS, PAINTS, QUALITY, QUALITY_ORDER, loadSettings, saveSettings } from './config.js';
import { formatTime } from './race.js';

// setTimeout (not rAF) so loading also progresses when the window is hidden
const IS_DESKTOP = /Electron/i.test(navigator.userAgent);
const nextFrame = () => new Promise((r) => setTimeout(r, 20));

class Game {
  constructor() {
    this.settings = loadSettings();
    this.sel = { track: 0, car: 0, paint: 0 };
    this.sel2 = { car: 4, paint: 4 }; // player 2's pick in split screen
    this.players = 1;
    this.carPick = 0; // whose car is being chosen (2-player mode)
    this.state = 'loading';
    this.menuIndex = { title: 0, pause: 0, results: 0, settings: 0 };
    this.fmt = formatTime;
    this.trackLengths = MAPS.map((m) => new TrackPath(m.layout.points, { width: m.layout.width }).length);
  }

  async init() {
    this.ui = new UI(document.getElementById('ui'));
    const canvas = document.getElementById('gl');
    try {
      this.renderer = new Renderer(canvas, QUALITY[this.settings.quality] || QUALITY.high);
    } catch (e) {
      this.ui.error('WebGL could not start on this PC.<br><br>Update your graphics driver (NVIDIA / Intel) and try again.<br><br><small>' + e.message + '</small>');
      return;
    }
    this.renderer.motionBlur = this.settings.motionBlur;
    this.qualityName = this.settings.quality;
    this.input = new Input();
    this.audio = new AudioEngine();
    this.audio.setVolumes(this.settings.master, this.settings.music);
    this.rigs = this.renderer.cameras.map((c) => new CameraRig(c));
    this.rig = this.rigs[0];
    this.setViews(1);
    const unlock = () => { this.audio.init(); this.audio.setVolumes(this.settings.master, this.settings.music); };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    this.input.on((a, code) => this.onAction(a, code));
    this.bindMouse();

    this.ui.loading(0.1, 'BUILDING SUNSET COAST');
    await nextFrame();
    await this.loadWorld(0, (p, t) => this.ui.loading(0.1 + p * 0.85, t));
    // generate every other track's asphalt on the worker while the player is in the menus
    prewarm(MAPS.map((m) => m.trackStyle.road), this.asphaltSize());
    this.ui.loading(1, 'READY');
    await nextFrame();
    this.showTitle();

    this.time = 0;
    this.fpsAcc = 0; this.fpsFrames = 0; this.slowTime = 0;
    this.renderer.renderer.setAnimationLoop(() => this.frame());
    window.__game = this;
  }

  // --- worlds -------------------------------------------------------------------
  async loadWorld(i, progress = () => {}) {
    if (this.world && this.world.def === MAPS[i]) return;
    this.removeShowroom();
    if (this.world) this.world.dispose();
    this.world = null;
    progress(0.1, `BUILDING ${MAPS[i].name}`);
    const asphalt = await getAsphalt(MAPS[i].trackStyle.road, this.asphaltSize());
    progress(0.4, `BUILDING ${MAPS[i].name}`);
    await nextFrame();
    const world = buildWorld(MAPS[i], this.renderer.renderer, this.renderer.quality, { asphalt });
    progress(0.8, 'COMPILING SHADERS');
    await nextFrame();
    this.world = world;
    if (world.weather) world.weather.onThunder = (v) => this.audio.thunder(Math.max(0.3, v));
    const w = MAPS[i].weather;
    this.audio.setAmbience(w ? (w.type === 'rain' ? 'rain' : 'wind') : null);
    this.renderer.setScene(world.scene, { bloom: MAPS[i].bloom, exposure: MAPS[i].exposure });
    for (const m of this.minimaps) m.setTrack(world.track, MAPS[i].trackStyle.accent);
    this.buildShowroom();
    this.world.update(0, 0, this.showroomCar, this.renderer.camera);
    this.renderer.renderer.compile(world.scene, this.renderer.camera);
    progress(1, 'READY');
  }

  asphaltSize() { return this.renderer.quality.density >= 0.9 ? 'high' : 'low'; }

  buildShowroom() {
    this.removeShowroom();
    const t = this.world.track;
    const p = t.pointAt(t.length - 40, 0);
    const pick = this.pickSel();
    const car = CARS[pick.car];
    const model = buildCar(car.style, PAINTS[pick.paint].hex, { underglow: this.world.def.underglow ? PAINTS[pick.paint].hex : null, number: this.carPick + 1 });
    model.root.position.set(p.x, p.y, p.z);
    model.root.rotation.y = p.heading;
    for (const w of model.wheels) if (w.front) w.group.rotation.y = -0.35;
    this.world.scene.add(model.root);
    this.showroom = model;
    this.showroomCar = { x: p.x, y: p.y, z: p.z, heading: p.heading };
  }

  removeShowroom() {
    if (!this.showroom) return;
    this.showroom.root.parent?.remove(this.showroom.root);
    disposeCar(this.showroom);
    this.showroom = null;
  }

  // --- split screen -------------------------------------------------------------
  // 1 = full screen, 2 = two stacked views each with its own HUD, camera and minimap
  setViews(n) {
    this.renderer.setViewCount(n);
    this.minimaps = this.ui.setViews(n).map((c) => new Minimap(c));
    if (this.world) {
      this.world.setViewCount(n);
      for (const m of this.minimaps) m.setTrack(this.world.track, this.world.def.trackStyle.accent);
    }
    this.renderer.onView = n > 1 ? (i) => {
      const H = this.session && this.session.humans[i];
      if (H) this.world.prepareView(H.car.vehicle, this.renderer.cameras[i]);
    } : null;
    this.minimap = this.minimaps[0];
    for (const r of this.rigs) r.fovScale = n > 1 ? 0.62 : 1;
  }

  pickSel() { return this.carPick === 1 ? this.sel2 : this.sel; }

  // --- screens ------------------------------------------------------------------
  showTitle() {
    this.state = 'title';
    this.ui.show('title');
    this.renderTitle();
    this.audio.playMusic(MAPS[this.sel.track].id);
    this.audio.setMenuMode(true);
  }

  titleItems() {
    const items = [{ label: 'RACE' }, { label: '2 PLAYERS' }, { label: 'HOW TO PLAY' }, { label: 'SETTINGS' }];
    if (IS_DESKTOP) items.push({ label: 'QUIT' });
    return items;
  }

  renderTitle() { this.ui.menu('m-title', this.titleItems(), this.menuIndex.title); }

  showTracks() {
    this.state = 'tracks';
    this.ui.show('tracks');
    this.ui.trackCards(MAPS, this.sel.track, this.trackLengths);
  }

  showCars(pick = 0) {
    this.state = 'cars';
    this.carPick = pick;
    this.ui.show('cars');
    this.refreshCar(false);
  }

  showHowTo() {
    this.state = 'howto';
    this.ui.show('howto');
  }

  settingsItems() {
    const s = this.settings;
    const bar = (v) => '■'.repeat(Math.round(v * 10)) + '□'.repeat(10 - Math.round(v * 10));
    return [
      { label: 'GRAPHICS', value: QUALITY[s.quality].label },
      { label: 'MOTION BLUR', value: s.motionBlur ? 'ON' : 'OFF' },
      { label: 'MASTER VOLUME', value: bar(s.master) },
      { label: 'MUSIC VOLUME', value: bar(s.music) },
      { label: 'FULLSCREEN', value: document.fullscreenElement ? 'ON' : 'OFF' },
      { label: 'BACK' },
    ];
  }

  showSettings(from) {
    this.settingsFrom = from;
    this.state = 'settings';
    this.ui.show('settings');
    this.menuIndex.settings = 0;
    this.renderSettings();
  }

  renderSettings() { this.ui.menu('m-settings', this.settingsItems(), this.menuIndex.settings); }

  changeSetting(i, dir) {
    const s = this.settings;
    if (i === 0) {
      const k = QUALITY_ORDER.indexOf(s.quality);
      s.quality = QUALITY_ORDER[(k + dir + 3) % 3];
      this.applyQuality(s.quality);
    } else if (i === 1) {
      s.motionBlur = !s.motionBlur;
      this.renderer.motionBlur = s.motionBlur;
    } else if (i === 2) s.master = Math.max(0, Math.min(1, Math.round((s.master + dir * 0.1) * 10) / 10));
    else if (i === 3) s.music = Math.max(0, Math.min(1, Math.round((s.music + dir * 0.1) * 10) / 10));
    else if (i === 4) this.toggleFullscreen();
    this.audio.setVolumes(s.master, s.music);
    saveSettings(s);
    this.renderSettings();
    this.audio.blip(700, 0.04, 0.08);
  }

  applyQuality(name) {
    this.qualityName = name;
    this.renderer.setQuality(QUALITY[name]);
    if (this.world) {
      this.renderer.setScene(this.world.scene, { bloom: this.world.def.bloom, exposure: this.world.def.exposure });
      this.world.setShadowQuality(QUALITY[name]);
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
    setTimeout(() => { if (this.state === 'settings') this.renderSettings(); }, 300);
  }

  closeSettings() {
    if (this.settingsFrom === 'pause') { this.state = 'pause'; this.ui.show('pause'); this.ui.overlay('hud', true); this.renderPause(); }
    else this.showTitle();
  }

  pauseItems() { return [{ label: 'RESUME' }, { label: 'RESTART' }, { label: 'SETTINGS' }, { label: 'QUIT TO MENU' }]; }
  renderPause() { this.ui.menu('m-pause', this.pauseItems(), this.menuIndex.pause); }

  resultsItems() { return [{ label: 'RACE AGAIN' }, { label: 'NEXT TRACK' }, { label: 'MAIN MENU' }]; }
  renderResults() { this.ui.menu('m-results', this.resultsItems(), this.menuIndex.results); }

  // --- race ---------------------------------------------------------------------
  async startRace() {
    this.ui.fade(true);
    await new Promise((r) => setTimeout(r, 350));
    await this.loadWorld(this.sel.track);
    this.endSession();
    this.removeShowroom();
    this.carPick = 0;
    this.setViews(this.players);
    const players = [{ carIndex: this.sel.car, paintIndex: this.sel.paint }];
    if (this.players > 1) players.push({ carIndex: this.sel2.car, paintIndex: this.sel2.paint });
    this.session = new RaceSession(this, this.world, { players });
    this.ui.clearPopups();
    this.state = 'race';
    this.ui.show('hud');
    this.audio.setMenuMode(false);
    this.audio.playMusic(MAPS[this.sel.track].id);
    this.slowTime = 0; this.autoDrops = 0;
    this.session.update(0.001);
    this.renderer.renderer.compile(this.world.scene, this.renderer.camera);
    this.ui.fade(false);
  }

  endSession() {
    if (!this.session) return;
    this.session.dispose();
    this.session = null;
    this.audio.silenceEngine();
    for (const fx of this.renderer.fxs) fx.blur = fx.ca = fx.lines = fx.boost = fx.flash = fx.slowmo = 0;
  }

  async quitToMenu() {
    this.ui.fade(true);
    await new Promise((r) => setTimeout(r, 350));
    this.endSession();
    this.setViews(1);
    this.buildShowroom();
    this.ui.overlay('hud', false);
    this.showTitle();
    this.ui.fade(false);
  }

  showResults(list) {
    const me = list.find((r) => r.isPlayer);
    const key = MAPS[this.sel.track].id;
    const e = this.session.race.byId.get('player');
    let record = '';
    if (e.bestLap && (!this.settings.bestLaps[key] || e.bestLap < this.settings.bestLaps[key])) {
      this.settings.bestLaps[key] = e.bestLap;
      saveSettings(this.settings);
      record = ' &nbsp;<small style="color:var(--yellow)">NEW LAP RECORD</small>';
    }
    let head, tds;
    if (this.players > 1) {
      const [a, b] = ['P1', 'P2'].map((n) => list.find((r) => r.name === n));
      head = a.pos < b.pos ? '<b>PLAYER 1</b> WINS' : '<b>PLAYER 2</b> WINS';
      tds = `P1 ${a.takedowns} · P2 ${b.takedowns} TAKEDOWNS`;
    } else {
      head = me.pos === 1 ? '<b>VICTORY</b>' : `<b>P${me.pos}</b> FINISH`;
      tds = `${this.session.takedowns} TAKEDOWNS`;
    }
    this.ui.results(list, `${head} <small style="font-size:3vh;opacity:.8">&nbsp; ${tds}</small>${record}`);
    this.state = 'results';
    this.menuIndex.results = 0;
    this.ui.show('results');
    this.renderResults();
  }

  // --- input ----------------------------------------------------------------------
  onAction(a, code) {
    if (a === 'fullscreen') { this.toggleFullscreen(); return; }
    const st = this.state;
    const move = (key, n, d) => { this.menuIndex[key] = (this.menuIndex[key] + d + n) % n; this.audio.blip(600, 0.03, 0.06); };
    if (st === 'title') {
      if (a === 'up' || a === 'down') { move('title', this.titleItems().length, a === 'up' ? -1 : 1); this.renderTitle(); }
      if (a === 'confirm') this.titleSelect(this.menuIndex.title);
    } else if (st === 'tracks') {
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') {
        const d = a === 'left' ? -1 : a === 'right' ? 1 : a === 'up' ? -3 : 3;
        this.sel.track = (this.sel.track + d + MAPS.length) % MAPS.length;
        this.ui.trackCards(MAPS, this.sel.track, this.trackLengths);
        this.audio.blip(600, 0.03, 0.06);
        this.previewTrack();
      }
      if (a === 'confirm') { this.audio.blip(900, 0.06, 0.1); this.showCars(); }
      if (a === 'back') this.showTitle();
    } else if (st === 'cars') {
      const pick = this.pickSel();
      if (a === 'left' || a === 'right') { pick.car = (pick.car + (a === 'left' ? -1 : 1) + CARS.length) % CARS.length; this.refreshCar(); }
      if (a === 'up' || a === 'down') { pick.paint = (pick.paint + (a === 'up' ? -1 : 1) + PAINTS.length) % PAINTS.length; this.refreshCar(); }
      if (a === 'confirm' && code !== 'Space') this.confirmCar();
      if (a === 'back') { if (this.carPick === 1) this.showCars(0); else this.showTracks(); }
    } else if (st === 'howto') {
      if (a === 'confirm' || a === 'back') this.showTitle();
    } else if (st === 'settings') {
      const n = this.settingsItems().length;
      if (a === 'up' || a === 'down') { move('settings', n, a === 'up' ? -1 : 1); this.renderSettings(); }
      if (a === 'left' || a === 'right') { if (this.menuIndex.settings < n - 1) this.changeSetting(this.menuIndex.settings, a === 'left' ? -1 : 1); }
      if (a === 'confirm') { if (this.menuIndex.settings === n - 1) this.closeSettings(); else this.changeSetting(this.menuIndex.settings, 1); }
      if (a === 'back') this.closeSettings();
    } else if (st === 'race') {
      if (a === 'pause' || a === 'back') { this.state = 'pause'; this.menuIndex.pause = 0; this.ui.show('pause'); this.renderPause(); this.audio.silenceEngine(); }
      if (a === 'camera' || a === 'reset') {
        // whose key was it? (split screen: P1 and P2 have their own camera / reset keys and pads)
        const i = this.players > 1 ? (code.startsWith('pad') ? Number(code.slice(3)) : keyPlayer(a, code)) : 0;
        if (i >= this.players) return;
        if (a === 'camera') this.ui.popup(this.rigs[i].cycle() + ' CAM', '', '', i);
        else this.session.resetPlayer(i);
      }
    } else if (st === 'pause') {
      if (a === 'up' || a === 'down') { move('pause', 4, a === 'up' ? -1 : 1); this.renderPause(); }
      if (a === 'confirm' && code !== 'Space') this.pauseSelect(this.menuIndex.pause);
      if (a === 'back' || a === 'pause') this.pauseSelect(0);
    } else if (st === 'results') {
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') { move('results', 3, a === 'left' || a === 'up' ? -1 : 1); this.renderResults(); }
      if (a === 'confirm' && code !== 'Space') this.resultsSelect(this.menuIndex.results);
    }
  }

  titleSelect(i) {
    this.audio.blip(900, 0.06, 0.1);
    if (i === 0) { this.players = 1; this.showTracks(); }
    else if (i === 1) { this.players = 2; this.showTracks(); }
    else if (i === 2) this.showHowTo();
    else if (i === 3) this.showSettings('title');
    else window.close();
  }

  confirmCar() {
    this.audio.blip(1000, 0.08, 0.12);
    if (this.players > 1 && this.carPick === 0) this.showCars(1);
    else this.startRace();
  }

  pauseSelect(i) {
    if (i === 0) { this.state = 'race'; this.ui.show('hud'); }
    else if (i === 1) this.startRace();
    else if (i === 2) this.showSettings('pause');
    else this.quitToMenu();
  }

  resultsSelect(i) {
    if (i === 0) this.startRace();
    else if (i === 1) { this.sel.track = (this.sel.track + 1) % MAPS.length; this.startRace(); }
    else this.quitToMenu();
  }

  previewTrack() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(async () => {
      if (this.state !== 'tracks' && this.state !== 'cars') return;
      this.ui.fade(true);
      await new Promise((r) => setTimeout(r, 300));
      await this.loadWorld(this.sel.track);
      this.audio.playMusic(MAPS[this.sel.track].id);
      this.ui.fade(false);
    }, 350);
  }

  refreshCar(sound = true) {
    if (sound) this.audio.blip(600, 0.03, 0.06);
    const pick = this.pickSel();
    const who = this.players > 1 ? `PLAYER ${this.carPick + 1}` : '';
    this.ui.carPanel(CARS[pick.car], PAINTS, pick.paint, pick.car, CARS.length, who);
    if (this.world) this.buildShowroom();
  }

  bindMouse() {
    this.ui.onMenuClick('m-title', (i) => { this.menuIndex.title = i; this.titleSelect(i); });
    this.ui.onMenuClick('m-pause', (i) => { this.menuIndex.pause = i; this.pauseSelect(i); });
    this.ui.onMenuClick('m-results', (i) => { this.menuIndex.results = i; this.resultsSelect(i); });
    this.ui.onMenuClick('m-settings', (i) => {
      this.menuIndex.settings = i;
      if (i === this.settingsItems().length - 1) this.closeSettings(); else this.changeSetting(i, 1);
    });
    document.getElementById('cards').addEventListener('click', (e) => {
      const c = e.target.closest('.card');
      if (!c) return;
      const i = Number(c.dataset.i);
      if (i === this.sel.track) this.showCars();
      else { this.sel.track = i; this.ui.trackCards(MAPS, i, this.trackLengths); this.previewTrack(); }
    });
    document.getElementById('swatches').addEventListener('click', (e) => {
      const s = e.target.closest('i');
      if (s) { this.pickSel().paint = Number(s.dataset.i); this.refreshCar(); }
    });
    for (const [k, d] of [[0, -1], [1, 1]]) {
      document.querySelectorAll('.carnav .arrow')[k].addEventListener('click', () => { const p = this.pickSel(); p.car = (p.car + d + CARS.length) % CARS.length; this.refreshCar(); });
    }
    document.getElementById('carname').addEventListener('click', () => this.confirmCar());
    document.getElementById('s-howto').addEventListener('click', () => { if (this.state === 'howto') this.showTitle(); });
  }

  // Debug/testing: advance the race by `frames` fixed steps with optional scripted input, then render once.
  debugStep(frames = 60, controls = null, dt = 1 / 60) {
    if (this.session) this.session.autopilot = controls === 'auto';
    this.input.override = controls === 'auto' ? null : controls;
    for (let i = 0; i < frames; i++) {
      if (this.session && (this.state === 'race' || this.state === 'results')) this.session.update(dt);
    }
    this.input.override = null;
    this.renderer.render(this.time);
    const s = this.session;
    if (!s) return null;
    const v = s.playerVehicle, e = s.race.byId.get('player');
    return { state: s.state, gameState: this.state, speedKmh: Math.round(v.speed * 3.6), lap: s.race.displayLap('player'), pos: s.race.position('player'), s: Math.round(v.s), lateral: +v.lateral.toFixed(1), wrecked: v.wrecked, boost: Math.round(s.boost.boost), takedowns: s.takedowns, progress: Math.round(e.progress) };
  }

  // --- loop -----------------------------------------------------------------------
  frame() {
    const now = performance.now();
    const realDt = Math.min(0.05, (now - (this.lastFrame ?? now)) / 1000);
    this.lastFrame = now;
    this.time += realDt;
    this.input.poll();
    const cam = this.renderer.camera;
    if (this.state === 'race' && this.session) {
      this.session.update(realDt);
      if (this.players > 1) this.world.updateView(1, realDt, this.time, this.renderer.cameras[1]);
      this.watchPerformance(realDt);
    } else if (this.session && (this.state === 'pause' || (this.state === 'settings' && this.settingsFrom === 'pause'))) {
      // frozen
    } else if (this.session && this.state === 'results') {
      this.session.update(realDt);
    } else if (this.world && this.showroomCar) {
      this.rig.updateOrbit(realDt, this.showroomCar, this.time);
      this.world.update(realDt, this.time, this.showroomCar, cam);
      const fx = this.renderer.fx;
      fx.blur = 0; fx.lines = 0; fx.ca = 0; fx.boost = 0; fx.flash = 0; fx.slowmo = 0;
    }
    for (const fx of this.renderer.fxs) fx.weather = this.world ? this.world.flash : 0;
    if (this.session) this.session.fx.setScale(this.renderer.height / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    this.renderer.render(this.time);
  }

  // drop graphics quality automatically if the frame rate stays low
  watchPerformance(dt) {
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc < 1) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.fps = fps;
    if (fps < 38) this.slowTime++; else this.slowTime = 0;
    if (this.slowTime >= 3 && this.autoDrops < 2) {
      const k = QUALITY_ORDER.indexOf(this.qualityName);
      if (k > 0) {
        this.applyQuality(QUALITY_ORDER[k - 1]);
        this.ui.popup('GRAPHICS', QUALITY[this.qualityName].label, '');
        this.autoDrops++;
      }
      this.slowTime = 0;
    }
  }
}

new Game().init();

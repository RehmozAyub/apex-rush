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
import { CARS, PAINTS, QUALITY, QUALITY_ORDER, QUALITY_CHOICES, IS_MOBILE, IS_APP, STEERING, STEERING_LABEL, autoQuality, loadSettings, saveSettings } from './config.js';
import { formatTime } from './race.js';
import { recordRace, discoverSignature, unlockedPaints, unlockText, STARS } from './progress.js';
import { SIGNATURE_KINDS } from './signatures.js';
import { OnlineFlow } from './onlineMenu.js';
import { TouchControls } from './touch.js';

// setTimeout (not rAF) so loading also progresses when the window is hidden
const IS_DESKTOP = /Electron/i.test(navigator.userAgent);
const nextFrame = () => new Promise((r) => setTimeout(r, 20));

// the GPU's name (for GRAPHICS AUTO), from a throwaway context
function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return name;
  } catch {
    return '';
  }
}

class Game {
  constructor() {
    this.settings = loadSettings();
    this.sel = { track: 0, car: 0, paint: 0 }; // track === MAPS.length means RANDOM
    this.raceTrack = 0; // the track actually raced (resolved from a RANDOM pick)
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
    this.onlineFlow = new OnlineFlow(this);
    const canvas = document.getElementById('gl');
    this.gpu = gpuName();
    this.gpuKey = `${IS_MOBILE ? 'mobile' : 'desktop'} ${this.gpu}`;
    this.qualityName = this.resolveQuality();
    try {
      this.renderer = new Renderer(canvas, QUALITY[this.qualityName]);
    } catch (e) {
      this.ui.error(`WebGL could not start on this ${IS_MOBILE ? 'device' : 'PC'}.<br><br>Update your graphics driver${IS_MOBILE ? ' / Android System WebView' : ' (NVIDIA / Intel)'} and try again.<br><br><small>${e.message}</small>`);
      return;
    }
    this.renderer.motionBlur = this.settings.motionBlur;
    this.input = new Input();
    if (navigator.maxTouchPoints > 0) {
      this.touch = new TouchControls(document.getElementById('ui'), (a) => this.input.emit(a, 'touch'));
      this.touch.setMode(this.settings.steering);
      this.input.touch = this.touch;
    }
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
    this.bindDevice();

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
    const model = buildCar(car.style, PAINTS[pick.paint].hex, { underglow: this.world.def.underglow ? PAINTS[pick.paint].hex : null, number: this.carPick + 1, finish: PAINTS[pick.paint].finish });
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
      if (H && this.world) this.world.prepareView(H.car.vehicle, this.renderer.cameras[i]);
    } : null;
    this.minimap = this.minimaps[0];
    for (const r of this.rigs) r.fovScale = n > 1 ? 0.62 : 1;
  }

  pickSel() { return this.carPick === 1 ? this.sel2 : this.sel; }

  // --- progress: stars, signature takedowns, earned paints ------------------------------
  trackProgress() {
    const P = this.settings.progress;
    return MAPS.map((m) => ({ stars: P.stars[m.id] || [false, false, false], sigs: (P.signatures[m.id] || []).length, sigTotal: SIGNATURE_KINDS.length }));
  }

  paintOpen() { return unlockedPaints(this.settings.progress, PAINTS); }

  // a player scored a signature takedown; the first time, snap a photo of the crash
  onSignature(i, sig, mapId) {
    if (!discoverSignature(this.settings.progress, mapId, sig.id)) return;
    saveSettings(this.settings);
    const found = this.settings.progress.signatures[mapId].length;
    this.pendingShot = { i, sig, found, t: 0.55 };
  }

  // copy player i's part of the frame that was just rendered into a small JPEG
  captureView(i) {
    const src = this.renderer.renderer.domElement;
    const n = this.renderer.viewCount;
    const sw = src.width, sh = src.height / n;
    const c = this.shotCanvas || (this.shotCanvas = document.createElement('canvas'));
    c.width = 480;
    c.height = Math.round((480 * sh) / sw);
    c.getContext('2d').drawImage(src, 0, i * sh, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  // --- screens ------------------------------------------------------------------
  // the map on screen (menus) - RANDOM keeps whatever is loaded
  shownMap() { return this.world ? this.world.def : MAPS[0]; }

  randomPick() { return this.sel.track === MAPS.length; }

  // choose a random track, never the one just raced
  rollTrack() {
    const pool = MAPS.map((m, i) => i).filter((i) => i !== this.raceTrack);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  showTitle() {
    this.state = 'title';
    this.ui.show('title');
    this.renderTitle();
    this.audio.playMusic(this.shownMap().id);
    this.audio.setMenuMode(true);
  }

  titleItems() {
    const items = [{ key: 'race', label: 'RACE' }];
    if (!IS_MOBILE) items.push({ key: 'split', label: '2 PLAYERS' }); // split screen needs a keyboard or two pads
    items.push({ key: 'online', label: 'ONLINE' }, { key: 'howto', label: 'HOW TO PLAY' }, { key: 'settings', label: 'SETTINGS' });
    if (IS_DESKTOP) items.push({ key: 'quit', label: 'QUIT' });
    return items;
  }

  renderTitle() { this.ui.menu('m-title', this.titleItems(), this.menuIndex.title); }

  showTracks() {
    this.state = 'tracks';
    this.ui.show('tracks');
    this.ui.trackCards(MAPS, this.sel.track, this.trackLengths, this.trackProgress());
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
    const onOff = (v) => (v ? 'ON' : 'OFF');
    const items = [{ key: 'assist', label: 'DRIVE ASSIST', value: onOff(s.assist) }];
    if (!IS_MOBILE) items.push({ key: 'assist2', label: 'DRIVE ASSIST · PLAYER 2', value: onOff(s.assist2) });
    if (this.touch) items.push({ key: 'steering', label: 'STEERING', value: STEERING_LABEL[s.steering] });
    items.push(
      { key: 'quality', label: 'GRAPHICS', value: s.quality === 'auto' ? `AUTO · ${QUALITY[this.qualityName].label}` : QUALITY[s.quality].label },
      { key: 'motionBlur', label: 'MOTION BLUR', value: onOff(s.motionBlur) },
      { key: 'master', label: 'MASTER VOLUME', value: bar(s.master) },
      { key: 'music', label: 'MUSIC VOLUME', value: bar(s.music) },
    );
    if (this.touch) items.push({ key: 'vibration', label: 'VIBRATION', value: onOff(s.vibration) });
    if (!IS_APP) items.push({ key: 'fullscreen', label: 'FULLSCREEN', value: onOff(document.fullscreenElement) });
    items.push({ key: 'back', label: 'BACK' });
    return items;
  }

  assistOn(i) { return i === 0 ? this.settings.assist : this.settings.assist2; }

  setAssist(i, on) {
    this.settings[i === 0 ? 'assist' : 'assist2'] = on;
    saveSettings(this.settings);
    if (this.session) this.session.setAssist(i, on);
  }

  // in-race toggle (H / [ / gamepad Back)
  toggleAssist(i) {
    const on = !this.assistOn(i);
    this.setAssist(i, on);
    this.ui.popup(on ? 'DRIVE ASSIST ON' : 'DRIVE ASSIST OFF', on ? 'WALL + CORNER HELP' : 'FULL MANUAL CONTROL', '', i);
    this.audio.blip(on ? 900 : 500, 0.06, 0.1);
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
    const key = this.settingsItems()[i].key;
    if (key === 'assist' || key === 'assist2') this.setAssist(key === 'assist' ? 0 : 1, !s[key]);
    else if (key === 'quality') {
      const n = QUALITY_CHOICES.length, k = QUALITY_CHOICES.indexOf(s.quality);
      s.quality = QUALITY_CHOICES[(k + dir + n) % n];
      this.applyQuality(this.resolveQuality());
    } else if (key === 'steering') {
      const k = STEERING.indexOf(s.steering);
      s.steering = STEERING[(k + dir + STEERING.length) % STEERING.length];
      if (s.steering === 'tilt') TouchControls.askMotion(); // iOS: must happen inside this tap
      this.touch.setMode(s.steering);
    } else if (key === 'vibration') {
      s.vibration = !s.vibration;
      if (s.vibration) this.buzz(40, 200);
    } else if (key === 'motionBlur') {
      s.motionBlur = !s.motionBlur;
      this.renderer.motionBlur = s.motionBlur;
    } else if (key === 'master') s.master = Math.max(0, Math.min(1, Math.round((s.master + dir * 0.1) * 10) / 10));
    else if (key === 'music') s.music = Math.max(0, Math.min(1, Math.round((s.music + dir * 0.1) * 10) / 10));
    else if (key === 'fullscreen') this.toggleFullscreen();
    this.audio.setVolumes(s.master, s.music);
    saveSettings(s);
    this.renderSettings();
    this.audio.blip(700, 0.04, 0.08);
  }

  // the level GRAPHICS runs at; AUTO = the level it has settled on for this device
  resolveQuality() {
    const s = this.settings;
    if (s.quality !== 'auto') return QUALITY[s.quality] ? s.quality : 'high';
    // remembered per GPU: the exe can wake up on the integrated GPU one day and the discrete one the next
    if (!s.autoQ || !QUALITY[s.autoQ.level] || s.autoQ.gpu !== this.gpuKey) s.autoQ = { level: autoQuality(this.gpu), ceil: 'high', gpu: this.gpuKey };
    return s.autoQ.level;
  }

  // GRAPHICS AUTO: a race that ran smoothly tries the next level up (never above one it had to
  // drop from)
  autoUpgrade() {
    const s = this.settings, f = this.raceFps;
    if (s.quality !== 'auto' || !s.autoQ || this.autoDrops || !f || f.n < 30) return;
    const k = QUALITY_ORDER.indexOf(s.autoQ.level);
    if (f.sum / f.n >= 57 && k < QUALITY_ORDER.indexOf(s.autoQ.ceil)) {
      s.autoQ.level = QUALITY_ORDER[k + 1];
      saveSettings(s);
      this.applyQuality(s.autoQ.level);
    }
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

  pauseItems() {
    if (this.session && this.session.online) return this.onlineFlow.pauseItems(); // the race goes on
    const onOff = (v) => (v ? 'ON' : 'OFF');
    const items = [{ key: 'resume', label: 'RESUME' }];
    if (this.players > 1) {
      items.push({ key: 'assist0', label: 'P1 DRIVE ASSIST', value: onOff(this.assistOn(0)) });
      items.push({ key: 'assist1', label: 'P2 DRIVE ASSIST', value: onOff(this.assistOn(1)) });
    } else items.push({ key: 'assist0', label: 'DRIVE ASSIST', value: onOff(this.assistOn(0)) });
    items.push({ key: 'restart', label: 'RESTART' }, { key: 'settings', label: 'SETTINGS' }, { key: 'quit', label: 'QUIT TO MENU' });
    return items;
  }
  renderPause() { this.ui.menu('m-pause', this.pauseItems(), this.menuIndex.pause); }

  resultsItems() {
    if (this.session && this.session.online) return this.onlineFlow.resultsItems();
    return [{ label: 'RACE AGAIN' }, { label: 'NEXT TRACK' }, { label: 'MAIN MENU' }];
  }
  renderResults() { this.ui.menu('m-results', this.resultsItems(), this.menuIndex.results); }

  // --- race ---------------------------------------------------------------------
  // reroll: pick the track again (a RANDOM pick rolls a new one); false = same track again
  // online: { net: { role, seed }, players: [host pick, guest pick], random } (see onlineMenu.js)
  async startRace(reroll = true, online = null) {
    if (reroll) this.raceTrack = this.randomPick() ? this.rollTrack() : this.sel.track;
    this.ui.fade(true);
    await new Promise((r) => setTimeout(r, 350));
    this.state = 'loading'; // nothing touches the old session / world while the next one loads
    await this.loadWorld(this.raceTrack);
    this.endSession();
    this.removeShowroom();
    this.carPick = 0;
    if (online) this.players = 1;
    this.setViews(this.players);
    let players = [{ carIndex: this.sel.car, paintIndex: this.sel.paint }];
    if (this.players > 1) players.push({ carIndex: this.sel2.car, paintIndex: this.sel2.paint });
    if (online) players = online.players;
    this.session = new RaceSession(this, this.world, { players, net: online ? online.net : null });
    this.ui.clearPopups();
    this.state = 'race';
    this.ui.show('hud');
    this.audio.setMenuMode(false);
    this.audio.playMusic(MAPS[this.raceTrack].id);
    this.slowTime = 0; this.autoDrops = 0; this.raceFps = { sum: 0, n: 0 };
    this.session.update(0.001);
    if (online ? online.random : this.randomPick()) this.session.popupAll(MAPS[this.raceTrack].name, 'RANDOM TRACK', 'hot');
    this.renderer.renderer.compile(this.world.scene, this.renderer.camera);
    this.ui.fade(false);
  }

  endSession() {
    this.pendingShot = null;
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
    const online = this.session.online;
    if (online && this.onlineFlow.role === 'host') this.onlineFlow.sendResults(list);
    if (online && this.onlineFlow.lastResults) list = this.onlineFlow.lastResults; // the host's are official
    const me = list.find((r) => r.isPlayer);
    const key = MAPS[this.raceTrack].id;
    const e = this.session.race.byId.get('player');
    let record = '';
    if (e.bestLap && (!this.settings.bestLaps[key] || e.bestLap < this.settings.bestLaps[key])) {
      this.settings.bestLaps[key] = e.bestLap;
      saveSettings(this.settings);
      record = ' &nbsp;<small style="color:var(--yellow)">NEW LAP RECORD</small>';
    }
    let head, tds;
    if (online) {
      head = this.onlineFlow.headline(list);
      tds = `${this.session.takedowns} TAKEDOWNS`;
    } else if (this.players > 1) {
      const [a, b] = ['P1', 'P2'].map((n) => list.find((r) => r.name === n));
      head = a.pos < b.pos ? '<b>PLAYER 1</b> WINS' : '<b>PLAYER 2</b> WINS';
      tds = `P1 ${a.takedowns} · P2 ${b.takedowns} TAKEDOWNS`;
    } else {
      head = me.pos === 1 ? '<b>VICTORY</b>' : `<b>P${me.pos}</b> FINISH`;
      tds = `${this.session.takedowns} TAKEDOWNS`;
    }
    // stars and earned paints
    const extras = [];
    for (const st of this.session.humanStats()) {
      if (!st.finished) { this.settings.progress.totalTakedowns += st.takedowns; continue; }
      const got = recordRace(this.settings.progress, key, st, PAINTS);
      const who = this.players > 1 ? `P${st.index + 1} ` : '';
      for (const k of got.stars) extras.push(`★ ${who}${STARS[k].name}`);
      for (const p of got.paints) extras.push(`NEW PAINT: ${p.name.toUpperCase()}`);
    }
    saveSettings(this.settings);
    this.autoUpgrade();
    this.ui.results(list, `${head} <small style="font-size:3vh;opacity:.8">&nbsp; ${tds}</small>${record}`, extras);
    this.resultsFinished = this.session.race.finishOrder.length;
    this.state = 'results';
    this.menuIndex.results = online && this.onlineFlow.role !== 'host' ? 0 : 1; // NEXT TRACK is the default (an online guest waits for the host)
    this.ui.show('results');
    this.renderResults();
  }

  // --- input ----------------------------------------------------------------------
  onAction(a, code) {
    if (a === 'fullscreen') { this.toggleFullscreen(); return; }
    if (a === 'notilt') { this.ui.popup('NO TILT SENSOR', 'SLIDE YOUR LEFT THUMB TO STEER', 'bad'); return; }
    const st = this.state;
    if (this.onlineFlow.handles(st)) { this.onlineFlow.onAction(a, code); return; }
    const move = (key, n, d) => { this.menuIndex[key] = (this.menuIndex[key] + d + n) % n; this.audio.blip(600, 0.03, 0.06); };
    if (st === 'title') {
      if (a === 'up' || a === 'down') { move('title', this.titleItems().length, a === 'up' ? -1 : 1); this.renderTitle(); }
      if (a === 'confirm') this.titleSelect(this.menuIndex.title);
    } else if (st === 'tracks') {
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') {
        // six cards in a 3x2 grid, then the RANDOM bar underneath (index MAPS.length)
        const n = MAPS.length, t = this.sel.track;
        if (a === 'left' || a === 'right') this.sel.track = (t + (a === 'left' ? -1 : 1) + n + 1) % (n + 1);
        else if (t === n) this.sel.track = a === 'up' ? n - 2 : 1;
        else if (a === 'down') this.sel.track = t + 3 < n ? t + 3 : n;
        else this.sel.track = t - 3 >= 0 ? t - 3 : n;
        this.ui.trackCards(MAPS, this.sel.track, this.trackLengths, this.trackProgress());
        this.audio.blip(600, 0.03, 0.06);
        this.previewTrack();
      }
      if (a === 'confirm') { this.audio.blip(900, 0.06, 0.1); this.showCars(); }
      if (a === 'back') this.showTitle();
    } else if (st === 'cars') {
      const pick = this.pickSel();
      if (a === 'left' || a === 'right') { pick.car = (pick.car + (a === 'left' ? -1 : 1) + CARS.length) % CARS.length; this.refreshCar(); }
      if (a === 'up' || a === 'down') {
        const open = this.paintOpen();
        let p = pick.paint;
        do p = (p + (a === 'up' ? -1 : 1) + PAINTS.length) % PAINTS.length; while (!open[p]);
        pick.paint = p;
        this.refreshCar();
      }
      if (a === 'confirm' && code !== 'Space') this.confirmCar();
      if (a === 'back') { if (this.onlineFlow.active) this.onlineFlow.carChosen(); else if (this.carPick === 1) this.showCars(0); else this.showTracks(); }
    } else if (st === 'howto') {
      if (a === 'confirm' || a === 'back') this.showTitle();
    } else if (st === 'settings') {
      const items = this.settingsItems(), n = items.length;
      const onBack = items[this.menuIndex.settings].key === 'back';
      if (a === 'up' || a === 'down') { move('settings', n, a === 'up' ? -1 : 1); this.renderSettings(); }
      if (a === 'left' || a === 'right') { if (!onBack) this.changeSetting(this.menuIndex.settings, a === 'left' ? -1 : 1); }
      if (a === 'confirm') { if (onBack) this.closeSettings(); else this.changeSetting(this.menuIndex.settings, 1); }
      if (a === 'back') this.closeSettings();
    } else if (st === 'race') {
      if (a === 'pause' || a === 'back') { this.state = 'pause'; this.menuIndex.pause = 0; this.ui.show('pause'); this.renderPause(); this.audio.silenceEngine(); }
      if (a === 'camera' || a === 'reset' || a === 'assist') {
        // whose key was it? (split screen: P1 and P2 have their own camera / reset keys and pads)
        const i = this.players > 1 ? (code.startsWith('pad') ? Number(code.slice(3)) : keyPlayer(a, code)) : 0;
        if (i >= this.players) return;
        if (a === 'camera') this.ui.popup(this.rigs[i].cycle() + ' CAM', '', '', i);
        else if (a === 'assist') this.toggleAssist(i);
        else this.session.resetPlayer(i);
      }
    } else if (st === 'pause') {
      const items = this.pauseItems();
      if (a === 'up' || a === 'down') { move('pause', items.length, a === 'up' ? -1 : 1); this.renderPause(); }
      if ((a === 'left' || a === 'right') && items[this.menuIndex.pause].key.startsWith('assist')) this.pauseSelect(this.menuIndex.pause);
      if (a === 'confirm' && code !== 'Space') this.pauseSelect(this.menuIndex.pause);
      if (a === 'back' || a === 'pause') this.pauseSelect(0);
    } else if (st === 'results') {
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') { move('results', this.resultsItems().length, a === 'left' || a === 'up' ? -1 : 1); this.renderResults(); }
      if (a === 'confirm' && code !== 'Space') this.resultsSelect(this.menuIndex.results);
    }
  }

  titleSelect(i) {
    this.audio.blip(900, 0.06, 0.1);
    const key = this.titleItems()[i].key;
    if (key === 'race') { this.players = 1; this.showTracks(); }
    else if (key === 'split') { this.players = 2; this.showTracks(); }
    else if (key === 'online') this.onlineFlow.open();
    else if (key === 'howto') this.showHowTo();
    else if (key === 'settings') this.showSettings('title');
    else window.close();
  }

  confirmCar() {
    this.audio.blip(1000, 0.08, 0.12);
    if (this.onlineFlow.active) { this.onlineFlow.carChosen(); return; }
    if (this.players > 1 && this.carPick === 0) this.showCars(1);
    else this.startRace();
  }

  pauseSelect(i) {
    const key = this.pauseItems()[i].key;
    if (key === 'resume') { this.state = 'race'; this.ui.show('hud'); }
    else if (key.startsWith('assist')) {
      const p = Number(key.slice(6));
      this.setAssist(p, !this.assistOn(p));
      this.audio.blip(700, 0.04, 0.08);
      this.renderPause();
    } else if (key === 'restart') this.startRace(false);
    else if (key === 'settings') this.showSettings('pause');
    else if (this.session && this.session.online) this.onlineFlow.leave();
    else this.quitToMenu();
  }

  resultsSelect(i) {
    if (this.session && this.session.online) { this.onlineFlow.resultsSelect(i); return; }
    if (i === 0) this.startRace(false);
    else if (i === 1) {
      // NEXT TRACK: the next card, or another random track when RANDOM was picked
      if (!this.randomPick()) this.sel.track = (this.raceTrack + 1) % MAPS.length;
      this.startRace(true);
    } else this.quitToMenu();
  }

  previewTrack() {
    clearTimeout(this.previewTimer);
    if (this.randomPick()) return; // RANDOM: keep the current scenery, the pick happens at the start
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
    if (!this.paintOpen()[pick.paint]) pick.paint = 0;
    this.ui.carPanel(CARS[pick.car], PAINTS, pick.paint, pick.car, CARS.length, who, this.paintOpen(), unlockText);
    if (this.world) this.buildShowroom();
  }

  bindMouse() {
    this.ui.onMenuClick('m-title', (i) => { this.menuIndex.title = i; this.titleSelect(i); });
    this.ui.onMenuClick('m-pause', (i) => { this.menuIndex.pause = i; this.pauseSelect(i); });
    this.ui.onMenuClick('m-results', (i) => { this.menuIndex.results = i; this.resultsSelect(i); });
    this.ui.onMenuClick('m-settings', (i, e) => {
      this.menuIndex.settings = i;
      if (this.settingsItems()[i].key === 'back') { this.closeSettings(); return; }
      // tapping the left half of a value steps it back (volume down, previous option)
      const em = e.target.closest('em'), r = em && em.getBoundingClientRect();
      this.changeSetting(i, r && e.clientX < (r.left + r.right) / 2 ? -1 : 1);
    });
    // touch screens: the BACK / NEXT / RACE corner buttons
    document.getElementById('ui').addEventListener('click', (e) => {
      const b = e.target.closest('.tnav b');
      if (b) this.onAction(b.dataset.a, 'touch');
    });
    document.getElementById('cards').addEventListener('click', (e) => {
      const c = e.target.closest('.card');
      if (!c) return;
      const i = Number(c.dataset.i);
      if (i === this.sel.track) this.showCars();
      else { this.sel.track = i; this.ui.trackCards(MAPS, i, this.trackLengths, this.trackProgress()); this.previewTrack(); }
    });
    document.getElementById('swatches').addEventListener('click', (e) => {
      const s = e.target.closest('i');
      if (!s) return;
      const i = Number(s.dataset.i);
      if (!this.paintOpen()[i]) { document.getElementById('paintname').textContent = `LOCKED · ${unlockText(PAINTS[i])}`; this.audio.blip(300, 0.06, 0.08); return; }
      this.pickSel().paint = i;
      this.refreshCar();
    });
    for (const [k, d] of [[0, -1], [1, 1]]) {
      document.querySelectorAll('.carnav .arrow')[k].addEventListener('click', () => { const p = this.pickSel(); p.car = (p.car + d + CARS.length) % CARS.length; this.refreshCar(); });
    }
    document.getElementById('carname').addEventListener('click', () => this.confirmCar());
    // a click anywhere closes How to Play (not a tap: on a phone the page scrolls, BACK closes it)
    document.getElementById('s-howto').addEventListener('click', () => { if (this.state === 'howto' && this.input.lastDevice !== 'touch') this.showTitle(); });
  }

  // --- phones -----------------------------------------------------------------------
  bindDevice() {
    // the Android app's back button: false = not used here (title screen), so the app closes
    window.__apexBack = () => {
      if (this.state === 'title') return false;
      if (this.state === 'results') this.quitToMenu();
      else if (this.state !== 'loading') this.onAction('back', 'android');
      return true;
    };
    // switching away from the game (app to background, phone call): pause and mute
    window.__apexPause = () => this.toBackground();
    if (IS_MOBILE) document.addEventListener('visibilitychange', () => { if (document.hidden) this.toBackground(); else this.audio.resume(); });
    // phone browser: the first tap goes fullscreen and locks landscape where the browser allows it
    if (IS_MOBILE && !IS_APP && document.documentElement.requestFullscreen) {
      window.addEventListener('pointerup', () => {
        if (document.fullscreenElement) return;
        document.documentElement.requestFullscreen({ navigationUI: 'hide' })
          .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
          .catch(() => {});
      }, { once: true });
    }
    // Android app: keep the HUD clear of the camera cutout
    if (window.ApexAndroid) {
      const insets = () => {
        const [l, t, r, b] = String(window.ApexAndroid.insets()).split(',').map((v) => Number(v) || 0);
        const st = document.documentElement.style;
        st.setProperty('--sl', `${l}px`); st.setProperty('--st', `${t}px`); st.setProperty('--sr', `${r}px`); st.setProperty('--sb', `${b}px`);
      };
      insets();
      window.addEventListener('resize', insets);
      for (const ms of [300, 1000, 2500]) setTimeout(insets, ms);
    }
  }

  toBackground() {
    if (this.state === 'race') this.onAction('pause', 'android');
    this.audio.suspend();
  }

  // phone vibration for player 1's knocks, crashes and takedowns (amount: like camera shake, 0-1.5)
  haptic(H, amount) {
    if (!H || H.index !== 0 || !this.settings.vibration || this.input.lastDevice !== 'touch') return;
    const now = performance.now();
    if (now < (this.buzzUntil || 0)) return;
    const a = Math.min(1.5, amount), ms = Math.round(8 + a * 45);
    this.buzzUntil = now + ms + 40;
    this.buzz(ms, Math.round(70 + Math.min(1, a) * 185));
  }

  buzz(ms, strength = 180) {
    if (window.ApexAndroid) window.ApexAndroid.vibrate(ms, strength);
    else if (navigator.vibrate) navigator.vibrate(ms);
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
      // frozen (online the race can't stop: the car brakes while the menu is open)
      if (this.session.online) this.session.update(realDt);
    } else if (this.session && this.state === 'results') {
      this.session.update(realDt);
      // rivals still crossing the line: fill in their times
      const n = this.session.race.finishOrder.length;
      if (n !== this.resultsFinished) {
        this.resultsFinished = n;
        const list = this.session.results();
        if (this.session.online && this.onlineFlow.role === 'host') this.onlineFlow.sendResults(list);
        if (!(this.session.online && this.onlineFlow.lastResults)) this.ui.resultRows(list);
      }
    } else if (this.world && this.showroomCar) {
      this.rig.updateOrbit(realDt, this.showroomCar, this.time);
      this.world.update(realDt, this.time, this.showroomCar, cam);
      const fx = this.renderer.fx;
      fx.blur = 0; fx.lines = 0; fx.ca = 0; fx.boost = 0; fx.flash = 0; fx.slowmo = 0;
    }
    this.onlineFlow.frame();
    if (this.touch) {
      const H = this.state === 'race' && this.session && this.players === 1 ? this.session.humans[0] : null;
      this.touch.setActive(!!H);
      this.touch.calibrate(!H || this.session.state === 'countdown'); // tilt: "straight" = how you hold it at the start
      this.touch.update(H);
    }
    for (const fx of this.renderer.fxs) fx.weather = this.world ? this.world.flash : 0;
    if (this.session) this.session.fx.setScale(this.renderer.height / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    this.renderer.render(this.time);
    const shot = this.pendingShot;
    if (shot && this.state === 'race' && (shot.t -= realDt) <= 0) {
      this.pendingShot = null;
      this.ui.signatureCard(shot.i, this.captureView(shot.i), shot.sig.name, shot.sig.line, shot.found, SIGNATURE_KINDS.length);
      this.audio.chime(5);
    }
  }

  // drop graphics quality automatically if the frame rate stays low
  watchPerformance(dt) {
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc < 1) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.fps = fps;
    if (this.raceFps) { this.raceFps.sum += Math.min(fps, 60); this.raceFps.n++; }
    // AUTO aims for a smooth frame rate; a fixed level only steps down when it really struggles
    const auto = this.settings.quality === 'auto';
    if (fps < (auto ? 48 : 38)) this.slowTime++; else this.slowTime = 0;
    if (this.slowTime >= (auto ? 4 : 3) && this.autoDrops < 2) {
      const k = QUALITY_ORDER.indexOf(this.qualityName);
      if (k > 0) {
        this.applyQuality(QUALITY_ORDER[k - 1]);
        this.ui.popup('GRAPHICS', QUALITY[this.qualityName].label, '');
        this.autoDrops++;
        // AUTO remembers it: start here next time and don't climb back above it
        if (auto) { this.settings.autoQ = { level: this.qualityName, ceil: this.qualityName, gpu: this.gpuKey }; saveSettings(this.settings); }
      }
      this.slowTime = 0;
    }
  }
}

new Game().init();

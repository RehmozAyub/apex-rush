// Web Audio synthesis: engine, tyre squeal, wind, impacts, boost, UI blips and a synthwave
// music sequencer. No audio files.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const RACE_CUTOFF = 4200; // music low-pass in races (the menus use 1400)
// engine character per car style: pitch and how throaty the firing pulses are
const ENGINE_TONE = {
  wedge: { pitch: 1.0, burble: 0.35 }, gt: { pitch: 0.9, burble: 0.3 }, hatch: { pitch: 1.14, burble: 0.25 },
  muscle: { pitch: 0.78, burble: 0.55 }, hyper: { pitch: 1.1, burble: 0.28 }, rally: { pitch: 1.05, burble: 0.4 },
};

// Each track: tempo, root note and four 7th chords (semitones from the root), one per bar.
const SONGS = {
  coast: { bpm: 100, root: 53, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]], bright: 0.8 }, // F: Imaj7 vi7 IVmaj7 V7
  city: { bpm: 116, root: 54, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]], bright: 0.9 }, // F#m: i7 VImaj7 IIImaj7 VII
  alpine: { bpm: 110, root: 50, chords: [[0, 4, 7, 11], [-5, -1, 2, 6], [-3, 0, 4, 7], [5, 9, 12, 16]], bright: 0.9 }, // D: I V vi IV
  snow: { bpm: 100, root: 52, chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [5, 8, 12, 15], [-2, 2, 5, 9]], bright: 0.7 }, // Em: i7 VImaj7 iv7 VII
  canyon: { bpm: 106, root: 55, chords: [[0, 4, 7, 11], [-2, 2, 5, 9], [5, 9, 12, 16], [0, 4, 7, 11]], bright: 0.8 }, // G: I bVII IV I
  jungle: { bpm: 118, root: 50, chords: [[0, 3, 7, 10], [5, 9, 12, 15], [0, 3, 7, 10], [-2, 2, 5, 9]], bright: 0.75 }, // D dorian: i7 IV7 i7 VII
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = 0.8;
    this.musicVol = 0.55;
    this.song = SONGS.coast;
    this.musicOn = false;
    this.step = 0;
    this.nextTime = 0;
    this.intensity = 0; // final lap: faster, busier music
  }

  setIntensity(k) {
    if (k === this.intensity) return;
    this.intensity = k;
    if (k > 0) this.whoosh(true, 0.35);
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.out = ctx.createDynamicsCompressor();
    this.out.threshold.value = -14;
    this.out.ratio.value = 4;
    this.out.connect(ctx.destination);
    // take the edge off everything: gentle high-shelf cut before the limiter
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.shelf.frequency.value = 5000;
    this.shelf.gain.value = -5;
    this.shelf.connect(this.out);
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.master;
    this.masterGain.connect(this.shelf);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.masterGain);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVol * 0.5;
    this.musicFilter.connect(this.musicGain);
    this.musicGain.connect(this.masterGain);
    // echo for the arp
    this.delay = ctx.createDelay(1);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.3;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.musicFilter);
    // small synthetic room reverb for the pads and lead
    this.reverb = ctx.createConvolver();
    const rl = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < rl; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.musicFilter);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.engines = [];
    this.timer = setInterval(() => this.schedule(), 25);
    if (this.pendingAmbience) { this.setAmbience(this.pendingAmbience); this.pendingAmbience = null; }
  }

  setVolumes(master, music) {
    this.master = master;
    this.musicVol = music;
    if (!this.ctx) return;
    this.masterGain.gain.setTargetAtTime(master, this.ctx.currentTime, 0.05);
    this.musicGain.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.05);
  }

  noise(loop = true) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = loop;
    return n;
  }

  // One synthesized engine (plus tyres, wind, boost) per human player.
  buildEngine() {
    const ctx = this.ctx;
    const e = {};
    e.gain = ctx.createGain();
    e.gain.gain.value = 0;
    e.filter = ctx.createBiquadFilter();
    e.filter.type = 'lowpass';
    e.filter.Q.value = 0.9;
    e.filter2 = ctx.createBiquadFilter();
    e.filter2.type = 'lowpass';
    e.filter2.Q.value = 0.5;
    e.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 1.5); }
    e.shaper.curve = curve;
    e.o1 = ctx.createOscillator(); e.o1.type = 'sawtooth';
    e.o2 = ctx.createOscillator(); e.o2.type = 'triangle';
    e.o3 = ctx.createOscillator(); e.o3.type = 'sine';
    const g1 = ctx.createGain(); g1.gain.value = 0.32;
    const g2 = ctx.createGain(); g2.gain.value = 0.6;
    const g3 = ctx.createGain(); g3.gain.value = 0.22;
    e.o1.connect(g1); e.o2.connect(g2); e.o3.connect(g3);
    g1.connect(e.shaper); g2.connect(e.shaper); g3.connect(e.shaper);
    // sub an octave down for weight, and a slightly detuned saw for thickness
    e.o4 = ctx.createOscillator(); e.o4.type = 'sine';
    e.o5 = ctx.createOscillator(); e.o5.type = 'sawtooth'; e.o5.detune.value = 14;
    const g4 = ctx.createGain(); g4.gain.value = 0.45;
    const g5 = ctx.createGain(); g5.gain.value = 0.2;
    e.o4.connect(g4); e.o5.connect(g5); g4.connect(e.shaper); g5.connect(e.shaper);
    e.shaper.connect(e.filter);
    e.filter.connect(e.filter2);
    // firing pulses: the level throbs at the firing rate, strongest at idle (the burble)
    e.am = ctx.createGain(); e.am.gain.value = 0.7;
    e.pulse = ctx.createOscillator(); e.pulse.type = 'sine';
    e.pulseDepth = ctx.createGain(); e.pulseDepth.gain.value = 0.3;
    e.pulse.connect(e.pulseDepth); e.pulseDepth.connect(e.am.gain);
    e.filter2.connect(e.am);
    e.am.connect(e.gain);
    e.rev = 0.18; e.lastT = ctx.currentTime; e.lastGear = 1; e.lastThrottle = 0; e.crackleUntil = 0;
    e.gain.connect(this.sfx);
    // turbo / boost whine
    e.whine = ctx.createOscillator(); e.whine.type = 'sine';
    e.whineGain = ctx.createGain(); e.whineGain.gain.value = 0;
    e.whine.connect(e.whineGain); e.whineGain.connect(this.sfx);
    // boost hiss
    e.hiss = this.noise();
    e.hissFilter = ctx.createBiquadFilter(); e.hissFilter.type = 'bandpass'; e.hissFilter.frequency.value = 1800; e.hissFilter.Q.value = 0.7;
    e.hissGain = ctx.createGain(); e.hissGain.gain.value = 0;
    e.hiss.connect(e.hissFilter); e.hissFilter.connect(e.hissGain); e.hissGain.connect(this.sfx);
    // tyres
    e.tyre = this.noise();
    e.tyreFilter = ctx.createBiquadFilter(); e.tyreFilter.type = 'bandpass'; e.tyreFilter.frequency.value = 1000; e.tyreFilter.Q.value = 1.4;
    e.tyreGain = ctx.createGain(); e.tyreGain.gain.value = 0;
    e.tyre.connect(e.tyreFilter); e.tyreFilter.connect(e.tyreGain); e.tyreGain.connect(this.sfx);
    // wind
    e.wind = this.noise();
    e.windFilter = ctx.createBiquadFilter(); e.windFilter.type = 'lowpass'; e.windFilter.frequency.value = 600;
    e.windGain = ctx.createGain(); e.windGain.gain.value = 0;
    e.wind.connect(e.windFilter); e.windFilter.connect(e.windGain); e.windGain.connect(this.sfx);
    // scrape
    e.scrape = this.noise();
    e.scrapeFilter = ctx.createBiquadFilter(); e.scrapeFilter.type = 'bandpass'; e.scrapeFilter.frequency.value = 600; e.scrapeFilter.Q.value = 0.9;
    e.scrapeGain = ctx.createGain(); e.scrapeGain.gain.value = 0;
    e.scrape.connect(e.scrapeFilter); e.scrapeFilter.connect(e.scrapeGain); e.scrapeGain.connect(this.sfx);
    for (const n of [e.o1, e.o2, e.o3, e.o4, e.o5, e.pulse, e.whine, e.hiss, e.tyre, e.wind, e.scrape]) n.start();
    return e;
  }

  engineState(i = 0) {
    return this.state?.[i] || {};
  }

  // Called every frame while a car is driven.
  updateEngine({ speed, top, throttle, boost, slip, scraping, active, slowmo = 0, volume = 1, style = 'wedge' }, i = 0) {
    const ratios = [0, 0.18, 0.32, 0.47, 0.62, 0.8, 1.05];
    let gear = 1;
    while (gear < 6 && speed > ratios[gear] * top) gear++;
    const lo = ratios[gear - 1] * top * 0.75, hi = ratios[gear] * top;
    let rpm = Math.max(0, Math.min(1, (speed - lo) / Math.max(1, hi - lo)));
    rpm = 0.25 + rpm * 0.75;
    const onGrid = speed < 1;
    if (onGrid) rpm = 0.16 + throttle * 0.8; // revving on the grid: all the way up to the limiter
    if (!this.ctx) {
      this.state ||= [];
      this.state[i] = { gear, rpm };
      return;
    }
    if (!this.engines[i]) this.engines[i] = this.buildEngine();
    const e = this.engines[i], t = this.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0.001, t - e.lastT));
    e.lastT = t;
    // revs have inertia: they climb quickly and fall back more slowly; bounce off the limiter
    const tau = rpm > e.rev ? 0.09 : 0.3;
    e.rev += (rpm - e.rev) * Math.min(1, dt / tau);
    if (onGrid && e.rev > 0.93) e.rev -= 0.07 * Math.random();
    this.state ||= [];
    this.state[i] = { gear, rpm: e.rev };
    if (i === 0) { this.gear = gear; this.rpm = e.rev; }
    active = active && volume > 0;
    const tone = ENGINE_TONE[style] || ENGINE_TONE.wedge;
    const pitch = (1 - slowmo * 0.45) * tone.pitch;
    const f = (36 + e.rev * 150) * pitch;
    e.o1.frequency.setTargetAtTime(f, t, 0.02);
    e.o5.frequency.setTargetAtTime(f, t, 0.02);
    e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    e.o4.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    e.o3.frequency.setTargetAtTime(f * 2, t, 0.02);
    e.pulse.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    e.pulseDepth.gain.setTargetAtTime(tone.burble * (1 - e.rev * 0.7) * (0.6 + throttle * 0.4), t, 0.05);
    // the note opens up under load
    const cut = 240 + throttle * 900 + e.rev * 1300 + boost * 500;
    e.filter.frequency.setTargetAtTime(cut, t, 0.04);
    e.filter2.frequency.setTargetAtTime(cut * 1.7, t, 0.04);
    e.gain.gain.setTargetAtTime(active ? (0.1 + throttle * 0.1 + e.rev * 0.03 + boost * 0.03) * volume : 0, t, 0.06);
    if (active && !onGrid) {
      // gear change: a short dip and a thump
      if (gear > e.lastGear) this.shiftThump(volume);
      // lift off at high revs: exhaust crackle
      if (e.lastThrottle > 0.5 && throttle < 0.2 && e.rev > 0.55) e.crackleUntil = t + 0.5 + Math.random() * 0.4;
      if (t < e.crackleUntil && Math.random() < dt * 22) this.pop(volume * (0.6 + Math.random() * 0.4));
    }
    e.lastGear = gear;
    e.lastThrottle = throttle;
    e.whine.frequency.setTargetAtTime(f * 5 + 300, t, 0.05);
    e.whineGain.gain.setTargetAtTime(active ? (boost * 0.014 + rpm * 0.002) * volume : 0, t, 0.1);
    e.hissGain.gain.setTargetAtTime(active ? boost * 0.045 * volume : 0, t, 0.08);
    e.tyreGain.gain.setTargetAtTime(active ? Math.min(0.11, slip * 0.2) * volume : 0, t, 0.06);
    e.tyreFilter.frequency.setTargetAtTime(900 + slip * 350, t, 0.05);
    const w = Math.min(1, speed / 90);
    e.windGain.gain.setTargetAtTime(active ? w * w * 0.08 * volume : 0, t, 0.1);
    e.windFilter.frequency.setTargetAtTime(280 + w * 1000, t, 0.1);
    e.scrapeGain.gain.setTargetAtTime(active ? scraping * 0.12 * volume : 0, t, 0.03);
  }

  shiftThump(vol = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    o.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.004, 0.16 * vol, 0.12);
    o.start(t); o.stop(t + 0.2);
    this.pop(vol * 0.7);
  }

  // one exhaust pop: a tiny filtered noise burst with a low body
  pop(vol = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 900; f.Q.value = 1.2;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.002, 0.13 * vol, 0.05 + Math.random() * 0.04);
    n.start(t, Math.random()); n.stop(t + 0.12);
  }

  // app in the background: stop all sound (resume() brings it back)
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  silenceEngine() {
    if (!this.ctx) return;
    for (let i = 0; i < this.engines.length; i++) this.updateEngine({ speed: 0, top: 1, throttle: 0, boost: 0, slip: 0, scraping: 0, active: false }, i);
  }

  env(node, t, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  impact(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + power * 1400;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.003, Math.min(0.8, 0.2 + power * 0.4), 0.22 + power * 0.25);
    n.start(t); n.stop(t + 1);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const og = ctx.createGain();
    o.connect(og); og.connect(this.sfx);
    this.env(og, t, 0.005, Math.min(1, 0.4 + power * 0.5), 0.35);
    o.start(t); o.stop(t + 0.5);
    // metallic ring
    for (const fr of [620, 910, 1370]) {
      const m = ctx.createOscillator(); m.type = 'triangle';
      m.frequency.value = fr * (0.9 + Math.random() * 0.2);
      const mg = ctx.createGain();
      m.connect(mg); mg.connect(this.sfx);
      this.env(mg, t, 0.002, 0.012 * power, 0.3);
      m.start(t); m.stop(t + 0.4);
    }
  }

  crash() {
    this.impact(1.6);
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(22, t + 1.4);
    const g = ctx.createGain();
    o.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.01, 0.9, 1.4);
    o.start(t); o.stop(t + 1.6);
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(250, t + 1.2);
    const ng = ctx.createGain();
    n.connect(f); f.connect(ng); ng.connect(this.sfx);
    this.env(ng, t, 0.01, 0.3, 1.2);
    n.start(t); n.stop(t + 1.5);
  }

  whoosh(up = true, vol = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(up ? 400 : 3000, t);
    f.frequency.exponentialRampToValueAtTime(up ? 4000 : 500, t + 0.35);
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.06, vol, 0.35);
    n.start(t); n.stop(t + 0.6);
  }

  blip(freq = 880, dur = 0.08, vol = 0.2, type = 'triangle') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    o.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.005, vol, dur);
    o.start(t); o.stop(t + dur + 0.05);
  }

  chime(level = 1) {
    // rising two-note sting for scoring events
    if (!this.ctx) return;
    const base = 660 * Math.pow(2, Math.min(4, level - 1) / 12 * 2);
    this.blip(base, 0.1, 0.08, 'sine');
    setTimeout(() => { this.blip(base * 1.5, 0.22, 0.08, 'sine'); this.blip(base * 3, 0.16, 0.015, 'sine'); }, 70);
  }

  setSlowmo(k) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(k > 0.01 ? 500 : this.menuMode ? 1400 : RACE_CUTOFF, t, 0.15);
  }

  setMenuMode(on) {
    this.menuMode = on;
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(on ? 1400 : RACE_CUTOFF, this.ctx.currentTime, 0.4);
  }

  playMusic(songId) {
    this.song = SONGS[songId] || SONGS.coast;
    this.musicOn = true;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
  }

  pickup(power = false) {
    if (!this.ctx) return;
    const notes = power ? [523, 659, 784, 1047] : [880, 1320];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.12, 0.09, power ? 'triangle' : 'sine'), i * 55));
  }

  shockwave(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.8);
    const g = ctx.createGain();
    o.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.01, 0.9 * vol, 0.8);
    o.start(t); o.stop(t + 1);
    this.whoosh(false, 0.45 * vol);
  }

  fire(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1100, t + 0.18);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    const g = ctx.createGain();
    o.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.005, 0.25 * vol, 0.25);
    o.start(t); o.stop(t + 0.35);
    this.whoosh(true, 0.3 * vol);
  }

  ping(vol = 1) {
    this.blip(1300 + Math.random() * 400, 0.07, 0.07 * vol, 'sine');
  }

  splat(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.01, 0.45 * vol, 0.4);
    n.start(t, Math.random()); n.stop(t + 0.6);
    this.blip(140, 0.2, 0.2 * vol, 'sine');
  }

  thunder(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(120, t + 2.5);
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.sfx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.05, 0.7 * vol), t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.3 * vol + 0.01, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    n.start(t); n.stop(t + 3.2);
  }

  // Continuous weather bed: 'rain' | 'wind' | null
  setAmbience(type) {
    if (!this.ctx) { this.pendingAmbience = type; return; }
    const ctx = this.ctx, t = ctx.currentTime;
    if (this.amb) {
      const old = this.amb;
      old.gain.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => old.src.stop(), 1500);
      this.amb = null;
    }
    if (!type) return;
    const src = this.noise();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (type === 'rain') { f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.4; }
    else { f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6; }
    src.connect(f); f.connect(g); g.connect(this.sfx);
    g.gain.value = 0;
    g.gain.setTargetAtTime(type === 'rain' ? 0.08 : 0.07, t, 0.8);
    if (type === 'wind') {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
      const lg = ctx.createGain(); lg.gain.value = 180;
      lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    }
    src.start();
    this.amb = { src, gain: g };
  }

  // --- music ------------------------------------------------------------------
  schedule() {
    if (!this.ctx || !this.musicOn || this.ctx.state !== 'running') return;
    const spb = 60 / (this.song.bpm * (1 + 0.06 * this.intensity)) / 4; // 16th notes
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step++;
    }
  }

  playStep(step, t, spb) {
    const s = this.song;
    const bar = Math.floor(step / 16) % 4;
    const i = step % 16;
    const chord = s.chords[bar];
    const hot = this.intensity > 0;
    const section = hot ? 3 : Math.floor(step / 64) % 4; // variation every 4 bars (final lap: full arrangement)
    if (i % 4 === 0) this.kick(t);
    if (i === 4 || i === 12) this.snare(t);
    if (hot && bar === 3 && i >= 12) this.snare(t, 0.45 + (i - 12) * 0.15); // fill into each phrase
    if (hot && i % 2 === 0 && i % 4 !== 0) this.hat(t, 0.028);
    if (i % 4 === 2 || (section > 1 && i % 2 === 1)) this.hat(t, i % 4 === 2 ? 0.035 : 0.018);
    // bass: 8ths, root with a fifth / octave now and then
    if (i % 2 === 0) this.bass(midi(s.root - 12 + chord[0] + (i === 6 ? 7 : i === 14 ? 12 : 0)), t, spb * 1.7);
    if (i === 0) this.pad(chord.map((n) => midi(s.root + n)), t, spb * 16);
    if (section !== 0 && i % 2 === 0) {
      // gentle arpeggio in 8ths over the chord's four notes
      const arp = [0, 1, 2, 3, 2, 1, 2, 3];
      const note = s.root + 12 + chord[arp[(i / 2) % 8]] + (i >= 8 && section === 3 ? 12 : 0);
      this.lead(midi(note), t, spb * 1.8);
    }
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    o.connect(g); g.connect(this.musicFilter);
    this.env(g, t, 0.002, 0.7, 0.26);
    o.start(t); o.stop(t + 0.35);
  }

  snare(t, level = 1) {
    const ctx = this.ctx;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.musicFilter); g.connect(this.reverb);
    this.env(g, t, 0.002, 0.2 * level, 0.16);
    n.start(t, Math.random()); n.stop(t + 0.25);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
    const og = ctx.createGain();
    o.connect(og); og.connect(this.musicFilter);
    this.env(og, t, 0.002, 0.18, 0.09);
    o.start(t); o.stop(t + 0.15);
  }

  hat(t, vol) {
    const ctx = this.ctx;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 8000; f.Q.value = 0.8;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.musicFilter);
    this.env(g, t, 0.001, vol * 2, 0.035);
    n.start(t, Math.random()); n.stop(t + 0.08);
  }

  bass(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(700 * this.song.bright, t); f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    o.connect(f); sub.connect(f); f.connect(g); g.connect(this.musicFilter);
    this.env(g, t, 0.006, 0.24, dur);
    sub.start(t); sub.stop(t + dur + 0.05);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pad(freqs, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100 * this.song.bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g); g.connect(this.musicFilter); g.connect(this.reverb);
    for (const fr of freqs) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = det < 0 ? 'sawtooth' : 'triangle'; o.frequency.value = fr; o.detune.value = det;
        o.connect(f);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  lead(freq, t, dur) {
    const ctx = this.ctx;
    // soft pluck: triangle plus a quiet sine an octave up, into echo and reverb
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2000 * this.song.bright;
    const g = ctx.createGain();
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g);
    g.connect(this.musicFilter); g.connect(this.delay); g.connect(this.reverb);
    this.delay.delayTime.value = (60 / this.song.bpm) * 0.75;
    this.env(g, t, 0.008, 0.07, dur);
    o2.start(t); o2.stop(t + dur + 0.05);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

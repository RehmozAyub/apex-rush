// Web Audio synthesis: engine, tyre squeal, wind, impacts, boost, UI blips and a synthwave
// music sequencer. No audio files.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const SONGS = {
  coast: { bpm: 108, root: 57, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], bright: 0.8 },
  city: { bpm: 124, root: 54, chords: [[0, 3, 7], [-4, -1, 3], [3, 7, 10], [1, 5, 8]], bright: 1.0 },
  alpine: { bpm: 116, root: 50, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], bright: 0.9 },
  snow: { bpm: 112, root: 52, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], bright: 0.7 },
  canyon: { bpm: 118, root: 55, chords: [[0, 3, 7], [5, 9, 12], [0, 3, 7], [-2, 2, 5]], bright: 0.85 },
  jungle: { bpm: 128, root: 50, chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -1, 2]], bright: 0.75 },
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
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.master;
    this.masterGain.connect(this.out);
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
    this.delayFb.gain.value = 0.35;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.musicFilter);

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
    e.filter.Q.value = 3;
    e.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
    e.shaper.curve = curve;
    e.o1 = ctx.createOscillator(); e.o1.type = 'sawtooth';
    e.o2 = ctx.createOscillator(); e.o2.type = 'square';
    e.o3 = ctx.createOscillator(); e.o3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g3 = ctx.createGain(); g3.gain.value = 0.25;
    e.o1.connect(g1); e.o2.connect(g2); e.o3.connect(g3);
    g1.connect(e.shaper); g2.connect(e.shaper); g3.connect(e.shaper);
    e.shaper.connect(e.filter);
    e.filter.connect(e.gain);
    e.gain.connect(this.sfx);
    // turbo / boost whine
    e.whine = ctx.createOscillator(); e.whine.type = 'sine';
    e.whineGain = ctx.createGain(); e.whineGain.gain.value = 0;
    e.whine.connect(e.whineGain); e.whineGain.connect(this.sfx);
    // boost hiss
    e.hiss = this.noise();
    e.hissFilter = ctx.createBiquadFilter(); e.hissFilter.type = 'bandpass'; e.hissFilter.frequency.value = 3000; e.hissFilter.Q.value = 0.8;
    e.hissGain = ctx.createGain(); e.hissGain.gain.value = 0;
    e.hiss.connect(e.hissFilter); e.hissFilter.connect(e.hissGain); e.hissGain.connect(this.sfx);
    // tyres
    e.tyre = this.noise();
    e.tyreFilter = ctx.createBiquadFilter(); e.tyreFilter.type = 'bandpass'; e.tyreFilter.frequency.value = 1700; e.tyreFilter.Q.value = 4;
    e.tyreGain = ctx.createGain(); e.tyreGain.gain.value = 0;
    e.tyre.connect(e.tyreFilter); e.tyreFilter.connect(e.tyreGain); e.tyreGain.connect(this.sfx);
    // wind
    e.wind = this.noise();
    e.windFilter = ctx.createBiquadFilter(); e.windFilter.type = 'lowpass'; e.windFilter.frequency.value = 600;
    e.windGain = ctx.createGain(); e.windGain.gain.value = 0;
    e.wind.connect(e.windFilter); e.windFilter.connect(e.windGain); e.windGain.connect(this.sfx);
    // scrape
    e.scrape = this.noise();
    e.scrapeFilter = ctx.createBiquadFilter(); e.scrapeFilter.type = 'bandpass'; e.scrapeFilter.frequency.value = 900; e.scrapeFilter.Q.value = 1.5;
    e.scrapeGain = ctx.createGain(); e.scrapeGain.gain.value = 0;
    e.scrape.connect(e.scrapeFilter); e.scrapeFilter.connect(e.scrapeGain); e.scrapeGain.connect(this.sfx);
    for (const n of [e.o1, e.o2, e.o3, e.whine, e.hiss, e.tyre, e.wind, e.scrape]) n.start();
    return e;
  }

  engineState(i = 0) {
    return this.state?.[i] || {};
  }

  // Called every frame while a car is driven.
  updateEngine({ speed, top, throttle, boost, slip, scraping, active, slowmo = 0, volume = 1 }, i = 0) {
    const ratios = [0, 0.18, 0.32, 0.47, 0.62, 0.8, 1.05];
    let gear = 1;
    while (gear < 6 && speed > ratios[gear] * top) gear++;
    const lo = ratios[gear - 1] * top * 0.75, hi = ratios[gear] * top;
    let rpm = Math.max(0, Math.min(1, (speed - lo) / Math.max(1, hi - lo)));
    rpm = 0.25 + rpm * 0.75;
    if (speed < 1) rpm = 0.18 + throttle * 0.35; // revving on the grid
    this.state ||= [];
    this.state[i] = { gear, rpm };
    if (i === 0) { this.gear = gear; this.rpm = rpm; }
    if (!this.ctx) return;
    if (!this.engines[i]) this.engines[i] = this.buildEngine();
    const e = this.engines[i], t = this.ctx.currentTime;
    active = active && volume > 0;
    const pitch = 1 - slowmo * 0.45;
    const f = (38 + rpm * 125) * pitch;
    e.o1.frequency.setTargetAtTime(f, t, 0.03);
    e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    e.o3.frequency.setTargetAtTime(f * 1.505, t, 0.03);
    e.filter.frequency.setTargetAtTime(350 + throttle * 1500 + rpm * 1600 + boost * 900, t, 0.05);
    e.gain.gain.setTargetAtTime(active ? (0.1 + throttle * 0.1 + boost * 0.04) * volume : 0, t, 0.08);
    e.whine.frequency.setTargetAtTime(f * 9 + 400, t, 0.05);
    e.whineGain.gain.setTargetAtTime(active ? boost * 0.03 + rpm * 0.005 : 0, t, 0.1);
    e.hissGain.gain.setTargetAtTime(active ? boost * 0.08 : 0, t, 0.08);
    e.tyreGain.gain.setTargetAtTime(active ? Math.min(0.2, slip * 0.35) : 0, t, 0.05);
    e.tyreFilter.frequency.setTargetAtTime(1500 + slip * 600, t, 0.05);
    const w = Math.min(1, speed / 90);
    e.windGain.gain.setTargetAtTime(active ? w * w * 0.12 : 0, t, 0.1);
    e.windFilter.frequency.setTargetAtTime(300 + w * 1400, t, 0.1);
    e.scrapeGain.gain.setTargetAtTime(active ? scraping * 0.25 : 0, t, 0.03);
  }

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
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200 + power * 2500;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.003, Math.min(1, 0.25 + power * 0.5), 0.25 + power * 0.3);
    n.start(t); n.stop(t + 1);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const og = ctx.createGain();
    o.connect(og); og.connect(this.sfx);
    this.env(og, t, 0.005, Math.min(1, 0.4 + power * 0.5), 0.35);
    o.start(t); o.stop(t + 0.5);
    // metallic ring
    for (const fr of [620, 910, 1370]) {
      const m = ctx.createOscillator(); m.type = 'square';
      m.frequency.value = fr * (0.9 + Math.random() * 0.2);
      const mg = ctx.createGain();
      m.connect(mg); mg.connect(this.sfx);
      this.env(mg, t, 0.002, 0.02 * power, 0.25);
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
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(300, t + 1.2);
    const ng = ctx.createGain();
    n.connect(f); f.connect(ng); ng.connect(this.sfx);
    this.env(ng, t, 0.01, 0.4, 1.2);
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

  blip(freq = 880, dur = 0.08, vol = 0.2, type = 'square') {
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
    this.blip(base, 0.08, 0.1, 'triangle');
    setTimeout(() => this.blip(base * 1.5, 0.14, 0.1, 'triangle'), 70);
  }

  setSlowmo(k) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(k > 0.01 ? 500 : this.menuMode ? 1400 : 18000, t, 0.15);
  }

  setMenuMode(on) {
    this.menuMode = on;
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(on ? 1400 : 18000, this.ctx.currentTime, 0.4);
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
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.09, 0.12, power ? 'square' : 'triangle'), i * 55));
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

  fire() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    const g = ctx.createGain();
    o.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.005, 0.25, 0.25);
    o.start(t); o.stop(t + 0.35);
    this.whoosh(true, 0.3);
  }

  ping() {
    this.blip(1800 + Math.random() * 600, 0.06, 0.12, 'triangle');
  }

  splat() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.sfx);
    this.env(g, t, 0.01, 0.45, 0.4);
    n.start(t, Math.random()); n.stop(t + 0.6);
    this.blip(140, 0.2, 0.2, 'sine');
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
    if (type === 'rain') { f.type = 'highpass'; f.frequency.value = 900; }
    else { f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6; }
    src.connect(f); f.connect(g); g.connect(this.sfx);
    g.gain.value = 0;
    g.gain.setTargetAtTime(type === 'rain' ? 0.14 : 0.1, t, 0.8);
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
    const spb = 60 / this.song.bpm / 4; // 16th notes
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
    const section = Math.floor(step / 64) % 4; // variation every 4 bars
    if (i % 4 === 0) this.kick(t);
    if (i === 4 || i === 12) this.snare(t);
    if (i % 2 === 1 || section > 1) this.hat(t, i % 4 === 2 ? 0.05 : 0.03);
    // bass: driving 8ths with octave jumps
    if (i % 2 === 0) this.bass(midi(s.root - 12 + chord[0] + (i % 8 === 6 ? 12 : 0)), t, spb * 1.8);
    if (i === 0) this.pad(chord.map((n) => midi(s.root + n)), t, spb * 16);
    if (section !== 0) {
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      const note = s.root + 12 + chord[arp[i % 8]] + (i >= 8 && section === 3 ? 12 : 0);
      this.lead(midi(note), t, spb * 0.9);
    }
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    o.connect(g); g.connect(this.musicFilter);
    this.env(g, t, 0.002, 0.9, 0.28);
    o.start(t); o.stop(t + 0.35);
  }

  snare(t) {
    const ctx = this.ctx;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.musicFilter);
    this.env(g, t, 0.002, 0.35, 0.18);
    n.start(t, Math.random()); n.stop(t + 0.25);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
    const og = ctx.createGain();
    o.connect(og); og.connect(this.musicFilter);
    this.env(og, t, 0.002, 0.25, 0.09);
    o.start(t); o.stop(t + 0.15);
  }

  hat(t, vol) {
    const ctx = this.ctx;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain();
    n.connect(f); f.connect(g); g.connect(this.musicFilter);
    this.env(g, t, 0.001, vol * 2.5, 0.04);
    n.start(t, Math.random()); n.stop(t + 0.08);
  }

  bass(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(1400 * this.song.bright, t); f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    o.connect(f); f.connect(g); g.connect(this.musicFilter);
    this.env(g, t, 0.004, 0.28, dur);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pad(freqs, t, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600 * this.song.bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(this.musicFilter);
    for (const fr of freqs) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
        o.connect(f);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  lead(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600 * this.song.bright;
    const g = ctx.createGain();
    o.connect(f); f.connect(g); g.connect(this.musicFilter); g.connect(this.delay);
    this.delay.delayTime.value = (60 / this.song.bpm) * 0.75;
    this.env(g, t, 0.004, 0.05, dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
}

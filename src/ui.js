// DOM overlay: menus, HUD, popups, countdown, results.
import { formatTime } from './race.js';

const $ = (sel, el = document) => el.querySelector(sel);

export class UI {
  constructor(root) {
    this.root = root;
    root.innerHTML = /* html */ `
      <div id="fade"></div>
      <section id="s-loading" class="screen show">
        <div class="logo"><span class="l1">APEX</span><span class="l2">RUSH</span></div>
        <div class="loadbar"><i></i></div>
        <div class="loadtext">WARMING UP ENGINES</div>
      </section>

      <section id="s-title" class="screen">
        <div class="logo big"><span class="l1">APEX</span><span class="l2">RUSH</span></div>
        <div class="tagline">TAKEDOWN RACING</div>
        <div class="menu" id="m-title"></div>
        <div class="press">PRESS ENTER</div>
      </section>

      <section id="s-tracks" class="screen">
        <h1 class="head"><b>SELECT</b> TRACK</h1>
        <div class="cards" id="cards"></div>
        <div class="hints">← → ↑ ↓ CHOOSE &nbsp;·&nbsp; ENTER CONFIRM &nbsp;·&nbsp; ESC BACK</div>
      </section>

      <section id="s-cars" class="screen">
        <h1 class="head"><b>SELECT</b> CAR</h1>
        <div class="carpanel">
          <div class="carnav"><span class="arrow">◀</span><div class="carname" id="carname"></div><span class="arrow">▶</span></div>
          <div class="carcount" id="carcount"></div>
          <div class="cardesc" id="cardesc"></div>
          <div class="stats" id="stats"></div>
          <div class="paintlabel">PAINT <span id="paintname"></span></div>
          <div class="swatches" id="swatches"></div>
        </div>
        <div class="hints">← → CAR &nbsp;·&nbsp; ↑ ↓ PAINT &nbsp;·&nbsp; ENTER RACE &nbsp;·&nbsp; ESC BACK</div>
      </section>

      <section id="s-settings" class="screen">
        <h1 class="head"><b>SETTINGS</b></h1>
        <div class="menu wide" id="m-settings"></div>
        <div class="hints">↑ ↓ SELECT &nbsp;·&nbsp; ← → CHANGE &nbsp;·&nbsp; ESC BACK</div>
        <div class="controls">
          <div><b>W / ↑</b> Accelerate</div><div><b>S / ↓</b> Brake / Reverse</div>
          <div><b>A D / ← →</b> Steer</div><div><b>SPACE</b> Handbrake / Drift</div>
          <div><b>SHIFT</b> Boost</div><div><b>C</b> Camera</div>
          <div><b>E</b> Use power-up</div><div><b>R</b> Reset car</div>
          <div><b>ESC</b> Pause</div><div><b>F11</b> Fullscreen</div>
          <div class="pad">Gamepad: RT/LT drive · A boost · X drift · LB power-up · Y camera</div>
        </div>
      </section>

      <section id="s-hud" class="screen hud"></section>

      <section id="s-howto" class="screen">
        <h1 class="head"><b>HOW TO</b> PLAY</h1>
        <div class="howto">
          <div class="col">
            <h2>THE RACE</h2>
            <p>3 laps, 8 cars. Finish first and wreck rivals on the way.</p>
            <h2>BOOST</h2>
            <p>Fill the meter by <b>drifting</b>, <b>near misses</b>, <b>slipstreaming</b> behind rivals, <b>takedowns</b> and <b>boost rings</b> on the road. Chain moves quickly for an adrenaline multiplier up to <b>×5</b>.</p>
            <h2>TAKEDOWNS</h2>
            <p>Slam a rival hard, or shove them into a wall. Hit a wall head-on or get rammed and you crash.</p>
            <h2>POWER-UPS</h2>
            <p><i class="pu c1"></i><b>SHOCKWAVE</b> wrecks everyone near you</p>
            <p><i class="pu c2"></i><b>RICOCHET</b> bouncing shot that hunts down the road</p>
            <p><i class="pu c3"></i><b>LIGHTNING STRIKE</b> hits the car ahead</p>
            <p><i class="pu c4"></i><b>OIL SLICK</b> dropped behind you, chasers crash</p>
          </div>
          <div class="col">
            <h2>CONTROLS</h2>
            <table class="keys">
              <tr><th></th><th>1 PLAYER</th><th>2P · PLAYER 1</th><th>2P · PLAYER 2</th><th>GAMEPAD</th></tr>
              <tr><td>Drive</td><td>WASD / Arrows</td><td>W A S D</td><td>Arrows</td><td>RT · LT · Stick</td></tr>
              <tr><td>Drift</td><td>Space</td><td>Space</td><td>Right Ctrl / 0</td><td>X</td></tr>
              <tr><td>Boost</td><td>Shift</td><td>Left Shift</td><td>Right Shift</td><td>A</td></tr>
              <tr><td>Power-up</td><td>E</td><td>E</td><td>Enter</td><td>LB</td></tr>
              <tr><td>Camera</td><td>C</td><td>C</td><td>\\</td><td>Y</td></tr>
              <tr><td>Reset car</td><td>R</td><td>R</td><td>]</td><td></td></tr>
              <tr><td>Pause</td><td>Esc</td><td colspan="2">Esc</td><td>Start</td></tr>
            </table>
            <p class="note">Two gamepads? The first controls player 1, the second player 2. F11 toggles fullscreen.</p>
          </div>
        </div>
        <div class="hints">ENTER / ESC BACK</div>
      </section>

      <section id="s-pause" class="screen dim">
        <h1 class="head"><b>PAUSED</b></h1>
        <div class="menu" id="m-pause"></div>
      </section>

      <section id="s-results" class="screen dim">
        <h1 class="head" id="r-head"><b>RESULTS</b></h1>
        <div class="results" id="results"></div>
        <div class="menu row" id="m-results"></div>
      </section>

      <section id="s-error" class="screen">
        <h1 class="head"><b>GRAPHICS</b> ERROR</h1>
        <p class="err" id="errtext"></p>
      </section>
    `;
    this.screens = {};
    for (const s of root.querySelectorAll('.screen')) this.screens[s.id.slice(2)] = s;
    this.current = 'loading';
    this.chainLen = 2 * Math.PI * 17;
    this.setViews(1);
  }

  // Build one HUD per player. In split screen each HUD fills its half of the screen.
  // Returns the minimap canvases.
  setViews(n) {
    const host = this.screens.hud;
    host.classList.toggle('split', n > 1);
    host.innerHTML = '';
    this.huds = [];
    for (let i = 0; i < n; i++) {
      const v = document.createElement('div');
      v.className = `hudview v${i}`;
      v.innerHTML = /* html */ `<div class="hudinner">
        <div class="h-pos">${n > 1 ? `<div class="ptag p${i + 1}">PLAYER ${i + 1}</div>` : ''}<div class="lbl">POS</div><div class="big"><span class="x-pos">1</span><small>/<span class="x-total">8</span></small></div>
          <div class="h-lap">LAP <span class="x-lap">1</span>/<span class="x-laps">3</span></div></div>
        <div class="h-times">
          <div class="row"><span class="lbl">LAP</span><span class="x-laptime">0:00.00</span></div>
          <div class="row dim"><span class="lbl">BEST</span><span class="x-best">--:--.--</span></div>
          <div class="row td"><span class="lbl">TAKEDOWNS</span><span class="x-td">0</span></div>
        </div>
        <div class="h-center"><div class="h-banner"></div></div>
        <div class="popups"></div>
        <div class="countdown"></div>
        <canvas class="minimap" width="200" height="200"></canvas>
        <div class="h-boost">
          <div class="mult"><span>×1</span><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="x-chain"/></svg></div>
          <div class="bar"><div class="fill x-boost"></div><div class="segs">${'<i></i>'.repeat(10)}</div></div>
          <div class="lbl">BOOST</div>
        </div>
        <div class="h-power"><div class="pic"></div><div class="pname"></div><div class="pkey">E</div></div>
        <div class="h-speedo">
          <svg viewBox="0 0 200 200" class="gauge">
            <path d="M 30 150 A 80 80 0 1 1 170 150" class="track"/>
            <path d="M 30 150 A 80 80 0 1 1 170 150" class="rpm x-rpm"/>
          </svg>
          <div class="spd"><span class="x-speed">0</span><small>KM/H</small></div>
          <div class="gear">GEAR <b class="x-gear">1</b></div>
        </div>
      </div>`;
      host.appendChild(v);
      const q = (c) => v.querySelector(c);
      const el = {
        view: v, pos: q('.x-pos'), total: q('.x-total'), lap: q('.x-lap'), laps: q('.x-laps'), laptime: q('.x-laptime'), best: q('.x-best'),
        td: q('.x-td'), boost: q('.x-boost'), mult: q('.mult'), chain: q('.x-chain'), speed: q('.x-speed'), gear: q('.x-gear'),
        rpm: q('.x-rpm'), banner: q('.h-banner'), popups: q('.popups'), countdown: q('.countdown'), power: q('.h-power'),
        minimap: q('.minimap'), last: {},
      };
      el.chain.style.strokeDasharray = `${this.chainLen}`;
      this.huds.push(el);
    }
    this.rpmLen = this.huds[0].rpm.getTotalLength() || 380;
    for (const h of this.huds) h.rpm.style.strokeDasharray = `${this.rpmLen}`;
    return this.huds.map((h) => h.minimap);
  }

  show(name) {
    for (const [k, s] of Object.entries(this.screens)) {
      if (k === name) s.classList.add('show');
      else if (!(name === 'pause' && k === 'hud') && !(name === 'results' && k === 'hud')) s.classList.remove('show');
    }
    this.current = name;
  }

  overlay(name, on) { this.screens[name].classList.toggle('show', on); }

  loading(p, text) {
    $('.loadbar i', this.screens.loading).style.width = `${Math.round(p * 100)}%`;
    if (text) $('.loadtext', this.screens.loading).textContent = text;
  }

  fade(on) { $('#fade').classList.toggle('on', on); }

  // Generic vertical/horizontal menu. items: [{label, value?}]
  menu(id, items, index) {
    const el = $(`#${id}`);
    el.innerHTML = items.map((it, i) => `<div class="item${i === index ? ' sel' : ''}${it.disabled ? ' off' : ''}" data-i="${i}"><span>${it.label}</span>${it.value !== undefined ? `<em>${it.value}</em>` : ''}</div>`).join('');
    return el;
  }

  onMenuClick(id, fn) {
    $(`#${id}`).addEventListener('click', (e) => {
      const it = e.target.closest('.item');
      if (it) fn(Number(it.dataset.i));
    });
  }

  trackCards(maps, index, lengths) {
    const el = $('#cards');
    el.innerHTML = maps.map((m, i) => `
      <div class="card c-${m.id}${i === index ? ' sel' : ''}" data-i="${i}">
        <div class="art"></div>
        <div class="info"><div class="num">0${i + 1}</div><div class="name">${m.name}</div><div class="tag">${m.tagline}</div>
          <div class="meta"><span class="wx">${m.weatherLabel || ''}</span><span>${(lengths[i] / 1000).toFixed(2)} KM</span><span>8 CARS</span></div></div>
      </div>`).join('');
    return el;
  }

  carPanel(car, paints, paintIndex, index = 0, total = 1, who = '') {
    $('#s-cars .head').innerHTML = who ? `<b>${who}</b> SELECT CAR` : '<b>SELECT</b> CAR';
    $('#carcount').textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    const nameEl = $('#carname');
    nameEl.textContent = car.name;
    let size = 10;
    nameEl.style.fontSize = `${size}vh`;
    while (nameEl.scrollWidth > nameEl.clientWidth + 1 && size > 4) {
      size -= 0.5;
      nameEl.style.fontSize = `${size}vh`;
    }
    $('#cardesc').textContent = car.desc;
    $('#stats').innerHTML = [['SPEED', car.stats.speed], ['ACCEL', car.stats.accel], ['HANDLING', car.stats.handling]]
      .map(([k, v]) => `<div class="stat"><span>${k}</span><div class="sbar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`).join('');
    $('#swatches').innerHTML = paints.map((p, i) => `<i class="${i === paintIndex ? 'sel' : ''}" data-i="${i}" style="background:#${p.hex.toString(16).padStart(6, '0')}"></i>`).join('');
    $('#paintname').textContent = paints[paintIndex].name.toUpperCase();
  }

  hud(d, i = 0) {
    const e = this.huds[i];
    if (!e) return;
    const L = e.last;
    const set = (k, el, v) => { if (L[k] !== v) { L[k] = v; el.textContent = v; } };
    set('pos', e.pos, d.position);
    set('total', e.total, d.total);
    set('lap', e.lap, d.lap);
    set('laps', e.laps, d.laps);
    set('lt', e.laptime, formatTime(d.lapTime));
    set('best', e.best, formatTime(d.bestLap));
    set('td', e.td, d.takedowns);
    set('speed', e.speed, Math.round(d.speed));
    set('gear', e.gear, d.gear);
    e.boost.style.width = `${(d.boost * 100).toFixed(1)}%`;
    e.view.classList.toggle('boosting', d.boosting);
    e.view.classList.toggle('crashcam', d.camera);
    const m = `×${d.multiplier}`;
    if (L.mult !== m) { L.mult = m; e.mult.firstElementChild.textContent = m; e.mult.classList.remove('bump'); void e.mult.offsetWidth; e.mult.classList.add('bump'); }
    e.mult.classList.toggle('active', d.multiplier > 1 || d.chain > 0);
    e.chain.style.strokeDashoffset = `${this.chainLen * (1 - d.chain)}`;
    e.rpm.style.strokeDashoffset = `${this.rpmLen * (1 - Math.min(1, d.rpm))}`;
    const pw = d.power || '';
    if (L.power !== pw || L.pkey !== d.powerKey) {
      L.power = pw;
      L.pkey = d.powerKey;
      const el = e.power;
      el.className = `h-power ${pw ? 'show' : ''} p-${pw}`;
      const names = { shockwave: 'SHOCKWAVE', ricochet: 'RICOCHET', strike: 'LIGHTNING STRIKE', oil: 'OIL SLICK' };
      $('.pname', el).textContent = names[pw] || '';
      $('.pkey', el).textContent = d.powerKey || 'E';
    }
    const banner = d.wrongWay ? 'WRONG WAY' : d.drafting ? 'SLIPSTREAM' : '';
    if (L.banner !== banner) { L.banner = banner; e.banner.textContent = banner; e.banner.className = `h-banner ${banner ? (d.wrongWay ? 'bad show' : 'show') : ''}`; }
  }

  popup(title, sub = '', kind = '', i = 0) {
    const box = (this.huds[i] || this.huds[0]).popups;
    const p = document.createElement('div');
    p.className = `pop ${kind}`;
    p.innerHTML = `<div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
    box.prepend(p);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => p.classList.add('out'), kind === 'takedown' ? 1900 : 1400);
    setTimeout(() => p.remove(), kind === 'takedown' ? 2400 : 1900);
  }

  clearPopups() { for (const h of this.huds) { h.popups.innerHTML = ''; h.countdown.innerHTML = ''; } }

  countdown(text) {
    for (const h of this.huds) {
      const c = h.countdown;
      c.innerHTML = `<span class="${text === 'GO!' ? 'go' : ''}">${text}</span>`;
      if (text === 'GO!') setTimeout(() => { if (c.textContent === 'GO!') c.innerHTML = ''; }, 900);
    }
  }

  results(list, headline) {
    $('#r-head').innerHTML = headline;
    $('#results').innerHTML = `<div class="rrow hdr"><span>POS</span><span>DRIVER</span><span>CAR</span><span>TIME</span><span>BEST LAP</span><span>TAKEDOWNS</span></div>` +
      list.map((r) => `<div class="rrow${r.isPlayer ? ' me' : ''}" style="--c:#${r.paint.toString(16).padStart(6, '0')}">
        <span class="p">${r.pos}</span><span class="n"><i></i>${r.name}</span><span>${r.car}</span>
        <span>${r.time !== null ? formatTime(r.time) : '—'}</span><span>${formatTime(r.best)}</span><span>${r.takedowns ?? ''}</span></div>`).join('');
  }

  error(msg) {
    $('#errtext').innerHTML = msg;
    this.show('error');
  }
}

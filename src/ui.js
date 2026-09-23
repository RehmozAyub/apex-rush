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

      <section id="s-hud" class="screen hud">
        <div class="h-pos"><div class="lbl">POS</div><div class="big"><span id="h-pos">1</span><small>/<span id="h-total">6</span></small></div>
          <div class="h-lap">LAP <span id="h-lap">1</span>/<span id="h-laps">3</span></div></div>
        <div class="h-times">
          <div class="row"><span class="lbl">LAP</span><span id="h-laptime">0:00.00</span></div>
          <div class="row dim"><span class="lbl">BEST</span><span id="h-best">--:--.--</span></div>
          <div class="row td"><span class="lbl">TAKEDOWNS</span><span id="h-td">0</span></div>
        </div>
        <div class="h-center"><div id="h-banner"></div></div>
        <div id="popups"></div>
        <div id="countdown"></div>
        <canvas id="minimap" width="200" height="200"></canvas>
        <div class="h-boost">
          <div class="mult" id="h-mult"><span>×1</span><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" id="h-chain"/></svg></div>
          <div class="bar"><div class="fill" id="h-boost"></div><div class="segs"></div></div>
          <div class="lbl">BOOST</div>
        </div>
        <div class="h-power" id="h-power"><div class="pic"></div><div class="pname"></div><div class="pkey">E</div><div class="pbar"><i></i></div></div>
        <div class="h-speedo">
          <svg viewBox="0 0 200 200" class="gauge">
            <path d="M 30 150 A 80 80 0 1 1 170 150" class="track"/>
            <path d="M 30 150 A 80 80 0 1 1 170 150" class="rpm" id="h-rpm"/>
          </svg>
          <div class="spd"><span id="h-speed">0</span><small>KM/H</small></div>
          <div class="gear">GEAR <b id="h-gear">1</b></div>
        </div>
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
    this.el = {
      pos: $('#h-pos'), total: $('#h-total'), lap: $('#h-lap'), laps: $('#h-laps'), laptime: $('#h-laptime'), best: $('#h-best'),
      td: $('#h-td'), boost: $('#h-boost'), mult: $('#h-mult'), chain: $('#h-chain'), speed: $('#h-speed'), gear: $('#h-gear'),
      rpm: $('#h-rpm'), banner: $('#h-banner'), popups: $('#popups'), countdown: $('#countdown'), hud: this.screens.hud,
    };
    const segs = $('.segs', root);
    for (let i = 0; i < 10; i++) segs.appendChild(document.createElement('i'));
    this.rpmLen = this.el.rpm.getTotalLength();
    this.el.rpm.style.strokeDasharray = `${this.rpmLen}`;
    this.chainLen = 2 * Math.PI * 17;
    this.el.chain.style.strokeDasharray = `${this.chainLen}`;
    this.last = {};
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

  carPanel(car, paints, paintIndex, index = 0, total = 1) {
    $('#carcount').textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    $('#carname').textContent = car.name;
    $('#cardesc').textContent = car.desc;
    $('#stats').innerHTML = [['SPEED', car.stats.speed], ['ACCEL', car.stats.accel], ['HANDLING', car.stats.handling]]
      .map(([k, v]) => `<div class="stat"><span>${k}</span><div class="sbar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`).join('');
    $('#swatches').innerHTML = paints.map((p, i) => `<i class="${i === paintIndex ? 'sel' : ''}" data-i="${i}" style="background:#${p.hex.toString(16).padStart(6, '0')}"></i>`).join('');
    $('#paintname').textContent = paints[paintIndex].name.toUpperCase();
  }

  hud(d) {
    const e = this.el, L = this.last;
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
    e.hud.classList.toggle('boosting', d.boosting);
    e.hud.classList.toggle('crashcam', d.camera);
    const m = `×${d.multiplier}`;
    if (L.mult !== m) { L.mult = m; e.mult.firstElementChild.textContent = m; e.mult.classList.remove('bump'); void e.mult.offsetWidth; e.mult.classList.add('bump'); }
    e.mult.classList.toggle('active', d.multiplier > 1 || d.chain > 0);
    e.chain.style.strokeDashoffset = `${this.chainLen * (1 - d.chain)}`;
    e.rpm.style.strokeDashoffset = `${this.rpmLen * (1 - Math.min(1, d.rpm))}`;
    const pw = d.ram > 0 ? 'ram-on' : d.power || '';
    if (L.power !== pw) {
      L.power = pw;
      const el = $('#h-power');
      el.className = `h-power ${pw ? 'show' : ''} p-${d.power || (d.ram > 0 ? 'ram' : '')}`;
      const names = { shockwave: 'SHOCKWAVE', ram: 'BATTERING RAM', strike: 'LIGHTNING STRIKE', 'ram-on': 'RAM ACTIVE' };
      $('.pname', el).textContent = names[pw] || '';
      $('.pkey', el).style.display = d.power ? '' : 'none';
    }
    if (d.ram > 0) $('#h-power .pbar i').style.width = `${d.ram * 100}%`;
    const banner = d.wrongWay ? 'WRONG WAY' : d.drafting ? 'SLIPSTREAM' : '';
    if (L.banner !== banner) { L.banner = banner; e.banner.textContent = banner; e.banner.className = banner ? (d.wrongWay ? 'bad show' : 'show') : ''; }
  }

  popup(title, sub = '', kind = '') {
    const p = document.createElement('div');
    p.className = `pop ${kind}`;
    p.innerHTML = `<div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
    this.el.popups.prepend(p);
    while (this.el.popups.children.length > 3) this.el.popups.lastChild.remove();
    setTimeout(() => p.classList.add('out'), kind === 'takedown' ? 1900 : 1400);
    setTimeout(() => p.remove(), kind === 'takedown' ? 2400 : 1900);
  }

  clearPopups() { this.el.popups.innerHTML = ''; this.el.countdown.innerHTML = ''; }

  countdown(text) {
    const c = this.el.countdown;
    c.innerHTML = `<span class="${text === 'GO!' ? 'go' : ''}">${text}</span>`;
    if (text === 'GO!') setTimeout(() => { if (c.textContent === 'GO!') c.innerHTML = ''; }, 900);
  }

  results(list, headline) {
    $('#r-head').innerHTML = headline;
    $('#results').innerHTML = `<div class="rrow hdr"><span>POS</span><span>DRIVER</span><span>CAR</span><span>TIME</span><span>BEST LAP</span></div>` +
      list.map((r) => `<div class="rrow${r.isPlayer ? ' me' : ''}" style="--c:#${r.paint.toString(16).padStart(6, '0')}">
        <span class="p">${r.pos}</span><span class="n"><i></i>${r.name}</span><span>${r.car}</span>
        <span>${r.time !== null ? formatTime(r.time) : 'DNF'}</span><span>${formatTime(r.best)}</span></div>`).join('');
  }

  error(msg) {
    $('#errtext').innerHTML = msg;
    this.show('error');
  }
}

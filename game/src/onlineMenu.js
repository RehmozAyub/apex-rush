// Online menus: your name, HOST (get a room code) / JOIN (type one), the lobby, and the race
// start handshake. The race itself runs in RaceSession + net/online.js.
import { MAPS } from './maps/index.js';
import { CARS, PAINTS, saveSettings } from './config.js';
import { host, join, onTick } from './net/peer.js';
import { Online, NET_VERSION } from './net/online.js';
import { CODE_CHARS } from './net/protocol.js';

const NAME_MAX = 12;
export const cleanName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const cleanCode = (s) => String(s || '').toUpperCase().split('').filter((c) => CODE_CHARS.includes(c)).join('').slice(0, 4);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (p) => '#' + PAINTS[p].hex.toString(16).padStart(6, '0');

export class OnlineFlow {
  constructor(game) {
    this.game = game;
    this.ui = game.ui;
    this.net = null; // Online, while connected
    this.role = null; // 'host' | 'guest'
    this.room = null; // host: { code, close }
    this.friend = null; // { name, car, paint }
    this.hostTrack = 0; // guest: the track the host picked (MAPS.length = RANDOM)
    this.index = { online: 0, join: 0, lobby: 0 };
    this.busy = false;
    this.build();
    // test runs in background tabs (?netsim / ?pump): keep the game loop going at 60 fps
    const q = new URLSearchParams(location.search);
    if (q.has('netsim') || q.has('pump')) {
      let last = 0;
      // (only when the browser has stopped drawing frames itself)
      onTick(() => { const t = performance.now(); if (game.renderer && t - (game.lastFrame ?? 0) > 50 && t - last >= 16.6) { last = t; game.frame(); } });
    }
  }

  get active() { return !!this.net || !!this.room; }
  get myName() { return cleanName(this.game.settings.onlineName) || 'DRIVER'; }
  handles(state) { return state === 'online' || state === 'join' || state === 'lobby'; }

  build() {
    const root = this.ui.root;
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstChild; root.insertBefore(el, root.querySelector('#rotate')); this.ui.screens[el.id.slice(2)] = el; return el; };
    add(`<section id="s-online" class="screen">
      <h1 class="head"><b>ONLINE</b> RACE</h1>
      <label class="o-field"><span>YOUR NAME</span><input id="o-name" maxlength="${NAME_MAX}" spellcheck="false" autocomplete="off" placeholder="TYPE A NAME"></label>
      <div class="menu" id="m-online"></div>
      <div class="o-msg" id="o-msg"></div>
      <div class="hints">TYPE YOUR NAME &nbsp;·&nbsp; ↑ ↓ SELECT &nbsp;·&nbsp; ENTER CONFIRM &nbsp;·&nbsp; ESC BACK</div>
    </section>`);
    add(`<section id="s-join" class="screen">
      <h1 class="head"><b>JOIN</b> A FRIEND</h1>
      <label class="o-field code"><span>ROOM CODE</span><input id="o-code" maxlength="4" spellcheck="false" autocomplete="off" placeholder="····"></label>
      <div class="menu" id="m-join"></div>
      <div class="o-msg" id="o-jmsg"></div>
      <div class="hints">TYPE THE 4-LETTER CODE YOUR FRIEND SEES &nbsp;·&nbsp; ENTER JOIN &nbsp;·&nbsp; ESC BACK</div>
    </section>`);
    add(`<section id="s-lobby" class="screen">
      <h1 class="head"><b>ONLINE</b> LOBBY</h1>
      <div class="o-room">ROOM CODE <b id="o-codeshow">····</b><em id="o-ping"></em></div>
      <div class="o-players" id="o-players"></div>
      <div class="menu" id="m-lobby"></div>
      <div class="o-msg" id="o-lmsg"></div>
    </section>`);
    this.hudPing = document.createElement('div');
    this.hudPing.className = 'o-hudping';
    this.ui.screens.hud.appendChild(this.hudPing);

    const name = root.querySelector('#o-name');
    name.addEventListener('input', () => { const v = cleanName(name.value); if (name.value.toUpperCase() !== v && name.value.trim().toUpperCase() !== v) name.value = v; });
    name.addEventListener('change', () => { this.game.settings.onlineName = cleanName(name.value); saveSettings(this.game.settings); });
    const code = root.querySelector('#o-code');
    code.addEventListener('input', () => { code.value = cleanCode(code.value); });
    this.ui.onMenuClick('m-online', (i) => { this.index.online = i; this.onlineSelect(i); });
    this.ui.onMenuClick('m-join', (i) => { this.index.join = i; this.joinSelect(i); });
    this.ui.onMenuClick('m-lobby', (i, e) => { this.index.lobby = i; this.lobbySelect(i, e); });
  }

  $(sel) { return this.ui.root.querySelector(sel); }
  msg(id, text, bad = false) { const el = this.$(id); el.textContent = text || ''; el.classList.toggle('bad', bad); }

  // --- ONLINE: name, host or join ---------------------------------------------------
  open() {
    const g = this.game;
    g.players = 1;
    g.state = 'online';
    this.ui.show('online');
    const name = this.$('#o-name');
    name.value = cleanName(g.settings.onlineName);
    this.msg('#o-msg', 'ONLINE RACES ARE YOU AND A FRIEND PLUS 6 AI');
    this.renderOnline();
    if (g.input.lastDevice !== 'pad' && !name.value) setTimeout(() => name.focus(), 50);
  }

  onlineItems() { return [{ label: 'HOST A GAME' }, { label: 'JOIN A GAME' }, { label: 'BACK' }]; }
  renderOnline() { this.ui.menu('m-online', this.onlineItems(), this.index.online); }

  saveName() {
    const g = this.game, v = cleanName(this.$('#o-name').value);
    g.settings.onlineName = v || g.settings.onlineName || `DRIVER ${10 + Math.floor(Math.random() * 90)}`;
    this.$('#o-name').value = g.settings.onlineName;
    saveSettings(g.settings);
  }

  onlineSelect(i) {
    if (this.busy) return;
    this.game.audio.blip(900, 0.06, 0.1);
    this.saveName();
    if (i === 0) this.startHosting();
    else if (i === 1) this.openJoin();
    else this.game.showTitle();
  }

  // --- JOIN: type the code ------------------------------------------------------------
  openJoin() {
    this.game.state = 'join';
    this.ui.show('join');
    this.msg('#o-jmsg', '');
    this.index.join = 0;
    this.ui.menu('m-join', [{ label: 'JOIN' }, { label: 'BACK' }], 0);
    const code = this.$('#o-code');
    code.value = '';
    setTimeout(() => code.focus(), 50);
  }

  async joinSelect(i) {
    if (this.busy) return;
    if (i === 1) { this.open(); return; }
    const code = cleanCode(this.$('#o-code').value);
    if (code.length !== 4) { this.msg('#o-jmsg', 'THE CODE HAS 4 LETTERS', true); return; }
    this.busy = true;
    this.msg('#o-jmsg', `CONNECTING TO ${code}…`);
    try {
      const link = await join(code);
      this.connect(link, 'guest');
      this.code = code;
      this.send({ type: 'hello', v: NET_VERSION, ...this.mine() });
      this.openLobby();
    } catch (e) {
      this.msg('#o-jmsg', e.text || "CAN'T CONNECT ON THIS NETWORK", true);
    }
    this.busy = false;
  }

  // --- HOST ---------------------------------------------------------------------------
  async startHosting() {
    this.busy = true;
    this.msg('#o-msg', 'OPENING A ROOM…');
    try {
      this.room = await host((link) => this.onGuest(link), (e) => this.msg('#o-lmsg', e.text, true));
      this.role = 'host';
      this.code = this.room.code;
      this.openLobby();
    } catch (e) {
      this.msg('#o-msg', e.text || "CAN'T REACH THE ONLINE SERVICE", true);
    }
    this.busy = false;
  }

  onGuest(link) {
    this.connect(link, 'host');
    this.lobbyNote('');
  }

  connect(link, role) {
    this.role = role;
    this.net = new Online(link, role, {
      onMessage: (m) => this.onMessage(m),
      onClosed: () => this.onClosed(),
      onResults: (list) => this.onHostResults(list),
    });
  }

  send(m) { if (this.net) this.net.send(m); }
  mine() { const s = this.game.sel; return { name: this.myName, car: s.car, paint: s.paint }; }
  lobbyInfo() { return { type: 'lobby', ...this.mine(), track: this.game.sel.track }; }

  // --- lobby ----------------------------------------------------------------------------
  openLobby(note = '') {
    const g = this.game;
    g.state = 'lobby';
    g.players = 1;
    this.ui.show('lobby');
    this.$('#o-codeshow').textContent = this.code || '····';
    this.index.lobby = Math.min(this.index.lobby, this.lobbyItems().length - 1);
    this.renderLobby();
    this.lobbyNote(note);
    if (this.role === 'host' && this.net) this.send(this.lobbyInfo());
  }

  lobbyNote(text, bad = false) {
    const waiting = this.role === 'host' ? (this.friend ? '' : 'WAITING FOR A FRIEND TO JOIN · SEND THEM THE CODE') : `WAITING FOR ${esc(this.friend ? this.friend.name : 'THE HOST')} TO START`;
    this.msg('#o-lmsg', text || waiting, bad);
  }

  lobbyItems() {
    const t = this.role === 'host' ? this.game.sel.track : this.hostTrack;
    const trackName = t >= MAPS.length ? 'RANDOM' : MAPS[t].name;
    if (this.role === 'host') {
      return [
        { label: 'START RACE', disabled: !this.friend },
        { label: 'TRACK', value: `‹ ${trackName} ›` },
        { label: 'CAR', value: CARS[this.game.sel.car].name },
        { label: 'LEAVE' },
      ];
    }
    return [{ label: 'TRACK', value: trackName, disabled: true }, { label: 'CAR', value: CARS[this.game.sel.car].name }, { label: 'LEAVE' }];
  }

  renderLobby() {
    if (this.game.state !== 'lobby') return;
    this.ui.menu('m-lobby', this.lobbyItems(), this.index.lobby);
    const card = (p, tag, waiting) => p
      ? `<div class="o-card"><i style="background:${hex(p.paint)}"></i><b>${esc(p.name)}</b><span>${tag}</span><em>${esc(CARS[p.car].name)}</em></div>`
      : `<div class="o-card empty"><b>${waiting}</b></div>`;
    const me = this.mine();
    this.$('#o-players').innerHTML = card(me, this.role === 'host' ? 'HOST · YOU' : 'YOU', '') + card(this.friend, this.role === 'host' ? 'FRIEND' : 'HOST', 'WAITING…');
    this.$('#o-ping').textContent = this.net && this.net.pingMs ? `PING ${this.net.pingMs} MS` : '';
  }

  lobbySelect(i, e) {
    const g = this.game, key = this.role === 'host' ? ['start', 'track', 'car', 'leave'][i] : ['track', 'car', 'leave'][i];
    if (key === 'start') {
      if (!this.friend) { this.lobbyNote('', false); g.audio.blip(300, 0.06, 0.08); return; }
      this.hostStart(g.sel.track);
    } else if (key === 'track') {
      if (this.role !== 'host') return;
      const r = e && e.target.closest('em') ? e.target.closest('em').getBoundingClientRect() : null;
      this.cycleTrack(r && e.clientX < (r.left + r.right) / 2 ? -1 : 1);
    } else if (key === 'car') {
      g.audio.blip(900, 0.06, 0.1);
      g.showCars(0);
    } else if (key === 'leave') this.leave();
  }

  cycleTrack(d) {
    const g = this.game, n = MAPS.length + 1;
    g.sel.track = (g.sel.track + d + n) % n;
    g.audio.blip(600, 0.03, 0.06);
    this.renderLobby();
    this.send(this.lobbyInfo());
    if (g.sel.track < MAPS.length) g.previewTrack();
  }

  // the car screen was confirmed (or backed out of) while online
  carChosen() {
    this.openLobby();
    if (this.role === 'guest') this.send({ type: 'me', ...this.mine() });
  }

  onAction(a, code) {
    const g = this.game, st = g.state;
    // typing in a text field: letters, digits, space and arrows belong to the field
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing && code && (/^(Key|Digit|Numpad)/.test(code) || code === 'Space' || code === 'Backspace' || code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Minus' || code === 'Period')) return;
    if (typing && (a === 'up' || a === 'down')) document.activeElement.blur();
    const move = (key, n, d) => { this.index[key] = (this.index[key] + d + n) % n; g.audio.blip(600, 0.03, 0.06); };
    if (st === 'online') {
      if (a === 'up' || a === 'down') { move('online', 3, a === 'up' ? -1 : 1); this.renderOnline(); }
      if (a === 'confirm') this.onlineSelect(this.index.online);
      if (a === 'back') { if (typing) document.activeElement.blur(); g.showTitle(); }
    } else if (st === 'join') {
      if (a === 'up' || a === 'down') { move('join', 2, a === 'up' ? -1 : 1); this.ui.menu('m-join', [{ label: 'JOIN' }, { label: 'BACK' }], this.index.join); }
      if (a === 'confirm') this.joinSelect(typing ? 0 : this.index.join);
      if (a === 'back') { if (typing) document.activeElement.blur(); this.open(); }
    } else if (st === 'lobby') {
      const n = this.lobbyItems().length;
      if (a === 'up' || a === 'down') { move('lobby', n, a === 'up' ? -1 : 1); this.renderLobby(); }
      if ((a === 'left' || a === 'right') && this.role === 'host' && this.index.lobby === 1) this.cycleTrack(a === 'left' ? -1 : 1);
      if (a === 'confirm' && code !== 'Space') this.lobbySelect(this.index.lobby);
      if (a === 'back') this.leave();
    }
  }

  // lobby messages from the other device
  onMessage(m) {
    const g = this.game;
    if (m.type === 'hello') {
      if (m.v !== NET_VERSION) { this.send({ type: 'refuse', why: 'version' }); return; }
      this.friend = { name: cleanName(m.name) || 'FRIEND', car: m.car | 0, paint: m.paint | 0 };
      this.send(this.lobbyInfo());
      g.audio.chime(2);
      if (g.state === 'lobby') { this.renderLobby(); this.lobbyNote(`${this.friend.name} JOINED`); }
    } else if (m.type === 'me') {
      this.friend = { name: cleanName(m.name) || 'FRIEND', car: m.car | 0, paint: m.paint | 0 };
      this.renderLobby();
    } else if (m.type === 'lobby') {
      this.friend = { name: cleanName(m.name) || 'HOST', car: m.car | 0, paint: m.paint | 0 };
      this.hostTrack = m.track | 0;
      if (g.state === 'lobby') { this.renderLobby(); this.lobbyNote(''); }
    } else if (m.type === 'refuse') {
      this.disconnect();
      this.open();
      this.msg('#o-msg', 'YOUR FRIEND HAS A DIFFERENT VERSION OF THE GAME', true);
    } else if (m.type === 'start') {
      this.raceStart(m);
    } else if (m.type === 'tolobby') {
      if (g.state !== 'lobby') this.backToLobby();
    } else if (m.type === 'bye') {
      this.onClosed();
    }
  }

  // --- races ------------------------------------------------------------------------------
  // host: pick the track (RANDOM rolls one) and a seed, tell the guest, start
  hostStart(track) {
    const g = this.game;
    if (!this.friend || this.starting) return;
    const t = track >= MAPS.length ? g.rollTrack() : track;
    const seed = (Math.random() * 2 ** 31) | 0;
    const me = this.mine();
    const m = { type: 'start', track: t, random: track >= MAPS.length, seed, players: [{ name: me.name, carIndex: me.car, paintIndex: me.paint }, { name: this.friend.name, carIndex: this.friend.car, paintIndex: this.friend.paint }] };
    this.send(m);
    this.raceStart(m);
  }

  async raceStart(m) {
    const g = this.game;
    this.starting = true;
    this.lastResults = null;
    g.raceTrack = m.track;
    await g.startRace(false, { net: { role: this.role, seed: m.seed }, players: m.players, random: m.random });
    this.starting = false;
    if (!this.net || !g.session) return;
    this.net.attach(g.session, m.seed);
    this.net.raceLoaded();
  }

  // results screen while online
  resultsItems() {
    if (!this.net) return [{ label: 'MAIN MENU' }];
    if (this.role === 'host') return [{ label: 'RACE AGAIN' }, { label: 'NEXT TRACK' }, { label: 'LOBBY' }];
    return [{ label: `WAITING FOR ${esc(this.friend ? this.friend.name : 'HOST')}…`, disabled: true }, { label: 'LEAVE' }];
  }

  resultsSelect(i) {
    const g = this.game;
    if (!this.net) { this.leave(); return; }
    if (this.role === 'host') {
      if (i === 0) this.hostStart(g.raceTrack);
      else if (i === 1) {
        // NEXT TRACK: the next card, or another random one when RANDOM was picked
        if (g.sel.track < MAPS.length) g.sel.track = (g.raceTrack + 1) % MAPS.length;
        this.hostStart(g.sel.track);
      }
      else { this.send({ type: 'tolobby' }); this.backToLobby(); }
    } else if (i === 1) this.leave();
  }

  // the host's results are the official ones; the guest shows those
  sendResults(list) { if (this.net && this.role === 'host') this.net.rsend({ type: 'results', list }); }

  onHostResults(list) {
    this.lastResults = list.map((r) => ({ ...r, isPlayer: r.owner === 'guest' && r.racer }));
    if (this.game.state === 'results') this.ui.resultRows(this.lastResults);
  }

  headline(list) {
    const me = list.find((r) => r.isPlayer), fr = list.find((r) => r.racer && !r.isPlayer);
    if (!me) return '<b>RESULTS</b>';
    if (!fr) return me.pos === 1 ? '<b>VICTORY</b>' : `<b>P${me.pos}</b> FINISH`;
    return me.pos < fr.pos ? `<b>YOU</b> BEAT ${esc(fr.name)}` : `<b>${esc(fr.name)}</b> WINS`;
  }

  async backToLobby() {
    const g = this.game;
    if (this.net) this.net.detach();
    g.ui.fade(true);
    await new Promise((r) => setTimeout(r, 350));
    g.endSession();
    g.setViews(1);
    g.buildShowroom();
    g.ui.overlay('hud', false);
    g.audio.setMenuMode(true);
    this.openLobby();
    g.ui.fade(false);
  }

  pauseItems() { return [{ key: 'resume', label: 'RESUME' }, { key: 'assist0', label: 'DRIVE ASSIST', value: this.game.assistOn(0) ? 'ON' : 'OFF' }, { key: 'settings', label: 'SETTINGS' }, { key: 'quit', label: 'LEAVE RACE' }]; }

  // every frame
  frame() {
    if (this.net) this.net.frame();
    const g = this.game;
    const show = this.net && g.session && (g.state === 'race' || g.state === 'pause');
    this.hudPing.textContent = show ? `${esc(this.friend ? this.friend.name : 'FRIEND')} · ${this.net.pingMs || '–'} MS` : '';
    this.hudPing.classList.toggle('show', !!show);
    if (g.state === 'lobby' && this.net && (this.pingShown !== this.net.pingMs)) { this.pingShown = this.net.pingMs; this.$('#o-ping').textContent = this.net.pingMs ? `PING ${this.net.pingMs} MS` : ''; }
  }

  // --- leaving ----------------------------------------------------------------------------
  onClosed() {
    const g = this.game;
    if (!this.net) return;
    const name = this.friend ? this.friend.name : this.role === 'host' ? 'YOUR FRIEND' : 'THE HOST';
    const inRace = g.session && g.session.online && (g.state === 'race' || g.state === 'pause' || g.state === 'results' || g.state === 'loading');
    if (this.role === 'host') {
      // keep the room open: someone can join again from the lobby
      if (inRace && this.net.session) { this.net.takeOver(); g.session.popupAll(`${name} LEFT`, 'THEIR CAR IS AN AI NOW', 'bad'); }
      this.net = null;
      this.friend = null;
      if (g.state === 'lobby') { this.renderLobby(); this.lobbyNote(`${name} LEFT`, true); }
      if (g.state === 'results') g.renderResults();
    } else {
      this.disconnect();
      if (inRace) {
        g.session.popupAll(`${name} LEFT`, 'BACK TO THE MENU', 'bad');
        setTimeout(() => { if (!this.net) g.quitToMenu(); }, 2500);
      } else { this.open(); this.msg('#o-msg', `${name} LEFT`, true); }
    }
  }

  disconnect() {
    if (this.net) { this.net.detach(); const n = this.net; this.net = null; n.close(); }
    if (this.room) { this.room.close(); this.room = null; }
    this.friend = null;
    this.role = null;
  }

  leave() {
    const g = this.game;
    g.audio.blip(500, 0.06, 0.1);
    this.disconnect();
    if (g.session) g.quitToMenu(); else g.showTitle();
  }
}

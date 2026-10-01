// Connections for online play.
//
// A Link joins the two games: send(obj) / onMessage for reliable, ordered JSON events and
// sendState(buf) / onState for car states (unordered, never resent: a late state is useless).
//
// The real thing is WebRTC via PeerJS (vendor/peerjs). PeerJS's free cloud broker only does
// the handshake; the games then talk directly. PeerJS opens the reliable channel; the fast one
// is a second, pre-negotiated data channel on the same connection (no extra signalling).
// SimLink fakes a connection with lag, jitter and loss for tests: in one page (simPair) or
// between two tabs of the same browser (BroadcastChannel, ?netsim in the URL).
import { makeCode, peerId } from './protocol.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const FAST_ID = 42; // data channel id for car states (PeerJS's own channel uses a low id)
const TIMEOUT = { broker: 10000, join: 15000 };

export class NetError extends Error {
  constructor(code, text) { super(text); this.code = code; this.text = text; }
}

// --- Link base ---------------------------------------------------------------------
class Link {
  constructor() {
    this.onMessage = null;
    this.onState = null;
    this.onClose = null;
    this.closed = false;
    this.bytesOut = 0;
  }
  closedByPeer() {
    if (this.closed) return;
    this.closed = true;
    if (this.onClose) this.onClose();
  }
}

class PeerLink extends Link {
  constructor(conn, peer) {
    super();
    this.conn = conn;
    this.peer = peer;
    const pc = conn.peerConnection;
    this.fast = pc.createDataChannel('apex-state', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    this.fast.binaryType = 'arraybuffer';
    this.fast.onmessage = (e) => { if (this.onState) this.onState(e.data); };
    conn.on('data', (d) => { if (this.onMessage) this.onMessage(d); });
    conn.on('close', () => this.closedByPeer());
    conn.on('error', () => this.closedByPeer());
    // a dropped connection: give it a few seconds to come back
    let lost = null;
    pc.addEventListener('iceconnectionstatechange', () => {
      const s = pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') this.closedByPeer();
      else if (s === 'disconnected') { clearTimeout(lost); lost = setTimeout(() => { if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') this.closedByPeer(); }, 5000); }
    });
  }
  send(obj) { if (!this.closed) this.conn.send(obj); }
  sendState(buf) {
    if (this.closed || this.fast.readyState !== 'open') return;
    if (this.fast.bufferedAmount > 64 * 1024) return; // congested: skip, the next one is fresher
    this.fast.send(buf);
    this.bytesOut += buf.byteLength;
  }
  close() {
    this.closed = true;
    try { this.fast.close(); } catch {}
    try { this.conn.close(); } catch {}
    try { this.peer.destroy(); } catch {}
  }
}

// --- PeerJS -------------------------------------------------------------------------
let peerjsLoad = null;
function loadPeerJS() {
  if (window.peerjs) return Promise.resolve(window.peerjs);
  if (!peerjsLoad) {
    peerjsLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/peerjs/peerjs.min.js', import.meta.url).href;
      s.onload = () => resolve(window.peerjs);
      s.onerror = () => { peerjsLoad = null; reject(new NetError('load', 'COULD NOT LOAD ONLINE PLAY')); };
      document.head.appendChild(s);
    });
  }
  return peerjsLoad;
}

function brokerError(e) {
  if (e && e.type === 'peer-unavailable') return new NetError('nogame', 'NO GAME WITH THAT CODE');
  if (e && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed')) return new NetError('broker', "CAN'T REACH THE ONLINE SERVICE");
  if (e && e.type === 'browser-incompatible') return new NetError('browser', 'ONLINE PLAY NOT SUPPORTED HERE');
  return new NetError('network', "CAN'T CONNECT ON THIS NETWORK");
}

// Host a game. onGuest(link) is called when a friend connects (again if they leave and someone
// rejoins in the lobby). Resolves to { code, close() } once the code is registered.
export async function host(onGuest, onError = () => {}) {
  if (simMode()) return simHost(onGuest);
  const { Peer } = await loadPeerJS();
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = makeCode();
    const peer = new Peer(peerId(code), { config: { iceServers: ICE }, debug: 0 });
    const ok = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(new NetError('broker', "CAN'T REACH THE ONLINE SERVICE")), TIMEOUT.broker);
      peer.on('open', () => { clearTimeout(t); resolve(true); });
      peer.on('error', (e) => { clearTimeout(t); resolve(e && e.type === 'unavailable-id' ? 'taken' : brokerError(e)); });
    });
    if (ok === 'taken') { peer.destroy(); continue; }
    if (ok !== true) { peer.destroy(); throw ok; }
    let current = null;
    peer.removeAllListeners('error');
    peer.on('error', (e) => onError(brokerError(e)));
    peer.on('connection', (conn) => {
      if (current && !current.closed) { conn.on('open', () => conn.close()); return; } // one friend at a time
      conn.on('open', () => {
        current = new PeerLink(conn, { destroy() {} });
        onGuest(current);
      });
    });
    return { code, close() { if (current) current.close(); peer.destroy(); } };
  }
  throw new NetError('broker', "CAN'T REACH THE ONLINE SERVICE");
}

// Join the game with this code. Resolves to a Link, or rejects with a NetError.
export async function join(code) {
  if (simMode()) return simJoin(code);
  const { Peer } = await loadPeerJS();
  const peer = new Peer({ config: { iceServers: ICE }, debug: 0 });
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (err) => { if (done) return; done = true; clearTimeout(t); peer.destroy(); reject(err); };
    const t = setTimeout(() => fail(new NetError('network', "CAN'T CONNECT ON THIS NETWORK")), TIMEOUT.join);
    peer.on('error', (e) => fail(brokerError(e)));
    peer.on('open', () => {
      const conn = peer.connect(peerId(code), { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(new PeerLink(conn, peer));
      });
      conn.on('error', () => fail(new NetError('network', "CAN'T CONNECT ON THIS NETWORK")));
    });
  });
}

// --- simulated links (tests) --------------------------------------------------------
// opts: { latency (s, one way), jitter (s), loss (0..1, fast channel only) }
export const SIM = { latency: 0.05, jitter: 0.015, loss: 0.02 };

class SimLink extends Link {
  // post(kind, data): deliver to the other end; opts as SIM
  constructor(post, opts) {
    super();
    this.post = post;
    this.opts = opts;
    this.lastReliable = 0;
  }
  delay() { return Math.max(0, this.opts.latency + (Math.random() * 2 - 1) * this.opts.jitter) * 1000; }
  send(obj) {
    if (this.closed) return;
    // reliable + ordered: never overtakes the previous message
    const at = Math.max(performance.now() + this.delay(), this.lastReliable + 0.1);
    this.lastReliable = at;
    const data = JSON.parse(JSON.stringify(obj));
    setTimeout(() => this.post('msg', data), at - performance.now());
  }
  sendState(buf) {
    if (this.closed || Math.random() < this.opts.loss) return;
    const copy = buf.slice(0);
    this.bytesOut += buf.byteLength;
    setTimeout(() => this.post('state', copy), this.delay());
  }
  deliver(kind, data) {
    if (this.closed) return;
    if (kind === 'msg' && this.onMessage) this.onMessage(data);
    else if (kind === 'state' && this.onState) this.onState(data);
    else if (kind === 'close') this.closedByPeer();
  }
  close() { if (this.closed) return; this.post('close'); this.closed = true; }
}

// two linked ends in one page
export function simPair(opts = SIM) {
  let a = null, b = null;
  a = new SimLink((k, d) => b.deliver(k, d), opts);
  b = new SimLink((k, d) => a.deliver(k, d), opts);
  return [a, b];
}

// ?netsim[=latencyMs] in the URL: online play between two tabs of this browser, no network
function simMode() {
  try { return new URLSearchParams(location.search).has('netsim'); } catch { return false; }
}
function simOpts() {
  const v = Number(new URLSearchParams(location.search).get('netsim'));
  return v > 0 ? { ...SIM, latency: v / 1000, jitter: v / 3000 } : SIM;
}

function simChannel(code, me) {
  const bc = new BroadcastChannel(`apexrush-sim-${code}`);
  const link = new SimLink((kind, data) => bc.postMessage({ from: me, kind, data }), simOpts());
  bc.onmessage = (e) => { if (e.data.from !== me) link.deliver(e.data.kind, e.data.data); };
  const close = link.close.bind(link);
  link.close = () => { close(); setTimeout(() => bc.close(), 50); };
  return { bc, link };
}

async function simHost(onGuest) {
  const code = makeCode();
  const lobby = new BroadcastChannel('apexrush-sim-lobby');
  let current = null;
  lobby.onmessage = (e) => {
    if (e.data.type !== 'join' || e.data.code !== code) return;
    if (current && !current.closed) return;
    current = simChannel(code, 'host').link;
    lobby.postMessage({ type: 'welcome', code });
    onGuest(current);
  };
  return { code, close() { if (current) current.close(); lobby.close(); } };
}

function simJoin(code) {
  return new Promise((resolve, reject) => {
    const lobby = new BroadcastChannel('apexrush-sim-lobby');
    const t = setTimeout(() => { lobby.close(); reject(new NetError('nogame', 'NO GAME WITH THAT CODE')); }, 3000);
    lobby.onmessage = (e) => {
      if (e.data.type !== 'welcome' || e.data.code !== code) return;
      clearTimeout(t);
      lobby.close();
      resolve(simChannel(code, 'guest').link);
    };
    lobby.postMessage({ type: 'join', code });
  });
}

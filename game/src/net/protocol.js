// Online message format. Car states go over the fast (unreliable) channel as binary:
//   float64 shared time, uint8 car count, then per car STATE_FIELDS float32s.
// Everything else (lobby, race events) is JSON over the reliable channel.

export const STATE_FIELDS = ['idx', 'x', 'y', 'z', 'heading', 'vx', 'vz', 'yawRate', 'pitch', 'roll', 'bodyPitch', 'bodyRoll',
  'trickYaw', 'trickRoll', 'steer', 'slip', 's', 'lateral', 'scU', 'scIdx', 'flags'];
const N = STATE_FIELDS.length;

export const FLAG = { wrecked: 1, ghost: 2, boosting: 4, braking: 8, drifting: 16, air: 32, onSC: 64, scraping: 128 };

// the state of one car (Vehicle `v`, car index `idx` in the session, `boosting` from its owner)
export function carState(idx, v, scIdx, boosting, out = {}) {
  out.idx = idx;
  out.x = v.x; out.y = v.y; out.z = v.z;
  out.heading = v.heading; out.vx = v.vx; out.vz = v.vz; out.yawRate = v.yawRate;
  out.pitch = v.pitch; out.roll = v.roll; out.bodyPitch = v.bodyPitch; out.bodyRoll = v.bodyRoll;
  out.trickYaw = v.trickYaw || 0; out.trickRoll = v.trickRoll || 0;
  out.steer = v.steer; out.slip = v.slip;
  out.s = v.s; out.lateral = v.lateral; out.scU = v.onSC ? v.scU ?? 0 : 0; out.scIdx = v.onSC ? scIdx : -1;
  out.flags = (v.wrecked ? FLAG.wrecked : 0) | (v.ghost > 0 ? FLAG.ghost : 0) | (boosting ? FLAG.boosting : 0) | (v.braking ? FLAG.braking : 0)
    | (v.drifting ? FLAG.drifting : 0) | (v.air ? FLAG.air : 0) | (v.onSC ? FLAG.onSC : 0) | (v.scraping > 0.5 ? FLAG.scraping : 0);
  return out;
}

export function packStates(t, states) {
  const buf = new ArrayBuffer(9 + states.length * N * 4);
  const dv = new DataView(buf);
  dv.setFloat64(0, t, true);
  dv.setUint8(8, states.length);
  let o = 9;
  for (const st of states) for (const k of STATE_FIELDS) { dv.setFloat32(o, st[k], true); o += 4; }
  return buf;
}

export function unpackStates(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const t = dv.getFloat64(0, true);
  const n = dv.getUint8(8);
  if (dv.byteLength < 9 + n * N * 4) return null;
  const states = [];
  let o = 9;
  for (let i = 0; i < n; i++) {
    const st = {};
    for (const k of STATE_FIELDS) { st[k] = dv.getFloat32(o, true); o += 4; }
    st.idx = Math.round(st.idx); st.scIdx = Math.round(st.scIdx); st.flags = Math.round(st.flags);
    states.push(st);
  }
  return { t, states };
}

// 4-letter room codes (no 0/O, 1/I lookalikes)
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}
export const peerId = (code) => `apexrush-${code.toUpperCase()}`;

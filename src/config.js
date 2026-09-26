// Car specs, paint colours, quality presets.

// Car balance: every car spends a points budget (1-10 per trait) on SPEED, ACCEL, HANDLING and
// STRENGTH (weight in collisions). The physics numbers are derived from the points, so equal
// points means an equally quick car. Most cars sit on the base budget; a couple have one point more.
export const CAR_BUDGET = 24;
export function carPhysics({ speed, accel, handling, strength }) {
  return {
    topSpeed: 72 + speed * 1.6, // m/s
    accel: 7.4 + accel * 1.6,
    grip: 4.8 + handling * 0.52,
    turn: 1.52 + handling * 0.145,
    mass: 0.62 + strength * 0.1,
  };
}

const CAR_DEFS = [
  { id: 'viper', name: 'VIPER', desc: 'Wedge supercar. Explosive launch.', style: 'wedge', points: { speed: 6, accel: 9, handling: 6, strength: 3 } },
  { id: 'bolt', name: 'BOLT', desc: 'Chrome-trimmed grand tourer. Stable at speed.', style: 'gt', points: { speed: 8, accel: 5, handling: 6, strength: 5 } },
  { id: 'raptor', name: 'RAPTOR', desc: 'Compact hot hatch. Razor handling.', style: 'hatch', points: { speed: 5, accel: 7, handling: 9, strength: 3 } },
  { id: 'titan', name: 'TITAN', desc: 'Muscle brute. Wins every shoving match.', style: 'muscle', points: { speed: 7, accel: 6, handling: 5, strength: 7 } },
  { id: 'phantom', name: 'PHANTOM', desc: 'Hypercar. Blistering top end, light on its feet.', style: 'hyper', points: { speed: 9, accel: 7, handling: 6, strength: 3 } },
  { id: 'rogue', name: 'ROGUE', desc: 'Lifted rally hatch. Loves to slide.', style: 'rally', points: { speed: 6, accel: 7, handling: 7, strength: 4 } },
];

export const CARS = CAR_DEFS.map((d) => {
  const p = d.points;
  return {
    ...d, ...carPhysics(p),
    total: p.speed + p.accel + p.handling + p.strength,
    stats: { speed: p.speed / 10, accel: p.accel / 10, handling: p.handling / 10, strength: p.strength / 10 },
  };
});

export const PAINTS = [
  { name: 'Inferno', hex: 0xd4101e },
  { name: 'Blaze', hex: 0xff6a00 },
  { name: 'Solar', hex: 0xffc400 },
  { name: 'Venom', hex: 0x2ee86a },
  { name: 'Cyan', hex: 0x00b8ff },
  { name: 'Ultra', hex: 0x6a2cff },
  { name: 'Pearl', hex: 0xeef0f2 },
  { name: 'Carbon', hex: 0x16181c },
];

export const AI_NAMES = ['VORTEX', 'KAZE', 'NOVA', 'RAZOR', 'HAVOC', 'STRYKER', 'ONYX', 'BLITZ', 'VIXEN', 'DIESEL'];

export const QUALITY = {
  low: { label: 'LOW', pixelRatio: 0.75, shadow: 1024, bloom: true, blurSamples: 6, density: 0.45, shadows: true },
  medium: { label: 'MEDIUM', pixelRatio: 1.0, shadow: 2048, bloom: true, blurSamples: 8, density: 0.75, shadows: true },
  high: { label: 'HIGH', pixelRatio: 1.5, shadow: 2048, bloom: true, blurSamples: 12, density: 1.0, shadows: true },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];

export const LAPS = 3;
export const AI_COUNT = 7;
export const BOOST_SPEED = 1.32;
export const BOOST_ACCEL = 1.7;

export function loadSettings() {
  const def = { quality: 'high', motionBlur: true, master: 0.8, music: 0.55, assist: true, assist2: true, bestLaps: {} };
  try {
    const s = JSON.parse(localStorage.getItem('apexrush.settings') || '{}');
    return { ...def, ...s, bestLaps: { ...(s.bestLaps || {}) } };
  } catch {
    return def;
  }
}

export function saveSettings(s) {
  try { localStorage.setItem('apexrush.settings', JSON.stringify(s)); } catch { /* storage unavailable */ }
}

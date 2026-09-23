// Car specs, paint colours, quality presets.

export const CARS = [
  {
    id: 'viper', name: 'VIPER', desc: 'Wedge supercar. Explosive launch.',
    style: 'wedge', topSpeed: 80, accel: 19, grip: 7.5, turn: 2.35, mass: 1.0,
    stats: { speed: 0.78, accel: 0.95, handling: 0.72 },
  },
  {
    id: 'bolt', name: 'BOLT', desc: 'Chrome-trimmed grand tourer. Stable at speed.',
    style: 'gt', topSpeed: 88, accel: 15.5, grip: 6.8, turn: 2.1, mass: 1.25,
    stats: { speed: 0.9, accel: 0.7, handling: 0.58 },
  },
  {
    id: 'raptor', name: 'RAPTOR', desc: 'Compact hot hatch. Razor handling.',
    style: 'hatch', topSpeed: 75, accel: 17.5, grip: 9.2, turn: 2.75, mass: 0.85,
    stats: { speed: 0.64, accel: 0.83, handling: 0.97 },
  },
  {
    id: 'titan', name: 'TITAN', desc: 'Muscle brute. Wins every shoving match.',
    style: 'muscle', topSpeed: 84, accel: 18.5, grip: 6.6, turn: 2.05, mass: 1.5,
    stats: { speed: 0.84, accel: 0.9, handling: 0.5 },
  },
  {
    id: 'phantom', name: 'PHANTOM', desc: 'Hypercar. Blistering top end, light on its feet.',
    style: 'hyper', topSpeed: 92, accel: 17, grip: 7.2, turn: 2.2, mass: 0.95,
    stats: { speed: 1.0, accel: 0.82, handling: 0.66 },
  },
  {
    id: 'rogue', name: 'ROGUE', desc: 'Lifted rally hatch. Loves to slide.',
    style: 'rally', topSpeed: 78, accel: 17.5, grip: 8.6, turn: 2.65, mass: 1.1,
    stats: { speed: 0.7, accel: 0.85, handling: 0.9 },
  },
];

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
  const def = { quality: 'high', motionBlur: true, master: 0.8, music: 0.55, bestLaps: {} };
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

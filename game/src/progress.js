// Player progress (pure logic): three stars per track, lifetime takedowns and earned paints.
// Stored inside the settings object (localStorage) by main.js.

export const STARS = [
  { id: 'win', name: 'WINNER', desc: 'Win the race' },
  { id: 'wrecker', name: 'WRECKER', desc: '5 takedowns in one race' },
  { id: 'clean', name: 'CLEAN RUN', desc: 'Finish without crashing' },
];
export const STAR_TAKEDOWNS = 5;

// Which stars a finished race earned: { pos, takedowns, crashes }
export function starsEarned({ pos, takedowns, crashes }) {
  return [pos === 1, takedowns >= STAR_TAKEDOWNS, crashes === 0];
}

export function emptyProgress() {
  return { stars: {}, signatures: {}, totalTakedowns: 0 };
}

export function starCount(progress) {
  return Object.values(progress.stars).reduce((a, arr) => a + arr.filter(Boolean).length, 0);
}

// Merge a race result into progress. Returns what is new: { stars: [index...], paints: [paint...] }
export function recordRace(progress, mapId, result, paints) {
  const before = unlockedPaints(progress, paints);
  const cur = progress.stars[mapId] || [false, false, false];
  const got = starsEarned(result);
  const newStars = [];
  got.forEach((g, i) => { if (g && !cur[i]) newStars.push(i); });
  progress.stars[mapId] = cur.map((c, i) => c || got[i]);
  progress.totalTakedowns += result.takedowns;
  const after = unlockedPaints(progress, paints);
  return { stars: newStars, paints: paints.filter((p, i) => after[i] && !before[i]) };
}

// Mark a signature spot found; true when it is new.
export function discoverSignature(progress, mapId, sigId) {
  const list = progress.signatures[mapId] || (progress.signatures[mapId] = []);
  if (list.includes(sigId)) return false;
  list.push(sigId);
  return true;
}

// For each paint: is it available? (paints without `unlock` always are)
export function unlockedPaints(progress, paints) {
  const stars = starCount(progress);
  return paints.map((p) => {
    if (!p.unlock) return true;
    if (p.unlock.takedowns) return progress.totalTakedowns >= p.unlock.takedowns;
    if (p.unlock.stars) return stars >= p.unlock.stars;
    return true;
  });
}

export function unlockText(p) {
  if (!p.unlock) return '';
  return p.unlock.takedowns ? `${p.unlock.takedowns} TAKEDOWNS` : `${p.unlock.stars} STARS`;
}

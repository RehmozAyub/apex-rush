// Lap counting, positions and timing (pure logic).

export class RaceTracker {
  constructor(trackLength, laps, ids) {
    this.L = trackLength;
    this.laps = laps;
    this.startTime = 0;
    this.entries = ids.map((id) => ({
      id,
      lap: -1, // cars start behind the line; the first crossing starts lap 1
      maxLap: -1,
      lastS: null,
      progress: 0,
      finished: false,
      finishTime: null,
      lapStart: 0,
      lapTimes: [],
      bestLap: null,
    }));
    this.byId = new Map(this.entries.map((e) => [e.id, e]));
    this.finishOrder = [];
  }

  start(time) {
    this.startTime = time;
    for (const e of this.entries) e.lapStart = time;
  }

  // Returns 'lap' when a new lap was completed, 'finish' on the final crossing, else null.
  update(id, s, time) {
    const e = this.byId.get(id);
    const L = this.L;
    let result = null;
    if (e.lastS !== null && !e.finished) {
      if (e.lastS > L * 0.75 && s < L * 0.25) {
        e.lap++;
        if (e.lap > e.maxLap) {
          e.maxLap = e.lap;
          if (e.lap >= 1) {
            const t = time - e.lapStart;
            e.lapTimes.push(t);
            if (e.bestLap === null || t < e.bestLap) e.bestLap = t;
            e.lapStart = time;
            result = 'lap';
          }
          if (e.lap >= this.laps) {
            e.finished = true;
            e.finishTime = time - this.startTime;
            this.finishOrder.push(e.id);
            result = 'finish';
          }
        }
      } else if (e.lastS < L * 0.25 && s > L * 0.75) {
        e.lap--;
      }
    }
    e.lastS = s;
    if (!e.finished) e.progress = e.lap * L + s;
    return result;
  }

  standings() {
    return [...this.entries].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  position(id) {
    return this.standings().findIndex((e) => e.id === id) + 1;
  }

  displayLap(id) {
    const e = this.byId.get(id);
    return Math.max(1, Math.min(this.laps, e.maxLap + 1));
  }
}

export function formatTime(t) {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

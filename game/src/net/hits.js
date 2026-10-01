// Online hits between the two players: earliest hit wins.
//
// Both devices see a contact between the two player cars at almost the same moment, but not
// quite the same way (each sees the other car predicted across the lag). Each sends the host a
// claim stamped with the shared clock: who rammed whom, and whether it was a takedown or a push.
// The host pairs up the two claims for the same contact and the earliest one decides. A claim
// the other side never matched stands if the cars really were that close at that moment
// (the caller's `plausible` check, allowing for the lag).
export const HIT = {
  pairWindow: 0.3, // s: claims this close in time are the same contact
  extra: 0.08, // s: wait a round trip plus this for the other side's claim
  cooldown: 0.5, // s: after an outcome, further claims about the same contact are ignored
};

export class HitJudge {
  constructor() {
    this.pending = []; // { claims: [], deadline }
    this.lastOutcome = -Infinity; // claim time of the last decided contact
  }

  // claim: { from: 'host' | 'guest', t, attacker: 'host' | 'guest', kind: 'takedown' | 'push', nx, nz, closing }
  // `now`: host shared time it arrived; `rtt`: current round trip (s)
  // Returns an outcome when this claim completes a pair, else null.
  add(claim, now, rtt) {
    if (claim.t - this.lastOutcome < HIT.cooldown && claim.t >= this.lastOutcome - HIT.pairWindow) return null;
    const p = this.pending.find((q) => Math.abs(q.claims[0].t - claim.t) < HIT.pairWindow);
    if (p) {
      const mine = p.claims.find((c) => c.from === claim.from);
      if (mine) { if (claim.t < mine.t) p.claims[p.claims.indexOf(mine)] = claim; return null; } // the same side again
      p.claims.push(claim);
      this.pending.splice(this.pending.indexOf(p), 1);
      return this.decide(p.claims);
    }
    this.pending.push({ claims: [claim], deadline: now + rtt + HIT.extra });
    return null;
  }

  // lone claims whose wait ran out: kept if plausible(claim). Returns the outcomes.
  update(now, plausible) {
    const out = [];
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (now < p.deadline) continue;
      this.pending.splice(i, 1);
      const c = p.claims[0];
      if (plausible(c)) { const o = this.decide([c]); if (o) out.push(o); }
    }
    return out;
  }

  // the earliest claim decides who was the attacker and what kind of hit it was
  decide(claims) {
    const first = claims.reduce((a, c) => (c.t < a.t ? c : a));
    if (first.t - this.lastOutcome < HIT.cooldown) return null;
    this.lastOutcome = first.t;
    return { attacker: first.attacker, victim: first.attacker === 'host' ? 'guest' : 'host', kind: first.kind, nx: first.nx, nz: first.nz, t: first.t, paired: claims.length > 1 };
  }
}

// is a lone claim believable? a, b: the two cars' positions at the claim time (History.at);
// rtt: round trip (s). Cars touch at about 5 m centre to centre; allow for how far they move in
// the one-way lag, plus slack.
export function plausibleContact(a, b, rtt) {
  if (!a || !b) return false;
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  return d <= 5 + Math.max(a.speed, b.speed) * (rtt / 2) + 1.5;
}

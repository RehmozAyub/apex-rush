// Shared race clock for online play. The host's clock is the reference; the guest estimates the
// offset to it from ping round trips (the sample with the lowest round trip is the most accurate),
// and eases toward new estimates so the shared time never jumps backwards.
export const CLOCK = {
  interval: 1, // seconds between pings
  keep: 8, // samples kept
  ease: 0.004, // max seconds the offset moves per new sample once synced
  snap: 0.25, // ...unless it is this far off (first sync, a stall)
};

export class NetClock {
  // reference: true on the host (offset stays 0); now(): local time in seconds
  constructor(reference, now = () => performance.now() / 1000) {
    this.reference = reference;
    this.now = now;
    this.offset = 0;
    this.rtt = 0;
    this.samples = [];
    this.synced = reference;
    this.nextPing = 0;
  }

  shared() { return this.now() + this.offset; }

  // a ping to send now, or null; call every frame
  poll() {
    const t = this.now();
    if (t < this.nextPing) return null;
    this.nextPing = t + CLOCK.interval;
    return { type: 'ping', a: t };
  }

  // the other side pinged: answer with our shared time
  reply(msg) { return { type: 'pong', a: msg.a, b: this.shared() }; }

  // our ping came back: { a: when we sent it (local), b: their shared time when they answered }
  onPong(msg) {
    const t = this.now();
    const rtt = Math.max(0, t - msg.a);
    this.samples.push({ rtt, est: msg.b + rtt / 2 - t });
    if (this.samples.length > CLOCK.keep) this.samples.shift();
    const best = this.samples.reduce((a, s) => (s.rtt < a.rtt ? s : a));
    // the HUD shows a smoothed round trip (the best recent one is too optimistic)
    this.rtt = this.rtt ? this.rtt + (rtt - this.rtt) * 0.3 : rtt;
    if (this.reference) return;
    const d = best.est - this.offset;
    if (!this.synced || Math.abs(d) > CLOCK.snap) { this.offset = best.est; this.synced = true; }
    else this.offset += Math.max(-CLOCK.ease, Math.min(CLOCK.ease, d));
  }

  // one-way latency estimate (s)
  get latency() { return this.rtt / 2; }
}

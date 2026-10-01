# APEX RUSH online: 2 players, room code (v2.0)

Two friends race each other over the internet, each on their own device. There are 8 cars in all: the 2 players plus 6 AI. Single player and local split screen stay exactly as they are.

## Decisions

| Topic | Decision |
|---|---|
| Players | 2 online players and 6 AI on the normal 8-car grid, with both players mid-pack (grid slots 4 and 5) |
| Connection | WebRTC peer to peer through PeerJS (MIT licence, vendored under `game/vendor/peerjs`). The free PeerJS cloud broker is used only for the handshake; Google's public STUN servers handle NAT. |
| Relay (TURN) | None for now. A failed connection shows "Can't connect on this network". |
| Room code | 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. The host's peer id is `apexrush-<code>`. |
| Car updates | 60 Hz in both directions over an unordered, unreliable channel. The host sends its own car plus 6 AI cars; the guest sends its own car. About 20–25 KB/s in total. |
| Events | A separate reliable, ordered channel |
| Smoothing | Remote cars are drawn predicted forward by the one-way latency, using velocity and yaw rate. Corrections blend in over 150 ms. A jump over 12 m (respawn) snaps. |
| Hit between the two players | The earliest hit on the shared clock wins (see "Hit rules") |
| Takedown feedback online | Popup, flash and shake, plus signature cards. No slow-mo. The victim gets the crash cam; the attacker does not. |
| Pause online | Opens the menu without stopping the race. The local car brakes while the menu is open. |
| Disconnects | If the guest leaves, its car becomes an AI and the host keeps racing. If the host leaves, the guest sees "HOST LEFT" and returns to the menu. Progress earned is kept on both sides. |

## Ownership

Every car is owned by exactly one device. Only the owner runs that car's physics. The other device shows a smoothed copy.

| Thing | Owner / decided by |
|---|---|
| Each player's car | that player's device |
| The 6 AI cars (driving, AI power-up use, respawns) | the host |
| Pickup blocks (taken and respawned) | the host. Pickups are applied optimistically on the guest; when two claims collide, the earliest one wins. |
| Race tracker, finish order, results | the host. The guest reports its own finish time on the shared clock. |
| Player vs AI contact (bump, takedown, rammed by AI) | the player's device. The host rewinds the AI to the claim time and accepts the claim if it fits the tolerance. |
| Player vs player contact | the hit rules below |
| Power-up hits (ricochet, oil, shockwave, strike) | The firer aims. The device that owns the car being hit applies the wreck. |
| Fences, sparks, smoke, audio | local cosmetics on each device |

AI rubber-banding and targeting use both players' positions, which the host has.

## Shared clock and ping

The devices exchange ping messages every second. The game keeps the 8 most recent samples and uses the one with the lowest round-trip time to estimate `offset = remoteTime + rtt/2 - localTime`, smoothed so the clock never jumps. Every message carries a shared-clock time. The HUD shows the round-trip time in ms.

The race start is scheduled at shared time `T = now + 1.5 s`, so both countdowns hit GO together.

## Hit rules (player vs player)

1. Each device detects contact between its own car and the smoothed remote car using the existing `collide()` geometry. It applies the bump, sparks and sound to **its own car only, immediately**.
2. If the contact is strong enough for `classifyImpact` to call it a takedown or a push, the device sends a claim: `{t, attackerIsMe, closing, share, nx, nz}`.
3. The host gathers claims for each contact within `rtt + 80 ms`:
   - With two claims, the earliest `t` decides who is the attacker.
   - With one claim, it stands only if the remote car's reported position at `t` (from the host's state history) lay within `speed × rtt/2 + 1.5 m` of the claimed contact point.
4. The host broadcasts the outcome. The victim's device wrecks its own car. Takedown credit, payback, signatures and kill counts work as in single player.
5. A wrecked, ghosted or airborne car never takes part, the same as offline.

## Message format

- **State** (60 Hz, binary `Float32Array`): `[t, carIndex, x, y, z, heading, vx, vz, yawRate, pitch, roll, flags]` per car. `flags` packs wrecked, ghost, boosting, onSC, air, braking and drifting.
- **Events** (reliable, JSON):
  - lobby: `hello`, `pick` (car / paint), `ready`, `start` (track, seed, T);
  - race: `pickup`, `power`, `claim`, `outcome`, `wreck`, `respawn`, `finish`, `results`;
  - after the race: `next` (host's choice), `bye`.
- The `start` message carries the AI seed, so both devices build the same AI names, paints, numbers and cars.

## Code layout

| File | Purpose |
|---|---|
| `src/net/peer.js` | PeerJS wrapper for hosting and joining, the two channels and connection errors, plus `LoopbackLink`, a fake connection with latency, jitter and loss for tests |
| `src/net/clock.js` | Ping and the shared-clock offset |
| `src/net/protocol.js` | Packing and unpacking messages |
| `src/net/remoteCar.js` | Snapshot buffer, prediction and correction blending (pure) |
| `src/net/hits.js` | Hit-claim arbitration (pure) |
| `src/net/online.js` | `OnlineRace`: roles, the send and receive loop, and the hooks into `RaceSession` |
| `src/session.js` | `c.remote` cars skip physics and AI and take smoothed states. Hooks for contacts, takedowns, pickups and powers. Slow-mo is off online. There is one local human view. |
| `src/main.js`, `src/ui.js` | The ONLINE menu, HOST and JOIN screens, the lobby, the ping HUD, waiting states and disconnect messages |

## Menus

- **Main menu:** a new **ONLINE** entry, then **HOST** or **JOIN**.
- **Host:** shows the code. Picks the track (RANDOM allowed) and a car. Waits for the guest, then **START**.
- **Join:** a code entry field (keyboard or controller letter picker), then a car pick, then "waiting for host".
- **Results:** the host picks NEXT TRACK, RACE AGAIN or MAIN MENU. The guest sees "waiting for host".

## Testing

- **Node unit tests:**
  - clock offset under 100 ms ±30 ms jitter (error below 10 ms);
  - prediction error at 300 km/h with 60 ms latency;
  - message packing round trips;
  - every hit-rule case: two claims, one claim, an out-of-tolerance claim, and a wrecked or airborne car.
- **Node full-race test:** two `RaceSession`s connected through `LoopbackLink` with 100 ms ±30 ms latency and 2% loss, both on autopilot for a full race. Both must agree on finish order, takedown counts and which cars got wrecked. Car positions must stay within 3 m of the owner's version once corrections settle.
- **Browser:** two tabs in the preview pane connected through the real PeerJS broker, racing on autopilot, with a check that both reach the same results.
- **Exe:** the exe against a browser tab, using a throwaway `--user-data-dir`.

## Not in scope

More than 2 online players, online split screen, a relay server, a self-hosted broker, cheat protection, and voice or text chat.

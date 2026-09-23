# APEX RUSH

Arcade 3D takedown racing in the browser — Burnout-style boost, takedowns and power-ups across six tracks.

**Play now:** https://rehmozayub.github.io/apex-rush/
**Windows exe:** see [Releases](https://github.com/RehmozAyub/apex-rush/releases) (portable, no install)

## Features

- 6 tracks with their own weather: Sunset Coast, Neon City, Alpine Pass, Whiteout Summit (snowfall), Scorched Canyon (dust storm), Monsoon Jungle (thunderstorm)
- 6 cars — Viper, Bolt, Raptor, Titan, Phantom, Rogue — 8 cars per race
- **2-player split screen** on one keyboard (or two gamepads) — take each other out too
- Boost meter filled by drifting, near misses, slipstreaming and takedowns, with an adrenaline chain multiplier up to ×5
- Takedowns with slow-motion crash cam; rivals can take you out too
- Road pickups: boost rings that respawn, and power-ups — **Shockwave** (wrecks everyone near you), **Ricochet** (a shot that bounces down the road until it hits a rival), **Lightning Strike** (hits the car ahead), **Oil Slick** (drop it behind you — chasers crash)
- Motion blur, speed lines, bloom, chromatic aberration, synthesized engine sounds and music

## Controls

| Action | 1 player | 2P · Player 1 | 2P · Player 2 | Gamepad |
|---|---|---|---|---|
| Drive | WASD / arrows | W A S D | Arrows | RT / LT / stick |
| Drift | Space | Space | Right Ctrl or Numpad 0 | X |
| Boost | Shift | Left Shift | Right Shift | A |
| Use power-up | E | E | Enter | LB |
| Camera | C | C | \ | Y |
| Reset car | R | R | ] | |
| Pause | Esc | Esc | Esc | Start |

With two gamepads connected, the first controls player 1 and the second player 2. The in-game **How to Play** screen shows all of this too.

## Development

The game is plain ES modules with a vendored copy of three.js — no bundler.

```bash
py -3 tools/serve.py        # http://localhost:5173 (no-cache dev server)
node --test tests/logic.test.js
node tools/build.mjs         # builds release/ApexRush.exe with Electron
```

# APEX RUSH

Arcade 3D takedown racing in the browser — Burnout-style boost, takedowns and power-ups across six tracks.

**Play now:** https://rehmozayub.github.io/apex-rush/
**Windows exe:** see [Releases](https://github.com/RehmozAyub/apex-rush/releases) (portable, no install)

## Features

- 6 tracks with their own weather: Sunset Coast, Neon City, Alpine Pass, Whiteout Summit (snowfall), Scorched Canyon (dust storm), Monsoon Jungle (thunderstorm)
- 6 cars — Viper, Bolt, Raptor, Titan, Phantom, Rogue — 8 cars per race
- Boost meter filled by drifting, near misses, slipstreaming and takedowns, with an adrenaline chain multiplier up to ×5
- Takedowns with slow-motion crash cam; rivals can take you out too
- Road pickups: boost rings that respawn, and power-ups — **Shockwave**, **Battering Ram**, **Lightning Strike**
- Motion blur, speed lines, bloom, chromatic aberration, synthesized engine sounds and music

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate / brake | W / S or ↑ / ↓ | RT / LT |
| Steer | A / D or ← / → | Left stick |
| Drift | Space | X |
| Boost | Shift | A |
| Use power-up | E | LB |
| Camera | C | Y |
| Reset car | R | |
| Pause | Esc | Start |

## Development

The game is plain ES modules with a vendored copy of three.js — no bundler.

```bash
py -3 tools/serve.py        # http://localhost:5173 (no-cache dev server)
node --test tests/logic.test.js
node tools/build.mjs         # builds release/ApexRush.exe with Electron
```

# APEX RUSH — Design Spec

A stylish arcade 3D racing game with Burnout-style aggression, shipped as a portable Windows `.exe`.

## Goals

- Double-click `release\ApexRush.exe` → game runs. No install, no internet needed.
- Good-looking: PBR cars with clearcoat paint, soft shadows, bloom, filmic tone mapping, heavy speed FX.
- Stylish UI: bold italic condensed type (Windows' built-in *Bahnschrift*), angled panels, animated transitions.
- Core loop: pick track + car → 3-lap race vs 5 AI → results.

## Tech / architecture

- **Three.js** (vendored ES module, no bundler) rendered in **Electron**, packaged by **electron-builder** `portable` target.
- Electron serves the game through a privileged custom `app://` protocol (ES modules don't load reliably from `file://`). WebGL context requests `powerPreference: "high-performance"` and Electron sets `ignore-gpu-blocklist` so the NVIDIA GPU is used.
- Project stays tiny in Google Drive; `node_modules` and build happen on `C:` (`%LOCALAPPDATA%\ApexRushBuild`) via `build.ps1`, which copies the finished exe back to `release\`.

```
NFS_II_SE/
  game/
    index.html          import map → vendor/three
    style.css
    vendor/three/       three.module.js + needed addons
    src/
      main.js           boot, game-state machine (menu → race → results), main loop
      config.js         cars, tuning constants, quality presets
      input.js          keyboard + gamepad → {steer, throttle, brake, handbrake, boost}
      renderer.js       WebGLRenderer, EffectComposer, custom FX pass (motion blur etc.)
      track.js          closed spline track → road/barrier/kerb meshes + track-space queries
      maps/coast.js     Sunset Coast scenery + lighting
      maps/city.js      Neon City scenery + lighting
      maps/alpine.js    Alpine Pass scenery + lighting
      carModel.js       procedural car meshes (3 body styles, paint colors, lights)
      vehicle.js        arcade vehicle dynamics in track space
      ai.js             AI drivers
      race.js           laps, positions, timing, countdown, finish
      burnout.js        boost meter, adrenaline chain, near miss, drafting, takedowns, crashes
      fx.js             particles: sparks, tire smoke, exhaust flames, debris, skid marks
      camera.js         chase / hood / bumper cams, crash cam, shake, speed FOV
      audio.js          Web Audio synth: engine, tires, impacts, boost, music loop
      ui.js             menus + HUD (DOM overlay)
      minimap.js        2D canvas minimap
  electron/main.js, electron/package.json
  build.ps1
  tests/                node:test unit tests for pure logic (track math, race ordering, burnout rules)
  release/ApexRush.exe
```

## Track model

Each map defines a closed list of control points (x, y, z) + road width. `track.js` builds a Catmull-Rom spline, samples it densely, and exposes **track-space** queries: world position ⇄ `(s, lateral)` where `s` is distance along the track and `lateral` the signed offset from centerline. Road, kerbs, barriers and the start/finish gantry are generated meshes. Barriers sit at `±(width/2)`; the car is kept inside them by collision. Height follows the spline so roads can climb and dip.

## Vehicle (arcade)

State: position, heading, velocity (2D in the ground plane), angular velocity, derived height/pitch/roll from the road. Forces: engine (per-car accel curve, top speed), braking, drag, lateral grip (reduced under handbrake → drift), steering sensitivity falling with speed. Drift: slip angle above threshold = drifting (smoke, squeal, boost gain). Barrier contact: push back inside, damp speed by impact angle, sparks when scraping. Car-vs-car: circle collision with impulse exchange (mass per car).

Three cars:

| Car    | Style           | Top speed | Accel | Handling |
|--------|-----------------|-----------|-------|----------|
| Viper  | wedge supercar  | medium    | high  | medium   |
| Bolt   | long GT         | high      | medium| low      |
| Raptor | compact hot-hatch| low      | medium| high     |

Player picks a car and a paint color. AI get random cars/colors.

## Burnout mechanics (`burnout.js`)

- **Boost meter** (0–100, segmented bar). Filled by: drifting (per second), **near miss** (pass an AI within 1.2 m lateral gap at ≥ 25 km/h relative speed), **drafting** (≤ 14 m directly behind an AI), **takedown** (+35). Holding boost (Shift / gamepad A) drains it: +35 % top speed, stronger accel.
- **Adrenaline chain**: each event within 4 s of the last raises a multiplier (×1 → ×5) that multiplies boost gain; shown as a pulsing HUD counter; resets when the timer runs out or on a crash.
- **Takedown**: an AI is wrecked when the player hits it with impact impulse above a threshold, or when the player's contact pushes it into a barrier within 0.8 s. Result: slow motion (time scale 0.25 for ~1.3 s), crash cam cuts to the wreck, the wreck tumbles (ballistic + spin) throwing sparks and debris, "TAKEDOWN!" banner, counter +1. The AI respawns on the centerline 3 s later.
- **Player crash**: a head-on barrier hit (angle > 50° at > 120 km/h) or a big AI ram wrecks the player: slow-mo crash cam, boost chain lost, respawn after 2.5 s. AI are sometimes aggressive and try to ram the player, so the player can be taken down too.

## AI

Follow a racing line = centerline plus a per-driver lateral preference, with look-ahead steering. Target speed is derived from upcoming curvature. Rubber-banding: speed multiplier 0.92–1.08 based on the gap to the player. They avoid cars directly ahead by shifting lane, use boost on straights, and have an aggression value that makes them steer into a nearby player.

## Race

Countdown 3-2-1-GO (cars held), 3 laps, position = laps completed + `s` progress. Lap times, best lap, final standings, takedowns count. Results screen with Restart / Menu.

## Visuals

- `ACESFilmicToneMapping`, sRGB output, PMREM environment from each map's sky → reflective clearcoat paint and glass.
- Directional sun with PCF soft shadows following the player; hemisphere fill light.
- Post chain: RenderPass → UnrealBloom → **FX pass** (custom shader: radial motion blur scaled by speed and boost, chromatic aberration on boost and impacts, vignette, subtle grain, boost color grade) → OutputPass → FXAA.
- Speed FOV 62° → 88°, screen-space speed lines, camera shake on hits/boost, exhaust flames on boost, tire smoke, sparks, skid-mark trails.
- **Sunset Coast**: gradient sunset sky + sun disc, animated shader ocean, cliffs, instanced palm trees, warm fog.
- **Neon City**: night sky, instanced towers with emissive window textures (canvas-generated), neon strips and signs, glossy wet asphalt, strong bloom, blue/magenta fog.
- **Alpine Pass**: bright blue sky, rolling terrain, instanced pines, snowy peaks, light haze.
- Quality presets Low / Medium / High (shadow resolution, pixel ratio, bloom, scenery density). Default High; auto-drops a level if average FPS < 40 for 3 s during a race.

## Audio

All synthesized (no asset files): engine (oscillators through filters, pitch from RPM with simulated gears), tire squeal (filtered noise ∝ slip), impacts/crashes (noise burst + low thump), boost whoosh, near-miss swish, and a per-map synthwave loop (kick, hats, bass arpeggio). Master/music volume in Settings.

## UI

Title (rotating car on a turntable, "PRESS ENTER") → Track select (3 angled cards) → Car select (3D preview, stat bars, color swatches) → Race HUD (speed + tacho arc, position, lap, lap timer, boost bar, adrenaline multiplier, minimap, event pop-ups) → Pause (Esc: resume / restart / quit) → Results. Settings: quality, motion blur on/off, volumes. Everything works with keyboard or gamepad.

Controls: W/↑ throttle, S/↓ brake/reverse, A/D/←/→ steer, Space handbrake, Shift boost, C camera, Esc pause, R reset car to track.

## Error handling

- WebGL unavailable → full-screen message explaining how to update the GPU driver.
- Audio context blocked until first key press → resumed on first input.
- Car stuck/out of bounds → auto reset after 3 s (plus manual R).

## Testing

- `node --test tests/` for pure logic: track-space projection round-trip, lap/position ordering, boost/adrenaline rules, takedown detection.
- Browser-pane run via a local static server: every map loads without console errors, a full race completes (countdown → 3 laps → results; a debug hook `window.__game` can fast-forward), takedown and boost trigger visually, screenshots of each map.
- Build the exe and launch it to confirm it starts on this machine.

## Out of scope

Online multiplayer, split screen, traffic, career mode, save files beyond settings/best laps (`localStorage`).

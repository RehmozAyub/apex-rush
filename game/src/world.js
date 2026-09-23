// Builds a map's static world: sky, lights, fog, environment map, track and scenery.
import * as THREE from 'three';
import { TrackPath } from './trackMath.js';
import { TrackIndex } from './terrain.js';
import { createSky } from './sky.js';
import { buildTrackMeshes } from './trackMesh.js';
import { Weather } from './weather.js';

export function buildWorld(def, glRenderer, quality) {
  const scene = new THREE.Scene();
  const track = new TrackPath(def.layout.points, { width: def.layout.width });
  const index = new TrackIndex(track);
  scene.fog = new THREE.FogExp2(def.fog.color, def.fog.density);
  scene.background = new THREE.Color(def.fog.color);

  const sky = createSky(def.sky);
  scene.add(sky);

  const sunDir = def.sky.sunDir.clone().normalize();
  const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(def.hemi.sky, def.hemi.ground, def.hemi.intensity);
  scene.add(hemi);

  scene.add(buildTrackMeshes(track, def.trackStyle, glRenderer.capabilities.getMaxAnisotropy()));

  const envScene = new THREE.Scene();
  envScene.add(createSky(def.sky, 400));
  const scenery = def.build({ scene, track, index, density: quality.density, envScene, sunDir }) || {};

  const pmrem = new THREE.PMREMGenerator(glRenderer);
  const envRT = pmrem.fromScene(envScene, 0.04, 0.1, 1000);
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = def.envIntensity ?? 1;

  const weather = def.weather ? new Weather(scene, def.weather) : null;
  const hemiBase = hemi.intensity;

  const snap = 1;
  const world = {
    def, scene, track, index, sky, sun, hemi, weather,
    flash: 0,
    update(dt, time, focus, camera) {
      sky.position.copy(camera.position);
      sky.material.uniforms.uTime.value = time;
      if (weather) {
        weather.update(dt, time, camera);
        world.flash = weather.flash;
        sky.material.uniforms.uFlash.value = weather.flash;
        hemi.intensity = hemiBase + weather.flash * 2.5;
      }
      const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      sun.position.set(fx + sunDir.x * 350, focus.y + sunDir.y * 350, fz + sunDir.z * 350);
      sun.target.position.set(fx, focus.y, fz);
      if (scenery.update) scenery.update(dt, time, camera, focus);
    },
    setShadowQuality(q) {
      sun.castShadow = q.shadows;
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
    dispose() {
      envRT.dispose();
      if (weather) weather.dispose(scene);
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) u.value.dispose();
          m.dispose();
        }
      });
    },
  };
  return world;
}

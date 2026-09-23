// Asphalt road textures, generated on a background worker and cached per road style.
// prewarm() queues every track's road right after startup so loading a track rarely waits.
import * as THREE from 'three';
import { generatePixels } from './asphalt-core.js';

const cache = new Map(); // key -> Promise<{ map, normalMap, roughnessMap }>
const pending = new Map(); // job id -> resolve
let worker = null, workerFailed = false, nextId = 1;

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./asphalt-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const j = pending.get(e.data.id); pending.delete(e.data.id); if (j) j.resolve(e.data); };
    worker.onerror = () => {
      // worker could not start: finish any queued jobs on this thread
      workerFailed = true;
      worker = null;
      for (const [id, j] of pending) { pending.delete(id); j.resolve(generatePixels(j.o, j.size)); }
    };
  } catch {
    workerFailed = true;
  }
  return worker;
}

function toTextures({ W, H, albedo, normal, rough }) {
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(new Uint8Array(data.buffer), W, H, THREE.RGBAFormat);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(albedo, true), normalMap: tex(normal, false), roughnessMap: tex(rough, false) };
}

export function getAsphalt(o = {}, size = 'high') {
  const key = JSON.stringify([o, size]);
  if (cache.has(key)) return cache.get(key);
  const w = getWorker();
  const job = w
    ? new Promise((resolve) => { const id = nextId++; pending.set(id, { resolve, o, size }); w.postMessage({ id, o, size }); }).then(toTextures)
    : Promise.resolve().then(() => toTextures(generatePixels(o, size))); // no worker: do it here
  cache.set(key, job);
  return job;
}

// Queue several road styles in the background (fire and forget).
export function prewarm(styles, size) {
  for (const o of styles) getAsphalt(o, size);
}

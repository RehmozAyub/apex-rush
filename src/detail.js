// World-space detail for large surfaces: a small tileable grain texture sampled at two scales
// (close-up grit + large-scale tone variation that hides texture repetition), optionally
// triplanar for rocks and cliffs. Injected into standard materials with onBeforeCompile.
import * as THREE from 'three';

let grain = null;

// 256x256 tileable multi-octave value noise (grey), shared by every detailed material.
export function grainTexture() {
  if (grain) return grain;
  const N = 256;
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const acc = new Float32Array(N * N);
  let amp = 1, total = 0;
  for (const cell of [64, 32, 16, 8, 4, 2]) {
    const g = N / cell;
    const grid = new Float32Array(g * g).map(() => rnd());
    for (let y = 0; y < N; y++) {
      const gy = y / cell, iy = Math.floor(gy), fy = gy - iy, sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < N; x++) {
        const gx = x / cell, ix = Math.floor(gx), fx = gx - ix, sx = fx * fx * (3 - 2 * fx);
        const a = grid[(iy % g) * g + (ix % g)], b = grid[(iy % g) * g + ((ix + 1) % g)];
        const c = grid[((iy + 1) % g) * g + (ix % g)], d = grid[((iy + 1) % g) * g + ((ix + 1) % g)];
        acc[y * N + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.62;
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const v = Math.max(0, Math.min(255, ((acc[i] / total - 0.5) * 1.8 + 0.5) * 255));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  grain = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.magFilter = THREE.LinearFilter;
  grain.minFilter = THREE.LinearMipmapLinearFilter;
  grain.generateMipmaps = true;
  grain.needsUpdate = true;
  return grain;
}

// fine: [scale (1/m), strength]   macro: [scale, strength]   rough: roughness variation
export function addWorldDetail(mat, { fine = [0.6, 0.3], macro = [0.02, 0.25], rough = 0.15, triplanar = false } = {}) {
  const tex = grainTexture();
  const key = `detail-${fine}-${macro}-${rough}-${triplanar}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrain = { value: tex };
    sh.uniforms.uFine = { value: new THREE.Vector2(...fine) };
    sh.uniforms.uMacro = { value: new THREE.Vector2(...macro) };
    sh.uniforms.uRoughVar = { value: rough };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 dPos = vec4(transformed, 1.0);
        vec3 dNrm = objectNormal;
        #ifdef USE_INSTANCING
          dPos = instanceMatrix * dPos;
          dNrm = mat3(instanceMatrix) * dNrm;
        #endif
        vDetailPos = (modelMatrix * dPos).xyz;
        vDetailNrm = normalize(mat3(modelMatrix) * dNrm);`);
    const sample = triplanar ? `
      float dgrain(float s) {
        vec3 w = pow(abs(normalize(vDetailNrm)), vec3(4.0));
        w /= (w.x + w.y + w.z);
        return texture2D(uGrain, vDetailPos.zy * s).r * w.x + texture2D(uGrain, vDetailPos.xz * s).r * w.y + texture2D(uGrain, vDetailPos.xy * s).r * w.z;
      }` : `
      float dgrain(float s) { return texture2D(uGrain, vDetailPos.xz * s).r; }`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrain;
        uniform vec2 uFine, uMacro;
        uniform float uRoughVar;
        varying vec3 vDetailPos;
        varying vec3 vDetailNrm;
        ${sample}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dFine = dgrain(uFine.x) - 0.5;
        float dMacro = texture2D(uGrain, vDetailPos.xz * uMacro.x + 0.37).r - 0.5;
        diffuseColor.rgb *= (1.0 + dFine * uFine.y) * (1.0 + dMacro * uMacro.y);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + dFine * uRoughVar), 0.02, 1.0);`);
  };
  mat.needsUpdate = true;
  return mat;
}

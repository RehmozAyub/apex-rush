// Procedural sky dome: gradient, HDR sun disc + glow, optional stars and clouds.
import * as THREE from 'three';

export function skyMaterial(o) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(o.top) },
      uHorizon: { value: new THREE.Color(o.horizon) },
      uBottom: { value: new THREE.Color(o.bottom) },
      uSunDir: { value: o.sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(o.sunColor) },
      uSunSize: { value: o.sunSize ?? 0.02 },
      uSunIntensity: { value: o.sunIntensity ?? 12 },
      uGlow: { value: o.glow ?? 1 },
      uStars: { value: o.stars ?? 0 },
      uClouds: { value: o.clouds ?? 0 },
      uCloudColor: { value: new THREE.Color(o.cloudColor ?? 0xffffff) },
      uHorizonSharp: { value: o.horizonSharp ?? 0.45 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloudColor;
      uniform float uSunSize, uSunIntensity, uGlow, uStars, uClouds, uHorizonSharp, uTime, uFlash;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), uHorizonSharp)) : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.35));
        float sd = dot(d, uSunDir);
        col += uSunColor * pow(max(sd, 0.0), 6.0) * 0.35 * uGlow;
        col += uSunColor * pow(max(sd, 0.0), 60.0) * 0.8 * uGlow;
        col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.7, sd) * uSunIntensity;
        if (uStars > 0.0) {
          vec3 p = floor(d * 380.0);
          float s = hash(p);
          float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 100.0);
          col += vec3(0.9, 0.95, 1.0) * step(0.9975, s) * smoothstep(0.02, 0.3, h) * uStars * tw * 2.5;
        }
        if (uClouds > 0.0 && h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.004, 0.0);
          float c = smoothstep(0.48, 0.8, fbm(uv));
          vec3 cc = uCloudColor * (0.85 + 0.35 * pow(max(sd, 0.0), 4.0));
          col = mix(col, cc, c * uClouds * smoothstep(0.0, 0.18, h));
        }
        col += vec3(0.55, 0.6, 0.75) * uFlash * (0.4 + 0.6 * smoothstep(-0.1, 0.4, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function createSky(o, radius = 4500) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), skyMaterial(o));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

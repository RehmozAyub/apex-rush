// Animated water surface (sum-of-waves normals, fresnel sky reflection, sun glint, scene fog).
import * as THREE from 'three';

export function waterMaterial({
  sunDir, deep = 0x0b2a44, shallow = 0x1f6a7a, skyTop = 0x3a2c6a, skyHorizon = 0xffa060,
  sunColor = 0xffc080, spec = 14, ripple = 1, rain = 0,
}) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone().normalize() },
      uDeep: { value: new THREE.Color(deep) },
      uShallow: { value: new THREE.Color(shallow) },
      uSkyTop: { value: new THREE.Color(skyTop) },
      uSkyHorizon: { value: new THREE.Color(skyHorizon) },
      uSunColor: { value: new THREE.Color(sunColor) },
      uSpec: { value: spec },
      uRipple: { value: ripple },
      uRain: { value: rain },
    }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime, uSpec, uRipple, uRain;
      uniform vec3 uSunDir, uDeep, uShallow, uSkyTop, uSkyHorizon, uSunColor;
      varying vec3 vWorld;
      vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
        float ph = dot(p, dir) * freq + uTime * speed;
        return dir * cos(ph) * freq * amp;
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 p = vWorld.xz;
        vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.06, 1.1, 0.5)
               + wave(p, normalize(vec2(0.7, -0.7)), 0.11, 1.7, 0.25)
               + wave(p, normalize(vec2(-0.2, 1.0)), 0.23, 2.3, 0.12)
               + wave(p, normalize(vec2(0.9, 0.9)), 0.51, 3.1, 0.05) * uRipple
               + wave(p, normalize(vec2(-0.8, 0.4)), 1.13, 4.3, 0.02) * uRipple;
        if (uRain > 0.0) {
          // rain rings
          vec2 cell = floor(p * 0.8);
          vec2 f = fract(p * 0.8) - 0.5;
          float t = fract(uTime * 0.9 + hash(cell));
          float d = length(f);
          float ring = sin((d - t * 0.5) * 60.0) * smoothstep(0.5 * t + 0.06, 0.5 * t, d) * (1.0 - t);
          g += normalize(f + 1e-4) * ring * 0.25 * uRain;
        }
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 r = reflect(-v, n);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(r.y, 0.0, 1.0), 0.5));
        vec3 water = mix(uDeep, uShallow, 0.3 + 0.2 * n.x);
        vec3 col = mix(water, sky, fres);
        float sd = max(dot(r, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 350.0) * uSpec + pow(sd, 30.0) * 0.3);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

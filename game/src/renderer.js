// WebGL renderer + post-processing: bloom, speed FX (radial motion blur, speed lines,
// chromatic aberration, boost grade, vignette, impact flash), tone mapping, FXAA.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

function speedFxShader(samples) {
  return {
    uniforms: {
      tDiffuse: { value: null },
      uBlur: { value: 0 },
      uCA: { value: 0 },
      uLines: { value: 0 },
      uBoost: { value: 0 },
      uFlash: { value: 0 },
      uVignette: { value: 0.35 },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uCenter: { value: new THREE.Vector2(0.5, 0.52) },
      uSlowmo: { value: 0 },
    },
    defines: { SAMPLES: samples },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uBlur, uCA, uLines, uBoost, uFlash, uVignette, uTime, uAspect, uSlowmo;
      uniform vec2 uCenter;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453123); }
      void main() {
        vec2 d = vUv - uCenter;
        float r = length(d * vec2(uAspect, 1.0));
        float amt = uBlur * smoothstep(0.1, 0.75, r);
        float ca = uCA * r * 0.012;
        vec3 col = vec3(0.0);
        if (amt > 0.001 || ca > 0.0002) {
          float wsum = 0.0;
          for (int i = 0; i < SAMPLES; i++) {
            float t = float(i) / float(SAMPLES - 1);
            float w = 1.0 - t * 0.65;
            vec2 uv = vUv - d * amt * 0.14 * t;
            col.r += texture2D(tDiffuse, uv + d * ca).r * w;
            col.g += texture2D(tDiffuse, uv).g * w;
            col.b += texture2D(tDiffuse, uv - d * ca).b * w;
            wsum += w;
          }
          col /= wsum;
        } else {
          col = texture2D(tDiffuse, vUv).rgb;
        }

        // speed lines streaming out from the vanishing point
        if (uLines > 0.001) {
          float ang = atan(d.y, d.x * uAspect) / 6.2831853 + 0.5;
          float cells = 110.0;
          float id = floor(ang * cells);
          float rnd = hash(id * 1.37);
          float fr = fract(ang * cells);
          float thin = 1.0 - smoothstep(0.0, 0.12, abs(fr - 0.5));
          float along = fract(r * (1.2 + rnd) - uTime * (1.8 + rnd * 2.2) + rnd * 7.0);
          float seg = smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.1, 0.45, along));
          float mask = step(0.62, rnd) * seg * thin * smoothstep(0.28, 0.8, r);
          col += vec3(1.0, 0.96, 0.9) * mask * uLines * 0.4;
        }

        // boost grade: warmer highlights, cooler shadows, a touch more contrast
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 graded = mix(col * vec3(0.92, 0.98, 1.12), col * vec3(1.18, 1.0, 0.86), smoothstep(0.1, 1.2, lum));
        col = mix(col, graded * 1.06, uBoost);

        // slow motion: desaturate slightly and add cool tint
        col = mix(col, vec3(lum) * vec3(0.85, 0.95, 1.15), uSlowmo * 0.45);

        col += vec3(1.0, 0.9, 0.8) * uFlash;
        col *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  };
}

export class Renderer {
  constructor(canvas, quality) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.3, 6000);
    this.scene = null;
    this.fx = { blur: 0, ca: 0, lines: 0, boost: 0, flash: 0, slowmo: 0 };
    this.motionBlur = true;
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = q;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    const q = this.quality;
    if (this.composer) this.composer.dispose();
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(this.scene || new THREE.Scene(), this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.55, 0.9);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.fxPass = new ShaderPass(speedFxShader(q.blurSamples));
    this.composer.addPass(this.fxPass);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    if (this.bloomSettings) this.setBloom(this.bloomSettings);
  }

  setScene(scene, { bloom, exposure }) {
    this.scene = scene;
    this.renderPass.scene = scene;
    this.renderer.toneMappingExposure = exposure;
    this.setBloom(bloom);
  }

  setBloom(b) {
    this.bloomSettings = b;
    this.bloom.strength = b.strength;
    this.bloom.radius = b.radius;
    this.bloom.threshold = b.threshold;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.fxPass.material.uniforms.uAspect.value = w / h;
    this.height = h * pr;
  }

  render(time) {
    if (!this.scene) return;
    const u = this.fxPass.material.uniforms;
    u.uBlur.value = this.motionBlur ? this.fx.blur : 0;
    u.uCA.value = this.fx.ca;
    u.uLines.value = this.fx.lines;
    u.uBoost.value = this.fx.boost;
    u.uFlash.value = this.fx.flash + (this.fx.weather || 0) * 0.22;
    u.uSlowmo.value = this.fx.slowmo;
    u.uTime.value = time;
    this.composer.render();
  }
}

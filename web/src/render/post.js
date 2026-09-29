import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uDeath: { value: 0 },
    uHit: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uDeath;
    uniform float uHit;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      // Desfoque radial leve quando rápido.
      vec3 c = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        float k = float(i) / 3.0;
        c += texture2D(tDiffuse, vUv - d * r * uSpeed * 0.08 * k).rgb;
      }
      c *= 0.25;
      // Leve contraste com sombras quentes.
      c = (c - 0.5) * 1.05 + 0.5;
      c *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), 0.6);
      float grey = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(grey) * vec3(1.05, 0.92, 0.9), uDeath * 0.85);
      c = mix(c, vec3(0.75, 0.08, 0.04), uHit * 0.55 * smoothstep(0.1, 0.8, r));
      float vig = 1.0 - smoothstep(0.35 - uDeath * 0.2, 0.95, r);
      c *= vig * 0.3 + 0.7;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};

/** Pipeline de render. Qualidade "alta" liga bloom e resolução maior. */
export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.6, 0.9);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  function setQuality(high) {
    bloom.enabled = high;
    const ratio = high ? Math.min(devicePixelRatio, 1.5) : 1;
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    composer.setSize(innerWidth, innerHeight);
  }

  return {
    uniforms: grade.uniforms,
    setQuality,
    resize(w, h) { composer.setSize(w, h); },
    render() { composer.render(); },
  };
}

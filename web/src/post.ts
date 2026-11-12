import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uGlitch: { value: 0 }, uFlash: { value: 0 }, uBack: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) }, uFade: { value: 0 }, uFx: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGlitch, uFlash, uBack, uFade, uFx; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv; float g = uGlitch*uFx;
      float band = floor(uv.y*28. + floor(uTime*24.)*3.1);
      if (h(vec2(band, 1.)) < g*0.55) uv.x += (h(vec2(band, 2.)) - .5) * .16 * g;
      float blockY = floor(uv.y*9. + floor(uTime*13.));
      if (h(vec2(blockY, 7.)) < g*0.25) uv = vec2(uv.x + (h(vec2(blockY,9.))-.5)*.3*g, uv.y);
      float ca = .0009 + g*.016;
      vec2 dir = uv - .5;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir*ca*2. + vec2(g*.01,0.)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir*ca*2. - vec2(g*.01,0.)).b;
      // 故障色偏
      col = mix(col, col*vec3(1.4,.6,1.3), g*step(.5, h(vec2(band,4.)))*.6);
      col = mix(col, col*vec3(.5,1.3,1.4), g*step(.75, h(vec2(band,5.)))*.6);
      col *= 1. - g*.35*step(.5, fract(uv.y*uRes.y*.5));
      // 后台层：去饱和
      float l = dot(col, vec3(.299,.587,.114));
      col = mix(col, vec3(l)*1.05, uBack*.85);
      // 暗部微暖、暗角、颗粒
      col += vec3(.012,.008,.0) * (1.-l);
      float v = smoothstep(1.2, .3, length(dir*vec2(1.15,1.)));
      col *= mix(.38, 1., v);
      col += (h(uv*uRes + fract(uTime)*91.) - .5) * .045;
      col = mix(col, vec3(1.2), uFlash);
      col = mix(col, vec3(0.), uFade);
      gl_FragColor = vec4(col, 1.);
    }`,
};

export class Post {
  composer: EffectComposer; final: ShaderPass; ao?: any; bloom: UnrealBloomPass; render?: RenderPass;
  quality: 'high' | 'mid' | 'low' = 'high';
  constructor(public renderer: THREE.WebGLRenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {
    const w = innerWidth, h = innerHeight;
    this.composer = new EffectComposer(renderer);
    try {
      this.ao = new N8AOPass(scene, camera, w, h);
      this.ao.configuration.aoRadius = 2.2; this.ao.configuration.distanceFalloff = 1.0; this.ao.configuration.intensity = 4.0; this.ao.configuration.color = new THREE.Color('#0b0907');
      this.ao.setQualityMode('Medium');
      this.composer.addPass(this.ao);
    } catch (e) { console.warn('N8AO 不可用，退回普通渲染', e); this.render = new RenderPass(scene, camera); this.composer.addPass(this.render); }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.5, 0.7, 0.9);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader as any); this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.resize();
  }
  setQuality(q: 'high' | 'mid' | 'low') {
    this.quality = q;
    const pr = q === 'high' ? Math.min(devicePixelRatio, 1.75) : q === 'mid' ? 1 : 0.75;
    this.renderer.setPixelRatio(pr); this.composer.setPixelRatio(pr);
    if (this.ao) { this.ao.configuration.halfRes = q !== 'high'; this.ao.configuration.intensity = q === 'low' ? 1.4 : 2.6; this.ao.setQualityMode(q === 'high' ? 'Medium' : 'Performance'); }
    this.bloom.resolution.set(innerWidth / (q === 'high' ? 2 : 3), innerHeight / (q === 'high' ? 2 : 3));
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  set(t: number, glitch: number, flash: number, back: number, fade: number, fx: boolean) {
    const u = this.final.uniforms; u.uTime.value = t; u.uGlitch.value = glitch; u.uFlash.value = flash; u.uBack.value = back; u.uFade.value = fade; u.uFx.value = fx ? 1 : 0.15;
  }
  draw() {
    if (this.ao && !this.ao.enabled && !this.render) { /* AO 关闭时 N8AOPass 仍会渲染场景 */ }
    this.composer.render();
  }
}

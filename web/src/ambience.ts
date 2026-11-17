// 氛围层：静在地面上为你点亮的引路光、只在有光处显形的浮尘。
import * as THREE from 'three';
import { lvUniforms } from './lightvol';

interface Point { x: number; y: number; z: number }

/** 她指路的时候，脚下会亮起一条琥珀色的光带，一直流向那扇门。约定暂停时它就熄灭。 */
export class GuideLight {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private shown = 0; private wanted = 0;
  constructor(scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uLength: { value: 1 }, uShow: { value: 0 } },
      vertexShader: `attribute float along; varying float vU; varying float vV; void main(){ vU = along; vV = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: `uniform float uTime, uLength, uShow; varying float vU; varying float vV;
        void main(){
          float phase = fract( vU * 0.5 - uTime * 0.55 );
          float dash = smoothstep( 0.0, 0.12, phase ) * smoothstep( 0.62, 0.36, phase );
          float edge = smoothstep( 0.0, 0.42, vV ) * smoothstep( 1.0, 0.58, vV );
          float fade = smoothstep( 0.5, 2.0, vU ) * smoothstep( uLength, uLength - 1.6, vU ) * smoothstep( 30.0, 12.0, vU );
          gl_FragColor = vec4( vec3( 1.25, 0.66, 0.2 ), ( 0.14 + 0.86 * dash ) * edge * fade * uShow );
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.visible = false; this.mesh.name = 'guide-light';
    scene.add(this.mesh);
  }
  /** points: 从住户脚下到目标的折线；null 表示熄灭。 */
  setPath(points: Point[] | null) {
    if (!points || points.length < 2) { this.wanted = 0; return; }
    const pos: number[] = [], uv: number[] = [], along: number[] = [], index: number[] = []; let travelled = 0, vertex = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 0.05 || Math.abs(b.y - a.y) > 1.2) continue; // 电梯换层的那一跳不画
      const nx = -dz / len * 0.07, nz = dx / len * 0.07;
      pos.push(a.x + nx, a.y + 0.03, a.z + nz, a.x - nx, a.y + 0.03, a.z - nz, b.x + nx, b.y + 0.03, b.z + nz, b.x - nx, b.y + 0.03, b.z - nz);
      uv.push(0, 0, 0, 1, 1, 0, 1, 1); along.push(travelled, travelled, travelled + len, travelled + len);
      index.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3); vertex += 4; travelled += len;
    }
    if (!vertex) { this.wanted = 0; return; }
    const g = this.mesh.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1)); g.setIndex(index);
    this.mesh.material.uniforms.uLength.value = travelled; this.wanted = 1; this.mesh.visible = true;
  }
  update(dt: number) {
    this.shown += (this.wanted - this.shown) * Math.min(1, dt * 2.5);
    const u = this.mesh.material.uniforms; u.uTime.value += dt; u.uShow.value = this.shown;
    if (this.shown < 0.01 && !this.wanted) this.mesh.visible = false;
  }
}

/** 浮尘：围着镜头循环的粒子，亮度取自光照体——只在灯下、窗边和缺口旁看得见。 */
export class DustMotes {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  constructor(scene: THREE.Scene, count = 420) {
    const seed = new Float32Array(count * 3); for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(seed, 3));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...lvUniforms, uTime: { value: 0 }, uEye: { value: new THREE.Vector3() } },
      vertexShader: `uniform highp sampler3D uLightVol; uniform vec3 uLvOrigin, uLvSize, uEye; uniform float uTime, uLvOn; varying vec3 vLight;
        void main(){
          vec3 box = vec3( 16.0, 7.0, 16.0 );
          vec3 drift = vec3( sin( uTime * 0.11 + position.y * 9.0 ) * 0.5, uTime * 0.035, cos( uTime * 0.09 + position.x * 7.0 ) * 0.5 );
          vec3 p = mod( position * box + drift - uEye, box ) - box * 0.5 + uEye;
          vLight = texture( uLightVol, ( p - uLvOrigin ) / uLvSize ).rgb * uLvOn;
          vec4 mv = viewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          gl_PointSize = ( 1.0 + fract( position.z * 31.0 ) * 1.8 ) * 30.0 / max( 1.0, -mv.z );
          vLight *= smoothstep( 0.6, 2.2, -mv.z ) * smoothstep( 11.0, 5.0, -mv.z );
        }`,
      fragmentShader: `varying vec3 vLight; void main(){ float d = length( gl_PointCoord - 0.5 ); float a = smoothstep( 0.5, 0.05, d ); gl_FragColor = vec4( vLight * 0.75 + 0.02, a * clamp( dot( vLight, vec3( 0.33 ) ) * 0.6, 0.0, 0.42 ) ); }`,
    });
    this.points = new THREE.Points(geometry, material); this.points.frustumCulled = false; this.points.renderOrder = 3; this.points.name = 'dust';
    scene.add(this.points);
  }
  update(dt: number, eye: THREE.Vector3) { const u = this.points.material.uniforms; u.uTime.value += dt; u.uEye.value.copy(eye); }
}

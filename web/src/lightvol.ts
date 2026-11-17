// 体素光照体：把每盏灯、每扇窗、每个缺口的光沿空气传播到整栋楼，写进一张 3D 贴图，
// 所有标准材质按世界坐标取样。墙会挡光，关灯的房间是真的黑，外墙被拆开时天光会涌进来。
import * as THREE from 'three';
import { NX, NY, NZ, Y0, M, iyOf, roomById } from './level';
import type { World } from './world';

const N = NX * NY * NZ;
const REACH = 12; // 一盏灯能传播的格数
const at = (x: number, iy: number, z: number) => x + NX * (iy + NY * z);
const opaque = (m: number) => m !== M.Air && m !== M.Glass;

// 每个房间的布光：强度与色温。走廊压暗、住处偏暖、地下是钠灯色、假门长廊几乎只靠那扇门照亮。
const ROOM_LIGHT: Record<string, [number, string?]> = {
  '110': [0.95, '#ffdcb0'], '101': [0.9, '#ffe9cf'], '102': [0.5, '#fff0dc'], '103': [0.6, '#ffe6c4'], '104': [0.55, '#e4ecf2'],
  '105': [0.7], '106': [0.85, '#eaf2f6'], '107': [0.75, '#fff3e2'], '108': [0.22, '#ffe8cc'], '1W': [0.5], '1E': [0.5], '1S': [0.6], 'XS': [0.35, '#ffd9a8'],
  '201': [0.8, '#f4f1ea'], '202': [0.85], '203': [0.6, '#ffd9a8'], '204': [0.16, '#9fc0ff'], '205': [0.45, '#ffe2bd'], '206': [0.85, '#fff0dc'],
  '207': [0.42], '208': [0.0], '209': [0.7, '#ffdcb0'], '2W': [0.5], '2N': [0.5], '2G': [0.45], '2S': [0.6], 'RF': [0.25, '#e8f0ff'],
};
const SKY: Record<string, { color: [number, number, number]; sun: string; sunPower: number }> = {
  dusk: { color: [1.25, 0.86, 0.6], sun: '#ffb070', sunPower: 3.4 },
  day: { color: [1.5, 1.55, 1.6], sun: '#fff3dc', sunPower: 3.6 },
  night: { color: [0.1, 0.14, 0.24], sun: '#8fa6d8', sunPower: 0.35 },
  storm: { color: [0.5, 0.55, 0.62], sun: '#9aa4b0', sunPower: 0.25 },
  off: { color: [0, 0, 0], sun: '#000000', sunPower: 0 },
};
export const skyLook = (mode: string) => SKY[mode] ?? SKY.dusk;
const designColor = new Map<string, THREE.Color>();
/** 房间的设计亮度与色温，供可见的灯具和近处点光共用。 */
export function roomLightDesign(id: string) {
  const b1 = roomById(id)?.floor === 'B1'; const d = ROOM_LIGHT[id] ?? [b1 ? 0.42 : 0.6];
  let color = designColor.get(id); if (!color) designColor.set(id, color = new THREE.Color(d[1] ?? (b1 ? '#ffc98a' : '#fff1dc')));
  return { power: d[0], color };
}

export interface ExtraLight { x: number; y: number; z: number; color: [number, number, number]; power: number; reach?: number }

export const lvUniforms = {
  uLightVol: { value: null as THREE.Data3DTexture | null },
  uLvOrigin: { value: new THREE.Vector3(0, Y0, 0) },
  uLvSize: { value: new THREE.Vector3(NX, NY, NZ) },
  uLvOn: { value: 1 },
};

let patched = false;
/** 给所有 MeshStandard/Physical 材质注入光照体取样（只需调用一次，必须早于材质首次编译）。 */
export function patchStandardMaterials() {
  if (patched) return; patched = true;
  THREE.MeshStandardMaterial.prototype.onBeforeCompile = function (shader) {
    Object.assign(shader.uniforms, lvUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLvWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 lvW = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          lvW = instanceMatrix * lvW;
        #endif
          vLvWorld = ( modelMatrix * lvW ).xyz; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler3D uLightVol; uniform vec3 uLvOrigin; uniform vec3 uLvSize; uniform float uLvOn; varying vec3 vLvWorld;
        vec3 lvSample( vec3 p ) { return texture( uLightVol, ( p - uLvOrigin ) / uLvSize ).rgb; }`)
      .replace('#include <lights_fragment_end>', `{
          vec3 lvN = inverseTransformDirection( geometryNormal, viewMatrix );
          vec3 lvE0 = lvSample( vLvWorld + lvN * 0.55 );
          vec3 lvE1 = lvSample( vLvWorld + lvN * 1.7 );
          float lvL0 = dot( lvE0, vec3( 0.3, 0.6, 0.1 ) ), lvL1 = dot( lvE1, vec3( 0.3, 0.6, 0.1 ) );
          // 朝向光来的方向更亮：让墙、地、顶有明暗之分，而不是一片平光
          float lvFacing = clamp( ( lvL1 - lvL0 ) / ( lvL0 + lvL1 + 0.0001 ), -0.55, 0.55 );
          float lvEnv = mix( 1.0, clamp( lvL0 * 2.2, 0.02, 1.2 ), uLvOn );
          #if defined( RE_IndirectDiffuse )
            // 灯在头顶往下照：朝下的面（天花板）只吃到反弹光
            irradiance += lvE0 * ( 1.0 + 1.15 * lvFacing ) * mix( 0.38, 1.0, smoothstep( -0.9, 0.15, lvN.y ) ) * PI * uLvOn;
            iblIrradiance *= lvEnv * 0.22;
          #endif
          #if defined( RE_IndirectSpecular )
            radiance *= lvEnv;
          #endif
        }
        #include <lights_fragment_end>`);
  };
}

export class LightVolume {
  texture: THREE.Data3DTexture;
  extras: ExtraLight[] = [];
  dirty = true;
  private light = new Float32Array(N * 3);
  private half = new Uint16Array(N * 4);
  private stamp = new Uint32Array(N); private mark = 0;
  private queue = new Int32Array(N); private depth = new Uint8Array(N);
  private signature = ''; private last = -1;

  constructor(private world: World) {
    this.texture = new THREE.Data3DTexture(this.half, NX, NY, NZ);
    this.texture.format = THREE.RGBAFormat; this.texture.type = THREE.HalfFloatType;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping; this.texture.unpackAlignment = 1;
    lvUniforms.uLightVol.value = this.texture;
  }

  /** 每帧调用：房间灯光、天空或建筑变化后重算（节流）。 */
  update(time: number) {
    let sig = this.world.skyMode + '|' + this.extras.length;
    for (const [id, s] of this.world.rooms) sig += id + s.light[0] + (s.light === 'flicker' ? (s.flick * 4 | 0) : '') + (s.color ? s.color.getHexString() : '') + (s.smoke > 0.3 ? 'f' : '');
    if (sig !== this.signature) { this.signature = sig; this.dirty = true; }
    if (!this.dirty || time - this.last < 0.09) return;
    this.dirty = false; this.last = time; this.recompute();
  }

  private splat(sx: number, sy: number, sz: number, r: number, g: number, b: number, reach = REACH) {
    const grid = this.world.grid, L = this.light, q = this.queue, d = this.depth, st = this.stamp, mark = ++this.mark;
    if (!grid.inb(sx, sy, sz)) return;
    let head = 0, tail = 0; const s = at(sx, sy, sz);
    q[tail++] = s; st[s] = mark; d[s] = 0;
    while (head < tail) {
      const c = q[head++], dist = d[c];
      const k = 1 / (1 + 0.55 * dist + 0.16 * dist * dist) * Math.min(1, (reach - dist) / 3);
      L[c * 3] += r * k; L[c * 3 + 1] += g * k; L[c * 3 + 2] += b * k;
      if (dist >= reach - 1) continue;
      const x = c % NX, iy = ((c / NX) | 0) % NY, z = (c / (NX * NY)) | 0;
      for (let n = 0; n < 6; n++) {
        const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0), ny = iy + (n === 2 ? 1 : n === 3 ? -1 : 0), nz = z + (n === 4 ? 1 : n === 5 ? -1 : 0);
        if (nx < 0 || ny < 0 || nz < 0 || nx >= NX || ny >= NY || nz >= NZ) continue;
        const i = at(nx, ny, nz); if (st[i] === mark) continue; st[i] = mark;
        if (opaque(grid.v[grid.idx(nx, ny, nz)])) continue;
        d[i] = dist + 1; q[tail++] = i;
      }
    }
  }

  private recompute() {
    const w = this.world, grid = w.grid, L = this.light; L.fill(0);
    const col = new THREE.Color();
    // 1) 吊顶灯
    for (const a of w.lightAnchors) {
      const s = w.rooms.get(a.room)!; const f = w.roomLightFactor(a.room); if (f <= 0.01) continue;
      const design = roomLightDesign(a.room);
      if (s.light === 'red') col.set('#ff2a1a'); else if (s.color) col.copy(s.color); else col.copy(design.color);
      const p = 0.78 * f * design.power;
      this.splat(Math.floor(a.pos.x), iyOf(a.pos.y), Math.floor(a.pos.z), col.r * p, col.g * p, col.b * p);
    }
    // 2) 天光：一次多源洪泛。源 = 能直接看到天的格子（露台、天窗下的中庭、穹顶）和外墙上的窗与缺口
    const sky = skyLook(w.skyMode).color;
    if (sky[0] + sky[1] + sky[2] > 0) {
      const st = this.stamp, mark = ++this.mark, q = this.queue, d = this.depth; let head = 0, tail = 0;
      const seed = (x: number, iy: number, z: number) => { const i = at(x, iy, z); if (st[i] !== mark) { st[i] = mark; d[i] = 0; q[tail++] = i; } };
      for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) for (let iy = NY - 1; iy >= iyOf(-4); iy--) { if (opaque(grid.v[grid.idx(x, iy, z)])) break; seed(x, iy, z); }
      for (const fy of [0, 4]) for (let dy = 0; dy < 3; dy++) {
        const iy = iyOf(fy + dy + 0.5);
        for (let x = 0; x < NX; x++) for (const z of [0, NZ - 1]) if (!opaque(grid.v[grid.idx(x, iy, z)])) seed(x, iy, z);
        for (let z = 1; z < NZ - 1; z++) for (const x of [0, NX - 1]) if (!opaque(grid.v[grid.idx(x, iy, z)])) seed(x, iy, z);
      }
      while (head < tail) {
        const c = q[head++], dist = d[c], k = 0.62 * Math.pow(0.58, dist);
        L[c * 3] += sky[0] * k; L[c * 3 + 1] += sky[1] * k; L[c * 3 + 2] += sky[2] * k;
        if (dist >= 8) continue;
        const x = c % NX, iy = ((c / NX) | 0) % NY, z = (c / (NX * NY)) | 0;
        for (let n = 0; n < 6; n++) {
          const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0), ny = iy + (n === 2 ? 1 : n === 3 ? -1 : 0), nz = z + (n === 4 ? 1 : n === 5 ? -1 : 0);
          if (nx < 0 || ny < 0 || nz < 0 || nx >= NX || ny >= NY || nz >= NZ) continue;
          const i = at(nx, ny, nz); if (st[i] === mark) continue; st[i] = mark;
          if (opaque(grid.v[grid.idx(nx, ny, nz)])) continue;
          d[i] = dist + 1; q[tail++] = i;
        }
      }
    }
    // 3) 地下外壳或地基被打穿：从虚空漏进来的冷光
    for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
      if (!opaque(grid.v[grid.idx(x, 0, z)])) this.splat(x, 1, z, 0.25, 0.5, 0.9, 8);
      if (x === 0 || z === 0 || x === NX - 1 || z === NZ - 1) for (let dy = 0; dy < 3; dy++) { const iy = iyOf(-4 + dy + 0.5); if (!opaque(grid.v[grid.idx(x, iy, z)])) this.splat(x, iy, z, 0.2, 0.4, 0.75, 8); }
    }
    // 4) 那扇最亮的门，以及其他会发光的东西
    this.splat(37, iyOf(1.2), 24, 1.5, 1.95, 1.75, 13);
    this.splat(13, iyOf(5.6), 25, 0.2, 0.42, 0.75, 7);   // 监控墙
    this.splat(36, iyOf(-2.8), 18, 0.1, 0.5, 0.3, 6); // 维护终端
    for (const e of this.extras) this.splat(Math.floor(e.x), iyOf(e.y), Math.floor(e.z), e.color[0] * e.power, e.color[1] * e.power, e.color[2] * e.power, e.reach ?? 8);
    // 5) 实心格取相邻空气的平均值，避免三线性取样在墙根发黑
    const H = this.half, th = THREE.DataUtils.toHalfFloat;
    for (let z = 0; z < NZ; z++) for (let iy = 0; iy < NY; iy++) for (let x = 0; x < NX; x++) {
      const i = at(x, iy, z); let r = L[i * 3], g = L[i * 3 + 1], b = L[i * 3 + 2];
      if (opaque(grid.v[grid.idx(x, iy, z)])) {
        let n = 0; r = g = b = 0;
        for (let k = 0; k < 6; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = iy + (k === 2 ? 1 : k === 3 ? -1 : 0), nz = z + (k === 4 ? 1 : k === 5 ? -1 : 0);
          if (nx < 0 || ny < 0 || nz < 0 || nx >= NX || ny >= NY || nz >= NZ || opaque(grid.v[grid.idx(nx, ny, nz)])) continue;
          const j = at(nx, ny, nz) * 3; r += L[j]; g += L[j + 1]; b += L[j + 2]; n++;
        }
        if (n) { r /= n; g /= n; b /= n; }
      }
      H[i * 4] = th(Math.min(r, 60)); H[i * 4 + 1] = th(Math.min(g, 60)); H[i * 4 + 2] = th(Math.min(b, 60)); H[i * 4 + 3] = 15360; // 1.0
    }
    this.texture.needsUpdate = true;
  }

  /** 某点的亮度（供 HUD、摄像头判断等使用）。 */
  levelAt(x: number, y: number, z: number) {
    const cx = Math.floor(x), iy = iyOf(y), cz = Math.floor(z); if (!this.world.grid.inb(cx, iy, cz)) return 1;
    const i = at(cx, iy, cz) * 3; return this.light[i] * 0.3 + this.light[i + 1] * 0.6 + this.light[i + 2] * 0.1;
  }
}

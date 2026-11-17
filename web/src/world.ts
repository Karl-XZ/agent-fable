import * as THREE from 'three';
import { Grid, M, NX, NY, NZ, Y0, SOLID, CHUNK, CX, CZ, ROOMS, Room, DOORS, DoorDef, STAIRS, StairDef, stairBoxes, floorById, iyOf, roomAt, BOX_SIZE, SHAFT, ATRIUM_VOID } from './level';
import * as TX from './textures';
import { skyLook, roomLightDesign } from './lightvol';

export interface AABB { min: number[]; max: number[]; tag?: string; ref?: any }
export const overlap = (a: AABB, b: AABB, e = 0) => a.min[0] < b.max[0] - e && a.max[0] > b.min[0] + e && a.min[1] < b.max[1] - e && a.max[1] > b.min[1] + e && a.min[2] < b.max[2] - e && a.max[2] > b.min[2] + e;

export interface DoorObj { def: DoorDef; id: string; floorY: number; cells: [number, number][]; axis: 'x' | 'z'; group: THREE.Group; panels: THREE.Object3D[]; t: number; open: boolean; locked: boolean; removed: boolean; rewire?: string; kind: string; center: THREE.Vector3; width: number; byAI?: boolean }
export interface Struct { id: string; kind: string; boxes: AABB[]; group: THREE.Group; rise: number; riseDur: number; riseFrom: number; by: 'ai' | 'level'; label: string; floor: string; pushable?: boolean; meta?: any }
export interface BoxObj { id: string; mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; held: boolean; frozen: boolean; locked: boolean; byAI: boolean; kind: string; size: number; restT: number; dropFrom?: number; thrownFrom?: THREE.Vector3 }
export interface Item { id: string; name: string; kind: 'item' | 'note'; pos: THREE.Vector3; mesh: THREE.Object3D; taken: boolean; hidden: boolean; locked: boolean; text?: string[]; title?: string; room: string; rewritten?: boolean }
export interface Inter { id: string; kind: string; label: string; pos: THREE.Vector3; radius: number; mesh?: THREE.Object3D; data?: any; enabled: boolean; room?: string }
export interface RoomState { light: string; color?: THREE.Color; fog: number; gravity: number; friction: number; sprinkler: boolean; smoke: number; camCovered: boolean; panels: THREE.MeshBasicMaterial; base: THREE.Color; flick: number }
export interface Pending { id: string; box: AABB; target: AABB; t: number; dur: number; mode: 'up' | 'down' | 'slide'; mesh: THREE.Mesh; onDone: () => void; kind: string; from?: AABB; dir?: number[] }

const AMBER = new THREE.Color('#F2B66D');

function boxUV(g: THREE.BoxGeometry, w: number, h: number, d: number, su = 2, sv = 4) {
  const uv = g.attributes.uv as THREE.BufferAttribute; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / su, uv.getY(i) * dims[f][1] / sv); }
  uv.needsUpdate = true; return g;
}

export class World {
  scene = new THREE.Scene();
  grid: Grid;
  mats: Record<string, THREE.Material> = {};
  chunkMeshes = new Map<number, THREE.Mesh[]>();
  doors = new Map<string, DoorObj>();
  structs = new Map<string, Struct>();
  boxes: BoxObj[] = [];
  items: Item[] = [];
  inters: Inter[] = [];
  props: AABB[] = []; // 静态家具碰撞
  rooms = new Map<string, RoomState>();
  pendings: Pending[] = [];
  lightAnchors: { pos: THREE.Vector3; room: string }[] = [];
  lightPool: THREE.PointLight[] = [];
  aiStrips: THREE.Mesh[] = []; aiMat!: THREE.MeshBasicMaterial; aiPulse = 0; mood = 'calm';
  sky!: THREE.Mesh; skyMode = 'dusk'; sun!: THREE.DirectionalLight;
  water = { level: -2.6, target: -2.6, mesh: null as any as THREE.Mesh };
  debris: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; spin: THREE.Vector3 }[] = [];
  smokeParts: { s: THREE.Sprite; vel: THREE.Vector3; life: number; room: string }[] = [];
  holos: { g: THREE.Group; room: string; life: number; mat: THREE.ShaderMaterial }[] = [];
  decals: THREE.Mesh[] = [];
  elevator = { y: 0, target: 0, moving: false, stalled: false, map: { B: 'B', '1F': '1F', '2F': '2F', RF: 'RF' } as Record<string, string>, stopped: false, cab: null as any as THREE.Group, floorName: '1F', doorT: 0 };
  time = 0; seq = 0;
  dirtyChunkQueue: number[] = [];
  onGridChanged: () => void = () => {};
  tex: Record<string, THREE.Texture> = {};

  constructor(grid: Grid) {
    this.grid = grid;
    this.scene.background = new THREE.Color('#0e0d0b');
    this.scene.fog = new THREE.FogExp2(new THREE.Color('#0d0c0b'), 0.011);
    this.buildMaterials();
    for (let c = 0; c < CX * CZ; c++) this.buildChunk(c);
    this.buildSky();
    this.buildRooms();
    for (const d of DOORS) this.addDoor(d);
    for (const s of STAIRS) this.addStair(s, 'level');
    this.buildElevator();
    this.buildWater();
    this.buildAIStrips();
    this.buildRailings();
    grid.onChange = () => { this.onGridChanged(); };
  }

  buildMaterials() {
    const ct = TX.concreteTexture(11); this.tex.concrete = ct;
    const bump = TX.concreteBump(ct);
    this.mats.wall = new THREE.MeshStandardMaterial({ map: ct, color: '#a39b90', bumpMap: bump, bumpScale: 1.4, roughness: 0.86, envMapIntensity: 0.3 });
    this.mats.outer = new THREE.MeshStandardMaterial({ map: ct, color: '#7d7870', bumpMap: bump, bumpScale: 1.1, roughness: 0.9, envMapIntensity: 0.3 });
    this.mats.ceil = new THREE.MeshStandardMaterial({ map: TX.concreteTexture(23), color: '#6a655d', roughness: 0.95, envMapIntensity: 0.15 });
    this.mats.floor = new THREE.MeshStandardMaterial({ map: TX.floorTexture(3, '#5d5850'), roughness: 0.3, metalness: 0.08, envMapIntensity: 1.0 });
    this.mats.rock = new THREE.MeshStandardMaterial({ color: '#2b2722', roughness: 1 });
    const mt = TX.metalTexture(31);
    this.mats.metal = new THREE.MeshStandardMaterial({ map: mt, color: '#8a8580', roughness: 0.62, metalness: 0.45, envMapIntensity: 0.5 });
    this.mats.b1floor = new THREE.MeshStandardMaterial({ map: TX.floorTexture(9, '#4a4640'), roughness: 0.3, metalness: 0.15, envMapIntensity: 1.0 });
    this.mats.glass = new THREE.MeshPhysicalMaterial({ color: '#0e1518', roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.2, envMapIntensity: 1.5, depthWrite: false, side: THREE.FrontSide });
    this.mats.door = new THREE.MeshStandardMaterial({ color: '#3b3631', roughness: 0.42, metalness: 0.65, envMapIntensity: 0.6 });
    this.mats.steel = new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.35, metalness: 0.85, envMapIntensity: 0.7 });
    this.mats.wood = new THREE.MeshStandardMaterial({ map: TX.woodTexture(5), roughness: 0.6, envMapIntensity: 0.3 });
    this.mats.box = new THREE.MeshStandardMaterial({ map: TX.woodTexture(19), color: '#d8b98c', roughness: 0.8 });
    this.mats.fresh = new THREE.MeshStandardMaterial({ map: ct, color: '#d9d3c8', roughness: 0.85, envMapIntensity: 0.35 });
    this.mats.seam = new THREE.MeshBasicMaterial({ color: new THREE.Color('#F2B66D').multiplyScalar(2.4), toneMapped: false });
    this.mats.dark = new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.7 });
    this.mats.fabric = new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 0.95 });
    this.mats.fabricWarm = new THREE.MeshStandardMaterial({ color: '#7a5a44', roughness: 0.95 });
    this.mats.white = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(3), toneMapped: false });
    this.mats.paper = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.9, emissive: '#3a3020', emissiveIntensity: 0.25 });
    this.mats.plant = new THREE.MeshStandardMaterial({ color: '#4d6f42', roughness: 0.85, flatShading: true });
    this.mats.plaster = new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.9 });
  }

  // ———————————— 体素网格化 ————————————
  buildChunk(c: number) {
    const old = this.chunkMeshes.get(c); if (old) for (const m of old) { this.scene.remove(m); m.geometry.dispose(); }
    const cx = c % CX, cz = Math.floor(c / CX);
    const buckets: Record<string, { p: number[]; n: number[]; uv: number[] }> = {};
    const B = (k: string) => (buckets[k] ??= { p: [], n: [], uv: [] });
    const g = this.grid;
    const isFloorSlab = (iy: number) => [iyOf(-5), iyOf(-1), iyOf(3), iyOf(7)].includes(iy);
    const FACES: [number, number, number, number[][]][] = [
      [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [-1, 0, 0, [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
      [0, 1, 0, [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]], [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
      [0, 0, 1, [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]], [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
    ];
    for (let x = cx * CHUNK; x < Math.min(NX, cx * CHUNK + CHUNK); x++) for (let z = cz * CHUNK; z < Math.min(NZ, cz * CHUNK + CHUNK); z++) for (let iy = 0; iy < NY; iy++) {
      const m = g.get(x, iy, z); if (!SOLID(m)) continue;
      for (const [dx, dy, dz, quad] of FACES) {
        const nm = g.inb(x + dx, iy + dy, z + dz) ? g.get(x + dx, iy + dy, z + dz) : M.Air;
        if (m === M.Glass) { if (SOLID(nm)) continue; }
        else if (SOLID(nm) && nm !== M.Glass) continue;
        let key: string;
        if (m === M.Glass) key = 'glass';
        else if (dy === 1) key = isFloorSlab(iy) ? (iy === iyOf(-5) ? 'b1floor' : 'floor') : m === M.Metal ? 'metal' : 'wall';
        else if (dy === -1) key = 'ceil';
        else key = m === M.Metal ? 'metal' : m === M.Fill ? 'rock' : m === M.Outer || m === M.Roof ? 'outer' : 'wall';
        if (m === M.Fill && dy === 1 && !isFloorSlab(iy)) key = 'rock';
        const b = B(key); const wy = iy + Y0;
        for (const tri of [0, 1, 2, 0, 2, 3]) {
          const v = quad[tri]; const px = x + v[0], py = wy + v[1], pz = z + v[2];
          b.p.push(px, py, pz); b.n.push(dx, dy, dz);
          if (dx !== 0) b.uv.push(pz / 2, py / 4); else if (dz !== 0) b.uv.push(px / 2, py / 4); else b.uv.push(px / 8, pz / 8);
        }
      }
    }
    const meshes: THREE.Mesh[] = [];
    for (const [k, b] of Object.entries(buckets)) {
      if (!b.p.length) continue;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      const mesh = new THREE.Mesh(geo, this.mats[k]); mesh.matrixAutoUpdate = false; mesh.receiveShadow = true; mesh.castShadow = k !== 'glass'; mesh.userData.chunk = c;
      if (k === 'glass') mesh.renderOrder = 2;
      this.scene.add(mesh); meshes.push(mesh);
    }
    this.chunkMeshes.set(c, meshes);
  }
  flushChunks(max = 3) {
    for (const c of this.grid.dirty) { if (!this.dirtyChunkQueue.includes(c)) this.dirtyChunkQueue.push(c); }
    this.grid.dirty.clear();
    for (let i = 0; i < max && this.dirtyChunkQueue.length; i++) this.buildChunk(this.dirtyChunkQueue.shift()!);
  }

  // ———————————— 碰撞查询 ————————————
  colliders(q: AABB, out: AABB[], opts: { skipBox?: BoxObj; noBoxes?: boolean } = {}) {
    out.length = 0; const g = this.grid;
    const x0 = Math.floor(q.min[0]), x1 = Math.floor(q.max[0]), z0 = Math.floor(q.min[2]), z1 = Math.floor(q.max[2]);
    const y0 = Math.floor(q.min[1]) - Y0, y1 = Math.floor(q.max[1]) - Y0;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let iy = y0; iy <= y1; iy++) { if (!g.inb(x, iy, z)) continue; const m = g.get(x, iy, z); if (SOLID(m)) out.push({ min: [x, iy + Y0, z], max: [x + 1, iy + Y0 + 1, z + 1], tag: 'vox', ref: m }); }
    for (const d of this.doors.values()) { if (d.removed) continue; const a = this.doorAABB(d); if (a && overlap(a, q)) out.push(a); }
    for (const s of this.structs.values()) for (const b of s.boxes) { const bb = this.structBox(s, b); if (overlap(bb, q)) out.push(bb); }
    if (!opts.noBoxes) for (const b of this.boxes) { if (b.held || b === opts.skipBox) continue; const h = b.size / 2; const bb: AABB = { min: [b.pos.x - h, b.pos.y, b.pos.z - h], max: [b.pos.x + h, b.pos.y + b.size, b.pos.z + h], tag: 'box', ref: b }; if (overlap(bb, q)) out.push(bb); }
    for (const p of this.pendings) if (overlap(p.box, q)) out.push({ ...p.box, tag: 'pending', ref: p });
    for (const p of this.props) if (overlap(p, q)) out.push(p);
    for (const a of this.cabBoxes()) if (overlap(a, q)) out.push(a);
    return out;
  }
  structBox(s: Struct, b: AABB): AABB {
    if (s.rise >= 1) return { min: b.min, max: b.max, tag: 'struct', ref: s };
    const k = s.rise; const off = (1 - k) * s.riseFrom;
    return { min: [b.min[0], b.min[1] + off, b.min[2]], max: [b.max[0], b.max[1] + off, b.max[2]], tag: 'struct', ref: s };
  }
  solidAt(x: number, y: number, z: number) { return this.colliders({ min: [x - 0.01, y - 0.01, z - 0.01], max: [x + 0.01, y + 0.01, z + 0.01] }, []).length > 0; }

  // ———————————— 天空贴图 ————————————
buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uStars: { value: 0 }, uGlow: { value: new THREE.Color() }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uHorizon, uGround, uGlow; uniform float uStars, uTime; varying vec3 vDir;
        float h21( vec2 p ){ return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float vn( vec2 p ){ vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y ); }
        void main(){
          vec3 d = normalize( vDir ); float h = d.y; float az = atan( d.z, d.x );
          vec3 col = mix( uHorizon, uMid, smoothstep( -0.02, 0.26, h ) ); col = mix( col, uTop, smoothstep( 0.18, 0.8, h ) );
          col += uGlow * pow( max( 0.0, dot( normalize( vec3( d.x, 0.0, d.z ) ), normalize( vec3( -1.0, 0.0, 0.25 ) ) ) ), 6.0 ) * smoothstep( 0.45, 0.0, abs( h ) );
          float cloud = vn( vec2( az * 3.0 + uTime * 0.004, h * 14.0 ) ) * 0.6 + vn( vec2( az * 7.0, h * 30.0 ) ) * 0.4;
          col = mix( col, col * 1.25 + uGlow * 0.08, smoothstep( 0.55, 0.85, cloud ) * smoothstep( 0.02, 0.2, h ) * smoothstep( 0.7, 0.3, h ) );
          vec2 sp = vec2( az * 180.0, h * 220.0 ); col += uStars * step( 0.9965, h21( floor( sp ) ) ) * smoothstep( 0.05, 0.3, h ) * vec3( 0.8, 0.85, 1.0 );
          // 天空是印刷品：每块背板之间有一道细缝
          float seam = smoothstep( 0.012, 0.0, abs( fract( az / 6.2831853 * 14.0 ) - 0.5 ) ) + smoothstep( 0.004, 0.0, abs( fract( h * 5.0 + 0.5 ) - 0.5 ) ) * step( 0.0, h );
          col *= 1.0 - 0.07 * min( 1.0, seam );
          col = mix( uGround, col, smoothstep( -0.1, 0.0, h ) );
          gl_FragColor = vec4( col, 1.0 );
        }`,
    });
    // 一只巨大的“天空盒子”——就是字面意义上的盒子
    this.sky = new THREE.Mesh(new THREE.BoxGeometry(96, 64, 84, 1, 1, 1), mat); this.sky.position.set(20, 6, 14); this.sky.renderOrder = -1; this.scene.add(this.sky);
  }
  setSky(mode: string) {
    this.skyMode = ['dusk', 'day', 'night', 'storm', 'off'].includes(mode) ? mode : 'dusk';
    const pal = ({ dusk: ['#141a36', '#5b4a66', '#e89a66', '#1e1a18', '#ff9a4a', 0], day: ['#2f62a0', '#7ea9d4', '#d4e2ec', '#2e2c28', '#fff0d0', 0], night: ['#020308', '#070c1c', '#141c33', '#040506', '#3a4a80', 1], storm: ['#15181d', '#30363d', '#5a626b', '#141516', '#6a7078', 0], off: ['#030303', '#030303', '#030303', '#030303', '#000000', 0] } as Record<string, (string | number)[]>)[this.skyMode];
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.uTop.value.set(pal[0]); u.uMid.value.set(pal[1]); u.uHorizon.value.set(pal[2]); u.uGround.value.set(pal[3]); u.uGlow.value.set(pal[4]); u.uStars.value = pal[5];
    if (this.sun) { const look = skyLook(this.skyMode); this.sun.color.set(look.sun); this.sun.intensity = look.sunPower; }
  }

  // ———————————— 房间灯光 ————————————
  buildRooms() {
    const panelGeo = new THREE.BoxGeometry(1.4, 0.04, 0.24);
    for (const r of ROOMS) {
      const base = r.floor === 'B1' ? new THREE.Color('#ffd9a8') : r.floor === 'RF' ? new THREE.Color('#e8f0ff') : new THREE.Color('#fff1dc');
      const mat = new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(2.0), toneMapped: false });
      this.rooms.set(r.id, { light: 'on', fog: 0, gravity: 1, friction: 1, sprinkler: false, smoke: 0, camCovered: false, panels: mat, base, flick: 0 });
      const y = floorById(r.floor)!.y; const ceil = r.floor === 'RF' ? y + 2.9 : y + 2.96;
      const w = r.x1 - r.x0 - 1, d = r.z1 - r.z0 - 1;
      const nx = Math.max(1, Math.round(w / 5)), nz = Math.max(1, Math.round(d / 5));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const px = r.x0 + 1 + w * (i + 0.5) / nx, pz = r.z0 + 1 + d * (j + 0.5) / nz;
        if (this.grid.solidW(px, y + 1, pz)) continue;
        if (r.floor !== 'RF' && !this.grid.solidW(px, ceil + 0.2, pz)) { this.lightAnchors.push({ pos: new THREE.Vector3(px, y + 2.6, pz), room: r.id }); continue; }
        const p = new THREE.Mesh(panelGeo, mat); p.position.set(px, ceil, pz); if (w < d) p.rotation.y = Math.PI / 2; this.scene.add(p);
        this.lightAnchors.push({ pos: new THREE.Vector3(px, ceil - 0.25, pz), room: r.id });
      }
    }
    for (let i = 0; i < 10; i++) { const l = new THREE.PointLight('#ffe8cc', 0, 7.5, 1.6); l.castShadow = false; this.scene.add(l); this.lightPool.push(l); }
    const sun = new THREE.DirectionalLight('#ffb070', 3.4); sun.position.set(-11, 30, 7); sun.target.position.set(21, 0, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 80; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun); this.scene.add(sun.target); this.sun = sun; this.setSky('dusk');
  }
  roomLightFactor(id: string) {
    const s = this.rooms.get(id); if (!s) return 1;
    switch (s.light) { case 'off': return 0; case 'dim': return 0.3; case 'red': return 0.7; case 'flicker': return s.flick; default: return 1; }
  }
  updateLights(cam: THREE.Vector3) {
    for (const [id, s] of this.rooms) {
      if (s.light === 'flicker') s.flick = Math.random() < 0.12 ? Math.random() * 0.3 : Math.random() < 0.9 ? 1 : 0.2;
      const f = this.roomLightFactor(id); const col = s.light === 'red' ? new THREE.Color('#ff3020') : s.color ?? s.base;
      s.panels.color.copy(col).multiplyScalar(0.04 + 2.6 * f * Math.min(1, 0.35 + roomLightDesign(id).power));
    }
    if ((this.time * 4 | 0) !== ((this.time - 0.016) * 4 | 0) || this.time < 0.1) {
      const scored = this.lightAnchors.map(a => ({ a, d: a.pos.distanceToSquared(cam) + Math.abs(a.pos.y - cam.y) * 30 })).sort((p, q) => p.d - q.d);
      this.lightPool.forEach((l, i) => { const s = scored[i]; if (!s) { l.intensity = 0; return; } l.position.copy(s.a.pos); l.userData.room = s.a.room; });
    }
    for (const l of this.lightPool) {
      const id = l.userData.room; if (!id) continue; const s = this.rooms.get(id)!; const f = this.roomLightFactor(id);
      const design = roomLightDesign(id); l.color.copy(s.light === 'red' ? new THREE.Color('#ff3a24') : s.color ?? design.color); l.intensity = 1.05 * f * design.power;
    }
  }

  // ———————————— 门 ————————————
  addDoor(def: DoorDef, byAI = false) {
    const f = floorById(def.floor)!; const y = f.y;
    const [x0, z0] = def.cells[0]; const [x1, z1] = def.cells[def.cells.length - 1];
    const wallAlongX = SOLID(this.grid.get(Math.min(x0, x1) - 1, iyOf(y + 0.5), z0)) || SOLID(this.grid.get(Math.max(x0, x1) + 1, iyOf(y + 0.5), z0));
    const axis: 'x' | 'z' = def.cells.length > 1 ? (x0 === x1 ? 'x' : 'z') : wallAlongX ? 'z' : 'x'; // 通行方向
    const width = def.cells.length;
    const center = new THREE.Vector3((x0 + x1 + 1) / 2, y, (z0 + z1 + 1) / 2);
    const group = new THREE.Group(); group.position.copy(center); if (axis === 'x') group.rotation.y = Math.PI / 2;
    const panels: THREE.Object3D[] = [];
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(geo, mat); group.add(m); return m; };
    if (def.kind === 'glass' || def.kind === 'elevator') {
      const mat = def.kind === 'glass' ? this.mats.glass : this.mats.steel;
      for (const s of [-1, 1]) { const p = mk(new THREE.BoxGeometry(width / 2, 2, 0.06), mat); p.position.set(s * width / 4, 1, 0); p.userData.side = s; panels.push(p); if (def.kind === 'glass') { const fr = new THREE.Mesh(new THREE.BoxGeometry(width / 2, 0.05, 0.08), this.mats.steel); fr.position.y = 0.05; p.add(fr); const fr2 = fr.clone(); fr2.position.y = 0.97; p.add(fr2); } }
    } else if (def.kind === 'bars') {
      const p = new THREE.Group(); for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 6), this.mats.steel); b.position.set(-0.42 + i * 0.168, 1, 0); p.add(b); } const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.06), this.mats.steel); bar.position.y = 1.9; p.add(bar); const bar2 = bar.clone(); bar2.position.y = 0.15; p.add(bar2); group.add(p); p.userData.side = 1; panels.push(p);
    } else if (def.kind === 'blast') {
      const p = mk(new THREE.BoxGeometry(width, 2, 0.32), this.mats.steel); p.position.y = 1; p.userData.side = 0; panels.push(p);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.12, 0.34), new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.6 })); stripe.position.y = -0.3; p.add(stripe);
    } else {
      const p = mk(new THREE.BoxGeometry(width, 2, 0.08), this.mats.door); p.position.set(0, 1, 0); p.userData.side = 1; panels.push(p);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.12), this.mats.steel); h.position.set(width * 0.38, 0, 0); p.add(h);
    }
    // 门框
    const frameMat = this.mats.dark;
    const top = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, 0.06, 1.02), frameMat); top.position.y = 2.0; group.add(top);
    this.scene.add(group);
    const d: DoorObj = { def, id: def.id, floorY: y, cells: def.cells, axis, group, panels, t: def.open ? 1 : 0, open: !!def.open, locked: !!def.locked, removed: false, kind: def.kind, center, width, byAI };
    this.doors.set(def.id, d);
    return d;
  }
  doorAABB(d: DoorObj): AABB | null {
    if (d.t > 0.82) return null;
    const c = d.center; const h = d.width / 2; const th = d.kind === 'blast' ? 0.2 : 0.12;
    if (d.axis === 'z') return { min: [c.x - h, d.floorY, c.z - th], max: [c.x + h, d.floorY + 2, c.z + th], tag: 'door', ref: d };
    return { min: [c.x - th, d.floorY, c.z - h], max: [c.x + th, d.floorY + 2, c.z + h], tag: 'door', ref: d };
  }
  updateDoors(dt: number) {
    for (const d of this.doors.values()) {
      if (d.removed) continue;
      const target = d.open ? 1 : 0; const sp = d.kind === 'blast' ? 0.5 : d.kind === 'elevator' ? 1.2 : 1.8;
      d.t += Math.sign(target - d.t) * Math.min(Math.abs(target - d.t), dt * sp);
      for (const p of d.panels) {
        const s = p.userData.side;
        if (d.kind === 'blast') p.position.y = 1 + d.t * 2.05;
        else if (d.kind === 'bars') { p.rotation.y = -d.t * 1.6; p.position.x = -Math.sin(d.t * 1.6) * 0.5 + (1 - Math.cos(d.t * 1.6)) * -0.0; }
        else if (s) p.position.x = (d.kind === 'glass' || d.kind === 'elevator') ? s * (d.width / 4 + d.t * d.width / 2 * 0.95) : d.t * d.width * 0.96;
      }
    }
  }
  removeDoor(d: DoorObj) { d.removed = true; this.scene.remove(d.group); this.doors.delete(d.id); }

  // ———————————— 结构（楼梯、平台、栏杆等） ————————————
  addStruct(kind: string, boxes: AABB[], opts: { by?: 'ai' | 'level'; label?: string; floor?: string; riseFrom?: number; riseDur?: number; mat?: THREE.Material; visual?: THREE.Group; id?: string; pushable?: boolean; meta?: any } = {}) {
    const id = opts.id ?? `${kind.toUpperCase()}${++this.seq}`;
    const group = opts.visual ?? new THREE.Group();
    if (!opts.visual) {
      const mat = opts.mat ?? (opts.by === 'ai' ? this.mats.fresh : this.mats.wall);
      for (const b of boxes) {
        const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
        const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d), mat); m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2); m.receiveShadow = true; group.add(m);
        if (opts.by === 'ai') { const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.02, d + 0.01), this.mats.seam); s.position.set(m.position.x, b.max[1] + 0.005, m.position.z); group.add(s); }
      }
    }
    this.scene.add(group);
    const s: Struct = { id, kind, boxes, group, rise: opts.riseDur ? 0 : 1, riseDur: opts.riseDur ?? 0, riseFrom: opts.riseFrom ?? 0, by: opts.by ?? 'level', label: opts.label ?? kind, floor: opts.floor ?? '', pushable: opts.pushable, meta: opts.meta };
    if (s.rise < 1) group.position.y = s.riseFrom;
    this.structs.set(id, s); return s;
  }
  removeStruct(id: string) { const s = this.structs.get(id); if (!s) return false; this.scene.remove(s.group); this.structs.delete(id); return true; }
  addStair(s: StairDef, by: 'ai' | 'level', riseDur = 0, floorId = '') {
    const boxes = stairBoxes(s).map(b => ({ min: b.min, max: b.max }));
    const g = new THREE.Group(); const mat = by === 'ai' ? this.mats.fresh : this.mats.wall;
    for (const b of boxes) {
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d), mat); m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2); g.add(m);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(s.dir[1] === 'x' ? 0.04 : w, 0.02, s.dir[1] === 'x' ? d : 0.04), by === 'ai' ? this.mats.seam : this.mats.dark);
      nose.position.set(s.dir === '+x' ? b.min[0] + 0.02 : s.dir === '-x' ? b.max[0] - 0.02 : m.position.x, b.max[1] + 0.01, s.dir === '+z' ? b.min[2] + 0.02 : s.dir === '-z' ? b.max[2] - 0.02 : m.position.z); g.add(nose);
    }
    return this.addStruct('stairs', boxes, { by, visual: g, id: by === 'level' ? s.id : undefined, label: by === 'level' ? '楼梯' : 'AI 建造的楼梯', floor: floorId, riseDur, riseFrom: riseDur ? -s.rise - 0.2 : 0, meta: s });
  }
  buildRailings() {
    // 2F 中庭挑空四周的玻璃栏杆（高 1.1）
    const v = ATRIUM_VOID; const y = 4; const H = 1.1; const t = 0.06; const boxes: AABB[] = [];
    boxes.push({ min: [v.x0 - t, y, v.z0 - t], max: [v.x1 + t, y + H, v.z0] }, { min: [v.x0 - t, y, v.z1], max: [v.x1 + t, y + H, v.z1 + t] }, { min: [v.x0 - t, y, v.z0], max: [v.x0, y + H, v.z1] }, { min: [v.x1, y, v.z0], max: [v.x1 + t, y + H, v.z1] });
    const g = new THREE.Group();
    for (const b of boxes) { const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2]; const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats.glass); m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2); m.renderOrder = 2; g.add(m); const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.04, d + 0.02), this.mats.steel); cap.position.set(m.position.x, b.max[1], m.position.z); g.add(cap); }
    this.addStruct('railing', boxes, { visual: g, id: 'RAIL_ATRIUM', label: '回廊玻璃栏杆' });
    // 主楼梯开洞边的栏杆（2F）
    const rb: AABB[] = [{ min: [31, 4, 12.94], max: [38, 5.1, 13] }, { min: [31, 4, 15], max: [38, 5.1, 15.06] }, { min: [30.94, 4, 13], max: [31, 5.1, 15] }];
    const g2 = new THREE.Group(); for (const b of rb) { const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2]; const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats.glass); m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2); g2.add(m); }
    this.addStruct('railing', rb, { visual: g2, id: 'RAIL_STAIR', label: '楼梯栏杆' });
  }

  // ———————————— 箱子 ————————————
  addBox(x: number, y: number, z: number, byAI = false, kind = 'box', size = BOX_SIZE) {
    const id = `${kind === 'box' ? 'B' : kind.toUpperCase()}${++this.seq}`;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = kind === 'barrier' ? new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.6 }) : byAI ? new THREE.MeshStandardMaterial({ map: (this.mats.box as any).map, color: '#e7d2ad', roughness: 0.8 }) : this.mats.box;
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
    if (byAI) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.8 })); mesh.add(e); }
    this.scene.add(mesh);
    const b: BoxObj = { id, mesh, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), held: false, frozen: false, locked: false, byAI, kind, size, restT: 0 };
    this.boxes.push(b); return b;
  }
  removeBox(b: BoxObj) { this.scene.remove(b.mesh); this.boxes = this.boxes.filter(x => x !== b); }
  updateBoxes(dt: number, gravityAt: (x: number, y: number, z: number) => number) {
    const cols: AABB[] = [];
    for (const b of this.boxes) {
      if (b.held || b.frozen) { b.mesh.position.set(b.pos.x, b.pos.y + b.size / 2, b.pos.z); continue; }
      if (b.restT > 1.5 && b.vel.lengthSq() < 0.0001) { if (!this.boxSupported(b)) b.restT = 0; else { b.mesh.position.set(b.pos.x, b.pos.y + b.size / 2, b.pos.z); continue; } }
      const gmul = gravityAt(b.pos.x, b.pos.y, b.pos.z);
      b.vel.y -= 17 * gmul * dt; b.vel.x *= 1 - Math.min(1, dt * 0.6); b.vel.z *= 1 - Math.min(1, dt * 0.6);
      const h = b.size / 2; let grounded = false;
      for (const ax of [0, 2, 1] as const) {
        const d = (ax === 0 ? b.vel.x : ax === 1 ? b.vel.y : b.vel.z) * dt; if (d === 0) continue;
        const key = (['x', 'y', 'z'] as const)[ax]; b.pos[key] += d;
        const me: AABB = { min: [b.pos.x - h, b.pos.y, b.pos.z - h], max: [b.pos.x + h, b.pos.y + b.size, b.pos.z + h] };
        this.colliders({ min: [me.min[0] - 0.1, me.min[1] - 0.1, me.min[2] - 0.1], max: [me.max[0] + 0.1, me.max[1] + 0.1, me.max[2] + 0.1] }, cols, { skipBox: b });
        for (const c of cols) {
          if (!overlap(me, c, 0.0005)) continue;
          if (ax === 1) { if (d < 0) { b.pos.y = c.max[1]; grounded = true; } else b.pos.y = c.min[1] - b.size; b.vel.y = 0; }
          else if (ax === 0) { b.pos.x = d > 0 ? c.min[0] - h : c.max[0] + h; b.vel.x *= -0.2; }
          else { b.pos.z = d > 0 ? c.min[2] - h : c.max[2] + h; b.vel.z *= -0.2; }
          me.min = [b.pos.x - h, b.pos.y, b.pos.z - h]; me.max = [b.pos.x + h, b.pos.y + b.size, b.pos.z + h];
        }
      }
      if (grounded) { b.vel.x *= 0.6; b.vel.z *= 0.6; if (b.vel.lengthSq() < 0.02) { b.vel.set(0, 0, 0); b.restT += dt; } } else b.restT = 0;
      if (b.pos.y < -30) b.frozen = true;
      b.mesh.position.set(b.pos.x, b.pos.y + b.size / 2, b.pos.z);
    }
  }
  boxSupported(b: BoxObj) { const h = b.size / 2 - 0.02; return this.colliders({ min: [b.pos.x - h, b.pos.y - 0.05, b.pos.z - h], max: [b.pos.x + h, b.pos.y - 0.01, b.pos.z + h] }, [], { skipBox: b }).length > 0; }

  // ———————————— 电梯 ————————————
  buildElevator() {
    const g = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), this.mats.steel); floor.position.set(8, -0.1, 16); g.add(floor);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 2), this.mats.steel); back.position.set(7.03, 1.3, 16); g.add(back);
    for (const z of [15.03, 16.97]) { const s = new THREE.Mesh(new THREE.BoxGeometry(2, 2.6, 0.06), this.mats.steel); s.position.set(8, 1.3, z); g.add(s); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 2), this.mats.steel); roof.position.set(8, 2.66, 16); g.add(roof);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.3), this.mats.white); lamp.position.set(8, 2.59, 16); g.add(lamp);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.6), this.mats.dark); hatch.position.set(8.2, 2.585, 15.6); g.add(hatch); hatch.name = 'hatch';
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.25), new THREE.MeshStandardMaterial({ color: '#202326', emissive: '#F2B66D', emissiveIntensity: 0.25 })); panel.position.set(7.07, 1.3, 15.5); g.add(panel); panel.name = 'panel';
    this.scene.add(g); this.elevator.cab = g;
  }
  cabBoxes(): AABB[] {
    const y = this.elevator.y; return [
      { min: [7, y - 0.2, 15], max: [9, y, 17], tag: 'cab' },
      { min: [7, y, 15], max: [7.06, y + 2.6, 17], tag: 'cab' },
      { min: [7, y, 15], max: [9, y + 2.6, 15.06], tag: 'cab' },
      { min: [7, y, 16.94], max: [9, y + 2.6, 17], tag: 'cab' },
      { min: [7, y + 2.6, 15], max: [9, y + 2.72, 17], tag: 'cabroof' },
    ];
  }

  // ———————————— 水 ————————————
  buildWater() {
    const geo = new THREE.PlaneGeometry(14, 10, 1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({ color: '#1c3a3a', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.72, envMapIntensity: 1.2, depthWrite: false });
    const m = new THREE.Mesh(geo, mat); m.position.set(14, this.water.level, 15); m.renderOrder = 3; this.scene.add(m); this.water.mesh = m;
  }
  inWater(x: number, z: number) { return x > 7 && x < 21 && z > 10 && z < 20; }

  // ———————————— AI 灯带 ————————————
  buildAIStrips() {
    this.aiMat = new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(2), toneMapped: false });
    const strips: [number, number, number, number, number][] = [ // x0,z0,x1,z1,y
      [15.2, 20.3, 24.8, 20.3, 2.94], [27.2, 7.5, 27.2, 20, 2.94], [9.2, 1.5, 9.2, 13, 2.94], [17.5, 7.3, 24.5, 7.3, 6.94], [27, 9.5, 38.5, 9.5, 6.94], [22.5, 6.5, 38.5, 6.5, -1.06], [27, 22.5, 38, 22.5, 2.94], [17, 20.3, 29, 20.3, 6.94],
    ];
    for (const [x0, z0, x1, z1, y] of strips) {
      const len = Math.hypot(x1 - x0, z1 - z0); const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.05), this.aiMat);
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); this.scene.add(m); this.aiStrips.push(m);
    }
  }
  setMood(m: string) { this.mood = m; }
  updateAI(dt: number) {
    this.aiPulse = Math.max(0, this.aiPulse - dt * 1.5);
    const col = { calm: '#F2B66D', concerned: '#F2B66D', persuasive: '#F5C27A', anxious: '#F29A5D', panic: '#F2564D', defeated: '#9CC8F0', angry: '#F2564D' }[this.mood] ?? '#F2B66D';
    const k = 1.4 + this.aiPulse * 2.2 + (this.mood === 'panic' ? Math.sin(this.time * 18) * 0.6 : Math.sin(this.time * 1.3) * 0.15);
    this.aiMat.color.set(col).multiplyScalar(k);
  }

  // ———————————— 特效 ————————————
  spawnDebris(x: number, y: number, z: number, n = 14, mat?: THREE.Material) {
    for (let i = 0; i < n; i++) {
      const s = 0.06 + Math.random() * 0.22; const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s), mat ?? this.mats.wall);
      m.position.set(x + Math.random() - 0.5, y + Math.random() * 2.5, z + Math.random() - 0.5); this.scene.add(m);
      this.debris.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4), life: 2.5 + Math.random(), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
    }
    for (let i = 0; i < 6; i++) this.puff(x + Math.random() - 0.5, y + Math.random() * 2, z + Math.random() - 0.5, '#bdb6aa', 0.5);
  }
  private puffTex?: THREE.Texture;
  puff(x: number, y: number, z: number, color = '#bdb6aa', a = 0.5, room = '') {
    if (!this.puffTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d')!; const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); this.puffTex = new THREE.CanvasTexture(c); }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, color, transparent: true, opacity: a, depthWrite: false }));
    s.position.set(x, y, z); s.scale.setScalar(0.8 + Math.random()); this.scene.add(s);
    this.smokeParts.push({ s, vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4), life: room ? 6 : 2.2, room });
  }
  updateFX(dt: number) {
    for (const d of this.debris) { d.vel.y -= 14 * dt; d.mesh.position.addScaledVector(d.vel, dt); if (this.grid.solidW(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z)) { d.vel.multiplyScalar(-0.2); d.mesh.position.y += 0.02; } d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.life -= dt; if (d.life < 0.5) d.mesh.scale.setScalar(Math.max(0.01, d.life * 2)); }
    this.debris = this.debris.filter(d => { if (d.life <= 0) { this.scene.remove(d.mesh); return false; } return true; });
    for (const p of this.smokeParts) { p.s.position.addScaledVector(p.vel, dt); p.life -= dt; p.s.scale.multiplyScalar(1 + dt * 0.35); (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min((p.s.material as THREE.SpriteMaterial).opacity, p.life * 0.15)); }
    this.smokeParts = this.smokeParts.filter(p => { if (p.life <= 0) { this.scene.remove(p.s); return false; } return true; });
    for (const h of this.holos) { h.life -= dt; h.mat.uniforms.uTime.value = this.time; h.mat.uniforms.uAlpha.value = Math.min(1, h.life / 1.5) * Math.min(1, (h.g.userData.age = (h.g.userData.age ?? 0) + dt) * 1.2); }
    this.holos = this.holos.filter(h => { if (h.life <= 0) { this.scene.remove(h.g); return false; } return true; });
    // 水
    this.water.level += Math.sign(this.water.target - this.water.level) * Math.min(Math.abs(this.water.target - this.water.level), dt * 0.25);
    this.water.mesh.position.y = this.water.level + Math.sin(this.time * 0.8) * 0.01;
  }
  hologram(x: number, y: number, z: number, room: string, life = 20, yaw = 0, sitting = false) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uCol: { value: new THREE.Color('#F2B66D') } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vP; varying vec3 vN; void main(){ vP=(modelMatrix*vec4(position,1.)).xyz; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.); }`,
      fragmentShader: `uniform float uTime,uAlpha; uniform vec3 uCol; varying vec3 vP; varying vec3 vN; void main(){ float scan=step(.5,fract(vP.y*22.-uTime*2.)); float rim=pow(1.-abs(vN.z),1.5); float a=(.10+.35*rim)*(.6+.4*scan)*uAlpha; a*= .85+.15*sin(uTime*30.+vP.y*3.); gl_FragColor=vec4(uCol*1.6,a); }`,
    });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, sitting ? 0.55 : 0.95, 4, 12), mat); body.position.y = sitting ? 0.85 : 0.95; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat); head.position.y = sitting ? 1.42 : 1.72; g.add(head);
    g.position.set(x, y, z); g.rotation.y = yaw; this.scene.add(g);
    this.holos.push({ g, room, life, mat }); return g;
  }
  addDecal(tex: THREE.Texture, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, glow = 1.0, visible = true) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1, 1, 1).multiplyScalar(glow), polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x + nx * 0.012, y, z + nz * 0.012); m.lookAt(x + nx, y, z + nz); m.visible = visible; this.scene.add(m); this.decals.push(m); return m;
  }

  // 统一更新
  update(dt: number, cam: THREE.Camera, gravityAt: (x: number, y: number, z: number) => number) {
    this.time += dt;
    this.flushChunks();
    this.updateDoors(dt);
    this.updateBoxes(dt, gravityAt);
    this.updateLights(cam.position);
    this.updateAI(dt);
    this.updateFX(dt);
    // 结构升起
    for (const s of this.structs.values()) if (s.rise < 1) { s.rise = Math.min(1, s.rise + dt / s.riseDur); const e = 1 - Math.pow(1 - s.rise, 3); s.group.position.y = (1 - e) * s.riseFrom; if (Math.random() < 0.3) { const b = s.boxes[0]; this.puff((b.min[0] + b.max[0]) / 2, b.min[1] + 0.2, (b.min[2] + b.max[2]) / 2, '#bdb6aa', 0.35); } }
    // 待落成的墙体
    for (const p of this.pendings) {
      p.t = Math.min(1, p.t + dt / p.dur); const e = 1 - Math.pow(1 - p.t, 2.4);
      if (p.mode === 'slide') { for (const k of [0, 2]) { p.box.min[k] = p.from!.min[k] + (p.target.min[k] - p.from!.min[k]) * e; p.box.max[k] = p.from!.max[k] + (p.target.max[k] - p.from!.max[k]) * e; } p.mesh.position.set((p.box.min[0] + p.box.max[0]) / 2, (p.box.min[1] + p.box.max[1]) / 2, (p.box.min[2] + p.box.max[2]) / 2); if (Math.random() < 0.3) this.puff(p.box.min[0], p.box.min[1] + 0.1, p.box.min[2], '#c8c0b2', 0.3); continue; }
      if (p.mode === 'up') { p.box.min[1] = p.target.min[1]; p.box.max[1] = p.target.min[1] + (p.target.max[1] - p.target.min[1]) * e; }
      else { p.box.max[1] = p.target.max[1]; p.box.min[1] = p.target.max[1] - (p.target.max[1] - p.target.min[1]) * e; }
      const h = Math.max(0.01, p.box.max[1] - p.box.min[1]); p.mesh.scale.y = h / (p.target.max[1] - p.target.min[1]); p.mesh.position.y = p.box.min[1] + h / 2;
      if (Math.random() < 0.25) this.puff((p.box.min[0] + p.box.max[0]) / 2, p.mode === 'up' ? p.box.min[1] + 0.1 : p.box.min[1], (p.box.min[2] + p.box.max[2]) / 2, '#c8c0b2', 0.3);
    }
    for (const p of this.pendings.filter(p => p.t >= 1)) { this.scene.remove(p.mesh); p.onDone(); }
    this.pendings = this.pendings.filter(p => p.t < 1);
  }
  addSlide(from: AABB, to: AABB, dur: number, onDone: () => void) {
    const w = from.max[0] - from.min[0], h = from.max[1] - from.min[1], d = from.max[2] - from.min[2];
    const mesh = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d), this.mats.fresh); mesh.position.set((from.min[0] + from.max[0]) / 2, (from.min[1] + from.max[1]) / 2, (from.min[2] + from.max[2]) / 2); this.scene.add(mesh);
    const dir = [Math.sign(to.min[0] - from.min[0]), 0, Math.sign(to.min[2] - from.min[2])];
    const p: Pending = { id: `P${++this.seq}`, box: { min: [...from.min], max: [...from.max] }, target: to, from, t: 0, dur, mode: 'slide', mesh, onDone, kind: 'slide', dir }; this.pendings.push(p); return p;
  }
  addPending(target: AABB, mode: 'up' | 'down', dur: number, onDone: () => void, kind = 'wall', mat?: THREE.Material) {
    const w = target.max[0] - target.min[0], h = target.max[1] - target.min[1], d = target.max[2] - target.min[2];
    const mesh = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d), mat ?? this.mats.fresh); mesh.position.set((target.min[0] + target.max[0]) / 2, target.min[1], (target.min[2] + target.max[2]) / 2); mesh.scale.y = 0.001; this.scene.add(mesh);
    const box: AABB = { min: [...target.min], max: [...target.max] }; if (mode === 'up') box.max[1] = box.min[1] + 0.01; else box.min[1] = box.max[1] - 0.01;
    const p: Pending = { id: `P${++this.seq}`, box, target, t: 0, dur, mode, mesh, onDone, kind }; this.pendings.push(p); return p;
  }
  roomOf(x: number, y: number, z: number): Room | undefined { return roomAt(x, y, z); }
}

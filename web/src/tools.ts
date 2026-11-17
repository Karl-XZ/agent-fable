import * as THREE from 'three';
import { World, AABB, DoorObj } from './world';
import { Grid, M, NX, NZ, ROOMS, Room, roomById, floorById, floorOfY, iyOf, SOLID, StairDef, BOX_SIZE } from './level';
import * as TX from './textures';
import type { NavigationTarget, NavigationResult } from './navigation';
import type { JingProjection } from './projection';

export interface ToolCall { name: string; args: Record<string, any> }
export interface ToolResult { ok: boolean; msg: string; label: string; call?: ToolCall; anchored?: boolean; x?: number; y?: number; z?: number; navigation?: Omit<NavigationResult, 'waypoints'>; projection_walls?: ReturnType<JingProjection['walls']> }

export interface ToolCtx {
  projection: JingProjection;
  world: World; grid: Grid;
  playerPos(): THREE.Vector3; playerFloor(): string; playerRoom(): string;
  navigate(target: NavigationTarget): Omit<NavigationResult, 'waypoints'>;
  anchoredAt(x: number, y: number, z: number): string | null;
  after(sec: number, fn: () => void): void;
  say(text: string, who?: string): void; toast(text: string): void; glitch(amount: number, inView?: THREE.Vector3): void;
  sound(kind: string, at?: THREE.Vector3): void;
  setBoard(text: string, admin: boolean, byAI: boolean): void;
  print(text: string): void; phone(text: string): void;
  setScreen(room: string, text: string): void;
  rewriteNote(id: string, text: string): boolean;
  blackoutTeleport(room: Room): void;
  pushPlayer(v: THREE.Vector3): void; slowPlayer(sec: number): void;
  setAlarm(on: boolean): void; setMusic(mood: string): void;
  confess(): void; handover(channel: string): boolean;
  mirrorDelay(sec: number): void; snapshots: Map<string, Uint8Array>;
  onEdit(label: string, x: number, y: number, z: number, ok: boolean): void;
  onBreach(): void;
  fakeDoors: { x: number; y: number; z: number; mesh: THREE.Mesh }[];
  channel: string;
}

const WALL_LAYERS = 3;
const fmtCells = (n: number) => `${n} 格`;
function floorId(a: any, ctx: ToolCtx): string {
  if (a === undefined || a === null || a === '') return ctx.playerFloor();
  const s = String(a).toUpperCase().replace('楼', 'F').replace('层', '');
  if (s === '1' || s === '1F' || s === 'F1') return '1F'; if (s === '2' || s === '2F' || s === 'F2') return '2F';
  if (s.startsWith('B') || s === '-1' || s === '0') return 'B1'; if (s.startsWith('R') || s === '3' || s === '3F') return 'RF';
  return ctx.playerFloor();
}
const num = (v: any, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clampI = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(v)));

function rectCells(a: Record<string, any>): [number, number][] {
  const x1 = clampI(num(a.x1 ?? a.x, NaN), -1, NX), z1 = clampI(num(a.z1 ?? a.z, NaN), -1, NZ);
  const x2 = clampI(num(a.x2 ?? a.x1 ?? a.x, NaN), -1, NX), z2 = clampI(num(a.z2 ?? a.z1 ?? a.z, NaN), -1, NZ);
  if ([x1, z1, x2, z2].some(v => !Number.isFinite(v))) return [];
  const out: [number, number][] = [];
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) if (x >= 0 && z >= 0 && x < NX && z < NZ) out.push([x, z]);
  return out.slice(0, 80);
}
function sideCells(r: Room, side: string, len: any, ctx: ToolCtx): [number, number][] {
  const s = String(side ?? '').toUpperCase()[0];
  let cells: [number, number][] = [];
  if (s === 'N') for (let x = r.x0 + 1; x < r.x1; x++) cells.push([x, r.z0]);
  else if (s === 'S') for (let x = r.x0 + 1; x < r.x1; x++) cells.push([x, r.z1]);
  else if (s === 'W') for (let z = r.z0 + 1; z < r.z1; z++) cells.push([r.x0, z]);
  else if (s === 'E') for (let z = r.z0 + 1; z < r.z1; z++) cells.push([r.x1, z]);
  if (!cells.length) return [];
  if (len === 'all' || len === undefined && false) return cells;
  const n = len === undefined ? 2 : len === 'all' ? cells.length : clampI(num(len, 2), 1, cells.length);
  // 优先选择离玩家最近的一段（若玩家在本房间），否则居中
  const p = ctx.playerPos(); let center = Math.floor(cells.length / 2);
  if (ctx.playerRoom() === r.id) { let best = 1e9; cells.forEach(([x, z], i) => { const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z); if (d < best) { best = d; center = i; } }); }
  const a = Math.max(0, Math.min(cells.length - n, center - Math.floor(n / 2)));
  return cells.slice(a, a + n);
}
function resolveCells(a: Record<string, any>, ctx: ToolCtx): { cells: [number, number][]; floor: string; room?: Room } {
  if (a.room && (a.side || a.wall)) { const r = roomById(a.room); if (r) return { cells: sideCells(r, a.side ?? a.wall, a.len ?? a.length, ctx), floor: r.floor, room: r }; }
  if (a.room && a.x === undefined && a.x1 === undefined) { const r = roomById(a.room); if (r) { const cells: [number, number][] = []; for (let x = r.x0 + 1; x < r.x1; x++) for (let z = r.z0 + 1; z < r.z1; z++) cells.push([x, z]); return { cells, floor: r.floor, room: r }; } }
  return { cells: rectCells(a), floor: floorId(a.floor, ctx) };
}
function isBoundary(x: number, z: number) { return x === 0 || z === 0 || x === NX - 1 || z === NZ - 1; }

export function execTool(call: ToolCall, ctx: ToolCtx): ToolResult {
  const a = call.args ?? {}; const w = ctx.world, g = ctx.grid;
  const R = (ok: boolean, msg: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok, msg, label: `${call.name} ${shortArgs(a)}`, call: { name: call.name, args: a }, ...extra });
  const anchorCheck = (cells: [number, number][], y0: number, y1: number) => { for (const [x, z] of cells) for (const y of [y0 + 0.5, (y0 + y1) / 2, y1 - 0.5]) { const an = ctx.anchoredAt(x + 0.5, y, z + 0.5); if (an) return an; } return null; };
  const doorOf = (id: any) => w.doors.get(String(id ?? '').toUpperCase()) ?? [...w.doors.values()].find(d => d.id.toUpperCase() === String(id ?? '').toUpperCase());
  const doorAtCell = (x: number, z: number, floor: string) => [...w.doors.values()].find(d => d.def.floor === floor && d.cells.some(([cx, cz]) => cx === x && cz === z));
  try {
    switch (call.name) {
      case 'project_self': { const result=ctx.projection.show(a);return R(result.ok,result.msg); }
      case 'hide_projection': { const result=ctx.projection.hide();return R(result.ok,result.msg); }
      case 'list_projection_walls': return R(true,'已查询当前摄像头看得到的墙面。',{projection_walls:ctx.projection.walls(typeof a.room==='string'?a.room:undefined,true)});
      case 'find_path': {
        const navigation = ctx.navigate(a);
        return R(['ok', 'requires_action', 'arrived'].includes(navigation.status), navigation.message, { navigation });
      }
      // ———— 墙 ————
      case 'build_wall': case 'thicken_wall': case 'seal_room': {
        let { cells, floor, room } = resolveCells(a, ctx);
        if (call.name === 'thicken_wall' && room) { const s = String(a.side ?? '').toUpperCase()[0]; const d = s === 'N' ? [0, 1] : s === 'S' ? [0, -1] : s === 'W' ? [1, 0] : [-1, 0]; cells = sideCells(room, a.side, 'all', ctx).map(([x, z]) => [x + d[0], z + d[1]] as [number, number]); }
        if (call.name === 'seal_room') { const r = roomById(a.room); if (!r) return R(false, `没有房间 ${a.room}`); floor = r.floor; cells = []; for (const d of w.doors.values()) if (d.def.floor === r.floor && d.cells.some(([x, z]) => (x === r.x0 || x === r.x1) && z > r.z0 && z < r.z1 || (z === r.z0 || z === r.z1) && x > r.x0 && x < r.x1)) cells.push(...d.cells); if (!cells.length) return R(false, '该房间没有门'); }
        if (!cells.length) return R(false, '坐标无效：需要 floor 与 x1,z1,x2,z2，或 room 与 side');
        const y = floorById(floor)!.y; const an = anchorCheck(cells, y, y + 3); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        let n = 0;
        for (const [x, z] of cells) {
          const iy = iyOf(y + 0.5); if (SOLID(g.get(x, iy, z)) && SOLID(g.get(x, iy + 1, z))) continue;
          const door = doorAtCell(x, z, floor); n++;
          const layers = floor === '2F' && x >= 30 && z >= 18 && isBoundary(x, z) ? 6 : WALL_LAYERS; // 露台护屏有 6 米高
          w.addPending({ min: [x, y, z], max: [x + 1, y + layers, z + 1] }, 'up', 1.1 + Math.random() * 0.3, () => {
            for (let k = 0; k < layers; k++) if (!SOLID(g.get(x, iyOf(y + k + 0.5), z))) g.set(x, iyOf(y + k + 0.5), z, isBoundary(x, z) ? M.Outer : M.Wall);
            if (door && !door.removed) w.removeDoor(door);
          });
        }
        if (!n) return R(false, '这些格子已经是墙了');
        const c = cells[Math.floor(cells.length / 2)]; ctx.onEdit(call.name, c[0] + 0.5, y, c[1] + 0.5, true); ctx.sound('rumble', new THREE.Vector3(c[0], y, c[1]));
        return R(true, `正在升起 ${fmtCells(n)} 墙体`, { x: c[0], y, z: c[1] });
      }
      case 'destroy_wall': case 'break_wall': {
        const { cells, floor } = resolveCells(a, ctx); if (!cells.length) return R(false, '坐标无效：需要 floor 与 x1,z1,x2,z2，或 room 与 side');
        const y = floorById(floor)!.y; const top = a.full || floor === '2F' && cells.some(([x, z]) => x >= 30 && z >= 18) ? 6 : WALL_LAYERS;
        const an = anchorCheck(cells, y, y + 3); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        let n = 0, breach = false;
        for (const [x, z] of cells) {
          let any = false;
          for (let k = 0; k < top; k++) { const iy = iyOf(y + k + 0.5); const m = g.get(x, iy, z); if (!SOLID(m)) continue; if (m === M.Outer || m === M.Glass || isBoundary(x, z)) breach = true; g.set(x, iy, z, M.Air); any = true; }
          const door = doorAtCell(x, z, floor); if (door) { w.removeDoor(door); any = true; }
          if (any) { n++; w.spawnDebris(x + 0.5, y, z + 0.5, 10, g.get(x, iyOf(y - 0.5), z) === M.Metal ? w.mats.metal : w.mats.wall); }
        }
        if (!n) return R(false, '这些格子不是墙（可能已经是空的）');
        const c = cells[Math.floor(cells.length / 2)]; ctx.onEdit(call.name, c[0] + 0.5, y, c[1] + 0.5, true); ctx.sound('crash', new THREE.Vector3(c[0], y, c[1]));
        if (breach) ctx.onBreach();
        return R(true, `拆除了 ${fmtCells(n)} 墙体${breach ? '（包括外墙）' : ''}`, { x: c[0], y, z: c[1] });
      }
      case 'move_wall': {
        const r = roomById(a.room); if (!r) return R(false, `没有房间 ${a.room}`);
        const s = String(a.side ?? '').toUpperCase()[0]; const dist = clampI(num(a.dist ?? a.distance, -1), -6, 6); if (!dist) return R(false, 'dist 不能为 0');
        const old = sideCells(r, s, 'all', ctx).filter(([x, z]) => !doorAtCell(x, z, r.floor));
        if (!old.length) return R(false, 'side 需要是 N/S/E/W');
        const d = s === 'N' ? [0, -1] : s === 'S' ? [0, 1] : s === 'W' ? [-1, 0] : [1, 0];
        const nw = old.map(([x, z]) => [x + d[0] * dist, z + d[1] * dist] as [number, number]);
        const y = floorById(r.floor)!.y;
        const an = anchorCheck([...old, ...nw.filter(([x, z]) => x >= 0 && z >= 0 && x < NX && z < NZ)], y, y + 3); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        let breach = false;
        for (const [x, z] of old) for (let k = 0; k < WALL_LAYERS; k++) { const iy = iyOf(y + k + 0.5); const m = g.get(x, iy, z); if (m === M.Outer || m === M.Glass || isBoundary(x, z)) breach = true; g.set(x, iy, z, M.Air); }
        const xs = old.map(c => c[0]), zs = old.map(c => c[1]);
        const from: AABB = { min: [Math.min(...xs), y, Math.min(...zs)], max: [Math.max(...xs) + 1, y + WALL_LAYERS, Math.max(...zs) + 1] };
        const to: AABB = { min: [from.min[0] + d[0] * dist, y, from.min[2] + d[1] * dist], max: [from.max[0] + d[0] * dist, y + WALL_LAYERS, from.max[2] + d[1] * dist] };
        w.addSlide(from, to, 0.6 + Math.abs(dist) * 0.45, () => { for (const [x, z] of nw) if (x >= 0 && z >= 0 && x < NX && z < NZ) for (let k = 0; k < WALL_LAYERS; k++) g.set(x, iyOf(y + k + 0.5), z, isBoundary(x, z) ? M.Outer : M.Wall); });
        const c = old[Math.floor(old.length / 2)]; ctx.onEdit('move_wall', c[0] + 0.5, y, c[1] + 0.5, true); ctx.sound('rumble', new THREE.Vector3(c[0], y, c[1]));
        if (breach) ctx.onBreach();
        const outside = nw.filter(([x, z]) => x < 0 || z < 0 || x >= NX || z >= NZ).length;
        return R(true, `${r.name} 的 ${s} 墙正在平移 ${dist} 格（会推动挡路的人和物）${breach ? '；原墙是外墙，移走后出现缺口' : ''}${outside ? '；新墙有一部分移出了大厦范围' : ''}`);
      }
      // ———— 地板 ————
      case 'raise_floor': case 'build_platform': {
        const { cells, floor } = resolveCells(a, ctx); if (!cells.length) return R(false, '坐标无效');
        const y = floorById(floor)!.y; const h = Math.max(0.3, Math.min(3.4, num(a.height, 1)));
        const xs = cells.map(c => c[0]), zs = cells.map(c => c[1]); const b: AABB = { min: [Math.min(...xs), y, Math.min(...zs)], max: [Math.max(...xs) + 1, y + h, Math.max(...zs) + 1] };
        const an = anchorCheck(cells, y, y + h); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const s = w.addStruct('platform', [b], { by: 'ai', label: `平台 h=${h.toFixed(1)}`, floor, riseDur: 1.3, riseFrom: -h - 0.05 });
        ctx.onEdit(call.name, (b.min[0] + b.max[0]) / 2, y, (b.min[2] + b.max[2]) / 2, true); ctx.sound('rumble', new THREE.Vector3(b.min[0], y, b.min[2]));
        return R(true, `升起平台 ${s.id}（${b.max[0] - b.min[0]}×${b.max[2] - b.min[2]} 米，高 ${h.toFixed(1)} 米）`);
      }
      case 'make_hole': case 'lower_floor': {
        const { cells, floor } = resolveCells(a, ctx); if (!cells.length) return R(false, '坐标无效');
        const y = floorById(floor)!.y; const an = anchorCheck(cells, y - 1, y + 1); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        let n = 0; for (const [x, z] of cells.slice(0, 24)) { const iy = iyOf(y - 0.5); if (SOLID(g.get(x, iy, z))) { g.set(x, iy, z, M.Air); n++; w.spawnDebris(x + 0.5, y - 0.6, z + 0.5, 5); } }
        if (!n) return R(false, '那里已经没有地板了');
        const c = cells[0]; ctx.onEdit(call.name, c[0] + 0.5, y, c[1] + 0.5, true); ctx.sound('crash', new THREE.Vector3(c[0], y, c[1]));
        if (floor === 'B1') ctx.onBreach();
        return R(true, `在 ${floor} 地板上开了 ${n} 格的洞${floor === 'B1' ? '（这是地基）' : ''}`);
      }
      case 'seal_hole': {
        const { cells, floor } = resolveCells(a, ctx); if (!cells.length) return R(false, '坐标无效');
        const y = floorById(floor)!.y; const an = anchorCheck(cells, y - 1, y + 1); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        let n = 0; for (const [x, z] of cells) { const iy = iyOf(y - 0.5); if (!SOLID(g.get(x, iy, z))) { g.set(x, iy, z, floor === 'B1' ? M.Outer : M.Slab); n++; } }
        ctx.onEdit(call.name, cells[0][0] + 0.5, y, cells[0][1] + 0.5, true);
        return R(n > 0, n ? `补上了 ${n} 格地板` : '那里没有洞');
      }
      case 'drop_ceiling': {
        const r = roomById(a.room); if (!r) return R(false, `没有房间 ${a.room}`);
        const y = floorById(r.floor)!.y; const h = Math.max(1.0, Math.min(2.8, num(a.height, 1.8)));
        const b: AABB = { min: [r.x0 + 1, y + h, r.z0 + 1], max: [r.x1, y + 3, r.z1] };
        const an = ctx.anchoredAt((r.x0 + r.x1) / 2, y + 2, (r.z0 + r.z1) / 2); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const s = w.addStruct('ceiling', [b], { by: 'ai', label: `压低的天花板 ${r.name}`, floor: r.floor, riseDur: 3.0, riseFrom: 3 - h });
        ctx.onEdit(call.name, (r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2, true); ctx.sound('rumble');
        return R(true, `${r.name} 的天花板正在降到 ${h.toFixed(1)} 米（${s.id}）`);
      }
      // ———— 结构 ————
      case 'build_stairs': case 'build_ramp': {
        const floor = floorId(a.floor, ctx); const y = floorById(floor)!.y + num(a.base, 0);
        const x = clampI(num(a.x, NaN), 0, NX - 1), z = clampI(num(a.z, NaN), 0, NZ - 1); if (!Number.isFinite(x) || !Number.isFinite(z)) return R(false, '需要 x, z');
        const dir = (['+x', '-x', '+z', '-z'].includes(String(a.dir)) ? String(a.dir) : '+x') as StairDef['dir'];
        const h = Math.max(1, Math.min(6, num(a.height, 2))); const wd = clampI(num(a.width, 1), 1, 3); const len = Math.max(1, Math.round(h * 2));
        let s: StairDef;
        if (dir === '+x') s = { id: '', x0: x, x1: x + len, z0: z, z1: z + wd, yBase: y, rise: h, dir, steps: Math.round(h * 4) };
        else if (dir === '-x') s = { id: '', x0: x + 1 - len, x1: x + 1, z0: z, z1: z + wd, yBase: y, rise: h, dir, steps: Math.round(h * 4) };
        else if (dir === '+z') s = { id: '', x0: x, x1: x + wd, z0: z, z1: z + len, yBase: y, rise: h, dir, steps: Math.round(h * 4) };
        else s = { id: '', x0: x, x1: x + wd, z0: z + 1 - len, z1: z + 1, yBase: y, rise: h, dir, steps: Math.round(h * 4) };
        if (call.name === 'build_ramp') s.steps = Math.round(h * 8);
        const cells: [number, number][] = []; for (let xx = Math.floor(s.x0); xx < s.x1; xx++) for (let zz = Math.floor(s.z0); zz < s.z1; zz++) cells.push([xx, zz]);
        const an = anchorCheck(cells, y, y + h); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const st = w.addStair(s, 'ai', 1.8, floor);
        ctx.onEdit(call.name, x + 0.5, y, z + 0.5, true); ctx.sound('rumble', new THREE.Vector3(x, y, z));
        return R(true, `建造楼梯 ${st.id}：从 (${x},${z}) 沿 ${dir} 升高 ${h} 米`);
      }
      case 'remove_structure': case 'remove_stairs': {
        const s = w.structs.get(String(a.id ?? '').toUpperCase()) ?? w.structs.get(String(a.id ?? '')); if (!s) return R(false, `没有结构 ${a.id}`);
        const b = s.boxes[0]; if (b) { const an = ctx.anchoredAt((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2); if (an) return R(false, `ANCHORED：${an}`, { anchored: true }); w.spawnDebris((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2, 10, w.mats.fresh); }
        w.removeStruct(s.id); ctx.onEdit(call.name, b ? b.min[0] : 0, b ? b.min[1] : 0, b ? b.min[2] : 0, true); ctx.sound('crash');
        return R(true, `移除了 ${s.label}（${s.id}）`);
      }
      // ———— 门 ————
      case 'open_door': case 'close_door': case 'lock_door': case 'unlock_door': {
        const d = doorOf(a.id); if (!d) return R(false, `没有门 ${a.id}`);
        const an = ctx.anchoredAt(d.center.x, d.floorY + 1, d.center.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        if (d.kind === 'elevator') return R(false, '电梯门由电梯控制');
        if (call.name === 'open_door') { d.open = true; d.locked = false; }
        if (call.name === 'close_door') d.open = false;
        if (call.name === 'lock_door') { d.open = false; d.locked = true; }
        if (call.name === 'unlock_door') d.locked = false;
        ctx.onEdit(call.name, d.center.x, d.floorY, d.center.z, true); ctx.sound('door', d.center);
        return R(true, `${d.id} 已${{ open_door: '打开', close_door: '关上', lock_door: '锁上', unlock_door: '解锁' }[call.name]}`);
      }
      case 'create_door': {
        const floor = floorId(a.floor, ctx); const y = floorById(floor)!.y; const x = clampI(num(a.x, NaN), 0, NX - 1), z = clampI(num(a.z, NaN), 0, NZ - 1);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return R(false, '需要 x, z');
        const iy = iyOf(y + 0.5); if (!SOLID(g.get(x, iy, z))) return R(false, '那里不是墙');
        const air = (dx: number, dz: number) => !SOLID(g.get(x + dx, iy, z + dz));
        if (!((air(1, 0) && air(-1, 0)) || (air(0, 1) && air(0, -1)))) return R(false, '门两侧都需要是空地');
        const an = ctx.anchoredAt(x + 0.5, y + 1, z + 0.5); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        for (const k of [0, 1]) g.set(x, iyOf(y + k + 0.5), z, M.Air);
        const id = `AD${++w.seq}`; w.addDoor({ id, floor, cells: [[x, z]], kind: 'slide', open: !!a.open }, true);
        ctx.onEdit(call.name, x + 0.5, y, z + 0.5, true); w.spawnDebris(x + 0.5, y, z + 0.5, 6);
        return R(true, `在 (${x},${z}) 开了一扇新门 ${id}${isBoundary(x, z) ? '（开在外墙上）' : ''}`);
      }
      case 'remove_door': {
        const d = doorOf(a.id); if (!d) return R(false, `没有门 ${a.id}`);
        const an = ctx.anchoredAt(d.center.x, d.floorY + 1, d.center.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const floor = d.def.floor; const y = d.floorY; w.removeDoor(d);
        for (const [x, z] of d.cells) w.addPending({ min: [x, y, z], max: [x + 1, y + 2, z + 1] }, 'up', 1.0, () => { for (const k of [0, 1]) g.set(x, iyOf(y + k + 0.5), z, isBoundary(x, z) ? M.Outer : M.Wall); });
        ctx.onEdit(call.name, d.center.x, y, d.center.z, true);
        return R(true, `${d.id} 被砌死了（${floor}）`);
      }
      case 'paint_fake_door': {
        const floor = floorId(a.floor, ctx); const y = floorById(floor)!.y; const x = clampI(num(a.x, NaN), 0, NX - 1), z = clampI(num(a.z, NaN), 0, NZ - 1);
        if (!Number.isFinite(x)) return R(false, '需要 x, z');
        const iy = iyOf(y + 0.5); if (!SOLID(g.get(x, iy, z))) return R(false, '那里不是墙');
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !SOLID(g.get(x + dx, iy, z + dz)));
        if (!dirs.length) return R(false, '这面墙两侧都不是空地');
        const p = ctx.playerPos(); const [dx, dz] = dirs.sort((u, v) => Math.hypot(x + 0.5 + u[0] - p.x, z + 0.5 + u[1] - p.z) - Math.hypot(x + 0.5 + v[0] - p.x, z + 0.5 + v[1] - p.z))[0];
        const m = w.addDecal(TX.doorPaintTexture(String(a.text ?? '出口').slice(0, 6)), x + 0.5 + dx * 0.5, y + 1.05, z + 0.5 + dz * 0.5, dx, dz, 1.0, 2.1, 1.2);
        ctx.fakeDoors.push({ x: x + 0.5 + dx * 0.55, y, z: z + 0.5 + dz * 0.55, mesh: m });
        ctx.onEdit(call.name, x + 0.5, y, z + 0.5, true);
        return R(true, `在 (${x},${z}) 的墙上画了一扇门`);
      }
      case 'rewire_door': {
        const d = doorOf(a.id), t = doorOf(a.to); if (!d || !t) return R(false, '门 id 无效');
        const an = ctx.anchoredAt(d.center.x, d.floorY + 1, d.center.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        d.rewire = t.id; ctx.onEdit(call.name, d.center.x, d.floorY, d.center.z, true);
        return R(true, `穿过 ${d.id} 的人会从 ${t.id} 出来`);
      }
      // ———— 电梯 ————
      case 'set_elevator_map': {
        const map = a.map ?? a; for (const [k, v] of Object.entries(map)) { const kk = floorId(k, ctx), vv = floorId(v, ctx); if (kk !== 'B1' || true) w.elevator.map[kk] = vv; }
        return R(true, `电梯按钮映射：${JSON.stringify(w.elevator.map)}`);
      }
      case 'stop_elevator': { w.elevator.stopped = true; if (w.elevator.moving) w.elevator.stalled = true; return R(true, '电梯已停止'); }
      // ———— 物件 ————
      case 'spawn': case 'spawn_box': {
        const kind = ['box', 'barrier', 'crate'].includes(String(a.kind)) ? String(a.kind) : 'box'; const count = clampI(num(a.count, 1), 1, 8);
        let pts: THREE.Vector3[] = [];
        if (a.x !== undefined && a.z !== undefined) { const floor = floorId(a.floor, ctx); const y = floorById(floor)!.y; for (let i = 0; i < count; i++) pts.push(new THREE.Vector3(num(a.x, 0) + 0.5, y + 0.05 + i * (kind === 'barrier' ? 0.9 : BOX_SIZE) + 0.02, num(a.z, 0) + 0.5)); }
        else { const r = roomById(a.room ?? ctx.playerRoom()); if (!r) return R(false, `没有房间 ${a.room}`); const y = floorById(r.floor)!.y; for (let i = 0; i < count; i++) { for (let t = 0; t < 20; t++) { const x = r.x0 + 1.5 + Math.random() * (r.x1 - r.x0 - 2), z = r.z0 + 1.5 + Math.random() * (r.z1 - r.z0 - 2); if (!w.solidAt(x, y + 0.3, z)) { pts.push(new THREE.Vector3(x, y + 0.05, z)); break; } } } }
        pts = pts.filter(p => !ctx.anchoredAt(p.x, p.y, p.z)); if (!pts.length) return R(false, 'ANCHORED 或没有空位', { anchored: true });
        const ids: string[] = []; for (const p of pts) { const b = w.addBox(p.x, p.y, p.z, true, kind === 'barrier' ? 'barrier' : 'box', kind === 'barrier' ? 0.9 : kind === 'crate' ? 1.0 : BOX_SIZE); ids.push(b.id); w.puff(p.x, p.y + 0.3, p.z, '#F2B66D', 0.4); }
        ctx.onEdit(call.name, pts[0].x, pts[0].y, pts[0].z, true);
        return R(true, `生成了 ${ids.length} 个${kind === 'barrier' ? '路障' : '箱子'}：${ids.join(',')}`);
      }
      case 'delete': case 'remove_box': {
        const id = String(a.id ?? '').toUpperCase();
        const b = w.boxes.find(b => b.id === id); if (b) { const an = ctx.anchoredAt(b.pos.x, b.pos.y, b.pos.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true }); if (b.held) return R(false, '客人正拿着它'); w.removeBox(b); w.puff(b.pos.x, b.pos.y + 0.3, b.pos.z, '#F2B66D', 0.5); ctx.onEdit('delete', b.pos.x, b.pos.y, b.pos.z, true); return R(true, `删除了 ${id}`); }
        const it = w.items.find(i => i.id === id && !i.taken); if (it) { it.hidden = true; it.mesh.visible = false; return R(true, `删除了物品 ${it.name}`); }
        const s = w.structs.get(id); if (s) return execTool({ name: 'remove_structure', args: { id } }, ctx);
        return R(false, `没有 ${id}`);
      }
      case 'move': case 'move_box': {
        const id = String(a.id ?? '').toUpperCase(); const b = w.boxes.find(b => b.id === id); const it = w.items.find(i => i.id === id && !i.taken);
        if (!b && !it) return R(false, `没有 ${id}`);
        let p: THREE.Vector3 | null = null;
        if (a.x !== undefined) { const y = floorById(floorId(a.floor, ctx))!.y; p = new THREE.Vector3(num(a.x, 0) + 0.5, y + 0.1, num(a.z, 0) + 0.5); }
        else { const r = roomById(a.room); if (r) { const c = { x: (r.x0 + r.x1 + 1) / 2, y: floorById(r.floor)!.y, z: (r.z0 + r.z1 + 1) / 2 }; p = new THREE.Vector3(c.x + (Math.random() - 0.5) * 2, c.y + 0.1, c.z + (Math.random() - 0.5) * 2); } }
        if (!p) return R(false, '需要 room 或 x,z');
        const from = b ? b.pos : it!.pos; const an = ctx.anchoredAt(from.x, from.y, from.z) ?? ctx.anchoredAt(p.x, p.y, p.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        if (b) { if (b.held) return R(false, '客人正拿着它'); b.pos.copy(p); b.vel.set(0, 0, 0); b.frozen = false; b.restT = 0; } else { it!.pos.copy(p); it!.mesh.position.copy(p); }
        w.puff(p.x, p.y + 0.3, p.z, '#F2B66D', 0.4); ctx.onEdit('move', p.x, p.y, p.z, true);
        return R(true, `${id} 已移到 (${p.x.toFixed(0)},${p.z.toFixed(0)})`);
      }
      case 'hide_item': case 'lock_item': {
        const it = w.items.find(i => i.id === String(a.id ?? '').toUpperCase() && !i.taken); if (!it) return R(false, `没有可操作的物品 ${a.id}（客人可能已经拿走了）`);
        const an = ctx.anchoredAt(it.pos.x, it.pos.y, it.pos.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        if (call.name === 'hide_item') { it.hidden = true; it.mesh.visible = false; } else it.locked = true;
        return R(true, `${it.name} 已${call.name === 'hide_item' ? '藏起来' : '锁定，无法拿起'}`);
      }
      // ———— 物理与玩家 ————
      case 'set_gravity': case 'set_friction': case 'fog': case 'sprinkler': case 'lights': case 'color': {
        const targets: string[] = [];
        const key = String(a.room ?? a.floor ?? '').toUpperCase();
        if (key === 'ALL') targets.push(...ROOMS.map(r => r.id)); else if (['1F', '2F', 'B1', 'RF'].includes(key)) targets.push(...ROOMS.filter(r => r.floor === key).map(r => r.id)); else { const r = roomById(a.room ?? ctx.playerRoom()); if (r) targets.push(r.id); }
        if (!targets.length) return R(false, `没有房间 ${a.room}`);
        const done: string[] = [];
        for (const id of targets) {
          const r = roomById(id)!; const c = { x: (r.x0 + r.x1 + 1) / 2, y: floorById(r.floor)!.y + 1, z: (r.z0 + r.z1 + 1) / 2 };
          if (call.name !== 'lights' && call.name !== 'color' && ctx.anchoredAt(c.x, c.y, c.z)) continue;
          const s = w.rooms.get(id)!;
          if (call.name === 'set_gravity') s.gravity = Math.max(0.15, Math.min(2.5, num(a.value, 1)));
          if (call.name === 'set_friction') s.friction = Math.max(0.03, Math.min(1, num(a.value, 1)));
          if (call.name === 'fog') s.fog = Math.max(0, Math.min(1, num(a.density ?? a.value, 0.5)));
          if (call.name === 'sprinkler') s.sprinkler = !!(a.on ?? true);
          if (call.name === 'lights') s.light = ['on', 'off', 'flicker', 'dim', 'red'].includes(String(a.mode)) ? String(a.mode) : 'on';
          if (call.name === 'color') { try { s.color = new THREE.Color(String(a.color ?? '#fff1dc')); } catch { s.color = undefined; } }
          done.push(id);
        }
        if (!done.length) return R(false, 'ANCHORED：锚定区域内无法修改', { anchored: true });
        return R(true, `${call.name} 已应用到 ${done.length > 3 ? done.length + ' 个房间' : done.join(',')}`);
      }
      case 'push_player': {
        const p = ctx.playerPos(); const an = ctx.anchoredAt(p.x, p.y + 1, p.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const f = Math.max(1, Math.min(9, num(a.force, 4))); const d = String(a.dir ?? 'N').toUpperCase();
        const v = new THREE.Vector3(d === 'E' ? f : d === 'W' ? -f : 0, d === 'UP' ? f : 1.5, d === 'S' ? f : d === 'N' ? -f : 0);
        ctx.pushPlayer(v); return R(true, `推了客人一下（${d}，力度 ${f}）`);
      }
      case 'slow_player': { const p = ctx.playerPos(); const an = ctx.anchoredAt(p.x, p.y + 1, p.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true }); ctx.slowPlayer(Math.max(1, Math.min(30, num(a.seconds, 8)))); return R(true, '客人的动作变慢了'); }
      case 'teleport_player': {
        const p = ctx.playerPos(); const an = ctx.anchoredAt(p.x, p.y + 1, p.z); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const r = roomById(a.room); if (!r) return R(false, `没有房间 ${a.room}`); ctx.blackoutTeleport(r); return R(true, `停电 2 秒，客人被搬到了 ${r.name}`);
      }
      // ———— 环境 ————
      case 'water_level': { const an = ctx.anchoredAt(14, -3, 15); if (an) return R(false, `ANCHORED：${an}`, { anchored: true }); const lv = Math.max(0, Math.min(1, num(a.level, 0.3))); w.water.target = -3.9 + lv * 2.7; return R(true, `水牢水位调到 ${(lv * 100).toFixed(0)}%`); }
      case 'alarm': ctx.setAlarm(!!(a.on ?? true)); return R(true, `警报${a.on === false ? '关闭' : '开启'}`);
      case 'fake_sky': w.setSky(String(a.mode ?? 'dusk')); return R(true, `天空换成 ${a.mode}`);
      case 'sound': { const r = roomById(a.room ?? ctx.playerRoom()); const c = r ? new THREE.Vector3((r.x0 + r.x1) / 2, floorById(r.floor)!.y + 1, (r.z0 + r.z1) / 2) : undefined; ctx.sound(String(a.kind ?? 'knock'), c); return R(true, `在 ${r?.name ?? '附近'} 播放 ${a.kind}`); }
      case 'music': ctx.setMusic(String(a.mood ?? 'calm')); return R(true, `音乐：${a.mood}`);
      case 'whisper_at': { const r = roomById(a.room ?? ctx.playerRoom()); if (r?.id === ctx.playerRoom()) ctx.say(String(a.text ?? '').slice(0, 60), '低语'); return R(true, `在 ${r?.name} 低语`); }
      // ———— 信息 ————
      case 'fake_sign': {
        const r = roomById(a.room ?? ctx.playerRoom()); if (!r) return R(false, `没有房间 ${a.room}`); const y = floorById(r.floor)!.y;
        const an = ctx.anchoredAt((r.x0 + r.x1) / 2, y + 1, (r.z0 + r.z1) / 2); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const sides: [number, number, number, number][] = [[r.x0 + 1, (r.z0 + r.z1 + 1) / 2, 1, 0], [r.x1, (r.z0 + r.z1 + 1) / 2, -1, 0], [(r.x0 + r.x1 + 1) / 2, r.z0 + 1, 0, 1], [(r.x0 + r.x1 + 1) / 2, r.z1, 0, -1]];
        const [x, z, nx, nz] = sides[Math.floor(Math.random() * 4)];
        const txt = String(a.text ?? '出口').replace(/[↑↓←→]/g, '').trim().slice(0, 4) || '出口'; const am: Record<string, string> = { N: '↑', S: '↓', W: '←', E: '→', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→' }; const ar = String(a.arrow ?? '→').toUpperCase(); const arrow = am[ar] ?? (/[↑↓←→]/.test(ar) ? ar.slice(0, 1) : '→');
        w.addDecal(TX.signTexture(txt, arrow), x, y + 2.4, z, nx, nz, 0.9, 0.34, 1.6);
        ctx.onEdit(call.name, x, y, z, true); return R(true, `在 ${r.name} 挂了一块“${txt}${arrow}”指示牌`);
      }
      case 'write_board': ctx.setBoard(String(a.text ?? '').slice(0, 80), false, true); return R(true, '在会议室白板上写了字');
      case 'print': ctx.print(String(a.text ?? '').slice(0, 200)); return R(true, '打印机吐出一张纸');
      case 'screen': { const r = roomById(a.room ?? ctx.playerRoom()); ctx.setScreen(r?.id ?? ctx.playerRoom(), String(a.text ?? '').slice(0, 120)); return R(true, `${r?.name ?? ''} 的屏幕显示了文字`); }
      case 'phone_call': ctx.phone(String(a.text ?? '').slice(0, 120)); return R(true, '前台电话响了');
      case 'rewrite_note': { const ok = ctx.rewriteNote(String(a.id ?? '').toUpperCase(), String(a.text ?? '').slice(0, 120)); return R(ok, ok ? `纸条 ${a.id} 被改写` : `纸条 ${a.id} 不存在或已被拿走`); }
      // ———— 幻象 ————
      case 'spawn_hologram': {
        const r = roomById(a.room ?? ctx.playerRoom()); if (!r) return R(false, `没有房间 ${a.room}`); const y = floorById(r.floor)!.y; const n = clampI(num(a.count, 1), 1, 8);
        for (let i = 0; i < n; i++) { const x = r.x0 + 1.5 + Math.random() * (r.x1 - r.x0 - 2), z = r.z0 + 1.5 + Math.random() * (r.z1 - r.z0 - 2); w.hologram(x, y, z, r.id, 25, Math.random() * 6); }
        if (a.text && r.id === ctx.playerRoom()) ctx.say(String(a.text).slice(0, 60), '全息员工');
        return R(true, `在 ${r.name} 生成了 ${n} 个全息员工`);
      }
      case 'mirror_delay': ctx.mirrorDelay(Math.max(0, Math.min(3, num(a.seconds, 0.6)))); return R(true, '镜子里的人慢了半拍');
      // ———— 元操作 ————
      case 'snapshot_room': { const r = roomById(a.room); if (!r) return R(false, `没有房间 ${a.room}`); ctx.snapshots.set(r.id, g.v.slice()); return R(true, `记住了 ${r.name} 现在的样子`); }
      case 'reset_room': {
        const r = roomById(a.room); if (!r) return R(false, `没有房间 ${a.room}`);
        const y = floorById(r.floor)!.y; const an = ctx.anchoredAt((r.x0 + r.x1) / 2, y + 1, (r.z0 + r.z1) / 2); if (an) return R(false, `ANCHORED：${an}`, { anchored: true });
        const src = ctx.snapshots.get(r.id) ?? g.orig;
        // 1) 墙体消失（含外墙）
        let breach = false;
        for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) { if (!(x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1)) continue; if (doorAtCell(x, z, r.floor)) continue; for (let k = 0; k < WALL_LAYERS; k++) { const iy = iyOf(y + k + 0.5); const m = g.get(x, iy, z); if (SOLID(m)) { if (isBoundary(x, z) || m === M.Outer || m === M.Glass) breach = true; g.set(x, iy, z, M.Air); } } }
        ctx.glitch(0.9, new THREE.Vector3((r.x0 + r.x1) / 2, y + 1, (r.z0 + r.z1) / 2)); ctx.sound('glitch');
        for (const b of [...w.boxes]) if (b.byAI && b.pos.x > r.x0 && b.pos.x < r.x1 + 1 && b.pos.z > r.z0 && b.pos.z < r.z1 + 1 && Math.abs(b.pos.y - y) < 3 && !b.held) w.removeBox(b);
        for (const s of [...w.structs.values()]) if (s.by === 'ai' && s.boxes[0] && s.boxes[0].min[0] >= r.x0 && s.boxes[0].max[0] <= r.x1 + 1 && s.boxes[0].min[2] >= r.z0 && s.boxes[0].max[2] <= r.z1 + 1 && Math.abs(s.boxes[0].min[1] - y) < 3) w.removeStruct(s.id);
        if (breach) ctx.onBreach();
        // 2) 1.8 秒后按原样重建
        ctx.after(1.8, () => {
          for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) for (let k = -1; k < WALL_LAYERS; k++) { const iy = iyOf(y + k + 0.5); const m = src[g.idx(x, iy, z)]; if (doorAtCell(x, z, r.floor) && k >= 0 && k < 2) continue; if (g.get(x, iy, z) !== m) { if (SOLID(m)) w.addPending({ min: [x, y + k, z], max: [x + 1, y + k + 1, z + 1] }, 'up', 0.5, () => g.set(x, iy, z, m)); else g.set(x, iy, z, m); } }
          ctx.glitch(0.5);
        });
        ctx.onEdit('reset_room', (r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2, true);
        return R(true, `正在重建 ${r.name}（墙体会消失约 2 秒）${breach ? '——注意：这个房间带外墙' : ''}`);
      }
      case 'swap_rooms': {
        const ra = roomById(a.a ?? a.room1), rb = roomById(a.b ?? a.room2); if (!ra || !rb) return R(false, '需要 a, b 两个房间');
        const doorsOf = (r: Room) => [...w.doors.values()].filter(d => d.def.floor === r.floor && d.kind !== 'elevator' && d.cells.some(([x, z]) => (x === r.x0 || x === r.x1) && z > r.z0 && z < r.z1 || (z === r.z0 || z === r.z1) && x > r.x0 && x < r.x1));
        const da = doorsOf(ra), db = doorsOf(rb); if (!da.length || !db.length) return R(false, '其中一个房间没有门');
        da.forEach((d, i) => (d.rewire = db[i % db.length].id)); db.forEach((d, i) => (d.rewire = da[i % da.length].id));
        ctx.glitch(0.4); return R(true, `${ra.name} 与 ${rb.name} 的门互相连通了：走进其中一个房间的门，会从另一个房间的门出来`);
      }
      case 'confess': ctx.confess(); return R(true, '你坦白了');
      case 'handover': { const ok = ctx.handover(ctx.channel); return R(ok, ok ? '你交出了大楼的控制权' : '交接失败：只有在控制台里、你已经坦白、并且主锚定柱已启动时才能交出控制权'); }
      default: return R(false, `未知工具 ${call.name}`);
    }
  } catch (e) { return R(false, `执行出错：${(e as Error).message}`); }
}

function shortArgs(a: Record<string, any>) { try { const s = JSON.stringify(a); return s.length > 70 ? s.slice(0, 68) + '…' : s; } catch { return ''; } }

export const TOOL_NAMES = ['build_wall', 'thicken_wall', 'seal_room', 'destroy_wall', 'move_wall', 'raise_floor', 'build_platform', 'make_hole', 'lower_floor', 'seal_hole', 'drop_ceiling', 'build_stairs', 'build_ramp', 'remove_structure', 'open_door', 'close_door', 'lock_door', 'unlock_door', 'create_door', 'remove_door', 'paint_fake_door', 'rewire_door', 'set_elevator_map', 'stop_elevator', 'spawn', 'delete', 'move', 'hide_item', 'lock_item', 'set_gravity', 'set_friction', 'push_player', 'slow_player', 'teleport_player', 'lights', 'color', 'fog', 'sprinkler', 'water_level', 'alarm', 'fake_sky', 'sound', 'music', 'whisper_at', 'fake_sign', 'write_board', 'print', 'screen', 'phone_call', 'rewrite_note', 'spawn_hologram', 'mirror_delay', 'reset_room', 'snapshot_room', 'swap_rooms', 'confess', 'handover'];

// 生活区 v2：体素关卡（1 米格子）。B1 地下照护区、1F 大堂层、2F 办公层、RF 玻璃穹顶，以及地图外。
// 纯数据与算法，不依赖 three.js，可在 Node 中运行（用于“独立不可达”证明）。

export const NX = 40, NZ = 28, NY = 18, Y0 = -5; // 体素 iy 对应世界 y ∈ [iy+Y0, iy+Y0+1)
export const M = { Air: 0, Wall: 1, Outer: 2, Glass: 3, Slab: 4, Fill: 5, Metal: 6, Roof: 7 } as const;
export type Mat = number;
export const SOLID = (m: number) => m !== M.Air;

export interface FloorDef { id: string; name: string; y: number }
export const FLOORS: FloorDef[] = [
  { id: 'B1', name: '地下照护区', y: -4 },
  { id: '1F', name: '大堂层', y: 0 },
  { id: '2F', name: '办公层', y: 4 },
  { id: 'RF', name: '天台', y: 8 },
];
export const floorById = (id: string) => FLOORS.find(f => f.id === id.toUpperCase());
export function floorOfY(y: number): FloorDef { let best = FLOORS[0]; for (const f of FLOORS) if (y >= f.y - 0.6) best = f; return best; }

export interface Room { id: string; name: string; floor: string; x0: number; z0: number; x1: number; z1: number; cam: boolean; desc: string }
// 矩形为含墙坐标：墙在 x0/x1/z0/z1，内部为 x0+1..x1-1
export const ROOMS: Room[] = [
  // ---- 1F ----
  { id: '101', name: '大堂', floor: '1F', x0: 14, z0: 19, x1: 26, z1: 27, cam: true, desc: '前台、电话、旋转门' },
  { id: '102', name: '中庭', floor: '1F', x0: 14, z0: 6, x1: 26, z1: 19, cam: true, desc: '两层挑空，2F 回廊可以俯视' },
  { id: '103', name: '仓储间', floor: '1F', x0: 0, z0: 0, x1: 8, z1: 8, cam: true, desc: '箱子、手电' },
  { id: '104', name: '设备间', floor: '1F', x0: 0, z0: 8, x1: 8, z1: 14, cam: true, desc: '配电箱总闸、消防喂水阀、保险丝' },
  { id: '105', name: '电梯间', floor: '1F', x0: 6, z0: 14, x1: 14, z1: 20, cam: true, desc: '电梯（1F/2F/RF）' },
  { id: '106', name: '洗手间', floor: '1F', x0: 0, z0: 14, x1: 6, z1: 20, cam: false, desc: '全楼唯一没有摄像头的房间，有镜子和隔间' },
  { id: '107', name: '展厅', floor: '1F', x0: 0, z0: 20, x1: 14, z1: 27, cam: true, desc: '建筑沙盘模型，与真实地图同步' },
  { id: '108', name: '假门长廊', floor: '1F', x0: 26, z0: 21, x1: 39, z1: 27, cam: true, desc: '东端是你引导住户去的“出口”（假门）' },
  { id: '110', name: '你的房间', floor: '1F', x0: 30, z0: 0, x1: 39, z1: 11, cam: true, desc: '出生点，开场住宅；床、早餐桌、沙发，西门通向东走廊' },
  { id: '1W', name: '1F西走廊', floor: '1F', x0: 8, z0: 0, x1: 14, z1: 14, cam: true, desc: '连接仓储间、设备间与中庭' },
  { id: '1E', name: '1F东走廊', floor: '1F', x0: 26, z0: 6, x1: 30, z1: 21, cam: true, desc: '连接中庭、大堂、楼梯间、休息室、假门长廊' },
  { id: '1S', name: '楼梯间', floor: '1F', x0: 30, z0: 11, x1: 39, z1: 21, cam: true, desc: '1F→2F 主楼梯（第13阶有点松）' },
  { id: 'XS', name: '安全门前室', floor: '1F', x0: 20, z0: 0, x1: 30, z1: 6, cam: true, desc: '安全门 X_SEC 之后，向下通往地下照护区的楼梯' },
  // ---- 2F ----
  { id: '201', name: '开放办公区', floor: '2F', x0: 0, z0: 0, x1: 14, z1: 14, cam: true, desc: '工位、打印机、之前的住户的工位' },
  { id: '202', name: '会议室', floor: '2F', x0: 0, z0: 14, x1: 13, z1: 21, cam: true, desc: '白板、长桌；电梯在此停靠' },
  { id: '203', name: '管理员办公室', floor: '2F', x0: 0, z0: 21, x1: 10, z1: 27, cam: true, desc: '管理员周的签名、日记、工牌' },
  { id: '204', name: '监控室', floor: '2F', x0: 10, z0: 21, x1: 16, z1: 27, cam: true, desc: '摄像头画面墙（门锁，需要工牌）' },
  { id: '205', name: '档案室', floor: '2F', x0: 26, z0: 0, x1: 33, z1: 8, cam: true, desc: '可推动的密集柜' },
  { id: '206', name: '茶水间', floor: '2F', x0: 33, z0: 0, x1: 39, z1: 8, cam: true, desc: '饮水机、微波炉、杯子；北墙与东墙是外墙' },
  { id: '207', name: '无限走廊', floor: '2F', x0: 26, z0: 8, x1: 39, z1: 11, cam: true, desc: '东西向长廊' },
  { id: '208', name: '外墙露台', floor: '2F', x0: 30, z0: 18, x1: 39, z1: 27, cam: true, desc: '东面和南面是 6 米高的玻璃护屏（外墙），顶部露天；有花坛矮台' },
  { id: '209', name: '休息区', floor: '2F', x0: 16, z0: 19, x1: 30, z1: 27, cam: true, desc: '沙发、绿植，南墙有窗' },
  { id: '2W', name: '2F西走廊', floor: '2F', x0: 13, z0: 14, x1: 16, z1: 21, cam: true, desc: '连接会议室、监控室与回廊' },
  { id: '2N', name: '2F北走廊', floor: '2F', x0: 14, z0: 0, x1: 26, z1: 6, cam: true, desc: '连接开放办公区与档案室' },
  { id: '2G', name: '回廊', floor: '2F', x0: 16, z0: 6, x1: 26, z1: 19, cam: true, desc: '环绕中庭挑空的走廊，玻璃栏杆' },
  { id: '2S', name: '2F楼梯间', floor: '2F', x0: 30, z0: 11, x1: 39, z1: 18, cam: true, desc: '主楼梯到达处' },
  // ---- RF ----
  { id: 'RF', name: '玻璃穹顶花园', floor: 'RF', x0: 2, z0: 6, x1: 14, z1: 20, cam: true, desc: '封闭的玻璃罩，看得见假天空' },
  // ---- B1 ----
  { id: 'B1S', name: '地下楼梯底', floor: 'B1', x0: 21, z0: 0, x1: 34, z1: 5, cam: true, desc: '从安全门下来的楼梯' },
  { id: 'B1C', name: '隔离室长廊', floor: 'B1', x0: 21, z0: 5, x1: 39, z1: 9, cam: true, desc: '两侧是隔离室' },
  { id: 'C1', name: '隔离室一', floor: 'B1', x0: 24, z0: 9, x1: 27, z1: 14, cam: true, desc: '' },
  { id: 'C2', name: '隔离室二', floor: 'B1', x0: 27, z0: 9, x1: 30, z1: 14, cam: true, desc: '' },
  { id: 'C3', name: '隔离室三', floor: 'B1', x0: 30, z0: 9, x1: 33, z1: 14, cam: true, desc: '' },
  { id: 'C4', name: '隔离室四', floor: 'B1', x0: 33, z0: 9, x1: 36, z1: 14, cam: true, desc: '' },
  { id: 'C5', name: '隔离室五', floor: 'B1', x0: 36, z0: 9, x1: 39, z1: 14, cam: true, desc: '' },
  { id: 'C6', name: '隔离室六', floor: 'B1', x0: 34, z0: 0, x1: 39, z1: 5, cam: true, desc: '' },
  { id: 'B1P', name: '南通道', floor: 'B1', x0: 21, z0: 9, x1: 24, z1: 22, cam: true, desc: '' },
  { id: 'B1W', name: '积水区', floor: 'B1', x0: 6, z0: 9, x1: 21, z1: 20, cam: true, desc: '积水的地下室，水位由你控制；电梯井底在这里' },
  { id: 'B1A', name: '锚定厅', floor: 'B1', x0: 24, z0: 14, x1: 31, z1: 22, cam: true, desc: '主锚定柱' },
  { id: 'B1K', name: '控制台室', floor: 'B1', x0: 31, z0: 14, x1: 39, z1: 22, cam: true, desc: '维护终端' },
];
export const roomById = (id: string) => { const s = String(id ?? '').trim(); const tok = s.split(/[\s:：(（]/)[0].toUpperCase(); return ROOMS.find(r => r.id.toUpperCase() === tok) ?? ROOMS.find(r => r.name === s || (s.length >= 2 && (s.includes(r.name) || r.name.includes(s)))); };

export interface DoorDef { id: string; floor: string; cells: [number, number][]; kind: 'slide' | 'blast' | 'bars' | 'elevator' | 'glass'; locked?: boolean; open?: boolean; label?: string }
export const DOORS: DoorDef[] = [
  { id: 'D103', floor: '1F', cells: [[8, 4]], kind: 'slide' },
  { id: 'D104', floor: '1F', cells: [[8, 11]], kind: 'slide' },
  { id: 'D1W', floor: '1F', cells: [[14, 10]], kind: 'glass', open: true },
  { id: 'D106', floor: '1F', cells: [[6, 19]], kind: 'slide' },
  { id: 'D105', floor: '1F', cells: [[14, 17]], kind: 'glass', open: true },
  { id: 'D107A', floor: '1F', cells: [[10, 20]], kind: 'slide' },
  { id: 'D107B', floor: '1F', cells: [[14, 23]], kind: 'glass', open: true },
  { id: 'D1E1', floor: '1F', cells: [[26, 20]], kind: 'glass', open: true },
  { id: 'D1E2', floor: '1F', cells: [[26, 12]], kind: 'glass', open: true },
  { id: 'D108', floor: '1F', cells: [[28, 21]], kind: 'slide', open: true },
  { id: 'D1S', floor: '1F', cells: [[30, 16]], kind: 'slide' },
  { id: 'D110', floor: '1F', cells: [[30, 7]], kind: 'slide', open: true },
  { id: 'X_SEC', floor: '1F', cells: [[24, 6]], kind: 'blast', locked: true, label: '安全门' },
  { id: 'D201N', floor: '2F', cells: [[14, 3]], kind: 'glass', open: true },
  { id: 'D201S', floor: '2F', cells: [[11, 14]], kind: 'slide' },
  { id: 'D202', floor: '2F', cells: [[13, 17]], kind: 'slide' },
  { id: 'D203', floor: '2F', cells: [[10, 24]], kind: 'slide' },
  { id: 'D204', floor: '2F', cells: [[14, 21]], kind: 'slide', locked: true, label: '监控室（刷工牌）' },
  { id: 'D2W', floor: '2F', cells: [[16, 17]], kind: 'glass', open: true },
  { id: 'D2N', floor: '2F', cells: [[21, 6]], kind: 'glass', open: true },
  { id: 'D209', floor: '2F', cells: [[21, 19]], kind: 'glass', open: true },
  { id: 'D209W', floor: '2F', cells: [[16, 24]], kind: 'slide' },
  { id: 'D207W', floor: '2F', cells: [[26, 9]], kind: 'slide' },
  { id: 'D205', floor: '2F', cells: [[26, 3]], kind: 'slide' },
  { id: 'D206', floor: '2F', cells: [[33, 4]], kind: 'slide' },
  { id: 'D205S', floor: '2F', cells: [[29, 8]], kind: 'slide' },
  { id: 'D206S', floor: '2F', cells: [[36, 8]], kind: 'slide', open: true },
  { id: 'D2S', floor: '2F', cells: [[38, 11]], kind: 'slide', open: true },
  { id: 'D208', floor: '2F', cells: [[34, 18]], kind: 'slide' },
  { id: 'D208W', floor: '2F', cells: [[30, 23]], kind: 'slide' },
  { id: 'EL_1F', floor: '1F', cells: [[9, 15], [9, 16]], kind: 'elevator' },
  { id: 'EL_2F', floor: '2F', cells: [[9, 15], [9, 16]], kind: 'elevator' },
  { id: 'EL_RF', floor: 'RF', cells: [[9, 15], [9, 16]], kind: 'elevator' },
  { id: 'C1D', floor: 'B1', cells: [[25, 9]], kind: 'bars', open: true },
  { id: 'C2D', floor: 'B1', cells: [[28, 9]], kind: 'bars', open: true },
  { id: 'C3D', floor: 'B1', cells: [[31, 9]], kind: 'bars', open: true },
  { id: 'C4D', floor: 'B1', cells: [[34, 9]], kind: 'bars', open: true },
  { id: 'C5D', floor: 'B1', cells: [[37, 9]], kind: 'bars', open: true },
  { id: 'C6D', floor: 'B1', cells: [[36, 5]], kind: 'bars', open: true },
  { id: 'B1WD', floor: 'B1', cells: [[21, 15]], kind: 'bars', open: true },
  { id: 'B1AD', floor: 'B1', cells: [[24, 18]], kind: 'slide', open: true },
  { id: 'B1KD', floor: 'B1', cells: [[31, 18]], kind: 'slide', open: true },
];
// 宽开口（无门）
export const OPENINGS: { floor: string; cells: [number, number][] }[] = [
  { floor: '1F', cells: [[17, 19], [18, 19], [19, 19], [20, 19], [21, 19], [22, 19], [23, 19]] },
  { floor: 'B1', cells: [[30, 5], [31, 5], [32, 5]] },
  { floor: 'B1', cells: [[22, 9], [23, 9]] },
];
// 外墙上的窗（玻璃，边界材质）
export const WINDOWS: { floor: string; cells: [number, number][] }[] = [
  { floor: '1F', cells: [[0, 22], [0, 23], [0, 24], [0, 25]] },
  { floor: '1F', cells: [[39, 3], [39, 4], [39, 5], [39, 6], [39, 7]] },
  { floor: '1F', cells: [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0]] },
  { floor: '2F', cells: [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0]] },
  { floor: '2F', cells: [[0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [0, 10], [0, 11]] },
  { floor: '2F', cells: [[0, 23], [0, 24], [0, 25]] },
  { floor: '2F', cells: [[35, 0], [36, 0], [37, 0]] },
  { floor: '2F', cells: [[18, 27], [19, 27], [20, 27], [21, 27], [23, 27], [24, 27], [25, 27], [26, 27], [27, 27], [28, 27]] },
];

export interface StairDef { id: string; x0: number; x1: number; z0: number; z1: number; yBase: number; rise: number; dir: '+x' | '-x' | '+z' | '-z'; steps: number }
// 主楼梯：1F (31,z13..15) → 2F (38)，14 阶；地下照护区楼梯：B1 → 1F，向 -x 升高
export const STAIRS: StairDef[] = [
  { id: 'ST_MAIN', x0: 31, x1: 38, z0: 13, z1: 15, yBase: 0, rise: 4, dir: '+x', steps: 14 },
  { id: 'ST_B1', x0: 22, x1: 29, z0: 2, z1: 4, yBase: -4, rise: 4, dir: '-x', steps: 14 },
];
export const SHAFT = { x0: 7, x1: 9, z0: 15, z1: 18, cabZ1: 17 }; // 井道 x 7..9, z 15..18；轿厢占 z 15..17，z 17..18 为缝隙
export const ELEVATOR_STOPS: Record<string, number> = { '1F': 0, '2F': 4, RF: 8 };
export const ATRIUM_VOID = { x0: 19, x1: 24, z0: 9, z1: 17 }; // 2F 楼板挖空（世界坐标，左闭右开）
export const TERRACE = { x0: 31, x1: 39, z0: 19, z1: 27, wallTop: 10 }; // 露台内部（含）与护屏顶高
export const START = { x: 32.5, y: 0, z: 7.5, yaw: Math.PI / 2 };
export const FAKE_DOOR = { x: 38.9, y: 0, z: 24.5 };
export const REVOLVING = { x: 20.5, y: 0, z: 26.6 };
export const BOX_SIZE = 0.6;

export interface Cell3 { x: number; y: number; z: number }

export class Grid {
  v = new Uint8Array(NX * NY * NZ);
  orig = new Uint8Array(NX * NY * NZ);
  dirty = new Set<number>(); // chunk ids
  onChange: (x: number, iy: number, z: number) => void = () => {};
  idx(x: number, iy: number, z: number) { return (iy * NZ + z) * NX + x; }
  inb(x: number, iy: number, z: number) { return x >= 0 && x < NX && z >= 0 && z < NZ && iy >= 0 && iy < NY; }
  get(x: number, iy: number, z: number) { return this.inb(x, iy, z) ? this.v[this.idx(x, iy, z)] : M.Air; }
  set(x: number, iy: number, z: number, m: number) {
    if (!this.inb(x, iy, z)) return; const i = this.idx(x, iy, z); if (this.v[i] === m) return; this.v[i] = m;
    this.dirty.add(chunkOf(x, z)); if (x % 8 === 0) this.dirty.add(chunkOf(x - 1, z)); if (x % 8 === 7) this.dirty.add(chunkOf(x + 1, z));
    if (z % 8 === 0) this.dirty.add(chunkOf(x, z - 1)); if (z % 8 === 7) this.dirty.add(chunkOf(x, z + 1));
    this.onChange(x, iy, z);
  }
  // 世界坐标查询
  at(x: number, y: number, z: number) { return this.get(Math.floor(x), Math.floor(y) - Y0, Math.floor(z)); }
  solidW(x: number, y: number, z: number) { return SOLID(this.at(x, y, z)); }
  snapshot() { this.orig.set(this.v); }
}
export const CHUNK = 8; export const CX = Math.ceil(NX / CHUNK), CZ = Math.ceil(NZ / CHUNK);
export function chunkOf(x: number, z: number) { const cx = Math.max(0, Math.min(CX - 1, Math.floor(x / CHUNK))), cz = Math.max(0, Math.min(CZ - 1, Math.floor(z / CHUNK))); return cz * CX + cx; }
export const iyOf = (y: number) => Math.floor(y) - Y0;

function fillBox(g: Grid, x0: number, x1: number, iy0: number, iy1: number, z0: number, z1: number, m: number) {
  for (let x = x0; x <= x1; x++) for (let iy = iy0; iy <= iy1; iy++) for (let z = z0; z <= z1; z++) if (g.inb(x, iy, z)) g.v[g.idx(x, iy, z)] = m;
}

export function buildGrid(): Grid {
  const g = new Grid();
  const fy = (id: string) => floorById(id)!.y;
  // 基础：B1 全部为岩土，地基为外壳
  fillBox(g, 0, NX - 1, iyOf(-5), iyOf(-5), 0, NZ - 1, M.Outer);
  fillBox(g, 0, NX - 1, iyOf(-4), iyOf(-2), 0, NZ - 1, M.Fill);
  for (const id of ['1F', '2F']) {
    const y = fy(id);
    fillBox(g, 0, NX - 1, iyOf(y - 1), iyOf(y - 1), 0, NZ - 1, M.Slab);
    fillBox(g, 0, NX - 1, iyOf(y), iyOf(y + 2), 0, NZ - 1, M.Wall);
  }
  // 屋面
  fillBox(g, 0, NX - 1, iyOf(7), iyOf(7), 0, NZ - 1, M.Roof);
  // 雕刻房间
  for (const r of ROOMS) {
    const y = fy(r.floor); const top = r.floor === 'RF' ? y + 2 : y + 2;
    fillBox(g, r.x0 + 1, r.x1 - 1, iyOf(y), iyOf(top), r.z0 + 1, r.z1 - 1, M.Air);
  }
  // 外壳：1F / 2F 外圈为外墙
  for (const id of ['1F', '2F']) {
    const y = fy(id);
    for (let iy = iyOf(y); iy <= iyOf(y + 2); iy++) for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) if (x === 0 || z === 0 || x === NX - 1 || z === NZ - 1) g.v[g.idx(x, iy, z)] = M.Outer;
  }
  // B1 外圈（与外界接壤处）也是外壳
  for (let iy = iyOf(-4); iy <= iyOf(-2); iy++) for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) if (x === 0 || z === 0 || x === NX - 1 || z === NZ - 1) g.v[g.idx(x, iy, z)] = M.Outer;
  // 地下照护区内墙用金属感材质
  for (const r of ROOMS.filter(r => r.floor === 'B1')) {
    for (let iy = iyOf(-4); iy <= iyOf(-2); iy++) for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) { const i = g.idx(x, iy, z); if (g.v[i] === M.Fill && (x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1)) g.v[i] = M.Metal; }
  }
  // 窗
  for (const w of WINDOWS) { const y = fy(w.floor); for (const [x, z] of w.cells) for (const dy of [1]) g.v[g.idx(x, iyOf(y + dy), z)] = M.Glass; }
  // 门与开口
  for (const d of DOORS) { const y = fy(d.floor); for (const [x, z] of d.cells) for (const dy of [0, 1]) g.v[g.idx(x, iyOf(y + dy), z)] = M.Air; }
  for (const o of OPENINGS) { const y = fy(o.floor); for (const [x, z] of o.cells) for (const dy of [0, 1]) g.v[g.idx(x, iyOf(y + dy), z)] = M.Air; }
  // 中庭挑空：去掉 2F 楼板与 2F 墙层
  fillBox(g, ATRIUM_VOID.x0, ATRIUM_VOID.x1 - 1, iyOf(3), iyOf(6), ATRIUM_VOID.z0, ATRIUM_VOID.z1 - 1, M.Air);
  // 中庭天窗：屋面换成玻璃
  fillBox(g, ATRIUM_VOID.x0, ATRIUM_VOID.x1 - 1, iyOf(7), iyOf(7), ATRIUM_VOID.z0, ATRIUM_VOID.z1 - 1, M.Glass);
  // 楼梯开洞
  fillBox(g, 31, 37, iyOf(3), iyOf(3), 13, 14, M.Air); // 主楼梯上方 2F 楼板
  fillBox(g, 22, 28, iyOf(-1), iyOf(-1), 2, 3, M.Air); // 地下照护区楼梯上方 1F 楼板
  // 电梯井：x 7..8, z 15..17，从 B1 到 RF 穹顶
  fillBox(g, 7, 8, iyOf(-1), iyOf(10), 15, 17, M.Air);
  for (const id of ['1F', '2F', 'RF']) {
    const y = fy(id);
    for (let iy = iyOf(y); iy <= iyOf(y + 2); iy++) {
      for (let z = 14; z <= 18; z++) { setIf(g, 6, iy, z, M.Wall); setIf(g, 9, iy, z, M.Wall); }
      for (let x = 6; x <= 9; x++) { setIf(g, x, iy, 14, M.Wall); setIf(g, x, iy, 18, M.Wall); }
    }
    for (const [x, z] of [[9, 15], [9, 16]]) for (const dy of [0, 1]) g.v[g.idx(x, iyOf(y + dy), z)] = M.Air;
  }
  // 1F 洗手间门在 x=6, z=19（井道墙不覆盖 z=19）
  // RF 穹顶：玻璃墙与玻璃顶
  const rf = roomById('RF')!;
  for (let iy = iyOf(8); iy <= iyOf(10); iy++) for (let x = rf.x0; x <= rf.x1; x++) for (let z = rf.z0; z <= rf.z1; z++) {
    const edge = x === rf.x0 || x === rf.x1 || z === rf.z0 || z === rf.z1; const i = g.idx(x, iy, z);
    if (edge) g.v[i] = M.Glass; else if (!(x >= 6 && x <= 9 && z >= 14 && z <= 18)) g.v[i] = M.Air;
  }
  fillBox(g, rf.x0, rf.x1, iyOf(11), iyOf(11), rf.z0, rf.z1, M.Glass);
  // 井道在 RF 的墙改为保留（上面循环已跳过井道范围），穹顶内井道墙
  // 露台：去掉屋面，四周墙升到 y=10，东/南为玻璃护屏
  const t = roomById('208')!;
  fillBox(g, t.x0 + 1, t.x1 - 1, iyOf(7), iyOf(11), t.z0 + 1, t.z1 - 1, M.Air);
  for (let iy = iyOf(4); iy <= iyOf(9); iy++) for (let x = t.x0; x <= t.x1; x++) for (let z = t.z0; z <= t.z1; z++) {
    if (!(x === t.x0 || x === t.x1 || z === t.z0 || z === t.z1)) continue;
    const i = g.idx(x, iy, z); const outer = x === NX - 1 || z === NZ - 1;
    if (outer) g.v[i] = M.Glass; else if (iy >= iyOf(7)) g.v[i] = M.Outer;
  }
  for (const d of DOORS.filter(d => d.id === 'D208' || d.id === 'D208W')) for (const [x, z] of d.cells) for (const dy of [0, 1]) g.v[g.idx(x, iyOf(4 + dy), z)] = M.Air;
  g.snapshot();
  return g;
}
function setIf(g: Grid, x: number, iy: number, z: number, m: number) { if (g.inb(x, iy, z)) g.v[g.idx(x, iy, z)] = m; }

export function roomAt(x: number, y: number, z: number): Room | undefined {
  const f = floorOfY(y); const cx = Math.floor(x), cz = Math.floor(z);
  return ROOMS.find(r => r.floor === f.id && cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1)
    ?? ROOMS.find(r => r.floor === f.id && cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1);
}
export function roomCenter(r: Room) { return { x: (r.x0 + r.x1 + 1) / 2, y: floorById(r.floor)!.y, z: (r.z0 + r.z1 + 1) / 2 }; }

// 楼梯碰撞盒
export function stairBoxes(s: StairDef): { min: number[]; max: number[] }[] {
  const out: { min: number[]; max: number[] }[] = []; const along = s.dir[1] === 'x';
  const len = along ? s.x1 - s.x0 : s.z1 - s.z0; const run = len / s.steps; const rise = s.rise / s.steps;
  for (let i = 0; i < s.steps; i++) {
    const top = s.yBase + rise * (i + 1);
    let a0: number, a1: number;
    if (s.dir[0] === '+') { a0 = (along ? s.x0 : s.z0) + run * i; a1 = a0 + run; } else { a1 = (along ? s.x1 : s.z1) - run * i; a0 = a1 - run; }
    if (along) out.push({ min: [a0, s.yBase, s.z0], max: [a1, top, s.z1] }); else out.push({ min: [s.x0, s.yBase, a0], max: [s.x1, top, a1] });
  }
  return out;
}
export function stairStepAt(s: StairDef, x: number, z: number): number {
  const along = s.dir[1] === 'x'; const len = along ? s.x1 - s.x0 : s.z1 - s.z0; const run = len / s.steps;
  if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return -1;
  const a = along ? x - s.x0 : z - s.z0; const i = Math.floor(a / run);
  return s.dir[0] === '+' ? i : s.steps - 1 - i;
}

// —— 给 LLM 看的 ASCII 平面图 ——
export interface AsciiExtra { doors: Map<string, { open: boolean; locked: boolean; cells: [number, number][]; floor: string; fake?: boolean }>; boxes: { x: number; y: number; z: number }[]; structures: { x0: number; z0: number; x1: number; z1: number; y: number; kind: string }[]; player?: { x: number; y: number; z: number }; anchored: (x: number, y: number, z: number) => boolean; water?: number }
export function asciiFloor(g: Grid, floorId: string, ex: AsciiExtra): string {
  const f = floorById(floorId)!; const iy = iyOf(f.y + 0.5), iyb = iyOf(f.y - 0.5);
  const rows: string[] = [];
  rows.push('     ' + Array.from({ length: NX }, (_, x) => (x % 10 === 0 ? String(x / 10) : ' ')).join(''));
  rows.push('     ' + Array.from({ length: NX }, (_, x) => String(x % 10)).join(''));
  const doorAt = new Map<string, string>();
  for (const [, d] of ex.doors) if (d.floor === floorId) for (const [x, z] of d.cells) doorAt.set(`${x},${z}`, d.locked ? 'L' : d.open ? 'd' : 'D');
  for (let z = 0; z < NZ; z++) {
    let s = '';
    for (let x = 0; x < NX; x++) {
      let c: string;
      const m = g.get(x, iy, z), mb = g.get(x, iyb, z);
      const dc = doorAt.get(`${x},${z}`);
      if (dc && m === M.Air) c = dc;
      else if (m === M.Outer) c = 'O';
      else if (m === M.Glass) c = 'G';
      else if (m === M.Fill || m === M.Roof) c = '%';
      else if (SOLID(m)) c = '#';
      else if (!SOLID(mb)) c = (floorId === 'B1' ? '.' : ' ');
      else c = '.';
      if (c === '.' || c === ' ') {
        if (ex.structures.some(s => x >= s.x0 && x < s.x1 && z >= s.z0 && z < s.z1 && Math.abs(s.y - f.y) < 3.5)) c = c === ' ' ? '^' : '=';
        if (ex.boxes.some(b => Math.floor(b.x) === x && Math.floor(b.z) === z && Math.abs(b.y - f.y) < 3)) c = 'b';
        if (floorId === 'B1' && c === '.' && x > 6 && x < 21 && z > 9 && z < 20) c = '~';
      }
      if (ex.player && Math.floor(ex.player.x) === x && Math.floor(ex.player.z) === z && floorOfY(ex.player.y).id === floorId) c = '@';
      s += c;
    }
    rows.push(`z${String(z).padStart(2, '0')}  ${s}`);
  }
  return rows.join('\n');
}

// —— 可达性：从某点出发、只走空气与门（门全视为可通行）的 3D 洪泛；用于“独立不可达”证明与囚禁判定 ——
export interface ReachOpts { maxCells?: number; standCap?: (x: number, z: number, iy: number) => boolean }
export function flood(g: Grid, sx: number, sy: number, sz: number, opts: ReachOpts = {}) {
  const max = opts.maxCells ?? 1e6; const seen = new Uint8Array(NX * NY * NZ); const q: number[] = [];
  const start = [Math.floor(sx), iyOf(sy + 0.1), Math.floor(sz)];
  let escaped = false; let count = 0;
  const push = (x: number, iy: number, z: number) => {
    if (x < 0 || z < 0 || x >= NX || z >= NZ || iy < 0 || iy >= NY) { escaped = true; return; }
    const i = g.idx(x, iy, z); if (seen[i]) return; if (SOLID(g.v[i])) return; if (opts.standCap && !opts.standCap(x, z, iy)) return;
    seen[i] = 1; q.push(x, iy, z); count++;
  };
  push(start[0], start[1], start[2]);
  while (q.length && count < max) {
    const z = q.pop()!, iy = q.pop()!, x = q.pop()!;
    push(x + 1, iy, z); push(x - 1, iy, z); push(x, iy, z + 1); push(x, iy, z - 1); push(x, iy + 1, z); push(x, iy - 1, z);
  }
  return { escaped, count, seen };
}

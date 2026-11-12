import type { World, AABB, DoorObj } from './world';
import { NX, NZ, floorById, roomById, floorOfY, ELEVATOR_STOPS } from './level';
import { compassHeading } from './compass';

export interface NavigationTarget { room?: string; door?: string; floor?: string; x?: number; z?: number; allow_locked?: boolean }
interface Point { x: number; y: number; z: number }
interface Node extends Point { key: string; ix: number; iz: number }
export interface NavigationStep {
  action: 'walk' | 'stairs' | 'open_door' | 'unlock_door' | 'wait_door' | 'elevator' | 'stand_up';
  instruction: string; direction?: string; relative?: string; meters?: number; to?: Point;
  heading_degrees?: number; landmark?: { door: string; kind: string };
  via_doors?: { door: string; kind: string }[];
  door?: string; from_floor?: string; to_floor?: string; button?: string;
}
export interface NavigationResult {
  status: 'ok' | 'requires_action' | 'arrived' | 'unreachable' | 'player_unknown' | 'invalid_target' | 'off_mesh' | 'search_limit';
  message: string; target?: NavigationTarget; from?: Point & { facing: string; heading_degrees: number };
  distance_m?: number; next_step?: NavigationStep; steps?: NavigationStep[]; waypoints?: Point[];
  locked_doors?: string[];
}
const SPACING = .5, RADIUS = .3, HEIGHT = 1.7, EPS = .008;
const WIDTH = NX * 2, DEPTH = NZ * 2;
const overlapFoot = (b: AABB, x: number, z: number) => x + RADIUS > b.min[0] + EPS && x - RADIUS < b.max[0] - EPS && z + RADIUS > b.min[2] + EPS && z - RADIUS < b.max[2] - EPS;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const headingBetween = (a: Point, b: Point) => compassHeading(-Math.atan2(b.x - a.x, a.z - b.z));
function relativeDirection(degrees: number, facing: number) {
  const turn = ((degrees - facing + 540) % 360) - 180;
  return ['前方', '右前方', '右侧', '右后方', '身后', '左后方', '左侧', '左前方'][(Math.round(turn / 45) + 8) % 8];
}

class MinHeap {
  items: { node: Node; cost: number; score: number }[] = [];
  push(item: MinHeap['items'][number]) {
    let i = this.items.length; this.items.push(item);
    while (i > 0) { const parent = (i - 1) >> 1; if (this.items[parent].score <= item.score) break; this.items[i] = this.items[parent]; i = parent; }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child++;
        if (last.score <= this.items[child].score) break;
        this.items[i] = this.items[child]; i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}

export function navigationSummary(result: NavigationResult) {
  const { waypoints: _waypoints, ...summary } = result;
  return summary;
}

export function findPath(world: World, start: Point, yaw: number, target: NavigationTarget, visible = true): NavigationResult {
  if (!visible) return { status: 'player_unknown', message: '监控看不见住户，无法从当前位置寻路。先重新确认位置，不得猜测左右或方位。' };
  target = { ...target, allow_locked: target.allow_locked === true };
  const room = target.room ? roomById(target.room) : undefined;
  const destinationDoor = target.door ? world.doors.get(String(target.door).toUpperCase()) : undefined;
  const floor = room ? floorById(room.floor) : destinationDoor ? floorById(destinationDoor.def.floor) : floorById(String(target.floor ?? floorOfY(start.y).id));
  const goal = room ? { x: (room.x0 + room.x1 + 1) / 2, z: (room.z0 + room.z1 + 1) / 2 } : destinationDoor ? destinationDoor.center : { x: target.x!, z: target.z! };
  if (!floor || target.room && !room || target.door && !destinationDoor || !Number.isFinite(goal.x) || !Number.isFinite(goal.z) || goal.x < 0 || goal.x >= NX || goal.z < 0 || goal.z >= NZ) {
    return { status: 'invalid_target', message: '目标无效，请使用真实房间、门ID，或有效的floor/x/z坐标。' };
  }
  const facing = compassHeading(yaw);
  const base = { target: { ...target, floor: floor.id }, from: { ...start, facing: facing.label, heading_degrees: Math.round(facing.degrees) } };
  const all = world.colliders({ min: [0, -5.1, 0], max: [NX, 15, NZ] }, []);
  const plannedDoors = new Map<string, { door: DoorObj; box: AABB }>();
  const solids = all.filter(box => box.tag !== 'door');
  for (const door of world.doors.values()) {
    if (door.removed) continue;
    const box = world.doorAABB({ ...door, t: 0 });
    if (!box) continue;
    if (door.rewire || door.locked && !target.allow_locked) solids.push(box);
    else if (!door.open || door.t <= .82 || door.locked) plannedDoors.set(door.id, { door, box });
  }
  const locked = [...world.doors.values()].filter(d => d.locked).map(d => d.id);
  const buckets: AABB[][] = Array.from({ length: WIDTH * DEPTH }, () => []);
  for (const box of solids) {
    const pad = RADIUS + SPACING / 2;
    const x0 = Math.max(0, Math.ceil((box.min[0] - pad) / SPACING)), x1 = Math.min(WIDTH - 1, Math.floor((box.max[0] + pad) / SPACING));
    const z0 = Math.max(0, Math.ceil((box.min[2] - pad) / SPACING)), z1 = Math.min(DEPTH - 1, Math.floor((box.max[2] + pad) / SPACING));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) buckets[ix + iz * WIDTH].push(box);
  }
  function surfacesAt(x: number, z: number) {
    if (x < RADIUS || z < RADIUS || x > NX - RADIUS || z > NZ - RADIUS) return [];
    const ix = Math.round(x / SPACING), iz = Math.round(z / SPACING);
    const nearby = (buckets[ix + iz * WIDTH] ?? []).filter(b => overlapFoot(b, x, z));
    const heights = [...new Set(nearby.map(b => Math.round(b.max[1] * 1000) / 1000))];
    return heights.filter(y => y >= -4.05 && y <= 12 && !(world.inWater(x, z) && world.water.level - y > 1)
      && !nearby.some(b => b.max[1] > y + EPS && b.min[1] < y + HEIGHT - EPS));
  }
  const columns = new Map<number, Node[]>();
  function nodesAt(ix: number, iz: number) {
    if (ix < 1 || iz < 1 || ix >= WIDTH || iz >= DEPTH) return [];
    const key = ix + iz * WIDTH;
    if (!columns.has(key)) columns.set(key, surfacesAt(ix * SPACING, iz * SPACING).map(y => ({ x: ix * SPACING, y, z: iz * SPACING, ix, iz, key: `${ix},${iz},${y}` })));
    return columns.get(key)!;
  }
  function canWalk(a: Point, b: Point) {
    let y = a.y;
    const slices = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .125));
    for (let i = 1; i <= slices; i++) {
      const t = i / slices, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const choices = surfacesAt(x, z).filter(next => next - y <= .361 && y - next <= .401).sort((p, q) => Math.abs(p - b.y) - Math.abs(q - b.y));
      if (!choices.length) return false;
      y = choices[0];
    }
    return Math.abs(y - b.y) < .04;
  }
  const isGoal = (node: Point) => Math.abs(node.y - floor.y) < .36 && (room
    ? node.x > room.x0 + 1 && node.x < room.x1 && node.z > room.z0 + 1 && node.z < room.z1
    : Math.hypot(node.x - goal.x, node.z - goal.z) <= (destinationDoor ? 1.1 : .4));
  if (isGoal(start)) return { ...base, status: 'arrived', message: '已到达目标所在位置。', distance_m: 0, steps: [], waypoints: [{ ...start }] };
  const heap = new MinHeap(), costs = new Map<string, number>();
  const previous = new Map<string, { node: Node; elevator?: NavigationStep }>();
  const heuristic = (node: Point) => {
    const vertical = Math.max(0, Math.abs(node.y - floor.y) - .36);
    if (room) return Math.hypot(Math.max(0, room.x0 + 1 - node.x, node.x - room.x1), vertical, Math.max(0, room.z0 + 1 - node.z, node.z - room.z1));
    return Math.hypot(Math.max(0, Math.hypot(node.x - goal.x, node.z - goal.z) - (destinationDoor ? 1.1 : .4)), vertical);
  };
  const sx = Math.round(start.x / SPACING), sz = Math.round(start.z / SPACING);
  const onGrid = Math.hypot(sx * SPACING - start.x, sz * SPACING - start.z) < .02;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const node of nodesAt(sx + dx, sz + dz)) {
    if (onGrid && (dx !== 0 || dz !== 0)) continue;
    if (Math.abs(node.y - start.y) > .36 || Math.hypot(node.x - start.x, node.z - start.z) > .76 || !canWalk(start, node)) continue;
    const cost = distance(start, node); costs.set(node.key, cost); heap.push({ node, cost, score: cost + heuristic(node) });
  }
  if (!heap.items.length) return { ...base, status: 'off_mesh', message: '当前位置没有可站立的寻路起点；可能正在跳跃、下坠、游泳或被实体挡住。请先确认站稳。' };
  const elevator = world.elevator;
  const landings = Object.entries(ELEVATOR_STOPS).flatMap(([id, y]) => nodesAt(21, 33).filter(n => Math.abs(n.y - y) < .04).map(node => ({ id, node })));
  let end: Node | undefined, visited = 0;
  while (heap.items.length && visited++ < 20000) {
    const entry = heap.pop(), node = entry.node;
    if (entry.cost > (costs.get(node.key) ?? Infinity) + .001) continue;
    if (isGoal(node)) { end = node; break; }
    const neighbors: { node: Node; extra?: NavigationStep; cost: number }[] = [];
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) for (const next of nodesAt(node.ix + dx, node.iz + dz)) {
      if (Math.abs(next.y - node.y) <= .8 && canWalk(node, next)) neighbors.push({ node: next, cost: distance(node, next) + Math.abs(next.y - node.y) * .2 });
    }
    const landing = landings.find(l => l.node.key === node.key);
    if (landing && !elevator.stopped && !elevator.stalled) for (const to of landings) {
      const button = Object.keys(ELEVATOR_STOPS).find(key => { const mapped = elevator.map[key] ?? key; return (mapped === 'B1' ? '1F' : mapped) === to.id; });
      if (to.id === landing.id || !button || world.doors.get(`EL_${landing.id}`)?.locked || world.doors.get(`EL_${to.id}`)?.locked) continue;
      neighbors.push({ node: to.node, cost: 12 + Math.abs(node.y - to.node.y), extra: { action: 'elevator', from_floor: landing.id, to_floor: to.id, button,
        instruction: `${elevator.moving ? '等待电梯停稳，' : ''}在${landing.id}电梯前呼叫并等候电梯，进入轿厢后按${button}，实际到达${to.id}后出电梯。`, to: { x: to.node.x, y: to.node.y, z: to.node.z } } });
    }
    for (const next of neighbors) {
      const cost = entry.cost + next.cost;
      if (cost >= (costs.get(next.node.key) ?? Infinity) - .001) continue;
      costs.set(next.node.key, cost); previous.set(next.node.key, { node, elevator: next.extra });
      heap.push({ node: next.node, cost, score: cost + heuristic(next.node) });
    }
  }
  if (!end && heap.items.length) return { ...base, status: 'search_limit', message: '本次搜索达到上限，尚未确认路线，不能当作已经可达或猜测方向。', steps: [] };
  if (!end) return { ...base, status: 'unreachable', message: '当前场景没有可步行到达的路线。墙、家具、锁门、改道门、地板缺口或停运电梯可能挡路；先处理障碍，再重新查询。', locked_doors: locked, steps: [] };
  const chain: { node: Node; elevator?: NavigationStep }[] = [];
  let cursor = end;
  while (true) { const parent = previous.get(cursor.key); chain.push({ node: cursor, elevator: parent?.elevator }); if (!parent) break; cursor = parent.node; }
  chain.reverse();
  const pulled: typeof chain = [];
  let anchor: Point = start;
  for (let i = 0; i < chain.length;) {
    if (chain[i].elevator) { pulled.push(chain[i]); anchor = chain[i].node; i++; continue; }
    let farthest = i;
    for (let j = i; j < chain.length && !chain[j].elevator; j++) if (canWalk(anchor, chain[j].node)) farthest = j;
    pulled.push(chain[farthest]); anchor = chain[farthest].node; i = farthest + 1;
  }
  function crossesDoor(a: Point, b: Point, box: AABB) {
    let enter = 0, exit = 1;
    for (const [axis, index] of [['x', 0], ['z', 2]] as const) {
      const delta = b[axis] - a[axis], low = box.min[index] - RADIUS + EPS, high = box.max[index] + RADIUS - EPS;
      if (Math.abs(delta) < .0001) { if (a[axis] <= low || a[axis] >= high) return false; }
      else { const t0 = (low - a[axis]) / delta, t1 = (high - a[axis]) / delta; enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1)); }
    }
    const y = a.y + (b.y - a.y) * Math.max(0, enter);
    return enter <= exit && exit >= 0 && enter <= 1 && y < box.max[1] && y + HEIGHT > box.min[1];
  }
  const steps: NavigationStep[] = [], handledDoors = new Set<string>();
  let legStart: Point = start, legEnd: Point = start, legMeters = 0;
  const flush = () => {
    if (legMeters < .08) return;
    const heading = headingBetween(legStart, legEnd);
    const stairs = Math.abs(legEnd.y - legStart.y) > .35;
    const meters = Math.round(legMeters * 10) / 10;
    const degrees = Math.round(heading.degrees) % 360;
    const viaDoors = [...world.doors.values()].filter(d => !d.removed && crossesDoor(legStart, legEnd, world.doorAABB({ ...d, t: 0 })!)).map(d => ({ door: d.id, kind: d.kind }));
    const nearDoor = [...world.doors.values()].filter(d => !d.removed && Math.abs(d.floorY - legEnd.y) < .4 && Math.hypot(d.center.x - legEnd.x, d.center.z - legEnd.z) <= 1.1).sort((a, b) => Math.hypot(a.center.x - legEnd.x, a.center.z - legEnd.z) - Math.hypot(b.center.x - legEnd.x, b.center.z - legEnd.z))[0];
    const destination = isGoal(legEnd) ? '到达目标位置。' : nearDoor ? `到${nearDoor.kind === 'glass' ? '玻璃门' : '门'}附近再确认方向。` : '然后按下一步转向。';
    steps.push({ action: stairs ? 'stairs' : 'walk', direction: heading.label, heading_degrees: degrees, meters, to: { x: legEnd.x, y: legEnd.y, z: legEnd.z },
      ...(nearDoor ? { landmark: { door: nearDoor.id, kind: nearDoor.kind } } : {}),
      ...(viaDoors.length ? { via_doors: viaDoors } : {}),
      instruction: stairs ? `沿楼梯朝${heading.label}${legEnd.y > legStart.y ? '上楼' : '下楼'}，行进约${meters}米。` : `朝${heading.label}${degrees % 90 ? `（指南针约${degrees}度）` : ''}走约${meters}米，${destination}` });
    legStart = legEnd; legMeters = 0;
  };
  let at: Point = start;
  for (const item of pulled) {
    const node = item.node;
    if (item.elevator) { flush(); steps.push(item.elevator); at = node; legStart = legEnd = node; continue; }
    for (const { door, box } of plannedDoors.values()) if (!handledDoors.has(door.id) && crossesDoor(at, node, box)) {
      flush(); handledDoors.add(door.id);
      if (door.locked) steps.push({ action: 'unlock_door', door: door.id, instruction: `先解除${door.id}的门锁，不能直接通过锁门。` });
      steps.push({ action: door.open ? 'wait_door' : 'open_door', door: door.id, instruction: door.open ? `等待${door.id}完全打开后再通过。` : `先打开${door.id}，门完全打开后再通过。` });
    }
    flush(); legStart = at; legEnd = node; legMeters = distance(at, node); at = node;
  }
  flush();
  // Ignore sub-cell alignment only when the next segment is directly walkable.
  if (steps[0]?.action === 'walk' && (steps[0].meters ?? 0) < .36 && steps[1]?.to && canWalk(start, steps[1].to)) steps.shift();
  if (steps[0]?.direction && steps[0].to) steps[0].relative = relativeDirection(headingBetween(start, steps[0].to).degrees, facing.degrees);
  return { ...base, status: steps.some(s => !['walk', 'stairs'].includes(s.action)) ? 'requires_action' : 'ok', message: '已按当前碰撞、地面支撑和门状态计算路线；方向以北=-z、东=+x为准。',
    distance_m: Math.round(pulled.reduce((sum, item, i) => sum + distance(i ? pulled[i - 1].node : start, item.node), 0) * 10) / 10,
    next_step: steps[0], steps: steps.slice(0, 24), waypoints: pulled.map(item => ({ x: item.node.x, y: item.node.y, z: item.node.z })) };
}

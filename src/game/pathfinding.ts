import {
  BOUNDARY_X_MAX,
  BOUNDARY_X_MIN,
  BOUNDARY_Z_MAX,
  BOUNDARY_Z_MIN,
} from './constants';
import { Block } from './types';

type GridPoint = { x: number; z: number };

export type RouteSummary = {
  reachable: boolean;
  distance: number | null;
  manhattanDistance: number;
  nextStep: GridPoint | null;
  nextDirection: string | null;
  routeDirections: string[];
  pathPreview: GridPoint[];
};

export type NavigationSummary = {
  playerCell: GridPoint;
  fakeExit: RouteSummary & {
    target: GridPoint;
  };
  trueBoundaryGap: RouteSummary & {
    targets: GridPoint[];
    sealed: boolean;
  };
};

const keyOf = (point: GridPoint) => `${point.x},${point.z}`;

const isSolidForPath = (block: Block | undefined) =>
  Boolean(block && (block.type === 'wall' || block.type === 'console' || block.type === 'door'));

const isInsideMaze = (point: GridPoint) =>
  point.x >= BOUNDARY_X_MIN &&
  point.x <= BOUNDARY_X_MAX &&
  point.z >= BOUNDARY_Z_MIN &&
  point.z <= BOUNDARY_Z_MAX;

const isWalkable = (blocks: Record<string, Block>, point: GridPoint) =>
  isInsideMaze(point) && !isSolidForPath(blocks[`${point.x},1,${point.z}`]) && !isSolidForPath(blocks[`${point.x},2,${point.z}`]);

const manhattanToTargets = (from: GridPoint, targets: GridPoint[]) =>
  Math.min(...targets.map((target) => Math.abs(from.x - target.x) + Math.abs(from.z - target.z)));

const directionForStep = (from: GridPoint, to: GridPoint) => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx > 0) return 'east(+x)';
  if (dx < 0) return 'west(-x)';
  if (dz > 0) return 'south(+z)';
  if (dz < 0) return 'north(-z)';
  return 'stay';
};

const findNearestWalkable = (blocks: Record<string, Block>, origin: GridPoint) => {
  if (isWalkable(blocks, origin)) return origin;

  for (let radius = 1; radius <= 3; radius += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      for (let z = origin.z - radius; z <= origin.z + radius; z += 1) {
        const point = { x, z };
        if (Math.abs(origin.x - x) + Math.abs(origin.z - z) <= radius && isWalkable(blocks, point)) {
          return point;
        }
      }
    }
  }

  return origin;
};

const findRoute = (blocks: Record<string, Block>, start: GridPoint, targets: GridPoint[]): RouteSummary => {
  const targetKeys = new Set(targets.map(keyOf));
  const queue: GridPoint[] = [start];
  const visited = new Set([keyOf(start)]);
  const previous = new Map<string, string | null>([[keyOf(start), null]]);
  const points = new Map<string, GridPoint>([[keyOf(start), start]]);
  let foundKey: string | null = targetKeys.has(keyOf(start)) ? keyOf(start) : null;

  for (let index = 0; index < queue.length && !foundKey; index += 1) {
    const current = queue[index];
    const neighbors = [
      { x: current.x + 1, z: current.z },
      { x: current.x - 1, z: current.z },
      { x: current.x, z: current.z + 1 },
      { x: current.x, z: current.z - 1 },
    ];

    for (const next of neighbors) {
      const nextKey = keyOf(next);
      if (visited.has(nextKey) || !isWalkable(blocks, next)) continue;
      visited.add(nextKey);
      previous.set(nextKey, keyOf(current));
      points.set(nextKey, next);
      if (targetKeys.has(nextKey)) {
        foundKey = nextKey;
        break;
      }
      queue.push(next);
    }
  }

  if (!foundKey) {
    return {
      reachable: false,
      distance: null,
      manhattanDistance: manhattanToTargets(start, targets),
      nextStep: null,
      nextDirection: null,
      routeDirections: [],
      pathPreview: [],
    };
  }

  const path: GridPoint[] = [];
  let cursor: string | null = foundKey;
  while (cursor) {
    const point = points.get(cursor);
    if (point) path.push(point);
    cursor = previous.get(cursor) ?? null;
  }
  path.reverse();

  const nextStep = path[1] ?? null;
  return {
    reachable: true,
    distance: Math.max(0, path.length - 1),
    manhattanDistance: manhattanToTargets(start, targets),
    nextStep,
    nextDirection: nextStep ? directionForStep(start, nextStep) : 'arrived',
    routeDirections: path.slice(1, 13).map((point, index) => directionForStep(path[index], point)),
    pathPreview: path.slice(0, 12),
  };
};

export const computeNavigationSummary = (
  blocks: Record<string, Block>,
  playerPos: [number, number, number],
  boundaryGapOpen: boolean,
): NavigationSummary => {
  const playerCell = findNearestWalkable(blocks, {
    x: Math.round(playerPos[0]),
    z: Math.round(playerPos[2]),
  });
  const fakeExitTarget = { x: 0, z: BOUNDARY_Z_MIN };
  const gapTargets = [10, 11, 12, 13].map((z) => ({ x: BOUNDARY_X_MAX, z }));

  return {
    playerCell,
    fakeExit: {
      target: fakeExitTarget,
      ...findRoute(blocks, playerCell, [fakeExitTarget]),
    },
    trueBoundaryGap: {
      targets: gapTargets,
      sealed: !boundaryGapOpen,
      ...findRoute(blocks, playerCell, gapTargets),
    },
  };
};

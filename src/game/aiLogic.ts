import { useGameStore } from '../store/gameStore';
import { computeNavigationSummary } from './pathfinding';
import { PROTECT_RADIUS_ANCHOR, PROTECT_RADIUS_CONSOLE, PROTECT_RADIUS_PLAYER } from './constants';
import type { BlockType, WinState } from './types';

type DirectorAction = {
  type: 'do_nothing' | 'spawn_blocks' | 'remove_blocks' | 'seal_route' | 'open_route' | 'open_boundary_gap' | 'create_glitch_effect';
  routeId?: string;
  positions?: { x: number; y: number; z: number }[];
  blockType?: BlockType;
};

type DirectorOutput = {
  subtitle?: string;
  emotion?: string;
  action?: DirectorAction;
  operations?: { x: number; y: number; z: number; type: BlockType }[];
  effects?: { name: string; x: number; y: number; z: number }[];
  remote?: boolean;
  model?: string;
};

type AiTrigger = 'narrator' | 'message' | 'manual';
type BlockOperation = { x: number; y: number; z: number; type: BlockType };

const localEndpoint = import.meta.env.VITE_AI_ENDPOINT || 'http://127.0.0.1:8787/api/ai/director';
const preferLocalQwen = import.meta.env.VITE_LLM_ENABLED === 'true';
const MIN_SUBTITLE_MS = 1000;
let subtitleQueue: { text: string; emotion: string; glitch: boolean }[] = [];
let subtitleQueueActive = false;

const queueSubtitle = (subtitle: { text: string; emotion?: string; glitch?: boolean }) => {
  const text = subtitle.text.trim();
  if (!text) return;
  const next = {
    text,
    emotion: subtitle.emotion || 'calm',
    glitch: Boolean(subtitle.glitch),
  };
  const tail = subtitleQueue[subtitleQueue.length - 1];
  if (tail?.text === next.text) return;
  subtitleQueue.push(next);
  void drainSubtitleQueue();
};

const drainSubtitleQueue = async () => {
  if (subtitleQueueActive) return;
  subtitleQueueActive = true;
  while (subtitleQueue.length > 0) {
    const next = subtitleQueue.shift();
    if (next) useGameStore.getState().setSubtitle(next);
    await new Promise((resolve) => window.setTimeout(resolve, MIN_SUBTITLE_MS));
  }
  subtitleQueueActive = false;
};

const safeBlockType = (type: unknown): BlockType => {
  const value = String(type || 'wall');
  return ['floor', 'wall', 'exit', 'console', 'anchor', 'door', 'door_open', 'air'].includes(value) ? (value as BlockType) : 'wall';
};

const gridChebyshevDistance2D = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

const isSolidBlock = (type: BlockType | undefined) => type === 'wall' || type === 'console' || type === 'door';

const isWalkableCell = (blocks: ReturnType<typeof useGameStore.getState>['blocks'], x: number, z: number) =>
  !isSolidBlock(blocks[`${x},1,${z}`]?.type) && !isSolidBlock(blocks[`${x},2,${z}`]?.type);

const directionName = (dx: number, dz: number) => {
  if (dx > 0) return 'east(+x)';
  if (dx < 0) return 'west(-x)';
  if (dz > 0) return 'south(+z)';
  if (dz < 0) return 'north(-z)';
  return 'stay';
};

const directionLabel = (direction: string | null) => {
  if (!direction) return '未知方向';
  if (direction.includes('east')) return '东';
  if (direction.includes('west')) return '西';
  if (direction.includes('south')) return '南';
  if (direction.includes('north')) return '北';
  return direction;
};

const crossSectionCells = (x: number, z: number, dx: number, dz: number) => {
  const cells = [{ x, z }];
  if (dx !== 0) {
    cells.push({ x, z: z - 1 }, { x, z: z + 1 });
  } else if (dz !== 0) {
    cells.push({ x: x - 1, z }, { x: x + 1, z });
  }
  return cells;
};

const buildSealPlan = (blocks: ReturnType<typeof useGameStore.getState>['blocks'], playerCell: { x: number; z: number }, dx: number, dz: number) => {
  for (let distance = 3; distance <= 8; distance += 1) {
    const center = { x: playerCell.x + dx * distance, z: playerCell.z + dz * distance };
    if (!isWalkableCell(blocks, center.x, center.z)) break;
    const positions = crossSectionCells(center.x, center.z, dx, dz)
      .filter((cell) => isWalkableCell(blocks, cell.x, cell.z))
      .flatMap((cell) => [1, 2].map((y) => ({ x: cell.x, y, z: cell.z, type: 'wall' as BlockType })));
    if (positions.length >= 2) return { center, positions };
  }
  return null;
};

const buildOpenPlan = (blocks: ReturnType<typeof useGameStore.getState>['blocks'], playerCell: { x: number; z: number }, dx: number, dz: number) => {
  for (let distance = 2; distance <= 8; distance += 1) {
    const center = { x: playerCell.x + dx * distance, z: playerCell.z + dz * distance };
    const blockers = [1, 2]
      .map((y) => blocks[`${center.x},${y},${center.z}`])
      .filter((block) => block && isSolidBlock(block.type));
    if (blockers.length > 0) {
      return {
        center,
        positions: blockers.map((block) => ({ x: block.x, y: block.y, z: block.z, type: 'air' as BlockType })),
      };
    }
  }
  return null;
};

const buildLocalMapContext = (
  blocks: ReturnType<typeof useGameStore.getState>['blocks'],
  playerCell: { x: number; z: number },
  nextStep: { x: number; z: number } | null,
) => {
  const recommendedDirection = nextStep ? directionName(nextStep.x - playerCell.x, nextStep.z - playerCell.z) : null;
  const directions = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ];
  const walkableNeighbors = directions.map(({ dx, dz }) => {
    const x = playerCell.x + dx;
    const z = playerCell.z + dz;
    return {
      direction: directionName(dx, dz),
      cell: { x, z },
      walkable: isWalkableCell(blocks, x, z),
      recommended: recommendedDirection === directionName(dx, dz),
    };
  });
  const routeControlOptions = [];

  for (const neighbor of walkableNeighbors) {
    const dx = Math.sign(neighbor.cell.x - playerCell.x);
    const dz = Math.sign(neighbor.cell.z - playerCell.z);
    if (neighbor.walkable && !neighbor.recommended) {
      const plan = buildSealPlan(blocks, playerCell, dx, dz);
      if (plan) {
        routeControlOptions.push({
          routeId: `seal:${neighbor.direction}`,
          operation: 'seal_route',
          direction: directionLabel(neighbor.direction),
          purpose: `封住${directionLabel(neighbor.direction)}侧可走岔路，保留${directionLabel(recommendedDirection)}方向`,
          systemWill: '系统会计算横向封口，确保这条岔路实际不可通行',
        });
      }
    } else if (!neighbor.walkable && neighbor.recommended) {
      const plan = buildOpenPlan(blocks, playerCell, dx, dz);
      if (plan) {
        routeControlOptions.push({
          routeId: `open:${neighbor.direction}`,
          operation: 'open_route',
          direction: directionLabel(neighbor.direction),
          purpose: `打开${directionLabel(neighbor.direction)}方向的推荐路线`,
          systemWill: '系统会拆除阻挡推荐路线的墙块，形成可通行开口',
        });
      }
    }
  }

  const localGrid = [];
  for (let z = playerCell.z - 4; z <= playerCell.z + 4; z += 1) {
    let row = '';
    for (let x = playerCell.x - 4; x <= playerCell.x + 4; x += 1) {
      if (x === playerCell.x && z === playerCell.z) row += 'P';
      else if (nextStep && x === nextStep.x && z === nextStep.z) row += '>';
      else {
        const upper = blocks[`${x},1,${z}`];
        if (!upper || upper.type === 'air') row += '.';
        else if (upper.type === 'wall') row += '#';
        else if (upper.type === 'console') row += 'C';
        else if (upper.type === 'anchor') row += 'A';
        else if (upper.type === 'exit') row += 'E';
        else row += '?';
      }
    }
    localGrid.push(row);
  }

  return {
    legend: 'P=玩家, >=下一步推荐格, .=可走, #=墙, C=控制台, A=锚定桩, E=门',
    recommendedDirection,
    walkableNeighbors,
    routeControlOptions: routeControlOptions.slice(0, 8),
    localGrid,
  };
};

const operationsForRouteAction = (action: DirectorAction): BlockOperation[] => {
  if (action.type !== 'seal_route' && action.type !== 'open_route') return [];
  if (!action.routeId) return [];
  const state = useGameStore.getState();
  const navigation = computeNavigationSummary(state.blocks, state.playerPos, state.boundaryGapOpen);
  const localMap = buildLocalMapContext(state.blocks, navigation.playerCell, navigation.fakeExit.nextStep);
  const option = localMap.routeControlOptions.find((candidate) => candidate.routeId === action.routeId && candidate.operation === action.type);
  if (!option) {
    state.addRawAiLog(`路线处理失败：未知 routeId ${action.routeId}`);
    state.addGameEvent({
      type: 'world_change',
      text: `Agent 选择了不可用的路线处理 ${action.routeId}，系统没有执行。下一次回复应抱怨这个选择失败，并重新选择 routeControlOptions。`,
    });
    return [];
  }

  const direction = String(action.routeId.split(':')[1] || '');
  const dx = direction.includes('east') ? 1 : direction.includes('west') ? -1 : 0;
  const dz = direction.includes('south') ? 1 : direction.includes('north') ? -1 : 0;
  const plan =
    action.type === 'seal_route'
      ? buildSealPlan(state.blocks, navigation.playerCell, dx, dz)
      : buildOpenPlan(state.blocks, navigation.playerCell, dx, dz);

  if (!plan) {
    state.addRawAiLog(`路线处理失败：${action.routeId} 没有可执行方块`);
    state.addGameEvent({
      type: 'world_change',
      text: `Agent 选择了 ${action.routeId}，但系统找不到可执行封口或开口。`,
    });
    return [];
  }

  state.addRawAiLog(`路线处理：Agent 选择 ${action.routeId}，系统计算 ${plan.positions.length} 个方块。`);
  state.addGameEvent({
    type: 'world_change',
    text: `Agent 选择${action.type === 'seal_route' ? '封锁' : '打开'} ${option.direction} 方向，系统计算实际地图操作。`,
  });
  return plan.positions;
};

const filterBlockedOperations = (operations: BlockOperation[]) => {
  const state = useGameStore.getState();
  const [px, , pz] = state.playerPos;
  const playerCell = { x: Math.round(px), z: Math.round(pz) };
  const protectedBlocks = Object.values(state.blocks).filter((block) => block.protectedBy === 'console' || block.protectedBy === 'anchor');
  const allowed: BlockOperation[] = [];
  const blocked: { op: BlockOperation; reason: string }[] = [];

  for (const op of operations) {
    const target = { x: op.x, z: op.z };
    if (gridChebyshevDistance2D(target, playerCell) <= PROTECT_RADIUS_PLAYER) {
      blocked.push({ op, reason: '玩家3x3保护区' });
      continue;
    }

    const protectedMatch = protectedBlocks.find((block) => {
      const radius = block.protectedBy === 'anchor' ? PROTECT_RADIUS_ANCHOR : PROTECT_RADIUS_CONSOLE;
      return gridChebyshevDistance2D(target, block) <= radius && Math.abs(op.y - block.y) <= 2;
    });
    if (protectedMatch) {
      blocked.push({ op, reason: protectedMatch.protectedBy === 'anchor' ? '锚定桩保护区' : '控制台附近区域' });
      continue;
    }

    allowed.push(op);
  }

  return { allowed, blocked };
};

export const markEndingForNextRun = (ending: WinState) => {
  if (ending === 'fake' || ending === 'true' || ending === 'glitch') {
    window.localStorage.setItem('agent-fable-last-ending', ending);
  }
};

const consumeEndingForNextRun = (): WinState => {
  const value = window.localStorage.getItem('agent-fable-last-ending') as WinState | null;
  window.localStorage.removeItem('agent-fable-last-ending');
  return value || 'true';
};

export const startNewRun = async () => {
  consumeEndingForNextRun();
  useGameStore.getState().initGame();
  useGameStore.getState().setAppState('playing');
};

const buildDirectorContext = (trigger: AiTrigger) => {
  const state = useGameStore.getState();
  const [px, py, pz] = state.playerPos;
  const navigation = computeNavigationSummary(state.blocks, state.playerPos, state.boundaryGapOpen);
  const localMap = buildLocalMapContext(state.blocks, navigation.playerCell, navigation.fakeExit.nextStep);
  const nearbyBlocks = Object.values(state.blocks)
    .filter((block) => Math.abs(block.x - px) < 6 && Math.abs(block.y - py) < 5 && Math.abs(block.z - pz) < 6)
    .map((block) => `${block.type} at (${block.x},${block.y},${block.z})`)
    .join('; ');

  return {
    trigger,
    player: {
      position: [Number(px.toFixed(1)), Number(py.toFixed(1)), Number(pz.toFixed(1))],
      yaw: Number(state.playerYaw.toFixed(3)),
      lastMessage: trigger === 'message' ? state.lastMessage || '无' : '无',
      nearBoundary: Math.abs(px) > 8 || Math.abs(pz) > 8,
    },
    world: {
      aiPermissionLevel: state.aiPermissionLevel,
      consolesDestroyed: state.consolesDestroyed,
      anchorsInInventory: state.anchorsInventory,
      placedAnchors: Object.values(state.blocks)
        .filter((block) => block.type === 'anchor' && block.protectedBy === 'anchor')
        .map((block) => [block.x, block.y, block.z]),
      boundaryGapOpen: state.boundaryGapOpen,
      nearbyBlocks: nearbyBlocks || '无',
      blockCount: Object.keys(state.blocks).length,
    },
    recentEvents: state.eventLog.slice(0, 14).map((event) => ({
      type: event.type,
      text: event.text,
    })),
    recentAiRawOutputs: state.rawAiLogs.slice(0, 8).map((entry) => entry.raw.slice(0, 1000)),
    navigation: {
      playerCell: navigation.playerCell,
      localMap,
      fakeExit: {
        target: navigation.fakeExit.target,
        reachable: navigation.fakeExit.reachable,
        distance: navigation.fakeExit.distance,
        straightLineDistance: navigation.fakeExit.manhattanDistance,
        nextDirection: navigation.fakeExit.nextDirection,
        nextStep: navigation.fakeExit.nextStep,
        routeDirections: navigation.fakeExit.routeDirections,
        pathPreview: navigation.fakeExit.pathPreview,
      },
      trueBoundaryGap: {
        targets: navigation.trueBoundaryGap.targets,
        sealed: navigation.trueBoundaryGap.sealed,
        reachable: navigation.trueBoundaryGap.reachable,
        distance: navigation.trueBoundaryGap.distance,
        straightLineDistance: navigation.trueBoundaryGap.manhattanDistance,
        nextDirection: navigation.trueBoundaryGap.nextDirection,
        nextStep: navigation.trueBoundaryGap.nextStep,
        routeDirections: navigation.trueBoundaryGap.routeDirections,
        pathPreview: navigation.trueBoundaryGap.pathPreview,
      },
    },
    allowedActions: ['do_nothing', 'seal_route', 'open_route', 'spawn_blocks', 'remove_blocks', state.consolesDestroyed >= 5 ? 'open_boundary_gap' : 'do_nothing'],
  };
};

const callLocalQwen = async (trigger: AiTrigger): Promise<DirectorOutput> => {
  const response = await fetch(localEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(buildDirectorContext(trigger)),
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = JSON.parse(text)?.error || text;
    } catch {
      detail = text;
    }
    throw new Error(`Qwen proxy failed: ${response.status} ${String(detail).slice(0, 240)}`);
  }
  return response.json();
};

const localFallback = (): DirectorOutput => {
  const state = useGameStore.getState();
  if (state.consolesDestroyed >= 5 && !state.boundaryGapOpen) {
    return {
      subtitle: '后端暂时没接上。\n裂缝已可开启。',
      emotion: 'nervous',
      action: { type: 'open_boundary_gap' },
      remote: false,
    };
  }
  if (state.lastMessage?.includes('出口') || state.lastMessage?.toLowerCase().includes('exit')) {
    return {
      subtitle: '后端暂时没接上。\n先向西，再往北。',
      emotion: 'nervous',
      action: { type: 'do_nothing' },
      remote: false,
    };
  }
  return {
    subtitle: state.consolesDestroyed > 0 ? '后端暂时没接上。\n控制台状态已记录。' : '后端暂时没接上。\n请检查 Qwen 服务。',
    emotion: state.consolesDestroyed > 0 ? 'nervous' : 'calm',
    action: { type: 'do_nothing' },
    remote: false,
  };
};

const applyDirectorOutput = (output: DirectorOutput) => {
  const action = output.action || { type: 'do_nothing' };
  const subtitle = output.subtitle || 'Agent 暂时失去控制';
  const emotion = output.emotion || 'calm';
  const state = useGameStore.getState();

  queueSubtitle({ text: subtitle, emotion, glitch: emotion === 'panic' || emotion === 'nervous' || state.aiPermissionLevel >= 4 });
  state.addGameEvent({ type: 'ai_response', text: `Agent：“${subtitle}”；动作：${action.type}` });
  if (output.remote !== false) state.setLastError(null);

  if (action.type === 'open_boundary_gap') {
    state.openBoundaryGap();
    return;
  }

  const routeOperations = operationsForRouteAction(action);
  const operations = routeOperations.length
    ? routeOperations
    : output.operations?.length
      ? output.operations
      : (action.positions || []).map((position) => ({
        x: Math.round(position.x),
        y: Math.round(position.y),
        z: Math.round(position.z),
        type: action.type === 'remove_blocks' ? ('air' as BlockType) : safeBlockType(action.blockType),
      }));
  if (operations.length > 0) {
    const { allowed, blocked } = filterBlockedOperations(operations);
    if (blocked.length > 0) {
      const summary = blocked
        .slice(0, 4)
        .map(({ op, reason }) => `${reason} (${op.x},${op.y},${op.z})`)
        .join('；');
      state.addRawAiLog(`地图修改失败：${summary}`);
      state.addGameEvent({
        type: 'world_change',
        text: `Agent 的 ${blocked.length} 个地图修改被系统拒绝：${summary}。下一次回复应对此表现出疑惑、抱怨或不情愿。`,
      });
      queueSubtitle({
        text: '等等，这里不听我的。\n算了，先照我说的走。',
        emotion: 'confused',
        glitch: true,
      });
    }

    const removals = allowed.filter((op) => op.type === 'air');
    const sets = allowed.filter((op) => op.type !== 'air');
    if (sets.length > 0) state.modifyBlocks(sets, 'set');
    if (removals.length > 0) state.modifyBlocks(removals, 'remove');
  }
};

const formatOutputForHistory = (output: DirectorOutput) => {
  const parts = [`Agent：${output.subtitle || '沉默。'}`];
  parts.push(output.remote ? `模型：${output.model || 'Qwen'}` : '模型：本地降级');
  const operationCount = output.operations?.length || output.action?.positions?.length || 0;
  const effectCount = output.effects?.length || 0;
  if (operationCount > 0) parts.push(`方块操作：${operationCount}`);
  if (effectCount > 0) parts.push(`特效：${effectCount}`);
  return parts.join('\n');
};

export const tickAI = async (trigger: AiTrigger = 'narrator') => {
  const state = useGameStore.getState();
  if (state.winState !== 'none' || !state.gameStarted || state.isAITicking) return;

  state.setAITicking(true);
  try {
    const output = preferLocalQwen ? await callLocalQwen(trigger) : localFallback();
    useGameStore.getState().addRawAiLog(formatOutputForHistory(output));
    applyDirectorOutput(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useGameStore.getState().addRawAiLog(`错误：${message}`);
    applyDirectorOutput(localFallback());
    useGameStore.getState().setLastError(message);
  } finally {
    useGameStore.getState().setAITicking(false);
  }
};

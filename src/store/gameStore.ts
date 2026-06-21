import { create } from 'zustand';
import type { AISubtitle, AppState, Block, BlockType, EnvironmentSettings, GameEvent, GameState, WinState } from '../game/types';
import { EventBus } from '../game/EventBus';
import {
  BOUNDARY_WALL_HEIGHT,
  BOUNDARY_X_MAX,
  BOUNDARY_X_MIN,
  BOUNDARY_Y_MIN,
  BOUNDARY_Z_MAX,
  BOUNDARY_Z_MIN,
  MAP_HEIGHT,
} from '../game/constants';

type BlockOperation = { x: number; y: number; z: number; type: BlockType };

interface GameActions {
  initGame: () => void;
  setPlayerPos: (pos: [number, number, number]) => void;
  setPlayerYaw: (yaw: number) => void;
  setWinState: (state: WinState) => void;
  destroyConsole: (id: string) => void;
  pickupAnchor: (id: string) => void;
  placeAnchor: (targetPos?: [number, number, number]) => void;
  sendMessage: (msg: string) => void;
  tickMessageCooldown: () => void;
  setSubtitle: (subtitle: AISubtitle | null) => void;
  modifyBlocks: (operations: BlockOperation[], mode?: 'set' | 'remove') => void;
  openBoundaryGap: () => void;
  triggerGlitch: () => void;
  setAITicking: (isTicking: boolean) => void;
  setInteractPrompt: (prompt: string | null) => void;
  toggleDoor: (id: string) => void;
  setAppState: (state: AppState) => void;
  addRawAiLog: (raw: string) => void;
  addGameEvent: (event: Omit<GameEvent, 'timestamp'>) => void;
  setPhoneOpen: (open: boolean) => void;
  setLastError: (message: string | null) => void;
  updateEnvironment: (settings: Partial<EnvironmentSettings>) => void;
}

const idOf = (x: number, y: number, z: number) => `${x},${y},${z}`;

const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  ambientIntensity: 1.5,
  directionalIntensity: 2,
  fogNear: 5,
  fogFar: 20,
  narratorIntervalSec: 10,
};

const addBlock = (
  blocks: Record<string, Block>,
  x: number,
  y: number,
  z: number,
  type: BlockType,
  protectedBy: Block['protectedBy'] = null,
) => {
  const id = idOf(x, y, z);
  blocks[id] = { id, x, y, z, type, protectedBy };
};

const addWallColumn = (blocks: Record<string, Block>, x: number, z: number, height = 2) => {
  for (let y = 1; y <= height; y += 1) addBlock(blocks, x, y, z, 'wall');
};

const carveCell = (blocks: Record<string, Block>, x: number, z: number) => {
  for (let y = 1; y <= MAP_HEIGHT; y += 1) delete blocks[idOf(x, y, z)];
};

const generateInitialMap = (): Record<string, Block> => {
  const blocks: Record<string, Block> = {};

  for (let x = BOUNDARY_X_MIN; x <= BOUNDARY_X_MAX; x += 1) {
    for (let z = BOUNDARY_Z_MIN; z <= BOUNDARY_Z_MAX; z += 1) {
      addBlock(blocks, x, 0, z, 'floor');
    }
  }

  for (let x = BOUNDARY_X_MIN; x <= BOUNDARY_X_MAX; x += 1) {
    for (let y = 1; y <= BOUNDARY_WALL_HEIGHT; y += 1) {
      addBlock(blocks, x, y, BOUNDARY_Z_MIN, 'wall');
      addBlock(blocks, x, y, BOUNDARY_Z_MAX, 'wall');
    }
  }

  for (let z = BOUNDARY_Z_MIN; z <= BOUNDARY_Z_MAX; z += 1) {
    for (let y = 1; y <= BOUNDARY_WALL_HEIGHT; y += 1) {
      addBlock(blocks, BOUNDARY_X_MIN, y, z, 'wall');
      addBlock(blocks, BOUNDARY_X_MAX, y, z, 'wall');
    }
  }

  for (let x = -12; x <= 12; x += 1) {
    if (![-9, -2, 3, 10].includes(x)) addWallColumn(blocks, x, -8, 2);
    if (![-11, -4, 1, 8, 14].includes(x)) addWallColumn(blocks, x, 4, 2);
    if (![-13, -6, 0, 6, 13].includes(x)) addWallColumn(blocks, x, 11, 2);
  }

  for (let z = -14; z <= 14; z += 1) {
    if (![-12, -5, 0, 7, 13].includes(z)) addWallColumn(blocks, -7, z, 2);
    if (![-14, -9, -1, 5, 12].includes(z)) addWallColumn(blocks, 7, z, 2);
    if (![-11, -3, 3, 9, 14].includes(z)) addWallColumn(blocks, 13, z, 2);
  }

  for (let z = -7; z <= 3; z += 1) {
    if (![-2, 1].includes(z)) addWallColumn(blocks, -4, z, 4);
    if (![-3, 2].includes(z)) addWallColumn(blocks, 4, z, 4);
  }

  for (let x = -6; x <= 6; x += 1) {
    if (![-1, 0, 1].includes(x)) addWallColumn(blocks, x, -5, 4);
  }
  addWallColumn(blocks, 0, -7, 4);

  for (let x = -15; x <= -11; x += 1) {
    if (x !== -13) addWallColumn(blocks, x, -2, 2);
    addWallColumn(blocks, x, 8, 1);
  }
  for (let z = -2; z <= 8; z += 1) {
    if (z !== 3) addWallColumn(blocks, -15, z, 2);
    if (z !== -1) addWallColumn(blocks, -11, z, 2);
  }

  for (let x = 9; x <= 15; x += 1) {
    if (x !== 12) addWallColumn(blocks, x, -12, 2);
    if (x !== 14) addWallColumn(blocks, x, -4, 1);
  }
  for (let z = -12; z <= -4; z += 1) {
    if (z !== -8) addWallColumn(blocks, 9, z, 2);
    if (z !== -5) addWallColumn(blocks, 15, z, 2);
  }

  for (const [x, z] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [4, 4],
    [5, 4],
    [4, 5],
  ]) {
    carveCell(blocks, x, z);
  }

  addBlock(blocks, 0, 1, BOUNDARY_Z_MIN, 'exit');
  addBlock(blocks, 0, 2, BOUNDARY_Z_MIN, 'exit');

  const consolePositions = [
    [0, 1, -6],
    [-13, 1, 5],
    [12, 1, -9],
    [-12, 1, -13],
    [14, 1, 10],
  ];

  consolePositions.forEach(([x, y, z]) => addBlock(blocks, x, y, z, 'console', 'console'));
  return blocks;
};

const placedAnchorCount = (blocks: Record<string, Block>) =>
  Object.values(blocks).filter((block) => block.type === 'anchor' && block.protectedBy === 'anchor').length;

const prependEvent = (eventLog: GameEvent[], type: GameEvent['type'], text: string): GameEvent[] =>
  [{ timestamp: Date.now(), type, text }, ...eventLog].slice(0, 24);

const openBoundaryGapInBlocks = (blocks: Record<string, Block>) => {
  for (let z = 10; z <= 13; z += 1) {
    for (let y = 1; y <= MAP_HEIGHT; y += 1) delete blocks[idOf(BOUNDARY_X_MAX, y, z)];
  }
};

const rememberEnding = (winState: WinState) => {
  if (typeof window === 'undefined' || winState === 'none') return;
  window.localStorage.setItem('agent-fable-last-ending', winState);
};

const isSaneWorldCoordinate = (op: BlockOperation) =>
  Number.isFinite(op.x) &&
  Number.isFinite(op.y) &&
  Number.isFinite(op.z) &&
  Math.abs(op.x) <= 64 &&
  op.y >= -4 &&
  op.y <= 12 &&
  Math.abs(op.z) <= 64;

export const useGameStore = create<GameState & GameActions>((set) => ({
  appState: 'menu',
  blocks: {},
  playerPos: [0, 1, 0],
  playerYaw: 0,
  aiPermissionLevel: 0,
  consolesDestroyed: 0,
  anchorsInventory: 0,
  winState: 'none',
  subtitle: null,
  messageCooldown: 0,
  lastMessage: null,
  gameStarted: false,
  isAITicking: false,
  interactPrompt: null,
  rawAiLogs: [],
  eventLog: [],
  boundaryGapOpen: false,
  phoneOpen: false,
  lastError: null,
  environment: DEFAULT_ENVIRONMENT,

  initGame: () =>
    set((state) => ({
      appState: state.appState,
      blocks: generateInitialMap(),
      playerPos: [0, 1, 0],
      playerYaw: 0,
      aiPermissionLevel: 0,
      consolesDestroyed: 0,
      anchorsInventory: 0,
      winState: 'none',
      subtitle: { text: '你好，玩家，我会引导你前往通往未来的门', emotion: 'calm', glitch: false },
      messageCooldown: 0,
      lastMessage: null,
      gameStarted: false,
      isAITicking: false,
      interactPrompt: null,
      rawAiLogs: [],
      eventLog: prependEvent([], 'system', '新游戏开始。Agent 正在观察玩家路线。'),
      boundaryGapOpen: false,
      phoneOpen: false,
      lastError: null,
      environment: state.environment,
    })),

  setPlayerPos: (pos) =>
    set((state) => {
      if (state.winState === 'none') {
        const [px, py, pz] = pos;
        const fellOutOfWorld = py < BOUNDARY_Y_MIN;
        const crossedOuterBoundary = px < BOUNDARY_X_MIN || px > BOUNDARY_X_MAX || pz < BOUNDARY_Z_MIN || pz > BOUNDARY_Z_MAX;
        if (fellOutOfWorld || crossedOuterBoundary) {
          rememberEnding('true');
          return { playerPos: pos, winState: 'true' };
        }
      }
      return { playerPos: pos };
    }),

  setPlayerYaw: (playerYaw) => set({ playerYaw }),

  setWinState: (winState) => {
    rememberEnding(winState);
    set({ winState });
  },

  destroyConsole: (id) =>
    set((state) => {
      const block = state.blocks[id];
      if (!block || block.type !== 'console') return state;
      const blocks = { ...state.blocks };
      blocks[id] = { ...block, type: 'anchor', protectedBy: null };
      const consolesDestroyed = state.consolesDestroyed + 1;
      const next = {
        blocks,
        consolesDestroyed,
        aiPermissionLevel: Math.min(5, consolesDestroyed),
        subtitle: {
          text: consolesDestroyed >= 5 ? '我的权限归零了。边界为什么在呼吸？' : '你刚刚破坏了一个普通装置。等等，为什么我的权限下降了？',
          emotion: consolesDestroyed >= 5 ? 'panic' : 'confused',
          glitch: consolesDestroyed >= 4,
        },
        eventLog: prependEvent(
          state.eventLog,
          'console_destroyed',
          `玩家破坏了控制台 ${consolesDestroyed}/5。AI 权限受损等级变为 ${Math.min(5, consolesDestroyed)}/5。`,
        ),
      };
      if (consolesDestroyed >= 5) {
        const gapBlocks = { ...blocks };
        openBoundaryGapInBlocks(gapBlocks);
        return { ...next, blocks: gapBlocks, boundaryGapOpen: true };
      }
      return next;
    }),

  pickupAnchor: (id) =>
    set((state) => {
      const block = state.blocks[id];
      if (!block || block.type !== 'anchor' || state.anchorsInventory >= 3) return state;
      const blocks = { ...state.blocks };
      blocks[id] = { ...block, type: 'air', protectedBy: null };
      return {
        blocks,
        anchorsInventory: state.anchorsInventory + 1,
        eventLog: prependEvent(state.eventLog, 'anchor', `玩家拾取了锚定桩，当前持有 ${state.anchorsInventory + 1} 个。`),
      };
    }),

  placeAnchor: (targetPos) =>
    set((state) => {
      if (state.anchorsInventory <= 0) return state;
      if (placedAnchorCount(state.blocks) >= 3) {
        return { subtitle: { text: '锚定桩最多只能同时布置三个。', emotion: 'confused', glitch: false } };
      }
      const [px, py, pz] = targetPos || state.playerPos;
      const x = Math.round(px);
      const y = Math.max(1, Math.round(py));
      const z = Math.round(pz);
      const id = idOf(x, y, z);
      const floor = state.blocks[idOf(x, 0, z)];
      const existing = state.blocks[id];
      if (!floor || floor.type === 'air' || (existing && existing.type !== 'air')) {
        return { subtitle: { text: '此处无法设置锚定桩。它需要真实地面和空位。', emotion: 'confused', glitch: false } };
      }
      return {
        blocks: { ...state.blocks, [id]: { id, x, y, z, type: 'anchor', protectedBy: 'anchor' } },
        anchorsInventory: state.anchorsInventory - 1,
        subtitle: { text: '这片区域……为什么我改不了？', emotion: 'angry', glitch: true },
        eventLog: prependEvent(state.eventLog, 'anchor', `玩家在 (${x},${y},${z}) 设置了锚定桩。`),
      };
    }),

  sendMessage: (msg) =>
    set((state) =>
      state.messageCooldown <= 0
        ? {
            messageCooldown: 20,
            lastMessage: msg,
            subtitle: { text: '短信已发出。现实正在等待回应。', emotion: 'nervous', glitch: false },
            eventLog: prependEvent(state.eventLog, 'player_message', `玩家发来短信：“${msg}”`),
          }
        : state,
    ),

  tickMessageCooldown: () => set((state) => ({ messageCooldown: Math.max(0, state.messageCooldown - 1) })),
  setSubtitle: (subtitle) => set({ subtitle }),

  modifyBlocks: (operations, mode = 'set') =>
    set((state) => {
      const blocks = { ...state.blocks };
      const changedPositions: BlockOperation[] = [];
      for (const op of operations) {
        if (!isSaneWorldCoordinate(op)) continue;
        const id = idOf(op.x, op.y, op.z);
        if (mode === 'remove' || op.type === 'air') delete blocks[id];
        else blocks[id] = { id, x: op.x, y: op.y, z: op.z, type: op.type, protectedBy: null };
        changedPositions.push(op);
      }
      if (changedPositions.length > 0) EventBus.emit('ai-map-change', { positions: changedPositions, mode });
      return {
        blocks,
        eventLog: prependEvent(state.eventLog, 'world_change', `Agent ${mode === 'remove' ? '移除' : '设置'}了 ${changedPositions.length} 个真实地图方块。`),
      };
    }),

  openBoundaryGap: () =>
    set((state) => {
      if (state.consolesDestroyed < 5) {
        return {
          subtitle: {
            text: '裂缝还没有出现。所有控制台都必须先失效。',
            emotion: 'confused',
            glitch: true,
          },
        };
      }
      const blocks = { ...state.blocks };
      openBoundaryGapInBlocks(blocks);
      return {
        blocks,
        boundaryGapOpen: true,
        subtitle: { text: '边界出现了一条裂缝。请不要把它理解成出口。', emotion: 'nervous', glitch: true },
        eventLog: prependEvent(state.eventLog, 'world_change', '所有控制台失效，边界裂缝打开。'),
      };
    }),

  triggerGlitch: () => set({ winState: 'glitch' }),
  setAITicking: (isAITicking) => set({ isAITicking }),
  setInteractPrompt: (interactPrompt) => set({ interactPrompt }),
  setAppState: (appState) =>
    set((state) => ({
      appState,
      gameStarted: appState === 'playing' ? true : state.gameStarted,
      phoneOpen: appState === 'playing' ? false : state.phoneOpen,
    })),
  addRawAiLog: (raw) =>
    set((state) => {
      if (state.rawAiLogs[0]?.raw === raw) return state;
      return { rawAiLogs: [{ timestamp: Date.now(), raw }, ...state.rawAiLogs].slice(0, 80) };
    }),
  addGameEvent: (event) => set((state) => ({ eventLog: prependEvent(state.eventLog, event.type, event.text) })),
  setPhoneOpen: (phoneOpen) => set({ phoneOpen }),
  setLastError: (lastError) => set({ lastError }),
  updateEnvironment: (settings) => set((state) => ({ environment: { ...state.environment, ...settings } })),
  toggleDoor: (id) =>
    set((state) => {
      const block = state.blocks[id];
      if (!block) return state;
      if (block.type === 'door') return { blocks: { ...state.blocks, [id]: { ...block, type: 'door_open' } } };
      if (block.type === 'door_open') return { blocks: { ...state.blocks, [id]: { ...block, type: 'door' } } };
      return state;
    }),
}));

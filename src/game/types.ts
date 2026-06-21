export type BlockType = 'air' | 'floor' | 'wall' | 'exit' | 'console' | 'anchor' | 'door' | 'door_open';
export type ProtectedBy = 'player' | 'console' | 'anchor' | null;

export interface Block {
  id: string;
  x: number;
  y: number;
  z: number;
  type: BlockType;
  protectedBy: ProtectedBy;
}

export type WinState = 'none' | 'fake' | 'true' | 'glitch';

export interface AISubtitle {
  text: string;
  emotion: string;
  glitch: boolean;
}

export type AppState = 'menu' | 'settings' | 'playing';

export interface EnvironmentSettings {
  ambientIntensity: number;
  directionalIntensity: number;
  fogNear: number;
  fogFar: number;
  narratorIntervalSec: number;
}

export interface GameEvent {
  timestamp: number;
  type: 'player_message' | 'ai_response' | 'console_destroyed' | 'anchor' | 'world_change' | 'system';
  text: string;
}

export interface GameState {
  appState: AppState;
  blocks: Record<string, Block>; // key: `${x},${y},${z}`
  playerPos: [number, number, number];
  playerYaw: number;
  aiPermissionLevel: number; // 0 to 5
  consolesDestroyed: number;
  anchorsInventory: number;
  winState: WinState;
  subtitle: AISubtitle | null;
  messageCooldown: number;
  lastMessage: string | null;
  gameStarted: boolean;
  isAITicking: boolean;
  interactPrompt: string | null;
  rawAiLogs: { timestamp: number; raw: string }[];
  eventLog: GameEvent[];
  boundaryGapOpen: boolean;
  phoneOpen: boolean;
  lastError: string | null;
  environment: EnvironmentSettings;
}

import { useEffect, type FC } from 'react';
import { Game } from './game/main';
import { HUD } from './ui/HUD';
import { Terminal } from './ui/Terminal';
import { AIManager } from './components/AIManager';
import { StartMenu } from './ui/StartMenu';
import { SettingsMenu } from './ui/SettingsMenu';
import { useGameStore } from './store/gameStore';
import { startNewRun, tickAI } from './game/aiLogic';
import { BOUNDARY_X_MAX } from './game/constants';
import { computeNavigationSummary } from './game/pathfinding';

declare global {
  interface Window {
    __agentFableTest?: {
      start: () => Promise<void>;
      getState: () => unknown;
      destroyAllConsoles: () => number;
      openPhone: () => void;
      sendSms: (message: string) => void;
      setPlayerPos: (position: [number, number, number]) => void;
      openBoundaryGap: () => void;
      escapeWorld: () => void;
      fakeWin: () => void;
      runAiTick: () => Promise<void>;
      getBlock: (x: number, y: number, z: number) => unknown;
      getNavigation: () => unknown;
      getSubtitle: () => string | null;
    };
  }
}

const App: FC = () => {
  const appState = useGameStore(state => state.appState);

  useEffect(() => {
    window.__agentFableTest = {
      start: () => startNewRun(),
      getState: () => {
        const state = useGameStore.getState();
        return {
          appState: state.appState,
          gameStarted: state.gameStarted,
          playerPos: state.playerPos,
          playerYaw: state.playerYaw,
          consolesDestroyed: state.consolesDestroyed,
          anchorsInventory: state.anchorsInventory,
          boundaryGapOpen: state.boundaryGapOpen,
          phoneOpen: state.phoneOpen,
          winState: state.winState,
          messageCooldown: state.messageCooldown,
          lastMessage: state.lastMessage,
          lastError: state.lastError,
          rawAiLogs: state.rawAiLogs.length,
          eventLog: state.eventLog.length,
          environment: state.environment,
          blockCount: Object.values(state.blocks).filter(block => block.type !== 'air').length,
        };
      },
      destroyAllConsoles: () => {
        const ids = Object.values(useGameStore.getState().blocks).filter(block => block.type === 'console').map(block => block.id);
        ids.forEach(id => useGameStore.getState().destroyConsole(id));
        return ids.length;
      },
      openPhone: () => useGameStore.getState().setPhoneOpen(true),
      sendSms: (message: string) => {
        useGameStore.getState().setPhoneOpen(true);
        useGameStore.getState().sendMessage(message);
        void tickAI('message');
      },
      setPlayerPos: (position) => useGameStore.getState().setPlayerPos(position),
      openBoundaryGap: () => useGameStore.getState().openBoundaryGap(),
      escapeWorld: () => {
        useGameStore.getState().openBoundaryGap();
        useGameStore.getState().setPlayerPos([BOUNDARY_X_MAX + 2, 1, 8]);
      },
      fakeWin: () => useGameStore.getState().setWinState('fake'),
      runAiTick: () => tickAI('manual'),
      getBlock: (x: number, y: number, z: number) => useGameStore.getState().blocks[`${x},${y},${z}`] || null,
      getNavigation: () => {
        const state = useGameStore.getState();
        return computeNavigationSummary(state.blocks, state.playerPos, state.boundaryGapOpen);
      },
      getSubtitle: () => useGameStore.getState().subtitle?.text || null,
    };
    return () => {
      delete window.__agentFableTest;
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0A0A0A]">
      <Game />
      {appState === 'playing' && (
        <>
          <HUD />
          <Terminal />
          <AIManager />
        </>
      )}
      {appState === 'menu' && <StartMenu />}
      {appState === 'settings' && <SettingsMenu />}
    </div>
  );
};

export default App;

import { FC, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { startNewRun } from '../game/aiLogic';
import { StartMenuFlowBackground } from './StartMenuFlowBackground';

export const StartMenu: FC = () => {
  const setAppState = useGameStore(state => state.setAppState);
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    await startNewRun();
    setStarting(false);
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0A] z-50 overflow-hidden">
      <StartMenuFlowBackground />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,255,65,0.08),rgba(0,0,0,0.86)_68%)] pointer-events-none" />

      <div className="relative z-10 text-center mb-16">
        <h1 className="text-6xl font-bold text-[#00ff41] tracking-widest uppercase drop-shadow-[0_0_15px_rgba(0,255,65,0.8)] mb-4">
          Agent 的寓言
        </h1>
        <p className="text-[#00ff41] opacity-70 tracking-widest font-mono text-sm">
          A I   N A T I V E   E S C A P E
        </p>
      </div>

      <div className="relative z-10 flex flex-col gap-6 w-64">
        <button
          data-testid="start-game"
          onClick={handleStart}
          disabled={starting}
          className="group relative px-6 py-3 bg-transparent border-2 border-[#00ff41] text-[#00ff41] font-bold text-xl uppercase tracking-wider transition-all duration-300 hover:bg-[#00ff41] hover:text-black hover:shadow-[0_0_20px_rgba(0,255,65,0.5)] overflow-hidden disabled:opacity-50"
        >
          <span className="relative z-10">{starting ? '唤醒 Agent...' : '开始游戏'}</span>
          <div className="absolute inset-0 h-full w-0 bg-[#00ff41] transition-all duration-300 ease-out group-hover:w-full -z-0" />
        </button>

        <button
          data-testid="open-settings"
          onClick={() => setAppState('settings')}
          className="group relative px-6 py-3 bg-transparent border-2 border-[#00ff41] text-[#00ff41] font-bold text-xl uppercase tracking-wider transition-all duration-300 hover:bg-[#00ff41] hover:text-black hover:shadow-[0_0_20px_rgba(0,255,65,0.5)] overflow-hidden"
        >
          <span className="relative z-10">设置</span>
          <div className="absolute inset-0 h-full w-0 bg-[#00ff41] transition-all duration-300 ease-out group-hover:w-full -z-0" />
        </button>
      </div>

      <div className="absolute bottom-8 z-10 text-[#00ff41] opacity-40 font-mono text-xs text-center">
        WASD 移动 | 鼠标视角 | F 交互 | 回车短信 | Esc 释放鼠标 | 空格 跳跃<br />
        v1.1.0-qwen
      </div>
    </div>
  );
};

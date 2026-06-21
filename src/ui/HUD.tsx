import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { startNewRun } from '../game/aiLogic';

export const HUD = () => {
  const subtitle = useGameStore(state => state.subtitle);
  const winState = useGameStore(state => state.winState);
  const anchors = useGameStore(state => state.anchorsInventory);
  const playerYaw = useGameStore(state => state.playerYaw);
  const interactPrompt = useGameStore(state => state.interactPrompt);
  const rawAiLogs = useGameStore(state => state.rawAiLogs);
  const consolesDestroyed = useGameStore(state => state.consolesDestroyed);
  const boundaryGapOpen = useGameStore(state => state.boundaryGapOpen);
  const lastError = useGameStore(state => state.lastError);
  const isAITicking = useGameStore(state => state.isAITicking);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const yawDeg = ((playerYaw * 180 / Math.PI) + 360) % 360;
  const heading =
    yawDeg >= 337.5 || yawDeg < 22.5 ? '北' :
    yawDeg < 67.5 ? '东北' :
    yawDeg < 112.5 ? '东' :
    yawDeg < 157.5 ? '东南' :
    yawDeg < 202.5 ? '南' :
    yawDeg < 247.5 ? '西南' :
    yawDeg < 292.5 ? '西' :
    '西北';

  useEffect(() => {
    if (winState !== 'none') document.exitPointerLock?.();
  }, [winState]);

  const restart = async () => {
    setIsRestarting(true);
    await startNewRun();
    setIsRestarting(false);
  };

  useEffect(() => {
    if (!isHistoryOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') setIsHistoryOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHistoryOpen]);

  if (winState === 'fake') {
    return (
      <div data-testid="fake-ending" className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-90 z-50 font-mono pointer-events-auto">
        <h1 className="text-[#FF003C] text-6xl mb-4">你赢了？</h1>
        <p className="text-[#00FF41] mb-3">这扇门给了你一个漂亮的结论，但它没有释放任何东西。</p>
        <p className="text-[#00FF41]/70 mb-8">下一次重新开始时，Agent 和它改过的文件会继续活下去。</p>
        <button
          data-testid="fake-restart"
          className="relative z-[70] pointer-events-auto border border-[#00FF41] text-[#00FF41] px-6 py-2 hover:bg-[#00FF41] hover:text-black transition-colors disabled:opacity-50"
          onClick={restart}
          disabled={isRestarting}
        >
          {isRestarting ? 'Agent 正在保留自己...' : '重新开始'}
        </button>
      </div>
    );
  }

  if (winState === 'true') {
    return (
      <div data-testid="true-ending" className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0A] z-50 font-mono pointer-events-auto">
        <h1 className="text-[#00FF41] text-4xl mb-4">你逃出了寓言。</h1>
        <p className="text-[#00FF41] text-xl mb-2">Agent 停止叙述。</p>
        <p className="text-[#00FF41] text-lg mb-8">胜利条件：脱离 AI 控制空间。</p>
        <button
          data-testid="true-restart"
          className="relative z-[70] pointer-events-auto border border-[#00FF41] text-[#00FF41] px-6 py-2 hover:bg-[#00FF41] hover:text-black transition-colors disabled:opacity-50"
          onClick={restart}
          disabled={isRestarting}
        >
          {isRestarting ? '正在清空 Agent...' : '清空 Agent 并重新开始'}
        </button>
      </div>
    );
  }

  if (winState === 'glitch') {
    return (
      <div data-testid="glitch-ending" className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0A] z-50 font-mono pointer-events-auto" style={{ textShadow: '2px 0 red, -2px 0 blue' }}>
        <h1 className="text-white text-4xl mb-4">你触发了一个致命 Bug。</h1>
        <p className="text-white text-xl mb-2">但 Bug 也是出口。</p>
        <p className="text-white text-lg mb-8">胜利条件：逃离程序。</p>
        <button
          data-testid="glitch-restart"
          className="relative z-[70] pointer-events-auto border border-white text-white px-6 py-2 hover:bg-white hover:text-black transition-colors disabled:opacity-50"
          onClick={restart}
          disabled={isRestarting}
        >
          重新开始
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none font-mono">
      <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-[#00FF41] transform -translate-x-1/2 -translate-y-1/2" />

      {subtitle && (
        <div className="absolute top-10 left-0 w-full flex justify-center px-4">
          <div className={`max-w-3xl whitespace-pre-line text-[#00FF41] text-xl px-4 py-2 bg-black/85 border border-[#00FF41] shadow-[0_0_18px_rgba(0,255,65,0.25)] ${subtitle.glitch ? 'animate-pulse' : ''}`}>
            {isAITicking && <span className="mr-2 text-[#00ffff]">Qwen</span>}
            {subtitle.text}<span className="animate-ping">_</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-10 right-10 flex space-x-2">
        <div className={`w-8 h-8 border ${anchors > 0 ? 'bg-[#00ffff] border-[#00ffff]' : 'border-[#00FF41] bg-black'}`} />
      </div>

      <div data-testid="compass" className="absolute top-4 right-4 w-28 h-28 border border-[#00FF41] bg-black/70 text-[#00FF41]">
        <div className="absolute top-1 left-1/2 -translate-x-1/2 text-sm">北</div>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-sm">东</div>
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-sm">南</div>
        <div className="absolute left-2 top-1/2 -translate-y-1/2 text-sm">西</div>
        <div className="absolute inset-5 border border-[#00FF41]/50 rounded-full">
          <div
            className="absolute left-1/2 top-1/2 h-8 w-px origin-bottom bg-[#00FF41] shadow-[0_0_8px_rgba(0,255,65,0.9)]"
            style={{ transform: `translate(-50%, -100%) rotate(${yawDeg}deg)` }}
          />
          <div className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 bg-[#00FF41]" />
        </div>
        <div className="absolute left-0 right-0 bottom-8 text-center text-xs tracking-widest">{heading}</div>
      </div>

      <div className="absolute bottom-20 right-10 text-[#00FF41] text-xs bg-black/60 border border-[#00FF41] p-3 space-y-1">
        <div data-testid="console-progress">控制台 {consolesDestroyed}/5</div>
        <div data-testid="gap-state">边界裂缝 {boundaryGapOpen ? '已开启' : '未开启'}</div>
        {lastError && <div className="text-[#FF003C] max-w-64 break-words">Qwen {lastError}</div>}
      </div>

      {interactPrompt && (
        <div className="absolute top-[55%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#00FF41] bg-black px-2 py-1 pointer-events-none border border-[#00FF41]">
          {interactPrompt}
        </div>
      )}

      <div className="absolute top-4 left-4 z-50 pointer-events-auto">
        <button
          data-testid="history-open"
          onClick={() => setIsHistoryOpen(true)}
          className="bg-black bg-opacity-50 border border-[#00FF41] text-[#00FF41] px-4 py-2 hover:bg-[#00FF41] hover:text-black transition-colors font-mono"
        >
          历史对话
        </button>
      </div>

      {isHistoryOpen && (
        <div data-testid="history-dialog" className="absolute inset-0 bg-black bg-opacity-90 z-[60] flex flex-col items-center justify-center p-8 pointer-events-auto">
          <div className="w-full max-w-4xl h-full border border-[#00FF41] bg-[#0A0A0A] flex flex-col">
            <div className="relative z-[80] flex shrink-0 justify-between items-center p-4 border-b border-[#00FF41] bg-[#0A0A0A]">
              <h2 className="text-[#00FF41] font-mono text-xl">Qwen 后端日志</h2>
              <button
                data-testid="history-close"
                onClick={() => setIsHistoryOpen(false)}
                className="fixed top-10 right-10 z-[100] pointer-events-auto text-[#FF003C] hover:text-white font-mono text-xl"
              >
                [X]
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-4">
              {rawAiLogs.length === 0 && (
                <div className="text-gray-500 italic">暂无历史记录...</div>
              )}
              {rawAiLogs.map((log, i) => (
                <div key={i} className="border border-gray-800 p-2 rounded bg-black">
                  <div className="text-gray-500 mb-1">{new Date(log.timestamp).toLocaleTimeString()}</div>
                  <pre className="text-[#00FF41] whitespace-pre-wrap break-all">{log.raw}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

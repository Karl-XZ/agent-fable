import { useEffect } from 'react';
import { tickAI } from '../game/aiLogic';
import { useGameStore } from '../store/gameStore';

export const AIManager = () => {
  const narratorIntervalSec = useGameStore(state => state.environment.narratorIntervalSec);
  const gameStarted = useGameStore(state => state.gameStarted);
  const winState = useGameStore(state => state.winState);

  useEffect(() => {
    if (!gameStarted || winState !== 'none') return;
    const timer = setInterval(() => {
      tickAI('narrator');
    }, narratorIntervalSec * 1000);

    return () => clearInterval(timer);
  }, [gameStarted, narratorIntervalSec, winState]);

  return null;
};

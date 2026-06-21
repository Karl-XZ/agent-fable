import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useGameStore } from '../store/gameStore';
import { tickAI } from '../game/aiLogic';

export const Terminal = () => {
  const [input, setInput] = useState('');
  const sendMessage = useGameStore(state => state.sendMessage);
  const cooldown = useGameStore(state => state.messageCooldown);
  const appState = useGameStore(state => state.appState);
  const phoneOpen = useGameStore(state => state.phoneOpen);
  const setPhoneOpen = useGameStore(state => state.setPhoneOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      useGameStore.getState().tickMessageCooldown();
    }, 1000);

    const isTextTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && appState === 'playing' && !isTextTarget(e.target)) {
        e.preventDefault();
        document.exitPointerLock?.();
        setPhoneOpen(true);
      }
      if (e.code === 'Escape' && phoneOpen) setPhoneOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [appState, phoneOpen, setPhoneOpen]);

  useEffect(() => {
    if (!phoneOpen) return;
    document.exitPointerLock?.();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [phoneOpen]);

  const submitMessage = () => {
    if (cooldown > 0 || input.trim().length === 0) return;
    sendMessage(input.trim());
    setInput('');
    setPhoneOpen(false);
    inputRef.current?.blur();
    const canvas = document.querySelector('canvas');
    const pointerLockRequest = canvas?.requestPointerLock?.();
    if (pointerLockRequest instanceof Promise) pointerLockRequest.catch(() => {});
    void tickAI('message');
  };

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    submitMessage();
  };

  return (
    <div className="absolute bottom-10 left-10 pointer-events-auto font-mono">
      <form onSubmit={handleSend} className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2">
          <span className="text-[#00FF41]">&gt;</span>
          <input
            ref={inputRef}
            data-testid="sms-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 20))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitMessage();
              }
            }}
            disabled={cooldown > 0}
            onBlur={() => setPhoneOpen(false)}
            className="bg-black border border-[#00FF41] text-[#00FF41] px-2 py-1 outline-none w-64 disabled:opacity-50"
            placeholder={cooldown > 0 ? `等待... ${cooldown}s` : '按回车开启输入...'}
          />
          <button
            type="submit"
            disabled={cooldown > 0 || input.trim().length === 0}
            className="border border-[#00FF41] text-[#00FF41] px-4 py-1 hover:bg-[#00FF41] hover:text-black disabled:opacity-50 transition-colors"
          >
            发送
          </button>
        </div>
        <div className="text-[#00FF41] text-xs">
          {input.length}/20 {cooldown > 0 && `| COOLDOWN: ${cooldown}s`}
        </div>
      </form>
    </div>
  );
};

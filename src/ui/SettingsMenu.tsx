import { FC } from 'react';
import { useGameStore } from '../store/gameStore';

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
};

const Slider: FC<SliderProps> = ({ label, value, min, max, step, unit = '', onChange }) => (
  <label className="flex flex-col gap-2 text-[#00ff41] font-mono text-sm">
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}{unit}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="accent-[#00ff41]"
    />
  </label>
);

export const SettingsMenu: FC = () => {
  const setAppState = useGameStore(state => state.setAppState);
  const environment = useGameStore(state => state.environment);
  const updateEnvironment = useGameStore(state => state.updateEnvironment);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0A] z-50">
      <div className="text-center mb-12">
        <h2 className="text-4xl font-bold text-[#00ff41] tracking-widest uppercase drop-shadow-[0_0_10px_rgba(0,255,65,0.8)]">
          设置
        </h2>
      </div>

      <div className="w-[min(92vw,520px)] p-8 border border-[#00ff41] bg-[#111111] bg-opacity-80 flex flex-col gap-6 mb-12">
        <Slider
          label="环境光亮度"
          value={environment.ambientIntensity}
          min={0.2}
          max={3}
          step={0.1}
          onChange={(ambientIntensity) => updateEnvironment({ ambientIntensity })}
        />
        <Slider
          label="方向光亮度"
          value={environment.directionalIntensity}
          min={0}
          max={4}
          step={0.1}
          onChange={(directionalIntensity) => updateEnvironment({ directionalIntensity })}
        />
        <Slider
          label="雾效起点"
          value={environment.fogNear}
          min={1}
          max={30}
          step={1}
          onChange={(fogNear) => updateEnvironment({ fogNear: Math.min(fogNear, environment.fogFar - 1) })}
        />
        <Slider
          label="雾效终点"
          value={environment.fogFar}
          min={8}
          max={80}
          step={1}
          onChange={(fogFar) => updateEnvironment({ fogFar: Math.max(fogFar, environment.fogNear + 1) })}
        />
        <Slider
          label="旁白刷新间隔"
          value={environment.narratorIntervalSec}
          min={3}
          max={30}
          step={1}
          unit="s"
          onChange={(narratorIntervalSec) => updateEnvironment({ narratorIntervalSec })}
        />
        <button
          onClick={() => updateEnvironment({
            ambientIntensity: 1.5,
            directionalIntensity: 2,
            fogNear: 5,
            fogFar: 20,
            narratorIntervalSec: 10,
          })}
          className="border border-[#00ff41] text-[#00ff41] px-4 py-2 hover:bg-[#00ff41] hover:text-black transition-colors"
        >
          恢复默认
        </button>
      </div>

      <button
        onClick={() => setAppState('menu')}
        className="px-8 py-3 bg-transparent border-2 border-[#00ff41] text-[#00ff41] font-bold text-lg uppercase tracking-wider transition-all hover:bg-[#00ff41] hover:text-black hover:shadow-[0_0_15px_rgba(0,255,65,0.5)]"
      >
        返回
      </button>
    </div>
  );
};

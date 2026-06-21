import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, DepthOfField } from '@react-three/postprocessing';
import { Map } from '../components/Map';
import { Player } from '../components/Player';
import { DustParticles } from '../components/DustParticles';
import { useGameStore } from '../store/gameStore';

export const Game = () => {
  const initGame = useGameStore(state => state.initGame);
  const environment = useGameStore(state => state.environment);

  useEffect(() => {
    initGame();
  }, [initGame]);

  return (
    <div className="w-screen h-screen bg-[#0A0A0A] overflow-hidden">
      <Canvas shadows camera={{ fov: 75 }}>
        <fog attach="fog" args={['#0A0A0A', environment.fogNear, environment.fogFar]} />
        <ambientLight intensity={environment.ambientIntensity} />
        <directionalLight position={[10, 10, 10]} intensity={environment.directionalIntensity} />
        <Physics gravity={[0, -20, 0]}>
          <Map />
          <Player />
        </Physics>
        <DustParticles />
        <EffectComposer>
          <DepthOfField focusDistance={0} focalLength={0.02} bokehScale={0.5} height={480} />
          <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.9} height={300} intensity={0.2} />
        </EffectComposer>
      </Canvas>
    </div>
  );
};

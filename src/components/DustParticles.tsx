import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export const DustParticles = () => {
  const count = 300;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      temp.push({
        x: (Math.random() - 0.5) * 50,
        y: (Math.random() - 0.5) * 20 + 10,
        z: (Math.random() - 0.5) * 50,
        speedFactor: 0.1 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return temp;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.elapsedTime;
    
    particles.forEach((p, i) => {
      const timeOffset = time * p.speedFactor + p.phase;
      
      const px = p.x + Math.sin(timeOffset * 0.3) * 1.5;
      const py = p.y + Math.cos(timeOffset * 0.2) * 1.0; 
      const pyWrap = py < 0 ? py + 20 : py; 
      const pz = p.z + Math.sin(timeOffset * 0.4) * 1.5;
      
      dummy.position.set(px, pyWrap, pz);
      const scale = 0.02 + Math.sin(timeOffset * 2) * 0.01; 
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.15} depthWrite={false} />
    </instancedMesh>
  );
};

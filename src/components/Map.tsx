import { useMemo, useRef, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { CuboidCollider, RigidBody, RapierRigidBody } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import { BlockType, Block } from '../game/types';
import { EventBus } from '../game/EventBus';
import { playMapRewrite } from '../game/audio';
import * as THREE from 'three';

const getWallTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  
  ctx.fillStyle = '#061209';
  ctx.fillRect(0, 0, 512, 512);
  
  ctx.strokeStyle = '#006b24';
  ctx.lineWidth = 4;
  for(let i = 0; i <= 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  // Sci-fi accents
  ctx.fillStyle = '#00ff41';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(512 - 8, 512 - 8, 8, 8);
  ctx.fillRect(0, 512 - 8, 8, 8);
  ctx.fillRect(512 - 8, 0, 8, 8);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
};

const wallTexture = getWallTexture();

const Particles = () => {
  const particlesRef = useRef<any[]>([]);
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const handleDestroy = (block: any) => {
      const newParticles = Array.from({ length: 40 }).map(() => ({
        x: block.x + (Math.random() - 0.5),
        y: block.y - 0.5 + (Math.random() - 0.5),
        z: block.z + (Math.random() - 0.5),
        vx: (Math.random() - 0.5) * 8,
        vy: Math.random() * 8 + 2,
        vz: (Math.random() - 0.5) * 8,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        rz: Math.random() * Math.PI,
        rvx: (Math.random() - 0.5) * 10,
        rvy: (Math.random() - 0.5) * 10,
        rvz: (Math.random() - 0.5) * 10,
        life: 1.0 + Math.random() * 0.5
      }));
      particlesRef.current.push(...newParticles);
    };
    EventBus.on('destroy-console', handleDestroy);
    return () => EventBus.off('destroy-console', handleDestroy);
  }, []);

  useFrame((_, delta) => {
    if (!instancedMeshRef.current) return;
    
    let aliveParticles = [];
    let idx = 0;
    
    for (let i = 0; i < particlesRef.current.length; i++) {
      const p = particlesRef.current[i];
      p.life -= delta;
      if (p.life > 0) {
        p.vy -= 15 * delta; // gravity
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.z += p.vz * delta;
        
        p.rx += p.rvx * delta;
        p.ry += p.rvy * delta;
        p.rz += p.rvz * delta;
        
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rx, p.ry, p.rz);
        
        const scale = p.life * 0.2; 
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        
        instancedMeshRef.current.setMatrixAt(idx++, dummy.matrix);
        aliveParticles.push(p);
      }
    }
    
    particlesRef.current = aliveParticles;
    instancedMeshRef.current.count = idx;
    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={instancedMeshRef} args={[undefined, undefined, 500]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#ff003c" emissive="#ff003c" emissiveIntensity={2} />
    </instancedMesh>
  );
};

const AIMapRewriteEffects = () => {
  const particlesRef = useRef<any[]>([]);
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const handleMapChange = (payload: any) => {
      const positions = Array.isArray(payload?.positions) ? payload.positions.slice(0, 8) : [];
      if (positions.length === 0) return;
      playMapRewrite();
      for (const position of positions) {
        const baseX = Number(position.x || 0);
        const baseY = Number(position.y || 1) - 0.5;
        const baseZ = Number(position.z || 0);
        for (let i = 0; i < 24; i += 1) {
          particlesRef.current.push({
            x: baseX + (Math.random() - 0.5) * 0.9,
            y: baseY + (Math.random() - 0.5) * 0.9,
            z: baseZ + (Math.random() - 0.5) * 0.9,
            vx: (Math.random() - 0.5) * 2.6,
            vy: (Math.random() - 0.2) * 2.2,
            vz: (Math.random() - 0.5) * 2.6,
            spin: (Math.random() - 0.5) * 12,
            life: 0.9 + Math.random() * 0.45,
            maxLife: 1.35,
          });
        }
      }
      particlesRef.current = particlesRef.current.slice(-160);
    };

    EventBus.on('ai-map-change', handleMapChange);
    return () => EventBus.off('ai-map-change', handleMapChange);
  }, []);

  useFrame((_, delta) => {
    if (!instancedMeshRef.current) return;

    let idx = 0;
    const aliveParticles = [];
    for (const particle of particlesRef.current) {
      particle.life -= delta;
      if (particle.life <= 0) continue;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.z += particle.vz * delta;
      particle.vy += 0.2 * delta;

      const age = 1 - particle.life / particle.maxLife;
      const scale = 0.08 + age * 0.28;
      dummy.position.set(particle.x, particle.y, particle.z);
      dummy.rotation.set(age * particle.spin, age * particle.spin * 0.7, age * particle.spin * 0.3);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      instancedMeshRef.current.setMatrixAt(idx, dummy.matrix);
      idx += 1;
      aliveParticles.push(particle);
    }

    particlesRef.current = aliveParticles;
    instancedMeshRef.current.count = idx;
    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={instancedMeshRef} args={[undefined, undefined, 160]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#00ffff" emissive="#00ff41" emissiveIntensity={3} transparent opacity={0.85} />
    </instancedMesh>
  );
};

const blockColors: Record<BlockType, string> = {
  air: 'transparent',
  floor: '#111111',
  wall: '#003300',
  exit: '#00ff41',
  console: '#ff003c',
  anchor: '#00ffff',
  door: '#ffff00',
  door_open: '#ffff00'
};

const DoorBlock = ({ block }: { block: Block }) => {
  const bodyRef = useRef<RapierRigidBody>(null);
  const targetY = block.type === 'door_open' ? block.y - 1.5 : block.y - 0.5;
  const currentY = useRef(block.y - 0.5);

  useFrame((_, delta) => {
    if (!bodyRef.current) return;
    currentY.current = THREE.MathUtils.lerp(currentY.current, targetY, delta * 5);
    bodyRef.current.setNextKinematicTranslation({ x: block.x, y: currentY.current, z: block.z });
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      position={[block.x, block.y - 0.5, block.z]}
    >
      <group>
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial 
            color="#222222" 
            metalness={0.9} 
            roughness={0.1}
          />
        </mesh>
        <mesh>
          <boxGeometry args={[1.05, 1.05, 1.05]} />
          <meshStandardMaterial 
            color="#ffffff" 
            emissive="#ffffff"
            emissiveIntensity={block.type === 'door_open' ? 0.2 : 1.5}
            wireframe
          />
        </mesh>
      </group>
    </RigidBody>
  );
};

const ConsoleBlock = ({ block }: { block: Block }) => {
  const groupRef = useRef<THREE.Group>(null);
  const scale = useRef(new THREE.Vector3(0, 0, 0));
  
  useFrame((state, delta) => {
    if (groupRef.current) {
      scale.current.lerp(new THREE.Vector3(1, 1, 1), delta * 15);
      groupRef.current.scale.copy(scale.current);
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 2 + block.x * block.z) * 0.15;
      groupRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <RigidBody type="fixed" position={[block.x, block.y - 0.5, block.z]}>
      <group ref={groupRef}>
        <mesh position={[0, -0.25, 0]}>
          <cylinderGeometry args={[0.3, 0.4, 0.5, 8]} />
          <meshStandardMaterial color="#330000" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <octahedronGeometry args={[0.3]} />
          <meshStandardMaterial color="#ff003c" emissive="#ff003c" emissiveIntensity={2} wireframe />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <octahedronGeometry args={[0.25]} />
          <meshStandardMaterial color="#ff003c" emissive="#ff003c" emissiveIntensity={1} />
        </mesh>
      </group>
      <mesh visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </RigidBody>
  );
};

const AnchorBlock = ({ block }: { block: Block }) => {
  const groupRef = useRef<THREE.Group>(null);
  const scale = useRef(new THREE.Vector3(0, 0, 0));
  
  useFrame((_, delta) => {
    if (groupRef.current) {
      scale.current.lerp(new THREE.Vector3(1, 1, 1), delta * 15);
      groupRef.current.scale.copy(scale.current);
      groupRef.current.rotation.y -= delta * 1.5;
    }
  });

  return (
    <RigidBody type="fixed" position={[block.x, block.y - 0.5, block.z]}>
      <group ref={groupRef}>
        <mesh position={[0, -0.4, 0]}>
          <cylinderGeometry args={[0.4, 0.4, 0.2, 8]} />
          <meshStandardMaterial color="#003333" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.1, 0.2, 0.8, 4]} />
          <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={1.5} />
        </mesh>
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.4, 0.02, 16, 32]} />
          <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={2} />
        </mesh>
      </group>
      <mesh visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </RigidBody>
  );
};

const ExitBlock = ({ block }: { block: Block }) => {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta;
      groupRef.current.rotation.z += delta * 0.5;
    }
  });

  return (
    <RigidBody type="fixed" position={[block.x, block.y - 0.5, block.z]}>
      <group ref={groupRef}>
        <mesh>
          <torusKnotGeometry args={[0.4, 0.1, 100, 16]} />
          <meshStandardMaterial color="#00ff41" emissive="#00ff41" emissiveIntensity={2} wireframe />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.3, 32, 32]} />
          <meshStandardMaterial color="#00ff41" emissive="#00ff41" emissiveIntensity={1} transparent opacity={0.8} />
        </mesh>
      </group>
      <mesh visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </RigidBody>
  );
};

const AnimatedBlock = ({ block }: { block: Block }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const scale = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    if (meshRef.current) {
      scale.current.lerp(new THREE.Vector3(1, 1, 1), delta * 15);
      meshRef.current.scale.copy(scale.current);
    }
  });

  return (
    <RigidBody
      type="fixed"
      position={[block.x, block.y - 0.5, block.z]}
      colliders={false}
    >
      <CuboidCollider args={[0.5, 0.5, 0.5]} />
      <mesh ref={meshRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial 
          color={block.type === 'wall' ? '#00ff41' : blockColors[block.type as BlockType]} 
          map={block.type === 'wall' ? wallTexture : null}
          emissive={block.type === 'exit' || block.type === 'console' || block.type === 'anchor' ? blockColors[block.type as BlockType] : (block.type === 'wall' ? '#00ff41' : '#000000')}
          emissiveIntensity={block.type === 'wall' ? 1.4 : 0.5}
          wireframe={block.type === 'wall' || block.type === 'exit'}
        />
      </mesh>
    </RigidBody>
  );
};

const WallInstances = ({ blocks }: { blocks: Block[] }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    blocks.forEach((block, index) => {
      dummy.position.set(block.x, block.y - 0.5, block.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      meshRef.current?.setMatrixAt(index, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [blocks, dummy]);

  if (blocks.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, blocks.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#00ff41"
        emissive="#00ff41"
        emissiveIntensity={0.45}
        map={wallTexture}
      />
    </instancedMesh>
  );
};

export const Map = () => {
  const blocks = useGameStore((state) => state.blocks);

  const blockInstances = useMemo(() => {
    return Object.values(blocks).filter(b => b.type !== 'air');
  }, [blocks]);
  const wallInstances = useMemo(() => blockInstances.filter(block => block.type === 'wall'), [blockInstances]);

  return (
    <>
      <WallInstances blocks={wallInstances} />
      {blockInstances.map((block) => {
        if (block.type === 'console') {
          return <ConsoleBlock key={block.id} block={block} />;
        }
        if (block.type === 'anchor') {
          return <AnchorBlock key={block.id} block={block} />;
        }
        if (block.type === 'exit') {
          return <ExitBlock key={block.id} block={block} />;
        }
        if (block.type.startsWith('door')) {
          return <DoorBlock key={block.id} block={block} />;
        }
        return <AnimatedBlock key={block.id} block={block} />;
      })}
      <Particles />
      <AIMapRewriteEffects />
    </>
  );
};

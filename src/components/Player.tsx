import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { RigidBody, RapierRigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { useGameStore } from '../store/gameStore';
import { initAudio, playDoorOpen, playDoorClose, playDestroy, playJump } from '../game/audio';
import { EventBus } from '../game/EventBus';
import * as THREE from 'three';

const SPEED = 5;
const JUMP_FORCE = 6.2;

export const Player = () => {
  const bodyRef = useRef<RapierRigidBody>(null);
  const setPlayerPos = useGameStore((state) => state.setPlayerPos);
  const setPlayerYaw = useGameStore((state) => state.setPlayerYaw);
  const placeAnchor = useGameStore((state) => state.placeAnchor);
  const destroyConsole = useGameStore((state) => state.destroyConsole);
  const pickupAnchor = useGameStore((state) => state.pickupAnchor);
  const setWinState = useGameStore((state) => state.setWinState);
  const appState = useGameStore((state) => state.appState);
  const phoneOpen = useGameStore((state) => state.phoneOpen);
  
  const { camera } = useThree();
  const { rapier, world } = useRapier();
  const keys = useRef<{ [key: string]: boolean }>({});
  const headBobTimer = useRef(0);
  const bobOffset = useRef(0);
  const initialViewSet = useRef(false);

  useEffect(() => {
    const isTextTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        document.exitPointerLock?.();
        return;
      }
      if (isTextTarget(e.target)) return;
      keys.current[e.code] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const handleMouseDown = async () => {
      await initAudio();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  useFrame((_, delta) => {

    if (!bodyRef.current) return;

    const velocity = bodyRef.current.linvel();
    const pos = bodyRef.current.translation();
    
    // Sync pos to store every frame
    setPlayerPos([pos.x, pos.y, pos.z]);

    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (speed > 0.1 && Math.abs(velocity.y) < 0.1) {
      headBobTimer.current += delta * 12;
    }
    const targetBob = (speed > 0.1 && Math.abs(velocity.y) < 0.1) ? Math.sin(headBobTimer.current) * 0.06 : 0;
    bobOffset.current = THREE.MathUtils.lerp(bobOffset.current, targetBob, delta * 10);

    camera.position.set(pos.x, pos.y + 0.6 + bobOffset.current, pos.z);
    if (!initialViewSet.current && appState === 'playing') {
      camera.lookAt(pos.x, pos.y - 1.4, pos.z - 7);
      initialViewSet.current = true;
    }
    const heading = new THREE.Vector3();
    camera.getWorldDirection(heading);
    setPlayerYaw(Math.atan2(heading.x, -heading.z));

    let targetAction: (() => void) | null = null;
    let promptMsg: string | null = null;

    if (document.pointerLockElement) {
      // Interaction Raycast
      const rayDirection = new THREE.Vector3();
      camera.getWorldDirection(rayDirection);
      const ray = new rapier.Ray(camera.position, rayDirection);
      const hit = world.castRay(ray, 3.0, true);
      
      let targetBlock: any = null;
      if (hit) {
        const toi = (hit as any).toi ?? (hit as any).timeOfImpact ?? 1;
        const hitPoint = ray.pointAt(toi);
        const x = Math.round(hitPoint.x);
        const y = Math.round(hitPoint.y);
        const z = Math.round(hitPoint.z);
        const blocks = useGameStore.getState().blocks;
        
        let minDist = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const id = `${x+dx},${y+dy},${z+dz}`;
              const b = blocks[id];
              if (b) {
                // block visual center is at y - 0.5
                const dist = Math.sqrt(Math.pow(b.x - hitPoint.x, 2) + Math.pow(b.y - 0.5 - hitPoint.y, 2) + Math.pow(b.z - hitPoint.z, 2));
                if (dist < 1.5 && dist < minDist) {
                  minDist = dist;
                  targetBlock = b;
                }
              }
            }
          }
        }
        
        if (targetBlock) {
          if (targetBlock.type === 'console') {
            targetAction = () => { destroyConsole(targetBlock.id); EventBus.emit('destroy-console', targetBlock); playDestroy(); };
            promptMsg = '按F破坏控制台';
          } else if (targetBlock.type === 'anchor') {
            targetAction = () => pickupAnchor(targetBlock.id);
            promptMsg = '按F拾取锚定桩';
          } else if (targetBlock.type === 'exit') {
            targetAction = () => setWinState('fake');
            promptMsg = '按F进入出口';
          } else if (targetBlock.type === 'door' || targetBlock.type === 'door_open') {
            targetAction = () => { 
                useGameStore.getState().toggleDoor(targetBlock.id);
                if (targetBlock.type === 'door') playDoorOpen();
                else playDoorClose();
            };
            promptMsg = targetBlock.type === 'door' ? '按F开门' : '按F关门';
          }
        }
      }

      if (!targetBlock && useGameStore.getState().anchorsInventory > 0) {
        const placePos = new THREE.Vector3();
        camera.getWorldDirection(placePos);
        placePos.multiplyScalar(2).add(camera.position);
        targetAction = () => placeAnchor([placePos.x, placePos.y, placePos.z]);
        promptMsg = '按F放置锚定桩';
      }
    }

    useGameStore.getState().setInteractPrompt(promptMsg);

    if (keys.current['KeyF'] && targetAction && !keys.current['f_processed']) {
      targetAction();
      keys.current['f_processed'] = true;
    } else if (!keys.current['KeyF']) {
      keys.current['f_processed'] = false;
    }

    if (!document.pointerLockElement || phoneOpen) return;

    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const forwardInput = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0);
    const rightInput = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0);
    const currentSpeed = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? SPEED * 1.5 : SPEED;

    direction
      .addScaledVector(forward, forwardInput)
      .addScaledVector(right, rightInput)
      .normalize()
      .multiplyScalar(currentSpeed);

    bodyRef.current.setLinvel({ x: direction.x, y: velocity.y, z: direction.z }, true);

    if (keys.current['Space'] && Math.abs(velocity.y) < 0.1 && !keys.current['jump_processed']) {
      bodyRef.current.setLinvel({ x: velocity.x, y: JUMP_FORCE, z: velocity.z }, true);
      playJump();
      keys.current['jump_processed'] = true;
    } else if (!keys.current['Space']) {
      keys.current['jump_processed'] = false;
    }

    // Check collision with exit
    const px = Math.round(pos.x);
    const pz = Math.round(pos.z);
    const blocks = useGameStore.getState().blocks;
    for (let y = -1; y <= 5; y++) {
      const b = blocks[`${px},${y},${pz}`];
      if (b && b.type === 'exit') {
        if (useGameStore.getState().winState === 'none') {
          useGameStore.getState().setWinState('fake');
        }
      }
    }
  });

  return (
    <>
      {appState === 'playing' && <PointerLockControls />}
      <RigidBody ref={bodyRef} colliders={false} mass={1} type="dynamic" position={[0, 1.2, 0]} enabledRotations={[false, false, false]}>
        <CapsuleCollider args={[0.3, 0.3]} />
      </RigidBody>
    </>
  );
};

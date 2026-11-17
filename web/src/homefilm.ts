import * as THREE from 'three';
import story from '../../story.json';

export type HomeFilmKind = 'intro' | 'memory';
export function homeFilmDuration(kind: HomeFilmKind) { return story.films[kind].reduce((sum, beat) => sum + beat.seconds * 1000, 0); }
export function nextHomeFilmTime(kind: HomeFilmKind, milliseconds: number) {
  const frame = homeFilmFrame(kind, milliseconds);
  return story.films[kind].slice(0, frame.index + 1).reduce((sum, beat) => sum + beat.seconds * 1000, 0);
}

const SHOTS: Record<string, { position: number[]; target: number[] }> = {
  wide: { position: [3.1, 1.65, 3.7], target: [-0.5, 1.1, -1.9] },
  table: { position: [1.7, 1.55, 0.9], target: [1.8, 0.78, -1.1] },
  bed: { position: [-0.3, 1.7, 0.6], target: [-2.1, 0.65, -2.6] },
  window: { position: [0.4, 1.6, 0.1], target: [1.6, 2, -4.7] },
  door: { position: [-0.8, 1.6, 0.5], target: [-5, 1.4, 1.5] },
  depart: { position: [-0.5, 1.58, 1.5], target: [-7, 1.58, 1.5] },
  entry: { position: [-6.8, 1.65, 1.5], target: [0, 1.4, -1] },
  rest: { position: [-2.1, 1.02, -3.4], target: [-2.1, 2, -4.8] },
};

const DAILY_LIFE = [
  { activity: 'breakfast', seconds: 9, from: [35.2, 1.2, 6.2], to: [35.4, 1.2, 6], target: [36.8, .9, 4.85] },
  { activity: 'walk', seconds: 12, from: [28.5, 1.58, 8.4], to: [28.5, 1.58, 18.5], target: [28.5, 1.58, 22] },
  { activity: 'atrium', seconds: 10, from: [23.5, 1.58, 17.5], to: [23.2, 1.58, 16.8], target: [20, 3, 12] },
  { activity: 'gallery', seconds: 10, from: [5, 1.58, 25.6], to: [5.5, 1.58, 25.6], target: [7, 1.2, 23.6] },
  { activity: 'rest', seconds: 9, from: [36.7, 1.12, 9.3], to: [36.7, 1.15, 9.3], target: [33.3, 1.3, 4.8] },
  { activity: 'sleep', seconds: 10, from: [32.9, 1.02, 2.6], to: [32.9, 1.02, 2.6], target: [33, 2.7, 7] },
];
export const DAILY_LIFE_SECONDS = DAILY_LIFE.reduce((sum, shot) => sum + shot.seconds, 0);
export function dailyLifeFrame(seconds: number) {
  let time = (Math.max(0, seconds) % DAILY_LIFE_SECONDS);
  let shot = DAILY_LIFE[0];
  for (const candidate of DAILY_LIFE) { shot = candidate; if (time < candidate.seconds) break; time -= candidate.seconds; }
  const progress = time / shot.seconds;
  const position = shot.from.map((p, i) => p + (shot.to[i] - p) * progress);
  position[1] += Math.sin(time * (shot.activity === 'walk' ? 5 : 1.2)) * (shot.activity === 'walk' ? .016 : .005);
  return { activity: shot.activity, position, target: shot.target, night: shot.activity === 'sleep', mealProgress: shot.activity === 'breakfast' ? progress : 0,
    fade: Math.max(0, 1 - Math.min(time, shot.seconds - time) / .65), text: '' };
}

export function homeFilmFrame(kind: HomeFilmKind, milliseconds: number) {
  const total = homeFilmDuration(kind), time = Math.max(0, Math.min(total, milliseconds));
  const beats = story.films[kind];
  let start = 0, index = beats.length - 1;
  for (let i = 0; i < beats.length; i++) {
    if (time < start + beats[i].seconds * 1000 || i === beats.length - 1) { index = i; break; }
    start += beats[i].seconds * 1000;
  }
  const beat = beats[index], progress = Math.max(0, Math.min(1, (time - start) / (beat.seconds * 1000)));
  const shot = SHOTS[beat.shot], position = [...shot.position], target = [...shot.target];
  if (beat.shot === 'entry') position[0] += 4.6 * progress;
  else if (beat.shot === 'depart') position[0] -= 2 * progress;
  else position[0] += 0.12 * progress;
  const hesitation = kind === 'memory' && index === 2 ? Math.sin(progress * Math.PI) : 0;
  if (kind === 'memory' && index === 2) {
    const turn = progress * Math.PI / 2;
    target[0] = position[0] - Math.cos(turn) * 4; target[1] = 1.45; target[2] = position[2] - Math.sin(turn) * 4;
  }
  const mealProgress = kind === 'memory' ? index > 5 ? 1 : index === 5 ? progress : 0 : 0;
  const closingEyes = kind === 'memory' && index === beats.length - 1 ? Math.max(0, (progress - 0.6) / 0.4) : 0;
  const edge = Math.min(progress, 1 - progress) * beat.seconds;
  return { index, beat, position, target, night: beat.night, doorOpen: beat.shot === 'entry' ? 1 : beat.shot === 'depart' ? progress : 0, fade: Math.max(Math.max(0, (0.25 - edge) / 0.25) * 0.35, closingEyes), done: time >= total, hesitation, mealProgress, closingEyes,
    text: beat.text, speaker: beat.who, audio: beat.audio };
}

export function buildCareHome(materials: Record<string, THREE.Material>) {
  const home = new THREE.Group(); home.name = 'care-home';
  const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const fabric = materials.fabric, cream = materials.plaster, wood = materials.wood, dark = materials.dark;
  const box = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material); mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; home.add(mesh); return mesh;
  };
  // Architecture, floor, door and lighting belong to the actual voxel room.
  box('bed-base', -2.1, 0.24, -2.65, 2.25, 0.48, 3.4, wood);
  box('mattress', -2.1, 0.58, -2.65, 2.2, 0.25, 3.35, cream);
  box('blanket', -2.1, 0.75, -2.2, 2.24, 0.13, 2.35, fabric);
  box('pillow', -2.1, 0.82, -3.75, 1.45, 0.22, 0.65, cream);
  box('bedside-table', -3.4, 0.36, -3.65, 0.55, 0.72, 0.65, wood);
  const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.32, 20), cream); lamp.position.set(-3.4, 1.25, -3.65); home.add(lamp);
  box('lamp-stem', -3.4, 0.92, -3.65, 0.035, 0.4, 0.035, dark);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.09, 36), wood); table.name = 'breakfast-table'; table.position.set(1.8, 0.8, -1.15); home.add(table);
  box('table-leg', 1.8, 0.4, -1.15, 0.12, 0.8, 0.12, wood);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 32), cream); plate.name = 'breakfast-plate'; plate.position.set(1.65, 0.86, -1.1); home.add(plate);
  box('toast', 1.65, 0.9, -1.1, 0.32, 0.07, 0.25, mat('#bd8a4c'));
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.19, 20), cream); cup.name = 'warm-tea'; cup.position.set(2.15, 0.94, -1.25); home.add(cup);
  const steamMaterial = new THREE.MeshBasicMaterial({ color: '#f5edda', transparent: true, opacity: 0.14, depthWrite: false });
  for (let i = 0; i < 3; i++) { const steam = new THREE.Mesh(new THREE.SphereGeometry(0.04 + i * 0.025, 8, 6), steamMaterial); steam.position.set(2.15 + i * 0.035, 1.15 + i * 0.12, -1.25); home.add(steam); }
  box('window-chair-seat', 1.8, 0.48, 0.15, 0.65, 0.12, 0.65, fabric);
  box('window-chair-back', 1.8, 0.88, 0.43, 0.65, 0.8, 0.1, fabric);
  for (const x of [1.55, 2.05]) for (const z of [-0.1, 0.4]) box('chair-leg', x, 0.22, z, 0.06, 0.44, 0.06, wood);
  box('sofa', 1.7, 0.45, 3.4, 2.3, 0.65, 1, fabric); box('sofa-back', 1.7, 0.92, 3.82, 2.3, 0.8, 0.18, fabric);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: '#9daaa9', roughness: .6, emissive: '#f4c690', emissiveIntensity: .85 });
  box('soft-window', 1.65, 2, -4.9, 2.65, 1.9, 0.025, windowMaterial);
  for (const x of [0.27, 1.65, 3.03]) box('window-frame', x, 2, -4.84, 0.07, 2.06, 0.08, materials.steel);
  box('window-sill', 1.65, 1.02, -4.76, 2.95, 0.1, 0.34, materials.steel);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.4, 16), mat('#9e7861')); pot.position.set(3.35, 0.2, -3.5); home.add(pot);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.44, 1), new THREE.MeshStandardMaterial({ color: '#5d7a4a', roughness: 0.85, flatShading: true })); leaves.scale.y = 1.5; leaves.position.set(3.35, 0.95, -3.5); home.add(leaves);
  return home;
}

export function placePlayableHome(home: THREE.Group) {
  home.position.set(35, 0, 6);
  home.updateMatrixWorld(true);
  return home;
}

export function homeColliders(home: THREE.Group) {
  const solid = new Set(['bed-base', 'mattress', 'bedside-table', 'breakfast-table', 'table-leg', 'window-chair-seat', 'window-chair-back', 'sofa', 'sofa-back', 'window-sill']);
  const boxes: { min: [number, number, number]; max: [number, number, number]; tag: string }[] = [];
  home.updateMatrixWorld(true);
  home.traverse(object => {
    if (!solid.has(object.name)) return;
    const box = new THREE.Box3().setFromObject(object);
    boxes.push({ min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number], tag: 'home' });
  });
  return boxes;
}

export function poseCareHome(home: THREE.Group, frame: ReturnType<typeof homeFilmFrame>) {
  const pane = (home.getObjectByName('soft-window') as THREE.Mesh).material as THREE.MeshStandardMaterial;
  pane.color.set(frame.night ? '#1c2529' : '#9daaa9'); pane.emissiveIntensity = frame.night ? 0.05 : 0.85;
}

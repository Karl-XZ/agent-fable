import * as THREE from 'three';
import { Grid, NX, NZ, M, SOLID, iyOf } from './level';

export function buildSandboxModel(grid: Grid) {
  const group = new THREE.Group(); group.name = 'building-sandbox'; group.position.set(7, .86, 23.6);
  const s = .075, plateGeometry = new THREE.BoxGeometry(NX * s, .02, NZ * s);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: '#898b89', roughness: .95 });
  for (let i = 0; i < 4; i++) {
    const plate = new THREE.Mesh(plateGeometry, plateMaterial); plate.name = 'sandbox-floor';
    plate.position.y = .05 + i * .24; group.add(plate);
  }
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(s, .07, s), new THREE.MeshStandardMaterial({ roughness: .8 }), 6000);
  blocks.name = 'sandbox-buildings'; group.add(blocks);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#F2B66D').multiplyScalar(3), toneMapped: false }));
  group.add(dot);
  refreshSandboxModel(grid, blocks);
  return { group, blocks, dot };
}

export function refreshSandboxModel(grid: Grid, blocks: THREE.InstancedMesh) {
  const s = .075, matrix = new THREE.Matrix4(), color = new THREE.Color(); let count = 0;
  [-4, 0, 4, 8].forEach((fy, floor) => {
    const iy = iyOf(fy + .5);
    for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
      const value = grid.get(x, iy, z), original = grid.orig[grid.idx(x, iy, z)];
      let tint: string | null = null;
      if (SOLID(value) && value !== M.Fill && value !== M.Roof) tint = value === M.Glass ? '#8fc0ea' : SOLID(original) ? '#f2efe9' : '#5aa8ff';
      else if (!SOLID(value) && SOLID(original) && (original === M.Outer || original === M.Glass)) tint = '#e0443a';
      if (!tint) continue;
      matrix.makeTranslation((x - NX / 2 + .5) * s, .1 + floor * .24, (z - NZ / 2 + .5) * s);
      blocks.setMatrixAt(count, matrix); blocks.setColorAt(count, color.set(tint)); count++;
    }
  });
  blocks.count = count; blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  blocks.computeBoundingBox(); blocks.computeBoundingSphere();
}

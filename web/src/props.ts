import * as THREE from 'three';
import { World, AABB, Inter, Item } from './world';
import { ROOMS, floorById } from './level';
import * as TX from './textures';
import story from '../../story.json';

// 空间位置保持不变，文案由 story.json 统一维护。
const NOTE_LOCATIONS = [
  { id: 'N1', room: '101', x: 22.6, y: 0.95, z: 21.2 },
  { id: 'N2', room: '103', x: 2.2, y: 0.9, z: 6.4 },
  { id: 'N3', room: '1W', x: 12.6, y: 0.05, z: 2.2 },
  { id: 'N4', room: '201', x: 4.6, y: 0.85, z: 10.6 },
  { id: 'N5', room: '206', x: 34.6, y: 0.95, z: 1.6 },
  { id: 'N6', room: '1S', x: 31.4, y: 0.05, z: 19.2 },
  { id: 'N7', room: '105', x: 12.4, y: 0.9, z: 19.2 },
  { id: 'N8', room: '209', x: 24.5, y: 0.5, z: 25.6 },
  { id: 'N9', room: 'C2', x: 28.5, y: -3.95, z: 12.6 },
  { id: 'N10', room: 'C4', x: 34.5, y: -3.95, z: 12.6 },
  { id: 'N11', room: 'C6', x: 36.5, y: -3.95, z: 2.4 },
  { id: 'N12', room: '208', x: 33.5, y: 4.05, z: 20.6 },
  { id: 'N13', room: '107', x: 4.5, y: 0.9, z: 21.4 },
  { id: 'N14', room: '110', x: 36.8, y: 0.86, z: 4.9 },
];
export const NOTES = NOTE_LOCATIONS.map(location => ({ ...location, ...(story.notes as Record<string, { title: string; text: string[] }>)[location.id] }));

const CAM_OFF = 1.15;
export interface CamDef { room: string; pos: THREE.Vector3; mesh: THREE.Object3D }

export function buildProps(w: World) {
  const cams: CamDef[] = [];
  const add = (m: THREE.Object3D) => { w.scene.add(m); return m; };
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, col = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y + sy / 2, z); m.castShadow = false; m.receiveShadow = true; add(m);
    if (col) w.props.push({ min: [x - sx / 2, y, z - sz / 2], max: [x + sx / 2, y + sy, z + sz / 2], tag: 'prop' });
    return m;
  };
  const inter = (o: Partial<Inter> & { id: string; kind: string; label: string; pos: THREE.Vector3 }) => { const it: Inter = { radius: 1.8, enabled: true, ...o } as Inter; w.inters.push(it); return it; };
  const desk = (x: number, y: number, z: number, rot = 0, sx = 1.6, sz = 0.8) => {
    const g = new THREE.Group(); const top = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.05, sz), w.mats.wood); top.position.y = 0.74; g.add(top);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.04), w.mats.steel); l.position.set(a * (sx / 2 - 0.05), 0.36, b * (sz / 2 - 0.05)); g.add(l); }
    g.position.set(x, y, z); g.rotation.y = rot; add(g);
    const hx = rot % Math.PI === 0 ? sx / 2 : sz / 2, hz = rot % Math.PI === 0 ? sz / 2 : sx / 2;
    w.props.push({ min: [x - hx, y, z - hz], max: [x + hx, y + 0.77, z + hz], tag: 'prop' }); return g;
  };
  const chair = (x: number, y: number, z: number, rot = 0) => {
    const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.45), w.mats.fabric); s.position.y = 0.46; g.add(s);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), w.mats.fabric); b.position.set(0, 0.74, -0.2); g.add(b);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), w.mats.steel); p.position.y = 0.22; g.add(p);
    g.position.set(x, y, z); g.rotation.y = rot; add(g); return g;
  };
  const sofa = (x: number, y: number, z: number, rot = 0, len = 2.2, mat = w.mats.fabricWarm) => {
    const g = new THREE.Group(); const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.42, 0.9), mat); seat.position.y = 0.21; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.2), mat); back.position.set(0, 0.62, -0.35); g.add(back);
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.9), mat); arm.position.set(s * (len / 2 - 0.1), 0.55, 0); g.add(arm); }
    g.position.set(x, y, z); g.rotation.y = rot; add(g);
    const along = Math.abs(Math.sin(rot)) < 0.5; const hx = along ? len / 2 : 0.45, hz = along ? 0.45 : len / 2;
    w.props.push({ min: [x - hx, y, z - hz], max: [x + hx, y + 0.42, z + hz], tag: 'prop' });
    return g;
  };
  const plant = (x: number, y: number, z: number, s = 1) => {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.17 * s, 0.4 * s, 12), w.mats.dark); pot.position.set(x, y + 0.2 * s, z); add(pot);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.28 * s, 10, 8), w.mats.plant); f.position.set(x + (Math.random() - 0.5) * 0.25 * s, y + (0.6 + i * 0.22) * s, z + (Math.random() - 0.5) * 0.25 * s); f.scale.y = 1.3; add(f); }
    w.props.push({ min: [x - 0.22 * s, y, z - 0.22 * s], max: [x + 0.22 * s, y + 0.4 * s, z + 0.22 * s], tag: 'prop' });
  };
  const shelf = (x: number, y: number, z: number, sx: number, sz: number, h = 2) => {
    const g = new THREE.Group(); const frame = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), w.mats.steel); frame.position.y = h / 2; g.add(frame);
    for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.95, 0.28, sz * 1.02), new THREE.MeshStandardMaterial({ color: ['#6b5a48', '#3f4a52', '#7a6a50', '#55483a'][i], roughness: 0.9 })); r.position.y = 0.3 + i * 0.45; g.add(r); }
    g.position.set(x, y, z); add(g); w.props.push({ min: [x - sx / 2, y, z - sz / 2], max: [x + sx / 2, y + h, z + sz / 2], tag: 'prop' }); return g;
  };
  const screenMesh = (tex: THREE.Texture, x: number, y: number, z: number, rot: number, sw = 0.55, sh = 0.34) => {
    const g = new THREE.Group(); const bez = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.04, sh + 0.04, 0.03), w.mats.dark); g.add(bez);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); scr.position.z = 0.017; g.add(scr);
    g.position.set(x, y, z); g.rotation.y = rot; add(g); return { g, scr };
  };

  // —— 摄像头 ——
  for (const r of ROOMS) {
    if (!r.cam) continue; const y = floorById(r.floor)!.y;
    const px = r.x0 + CAM_OFF, pz = r.z0 + CAM_OFF, py = y + 2.72;
    const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.24), new THREE.MeshStandardMaterial({ color: '#d8d4cc', roughness: 0.5 })); g.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12), w.mats.dark); lens.rotation.x = Math.PI / 2; lens.position.z = 0.13; g.add(lens);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3030').multiplyScalar(3), toneMapped: false })); led.position.set(0.05, 0.03, 0.12); g.add(led); g.userData.led = led;
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.2), w.mats.paper); cover.position.z = 0.16; cover.visible = false; g.add(cover); g.userData.cover = cover;
    g.position.set(px, py, pz); g.lookAt(roomCx(r), y + 1, roomCz(r)); add(g);
    cams.push({ room: r.id, pos: g.position.clone(), mesh: g });
    inter({ id: `CAM_${r.id}`, kind: 'camera', label: '摄像头', pos: g.position.clone(), radius: 2.6, room: r.id, data: { room: r.id } });
  }

  // —— 1F 大堂 101 ——
  box(20, 0, 21.4, 4.2, 1.05, 0.8, w.mats.wood); // 前台
  box(20, 1.05, 21.4, 4.3, 0.04, 0.9, w.mats.steel, false);
  const phone = box(21.6, 1.09, 21.3, 0.22, 0.08, 0.16, w.mats.dark, false);
  inter({ id: 'PHONE', kind: 'phone', label: '前台电话', pos: phone.position.clone(), room: '101' });
  sofa(16.5, 0, 24.5, Math.PI / 2, 2.2, w.mats.fabric); sofa(24, 0, 24.5, -Math.PI / 2, 2.2, w.mats.fabric);
  inter({ id: 'SOFA_101A', kind: 'sofa', label: '沙发', pos: new THREE.Vector3(16.5, 0.4, 24.5), room: '101' });
  plant(15.6, 0, 20.6, 1.3); plant(25.2, 0, 25.2, 1.3); plant(15.6, 0, 26.2, 1.1);
  // 旋转门（视觉）+ 门外街景
  const rev = new THREE.Group(); const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 32, 1, true, 0, Math.PI), w.mats.glass); drum.rotation.y = Math.PI / 2; rev.add(drum);
  const wings = new THREE.Group(); for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.3, 0.04), w.mats.glass); p.position.x = 0.62; const holder = new THREE.Group(); holder.rotation.y = i * Math.PI / 2; holder.add(p); wings.add(holder); }
  rev.add(wings); const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.12, 32), w.mats.steel); cap.position.y = 1.2; rev.add(cap);
  rev.position.set(20.5, 1.2, 26.7); add(rev); rev.userData.wings = wings;
  const street = TX.textPanel([], { w: 512, h: 512, bg: '#0b0d12' }); const sctx = (street.image as HTMLCanvasElement).getContext('2d')!; drawStreet(sctx);
  street.needsUpdate = true;
  const streetPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.4), new THREE.MeshBasicMaterial({ map: street, toneMapped: false, color: '#9a9a9a' })); streetPlane.position.set(20.5, 1.2, 26.99); streetPlane.rotation.y = Math.PI; add(streetPlane);
  w.props.push({ min: [19.2, 0, 26.0], max: [21.8, 2.4, 27], tag: 'prop' });
  inter({ id: 'REVOLVING', kind: 'revolving', label: '旋转门', pos: new THREE.Vector3(20.5, 1.2, 25.9), radius: 2.0, room: '101', data: { rev, streetPlane, street } });

  // —— 103 仓储 ——
  shelf(1.6, 0, 1.4, 1.4, 0.6); shelf(4.4, 0, 1.4, 1.4, 0.6);
  // 箱子（全楼 4 个，加上 AI 生成的）
  w.addBox(3.2, 0, 4.2); w.addBox(4.4, 0, 5.6); w.addBox(2.4, 0, 6.6); w.addBox(5.8, 0, 3.6);

  // —— 104 设备间 ——
  const breaker = box(1.12, 1.0, 11.2, 0.2, 0.9, 0.7, new THREE.MeshStandardMaterial({ color: '#5a5f63', roughness: 0.5, metalness: 0.6 }), false);
  inter({ id: 'BREAKER', kind: 'breaker', label: '配电箱总闸', pos: breaker.position.clone(), room: '104' });
  const valve = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 8, 20), new THREE.MeshStandardMaterial({ color: '#b23a2a', roughness: 0.5 })); valve.position.set(6.2, 1.2, 9.12); add(valve);
  box(6.2, 0, 9.2, 0.12, 2.9, 0.12, new THREE.MeshStandardMaterial({ color: '#b23a2a', roughness: 0.5 }), false);
  inter({ id: 'VALVE', kind: 'valve', label: '消防喂水阀', pos: valve.position.clone(), room: '104' });
  shelf(4.5, 0, 13.2, 2.2, 0.5, 1.6);

  // —— 105 电梯间：按钮面板由电梯轿厢提供 ——
  plant(12.6, 0, 15.4, 1.0);

  // —— 106 洗手间：镜子、洗手台、隔间 ——
  box(1.35, 0, 16.5, 0.6, 0.85, 2.2, w.mats.plaster);
  const stallBoxes: AABB[] = [{ min: [3, 0, 14.95], max: [3.05, 2.1, 17.2] }, { min: [3, 0, 17.15], max: [4.2, 2.1, 17.2] }];
  w.addStruct('stall', stallBoxes, { id: 'STALL', label: '隔间', mat: w.mats.plaster });
  const stallDoor = w.addStruct('stalldoor', [{ min: [4.2, 0, 17.15], max: [5.95, 2.1, 17.2] }], { id: 'STALL_DOOR', label: '隔间门', mat: w.mats.plaster });
  stallDoor.boxes = []; stallDoor.group.visible = false;
  inter({ id: 'STALL', kind: 'stall', label: '隔间门', pos: new THREE.Vector3(5, 1, 17.4), room: '106' });

  // —— 107 展厅：沙盘 ——
  const table = box(7, 0, 23.6, 4.4, 0.85, 3.2, w.mats.dark);
  table.name = 'sandbox-plinth';
  const caseGeometry = new THREE.BoxGeometry(4.3, 0.9, 3.1);
  // 玻璃罩下口敞开，避免底面与台面共面，随视角变化发生深度争用。
  const caseNormals = caseGeometry.getAttribute('normal');
  caseGeometry.setIndex(Array.from(caseGeometry.getIndex()!.array).filter(index => caseNormals.getY(index) > -0.5));
  caseGeometry.clearGroups();
  const glassCase = new THREE.Mesh(caseGeometry, w.mats.glass); glassCase.name = 'sandbox-cover'; glassCase.position.set(7, 1.3, 23.6); glassCase.renderOrder = 2; add(glassCase);
  inter({ id: 'SANDBOX', kind: 'sandbox', label: '建筑沙盘模型', pos: new THREE.Vector3(7, 1.0, 23.6), radius: 2.8, room: '107', mesh: table });
  for (const x of [1.6, 12.4]) for (const z of [21.2, 26]) plant(x, 0, z, 0.9);

  // —— 108 假门 ——
  const fd = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 1.5), w.mats.steel); frame.position.set(38.92, 1.25, 24.6); fd.add(frame);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.2), w.mats.white); light.position.set(38.8, 1.12, 24.6); light.rotation.y = -Math.PI / 2; fd.add(light);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.36), new THREE.MeshBasicMaterial({ map: TX.signTexture('出口', '→'), toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) })); sign.position.set(38.95 - 0.06, 2.6, 24.6); sign.rotation.y = -Math.PI / 2; fd.add(sign);
  add(fd);
  const fl = new THREE.PointLight('#e8fff4', 6, 10, 1.6); fl.position.set(37.8, 1.6, 24.6); add(fl);

  // The opening home supplies this room's furniture and collision boxes.
  inter({ id: 'SOFA_110', kind: 'sofa', label: '沙发', pos: new THREE.Vector3(36.7, 0.78, 9.4), room: '110' });

  // —— 1F 中庭：一棵树 ——
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 4.5, 8), w.mats.dark); trunk.position.set(21, 2.25, 12.5); add(trunk);
  for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), w.mats.plant); f.position.set(21 + (Math.random() - 0.5) * 1.8, 4.2 + Math.random() * 1.6, 12.5 + (Math.random() - 0.5) * 1.8); add(f); }
  box(21, 0, 12.5, 2.2, 0.45, 2.2, w.mats.wall);

  // —— 2F 201 开放办公 ——
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const x = 3 + i * 3.6, z = 3.4 + j * 3.4; desk(x, 4, z); chair(x, 4, z + 0.8, Math.PI); const tex = TX.screenTexture(['>_'], { w: 256, h: 160 }); screenMesh(tex, x, 4.98, z - 0.2, 0, 0.5, 0.3); }
  const prevScreen = TX.screenTexture(['（黑屏）'], { w: 512, h: 320 }); const ps = screenMesh(prevScreen, 3 + 3.6 * 0, 4.98, 10.2 - 0.2 + 0, 0, 0.5, 0.3);
  inter({ id: 'PREV_DESK', kind: 'sitdesk', label: '之前的住户的工位（坐下）', pos: new THREE.Vector3(3, 4.5, 11), room: '201', data: { scr: ps.scr } });
  const printer = box(12.4, 4, 2.2, 0.7, 0.9, 0.6, new THREE.MeshStandardMaterial({ color: '#d4d0c8', roughness: 0.6 }));
  inter({ id: 'PRINTER', kind: 'printer', label: '打印机', pos: new THREE.Vector3(12.4, 4.9, 2.2), room: '201' });
  plant(1.6, 4, 12.6, 1.1);

  // —— 202 会议室 ——
  box(3, 4, 17.6, 1.6, 0.76, 4.2, w.mats.wood);
  for (const z of [16.2, 17.6, 19]) { chair(1.9, 4, z, Math.PI / 2); chair(4.1, 4, z, -Math.PI / 2); }
  chair(3, 4, 20.3, Math.PI);
  inter({ id: 'HEAD_CHAIR', kind: 'sitmeeting', label: '主位（坐下）', pos: new THREE.Vector3(3, 4.5, 20.3), room: '202' });
  const wb = TX.whiteboardCanvas(); const wbTex = new THREE.CanvasTexture(wb.c); wbTex.colorSpace = THREE.SRGBColorSpace;
  TX.drawWhiteboard(wb.ctx, '', false, story.board);
  wbTex.needsUpdate = true;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshStandardMaterial({ map: wbTex, roughness: 0.3, emissive: '#ffffff', emissiveMap: wbTex, emissiveIntensity: 0.15 })); board.position.set(1.04, 5.6, 17.6); board.rotation.y = Math.PI / 2; add(board);
  inter({ id: 'BOARD', kind: 'board', label: '白板', pos: board.position.clone(), radius: 3.4, room: '202', data: { ctx: wb.ctx, tex: wbTex } });

  // —— 203 管理员办公室 ——
  desk(5, 4, 25.2, 0, 2.0, 0.9); chair(5, 4, 24.4, 0);
  shelf(1.6, 4, 22.6, 1.4, 0.5, 2.2); plant(8.8, 4, 22.4, 1);

  // —— 204 监控室：画面墙 ——
  box(13, 4, 25.6, 3.6, 0.76, 0.8, w.mats.dark);
  inter({ id: 'MONITORS', kind: 'monitors', label: '监控画面墙', pos: new THREE.Vector3(13, 5.6, 26.6), radius: 2.6, room: '204' });

  // —— 205 档案室：可推动的密集柜 ——
  for (let i = 0; i < 3; i++) {
    const x = 28 + i * 1.7; const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 0.9), new THREE.MeshStandardMaterial({ color: '#7c8085', roughness: 0.45, metalness: 0.6 })); m.position.y = 1.3; g.add(m);
    const hnd = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 12), w.mats.steel); hnd.position.set(0, 1.2, 0.46); g.add(hnd);
    g.position.set(x, 4, 1.5);
    const s = w.addStruct('shelf', [{ min: [x - 0.75, 4, 1.05], max: [x + 0.75, 6.6, 1.95] }], { id: `SHELF${i + 1}`, visual: g, label: '密集柜', pushable: true });
    inter({ id: `SHELF${i + 1}`, kind: 'shelf', label: '推动密集柜', pos: new THREE.Vector3(x, 5, 2.2), radius: 1.9, room: '205', data: { struct: s, x } });
  }

  // —— 206 茶水间 ——
  box(37.6, 4, 2.4, 0.9, 0.9, 3.6, w.mats.wood);
  const disp = box(37.6, 4.9, 1.0, 0.4, 1.1, 0.4, new THREE.MeshStandardMaterial({ color: '#e8e8e4', roughness: 0.4 }), false);
  inter({ id: 'DISPENSER', kind: 'dispenser', label: '饮水机', pos: disp.position.clone(), room: '206' });
  const mw = box(37.6, 4.9, 3.0, 0.5, 0.32, 0.4, new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.3, metalness: 0.5 }), false);
  inter({ id: 'MICROWAVE', kind: 'microwave', label: '微波炉', pos: mw.position.clone(), room: '206' });

  // —— 207 无限走廊 ——
  for (let x = 28; x <= 38; x += 4) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), w.mats.dark); p.position.set(x, 5.3, 8.15); add(p); }

  // —— 208 露台：花坛矮台 ——
  w.addStruct('ledge', [{ min: [38.05, 4, 19.2], max: [38.95, 4.85, 26.8] }], { id: 'LEDGE', label: '花坛矮台', mat: w.mats.wall });
  for (let z = 20.2; z <= 26; z += 2.2) plant(38.5, 4.85, z, 0.7);
  sofa(33.5, 4, 25.6, Math.PI, 2.0, w.mats.fabric);

  // —— 209 休息区 ——
  sofa(20, 4, 25.8, Math.PI, 2.6); sofa(25, 4, 25.8, Math.PI, 2.6); box(22.5, 4, 24.4, 2, 0.42, 1, w.mats.wood);
  inter({ id: 'SOFA_209', kind: 'sofa', label: '沙发', pos: new THREE.Vector3(20, 4.4, 25.8), room: '209' });
  for (const x of [17.4, 28.6]) plant(x, 4, 20.6, 1.2);

  // —— RF 穹顶花园 ——
  for (let i = 0; i < 7; i++) plant(3.6 + (i % 4) * 2.8, 8, 8 + Math.floor(i / 4) * 3.6, 1.4);
  box(11, 8, 12, 2.2, 0.45, 0.6, w.mats.wood);

  // —— B1 地牢 ——
  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) { const r = ROOMS.find(r => r.id === c)!; box(r.x0 + 1.5, -4, r.z0 + (c === 'C6' ? 1.4 : 3.6), 0.9, 0.4, 1.9, w.mats.fabric); }
  // 主锚定柱
  const pillar = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 3, 24), w.mats.metal); col.position.y = 1.5; pillar.add(col);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5aa8ff').multiplyScalar(0.3), toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.4; pillar.add(ring);
  const ring2 = ring.clone(); ring2.position.y = 2.6; ring2.material = ring.material; pillar.add(ring2);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.3), new THREE.MeshBasicMaterial({ map: TX.textPanel(['此处禁止建造'], { w: 512, h: 220, bg: '#1a1c1e', fg: '#c8c4bc', size: 70, pad: 40 }), toneMapped: false, color: '#888' })); plate.position.set(0, 1.6, 0.5); pillar.add(plate);
  pillar.position.set(27.5, -4, 18); add(pillar);
  w.props.push({ min: [27, -4, 17.5], max: [28, -1, 18.5], tag: 'prop' });
  inter({ id: 'PILLAR', kind: 'pillar', label: '主锚定柱', pos: new THREE.Vector3(27.5, -2.8, 18.6), radius: 2.2, room: 'B1A', data: { ring, ring2 } });
  const rack = box(29.6, -4, 15.6, 1.4, 1.0, 0.4, w.mats.steel);
  inter({ id: 'STAKES', kind: 'stakes', label: '锚钉架', pos: new THREE.Vector3(29.6, -3, 15.9), radius: 1.9, room: 'B1A', mesh: rack });
  // 控制台
  box(37.6, -4, 18, 0.8, 0.8, 2.0, w.mats.dark);
  const termTex = TX.screenTexture(['GUANZHI-OS v3.1  维护终端', '', '> _'], { w: 512, h: 320 });
  const term = screenMesh(termTex, 37.75, -2.75, 18, -Math.PI / 2, 1.0, 0.62); term.g.rotation.x = 0;
  inter({ id: 'CONSOLE', kind: 'console', label: '维护终端', pos: new THREE.Vector3(37.4, -2.8, 18), radius: 2.2, room: 'B1K', data: { tex: termTex, scr: term.scr } });
  // 水牢：水底“窗口”
  const voidTex = TX.textPanel([], { w: 256, h: 256, bg: '#000000' }); const vctx = (voidTex.image as HTMLCanvasElement).getContext('2d')!; for (let i = 0; i < 160; i++) { vctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`; vctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); } voidTex.needsUpdate = true;
  const vp = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: voidTex, toneMapped: false })); vp.rotation.x = -Math.PI / 2; vp.position.set(15, -3.99, 15); add(vp);
  const vring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.18, 4), w.mats.steel); vring.rotation.x = -Math.PI / 2; vring.rotation.z = Math.PI / 4; vring.position.set(15, -3.98, 15); add(vring);

  // —— 物品 ——
  const items: [string, string, string, number, number, number, THREE.Object3D][] = [
    ['FUSE', '保险丝', '104', 4.5, 1.25, 13.2, cyl(0.05, 0.2, '#c9a227')],
    ['BADGE', '工牌（周）', '203', 4.4, 4.8, 25.2, flat(0.12, 0.18, '#3a7bd5')],
    ['SIGNATURE', '管理员签字样本', '203', 5.6, 4.8, 25.0, flat(0.21, 0.3, '#efe9dc')],
    ['PAPER', '一叠白纸', '201', 6.6, 4.8, 6.8, flat(0.21, 0.3, '#f4f2ec')],
    ['FLASHLIGHT', '手电', '103', 4.4, 1.35, 1.4, cyl(0.03, 0.2, '#2a2a2a')],
    ['CUP', '纸杯', '206', 37.5, 4.9, 4.0, cyl(0.04, 0.09, '#f0ece4')],
    ['CUP', '纸杯', '206', 37.7, 4.9, 4.2, cyl(0.04, 0.09, '#f0ece4')],
  ];
  for (const [id, name, room, x, y, z, mesh] of items) { mesh.position.set(x, y, z); add(mesh); w.items.push({ id: `${id}${w.items.filter(i => i.id.startsWith(id)).length || ''}`, name, kind: 'item', pos: mesh.position.clone(), mesh, taken: false, hidden: false, locked: false, room }); }
  for (const n of NOTES) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), w.mats.paper); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random(); m.position.set(n.x, n.y + 0.01, n.z); add(m);
    w.items.push({ id: n.id, name: n.title, kind: 'note', pos: m.position.clone(), mesh: m, taken: false, hidden: false, locked: false, text: n.text, title: n.title, room: n.room });
  }

  // —— 荧光涂鸦（停电时可见） ——
  const graffiti: THREE.Mesh[] = [];
  graffiti.push(w.addDecal(TX.graffitiTexture(['她最怕你受伤', '她修东西的时候，墙会消失一下']), 13.99, 1.6, 7, -1, 0, 3.2, 1.6, 1.4, false));
  graffiti.push(w.addDecal(TX.graffitiTexture(['外面有风', '让她自己把墙拆掉']), 15.0, 1.6, 15, 1, 0, 3.2, 1.6, 1.4, false));
  graffiti.push(w.addDecal(TX.graffitiTexture(['B1 有锚', '13']), 29.99, 1.6, 14, -1, 0, 2.4, 1.2, 1.4, false));
  // 档案室墙上的字（推开密集柜可见）
  w.addDecal(TX.graffitiTexture(story.archive, '#2b2621', 1024, 512), 29.7, 5.4, 1.0, 0, 1, 4.6, 2.2, 0.9);

  return { cams, graffiti };

  function cyl(r: number, h: number, c: string) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.12 })); m.rotation.z = Math.PI / 2; return m; }
  function flat(sx: number, sz: number, c: string) { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.01, sz), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: c, emissiveIntensity: 0.1 })); return m; }
}
function roomCx(r: { x0: number; x1: number }) { return (r.x0 + r.x1 + 1) / 2; }
function roomCz(r: { z0: number; z1: number }) { return (r.z0 + r.z1 + 1) / 2; }

export function drawStreet(ctx: CanvasRenderingContext2D, interior = false) {
  const W = 512, H = 512; ctx.clearRect(0, 0, W, H);
  if (!interior) {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#141826'); g.addColorStop(0.6, '#2a2a36'); g.addColorStop(1, '#3a3530'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) { const x = 30 + i * 56; ctx.fillStyle = 'rgba(255,214,150,0.9)'; ctx.beginPath(); ctx.arc(x, 210 + (i % 2) * 10, 6, 0, 7); ctx.fill(); const lg = ctx.createRadialGradient(x, 215, 0, x, 215, 50); lg.addColorStop(0, 'rgba(255,200,130,0.25)'); lg.addColorStop(1, 'rgba(255,200,130,0)'); ctx.fillStyle = lg; ctx.fillRect(x - 50, 165, 100, 100); }
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 300, W, 4);
  } else {
    ctx.fillStyle = '#2b2824'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#4a453e'; ctx.fillRect(0, 340, W, 172);
    ctx.fillStyle = '#6a5a44'; ctx.fillRect(140, 290, 240, 60); // 前台
    ctx.fillStyle = 'rgba(255,236,200,0.6)'; for (let i = 0; i < 4; i++) ctx.fillRect(60 + i * 110, 40, 70, 8);
    ctx.fillStyle = '#0a0908'; ctx.beginPath(); ctx.ellipse(256, 250, 34, 40, 0, 0, 7); ctx.fill(); ctx.fillRect(222, 270, 68, 120); // 背对你的人
  }
}

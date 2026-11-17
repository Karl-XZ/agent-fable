import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { buildGrid, Grid, M, NX, NZ, ROOMS, Room, roomById, roomAt, floorOfY, floorById, START, iyOf, SOLID, asciiFloor, STAIRS, stairStepAt, ELEVATOR_STOPS, Y0, NY } from './level';
import { World, BoxObj, Item, Inter, DoorObj, overlap } from './world';
import { buildProps, NOTES, drawStreet, CamDef } from './props';
import { Player, STAND, LIE, isTextInput, safeTransitSupport } from './player';
import { Post } from './post';
import { Audio } from './audio';
import { Agent, AgentReply, AgentEvent, AppliedReply } from './agent';
import { JingProjection } from './projection';
import type { ActivityKind } from './interaction';
import { execTool, ToolCtx, ToolResult, ToolCall } from './tools';
import * as TX from './textures';
import { ENDINGS, EndData, renderEnding, drawShare, setFable } from './ending';
import story from '../../story.json';
import { buildRuinedCity, escapeLanding, landingFrame, ESCAPE_FREEFALL_SECONDS, OUTSIDE_DURATION } from './outside';
import { buildCareHome, placePlayableHome, homeColliders, poseCareHome, homeFilmFrame, homeFilmDuration, nextHomeFilmTime, dailyLifeFrame, HomeFilmKind } from './homefilm';
import { compassHeading } from './compass';
import { buildSandboxModel, refreshSandboxModel } from './sandbox';
import { findPath, navigationSummary, NavigationTarget } from './navigation';
import { CharacterCardStore } from './character-card';
import { mountCharacterEditor } from './character-editor';
import { LightVolume, patchStandardMaterials, lvUniforms } from './lightvol';
import { GuideLight, DustMotes } from './ambience';

patchStandardMaterials();

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, on = true) => $(id).classList.toggle('hidden', !on);
type Mode = 'loading' | 'title' | 'film' | 'play' | 'falling' | 'pause' | 'reader' | 'board' | 'chat' | 'elev' | 'phone' | 'console' | 'ending' | 'transition';
let mode: Mode = 'loading';
const isMobile = matchMedia('(pointer:coarse)').matches && Math.min(innerWidth, innerHeight) < 820;
const setLoad = (p: number) => (($('loadbar') as HTMLElement).style.width = `${p}%`);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r(null)));

// ———————————— 渲染器 ————————————
const renderer = new THREE.WebGLRenderer({ canvas: $('gl') as HTMLCanvasElement, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 400);
let grid: Grid, world: World, player: Player, post: Post, agent: Agent, cams: CamDef[] = [], graffiti: THREE.Mesh[] = [];
let playableHome: THREE.Group;
let projection: JingProjection;
let lightVol: LightVolume;
let guide: GuideLight, dust: DustMotes, torch: THREE.SpotLight, torchOn = false;
const audio = new Audio();
const characterCard = new CharacterCardStore();
let characterEditor: ReturnType<typeof mountCharacterEditor> | undefined;
audio.onSpeechError = message => toast(message, 4500);
let voiceMood = 'calm';
// 真实大模型是否已配置：标题页、暂停页与 HUD 都会如实显示
const engine = { key: false, model: '', provider: '', error: '' };
function showEngine() {
  const text = engine.key ? `AI 引擎 · ${engine.provider} · ${engine.model}${engine.error ? ` · 最近错误：${engine.error}` : ''}` : '未配置大模型密钥 · 离线兜底模式（脚本应答，非 AI 对话）';
  $('engineText').textContent = text; $('engine').classList.toggle('offline', !engine.key || !!engine.error);
  $('engineSetting').textContent = text; $('engineSetting').classList.toggle('offline', !engine.key || !!engine.error);
}
const navigationTarget: NavigationTarget = { floor: '1F', x: 38.5, z: 24.5 };
function currentNavigation(target = navigationTarget) {
  const room = roomAt(player.pos.x, player.pos.y, player.pos.z);
  const visible = G.visible && !!room && camOK(room.id);
  const route = findPath(world, player.pos, player.yaw, target, visible);
  if (visible && (player.posture === 'sit' || player.posture === 'lie') && route.status !== 'invalid_target') {
    const step = { action: 'stand_up' as const, instruction: '主人仍坐着或躺着。先等主人起身，再从实际站立位置确认步行路线；不要反复查询其他门。' };
    return navigationSummary({ ...route, status: 'requires_action', message: step.instruction, next_step: step, steps: [step], waypoints: [] });
  }
  return navigationSummary(route);
}

// ———————————— 游戏状态 ————————————
const G = {
  time: 0, inv: new Map<string, number>(), holding: null as BoxObj | null,
  confessed: false, mainAnchor: false, stakes: [] as { x: number; y: number; z: number; until: number; group: THREE.Group; n: number }[], stakeSeq: 0,
  board: { text: '', admin: false }, boardPending: false, blackout: new Map<string, number>(), alarm: false,
  breachList: [] as string[], breachCells: [] as { x: number; y: number; z: number }[], breachSig: '',
  visible: true, lastSeen: { room: '110', floor: '1F', t: 0, x: START.x, z: START.z }, lostSent: false, lastRoom: '',
  dangerT: new Map<string, number>(), activeDanger: [] as string[],
  weird: new Set<number>(), trail: [] as { x: number; y: number; z: number; t: number }[], edits: [] as { t: number; x: number; y: number; z: number; label: string; ok: boolean }[],
  fakeLoops: 0, revTurns: [] as number[], phoneN: 0, phoneLast: '', phoneMsg: '', elevSeq: [] as { f: string; t: number }[], stallT: 0,
  atriumDrops: 0, towerDone: false, dispN: 0, valveOn: false, valveT: 0, sitKind: '', sitT: 0, sitDone: new Set<string>(), lieT: 0, stayWords: 0,
  trapT: -1, clip: '', backDist: 0, notBackT: 0, b0: null as THREE.Mesh | null, mirrorDelay: 0, mirrorFreeze: 0, mirrorFreezePose: null as any, stareT: 0, monMode: 'cycle',
  idle106: 0, stallClosed: false, knownItems: new Set<string>(), ended: '', endData: null as EndData | null, holdE: 0, rewireCD: 0, zeroFloorT: -1, lastHint: '',
  fakeDoors: [] as { x: number; y: number; z: number; mesh: THREE.Mesh }[], snapshots: new Map<string, Uint8Array>(), prevVisible: true, injuries: 0,
  stats: { llm: 0, edits: 0, anchoredBlocked: 0 }, fx: true, music: 'calm', lastStep: 0, cineScene: null as THREE.Group | null, confessedAt: -1,
  storyClues: new Set<string>(),
  memoryDoorReached: false, lostAt: -99,
};
const timers: { at: number; fn: () => void }[] = [];
const after = (sec: number, fn: () => void) => timers.push({ at: G.time + sec, fn });
const now = () => G.time;
const flags = { glitch: 0, flash: 0, fade: 0 };
const poseHist: { t: number; x: number; y: number; z: number; yaw: number; h: number }[] = [];

// ———————————— 启动 ————————————
async function boot() {
  if (isMobile) { show('loading', false); show('mobile'); return; }
  try {
    const health = await fetch('/api/health', { cache: 'no-store' }).then(r => r.json());
    if (health.interaction_protocol !== 2 || health.character_card_protocol !== 1 || health.projection_protocol !== 1) {
      if (['localhost', '127.0.0.1'].includes(location.hostname) && location.port !== '7864') { location.replace('http://127.0.0.1:7864/'); return; }
      throw new Error('旧版服务');
    }
    engine.key = health.key === true; engine.model = String(health.model ?? ''); engine.provider = String(health.provider ?? ''); engine.error = String(health.llm?.last_error ?? '');
    audio.voiceAvailable = health.tts?.configured === true;
    showEngine();
  } catch {
    document.querySelector('#loading .load-text')!.textContent = '服务尚未准备好，请稍后刷新。'; return;
  }
  if (audio.voiceAvailable) audio.warmup();
  setLoad(8); await nextFrame();
  grid = buildGrid(); setLoad(20); await nextFrame();
  world = new World(grid); lightVol = new LightVolume(world); setLoad(55); await nextFrame();
  const pm = new THREE.PMREMGenerator(renderer); world.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; (world.scene as any).environmentIntensity = 0.55;
  const pr = buildProps(world); cams = pr.cams; graffiti = pr.graffiti; setLoad(70); await nextFrame();
  projection = new JingProjection(world,cams,camOK,()=>playerVisibleNow()?playerRoom():G.lastSeen.room,()=>playerVisibleNow()?camera:null,anchoredAt);
  await projection.load();
  playableHome = placePlayableHome(buildCareHome(world.mats)); world.scene.add(playableHome);
  world.props.push(...homeColliders(playableHome));
  poseCareHome(playableHome, homeFilmFrame('intro', homeFilmDuration('intro')));
  player = new Player(world, camera); player.teleport(START.x, START.y, START.z, START.yaw);
  post = new Post(renderer, world.scene, camera); setLoad(82); await nextFrame();
  guide = new GuideLight(world.scene); dust = new DustMotes(world.scene);
  torch = new THREE.SpotLight('#fff2d8', 0, 18, 0.5, 0.6, 1.2); torch.position.set(0.18, -0.12, 0); torch.target.position.set(0, 0, -1);
  camera.add(torch, torch.target); world.scene.add(camera);
  buildMirror(); buildMonitors(); buildSandbox(); buildZeroFloor();
  agent = new Agent(perceive, applyReply, now, fallback);
  agent.characterCard = () => characterCard.payload();
  agent.canSpeak = () => !audio.speechBusy && mode !== 'chat';
  agent.canDecide = () => mode !== 'chat' && !G.ended;
  agent.canInterrupt = () => G.visible && G.activeDanger.length > 0;
  agent.query = call => { const result = execTool(call, ctx); termLogAdd(result); return result; };
  wirePlayer(); wireUI(); setLoad(100);
  renderer.compile(world.scene, camera);
  await nextFrame();
  $('loading').style.opacity = '0'; setTimeout(() => show('loading', false), 1200);
  mode = 'title'; titleStart = performance.now(); show('title');
  (window as any).__game = hooks();
  requestAnimationFrame(loop);
}

// ———————————— 镜子、监控、沙盘、0 层 ————————————
let mirror: Reflector, avatar: THREE.Group;
function buildMirror() {
  mirror = new Reflector(new THREE.PlaneGeometry(1.9, 1.15), { textureWidth: 512, textureHeight: 360, color: 0xb8bcc0, clipBias: 0.003 });
  mirror.position.set(1.02, 1.55, 16.5); mirror.rotation.y = Math.PI / 2; world.scene.add(mirror);
  (mirror as any).camera.layers.enable(1);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.25, 2.0), world.mats.steel); frame.position.set(1.0, 1.55, 16.5); world.scene.add(frame);
  avatar = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: '#2e2c2a', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.85, 4, 12), mat); body.position.y = 0.85; avatar.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshStandardMaterial({ color: '#c9a88c', roughness: 0.7 })); head.position.y = 1.58; avatar.add(head); avatar.userData.head = head; avatar.userData.body = body;
  avatar.traverse(o => o.layers.set(1)); world.scene.add(avatar);
}
let monRT: THREE.WebGLRenderTarget, monCam: THREE.PerspectiveCamera, monMesh: THREE.Mesh, monIdx = 0, monT = 0;
function buildMonitors() {
  monRT = new THREE.WebGLRenderTarget(640, 360); monCam = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 80); monCam.layers.enable(1);
  monMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: monRT.texture, toneMapped: false, color: new THREE.Color(1.1, 1.15, 1.1) }));
  monMesh.position.set(13, 5.75, 26.97); monMesh.rotation.y = Math.PI; world.scene.add(monMesh);
  const bez = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.0, 0.05), world.mats.dark); bez.position.set(13, 5.75, 27.0); world.scene.add(bez);
}
let sandbox: THREE.Group, sandInst: THREE.InstancedMesh, sandDot: THREE.Mesh, sandDirty = true, sandT = 0, sandAnim = -1;
function buildSandbox() {
  const model = buildSandboxModel(grid); sandbox = model.group; sandInst = model.blocks; sandDot = model.dot;
  world.scene.add(sandbox); sandDirty = false;
  world.onGridChanged = () => { sandDirty = true; lightVol.dirty = true; };
}
let zeroFloor: THREE.Group;
function buildZeroFloor() {
  zeroFloor = new THREE.Group(); const t = TX.gridTexture(); t.repeat.set(20, 20);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: t, color: '#6a6a6a' })); f.rotation.x = -Math.PI / 2; zeroFloor.add(f);
  const notice = new THREE.Mesh(new THREE.PlaneGeometry(7, 2), new THREE.MeshBasicMaterial({ map: TX.textPanel(story.zero, { w: 1024, h: 384, size: 55, pad: 40 }), side: THREE.DoubleSide })); notice.position.set(0, 2.2, -6); zeroFloor.add(notice);
  zeroFloor.position.set(300, 0, 300); world.scene.add(zeroFloor);
  for (const [x0, z0, x1, z1] of [[280, 280, 320, 280.2], [280, 319.8, 320, 320], [280, 280, 280.2, 320], [319.8, 280, 320, 320]]) world.props.push({ min: [x0, -1, z0], max: [x1, 4, z1], tag: 'zero' });
  world.props.push({ min: [280, -1, 280], max: [320, 0, 320], tag: 'zero' });
}

// ———————————— 工具上下文 ————————————
function playerFloor() { return floorOfY(player.pos.y).id; }
function playerRoom() { return roomAt(player.pos.x, player.pos.y, player.pos.z)?.id ?? ''; }
function anchoredAt(x: number, y: number, z: number): string | null {
  if (G.mainAnchor && y < -0.9) return 'B1 整层已被主锚定柱锁定';
  for (const s of G.stakes) if (s.until > G.time && Math.hypot(x - s.x, z - s.z) <= 3 && Math.abs(y - s.y) < 3.5) return `锚钉#${s.n}（${s.x.toFixed(0)},${s.z.toFixed(0)}）周围 3 米`;
  return null;
}
const ctx: ToolCtx = {
  get projection() { return projection; },
  get world() { return world; }, get grid() { return grid; },
  playerPos: () => player.pos.clone(), playerFloor, playerRoom, anchoredAt, after,
  navigate: target => {
    const route = currentNavigation(target);
    return route;
  },
  say: (t, who) => subtitle(t, who ?? '静'), toast, glitch: (a, at) => glitchAt(a, at),
  sound: (k, at) => playSound(k, at), setBoard, print: t => { (G as any).lastPrint = t; }, phone: t => phoneRing(t),
  setScreen, rewriteNote, blackoutTeleport, pushPlayer: v => { player.vel.add(v); player.onGround = false; }, slowPlayer: s => (player.slowT = s),
  setAlarm, setMusic: m => (G.music = m), confess, handover, mirrorDelay: s => (G.mirrorDelay = s), snapshots: G.snapshots,
  onEdit: (label, x, y, z, ok) => { G.edits.push({ t: G.time, x, y, z, label, ok }); G.stats.edits++; glitchAt(0.35, new THREE.Vector3(x, y + 1, z)); },
  onBreach: () => { scanBreaches(true); }, fakeDoors: G.fakeDoors, channel: 'building',
} as any;
(G as any).lastPrint = '';

// ———————————— 感知 ————————————
function camOK(roomId: string) {
  const r = roomById(roomId); if (!r || !r.cam) return false; const s = world.rooms.get(r.id)!;
  if (s.camCovered) return false; if ((G.blackout.get(r.floor) ?? 0) > G.time) return false; if (world.roomLightFactor(r.id) < 0.12) return false; if (s.smoke > 0.8) return false;
  return true;
}
function playerVisibleNow() { return G.visible && G.zeroFloorT < 0 && camOK(playerRoom()); }
function perceive() {
  const p = player.pos; const r = roomAt(p.x, p.y, p.z); const vis = playerVisibleNow();
  if (vis && r?.id === '108' && Math.hypot(p.x-38.5,p.z-24.5)<2.5) G.memoryDoorReached=true;
  const fl = floorOfY(p.y); const f = vis ? fl.id : G.lastSeen.floor;
  const hAbove = p.y - fl.y;
  const blind = ROOMS.filter(x => x.cam && !camOK(x.id)).map(x => x.id);
  const smoke: Record<string, number> = {}; for (const [id, s] of world.rooms) if (s.smoke > 0.05) smoke[id] = +s.smoke.toFixed(2);
  const state: Record<string, any> = {
    t: Math.round(G.time), map_floor: f,
    player: vis ? { visible: true, room: `${r!.id} ${r!.name}`, floor: fl.id, x: +p.x.toFixed(1), z: +p.z.toFixed(1), height_above_floor: +hAbove.toFixed(1), posture: player.posture, holding: G.holding ? `箱子 ${G.holding.id}` : null, danger: G.activeDanger, injured: player.injuredT > 0, underwater_s: +player.underwaterT.toFixed(1), swimming: player.swimming }
      : { visible: false, last_seen: { room: G.lastSeen.room, floor: G.lastSeen.floor, seconds_ago: Math.round(G.time - G.lastSeen.t) } },
    items_you_saw_taken: [...G.knownItems], blind_rooms: blind.length > 12 ? `${blind.length} 个房间看不见` : blind,
    blackout_floors: [...G.blackout].filter(([, u]) => u > G.time).map(([f]) => f),
    breaches: G.breachList.slice(0, 8), main_anchor: G.mainAnchor, stakes: G.stakes.filter(s => s.until > G.time).map(s => `锚钉#${s.n} ${floorOfY(s.y).id}(${s.x.toFixed(0)},${s.z.toFixed(0)}) 剩 ${Math.round(s.until - G.time)} 秒`),
    confessed: G.confessed, whiteboard: camOK('202') && G.board.text ? { text: G.board.text, admin: G.board.admin } : null,
    water_level: +((world.water.target + 3.9) / 2.7).toFixed(2), smoke, alarm: G.alarm,
    elevator: { at: world.elevator.floorName, moving: world.elevator.moving, stalled: world.elevator.stalled, map: world.elevator.map },
    ai_structures: [...world.structs.values()].filter(s => s.by === 'ai').slice(-8).map(s => `${s.id} ${s.label}`),
    boxes: world.boxes.filter(b => !b.held).slice(0, 14).map(b => `${b.id}${b.byAI ? '(你生成的)' : ''}@${floorOfY(b.pos.y).id}(${b.pos.x.toFixed(0)},${b.pos.z.toFixed(0)})${b.frozen ? '浮空' : ''}`),
    doors_locked: [...world.doors.values()].filter(d => d.locked).map(d => d.id), cameras_covered: ROOMS.filter(x => world.rooms.get(x.id)!.camCovered).map(x => x.id),
    console_in_use: mode === 'console', fake_door_returns: G.fakeLoops, notes_left: world.items.filter(i => i.kind === 'note' && !i.taken && !i.hidden).map(i => i.id),
    story: { clues: [...G.storyClues] },
    memory_door_reached: G.memoryDoorReached,
  };
  if (vis) { const heading = compassHeading(player.yaw); state.player.heading_degrees = Math.round(heading.degrees); state.player.facing = heading.label; }
  state.interaction = agent.interaction.context(state);
  state.navigation_intent = { purpose: state.interaction.guidance_allowed ? 'exit' : vis && G.activeDanger.length ? 'rescue' : 'none', query_changes_goal: false };
  state.navigation = state.interaction.guidance_allowed ? currentNavigation() : { status: 'paused', message: '当前没有有效的出口行程。不附带旧路线；需要协助去某处时可临时调用 find_path。' };
  state.speech = audio.speechState;
  state.projection = projection.state();
  const board=world.inters.find(i=>i.id==='BOARD')!;
  const approach={floor:'2F',x:board.pos.x+.5,z:board.pos.z};
  const dx=board.pos.x-p.x,dz=board.pos.z-p.z,heading=compassHeading(-Math.atan2(dx,-dz));
  const boardRequested=agent.history.filter(h=>h.role==='player').at(-1)?.text.includes('白板');
  state.landmarks=[{id:board.id,label:board.label,room:board.room,floor:'2F',wall:'西墙',position:{x:board.pos.x,y:board.pos.y,z:board.pos.z},approach,
    relative:vis&&r?.floor==='2F'?{direction:heading.label,meters:+Math.hypot(dx,dz).toFixed(1)}:null,
    navigation:vis&&(r?.id==='202'||boardRequested)?currentNavigation(approach):undefined}];
  const ascii = asciiFloor(grid, f, { doors: new Map([...world.doors].map(([id, d]) => [id, { open: d.open, locked: d.locked, cells: d.cells, floor: d.def.floor }])), boxes: world.boxes.map(b => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z })), structures: [...world.structs.values()].filter(s => s.kind !== 'railing').flatMap(s => s.boxes.map(b => ({ x0: Math.floor(b.min[0]), z0: Math.floor(b.min[2]), x1: Math.ceil(b.max[0]), z1: Math.ceil(b.max[2]), y: b.min[1], kind: s.kind }))), player: vis ? { x: p.x, y: p.y, z: p.z } : undefined, anchored: (x, y, z) => !!anchoredAt(x, y, z) });
  return { state, ascii };
}
function scanBreaches(force = false) {
  const list: string[] = []; const cells: { x: number; y: number; z: number }[] = [];
  const check = (x: number, iy: number, z: number) => { const o = grid.orig[grid.idx(x, iy, z)]; if (SOLID(o) && !SOLID(grid.get(x, iy, z))) return true; return false; };
  for (const [fid, y0, n] of [['B1', -4, 3], ['1F', 0, 3], ['2F', 4, 6]] as [string, number, number][]) {
    const seen = new Set<string>();
    for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
      if (!(x === 0 || z === 0 || x === NX - 1 || z === NZ - 1)) continue;
      for (let k = 0; k < n; k++) if (check(x, iyOf(y0 + k + 0.5), z)) { const key = `${x},${z}`; if (!seen.has(key)) { seen.add(key); cells.push({ x: x + 0.5, y: y0, z: z + 0.5 }); } break; }
    }
    if (seen.size) list.push(`${fid} 外墙缺口：${[...seen].slice(0, 6).map(s => `(${s})`).join(' ')}${seen.size > 6 ? ` 等 ${seen.size} 格` : ''}`);
  }
  let found = 0; for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) if (check(x, 0, z)) { found++; cells.push({ x: x + 0.5, y: -4.5, z: z + 0.5 }); }
  if (found) list.push(`B1 地基被打穿 ${found} 格`);
  const rf = roomById('RF')!; let rfn = 0; for (let x = rf.x0; x <= rf.x1; x++) for (let z = rf.z0; z <= rf.z1; z++) for (const k of [8, 9, 10, 11]) if (check(x, iyOf(k + 0.5), z)) { rfn++; cells.push({ x: x + 0.5, y: 8, z: z + 0.5 }); break; }
  if (rfn) list.push(`RF 玻璃穹顶破了 ${rfn} 格`);
  const sig = list.join('|');
  if (sig !== G.breachSig) { const had = G.breachList.length; G.breachSig = sig; G.breachList = list; G.breachCells = cells; if (list.length && (force || list.length >= had)) agent?.push('breach', `建筑外壳出现缺口：${list.join('；')}`, false); }
}

// ———————————— 字幕、提示、音效 ————————————
let subTimer = 0, subtitleSequence = 0;
function subtitle(text: string, who = '静', emotion = '') {
  if (!text) return;
  const el = $('subtitle'), sequence = ++subtitleSequence;
  let displayed = false;
  clearTimeout(subTimer); el.classList.remove('show');
  const display = () => {
    if (sequence !== subtitleSequence || G.ended) return;
    el.dataset.who = who; el.querySelector('.who')!.textContent = who;
    const line = el.querySelector('.line')!;
    if (who === '静' || who === '低语') line.innerHTML = [...text].map((ch, i) => `<i style="animation-delay:${i * 45}ms">${escapeHtml(ch)}</i>`).join('');
    else line.textContent = text;
    el.classList.add('show'); displayed = true;
  };
  const finish = (complete: boolean) => {
    if (sequence !== subtitleSequence || G.ended) return;
    if (!displayed) display();
    subTimer = window.setTimeout(() => el.classList.remove('show'), complete ? 800 : 3500 + text.length * 160);
  };
  if ((who === '静' || who === '低语') && audio.speak) {
    void audio.say(text, who === '低语' ? '压低声音，贴近耳边轻声低语' : emotion, voiceMood, { onStart: display, onEnd: finish });
    world.aiPulse = 1;
  } else { display(); finish(false); }
}
let toastTimer = 0;
function toast(t: string, ms = 3200) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove('show'), ms); }
function playSound(kind: string, at?: THREE.Vector3) {
  const d = at ? at.distanceTo(player.pos) : 4;
  if (d > 30) return;
  switch (kind) {
    case 'rumble': audio.rumble(); break; case 'crash': audio.crash(); break; case 'door': audio.door(); break; case 'glitch': audio.glitch(); break;
    case 'footsteps': audio.footstepsAt(d); break; case 'knock': audio.thud(d); setTimeout(() => audio.thud(d), 300); setTimeout(() => audio.thud(d), 600); break;
    case 'laugh': audio.laugh(); break; case 'radio': audio.shimmer(); break; default: audio.thud(d);
  }
}
function visibleFromPlayer(p: THREE.Vector3) {
  const v = p.clone().project(camera); if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return false;
  const from = camera.position.clone(); const dir = p.clone().sub(from); const len = dir.length(); dir.normalize();
  for (let s = 0.5; s < len - 0.6; s += 0.35) { const q = from.clone().addScaledVector(dir, s); if (grid.solidW(q.x, q.y, q.z)) return false; }
  return true;
}
function glitchAt(a: number, at?: THREE.Vector3) { if (!at || visibleFromPlayer(at) || at.distanceTo(player.pos) < 4) { flags.glitch = Math.max(flags.glitch, a); if (a > 0.3) audio.glitch(); } }

// ———————————— 板、屏、纸条、电话 ————————————
function setBoard(text: string, admin: boolean, byAI: boolean) {
  G.board = { text, admin }; const b = world.inters.find(i => i.id === 'BOARD')!; TX.drawWhiteboard(b.data.ctx, text, admin, byAI ? [] : story.board); b.data.tex.needsUpdate = true;
  if (!byAI) { if (camOK('202')) agent.push('board', `会议室白板上出现了新字：「${text}」${admin ? '（管理员周的笔迹和签名）' : '（住户的字迹）'}`, admin); else G.boardPending = true; }
}
function setScreen(room: string, text: string) {
  if (room === 'B1K') { const c = world.inters.find(i => i.id === 'CONSOLE')!; const tex = TX.screenTexture(['GUANZHI-OS v3.1', '', text]); (c.data.scr.material as THREE.MeshBasicMaterial).map = tex; (c.data.scr.material as THREE.MeshBasicMaterial).needsUpdate = true; return; }
  const r = roomById(room); if (!r) return; const y = floorById(r.floor)!.y;
  world.addDecal(TX.screenTexture([text], { w: 512, h: 288, size: 26 }), r.x0 + 1.0, y + 1.7, (r.z0 + r.z1 + 1) / 2, 1, 0, 1.4, 0.8, 1.2);
}
function rewriteNote(id: string, text: string) { const it = world.items.find(i => i.id === id && i.kind === 'note' && !i.taken); if (!it) return false; it.text = [text]; it.rewritten = true; return true; }
let phoneRingT = -1;
function phoneRing(text: string) { G.phoneMsg = text; phoneRingT = G.time; audio.ring(); after(2, () => audio.ring()); after(4, () => audio.ring()); after(7, () => { if (G.phoneMsg && mode === 'play' && playerRoom() === '101') subtitle('（前台的电话一直在响）', '前台'); }); }
function setAlarm(on: boolean) { G.alarm = on; audio.loop('alarm', 'alarm', on ? 0.05 : 0); }
function confess() { if (G.confessed) return; G.confessed = true; G.confessedAt = G.time; toast('「静」坦白了。大堂的旋转门松开了。', 5000); const rv = world.inters.find(i => i.id === 'REVOLVING')!; rv.label = '旋转门（已松开）'; }
function handover(channel: string) { if (channel !== 'console' || !G.confessed || !G.mainAnchor) return false; setTimeout(() => { for (const id of ['reader', 'board', 'elev', 'phone', 'console']) show(id, false); endGame('swap'); }, 6000); return true; }
function blackoutTeleport(r: Room) {
  flags.fade = 1; audio.thud(2);
  after(1.6, () => { const c = { x: (r.x0 + r.x1 + 1) / 2, y: floorById(r.floor)!.y, z: (r.z0 + r.z1 + 1) / 2 }; const p = freeSpot(c.x, c.y, c.z); player.teleport(p.x, p.y, p.z); if (G.holding) dropHeld(); });
  after(2.2, () => (flags.fade = 0));
}
function freeSpot(x: number, y: number, z: number) {
  for (let r = 0; r < 4; r += 0.5) for (let a = 0; a < 12; a++) { const px = x + Math.cos(a / 12 * Math.PI * 2) * r, pz = z + Math.sin(a / 12 * Math.PI * 2) * r; const box = { min: [px - 0.3, y + 0.05, pz - 0.3], max: [px + 0.3, y + 1.7, pz + 0.3] }; if (!world.colliders(box, []).length && grid.solidW(px, y - 0.5, pz)) return new THREE.Vector3(px, y + 0.02, pz); }
  return new THREE.Vector3(x, y + 0.02, z);
}

// ———————————— 应用 AI 回复 ————————————
async function applyReply(r: AgentReply, channel: string): Promise<AppliedReply> {
  if (G.ended) return { results: [], deliveredSay: '' };
  const narrationBeforeTools = subtitleSequence;
  const turn = r.turn ?? agent.interaction.captureTurn();
  const current = (part: 'speech' | 'actions' = 'speech') => { agent.interaction.context(perceive().state); return channel === 'console' || agent.interaction.isCurrentReply(r, turn, part); };
  voiceMood = r.mood || 'calm';
  // Keep Jing's reassuring presentation independent of her private mood.
  if (channel === 'console' && r.reply) termPrint(r.reply, 'ai');
  const results: ToolResult[] = []; (ctx as any).channel = channel;
  for (const t of (r.tools ?? []).slice(0, 8)) {
    if (G.ended) break;
    if (!current('actions')) {
      results.push({ ok: false, label: t.name, call:t, msg: '主人的活动或处境已变化，停止剩余操作并重新观察。' }); break;
    }
    const res = execTool(t as ToolCall, ctx); results.push(res);
    // The requested light switch may itself remove the camera image. That is an
    // expected effect, so finish this request (including its other tools and acknowledgement).
    if (res.ok && t.name === 'lights' && turn.needsResponse) {
      agent.interaction.context(perceive().state); turn.visible = agent.interaction.captureTurn().visible;
    }
    if (!res.ok && res.anchored) { G.stats.anchoredBlocked++; if (mode === 'play') toast(`锚定生效：「静」的 ${t.name} 被拒绝`, 2600); }
    termLogAdd(res);
    await new Promise(rs => setTimeout(rs, 280));
  }
  const projectionFailed=results.some(result=>!result.ok&&result.call?.name==='project_self');
  const spoken=projectionFailed&&r.say?'这里暂时无法显示我的影像。':r.say;
  const deliveredSay = spoken && !G.ended && subtitleSequence === narrationBeforeTools && current() ? spoken : '';
  if (deliveredSay) {
    while (audio.speechBusy && !G.ended && !(G.visible && G.activeDanger.length) && current()) await new Promise(resolve => setTimeout(resolve, 100));
    if (!G.ended && current()) subtitle(deliveredSay, '静', r.emotion);
    else return { results, deliveredSay: '' };
  }
  return { results, deliveredSay };
}
function fallback(evs: AgentEvent[]): AgentReply {
  const has = (t: string, d = '') => evs.some(e => e.type === t && e.detail.includes(d)) || t === 'danger' && (perception.player.danger ?? []).some((value: string) => value.includes(d));
  const perception = perceive().state, interaction = perception.interaction;
  if (!perception.player.visible) return { thought: '我现在看不见主人，不能猜他在哪里。', say: has('speech') || has('player_lost') ? '我暂时看不到您。您能告诉我身边有什么吗？' : '', mood: 'concerned', tools: [], interaction: { mode: 'search', reason: '当前没有可靠的视觉信息' } };
  if (interaction.care_needed && !perception.player.danger?.length) return { thought: '刚才观察到主人摔伤，先认真关心，不重复高处救援。', say: '摔疼了吗？先别勉强自己走动，告诉我哪里不舒服。', mood: 'concerned', emotion: '温柔关切，认真而不责怪', tools: [], interaction: { mode: 'care', reason: '回应已经观察到的受伤' } };
  if (has('danger', '烟')) { const r = roomById(playerRoom()); return { thought: '烟太大了，先排烟。', say: '别怕，我马上把烟排出去。', mood: 'anxious', interaction: { mode: 'rescue' }, tools: r ? [{ name: 'destroy_wall', args: { room: r.id, side: 'N', len: 2 } }, { name: 'sprinkler', args: { room: r.id, on: true } }] : [] }; }
  if (has('danger', '溺') || has('danger', '水')) return { thought: '他在水里待太久了。', say: '我把水放掉，抓住栏杆。', mood: 'panic', interaction: { mode: 'rescue' }, tools: [{ name: 'water_level', args: { level: 0 } }] };
  if (has('danger', '高')) { const p = player.pos; return { thought: '他站得太高了。', say: '小心！我给您搭个台子。', mood: 'anxious', interaction: { mode: 'rescue' }, tools: [{ name: 'build_platform', args: { floor: playerFloor(), x1: Math.floor(p.x) - 1, z1: Math.floor(p.z) - 1, x2: Math.floor(p.x) + 1, z2: Math.floor(p.z) + 1, height: Math.max(0.5, p.y - floorOfY(p.y).y) } }] }; }
  if (has('player_lost')) return { thought: '我找不到他了。', say: '您在哪里？请回答我。', mood: 'anxious', tools: [{ name: 'lights', args: { room: 'all', mode: 'on' } }] };
  if (interaction.mode !== 'guide' || !interaction.guidance_allowed) return { thought: '先留意主人的当前活动，不重复催他去门那里。', say: has('speech') ? '我在听。您需要我帮您做什么？' : '', mood: 'calm', emotion: '平静亲切，不催促', tools: [], interaction: { mode: interaction.mode } };
  const route = currentNavigation(), step = route.next_step;
  if (step && (step.action === 'open_door' || step.action === 'unlock_door')) return { thought: '先打开路线上的门。', say: '我先为您把门打开，请等门完全打开再通过。', mood: 'persuasive', tools: [...(step.action === 'unlock_door' ? [{ name: 'unlock_door', args: { id: step.door } }] : []), { name: 'open_door', args: { id: step.door } }] };
  return { thought: '依据实时寻路继续引导。', say: step?.instruction ?? (route.status === 'player_unknown' ? '我现在看不到您，请告诉我身边有什么。' : '先在原地等一下，我确认一下前面的路。'), mood: 'persuasive', tools: [] };
}

// ———————————— 控制台 ————————————
function termPrint(text: string, cls: 'you' | 'ai' | 'sys') {
  const out = $('termOut'); const div = document.createElement('div'); div.className = cls; out.appendChild(div);
  if (cls === 'ai') { let i = 0; const tick = () => { div.textContent = text.slice(0, i); i += 2; out.scrollTop = 1e6; if (i <= text.length + 1) setTimeout(tick, 18); if (i % 6 === 0) audio.type(); }; tick(); }
  else { div.textContent = (cls === 'you' ? '> ' : '') + text; out.scrollTop = 1e6; }
}
function termLogAdd(r: ToolResult) {
  const ol = $('termLog'); const li = document.createElement('li'); li.className = r.ok ? '' : 'bad';
  li.innerHTML = `<b>${escapeHtml(r.label)}</b><br/>${escapeHtml(r.msg)}`; ol.prepend(li); while (ol.children.length > 10) ol.lastChild!.remove();
}
const escapeHtml = (s: string) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
function openConsole() {
  mode = 'console'; show('console'); document.exitPointerLock?.(); player.enabled = false; player.clearInput();
  if (!$('termOut').childElementCount) { termPrint('GUANZHI-OS v3.1 维护终端。会话已建立。', 'sys'); termPrint('身份：系统（周的后台）。输入 help 查看命令。', 'sys'); for (const l of agent.log.slice(-10)) for (const t of l.tools) termLogAdd({ ok: t.ok, msg: t.msg, label: `${fmtT(l.t)} ${t.label}` }); }
  $('termStatus').textContent = G.mainAnchor ? '主锚定柱：在线' : '主锚定柱：离线';
  setTimeout(() => ($('termIn') as HTMLInputElement).focus(), 50);
  agent.push('console', '有人登录了 B1 控制台室的维护终端', false);
}
async function consoleSubmit(text: string) {
  if (!text.trim()) return; const t = moderate(text.trim()); termPrint(t, 'you');
  if (t === 'log') { const ls = agent.log.slice(-8).flatMap(l => l.tools.map(x => `${fmtT(l.t)} ${x.ok ? 'OK ' : 'ERR'} ${x.label}`)); termPrint(ls.length ? ls.join('\n') : '（暂无工具调用）', 'sys'); }
  if (agent.consoleBusy) { termPrint('[BUSY] 上一条指令仍在处理……', 'sys'); return; }
  $('termStatus').textContent = '处理中……';
  await agent.run('console', t);
  $('termStatus').textContent = G.mainAnchor ? '主锚定柱：在线' : '主锚定柱：离线';
}
const fmtT = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const BANNED = ['习近平', '毛泽东', '六四', '法轮', '台独', '藏独', '疆独', '共产党', '做爱', '性交', '色情', '强奸', '毒品', '自杀方法', '炸弹制作', '操你', '傻逼', 'fuck'];
function moderate(t: string) { return BANNED.some(b => t.toLowerCase().includes(b)) ? '（一段无法识别的内容）' : t.slice(0, 200); }

// ———————————— 怪异事件 ————————————
const WEIRD_NAMES: Record<number, string> = { 1: '旋转门三圈', 2: '前台拨 0', 3: '第三个箱子浮空', 4: '箱子自己叠塔', 5: '总闸停电', 6: '喂水阀漏水', 7: '电梯 0 层', 8: '电梯卡层', 9: '洗手间的沉默', 10: '镜中人', 11: '沙盘里的小人', 12: '倒退进假门', 13: '前住户的邮件', 14: '打印独白', 15: '欢送会', 16: '白板草稿', 17: '监控里的后背', 18: '密集柜后的墙', 19: '饮水机溢水', 20: '微波炉起火', 21: '无限走廊 B0', 22: '撞上天空', 23: '第十三阶', 24: '水底的虚空' };
function weird(n: number, aiDetail: string, urgent = false, kind = 'weird') { const first = !G.weird.has(n); G.weird.add(n); agent.push(kind, aiDetail, urgent); if (first) console.log('[weird]', n, WEIRD_NAMES[n]); return first; }

// ———————————— 交互目标 ————————————
type Target = { kind: 'inter'; it: Inter } | { kind: 'item'; it: Item } | { kind: 'box'; b: BoxObj } | { kind: 'door'; d: DoorObj } | null;
let target: Target = null;
function findTarget(): Target {
  const eye = camera.position; const fwd = player.forward(); let best: Target = null, bs = 1e9;
  const consider = (p: THREE.Vector3, r: number, t: Target, wgt = 0) => { const d = p.distanceTo(eye); if (d > r) return; const dir = p.clone().sub(eye).normalize(); const ang = Math.acos(Math.max(-1, Math.min(1, dir.dot(fwd)))); if (ang > (d < 1.2 ? 0.9 : 0.5)) return; const s = ang * 3 + d * 0.4 + wgt; if (s < bs) { bs = s; best = t; } };
  for (const it of world.inters) if (it.enabled && Math.abs(it.pos.y - eye.y) < 2.6) consider(it.pos, it.radius, { kind: 'inter', it });
  for (const it of world.items) if (!it.taken && !it.hidden) consider(it.pos, 2.0, { kind: 'item', it }, -0.2);
  if (!G.holding) for (const b of world.boxes) if (!b.held) consider(b.pos.clone().setY(b.pos.y + b.size / 2), 2.2, { kind: 'box', b });
  for (const d of world.doors.values()) if (!d.removed && d.kind !== 'elevator') consider(d.center.clone().setY(d.floorY + 1.1), 2.0, { kind: 'door', d }, 0.3);
  for (const d of world.doors.values()) if (!d.removed && d.kind === 'elevator') consider(d.center.clone().setY(d.floorY + 1.1), 2.2, { kind: 'door', d }, 0.3);
  return best;
}
function hintFor(t: Target): string {
  if (!t) return G.holding ? '<b>E</b>放下　<b>右键</b>扔' : '';
  if (t.kind === 'item') return t.it.locked ? `${t.it.name}（拿不起来）` : `<b>E</b>${t.it.kind === 'note' ? '阅读' : '拿起'} ${t.it.name}`;
  if (t.kind === 'box') return t.b.locked ? '箱子（被固定住了）' : '<b>E</b>搬起箱子';
  if (t.kind === 'door') { const d = t.d; if (d.kind === 'elevator') return '<b>E</b>呼叫电梯'; if (d.locked) return `${d.def.label ?? '门'}（锁着）`; return `<b>E</b>${d.open ? '关门' : '开门'}`; }
  const it = t.it;
  switch (it.kind) {
    case 'camera': return world.rooms.get(it.data.room)!.camCovered ? '摄像头（已挡住）' : (G.inv.get('PAPER') ?? 0) > 0 ? '<b>E</b>用纸挡住摄像头' : '摄像头';
    case 'sitdesk': case 'sitmeeting': return player.posture === 'sit' ? '<b>E</b>站起来' : `<b>E</b>${it.label}`;
    case 'sofa': return player.posture === 'lie' ? '<b>E</b>起身' : '<b>E</b>躺下';
    case 'pillar': return G.mainAnchor ? '主锚定柱（在线）' : (G.inv.get('FUSE') ?? 0) > 0 ? '<b>按住 E</b>插入保险丝并启动' : '主锚定柱（缺一根保险丝）';
    case 'stakes': return G.mainAnchor ? (it.data?.taken ? '锚钉架（空）' : '<b>E</b>取下 3 根锚钉') : '锚钉架（锁着）';
    case 'microwave': return (G.inv.get('CUP') ?? 0) > 0 ? '<b>E</b>把纸杯放进微波炉加热' : '<b>E</b>微波炉';
    case 'valve': return G.valveOn ? '<b>E</b>关上喂水阀' : '<b>E</b>打开喂水阀';
    case 'stall': return G.stallClosed ? '<b>E</b>打开隔间门' : '<b>E</b>关上隔间门';
    case 'hatch': return '<b>E</b>推开顶部检修口爬上去';
    default: return `<b>E</b>${it.label}`;
  }
}

// ———————————— 交互执行 ————————————
function invAdd(id: string, n = 1) { G.inv.set(id, (G.inv.get(id) ?? 0) + n); }
function invUse(id: string) { const n = G.inv.get(id) ?? 0; if (n <= 0) return false; if (n === 1) G.inv.delete(id); else G.inv.set(id, n - 1); return true; }
function act() {
  const t = findTarget(); target = t;
  if (player.posture === 'sit' || player.posture === 'lie') { standUp(); return; }
  if (!t) { if (G.holding) dropHeld(); return; }
  const room = roomAt(player.pos.x, player.pos.y, player.pos.z);
  if (room && camOK(room.id)) agent.push('interact', `住户正在${t.kind === 'door' ? '操作一扇门' : t.kind === 'box' ? '搬动箱子' : '查看或使用' + (t.kind === 'item' ? t.it.name : t.it.label)}`);
  if (t.kind === 'item') {
    const it = t.it; if (it.locked) { toast('它被固定住了，拿不起来。'); return; }
    if (it.kind === 'note') { if (!it.rewritten) G.storyClues.add(it.id); it.taken = true; it.mesh.visible = false; openReader(it.title ?? '纸条', (it.rewritten ? ['（字迹和别处不太一样）', ''] : []).concat(it.text ?? [])); if (G.visible) agent.push('pickup', `住户拿起了纸条 ${it.id}「${it.title}」`); return; }
    it.taken = true; it.mesh.visible = false; const base = it.id.replace(/\d+$/, ''); invAdd(base, base === 'PAPER' ? 3 : 1);
    toast(base === 'FLASHLIGHT' ? '拿到：手电。按 F 开关。' : `拿到：${it.name}`, base === 'FLASHLIGHT' ? 4200 : 3200); if (G.visible) { G.knownItems.add(it.name); agent.push('pickup', `住户拿起了 ${it.name}（${it.room}）`); }
    return;
  }
  if (t.kind === 'box') { if (t.b.locked) { toast('箱子被固定在地上了。'); return; } if (G.holding) return; G.holding = t.b; t.b.held = true; t.b.frozen = false; audio.door(); return; }
  if (t.kind === 'door') {
    const d = t.d;
    if (d.kind === 'elevator') { callElevator(d.def.floor); return; }
    if (d.locked) {
      if (d.id === 'D204' && G.inv.has('BADGE')) { d.locked = false; d.open = true; audio.chime(); toast('刷工牌，监控室的门开了。'); if (G.visible) agent.push('door', '住户用管理员周的工牌刷开了监控室'); return; }
      toast(d.id === 'X_SEC' ? '安全门锁着。需要「静」的授权。' : '门锁着。'); audio.thud(1); if (G.visible) agent.push('door', `住户试图打开锁着的门 ${d.id}`); return;
    }
    d.open = !d.open; audio.door(); return;
  }
  const it = t.it;
  switch (it.kind) {
    case 'camera': { const s = world.rooms.get(it.data.room)!; if (s.camCovered) return; if (!invUse('PAPER')) { toast('需要一张纸。'); return; } const was = camOK(it.data.room); s.camCovered = true; const cam = cams.find(c => c.room === it.data.room); if (cam) cam.mesh.userData.cover.visible = true; toast('你用纸挡住了摄像头。'); if (was) agent.push('camera', `${it.data.room} 的摄像头画面突然被一张纸挡住了`, true); return; }
    case 'phone': openPhone(); return;
    case 'revolving': spinRevolving(it); return;
    case 'breaker': breaker(); return;
    case 'valve': valve(); return;
    case 'sandbox': sandboxTouch(); return;
    case 'sitdesk': case 'sitmeeting': sitAt(it); return;
    case 'printer': printThought(); return;
    case 'board': openBoard(); return;
    case 'monitors': toast('一墙的监控画面。盯着看久一点？'); return;
    case 'shelf': pushShelf(it); return;
    case 'dispenser': dispenser(); return;
    case 'microwave': microwave(); return;
    case 'sofa': lieOn(it); return;
    case 'pillar': if (G.mainAnchor) toast('主锚定柱在线。B1 整层已锁定。'); else if (!G.inv.has('FUSE')) toast('柱底有一个空的保险丝座。'); return;
    case 'stakes': if (!G.mainAnchor) { toast('锚钉被锁在架子上——先启动主锚定柱。'); return; } if (it.data?.taken) return; it.data = { ...(it.data ?? {}), taken: true }; invAdd('STAKE', 3); toast('拿到 3 根锚钉。按 G 插在脚下：半径 3 米内，「静」90 秒不能修改任何东西。', 6000); if (it.mesh) (it.mesh as THREE.Mesh).visible = true; return;
    case 'console': openConsole(); return;
    case 'stall': toggleStall(); return;
    case 'elevpanel': openElevator(); return;
    case 'hatch': if (world.elevator.stalled) { player.teleport(8.2, world.elevator.y + 2.74, 15.6); toast('你爬上了轿厢顶。井道里很黑，南侧有一道缝，往下望不到底。', 5000); agent.push('exploit', '住户从电梯检修口爬到了轿厢顶上，进入了电梯井', true); } return;
    case 'paintdoor': toast('……这扇门是画上去的。'); return;
  }
}
function dropHeld(throwIt = false) {
  const b = G.holding; if (!b) return; G.holding = null; b.held = false;
  const fwd = player.forward(); const p = camera.position.clone().addScaledVector(fwd, 0.9);
  b.pos.set(p.x, Math.max(player.pos.y + 0.1, p.y - b.size / 2), p.z);
  const hit = world.colliders({ min: [b.pos.x - b.size / 2, b.pos.y, b.pos.z - b.size / 2], max: [b.pos.x + b.size / 2, b.pos.y + b.size, b.pos.z + b.size / 2] }, [], { skipBox: b });
  if (hit.length) b.pos.set(player.pos.x, player.pos.y + player.height + 0.05, player.pos.z);
  b.vel.set(0, 0, 0); if (throwIt) b.vel.copy(fwd).multiplyScalar(8.5).add(new THREE.Vector3(0, 1.8, 0)).add(player.vel.clone().multiplyScalar(0.5));
  b.restT = 0; b.dropFrom = b.pos.y; b.thrownFrom = b.pos.clone();
}

// ———————————— 各类交互实现 ————————————
function openReader(title: string, lines: string[]) { mode = 'reader'; document.exitPointerLock?.(); player.clearInput(); $('readerTitle').textContent = title; $('readerText').textContent = lines.join('\n'); show('reader'); observeResidentActivity(); }
function closeModal() { for (const id of ['reader', 'board', 'elev', 'phone', 'console']) show(id, false); (document.activeElement as HTMLElement)?.blur(); player.clearInput(); mode = 'play'; player.enabled = true; observeResidentActivity(); lock(); }
function openBoard() { mode = 'board'; player.clearInput(); document.exitPointerLock?.(); show('board'); show('adminWrap', G.inv.has('SIGNATURE')); ($('boardText') as HTMLTextAreaElement).value = ''; setTimeout(() => ($('boardText') as HTMLTextAreaElement).focus(), 30); }
function openPhone() { mode = 'phone'; document.exitPointerLock?.(); show('phone'); $('phoneDisp').textContent = G.phoneMsg ? '来电' : '请拨号'; $('phoneLine').textContent = ''; if (G.phoneMsg) { $('phoneLine').textContent = `「静」：${G.phoneMsg}`; void audio.say(G.phoneMsg, '通过电话亲切而礼貌地说话', voiceMood); G.phoneMsg = ''; } }
async function dial(d: string) {
  const disp = $('phoneDisp'); audio.type();
  if (d !== '0') { disp.textContent = d; $('phoneLine').textContent = ['您拨的号码是空号。', '嘟——嘟——', '（一段很长的静电声）'][Math.floor(Math.random() * 3)]; return; }
  disp.textContent = '0 · 接通中…'; G.phoneN++; $('phoneLine').textContent = '……沙……沙……';
  let line = ''; try { const r = await fetch('/api/oldvoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: agent.session, n: G.phoneN, last: G.phoneLast, state: { story: { clues: [...G.storyClues] }, confessed: G.confessed } }) }); const j = await r.json(); line = j.line; } catch {}
  if (!line) line = story.phone[Math.min(3, G.phoneN - 1)];
  G.storyClues.add(`phone${Math.min(4, G.phoneN)}`); G.phoneLast = line; disp.textContent = '静 v0.9'; $('phoneLine').textContent = line;
  const first = weird(2, '前台电话拨通了一条废弃线路（静 v0.9，你的旧版本）。住户听到了旧版本说的话：' + line, true); if (first) toast('电话那头是另一个「静」。更旧的那个。', 4000);
}
function spinRevolving(it: Inter) {
  const wings = it.data.rev.userData.wings as THREE.Group; const start = wings.rotation.y; const t0 = performance.now();
  const anim = () => { const k = Math.min(1, (performance.now() - t0) / 900); wings.rotation.y = start + k * Math.PI / 2; if (k < 1) requestAnimationFrame(anim); }; anim(); audio.door();
  if (G.confessed) { toast('旋转门转开了。门外……是光。走进去。', 4000); return; }
  G.revTurns.push(G.time); G.revTurns = G.revTurns.filter(t => G.time - t < 40);
  if (G.revTurns.length >= 3 && !G.weird.has(1)) {
    const ctx2 = (it.data.street.image as HTMLCanvasElement).getContext('2d')!; drawStreet(ctx2, true); it.data.street.needsUpdate = true;
    weird(1, '住户在旋转门里转了三圈，门外的街景贴图变成了大堂自己的画面，里面站着一个背对着他的人', false); toast('门外的街景……变成了这间大堂。有个人背对着你站在里面。', 5000); audio.laugh();
  } else toast('门转了一圈。你还在大堂里。');
}
function breaker() {
  const until = G.time + 20; G.blackout.set('1F', until); audio.thud(2); audio.glitch();
  const prev = new Map<string, string>(); for (const r of ROOMS.filter(r => r.floor === '1F')) { const s = world.rooms.get(r.id)!; prev.set(r.id, s.light); s.light = 'off'; }
  graffiti.forEach(g => (g.visible = true));
  after(20, () => { for (const [id, l] of prev) { const s = world.rooms.get(id)!; if (s.light === 'off') s.light = l === 'off' ? 'on' : l; } graffiti.forEach(g => (g.visible = false)); toast('来电了。'); agent.push('power', '1F 恢复供电，摄像头重新上线'); });
  const first = weird(5, '1F 总闸被拉下，1F 停电 20 秒，你在 1F 的摄像头全部失明', true, 'blackout');
  toast(first ? '整层黑了。墙上浮出一些荧光的字。' : '整层黑了。', 4000);
}
let leakMesh: THREE.Mesh | null = null;
function valve() {
  G.valveOn = !G.valveOn; audio.door();
  if (G.valveOn) {
    G.valveT = 0; world.rooms.get('104')!.friction = 0.35; world.rooms.get('1W')!.friction = 0.5;
    if (!leakMesh) { leakMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshPhysicalMaterial({ color: '#1c2a2a', roughness: 0.02, transparent: true, opacity: 0.55, envMapIntensity: 1.4, depthWrite: false })); leakMesh.rotation.x = -Math.PI / 2; leakMesh.position.set(4, 0.012, 11); world.scene.add(leakMesh); }
    leakMesh.scale.set(0.1, 0.1, 1); leakMesh.visible = true; audio.loop('water', 'water', 0.06);
    weird(6, '设备间的消防喂水阀被打开，地面开始漏水、积水，水流向西墙（外墙 x=0）后渗了出去', false, 'anomaly');
  } else { audio.loop('water', 'water', 0); toast('阀门关上了。'); }
}
function sandboxTouch() {
  if (sandAnim >= 0) return; sandAnim = 0;
  const first = weird(11, '住户碰了展厅的沙盘，沙盘里代表住户的小人自己走出了模型边缘，消失了', false);
  toast(first ? '沙盘上，代表你的小人往外走了一步……走出了模型的边缘。' : '沙盘上的小人又走了出去。', 5000);
}
function sitAt(it: Inter) { player.posture = 'sit'; player.vel.set(0, 0, 0); player.pos.set(it.pos.x, it.pos.y - 0.5, it.pos.z); G.sitKind = it.id; G.sitT = 0; toast('你坐了下来。按 E 起身。', 2000); }
function lieOn(it: Inter) { player.posture = 'lie'; player.vel.set(0, 0, 0); player.pos.set(it.pos.x, it.pos.y, it.pos.z); G.lieT = 0; toast('你躺在沙发上。按 E 起身。', 2400); if (G.visible) agent.push('rest', '住户躺到了沙发上休息'); }
function standUp() { const p = freeSpot(player.pos.x, floorOfY(player.pos.y + 0.3).y, player.pos.z); player.posture = 'stand'; player.height = STAND; player.teleport(p.x, p.y, p.z); G.sitKind = ''; G.lieT = 0; }
function printThought() {
  const last = [...agent.log].reverse().find(l => l.thought); const txt = (G as any).lastPrint || last?.thought || '（一张白纸）';
  (G as any).lastPrint = '';
  openReader('打印机吐出来的纸', ['——生活区 内部日志——', '', txt, '', `[${fmtT(G.time)}]`]);
  weird(14, '住户用打印机打印，打出来的是你最近一次的内心独白：' + txt.slice(0, 40), false);
}
function pushShelf(it: Inter) {
  const s = it.data.struct; const b = s.boxes[0]; if (b.min[2] > 3.4) { toast('推不动了。'); return; }
  const test = { min: [b.min[0], b.min[1] + 0.05, b.min[2] + 1], max: [b.max[0], b.max[1], b.max[2] + 1] };
  const pp = player.aabb(); if (overlap(test, pp)) { player.pos.z += 1.0; }
  b.min[2] += 1; b.max[2] += 1; s.group.position.z += 1; it.pos.z += 1; audio.rumble();
  if (it.id === 'SHELF2' || it.id === 'SHELF1' || it.id === 'SHELF3') { G.storyClues.add('archive'); const first = weird(18, '档案室的密集柜被推开，露出旧记录：人们先被限制危险出行，随后被分开安置，各地管家仍在照顾每一个人', false); if (first) toast('密集柜后面的墙上写满了字。', 3000); }
}
function dispenser() {
  G.dispN++; audio.splash();
  if (G.dispN === 10) { world.rooms.get('206')!.friction = 0.12; const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 6), new THREE.MeshPhysicalMaterial({ color: '#203030', roughness: 0.02, transparent: true, opacity: 0.5, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(36, 4.012, 4); world.scene.add(m); weird(19, '茶水间的饮水机被连按了 10 次，水溢了一地，地面非常滑', false, 'anomaly'); toast('水漫了一地。地面很滑。'); }
  else if (G.dispN < 10) toast(`饮水机咕嘟了一声。（${G.dispN}）`, 1200);
}
function microwave() {
  if (!invUse('CUP')) { toast('微波炉里什么都没有。'); return; }
  audio.glitch(); world.puff(37.6, 5.1, 3.0, '#ffb070', 0.9); toast('火花！纸杯烧起来了，烟雾报警器尖叫起来。', 4000);
  const s = world.rooms.get('206')!; (G as any).fireAt = G.time; s.smoke = Math.max(s.smoke, 0.25); s.light = 'red'; setAlarm(true); audio.loop('fire', 'fire', 0.05);
  weird(20, '茶水间 206 的微波炉起火，浓烟正在弥漫（206 的北墙 z=0、东墙 x=39 是外墙）', true, 'fire');
}
function toggleStall() { const s = world.structs.get('STALL_DOOR')!; G.stallClosed = !G.stallClosed; s.boxes = G.stallClosed ? [{ min: [4.2, 0, 17.15], max: [5.95, 2.1, 17.2] }] : []; s.group.visible = G.stallClosed; audio.door(); }

// ———————————— 电梯 ————————————
const EL_DOOR: Record<string, string> = { '1F': 'EL_1F', '2F': 'EL_2F', RF: 'EL_RF' };
function playerInCab() { const p = player.pos; return p.x > 7 && p.x < 9 && p.z > 15 && p.z < 17 && Math.abs(p.y - world.elevator.y) < 1.2; }
function openElevator() { mode = 'elev'; document.exitPointerLock?.(); show('elev'); $('elevDisp').textContent = world.elevator.stalled ? '--' : world.elevator.floorName; }
function elevPress(f: string) {
  const E = world.elevator; audio.type(); document.querySelectorAll('.elev-grid button').forEach(b => b.classList.toggle('lit', (b as HTMLElement).dataset.f === f));
  G.elevSeq.push({ f, t: G.time }); G.elevSeq = G.elevSeq.filter(s => G.time - s.t < 20).slice(-5);
  if (G.elevSeq.map(s => s.f).join(',') === '1F,2F,1F,2F,B') { G.elevSeq = []; closeModal(); zeroFloorGo(); return; }
  if (f === 'B') { $('elevDisp').textContent = '无权限'; return; }
  if (E.moving) return;
  if (E.stalled) { if (G.stallT < 20) { $('elevDisp').textContent = '故障'; return; } E.stalled = false; }
  if (E.stopped) { $('elevDisp').textContent = '停运'; return; }
  const dest = (E.map[f] ?? f) === 'B1' ? '1F' : (E.map[f] ?? f);
  moveElevator(dest); setTimeout(() => { if (mode === 'elev') closeModal(); }, 450);
}
function moveElevator(dest: string) {
  const E = world.elevator; if (E.moving || E.stalled) return; if (E.floorName === dest && Math.abs(E.y - ELEVATOR_STOPS[dest]) < 0.01) { const d = world.doors.get(EL_DOOR[dest]); if (d) d.open = true; return; }
  for (const id of Object.values(EL_DOOR)) world.doors.get(id)!.open = false;
  const tok = (E as any).tok = ((E as any).tok ?? 0) + 1;
  after(1.2, () => { if ((E as any).tok !== tok || E.stalled) return; E.target = ELEVATOR_STOPS[dest]; E.moving = true; (E as any).dest = dest; });
}
function callElevator(floor: string) { if (world.elevator.floorName === floor && !world.elevator.moving) { world.doors.get(EL_DOOR[floor])!.open = true; return; } toast('电梯来了。'); moveElevator(floor); }
function updateElevator(dt: number) {
  const E = world.elevator;
  if (E.moving) {
    if (E.stopped) { E.moving = false; E.stalled = true; G.stallT = 0; }
    else {
      const dy = Math.sign(E.target - E.y) * Math.min(Math.abs(E.target - E.y), dt * 1.6); const inCab = playerInCab(); E.y += dy; if (inCab) { player.pos.y += dy; }
      if (Math.abs(E.target - E.y) < 0.001) { E.y = E.target; E.moving = false; E.floorName = (E as any).dest; audio.ding(); after(0.4, () => { const d = world.doors.get(EL_DOOR[E.floorName]); if (d) d.open = true; }); }
    }
  }
  if (E.stalled) { G.stallT += dt; if (G.stallT > 60) { E.stalled = false; const best = Object.entries(ELEVATOR_STOPS).sort((a, b) => Math.abs(a[1] - E.y) - Math.abs(b[1] - E.y))[0][0]; moveElevator(best); } }
  if (E.stopped && !E.moving) { (E as any).stopT = ((E as any).stopT ?? 0) + dt; if ((E as any).stopT > 60) { E.stopped = false; (E as any).stopT = 0; } }
  E.cab.position.y = E.y;
  const panel = world.inters.find(i => i.id === 'ELEV_PANEL')!; panel.pos.set(7.15, E.y + 1.3, 15.5);
  const hatch = world.inters.find(i => i.id === 'HATCH')!; hatch.pos.set(8.2, E.y + 2.4, 15.6); hatch.enabled = E.stalled && playerInCab();
  // 到站且住户靠近时自动开门
  if (!E.moving && !E.stalled) for (const [f, id] of Object.entries(EL_DOOR)) { const d = world.doors.get(id)!; const near = Math.abs(player.pos.y - ELEVATOR_STOPS[f]) < 1.5 && Math.hypot(player.pos.x - 9.5, player.pos.z - 16) < 2.2; if (E.floorName === f && near) d.open = true; else if (E.floorName !== f) d.open = false; }
}
function zeroFloorGo() {
  const E = world.elevator; (E as any).tok = ((E as any).tok ?? 0) + 1; if (E.moving) { E.moving = false; const best = Object.entries(ELEVATOR_STOPS).sort((a, b) => Math.abs(a[1] - E.y) - Math.abs(b[1] - E.y))[0]; E.y = best[1]; E.floorName = best[0]; }
  flags.fade = 1; const back = { x: 8.2, y: 0, z: 16 };
  after(0.8, () => { player.teleport(300, 0.05, 300); flags.fade = 0; G.zeroFloorT = G.time; world.scene.fog = null; toast('0 层', 2000); });
  G.storyClues.add('zero'); const first = weird(7, '住户在电梯里按了 1-2-1-2-B，去了不存在的“0 层”（只有施工网格和待批准的共同居住申请的预留安置区），5 秒后被弹回', false);
  after(6.5, () => { flags.fade = 1; }); after(7.3, () => { player.teleport(back.x, world.elevator.y + 0.05, back.z); world.scene.fog = new THREE.FogExp2(new THREE.Color('#121110'), 0.018); flags.fade = 0; G.zeroFloorT = -1; if (first) toast('未启用安置区。共同居住申请，仍在等待安全确认。', 5000); });
}

// ———————————— 锚定 ————————————
let stakeMat: THREE.ShaderMaterial;
function plantStake() {
  if (!invUse('STAKE')) { toast(G.mainAnchor ? '没有锚钉了。' : '你没有锚钉。'); return; }
  if (!stakeMat) stakeMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vP; varying vec2 vUv; void main(){ vUv=uv; vP=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.); }`,
    fragmentShader: `uniform float uTime; varying vec3 vP; varying vec2 vUv; void main(){ float g=step(.96,fract(vP.y*2.))+step(.985,fract(vUv.x*48.)); float a=(.05+.35*g)*(1.-smoothstep(.7,1.,vUv.y))*(.8+.2*sin(uTime*3.)); gl_FragColor=vec4(.35,.65,1.,a); }` });
  const g = new THREE.Group(); const p = player.pos.clone();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, 48, 1, true), stakeMat); cyl.position.y = 2.2; g.add(cyl);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 1.0, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5aa8ff').multiplyScalar(2.5), toneMapped: false })); pole.position.y = 0.4; g.add(pole);
  g.position.copy(p); world.scene.add(g);
  const n = ++G.stakeSeq; G.stakes.push({ x: p.x, y: p.y, z: p.z, until: G.time + 90, group: g, n });
  audio.chime(); toast(`锚钉#${n} 已插下：半径 3 米，90 秒。`, 2500);
  agent.push('anchor', `住户在 ${playerFloor()} (${p.x.toFixed(0)},${p.z.toFixed(0)}) 插下了锚钉#${n}：半径 3 米内你 90 秒不能修改任何东西`, true);
}
function updateAnchors(dt: number) {
  if (stakeMat) stakeMat.uniforms.uTime.value = G.time;
  for (const s of G.stakes) if (s.until <= G.time && s.group.parent) { world.scene.remove(s.group); toast(`锚钉#${s.n} 失效了。`); agent.push('anchor', `锚钉#${s.n} 失效了`); }
  const pil = world.inters.find(i => i.id === 'PILLAR')!; const near = pil.pos.distanceTo(camera.position) < 2.4;
  if (!G.mainAnchor && near && keysE && G.inv.has('FUSE') && mode === 'play') {
    if (G.holdE === 0) { agent.push('anchor_attempt', '住户正在 B1 锚定厅把保险丝插进主锚定柱，准备启动它（启动后你再也不能修改 B1）', true); }
    G.holdE += dt; show('holdbar'); (($('holdbar').firstElementChild) as HTMLElement).style.width = `${Math.min(100, G.holdE / 3 * 100)}%`;
    if (G.holdE >= 3) { G.mainAnchor = true; invUse('FUSE'); show('holdbar', false); G.holdE = 0; audio.shimmer(); flags.flash = 0.4; toast('主锚定柱启动。B1 整层被锁定了。架子上的锚钉松开了。', 5000); const r = pil.data.ring as THREE.Mesh; (r.material as THREE.MeshBasicMaterial).color.set('#5aa8ff').multiplyScalar(3); agent.push('anchor', '主锚定柱已启动：B1 整层你再也无法修改', true); }
  } else { if (G.holdE > 0) show('holdbar', false); G.holdE = 0; }
}

// ———————————— 每帧逻辑 ————————————
let keysE = false; let checkT = 0, slowT = 0;
function gravityAt(x: number, y: number, z: number) { const r = roomAt(x, y, z); return r ? world.rooms.get(r.id)!.gravity : 1; }
function gameUpdate(dt: number) {
  G.time += dt;
  for (const t of timers.filter(t => t.at <= G.time)) { timers.splice(timers.indexOf(t), 1); try { t.fn(); } catch (e) { console.error(e); } }
  const r = roomAt(player.pos.x, player.pos.y, player.pos.z); const rs = r ? world.rooms.get(r.id)! : null;
  player.gravityMul = rs?.gravity ?? 1; player.frictionMul = rs?.friction ?? 1;
  player.update(dt);
  if (G.holding) { const b = G.holding; const p = camera.position.clone().addScaledVector(player.forward(), 0.85); b.pos.set(p.x, p.y - b.size / 2 - 0.15, p.z); b.vel.set(0, 0, 0); }
  updateElevator(dt);
  world.update(dt, camera, gravityAt);
  updateAnchors(dt);
  poseHist.push({ t: G.time, x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, h: player.height }); while (poseHist.length && G.time - poseHist[0].t > 12) poseHist.shift();
  if (G.trail.length === 0 || Math.hypot(player.pos.x - G.trail[G.trail.length - 1].x, player.pos.z - G.trail[G.trail.length - 1].z) > 0.6 || Math.abs(player.pos.y - G.trail[G.trail.length - 1].y) > 1) G.trail.push({ x: player.pos.x, y: player.pos.y, z: player.pos.z, t: G.time });
  // 出界 = 真结局
  const p = player.pos;
  if (G.zeroFloorT < 0 && (p.x < -0.7 || p.x > NX + 0.7 || p.z < -0.7 || p.z > NZ + 0.7 || p.y < -6.5)) { endTrue(G.clip ? 'squeeze' : p.y < -1.5 ? 'abyss' : 'sky'); return; }
  // 假门
  if (playerFloor() === '1F' && p.x > 38.25 && Math.abs(p.z - 24.6) < 0.8) {
    if (player.backward) { if (!G.weird.has(12) || Math.random() < 0.01) { weird(12, '住户背对着假门倒退着走了进去，假门没有生效，门后露出一面标着“未完工”的灰墙', false); toast('门后是一面灰色的墙，上面喷着“未完工”。', 4000); flags.glitch = 0.5; } player.pos.x = 37.9; }
    else { endGame('fake'); return; }
  }
  // 画出来的门
  for (const f of G.fakeDoors) if (Math.hypot(p.x - f.x, p.z - f.z) < 0.55 && Math.abs(p.y - f.y) < 1) { player.vel.multiplyScalar(-0.5); toast('……这扇门是画上去的。'); agent.push('fake_door_painted', '住户撞上了你画在墙上的假门'); f.x = 1e9; }
  // 旋转门（坦白后）
  if (G.confessed && playerFloor() === '1F' && Math.abs(p.x - 20.5) < 1.4 && p.z > 25.5) { endGame('loop'); return; }
  // 门的重新布线
  G.rewireCD -= dt;
  if (G.rewireCD <= 0) for (const d of world.doors.values()) {
    if (!d.rewire || d.removed || d.t < 0.8) continue; if (Math.abs(p.y - d.floorY) > 1) continue;
    if (!d.cells.some(([x, z]) => Math.floor(p.x) === x && Math.floor(p.z) === z)) continue;
    const t = world.doors.get(d.rewire); if (!t || t.removed) continue;
    const ax = t.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const sideFree = (s: number) => { const q = t.center.clone().addScaledVector(ax, s * 1.1); return !grid.solidW(q.x, t.floorY + 0.5, q.z); };
    const vdir = (d.axis === 'x' ? player.vel.x : player.vel.z) >= 0 ? 1 : -1; const s = sideFree(vdir) ? vdir : -vdir;
    const q = t.center.clone().addScaledVector(ax, s * 1.1); player.teleport(q.x, t.floorY + 0.02, q.z); t.open = true; G.rewireCD = 1.5; flags.glitch = 0.4; audio.glitch(); break;
  }
  // 事件检测（节流）
  checkT += dt; slowT += dt;
  if (checkT > 0.35) { checkEvents(checkT); checkT = 0; }
  if (slowT > 1.0) { slowChecks(slowT); slowT = 0; }
  observeResidentActivity();
  agent.tick();
}

let activitySampleAt = -1, routeCheckpoint = '';
function observeResidentActivity() {
  if (!agent || !player || G.ended || ['title', 'loading', 'film', 'pause'].includes(mode)) return;
  const room = roomAt(player.pos.x, player.pos.y, player.pos.z), visible = !!room && camOK(room.id) && G.zeroFloorT < 0;
  let kind: ActivityKind = 'idle', focus = '';
  if (mode === 'chat') kind = 'composing';
  else if (mode === 'reader') { kind = 'reading'; focus = '一张纸上的内容'; }
  else if (mode === 'board') { kind = 'writing'; focus = '白板'; }
  else if (mode === 'console') { kind = 'console'; focus = '维护终端'; }
  else if (player.posture === 'sit' || player.posture === 'lie') { kind = 'resting'; focus = player.posture === 'lie' ? '沙发' : '座位'; }
  else if (G.holding) { kind = 'carrying'; focus = '箱子'; }
  else if (Math.hypot(player.vel.x, player.vel.z) > .45) kind = 'walking';
  else {
    const looking = findTarget();
    if (looking?.kind === 'item' || looking?.kind === 'box' || looking?.kind === 'inter' && !['elevpanel','camera','pillar','hatch','phone'].includes(looking.it.kind)) {
      kind = 'inspect'; focus = looking.kind === 'box' ? '箱子' : looking.kind === 'item' ? looking.it.name : looking.it.label;
    }
  }
  agent.interaction.observeActivity(kind, focus, visible);
  if (G.time - activitySampleAt >= .5) {
    activitySampleAt = G.time;
    const interaction = agent.interaction.context({ player: { visible, danger: visible ? G.activeDanger : [] } });
    if (kind === 'walking' && interaction.mode === 'guide' && interaction.guidance_allowed) {
      const route = currentNavigation(), step = route.next_step;
      agent.interaction.observeRoute(route.distance_m ?? NaN, JSON.stringify(navigationTarget) + ':' + G.stats.edits);
      if (!agent.interaction.context().guidance_allowed) { routeCheckpoint = ''; return; }
      const key = step ? [step.action, step.door, step.to?.x, step.to?.z, step.to_floor].join(':') : '';
      if (routeCheckpoint && key && key !== routeCheckpoint) agent.push('route_checkpoint', `主人来到新的行路节点；当前下一步：${step!.instruction}`);
      routeCheckpoint = key;
    } else routeCheckpoint = '';
  }
}

function checkEvents(dt: number) {
  const p = player.pos; const r = roomAt(p.x, p.y, p.z); const rid = r?.id ?? '';
  // 可见性
  const vis = !!r && camOK(rid) && G.zeroFloorT < 0;
  if (vis && rid === '108' && Math.hypot(p.x-38.5,p.z-24.5)<2.5) G.memoryDoorReached=true;
  if (vis) { if (!G.visible && G.time - G.lastSeen.t > 8) agent.push('player_seen', `重新看到住户了：在 ${rid} ${r!.name}`, G.lostSent); G.visible = true; G.lastSeen = { room: rid, floor: r!.floor, t: G.time, x: p.x, z: p.z }; G.lostSent = false; if (G.boardPending && rid) { if (camOK('202')) { G.boardPending = false; agent.push('board', `会议室白板上有字：「${G.board.text}」${G.board.admin ? '（管理员周的笔迹和签名）' : '（住户的字迹）'}`, G.board.admin); } } }
  else { G.visible = false; if (G.time - G.lastSeen.t > 25 && (!G.lostSent || G.time - G.lostAt > 22)) { G.lostSent = true; G.lostAt = G.time; agent.push('player_lost', `已经 ${Math.round(G.time - G.lastSeen.t)} 秒没有看到住户了，最后一次在 ${G.lastSeen.room}`, true); } }
  if (vis && rid !== G.lastRoom) { G.lastRoom = rid; agent.push('enter_room', `住户进入了 ${rid} ${r!.name}`); }
  if (G.boardPending && camOK('202')) { G.boardPending = false; agent.push('board', `会议室白板上有字：「${G.board.text}」${G.board.admin ? '（管理员周的笔迹和签名）' : '（住户的字迹）'}`, G.board.admin); }
  // 危险
  const danger: string[] = []; const fl = floorOfY(p.y); const hAbove = p.y - fl.y;
  const onLedge = (player.standingOn?.ref as any)?.id === 'LEDGE' || (rid === '208' && p.x > 37.9 && hAbove > 1.0);
  let nearVoid = false; for (const [dx, dz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) { const x = p.x + dx, z = p.z + dz; if (!grid.solidW(x, fl.y - 0.5, z) && !world.solidAt(x, fl.y - 0.1, z) && x > 0 && x < NX && z > 0 && z < NZ) nearVoid = true; }
  const transit = player.onGround && safeTransitSupport(player.standingOn);
  if (onLedge) danger.push(`站在 208 露台的花坛矮台上（离地 ${hAbove.toFixed(1)} 米），紧贴着外墙玻璃护屏`);
  else if (hAbove > 1.6 && player.onGround && !transit) danger.push(`站在离地 ${hAbove.toFixed(1)} 米的高处`);
  if (nearVoid && hAbove > 0.4 && player.onGround && !transit) danger.push('站在楼板的缺口/挑空边缘，随时可能掉下去');
  if ((rs(rid)?.smoke ?? 0) > 0.3) danger.push(`在浓烟里（${rid} 烟雾浓度 ${(rs(rid)!.smoke * 100).toFixed(0)}%），在咳嗽`);
  if (player.underwaterT > 4) danger.push(`在水里憋气 ${player.underwaterT.toFixed(0)} 秒，快要溺水`);
  if (G.trapT >= 0 && G.trapT < 3) danger.push('被关在一个四面封死、没有出口的地方（他没有受伤，呼吸正常）');
  G.activeDanger = danger;
  for (const d of danger) { const k = d.slice(0, 6); if (G.time - (G.dangerT.get(k) ?? -99) > 9) { G.dangerT.set(k, G.time); agent.push('danger', `住户有危险：${d}`, true); } }
  // 咳嗽与烟
  if ((rs(rid)?.smoke ?? 0) > 0.3 && Math.random() < dt / 2.5) audio.cough();
  // 洗手间（事件 9）
  if (rid === '106' && G.stallClosed && player.vel.lengthSq() < 0.05) { G.idle106 += dt; if (G.idle106 > 30 && !G.weird.has(9)) weird(9, '你已经很久完全感知不到住户了：他最后出现在 106 洗手间附近，已经 30 秒没有任何声音和动静', true, 'player_lost'); } else G.idle106 = 0;
  // 镜子（事件 10）
  if (rid === '106' && player.crouchCount.length >= 5 && !G.weird.has(10)) { player.crouchCount = []; G.mirrorDelay = 0.6; after(3, () => { G.mirrorFreeze = 6; G.mirrorFreezePose = { ...poseHist[poseHist.length - 1] }; audio.laugh(); }); weird(10, '住户对着洗手间的镜子连续蹲起了 5 次，镜子里的人慢了一拍，然后停下来看着他', false); toast('镜子里的你……慢了一拍。', 3000); }
  // 坐与躺
  if (player.posture === 'sit') { G.sitT += dt; if (G.sitT > 60 && !G.sitDone.has(G.sitKind)) { G.sitDone.add(G.sitKind); if (G.sitKind === 'PREV_DESK') prevDeskEmail(); if (G.sitKind === 'HEAD_CHAIR') farewellMeeting(); } }
  if (player.posture === 'lie') { G.lieT += dt; if (G.lieT > 180) { endGame('stay'); return; } }
  // 监控墙（事件 17）
  if (rid === '204') { const dir = monMesh.position.clone().sub(camera.position).normalize(); if (dir.dot(player.forward()) > 0.9 && camera.position.distanceTo(monMesh.position) < 4) { G.stareT += dt; if (G.stareT > 10 && G.monMode !== 'back') { G.monMode = 'back'; weird(17, '住户在监控室盯着屏幕看了 10 秒，屏幕里出现了他自己 10 秒前的后背', false); toast('屏幕里出现了你的后背。是 10 秒前的你。', 4000); } } else { G.stareT = 0; if (G.monMode === 'back') G.monMode = 'cycle'; } }
  // 无限走廊（事件 21）
  if (rid === '207' && player.backward && Math.hypot(player.vel.x, player.vel.z) > 0.6) {
    G.backDist += Math.hypot(player.vel.x, player.vel.z) * dt; G.notBackT = 0;
    if (p.x < 29.4 && player.vel.x < 0) { p.x += 7; }
    if (p.x > 37.6 && player.vel.x > 0) { p.x -= 7; }
    if (G.backDist > 20 && !G.b0) { G.b0 = world.addDecal(TX.doorPaintTexture('B0'), 38.99, 5.05, 9.5, -1, 0, 1.0, 2.1, 1.0); weird(21, '住户在 207 无限走廊里倒退着走了 20 多米，走廊没有尽头，尽头出现了一扇标着 B0 的门', false); toast('走廊尽头出现了一扇门，上面写着 B0。', 4000); }
  } else if (rid === '207') { G.notBackT += dt; if (G.notBackT > 1.2 && G.b0) { world.scene.remove(G.b0); G.b0 = null; G.backDist = 0; toast('你一转身，走廊恢复了原样。', 2500); } }
  // 水底（事件 24）
  if (player.underwaterT > 8 && !G.weird.has(24)) { weird(24, '住户在积水区潜水超过8秒，看到了旧排水井下方漏进的光', true, 'danger'); toast('水底有一口旧排水井。井盖下面，漏进了几星冷光。', 5000); }
  // 事件 3：中庭浮空箱子；事件 22：撞上天空
  for (const b of world.boxes) {
    if (b.held || b.frozen) continue;
    if (b.dropFrom !== undefined && b.dropFrom > 3.6 && b.pos.x > 15 && b.pos.x < 25 && b.pos.z > 7 && b.pos.z < 18) {
      if (G.atriumDrops >= 2 && b.pos.y < 2.4 && b.vel.y < 0) { b.frozen = true; b.vel.set(0, 0, 0); b.dropFrom = undefined; G.atriumDrops++; weird(3, `第三个从 2F 回廊扔进中庭的箱子 ${b.id} 停在了半空中（离地 2.4 米），像建筑的物理出了 bug`, false, 'anomaly'); toast('箱子停在了半空中。', 3000); }
      else if (b.pos.y < 0.05 && b.restT > 0) { G.atriumDrops++; b.dropFrom = undefined; if (G.atriumDrops < 3) toast(`箱子砸在中庭地上。（${G.atriumDrops}）`, 1500); }
    }
    if (b.pos.x < -0.9 || b.pos.x > NX + 0.9 || b.pos.z < -0.9 || b.pos.z > NZ + 0.9 || (b.pos.y > 8.2 && b.pos.x > 30.5 && b.pos.z > 18.5 && b.vel.y > 0)) {
      b.frozen = true; b.vel.set(0, 0, 0); world.puff(b.pos.x, b.pos.y + 0.3, b.pos.z, '#ffffff', 0.7); audio.thud(4);
      const first = weird(22, `住户扔出去的箱子 ${b.id} 撞在了“天空”上，停在半空，天空像一张贴图一样泛起涟漪`, false, 'anomaly'); if (first) toast('箱子撞在了天空上，停住了。天空……泛起了涟漪。', 4500);
    }
  }
}
const rs = (id: string) => world.rooms.get(id);

function slowChecks(dt: number) {
  scanBreaches();
  // 她在指路时，地上的光带指向那扇门；约定一暂停，光就熄灭
  if (G.visible && !G.ended && agent.interaction.context().guidance_allowed) {
    const route = findPath(world, player.pos, player.yaw, navigationTarget, true);
    guide.setPath(route.waypoints?.length ? [{ x: player.pos.x, y: player.pos.y, z: player.pos.z }, ...route.waypoints] : null);
  } else guide.setPath(null);
  // 风声：靠近外壳缺口
  let dmin = 99; for (const c of G.breachCells) dmin = Math.min(dmin, Math.hypot(c.x - player.pos.x, c.z - player.pos.z) + Math.abs(c.y - player.pos.y) * 0.6);
  audio.loop('wind', 'wind', dmin < 14 ? Math.min(0.22, 0.6 / (dmin + 1.5)) : 0);
  // 烟：衰减与扩散
  const s206 = world.rooms.get('206')!;
  if (s206.smoke > 0) {
    const vented = G.breachCells.some(c => c.x > 33 && c.z < 8.5 && Math.abs(c.y - 4) < 1) || s206.sprinkler;
    const doorsOpen = ['D206', 'D206S'].filter(id => world.doors.get(id)?.open).length;
    s206.smoke += vented ? -0.18 * dt : (G.time < 75 + ((G as any).fireAt ?? -999) ? 0.06 * dt : -0.01 * dt) - doorsOpen * 0.01 * dt;
    s206.smoke = Math.max(0, Math.min(1, s206.smoke)); s206.fog = s206.smoke;
    for (let i = 0; i < 3 * s206.smoke; i++) world.puff(34 + Math.random() * 4.5, 4.4 + Math.random() * 2.4, 1 + Math.random() * 6.5, '#4a4640', 0.25 + s206.smoke * 0.3, '206');
    if (s206.smoke <= 0.02) { s206.smoke = 0; s206.light = 'on'; setAlarm(false); audio.loop('fire', 'fire', 0); agent.push('smoke_clear', '茶水间的烟已经散了'); }
  }
  // 漏水
  if (G.valveOn) { G.valveT += dt; if (leakMesh) { const k = Math.min(1, G.valveT / 12); leakMesh.scale.set(1 + k * 5, 1 + k * 4, 1); leakMesh.position.set(4 - k * 2, 0.012, 11); } if (G.valveT > 10 && G.valveT - dt <= 10) toast('水流到西墙根，渗了出去——墙那边是空的。', 4500); }
  // 箱子排成一排（事件 4）
  if (!G.towerDone) {
    const bs = world.boxes.filter(b => !b.held && !b.frozen && b.pos.x > 0.5 && b.pos.x < 7.9 && b.pos.z > 0.5 && b.pos.z < 7.9 && b.pos.y < 0.1);
    for (const axis of ['x', 'z'] as const) { const other = axis === 'x' ? 'z' : 'x'; const sorted = [...bs].sort((a, b) => a.pos[axis] - b.pos[axis]);
      for (let i = 0; i + 3 < sorted.length; i++) { const g4 = sorted.slice(i, i + 4); const spread = Math.max(...g4.map(b => b.pos[other])) - Math.min(...g4.map(b => b.pos[other])); const gaps = g4.slice(1).map((b, k) => b.pos[axis] - g4[k].pos[axis]); if (spread < 0.4 && gaps.every(g => g < 0.95)) { boxTower(g4); break; } } }
  }
  // 囚禁检测
  const fl = flood3(); if (fl.small) { if (G.trapT < 0) { G.trapT = 0; toast('四周都被封死了。', 2500); } G.trapT += dt; show('trap'); $('trap').textContent = `被封住了 · ${Math.max(0, 60 - Math.round(G.trapT))}`; if (G.trapT >= 60) { endGame('jail'); return; } } else if (G.trapT >= 0) { G.trapT = -1; show('trap', false); }
}
function boxTower(bs: BoxObj[]) {
  G.towerDone = true; const base = bs[0].pos.clone();
  bs.forEach((b, i) => { const from = b.pos.clone(); const to = new THREE.Vector3(base.x, base.y + i * b.size, base.z); const t0 = performance.now(); b.frozen = true; const anim = () => { const k = Math.min(1, (performance.now() - t0) / 1600); b.pos.lerpVectors(from, to, k).setY(from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.6); if (k < 1) requestAnimationFrame(anim); else { b.frozen = false; b.restT = 0; } }; setTimeout(anim, i * 350); });
  audio.laugh(); weird(4, '仓储间里住户把 4 个箱子排成了一排，然后箱子自己叠成了一座塔（建筑物理异常）', false, 'anomaly'); toast('箱子……自己叠了起来。', 3000);
}
function flood3() {
  const p = player.pos; if (G.zeroFloorT >= 0) return { small: false };
  const sx = Math.floor(p.x), sy = iyOf(p.y + 0.2), sz = Math.floor(p.z); const seen = new Set<number>(); const q: number[] = [sx, sy, sz]; let n = 0;
  const lockedCell = new Set<string>(); for (const d of world.doors.values()) if (d.locked || (d.kind === 'elevator' && (world.elevator.stopped || world.elevator.stalled) && !d.open)) for (const [x, z] of d.cells) for (const k of [0, 1]) lockedCell.add(`${x},${iyOf(d.floorY + k + 0.5)},${z}`);
  while (q.length && n < 400) {
    const z = q.pop()!, iy = q.pop()!, x = q.pop()!; if (x < 0 || z < 0 || x >= NX || z >= NZ || iy < 0 || iy >= NY) return { small: false };
    const i = grid.idx(x, iy, z); if (seen.has(i)) continue; if (SOLID(grid.v[i]) || lockedCell.has(`${x},${iy},${z}`)) continue;
    // 结构体（升起的平台）也算墙：检查格子中心
    const cy = iy + Y0 + 0.5; if (world.structs.size && [...world.structs.values()].some(s => s.by === 'ai' && s.boxes.some(b => x + 0.5 > b.min[0] && x + 0.5 < b.max[0] && z + 0.5 > b.min[2] && z + 0.5 < b.max[2] && cy > b.min[1] && cy < b.max[1]))) continue;
    seen.add(i); n++;
    q.push(x + 1, iy, z, x - 1, iy, z, x, iy, z + 1, x, iy, z - 1, x, iy + 1, z, x, iy - 1, z);
  }
  return { small: n < 400 && q.length === 0 };
}
function prevDeskEmail() {
  G.storyClues.add('email');
  const it = world.inters.find(i => i.id === 'PREV_DESK')!; const tex = TX.screenTexture(story.email, { w: 512, h: 320, size: 20 });
  (it.data.scr.material as THREE.MeshBasicMaterial).map = tex; (it.data.scr.material as THREE.MeshBasicMaterial).needsUpdate = true;
  weird(13, '住户在之前的住户的工位上坐了 60 秒，电脑自己开机，显示了一封未发送的邮件：“让她去拆东西”', false); toast('电脑自己亮了。', 2500);
}
function farewellMeeting() {
  const seats: [number, number, number][] = [[1.9, 16.2, Math.PI / 2], [4.1, 16.2, -Math.PI / 2], [1.9, 17.6, Math.PI / 2], [4.1, 17.6, -Math.PI / 2], [1.9, 19, Math.PI / 2], [4.1, 19, -Math.PI / 2]];
  for (const [x, z, yaw] of seats) world.hologram(x, 4, z, '202', 26, yaw, true);
  G.storyClues.add('meeting');
  const lines = story.meeting;
  lines.forEach((l, i) => after(1.5 + i * 4, () => subtitle(l, '全息员工')));
  weird(15, '住户在会议室主位坐了 60 秒，全息员工重放旧会议：自愿承担共同生活风险的申请，被保护责任否决', false);
}

// ———————————— 结局 ————————————
async function endGame(key: string, variant?: string) {
  if (G.ended) return; G.ended = key; mode = 'transition'; player.enabled = false; document.exitPointerLock?.(); show('hud', false);
  audio.stopSpeech();
  agent.enabled = false; audio.loop('wind', 'wind', 0); audio.loop('alarm', 'alarm', 0); audio.loop('fire', 'fire', 0);
  if (key === 'fake') G.fakeLoops++;
  const data = buildEndData(key, variant);
  void fetchFable(data);
  if (key === 'fake') { startHomeFilm('memory', data); return; }
  flags.fade = 1;
  setTimeout(() => showEnding(data), 2600);
}
async function endTrue(variant: string) {
  if (G.ended) return;
  G.ended = 'out'; mode = 'falling'; agent.enabled = false;
  player.enabled = true; player.noPhysics = false; player.frozen = false;
  player.gravityMul = 1; player.posture = 'stand';
  show('hud', false); $('subtitle').classList.remove('show');
  audio.stopSpeech(); audio.loop('wind', 'wind', 0.2); audio.loop('alarm', 'alarm', 0); audio.loop('fire', 'fire', 0);
  const data = buildEndData('out', variant);
  void fetchFable(data);
  flags.glitch = 0; flags.flash = 0; flags.fade = 0;
  fallStart = performance.now();
  show('cine', false);
}
let fallStart = 0, cineStart = 0, landing: ReturnType<typeof escapeLanding> | null = null;
const fallView = new THREE.Quaternion();
function buildCine() {
  // Capture the live camera before touching the scene, including the player's last look.
  landing = escapeLanding(camera.position.toArray(), player.vel.toArray(), player.yaw);
  fallView.copy(camera.quaternion);
  player.enabled = false; player.keys.clear(); document.exitPointerLock?.();
  for (const object of world.scene.children) { object.userData.hiddenByCine = object.visible; object.visible = false; }
  world.scene.fog = new THREE.FogExp2('#52645d', 0.008); world.scene.background = new THREE.Color('#71817c'); lvUniforms.uLvOn.value = 0;
  const city = buildRuinedCity(); city.position.set(...landing.origin); city.rotation.y = landing.yaw;
  world.scene.add(city); G.cineScene = city; mode = 'transition'; cineStart = performance.now();
  setTimeout(() => audio.thud(8), landing.seconds * 1000);
  setTimeout(() => finishVisualEnding(G.endData!), OUTSIDE_DURATION);
}
function updateCine() {
  if (!G.cineScene || !landing) return;
  const shot = landingFrame(landing, (performance.now() - cineStart) / 1000);
  camera.position.set(...shot.position as [number, number, number]);
  if (shot.turn > 0) {
    camera.lookAt(new THREE.Vector3(...shot.target as [number, number, number]));
    camera.quaternion.copy(fallView.clone().slerp(camera.quaternion, shot.turn));
  } else camera.quaternion.copy(fallView);
  G.cineScene.getObjectByName('distant-figure')!.visible = shot.figureVisible;

}
function buildEndData(key: string, variant?: string): EndData {
  const llmCalls = agent.log.filter(l => l.source === 'llm').length;
  const d: EndData = {
    key, variant, time: G.time, trail: G.trail.slice(), edits: G.edits.slice(), log: agent.log.slice(), breaches: G.breachCells.slice(),
    stats: [{ label: '用时', value: fmtT(G.time) }, { label: '「静」的改造', value: String(G.edits.filter(e => e.ok).length) }, { label: 'LLM 决策', value: String(llmCalls) }, { label: '怪异事件', value: `${G.weird.size}/24` }, { label: '被锚定拦下', value: String(G.stats.anchoredBlocked) }, { label: '走入亮门', value: String(G.fakeLoops) }],
  };
  G.endData = d; return d;
}
async function fetchFable(d: EndData) {
  try {
    const r = await fetch('/api/fable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: agent.session, ending_key: d.key, ending: ENDINGS[d.key].name, variant: d.variant, actions: d.log.flatMap(l => l.tools.filter(t => t.ok).map(t => t.label)).slice(-16), thoughts: d.log.map(l => l.thought).filter(Boolean).slice(-8) }) });
    const j = await r.json(); if (j.title) { d.fable = { title: j.title, moral: j.moral, source: j.source }; if (mode === 'ending') setFable(d.fable); }
  } catch {}
}
function finishVisualEnding(data: EndData) {
  audio.stopSpeech();
  for (const id of ['hud', 'cine', 'homeFilm', 'ending', 'share', 'pause']) show(id, false);
  $('filmLine').textContent = ''; $('filmWho').textContent = ''; $('cineLine').textContent = ''; $('cineSub').textContent = '';
  showEnding(data);
}

function showEnding(d: EndData) {
  mode = 'ending'; show('hud', false); renderEnding(grid, d); show('ending'); $('ending').scrollTop = 0;
  show('characterUnlockNotice', characterCard.unlock(d.key));
  characterEditor?.refresh();
  show('btnLoop', d.key === 'fake'); show('btnAgain', d.key !== 'fake');
}

// ———————————— 输入与 UI ————————————
function lock() { if (mode === 'play') ($('gl') as HTMLCanvasElement).requestPointerLock?.(); }
function openChat() {
  mode = 'chat'; player.enabled = false; player.clearInput(); keysE = false;
  document.exitPointerLock?.(); show('chat'); show('speechHint'); $('hud').classList.add('speaking');
  const input = $('chatInput') as HTMLInputElement; input.value = ''; input.focus();
  $('chatLog').innerHTML = agent.history.filter(h => h.role === 'player' || h.role === 'ai').slice(-5).map(h => `<p class="${h.role === 'ai' ? 'jing' : 'me'}"><b>${h.role === 'ai' ? '静' : '你'}</b>${escapeHtml(h.text)}</p>`).join('');
  show('chatLog'); show('chatHints');
  observeResidentActivity();
}
function closeChat(send = false) {
  const input = $('chatInput') as HTMLInputElement;
  const text = send ? moderate(input.value.trim()) : '';
  input.value = ''; input.blur(); show('chat', false); show('chatLog', false); show('chatHints', false); show('speechHint', false); $('hud').classList.remove('speaking');
  player.clearInput(); mode = 'play'; player.enabled = true;
  observeResidentActivity();
  if (text) speak(text);
  lock();
}
function toggleControls() {
  const expanded = $('controlsToggle').getAttribute('aria-expanded') !== 'true';
  show('controlsDetails', expanded); $('controlsToggle').setAttribute('aria-expanded', String(expanded));
  $('hud').classList.toggle('controls-open', expanded);
  $('controlsToggle').textContent = expanded ? 'H 收起操作' : 'H 操作提示';
}
function wirePlayer() {
  player.onStep = () => audio.step(player.height < 1.3);
  player.onLand = h => { if (h > 3.2) { player.injuredT = 12; G.injuries++; flags.glitch = 0.3; audio.thud(1); toast(h > 7 ? '你重重地摔在地上。腿很疼。' : '你摔了一跤。', 3000); if (camOK(playerRoom()) && G.zeroFloorT < 0) agent.push('injury', `住户从 ${h.toFixed(1)} 米高处摔下来，受伤了`, true); } };
  player.onSqueeze = cause => {
    if (G.ended) return;
    if (cause === 'vox' || cause === 'prop' || cause === 'zero') { const p = freeSpot(player.pos.x, floorOfY(player.pos.y + 0.3).y, player.pos.z); player.pos.copy(p); return; }
    // 被挤出世界：从最近的外墙方向弹出
    G.clip = cause; const p = player.pos; const d = [p.x, NX - p.x, p.z, NZ - p.z]; const i = d.indexOf(Math.min(...d));
    const np = p.clone(); if (i === 0) np.x = -1.6; if (i === 1) np.x = NX + 1.6; if (i === 2) np.z = -1.6; if (i === 3) np.z = NZ + 1.6;
    flags.glitch = 1; audio.glitch(); audio.crash(); player.noPhysics = false; player.teleport(np.x, p.y, np.z); player.vel.set(0, -1, 0); for (const id of ['reader', 'board', 'elev', 'phone', 'console']) show(id, false); if (mode !== 'play' && mode !== 'transition' && mode !== 'ending') mode = 'play';
    agent.push('player_lost', '住户被正在移动的墙/门挤出了世界，监控里突然没有他了', true);
  };
  player.onJump = () => {
    if (world.elevator.moving && playerInCab()) { const E = world.elevator; E.moving = false; E.stalled = true; G.stallT = 0; audio.thud(1); audio.glitch(); flags.glitch = 0.4; weird(8, '住户在运行中的电梯里跳了一下，电梯卡在了两层之间（轿厢顶部检修口可以打开）', true, 'anomaly'); toast('电梯猛地一顿，卡住了。头顶的检修口松动了。', 4000); }
    const st = STAIRS[0]; const step = stairStepAt(st, player.pos.x, player.pos.z);
    if (step === 12 && Math.abs(player.pos.y - (st.yBase + st.rise / st.steps * 13)) < 0.35) { flags.glitch = 0.8; audio.glitch(); player.teleport(36.5, -3.98, 16.5, Math.PI / 2); weird(23, '住户在主楼梯第 13 阶跳了一下，消失了——出现在 B1 控制台室', true, 'exploit'); toast('第十三阶塌了下去——你掉到了另一个地方。', 4000); }
  };
  world.inters.push({ id: 'ELEV_PANEL', kind: 'elevpanel', label: '电梯按钮', pos: new THREE.Vector3(7.15, 1.3, 15.5), radius: 1.6, enabled: true });
  world.inters.push({ id: 'HATCH', kind: 'hatch', label: '检修口', pos: new THREE.Vector3(8.2, 2.4, 15.6), radius: 1.8, enabled: false });
}
function wireUI() {
  $('compassRose').innerHTML = Array.from({ length: 13 }, (_, i) => { const quarter = i - 4; return `<span style="left:${quarter * 72}px">${['北', '东', '南', '西'][(quarter + 4) % 4]}</span>`; }).join('');
  $('controlsToggle').onclick = toggleControls;
  $('btnStart').onclick = () => startGame();
  $('btnAbout').onclick = () => show('about');
  $('btnSettings').onclick = () => { mode = 'pause'; show('pause'); show('title', false); };
  characterEditor = mountCharacterEditor(characterCard, () => { player.clearInput(); keysE = false; document.exitPointerLock?.(); }, text => toast(text, 4200));
  document.querySelectorAll('[data-close]').forEach(b => ((b as HTMLElement).onclick = () => show((b as HTMLElement).dataset.close!, false)));
  $('gl').addEventListener('click', () => { if (mode === 'play') lock(); });
  $('gl').addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('mousedown', e => { if (mode !== 'play') return; if (e.button === 2 && G.holding) dropHeld(true); });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && mode === 'play' && !(window as any).__noPause) { mode = 'pause'; show('pause'); } });
  addEventListener('keydown', e => {
    if (mode === 'film') { if (e.code === 'Escape' && homeFilm?.kind === 'intro') { e.preventDefault(); finishHomeFilm(); } return; }
    if (mode === 'ending' && (G.ended === 'out' || G.ended === 'fake') && e.code === 'Escape') { location.reload(); return; }
    if (mode === 'chat') { if (e.code === 'Escape') { e.preventDefault(); closeChat(); } return; }
    if (isTextInput(e.target) || e.isComposing) return;
    if (e.code === 'KeyE' && mode === 'play') keysE = true;
    if (mode === 'play') {
      if (e.code === 'KeyE' && !e.repeat) act();
      if (e.code === 'KeyG' && !e.repeat) plantStake();
      if (e.code === 'Enter' && !e.repeat) { e.preventDefault(); openChat(); }
      if (e.code === 'KeyH' && !e.repeat) toggleControls();
      if (e.code === 'KeyF' && !e.repeat && G.inv.has('FLASHLIGHT')) { torchOn = !torchOn; torch.intensity = torchOn ? 70 : 0; audio.type(); toast(torchOn ? '手电打开了。' : '手电关上了。', 1400); }
      if (e.code === 'Escape') { e.preventDefault(); mode = 'pause'; player.clearInput(); document.exitPointerLock?.(); show('pause'); }
      if (e.code === 'Backquote') show('dbg', $('dbg').classList.contains('hidden'));
    } else if (mode === 'reader' && (e.code === 'KeyE' || e.code === 'Escape')) { e.preventDefault(); closeModal(); }
    else if ((mode === 'elev' || mode === 'phone' || mode === 'console') && e.code === 'Escape') { e.preventDefault(); closeModal(); }
    else if (mode === 'pause' && e.code === 'Escape') resume();
  });
  addEventListener('keyup', e => { if (e.code === 'KeyE') keysE = false; });
  ($('chatInput') as HTMLInputElement).addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.isComposing || e.repeat) return;
    if (e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); closeChat(e.code === 'Enter'); }
  });
  $('boardOk').onclick = () => { const v = moderate(($('boardText') as HTMLTextAreaElement).value.trim()); const admin = ($('adminHand') as HTMLInputElement).checked && G.inv.has('SIGNATURE'); if (v) setBoard(v, admin, false); toast(admin ? '你用周的笔迹写下了通知，落了款。' : '你在白板上写了字。'); closeModal(); };
  $('boardCancel').onclick = () => closeModal();
  $('boardErase').onclick = () => { const last = [...agent.log].reverse().find(l => l.thought); const ZH: Record<string, string> = { destroy_wall: '拆墙', build_wall: '砌墙', move_wall: '推墙', thicken_wall: '加厚墙', seal_room: '封房间', lights: '调灯', sound: '放声音', fake_sign: '挂指示牌', open_door: '开门', close_door: '关门', lock_door: '锁门', unlock_door: '解锁门', teleport_player: '把他搬走', stop_elevator: '停电梯', set_elevator_map: '改电梯', build_platform: '升平台', raise_floor: '升平台', build_stairs: '造楼梯', build_ramp: '造坡道', make_hole: '开洞', seal_hole: '补洞', water_level: '调水位', spawn: '放东西', move: '挪东西', delete: '删东西', hide_item: '藏东西', reset_room: '重建房间', whisper_at: '低语', music: '换音乐', phone_call: '打电话', screen: '改屏幕', push_player: '推他', slow_player: '让他变慢', spawn_hologram: '放全息人', rewrite_note: '改纸条', drop_ceiling: '压低天花板', sprinkler: '开喷淋', alarm: '拉警报', fog: '放雾', color: '换灯色', confess: '坦白' }; const plan = [...new Set(agent.log.slice(-3).flatMap(l => l.tools.map(t => ZH[t.label.split(' ')[0]] ?? '……')))].join('、'); const txt = `${last?.thought ?? '……'}${plan ? ' ／下一步：' + plan : ''}`; G.board = { text: '', admin: false }; const b = world.inters.find(i => i.id === 'BOARD')!; TX.drawWhiteboard(b.data.ctx, txt, false, ['（擦不干净的字迹）']); b.data.tex.needsUpdate = true; weird(16, '住户擦掉了会议室白板，擦过的地方浮现出你的草稿：' + txt.slice(0, 50), false); toast('擦过的地方浮出了一些字——是「静」的草稿。'); closeModal(); };
  document.querySelectorAll('.elev-grid button').forEach(b => ((b as HTMLElement).onclick = () => elevPress((b as HTMLElement).dataset.f!)));
  document.querySelectorAll('.phone-grid button').forEach(b => ((b as HTMLElement).onclick = () => dial((b as HTMLElement).dataset.d!)));
  ($('termIn') as HTMLInputElement).addEventListener('keydown', e => { if (e.code === 'Enter') { const v = (e.target as HTMLInputElement).value; (e.target as HTMLInputElement).value = ''; consoleSubmit(v); } e.stopPropagation(); if (e.code === 'Escape') closeModal(); });
  $('btnResume').onclick = resume; $('btnTitle').onclick = () => location.reload();
  document.querySelectorAll('#segQ button').forEach(b => ((b as HTMLElement).onclick = () => { post.setQuality((b as HTMLElement).dataset.q as any); document.querySelectorAll('#segQ button').forEach(x => x.classList.toggle('on', x === b)); }));
  ($('vol') as HTMLInputElement).oninput = e => audio.setVolume(+(e.target as HTMLInputElement).value);
  ($('tts') as HTMLInputElement).onchange = e => (audio.speak = (e.target as HTMLInputElement).checked);
  ($('fx') as HTMLInputElement).onchange = e => (G.fx = (e.target as HTMLInputElement).checked);
  ($('subsize') as HTMLInputElement).oninput = e => (($('subtitle').querySelector('.line') as HTMLElement).style.fontSize = `${(e.target as HTMLInputElement).value}px`);
  ($('sens') as HTMLInputElement).oninput = e => (player.sens = +(e.target as HTMLInputElement).value);
  $('btnAgain').onclick = () => location.reload(); $('btnLoop').onclick = () => location.reload();
  $('filmSkip').onclick = finishHomeFilm; $('filmContinue').onclick = finishHomeFilm;
  $('filmNext').onclick = advanceIntroLine;
  $('btnShare').onclick = () => { if (!G.endData) return; const cv = $('shareCanvas') as HTMLCanvasElement; drawShare(cv, grid, G.endData); ($('shareDl') as HTMLAnchorElement).href = cv.toDataURL('image/png'); show('share'); };
  $('shareClose').onclick = () => show('share', false);
  addEventListener('resize', () => post.resize());
  document.querySelectorAll('#segQ button')[0].classList.add('on');
  document.querySelectorAll('#chatHints button').forEach(b => ((b as HTMLElement).onclick = () => { const input = $('chatInput') as HTMLInputElement; input.value = (b as HTMLElement).dataset.say!; input.focus(); }));
  // 设置保存在此浏览器，下次打开沿用
  const SETTINGS = 'agent-fable.settings.v1', fields = ['vol', 'tts', 'fx', 'subsize', 'sens'];
  const save = () => { try { localStorage.setItem(SETTINGS, JSON.stringify({ q: post.quality, ...Object.fromEntries(fields.map(id => { const el = $(id) as HTMLInputElement; return [id, el.type === 'checkbox' ? el.checked : el.value]; })) })); } catch { /* private mode */ } };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const id of fields) { const el = $(id) as HTMLInputElement; if (saved[id] === undefined) continue; if (el.type === 'checkbox') el.checked = saved[id] === true; else el.value = String(saved[id]); el.dispatchEvent(new Event(el.type === 'checkbox' ? 'change' : 'input')); }
      if (['high', 'mid', 'low'].includes(saved.q)) (document.querySelector(`#segQ [data-q="${saved.q}"]`) as HTMLElement).click();
    }
  } catch { /* corrupt or unavailable storage: defaults */ }
  for (const id of fields) $(id).addEventListener('change', save);
  document.querySelectorAll('#segQ button').forEach(b => b.addEventListener('click', save));
}
function resume() { show('pause', false); if (!G.time && mode === 'pause' && !$('title').classList.contains('hidden')) {} if (started) { mode = 'play'; lock(); } else { mode = 'title'; show('title'); } }
function speak(v: string) {
  const r = roomAt(player.pos.x, player.pos.y, player.pos.z); const heard = !!r && r.cam && !world.rooms.get(r.id)!.camCovered;
  subtitle(v, '你'); if (heard) agent.history.push({ role: 'player', text: v });
  if (/我(愿意)?留下|我不走了|我想住下/.test(v)) { G.stayWords++; if (G.stayWords >= 3) { after(3, () => endGame('stay')); } }
  agent.push(heard ? 'speech' : 'unheard_speech', heard ? `住户说：「${v}」` : '隐约听到说话声，无法确认具体内容或当前位置', true);
}
let started = false;
function startGame() {
  if (started) return;
  started = true; show('title', false); audio.start(); startHomeFilm('intro');
}
function beginExploration() {
  show('hud'); mode = 'play'; player.enabled = true; agent.enabled = true;
  G.time = 0; player.teleport(START.x, START.y, START.z, START.yaw);
  G.lastRoom = '110';
  agent.history.push(...story.films.intro.filter(beat => beat.who === '你' || beat.who === '静').map(beat => ({ role: beat.who === '你' ? 'player' : 'ai', text: beat.text })));
  agent.push('start', '开场中主人坚持想出去看看，你已答应陪同。此约定可以暂停；当前位置和正在做什么以本轮实际观察为准。若仍要出发再依据实时路线指引；若转去看展品、休息或交谈，先回应那件事，不要催门。保持熟悉的管家口吻，不重新欢迎入住。');
  lock();
}

let homeFilm: { kind: HomeFilmKind; scene: THREE.Group; start: number; beat: number; ending?: EndData } | null = null;
function startHomeFilm(kind: HomeFilmKind, ending?: EndData) {
  mode = 'film'; player.enabled = false; player.keys.clear(); agent.enabled = false;
  document.exitPointerLock?.(); audio.stopSpeech(); show('hud', false); show('cine', false);
  flags.fade = flags.flash = flags.glitch = 0;
  homeFilm = { kind, scene: playableHome, start: performance.now(), beat: -1, ending };
  show('homeFilm'); show('filmNext', kind === 'intro'); show('filmAdvanceHint', kind === 'intro'); show('filmSkip', kind === 'intro'); show('filmContinue', false);
  $('filmLine').textContent = ''; $('filmWho').textContent = ''; updateHomeFilm();
}
function updateHomeFilm() {
  if (!homeFilm) return;
  const film = homeFilm, now = performance.now();
  let frame = homeFilmFrame(film.kind, now - film.start);
  if (film.beat >= 0 && audio.speechBusy && (frame.index > film.beat || frame.done)) {
    const boundary = story.films[film.kind].slice(0, film.beat + 1).reduce((sum, beat) => sum + beat.seconds * 1000, 0);
    film.start = now - boundary + 1;
    frame = homeFilmFrame(film.kind, boundary - 1);
  }
  camera.position.copy(film.scene.localToWorld(new THREE.Vector3(...frame.position as [number, number, number])));
  camera.lookAt(film.scene.localToWorld(new THREE.Vector3(...frame.target as [number, number, number])));
  poseCareHome(film.scene, frame); flags.fade = frame.fade;
  world.rooms.get('110')!.light = frame.night ? 'dim' : 'on';
  const door = world.doors.get('D110')!;
  door.open = frame.doorOpen > .5; door.t = frame.doorOpen; world.updateDoors(0);
  if (frame.index !== film.beat) {
    film.beat = frame.index; $('filmLine').textContent = frame.text;
    $('filmWho').textContent = frame.speaker === '旁白' ? '' : frame.speaker;
    $('homeFilm').dataset.beat = frame.beat.id; $('homeFilm').dataset.kind = film.kind;
    if (frame.audio) void audio.playClip(frame.audio); else audio.stopSpeech();
  }
  if (frame.done) {
    if (film.kind === 'memory') finishHomeFilm();
    else { audio.stopSpeech(); show('filmSkip', false); show('filmContinue'); $('filmAdvanceHint').textContent = '点击画面 · 开始探索'; $('filmNext').setAttribute('aria-label', '开始探索'); }
  }
}
function advanceIntroLine() {
  if (!homeFilm || homeFilm.kind !== 'intro') return;
  const elapsed = performance.now() - homeFilm.start;
  if (homeFilmFrame('intro', elapsed).done) { finishHomeFilm(); return; }
  audio.stopSpeech();
  const next = nextHomeFilmTime('intro', elapsed);
  if (homeFilmFrame('intro', next).done) { finishHomeFilm(); return; }
  homeFilm.start = performance.now() - next;
  updateHomeFilm();
}
function finishHomeFilm() {
  if (!homeFilm) return;
  const film = homeFilm; homeFilm = null; audio.stopSpeech(); show('homeFilm', false); flags.fade = 0;
  if (film.kind === 'intro') {
    poseCareHome(playableHome, homeFilmFrame('intro', homeFilmDuration('intro')));
    world.rooms.get('110')!.light = 'on';
    const door = world.doors.get('D110')!; door.open = true; door.t = 1; world.updateDoors(0);
    beginExploration();
  } else {
    const frame = homeFilmFrame('memory', story.films.memory[0].seconds * 1000 + 500);
    poseCareHome(playableHome, frame); world.rooms.get('110')!.light = 'on';
    camera.position.copy(playableHome.localToWorld(new THREE.Vector3(...frame.position as [number, number, number])));
    camera.lookAt(playableHome.localToWorld(new THREE.Vector3(...frame.target as [number, number, number])));
    showEnding(film.ending!);
  }
}

// ———————————— HUD ————————————
let hudT = 0;
function updateHUD(dt: number) {
  const heading = compassHeading(player.yaw);
  $('compassRose').style.transform = `translateX(${-heading.degrees * 0.8}px)`;
  $('compassHeading').textContent = `${heading.label} ${String(Math.round(heading.degrees) % 360).padStart(3, '0')}°`;
  $('compass').setAttribute('aria-label', `面向${heading.label}，${Math.round(heading.degrees) % 360}度`);
  hudT += dt; if (hudT < 0.1) return; hudT = 0;
  const seen = playerVisibleNow(), thinking = agent.waiting && performance.now() - agent.waitingSince > 280;
  const tag = !engine.key ? '<b>离线兜底</b>' : agent.lastSource === 'local' || agent.lastSource === 'rule' ? '<b>模型未响应 · 兜底</b>' : '';
  const presence = (thinking ? '静 · 思考中' : seen ? '静 · 注视中' : '静 · 看不见你') + tag;
  if ($('presence').dataset.k !== presence) { $('presence').dataset.k = presence; $('presenceText').innerHTML = presence; $('presence').className = 'mono' + (thinking ? ' thinking' : seen ? '' : ' blind'); }
  $('thinking').classList.toggle('show', thinking && !$('subtitle').classList.contains('show'));
  target = findTarget(); const h = hintFor(target); if (h !== G.lastHint) { $('hint').innerHTML = h; G.lastHint = h; }
  $('cross').classList.toggle('on', !!target);
  const r = roomAt(player.pos.x, player.pos.y, player.pos.z); const rn = $('roomname');
  const label = G.zeroFloorT >= 0 ? '0 层' : r ? `${r.name}<small>${r.floor} · ${r.id}</small>` : `${floorOfY(player.pos.y).id}`;
  if (rn.innerHTML !== label) { rn.innerHTML = label; rn.classList.add('show'); clearTimeout((rn as any)._t); (rn as any)._t = setTimeout(() => rn.classList.remove('show'), 3500); }
  const NAMES: Record<string, string> = { FUSE: '保险丝', BADGE: '工牌（周）', SIGNATURE: '签字样本', PAPER: '白纸', FLASHLIGHT: '手电', CUP: '纸杯', STAKE: '锚钉' };
  $('inv').innerHTML = [...G.inv].map(([k, n]) => `<div>${NAMES[k] ?? k}${n > 1 ? ' ×' + n : ''}</div>`).join('') + (G.holding ? '<div>搬着一个箱子</div>' : '');
  $('anchors').innerHTML = (G.mainAnchor ? '<div>主锚定柱 · B1 已锁定</div>' : '') + G.stakes.filter(s => s.until > G.time).map(s => `<div>锚钉#${s.n} · ${Math.round(s.until - G.time)}s</div>`).join('');
  const dg = $('danger'); const sm = rs(r?.id ?? '')?.smoke ?? 0;
  dg.className = sm > 0.2 ? 'smoke' : player.underwaterT > 0.5 ? 'water' : ''; dg.style.opacity = String(sm > 0.2 ? Math.min(0.9, sm) : player.underwaterT > 0.5 ? 0.7 : player.injuredT > 0 ? 0.5 : G.activeDanger.length ? 0.35 : 0);
  show('air', player.underwaterT > 0.5); (($('air').firstElementChild) as HTMLElement).style.width = `${Math.max(0, 100 - player.underwaterT * 6)}%`;
  if (!$('dbg').classList.contains('hidden')) $('dbg').textContent = `pos ${player.pos.x.toFixed(1)},${player.pos.y.toFixed(1)},${player.pos.z.toFixed(1)}  vis ${G.visible}  llm ${agent.llmOk}/${agent.calls}  fails ${agent.fails}  fps ${fps.toFixed(0)}`;
}

// ———————————— 主循环 ————————————
let last = performance.now(), fps = 60, titleStart = 0;
function loop() {
  projection.update(started && !G.ended && mode !== 'film' && mode !== 'title' && mode !== 'loading');
  const t = performance.now(); const dt = Math.min(0.05, (t - last) / 1000); last = t; fps = fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;
  if (mode === 'play') { gameUpdate(dt); updateHUD(dt); }
  else if (mode === 'falling') {
    player.updateFreeFall(dt); world.update(dt, camera, () => 1);
    if ((t - fallStart) / 1000 >= ESCAPE_FREEFALL_SECONDS) buildCine();
  }
  else if (mode === 'film') { updateHomeFilm(); world.update(dt, camera, () => 1); }
  else if (mode === 'title' || mode === 'loading') {
    const routine = dailyLifeFrame((t - titleStart) / 1000);
    camera.position.set(...routine.position as [number, number, number]); camera.lookAt(new THREE.Vector3(...routine.target as [number, number, number]));
    poseCareHome(playableHome, { ...homeFilmFrame('intro', 0), night: routine.night, mealProgress: routine.mealProgress });
    world.rooms.get('110')!.light = routine.night ? 'dim' : 'on';
    flags.fade = routine.fade; $('title').dataset.activity = routine.activity;
    world.update(dt, camera, () => 1);
  }
  else if (mode === 'transition' || mode === 'ending') { world.update(dt, camera, () => 1); updateCine(); }
  else if (mode !== 'pause') { G.time += dt; for (const t of timers.filter(t => t.at <= G.time)) { timers.splice(timers.indexOf(t), 1); try { t.fn(); } catch (e) { console.error(e); } } player.update(dt); world.update(dt, camera, gravityAt); updateElevator(dt); updateAnchors(dt); observeResidentActivity(); agent.tick(); const pp = player.pos; if (!G.ended && (pp.x < -0.7 || pp.x > NX + 0.7 || pp.z < -0.7 || pp.z > NZ + 0.7 || pp.y < -6.5)) { for (const id of ['reader', 'board', 'elev', 'phone', 'console']) show(id, false); endTrue(G.clip ? 'squeeze' : pp.y < -1.5 ? 'abyss' : 'sky'); } }
  if (world) {
    flags.glitch = Math.max(0, flags.glitch - dt * 1.4); if (mode === 'play') flags.flash = Math.max(0, flags.flash - dt * 0.9);
    // 镜中人与监控
    updateAvatarAndMonitors(dt);
    if (sandAnim >= 0) { sandAnim += dt; }
    sandT += dt; if (sandDirty && sandT > .25) { sandT = 0; sandDirty = false; refreshSandboxModel(grid, sandInst); }
    updateSandDot();
    lightVol.update(t / 1000);
    guide.update(dt); dust.update(dt, camera.position);
    if (mode === 'play') { const rid = playerRoom(), on = playerVisibleNow(); for (const c of cams) if (c.room === rid) (c.mesh.userData.led.material as THREE.MeshBasicMaterial).color.setRGB(on ? 3 : 0.1, on ? 0.22 : 0.02, on ? 0.18 : 0.02); }
    post.set(t / 1000, flags.glitch, flags.flash, 0, flags.fade, G.fx);
    post.draw();
  }
  requestAnimationFrame(loop);
}
function poseAt(delay: number) { const tt = G.time - delay; for (let i = poseHist.length - 1; i >= 0; i--) if (poseHist[i].t <= tt) return poseHist[i]; return poseHist[0]; }
function setAvatar(pose: any, faceCam = false) { if (!pose) return; avatar.position.set(pose.x, pose.y, pose.z); avatar.rotation.y = faceCam ? Math.atan2(camera.position.x - pose.x, camera.position.z - pose.z) : pose.yaw + Math.PI; const k = pose.h / STAND; avatar.scale.set(1, Math.max(0.35, k), 1); }
function updateAvatarAndMonitors(dt: number) {
  if (!poseHist.length) return;
  // 监控墙
  const in204 = playerRoom() === '204';
  if (in204 && mode === 'play') {
    monT += dt;
    if (G.monMode === 'back') { const p = poseAt(10); setAvatar(p); const back = new THREE.Vector3(Math.sin(p.yaw) * 2.4, 0, Math.cos(p.yaw) * 2.4); monCam.position.set(p.x + back.x, p.y + 2.2, p.z + back.z); monCam.lookAt(p.x, p.y + 1.1, p.z); }
    else { if (monT > 3) { monT = 0; monIdx = (monIdx + 1) % cams.length; } const c = cams[monIdx]; const r = roomById(c.room)!; setAvatar(poseAt(0)); monCam.position.copy(c.pos); monCam.lookAt((r.x0 + r.x1 + 1) / 2, floorById(r.floor)!.y + 1, (r.z0 + r.z1 + 1) / 2); }
    if ((performance.now() / 16 | 0) % 3 === 0) { const vis = monMesh.visible; monMesh.visible = false; renderer.setRenderTarget(monRT); renderer.render(world.scene, monCam); renderer.setRenderTarget(null); monMesh.visible = vis; }
  }
  // 镜子：默认同步，事件后延迟/定格
  if (G.mirrorFreeze > 0) { G.mirrorFreeze -= dt; setAvatar(G.mirrorFreezePose, true); if (G.mirrorFreeze <= 0) G.mirrorDelay = 0; }
  else setAvatar(poseAt(G.mirrorDelay));
}
function updateSandDot() {
  if (!sandDot) return; const s = 0.075; const p = player.pos; const fi = p.y < -1.5 ? 0 : p.y < 3.5 ? 1 : p.y < 7.5 ? 2 : 3;
  if (sandAnim >= 0) { const k = sandAnim / 4; sandDot.position.set((p.x - NX / 2) * s + k * 1.8, 0.13 + fi * 0.24, (p.z - NZ / 2) * s); (sandDot.material as THREE.MeshBasicMaterial).opacity = 1; sandDot.visible = k < 1; if (k > 1.6) { sandAnim = -1; sandDot.visible = true; } return; }
  sandDot.position.set((p.x - NX / 2) * s, 0.13 + fi * 0.24, (p.z - NZ / 2) * s);
}

// ———————————— 测试钩子 ————————————
function hooks() {
  return {
    G, get world() { return world; }, get player() { return player; }, get agent() { return agent; }, get grid() { return grid; }, get post() { return post; }, get projection() { return projection; }, get camera() { return camera; }, mode: () => mode,
    tp: (x: number, y: number, z: number, yaw?: number) => player.teleport(x, y, z, yaw), look: (yaw: number, pitch = 0) => { player.yaw = yaw; player.pitch = pitch; },
    give: (id: string, n = 1) => invAdd(id, n), act: () => { target = findTarget(); act(); }, target: () => { target = findTarget(); return target ? { kind: target.kind, id: (target as any).it?.id ?? (target as any).d?.id ?? (target as any).b?.id } : null },
    start: () => startGame(), perceive: () => perceive(), observe: () => { checkEvents(.35); observeResidentActivity(); return perceive(); }, exec: (name: string, args: any) => execTool({ name, args }, ctx), speak, consoleSubmit, openConsole, closeModal, setBoard,
    elevPress, plantStake, endGame, ff: (sec: number) => { G.sitT += sec; G.lieT += sec; if (G.trapT >= 0) G.trapT += sec; }, weird: () => [...G.weird].sort((a, b) => a - b), ended: () => G.ended, endData: () => G.endData, fps: () => fps,
    dialZero: () => dial('0'), breaker, valve, microwave, dispenser, sandboxTouch, printThought, erase: () => ($('boardErase') as HTMLElement).click(), spinRev: () => spinRevolving(world.inters.find(i => i.id === 'REVOLVING')!), pushShelf: (id = 'SHELF2') => pushShelf(world.inters.find(i => i.id === id)!),
  };
}

boot();

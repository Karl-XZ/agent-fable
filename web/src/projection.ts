import * as THREE from 'three';
import { Room, roomById, floorById } from './level';
import { World } from './world';
import { findProjectionWalls, validateProjectionWall, ProjectionWall, ProjectionEnvironment } from './projection-geometry';
import portraits from '../public/jing/expressions/v1/manifest.json';

interface CameraView { room: string; pos: THREE.Vector3; mesh: THREE.Object3D }
export class JingProjection {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private textures = new Map<string, THREE.Texture>();
  private active: { wall: ProjectionWall; expression: string } | null = null;
  private cache = new Map<string, { time: number; walls: ProjectionWall[] }>();
  private ready = false;
  private checked = -99;
  constructor(private world: World, private cameras: CameraView[], private canSee: (room: string) => boolean,
    private currentRoom: () => string, private viewer: () => THREE.Camera | null, private anchored: (x:number,y:number,z:number)=>string|null) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({ transparent:true,opacity:.92,depthWrite:false,depthTest:true,toneMapped:false,alphaTest:.012,side:THREE.FrontSide }));
    this.mesh.name='Jing wall projection';this.mesh.visible=false;this.mesh.renderOrder=2;world.scene.add(this.mesh);
  }
  async load() {
    const loader=new THREE.TextureLoader();
    try {
      await Promise.all(portraits.entries.map(async entry=>{
        const t=await loader.loadAsync(`/jing/expressions/v1/${entry.file}`);t.colorSpace=THREE.SRGBColorSpace;t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;
        this.textures.set(entry.id,t);
      }));this.ready=true;
    } catch { this.ready=false; }
  }
  private environment(room: Room): ProjectionEnvironment | null {
    const camera=this.cameras.find(c=>c.room===room.id);if(!camera)return null;
    const fy=floorById(room.floor)!.y;
    const objects=this.world.colliders({min:[room.x0,fy,room.z0],max:[room.x1+1,fy+3,room.z1+1]},[]).filter(box=>box.tag!=='vox');
    return {room,camera:camera.pos,forward:camera.mesh.getWorldDirection(new THREE.Vector3()),canSee:()=>this.canSee(room.id),material:(x,y,z)=>this.world.grid.at(x,y,z),
      blocked:(x,y,z)=>this.world.grid.solidW(x,y,z)||objects.some(b=>x>=b.min[0]&&x<=b.max[0]&&y>=b.min[1]&&y<=b.max[1]&&z>=b.min[2]&&z<=b.max[2]),anchored:(x,y,z)=>!!this.anchored(x,y,z)};
  }
  walls(roomId=this.currentRoom(), fresh=false): ProjectionWall[] {
    const room=roomById(roomId);if(!room || !this.canSee(room.id))return [];
    const env=this.environment(room);if(!env)return [];
    const now=performance.now(),cached=this.cache.get(room.id);
    if(!fresh&&cached&&now-cached.time<750)return cached.walls;
    const view=this.viewer(),eye=view?.position??env.camera,forward=new THREE.Vector3();view?.getWorldDirection(forward);
    const score=(w:ProjectionWall)=>w.height*20+new THREE.Vector3(w.x-eye.x,w.y-eye.y,w.z-eye.z).normalize().dot(forward)*8-Math.hypot(w.x-eye.x,w.z-eye.z)*.25;
    const walls=findProjectionWalls(env).sort((a,b)=>score(b)-score(a));this.cache.set(room.id,{time:now,walls});return walls;
  }
  show(args: Record<string,any>) {
    if(!this.ready)return {ok:false,msg:'立绘尚未加载成功，不能显示投影。'};
    const expression=args.expression??'warm-smile';
    if(typeof expression!=='string'||!this.textures.has(expression))return {ok:false,msg:'未知表情，请使用 state.projection.expressions 中的 ID。'};
    const expressionOnly=args.expression!==undefined&&args.room===undefined&&args.wall===undefined&&this.active;
    const roomId=typeof args.room==='string'?args.room:expressionOnly?this.active!.wall.room:this.currentRoom();
    const target=args.wall??(expressionOnly?this.active!.wall.id:undefined);
    const wall=target===undefined?this.walls(roomId,true)[0]:this.walls(roomId,true).find(w=>w.id===target);
    const room=wall&&roomById(wall.room),env=room&&this.environment(room);
    if(!wall||!env||!validateProjectionWall(wall,env))return {ok:false,msg:'目标墙面当前不可见、受遮挡、被锚定或无法容纳投影；请重新查询。'};
    this.active={wall,expression};this.mesh.position.set(wall.x+wall.nx*.025,wall.y,wall.z+wall.nz*.025);
    this.mesh.rotation.set(0,Math.atan2(wall.nx,wall.nz),0);this.mesh.scale.set(wall.width,wall.height,1);
    this.mesh.material.map=this.textures.get(expression)!;this.mesh.material.needsUpdate=true;this.mesh.visible=true;
    return {ok:true,msg:`静已投影在 ${wall.room} 的可见墙面，表情：${expression}。投影没有碰撞或触觉。`};
  }
  hide() {this.active=null;this.mesh.visible=false;return {ok:true,msg:'静的墙面投影已收起。'};}
  update(enabled: boolean) {
    if(!enabled){if(this.active)this.hide();return;}
    if(!this.active)return;
    const now=performance.now();if(now-this.checked<200)return;this.checked=now;
    const room=roomById(this.active.wall.room),env=room&&this.environment(room);
    if(!env||!validateProjectionWall(this.active.wall,env))this.hide();
  }
  state() {return {available:this.ready,active:this.active?{...this.active.wall,expression:this.active.expression}:null,
    available_walls:this.ready?this.walls().slice(0,12):[],expressions:portraits.entries.map(e=>({id:e.id,label:e.label}))};}
}

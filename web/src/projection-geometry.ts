export interface Point { x: number; y: number; z: number }
export interface ProjectionWall extends Point { id: string; room: string; nx: number; nz: number; width: number; height: number }
export interface ProjectionEnvironment {
  room: { id: string; floor: string; x0: number; x1: number; z0: number; z1: number; cam: boolean };
  camera: Point;
  forward?: Point;
  canSee(): boolean;
  material(x: number, y: number, z: number): number;
  blocked(x: number, y: number, z: number): boolean;
  anchored(x: number, y: number, z: number): boolean;
}
const floorY: Record<string, number> = { B1: -4, '1F': 0, '2F': 4, RF: 8 };
const opaque = (m: number) => m === 1 || m === 2 || m === 6;
export function validateProjectionWall(w: ProjectionWall, e: ProjectionEnvironment): boolean {
  if (!e.room.cam || !e.canSee() || w.room !== e.room.id || ![w.x,w.y,w.z,w.width,w.height].every(Number.isFinite)) return false;
  const c=e.camera;
  if ((c.x-w.x)*w.nx+(c.z-w.z)*w.nz<=.03) return false;
  for (const horizontal of [-.48,0,.48]) for (const vertical of [-.48,0,.48]) {
    const x=w.x+w.nz*w.width*horizontal,z=w.z-w.nx*w.width*horizontal,y=w.y+w.height*vertical;
    if (!opaque(e.material(x-w.nx*.04,y,z-w.nz*.04)) || e.material(x+w.nx*.04,y,z+w.nz*.04)!==0 || e.anchored(x,y,z)) return false;
    // Inspect the entire projected patch, not just a point peeking around a corner.
    const tx=x+w.nx*.06,tz=z+w.nz*.06,distance=Math.hypot(tx-c.x,y-c.y,tz-c.z),steps=Math.ceil(distance/.14);
    if(e.forward&&(tx-c.x)*e.forward.x+(y-c.y)*e.forward.y+(tz-c.z)*e.forward.z<=0)return false;
    for(let i=1;i<=steps;i++) { const t=i/steps; if(e.blocked(c.x+(tx-c.x)*t,c.y+(y-c.y)*t,c.z+(tz-c.z)*t)) return false; }
  }
  return true;
}
export function findProjectionWalls(e: ProjectionEnvironment): ProjectionWall[] {
  if (!e.room.cam || !e.canSee()) return [];
  const r=e.room,fy=floorY[r.floor]; if(fy===undefined)return [];
  const out: ProjectionWall[]=[];
  for(let x=r.x0;x<=r.x1;x++)for(let z=r.z0;z<=r.z1;z++){
    if(!opaque(e.material(x+.5,fy+.5,z+.5)))continue;
    for(const [nx,nz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const wx=x+.5+nx*.5,wz=z+.5+nz*.5;
      const frontX=wx+nx*.1,frontZ=wz+nz*.1;
      if(frontX<r.x0+1||frontX>r.x1||frontZ<r.z0+1||frontZ>r.z1)continue;
      for(const height of [2.5,1.8,1.2,.75]){
        const wall={id:`${r.id}:${x}:${z}:${nx}:${nz}`,room:r.id,x:wx,y:fy+.18+height/2,z:wz,nx,nz,width:height*2/3,height};
        if(validateProjectionWall(wall,e)){out.push(wall);break;}
      }
    }
  }
  return out;
}

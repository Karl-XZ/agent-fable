const {test}=require('node:test'),assert=require('node:assert/strict');
const {findProjectionWalls,validateProjectionWall}=require('../.runtime/projection-test.cjs');
const room={id:'test',floor:'1F',x0:0,x1:8,z0:0,z1:8,cam:true};
function fixture(){let enabled=true,glass=false,removed=false,blocked=false,anchored=false;
 const env={room,camera:{x:4,y:2.7,z:4},canSee:()=>enabled,material:(x,y,z)=>!removed&&y>=0&&y<3&&(x<1||x>=8||z<1||z>=8)?glass?3:1:0,blocked:()=>blocked,anchored:()=>anchored};
 return{env,set:(v)=>{({enabled=enabled,glass=glass,removed=removed,blocked=blocked,anchored=anchored}=v)}};
}
test('finds wall-aligned surfaces with portrait aspect and opaque backing',()=>{const f=fixture(),walls=findProjectionWalls(f.env);assert.ok(walls.length>4);assert.ok(walls.every(w=>Math.abs(w.width/w.height-2/3)<1e-5));for(const w of walls)assert.ok(validateProjectionWall(w,f.env));});
test('cannot project onto glass or into air',()=>{const f=fixture();f.set({glass:true});assert.deepEqual(findProjectionWalls(f.env),[]);f.set({removed:true});assert.deepEqual(findProjectionWalls(f.env),[]);});
test('camera coverage is required and revoked live',()=>{const f=fixture();const w=findProjectionWalls(f.env)[0];f.set({enabled:false});assert.deepEqual(findProjectionWalls(f.env),[]);assert.equal(validateProjectionWall(w,f.env),false);});
test('a newly blocking wall or camera obstruction invalidates an existing target',()=>{const f=fixture();const w=findProjectionWalls(f.env)[0];f.set({blocked:true});assert.equal(validateProjectionWall(w,f.env),false);});
test('destroyed or anchored walls cannot retain the projection',()=>{for(const flag of ['removed','anchored']){const f=fixture();const w=findProjectionWalls(f.env)[0];f.set({[flag]:true});assert.equal(validateProjectionWall(w,f.env),false);}});
test('only the visible side of a wall can be selected',()=>{const f=fixture();for(const w of findProjectionWalls(f.env))assert.ok((f.env.camera.x-w.x)*w.nx+(f.env.camera.z-w.z)*w.nz>0);});
test('a wall behind the camera cannot be projected onto',()=>{const f=fixture();f.env.forward={x:0,y:0,z:1};const walls=findProjectionWalls(f.env);assert.ok(walls.length);assert.ok(walls.every(w=>w.z>f.env.camera.z));});
test('small wall patches get a smaller portrait instead of clipping its head',()=>{const f=fixture();const base=f.env.material;f.env.material=(x,y,z)=>y>1?0:base(x,y,z);const walls=findProjectionWalls(f.env);assert.ok(walls.length);assert.ok(walls.every(w=>w.height<=.75));});

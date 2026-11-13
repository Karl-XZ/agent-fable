const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});
 const report={checks:[],errors:[],live:[]},base=process.env.FABLE_URL||'http://127.0.0.1:7865/';
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  await page.goto(base);await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;__game.observe();window.originalGrid=__game.grid.v.slice();});
  assert.equal(await page.evaluate(()=>__game.projection.state().available),true);
  let result=await page.evaluate(()=>{const g=__game,t=performance.now(),walls=g.projection.walls('110',true);window.targetWall=walls[0];return{count:walls.length,ms:performance.now()-t,show:g.exec('project_self',{room:'110',expression:'warm-smile'})};});
  assert.ok(result.count);assert.equal(result.show.ok,true);report.wallQuery=result;report.checks.push('real opaque wall selected using camera visibility, support and collision data');
  const blindTransition=await page.evaluate(()=>{const g=__game,seen={...g.G.lastSeen};g.G.lastSeen.room='202';g.G.visible=true;g.world.rooms.get('110').camCovered=true;
   const hidden=g.perceive().state.player.visible,defaultRooms=g.projection.state().available_walls.map(w=>w.room),before=g.projection.walls('202',true).map(w=>w.id);
   g.G.visible=false;const after=g.projection.walls('202',true).map(w=>w.id);g.G.lastSeen=seen;g.world.rooms.get('110').camCovered=false;g.observe();return{hidden,defaultRooms,before,after};});
  assert.equal(blindTransition.hidden,false);assert.ok(blindTransition.defaultRooms.length);assert.ok(blindTransition.defaultRooms.every(r=>r==='202'));assert.deepEqual(blindTransition.before,blindTransition.after);report.checks.push('camera denial immediately hides player position from default targeting and candidate sorting before visibility tick');
  await page.evaluate(()=>{const g=__game,w=window.targetWall;g.tp(w.x+w.nx*3,0,w.z+w.nz*3);const p=g.player.pos;g.look(Math.atan2(-(w.x-p.x),-(w.z-p.z)),Math.atan2(w.y-p.y-1.58,Math.hypot(w.x-p.x,w.z-p.z)));g.observe();});
  await page.waitForTimeout(450);await page.screenshot({path:'.runtime/jing-projection-warm.png'});
  const stable=await page.evaluate(()=>{const g=__game,id=g.projection.state().active.id,uuid=g.projection.mesh.uuid;const positions=[];
   for(const e of g.projection.state().expressions){const out=g.exec('project_self',{expression:e.id});if(!out.ok)throw Error(out.msg);positions.push(g.projection.mesh.position.toArray());if(g.projection.mesh.uuid!==uuid||g.projection.state().active.id!==id)throw Error('Expression moved the projection');}
   const before=g.projection.mesh.quaternion.toArray();g.look(g.player.yaw+.5);return{before,after:g.projection.mesh.quaternion.toArray(),positions};});
  assert.deepEqual(stable.before,stable.after);assert.ok(stable.positions.every(v=>JSON.stringify(v)===JSON.stringify(stable.positions[0])));report.checks.push('all thirteen textures switch on one fixed wall mesh; camera rotation cannot billboard it');
  await page.evaluate(()=>{const g=__game,w=window.targetWall,p=g.player.pos;g.look(Math.atan2(-(w.x-p.x),-(w.z-p.z)),Math.atan2(w.y-p.y-1.58,Math.hypot(w.x-p.x,w.z-p.z)));});await page.waitForTimeout(200);await page.screenshot({path:'.runtime/jing-projection-vulnerable.png'});
  assert.equal(await page.evaluate(()=>__game.exec('project_self',{expression:'https://invalid/asset.png'}).ok),false);assert.equal(await page.evaluate(()=>__game.exec('project_self',{room:'106'}).ok),false);
  report.checks.push('unknown expression paths and camera-free bathroom are refused');
  async function restore(){await page.evaluate(()=>{const g=__game;g.grid.v.set(window.originalGrid);g.world.rooms.get('110').camCovered=false;g.exec('lights',{room:'110',mode:'on'});g.G.stakes=[];g.exec('project_self',{room:'110',wall:window.targetWall.id,expression:'warm-smile'});});}
  await restore();await page.evaluate(()=>__game.world.rooms.get('110').camCovered=true);await page.waitForFunction(()=>__game.projection.state().active===null,null,{timeout:5000});assert.equal(await page.evaluate(()=>__game.projection.state().active),null);report.checks.push('covering the camera revokes the existing projection');
  await restore();await page.evaluate(()=>__game.exec('lights',{room:'110',mode:'off'}));await page.waitForFunction(()=>__game.projection.state().active===null,null,{timeout:5000});assert.equal(await page.evaluate(()=>__game.projection.state().active),null);report.checks.push('turning lights off revokes it without turning lights back on');
  await restore();await page.evaluate(()=>{const g=__game,w=window.targetWall;g.G.stakes.push({x:w.x,y:w.y,z:w.z,n:99,until:g.G.time+90});});await page.waitForFunction(()=>__game.projection.state().active===null,null,{timeout:5000});assert.equal(await page.evaluate(()=>__game.projection.state().active),null);report.checks.push('a newly activated anchor revokes the projection');
  await restore();await page.evaluate(()=>{const g=__game,w=window.targetWall;const x=Math.floor(w.x-w.nx*.1),z=Math.floor(w.z-w.nz*.1);for(let y=0;y<3;y++)g.grid.set(x,y+5,z,0);});await page.waitForFunction(()=>__game.projection.state().active===null,null,{timeout:5000});assert.equal(await page.evaluate(()=>__game.projection.state().active),null);report.checks.push('demolishing the supporting wall revokes it');
  await restore();await page.evaluate(()=>{const g=__game,w=window.targetWall,c=g.world.inters.find(i=>i.id==='CAM_110').pos;const x=Math.floor((c.x+w.x)/2),z=Math.floor((c.z+w.z)/2);for(let y=0;y<3;y++)g.grid.set(x,y+5,z,1);});await page.waitForFunction(()=>__game.projection.state().active===null,null,{timeout:5000});assert.equal(await page.evaluate(()=>__game.projection.state().active),null);report.checks.push('new opaque occlusion between camera and target revokes it');
  await restore();assert.equal(await page.evaluate(()=>__game.exec('project_self',{room:'202',expression:'curious'}).ok),true);assert.equal(await page.evaluate(()=>__game.projection.state().active.room),'202');report.checks.push('AI can select a camera-visible room on another floor without following the player');
  await restore();await page.evaluate(()=>__game.exec('hide_projection',{}));assert.equal(await page.evaluate(()=>__game.projection.state().active),null);report.checks.push('explicit hide succeeds');
  if(process.env.FABLE_LIVE==='1'){
   for(const [name,text] of [['appear','静，我想看看你。请用温柔微笑把自己投影在我这间屋子的墙上，不要指路。'],['expression','请保持在刚才那面墙上，把表情换成疑惑倾听。'],['hide','请收起墙上你的影像。']]){
    const v=await page.evaluate(async text=>{__game.speak(text);const reply=await __game.agent.run('building');return{reply,projection:__game.projection.state(),log:__game.agent.log.at(-1)};},text);report.live.push({name,text,...v});console.log(name,JSON.stringify({say:v.reply?.say,tools:v.log.tools,active:v.projection.active}));
    if(name==='appear')assert.ok(v.projection.active);if(name==='expression')assert.equal(v.projection.active?.expression,'curious');if(name==='hide')assert.equal(v.projection.active,null);
   }
  }
  await page.route('**/api/agent',route=>route.fulfill({json:{say:'我已经出现在您面前了。',thought:'测试失败回执。',tools:[{name:'project_self',args:{room:'110',wall:'invalid-wall'}}]}}));
  const failed=await page.evaluate(async()=>{__game.speak('请投影到墙上');const reply=await __game.agent.run('building');return{say:reply?.say,active:__game.projection.state().active,results:__game.agent.results};});
  assert.equal(failed.active,null);assert.equal(failed.say,'这里暂时无法显示我的影像。');assert.ok(failed.results.some(r=>!r.ok&&r.call?.name==='project_self'));report.checks.push('failed projection replaces false presence claim with an accurate spoken acknowledgement');
  await page.evaluate(()=>__game.exec('project_self',{room:'110'}));await page.evaluate(()=>__game.endGame('stay'));await page.waitForFunction(()=>__game.projection.state().active===null,null,{timeout:5000});assert.equal(await page.evaluate(()=>__game.projection.state().active),null);report.checks.push('ending cinematics cannot retain the caretaker projection');
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({checks:report.checks,errors:report.errors,passed:true}));
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/jing-projection-browser.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});try{
const page=await browser.newPage();await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
await page.goto(process.env.FABLE_URL||'http://127.0.0.1:7864/');await page.waitForFunction(()=>window.__game,null,{timeout:60000});
await page.evaluate(()=>{document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;});
const result=await page.evaluate(()=>{const g=__game;const targetBefore=g.perceive().state.navigation.target;const query=g.exec('find_path',{door:'D208W'});const targetAfter=g.perceive().state.navigation.target;
const stair=g.world.structs.get('ST_MAIN'),b=stair.boxes.find(b=>34.1>=b.min[0]&&34.1<b.max[0]&&14.5>=b.min[2]&&14.5<b.max[2]);g.tp(34.1,b.max[1]+.1,14.5);g.player.noPhysics=false;for(let i=0;i<60;i++)g.player.update(1/60);const support=g.player.standingOn;
return {targetBefore,targetAfter,queryTarget:query.navigation.target,stair:{position:g.player.pos.toArray(),onGround:g.player.onGround,tag:support?.tag,id:support?.ref?.id,kind:support?.ref?.kind,...g.observe().state.player}};});
assert.deepEqual(result.targetAfter,result.targetBefore,'a temporary path query must not overwrite the active trip goal');assert.equal(result.stair.id,'ST_MAIN');assert.deepEqual(result.stair.danger,[]);
await page.evaluate(()=>{__game.player.noPhysics=true;__game.tp(38.2,5.15,24);__game.observe();});await page.keyboard.press('Enter');
result.dangerWhileTyping=await page.evaluate(()=>({mode:__game.mode(),danger:__game.observe().state.player.danger,canInterrupt:__game.agent.canInterrupt()}));
console.log(JSON.stringify(result));fs.writeFileSync('.runtime/navigation-intent-verification.json',JSON.stringify(result,null,2));assert.equal(result.dangerWhileTyping.mode,'chat');assert.equal(result.dangerWhileTyping.canInterrupt,true,'real danger can interrupt even while ordinary speech is held for typing');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

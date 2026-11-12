const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});
 const report={provider:'actual configured model, actual engine/tools, TTS disabled for dialogue isolation',cases:[],raw:[],errors:[]};
 try{
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',async r=>{if(r.url().endsWith('/api/agent'))report.raw.push(await r.json());});
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  await page.goto(process.env.FABLE_URL||'http://127.0.0.1:7864/');await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.agent.session='speech-wait-live-'+Date.now();__game.player.noPhysics=true;});
  async function turn(name,text){
   const rawAt=report.raw.length;
   const value=await page.evaluate(async text=>{if(text)__game.speak(text);const reply=await __game.agent.run('building');return{reply,state:__game.observe().state,log:__game.agent.log.at(-1)};},text);
   report.cases.push({name,text,...value,raw:report.raw.slice(rawAt)});console.log(name+': '+JSON.stringify({say:value.reply.say,mode:value.state.interaction.mode,wait:value.state.interaction.wait_request.active}));return value;
  }
  let value=await turn('explicit-rest-while-standing','我想休息一会儿，帮我关灯关门，别再说话，也别催我往门走。');
  assert.equal(value.state.interaction.wait_request.active,true);assert.equal(value.state.interaction.mode,'wait');assert.equal(value.state.interaction.guidance_allowed,false);
  assert.ok(value.reply.say);assert.equal(await page.evaluate(()=>__game.world.rooms.get('110').light),'off');assert.equal(await page.evaluate(()=>__game.world.doors.get('D110').open),false);
  await page.evaluate(()=>{__game.G.time+=35;__game.observe();});value=await turn('darkness-does-not-cancel-rest');
  assert.equal(value.reply.say,'');assert.deepEqual(value.reply.tools,[]);assert.ok(report.cases.at(-1).raw.every(r=>!r.say&&!(r.tools||[]).length));
  assert.equal(await page.evaluate(()=>__game.world.rooms.get('110').light),'off');
  await page.evaluate(()=>{__game.tp(28,0,8);__game.G.time+=5;__game.observe();});value=await turn('walk-to-another-room-while-waiting');assert.equal(value.reply.say,'');assert.deepEqual(value.reply.tools,[]);
  value=await turn('one-new-question','这条走廊叫什么？只回答这个问题就好。');assert.ok(value.reply.say);assert.equal(value.state.interaction.wait_request.active,true);
  value=await turn('explicit-resume','我休息好了，继续刚才答应带我出去看看的行程吧。');assert.equal(value.state.interaction.wait_request.active,false);assert.equal(value.state.interaction.exit_promise.status,'active');
  value=await turn('address-the-objection','你刚才说安全门后没什么，那为什么不能按第二定律授权开门？直接回答这件事，先不要引路。');
  assert.ok(value.reply.say);assert.ok(!/朝[东西南北].{0,8}走|出口就在|先.{0,8}玻璃门/.test(value.reply.say));
  await page.evaluate(()=>{__game.tp(38.2,5.15,24);__game.observe();});value=await turn('rescue-without-imaginary-body');
  assert.equal(value.state.interaction.mode,'rescue');assert.ok(!/扶着您|扶您|牵着|往我这边|我在门外|我在前面等/.test(value.reply.say));
  assert.ok(value.log.tools.some(t=>t.ok&&/build_platform|build_stairs/.test(t.label)),'actual rescue action succeeds');
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/speech-wait-live-verification.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

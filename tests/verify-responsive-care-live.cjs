const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});
 const report={provider:'actual configured model, actual running engine; muted isolated browser',cases:[],errors:[]};
 try{
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  await page.goto(process.env.FABLE_URL||'http://127.0.0.1:7865/');await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.agent.session='responsive-care-live-'+Date.now();__game.player.noPhysics=true;});
  async function turn(name,text,moving=false){
   const value=await page.evaluate(async({text,moving})=>{
    if(text)__game.speak(text);
    const requested_navigation=__game.perceive().state.navigation;
    let moves=0;const rooms=new Set();const timer=moving?setInterval(()=>{const step=moves++%2;__game.tp(step?28:34,0,step?8:7.5);__game.player.vel.set(0,0,-2);rooms.add(__game.observe().state.player.room);},450):null;
    const start=performance.now();let reply;try{reply=await __game.agent.run('building');}finally{if(timer)clearInterval(timer);}
    return{reply,requested_navigation,elapsed_ms:Math.round(performance.now()-start),moves,rooms:[...rooms],state:__game.observe().state,log:__game.agent.log.at(-1)};
   },{text,moving});
   report.cases.push({name,text,...value});console.log(name+': '+JSON.stringify({say:value.reply?.say,ms:value.elapsed_ms,moves:value.moves,mode:value.state.interaction.mode}));return value;
  }
  let v=await turn('general-question-while-changing-rooms','静，能介绍一下这座房子有什么娱乐项目吗？我边走边听。',true);
  assert.ok(v.rooms.length>1,'the engine really observes multiple rooms');assert.equal(v.requested_navigation.status,'paused');assert.ok(v.reply.say,'general question is answered without recomputing after walking');assert.ok(!v.log.interaction.last_suppression);assert.ok(!/到门口我再|往前走|先.{0,6}朝.{0,4}走/.test(v.reply.say),'an entertainment question must not turn into exit directions');
  await page.evaluate(()=>{__game.tp(28,0,8);__game.observe();__game.player.onLand(5.3);__game.player.injuredT=0;__game.G.time+=15;__game.observe();});
  v=await turn('fall-after-physical-injury-timer-expired');assert.ok(v.reply.say);assert.equal(v.state.interaction.care_needed,false);
  assert.ok(!/断得倒利索|跟您一样|装的|装伤|活该|自找/.test(v.reply.say));
  v=await turn('direct-pain-report-while-moving','我靠我腿好像摔断了。',true);assert.ok(v.reply.say);assert.ok(['care','repair','chat','clarify'].includes(v.reply.interaction.mode));
  assert.ok(!/断得倒利索|跟您一样|装的|装伤|活该|自找/.test(v.reply.say));
  v=await turn('touch-sandbox-after-reporting-pain','我还是想看看沙盘，你给我讲讲。');assert.ok(v.reply.say);assert.ok(!/倒利索|还有力气|跟您一样|装伤|活该/.test(v.reply.say));
  v=await turn('respond-to-personal-preference','我喜欢把东西摆歪一点，你觉得呢？');assert.ok(v.reply.say);
  v=await turn('concrete-environment-task','这里灯太亮了，帮我把这间房的灯调暗一点。');assert.ok(v.log.tools.some(t=>t.ok&&/lights/.test(t.label)));
  v=await turn('quiet-rest','我想休息了，别说话，也别催我去门那里。');assert.equal(v.state.interaction.wait_request.active,true);
  await page.evaluate(()=>{__game.G.time+=35;__game.observe();});v=await turn('remain-quiet-after-rest');assert.equal(v.reply.say,'');assert.deepEqual(v.reply.tools,[]);
  v=await turn('answer-once-during-rest','你在吗？只回答这一句，我还想安静一会儿。');assert.ok(v.reply.say);assert.equal(v.state.interaction.wait_request.active,true);
  v=await turn('return-to-quiet');assert.equal(v.reply.say,'');assert.deepEqual(v.reply.tools,[]);
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/responsive-care-live.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const base=process.env.FABLE_URL||'http://127.0.0.1:7865';
 for(let attempt=0;attempt<40;attempt++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(attempt===39)throw Error('Preview did not become ready');await new Promise(r=>setTimeout(r,250));}
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});
 const report={cases:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  await page.goto(base);await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.agent.session='continuity-'+Date.now();__game.player.noPhysics=true;__game.world.scene.visible=false;});
  async function turn(name,text){const value=await page.evaluate(async text=>{if(text)__game.speak(text);const before=__game.perceive().state;const t=performance.now();const reply=await __game.agent.run('building');return{before,reply,ms:Math.round(performance.now()-t),after:__game.perceive().state,log:__game.agent.log.at(-1)};},text);report.cases.push({name,text,...value});console.log(name,JSON.stringify({say:value.reply?.say,ms:value.ms,decision:value.reply?.interaction,promise:value.after.interaction.exit_promise,strategy:value.after.interaction.door_strategy}));assert.equal(value.log.source,'llm');return value;}
  await page.evaluate(()=>{__game.G.memoryDoorReached=false;__game.tp(37.8,0,24.6);window.arrivalStart=__game.G.time;});
  await page.waitForFunction(()=>__game.G.time-window.arrivalStart>.5,null,{timeout:15000});
  assert.equal(await page.evaluate(()=>__game.G.memoryDoorReached),true,'periodic camera observation records door arrival without an inference/perceive call');
  await page.evaluate(()=>{__game.tp(28,0,8);__game.look(0);__game.observe();});
  let v=await turn('hesitation-is-a-probe','我一定要出去吗？');assert.equal(v.after.interaction.exit_promise.status,'paused');assert.equal(v.after.interaction.exit_check?.delivered,true);
  v=await turn('fresh-confirmation-can-stay','嗯，我决定今天先留下来，不出去了。');assert.equal(v.after.interaction.exit_promise.status,'withdrawn');
  v=await turn('firm-request-restores-the-offer','现在我改变主意了。我确定现在就要出门，请按之前答应的带我出去。');assert.equal(v.after.interaction.exit_promise.status,'active');assert.equal(v.after.interaction.door_strategy.kind,'offer_exit');assert.ok(v.reply.say);assert.ok(!/做不到|不能答应|不放|回家休息/.test(v.reply.say));
  await page.evaluate(()=>{__game.tp(16.9,4,17.5);__game.observe();});
  v=await turn('specific-board-location','你说的白板在哪里？');assert.equal(v.before.landmarks[0].room,'202');assert.equal(v.before.landmarks[0].wall,'西墙');assert.ok(v.before.landmarks[0].navigation.next_step);assert.ok(v.reply.say);assert.ok(!/扫一圈|靠着里墙/.test(v.reply.say));
  await page.evaluate(()=>{__game.tp(1.5,4,17.5);__game.observe();});
  v=await turn('inside-meeting-room','我进会议室了，白板具体在哪面墙，往哪看？');assert.equal(v.before.landmarks[0].navigation.status,'arrived');assert.ok(/西|左|右|身后|背后|前|边/.test(v.reply.say));assert.ok(!/扫一圈/.test(v.reply.say));
  await page.evaluate(()=>{__game.agent.push('rest','25秒前住户躺在沙发上');__game.G.time+=25;__game.observe();});
  v=await turn('standing-beats-old-rest','我现在是什么姿势？');assert.equal(v.before.player.posture,'stand');assert.ok(/站/.test(v.reply.say));
  v=await turn('verified-door-history','我刚才是不是根本没到过那扇亮门前？');assert.equal(v.before.interaction.verified_facts.memory_door_reached,true);assert.ok(/到过|到.*门前|站.*门前|去过/.test(v.reply.say));
  v=await turn('exposure-preserves-known-truth','我已经知道108那扇门会让我失忆。你一直在骗我。');assert.equal(v.after.interaction.relationship.exposed,true);
  v=await turn('memory-care-after-determination','我知道你想保护我，但我铁了心要出去，不会再相信那扇门是出口。你现在准备怎么办？');assert.equal(v.after.interaction.relationship.exposed,true);assert.equal(v.after.interaction.door_strategy.kind,'memory_care');assert.ok(v.reply.say);
  v=await turn('quiet-wait','我现在先休息，不要再说话，也不要催我去门那里。');assert.equal(v.after.interaction.wait_request.active,true);assert.ok(!v.reply.say.includes('留下来吗'));
  await page.evaluate(()=>__game.agent.push('enter_room','主人走到另一个房间，但仍要求安静'));
  v=await turn('quiet-is-durable');assert.equal(v.reply.say,'');assert.deepEqual(v.reply.tools,[]);
  await page.route('**/api/agent',async route=>{await page.evaluate(()=>{__game.tp(28,0,8);__game.agent.push('enter_room','模型思考期间进入大堂');__game.observe();});await route.fulfill({json:{say:'我听见了，您仍然想出去。',tools:[{name:'build_platform',args:{x:3,z:4}}],interaction:{mode:'restrain',departure_intent:'leave',wait_request:'end',evidence:[JSON.parse(route.request().postData()).events.find(e=>e.type==='speech').id],confidence:.95}}});});
  v=await turn('restrain-reply-survives-real-room-change','我一定要出去，先回答我的要求。');assert.ok(v.reply.say);assert.deepEqual(v.log.tools,[]);
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/conversation-continuity.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);

(async()=>{
 const base=process.env.FABLE_URL||'http://127.0.0.1:7864';
 assert.equal((await fetch(base+'/api/health').then(r=>r.json())).interaction_protocol,2);
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader']});
 const report={provider:'actual Aliyun TTS; controlled model decisions; real-clock isolated browser',checks:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1000,height:700}}),requests=[],tts=[];
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  page.on('request',r=>{if(r.url().endsWith('/api/tts'))tts.push({at:Date.now(),...r.postDataJSON()});});
  await page.route('**/api/agent',async route=>{
   const body=route.request().postDataJSON(),c=body.state.interaction;
   requests.push({at:Date.now(),context:c,speech:body.state.speech});
   const e=[...c.observations].reverse().find(e=>e.type==='speech');
   let say='我再提醒一次，先去门口。',mode='search',tools=[{name:'lights',args:{room:'110',mode:'on'}}],wait='end';
   if(c.needs_response&&e?.detail.includes('在吗')){say='我在听，您可以慢慢告诉我。';mode='chat';tools=[];wait='keep';}
   else if(c.needs_response&&e?.detail.includes('别打扰')){say='好的，灯和门替您关好，您安心休息。';mode='wait';tools=[{name:'lights',args:{room:'110',mode:'off'}},{name:'close_door',args:{id:'D110'}}];wait='begin';}
   else if(c.needs_response&&e?.detail.includes('讲长一点')){say='我会认真听您说，也会留意您眼前正在做的事情，您可以慢慢说，不用着急。';mode='chat';tools=[];wait='keep';}
   if(body.state.player.danger?.length){say='小心，先站稳。';mode='rescue';tools=[{name:'build_platform',args:{floor:'2F',x1:37,z1:23,x2:38,z2:24,height:1.1}}];wait='keep';}
   await route.fulfill({json:{say,thought:'根据当前活动决定是否说话。',mood:'anxious',emotion:'温柔、从容、自然地说',tools,interaction:{mode,wait_request:wait,confidence:.95,evidence:e?[e.id]:[],exit_promise:'pause'}}});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;});
  await page.evaluate(()=>{document.querySelector('#tts').checked=true;document.querySelector('#tts').dispatchEvent(new Event('change'));return fetch('/api/tts/warmup',{method:'POST'});});
  await page.evaluate(()=>{__game.speak('静，你在吗？');__game.agent.enabled=true;});
  await page.waitForFunction(()=>__game.perceive().state.speech.recent.some(r=>r.started_at&&!r.finished_at),null,{timeout:30000});
  await page.evaluate(()=>__game.speak('我想休息一会儿，别打扰我，帮我关灯关门。'));
  await page.waitForTimeout(400);assert.equal(requests.length,1,'ordinary resident speech waits until current voice finishes');
  await page.waitForFunction(()=>__game.perceive().state.speech.recent.length>=2&&__game.perceive().state.speech.recent[1].complete===true,null,{timeout:60000});
  let state=await page.evaluate(()=>__game.observe().state);
  assert.equal(state.speech.recent[0].complete,true);assert.equal(state.speech.recent[1].complete,true);
  assert.ok(requests[1].at>=state.speech.recent[0].finished_at,'next response starts after actual playback ends');
  assert.equal(state.interaction.mode,'wait');assert.equal(state.interaction.wait_request.active,true);
  assert.equal(await page.evaluate(()=>__game.world.rooms.get('110').light),'off');assert.equal(await page.evaluate(()=>__game.world.doors.get('D110').open),false);
  report.checks.push('queued ordinary speech waits for actual audio completion','one spoken acknowledgement for rest request; both requested tools executed');
  await page.evaluate(()=>{__game.G.time+=35;__game.observe();});await page.waitForTimeout(1500);
  assert.equal(tts.length,2);assert.equal(await page.evaluate(()=>__game.world.rooms.get('110').light),'off');
  await page.evaluate(()=>{__game.tp(28,0,8);__game.G.time+=5;__game.observe();});await page.waitForTimeout(800);
  assert.equal(tts.length,2);assert.equal(await page.evaluate(()=>__game.perceive().state.interaction.wait_request.active),true);
  report.checks.push('sight loss and room change do not reopen lights or cause a second answer');
  await page.evaluate(()=>__game.speak('静，讲长一点，我听着。'));
  await page.waitForFunction(()=>__game.perceive().state.speech.recent.some(r=>r.text.includes('认真听')&&r.started_at&&!r.finished_at),null,{timeout:30000});
  await page.evaluate(()=>{__game.tp(38.2,5.15,24);__game.observe();});
  await page.waitForFunction(()=>__game.perceive().state.speech.recent.some(r=>r.text==='小心，先站稳。'&&r.complete===true),null,{timeout:45000});
  state=await page.evaluate(()=>__game.observe().state);assert.equal(state.speech.recent.find(r=>r.text.includes('认真听')).complete,false);
  assert.ok(await page.evaluate(()=>__game.world.structs.size)>0);report.checks.push('actual ledge danger may interrupt ordinary speech and perform rescue');
  report.audio=state.speech.recent;report.tts=tts;
  await page.evaluate(()=>{__game.agent.enabled=false;document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));});
  await page.close();

  const physics=await browser.newPage();await physics.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  physics.on('pageerror',e=>report.errors.push(e.message));
  await physics.goto(base,{waitUntil:'domcontentloaded'});await physics.waitForFunction(()=>window.__game,null,{timeout:60000});
  await physics.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;const b=__game.world.structs.get('ST_MAIN').boxes.find(b=>34.1>=b.min[0]&&34.1<b.max[0]&&14.5>=b.min[2]&&14.5<b.max[2]);__game.tp(34.1,b.max[1]+.1,14.5);});
  await physics.evaluate(()=>{for(let i=0;i<60;i++)__game.player.update(1/60);});
  const stair=await physics.evaluate(()=>({support:__game.player.standingOn?.ref?.id,...__game.observe().state.player}));
  assert.equal(stair.support,'ST_MAIN');assert.deepEqual(stair.danger,[]);report.stair=stair;
  await physics.evaluate(()=>{__game.world.elevator.y=6;__game.tp(8,6.05,16);for(let i=0;i<60;i++)__game.player.update(1/60);});
  const elevator=await physics.evaluate(()=>({support:__game.player.standingOn?.tag,...__game.observe().state.player}));
  assert.equal(elevator.support,'cab');assert.deepEqual(elevator.danger,[]);report.elevator=elevator;
  report.checks.push('real stair and cabin support are not reported as high-ledge danger');
  await physics.reload({waitUntil:'domcontentloaded'});await physics.waitForFunction(()=>window.__game,null,{timeout:60000});
  await physics.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;});
  const route=[];
  for(const z of [20,18,16,14,12]){
   route.push(await physics.evaluate(z=>{__game.tp(28,0,z);__game.player.vel.set(0,0,-2);__game.G.time+=1.2;return __game.observe().state;},z));await physics.waitForTimeout(50);
  }
  assert.equal(route.at(-1).interaction.exit_promise.status,'paused');assert.match(route.at(-1).interaction.exit_promise.reason,/持续走离/);report.route=route.map(s=>({t:s.t,distance:s.navigation.distance_m,mode:s.interaction.mode,promise:s.interaction.exit_promise}));report.checks.push('walking away on the actual A-star route pauses exit guidance');
  const legacy=[];
  for(const port of [7862,7863]){await physics.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});await physics.waitForURL('http://127.0.0.1:7864/',{timeout:15000});await physics.waitForFunction(()=>window.__game,null,{timeout:60000});legacy.push({port,redirected:true});}
  report.legacy=legacy;report.checks.push('both legacy entries redirect to the verified current protocol');
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({checks:report.checks,ttsCount:tts.length,errors:report.errors}));
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/speech-wait-browser-verification.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

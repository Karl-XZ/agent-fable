const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const report=JSON.parse(fs.readFileSync('.runtime/interaction-live-verification.json','utf8'));
 const sample=report.cases.find(c=>c.name==='prolonged-inspect'&&c.passed).replies.at(-1);
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:800,height:500}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();
   window.__tts=[];window.__samples=[];window.__captions=[];window.__track=false;
   const fetchOriginal=window.fetch;
   window.fetch=function(url,options){if(String(url).endsWith('/api/tts'))window.__tts.push({body:JSON.parse(options.body),at:performance.now()});return fetchOriginal.apply(this,arguments);};
   const start=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(at){
    if(window.__track&&this.buffer&&!this.loop){const item={at:performance.now(),scheduled:at,contextTime:this.context.currentTime,duration:this.buffer.duration,ended:false};window.__samples.push(item);this.addEventListener('ended',()=>{item.ended=true;item.endAt=performance.now();});}
    return start.apply(this,arguments);
   };
  });
  await page.route('**/api/agent',route=>route.fulfill({json:sample}));
  await page.goto(process.env.FABLE_URL||'http://127.0.0.1:7862/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;});
  await page.evaluate(()=>fetch('/api/tts/warmup',{method:'POST'}).then(r=>{if(!r.ok)throw Error('Aliyun warmup failed');}));
  await page.evaluate(()=>{
   const g=__game;g.tp(5.2,0,25.6,-.73);g.player.pitch=-.14;g.observe();
   new MutationObserver(()=>{const value=document.querySelector('#subtitle .line').textContent;if(value)window.__captions.push({text:value,at:performance.now()});}).observe(document.querySelector('#subtitle .line'),{childList:true,subtree:true});
   window.__track=true;
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{__game.G.time+=4;__game.observe();});
  assert.equal(await page.evaluate(()=>__game.perceive().state.interaction.activity.kind),'inspect','audio fixture must already be inspecting before the first reply');
  const out=await page.evaluate(()=>__game.agent.run('building'));
  assert.equal(out.say,sample.say);
  assert.equal(await page.evaluate(()=>__game.agent.canSpeak()),false,'routine speech is gated while actual TTS is pending or playing');
  await page.waitForFunction(()=>window.__samples.length>0,null,{timeout:20000});
  await page.waitForFunction(()=>__game.agent.canSpeak(),null,{timeout:45000});
  const actual=await page.evaluate(()=>({requests:window.__tts,samples:window.__samples,captions:window.__captions,toast:document.querySelector('#toast').textContent}));
  assert.equal(actual.requests.length,1);assert.equal(actual.requests[0].body.text,sample.say);assert.equal(actual.requests[0].body.emotion,sample.emotion);
  assert.ok(actual.samples.every(s=>s.ended));
  assert.ok(actual.samples.reduce((total,s)=>total+s.duration,0)>1);
  const caption=actual.captions.find(c=>c.text===sample.say);assert.ok(caption);
  assert.ok(Math.abs(caption.at-actual.samples[0].at)<500,'caption appears when actual voice starts');
  const silent=await page.evaluate(()=>__game.agent.run('building'));assert.equal(silent.say,'');
  assert.equal(await page.evaluate(()=>window.__tts.length),1,'quiet follow-up does not request repeated narration');
  assert.deepEqual(errors,[]);
  const result={provider:'actual Aliyun streaming TTS',dialogueSource:'actual model prolonged-inspect reply; replayed through mocked agent endpoint for audio isolation',text:sample.say,emotion:sample.emotion,mood:sample.mood,firstAudioMs:actual.samples[0].at-actual.requests[0].at,playbackSeconds:actual.samples.reduce((t,s)=>t+s.duration,0),captionOffsetMs:caption.at-actual.samples[0].at,quietFollowupSilent:true,errors};
  fs.writeFileSync('.runtime/interaction-audio-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

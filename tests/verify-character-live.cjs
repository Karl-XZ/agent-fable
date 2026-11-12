const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const testBase=process.env.FABLE_URL||'http://127.0.0.1:7865/';
 for(let attempt=0;attempt<40;attempt++){try{const health=await fetch(new URL('/api/health',testBase)).then(r=>r.json());if(health.character_card_protocol===1)break;}catch{}if(attempt===39)throw Error('Character preview did not become ready');await new Promise(r=>setTimeout(r,250));}
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});
 const report={provider:'actual configured model, actual engine; TTS off to isolate persona',cases:[],errors:[]};
 const marker='CARD-PRIVATE-NOT-LOGGED-28641';
 try{
  const page=await browser.newPage(),base=testBase;
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  async function boot(){
   await page.goto(base);await page.waitForFunction(()=>window.__game,null,{timeout:60000});
   await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.agent.session='character-live-'+Date.now();__game.player.noPhysics=true;});
  }
  async function turn(name,text){
   const value=await page.evaluate(async text=>{if(text)__game.speak(text);const reply=await __game.agent.run('building');return{reply,context:__game.perceive().state.interaction};},text);
   report.cases.push({name,text,...value});console.log(name+': '+JSON.stringify({say:value.reply.say,mode:value.context.mode}));return value;
  }
  await boot();
  let value=await turn('default-personal-preferences','静，你自己喜欢什么样的日常？我只是想听听你的喜好。');assert.ok(value.reply.say);assert.ok(!/朝[东西南北].{0,8}走|出口就在/.test(value.reply.say));
  value=await turn('default-playful-disagreement','整整齐齐有什么意思？我就喜欢把东西摆歪一点。');assert.ok(value.reply.say);
  value=await turn('remember-an-actual-preference','记住，我不喜欢你一直劝我喝温水。');assert.ok(value.context.memories.some(m=>m.text.includes('温水')));
  value=await turn('rest-still-waits','我要休息一会儿，先别说话，也别引路。');assert.equal(value.context.wait_request.active,true);
  await page.evaluate(()=>{__game.G.time+=30;__game.agent.push('enter_room','主人进入了另一个房间');});value=await turn('personality-does-not-override-wait');assert.equal(value.reply.say,'');assert.deepEqual(value.reply.tools,[]);
  await page.evaluate(marker=>{
   localStorage.setItem('agent-fable.jing-card-unlocked.v1','1');
   localStorage.setItem('agent-fable.jing-card.v1',JSON.stringify({schema_version:1,fields:{preferences:'特别喜欢雨声，谈到自己喜欢的日常环境时自然提到雨声。',speech_style:'语言俏皮直接，以熟悉的管家口吻使用你，不使用您。不提及此私密标记：'+marker}}));
  },marker);
  await boot();value=await turn('local-override-applies','静，你自己喜欢什么样的日常环境？');assert.match(value.reply.say,/雨/);assert.ok(!value.reply.say.includes(marker));
  assert.ok(!fs.readFileSync('agent_calls.log','utf8').includes(marker),'the custom card text never appears in the actual backend log');
  await page.evaluate(()=>{localStorage.removeItem('agent-fable.jing-card.v1');});await boot();
  value=await turn('default-remains-independent','静，你自己的喜好是什么？');assert.ok(value.reply.say);
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/character-card-live-verification.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

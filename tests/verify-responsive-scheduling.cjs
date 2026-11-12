const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});
 const report={provider:'controlled slow/error decisions, actual engine and real-clock scheduler',checks:[],errors:[]};
 try{
  const page=await browser.newPage(),requests=[];let hold=true,fail=false,heldRoute;
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/api/agent',async route=>{
   const body=route.request().postDataJSON();requests.push({at:Date.now(),body});
   if(hold){heldRoute=route;return;}
   if(fail){await route.fulfill({status:503,json:{error:'controlled test outage'}});return;}
   const e=[...body.state.interaction.observations].reverse().find(e=>e.type==='speech');
   await route.fulfill({json:{say:'展厅里有沙盘，可以慢慢看看。',thought:'先回答主人的新问题。',tools:[],interaction:{mode:'chat',evidence:e?[e.id]:[],confidence:.95}}});
  });
  await page.goto(process.env.FABLE_URL||'http://127.0.0.1:7865/');await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;window.oldRun=__game.agent.run('building');});
  await page.waitForFunction(()=>__game.agent.busy);while(!requests.length)await page.waitForTimeout(20);
  hold=false;const at=Date.now();await page.evaluate(()=>{__game.speak('静，这里有什么娱乐项目？');__game.agent.enabled=true;});
  await page.waitForFunction(()=>__game.agent.log.some(l=>l.say.includes('沙盘')),null,{timeout:5000});
  assert.equal(requests.length,2);assert.ok(requests[1].at-at<2000);assert.equal(await page.evaluate(()=>__game.agent.fails),0);
  report.preemption_ms=requests[1].at-at;report.checks.push('new heard request aborts pending ambient fetch and starts inference promptly, without a spoken fallback');
  await heldRoute.fulfill({json:{say:'已经过时的催门回复',tools:[],interaction:{mode:'guide'}}}).catch(()=>{});
  await page.waitForTimeout(200);assert.ok(!await page.evaluate(()=>__game.agent.history.some(h=>h.text.includes('过时'))));
  fail=true;await page.evaluate(()=>{__game.agent.enabled=false;__game.player.onLand(5.3);window.careRun=__game.agent.run('building');});
  const care=await page.evaluate(()=>window.careRun);assert.ok(care.say);assert.equal(care.interaction.mode,'care');assert.equal(await page.evaluate(()=>__game.perceive().state.interaction.care_needed),false);
  report.checks.push('observed fall receives a caring acknowledgement even if model endpoint fails');
  const before=await page.evaluate(()=>__game.perceive().state.interaction.recent_injury.observation);
  await page.evaluate(()=>{__game.tp(2,0,16);__game.observe();__game.player.onLand(6);});
  assert.equal(await page.evaluate(()=>__game.perceive().state.interaction.recent_injury.observation),before);report.checks.push('an unseen bathroom fall is not magically reported as a new camera observation');
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report));
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/responsive-scheduling.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

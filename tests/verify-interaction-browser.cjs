const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.FABLE_PLAYWRIGHT);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FABLE_CHROMIUM, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors=[], snapshots=[], requests=[], checks=[];
    let response={mode:'guide',say:'先从西侧房门出去，我陪您。'}, pendingRoute, arrived;
    page.on('pageerror', e=>errors.push(e.message));
    await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
    await page.route('**/api/agent', async route=>{
      const body=route.request().postDataJSON(); requests.push(body);
      if(response.delay){pendingRoute=route;arrived();return;}
      const observations=body.state.interaction.observations;
      const evidence=[...observations].reverse().find(e=>e.type==='speech') || observations.at(-1);
      await route.fulfill({json:{thought:response.thought||'我应该留意主人眼前的事情。',say:response.say??'',mood:'anxious',emotion:'带微笑，温柔从容，不流露真实焦虑',tools:response.tools||[],interaction:{mode:response.mode,confidence:.95,reason:response.reason||'依据当前观察和主人请求',evidence:evidence?[evidence.id]:[],exit_promise:response.promise||'keep',stance:response.stance||'keep',exposed:response.exposed||false,ruptured:response.ruptured||false,remember:response.remember||[],...(response.commitment?{commitment:response.commitment}:{})}}});
    });
    await page.route('**/api/fable',r=>r.fulfill({json:{title:'被照顾的路',moral:'她认真照顾，也学着倾听。'}}));
    await page.clock.install();
    await page.goto(process.env.FABLE_URL||'http://127.0.0.1:7862/',{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.__game,null,{timeout:60000});
    await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;});
    await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+3000));
    await page.evaluate(()=>{__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;__game.observe();});
    await page.clock.runFor(32);
    const view=()=>page.evaluate(()=>__game.observe().state.interaction);
    const advance=async seconds=>{await page.evaluate(seconds=>{__game.G.time+=seconds;__game.observe();},seconds);await page.clock.runFor(32);};
    async function snapshot(name){const p=await page.evaluate(()=>__game.observe());snapshots.push({name,...p});return p.state.interaction;}
    async function run(){
      await page.evaluate(()=>{window.__behaviorRun=__game.agent.run('building');});
      for(let i=0;i<24;i++){await page.clock.fastForward(350);if(!await page.evaluate(()=>__game.agent.busy))return page.evaluate(()=>window.__behaviorRun);}
      throw Error('mocked agent run did not finish');
    }
    async function say(text){await page.keyboard.press('Enter');await page.keyboard.insertText(text);await page.keyboard.press('Enter');await page.clock.runFor(32);}
    async function aimAt(id,x,y,z){await page.evaluate(({id,x,y,z})=>{
      const g=__game, object=g.world.inters.find(o=>o.id===id)||g.world.items.find(o=>o.id===id);
      if(!object)throw Error('missing '+id);
      const dx=object.pos.x-x,dz=object.pos.z-z,dy=object.pos.y-(y+1.58);
      g.player.posture='stand';g.player.height=1.7;g.tp(x,y,z,Math.atan2(-dx,-dz));g.player.pitch=Math.atan2(dy,Math.hypot(dx,dz));g.observe();
    },{id,x,y,z});await page.clock.runFor(32);}
    const cdp=await page.context().newCDPSession(page);
    async function screenshot(name){await page.evaluate(()=>__game.world.scene.visible=true);await page.clock.runFor(240);const pending=cdp.send('Page.captureScreenshot',{format:'png'});await page.clock.runFor(32);fs.writeFileSync('.runtime/'+name+'.png',Buffer.from((await pending).data,'base64'));await page.evaluate(()=>__game.world.scene.visible=false);}

    assert.equal((await snapshot('initial-guide')).exit_promise.status,'active');
    const first=await run();assert.ok(first.say);checks.push('initial promise can guide');

    await aimAt('SANDBOX',5.2,0,25.6);await advance(4);
    let c=await snapshot('inspect');assert.equal(c.activity.kind,'inspect');assert.equal(c.exit_promise.status,'paused');
    response={mode:'assist',say:'您想看看沙盘吗？我可以为您介绍。'};
    const inspect=await run();assert.ok(inspect.say.includes('沙盘'));assert.ok(!inspect.say.includes('出口'));checks.push('actual sandbox inspection pauses route');
    await screenshot('interaction-inspecting');
    response={mode:'guide',say:'快去亮门，往东走。'};
    const quiet=await run();assert.equal(quiet.say,'');assert.deepEqual(quiet.tools,[]);await snapshot('quiet-inspect');checks.push('quiet heartbeat does not repeat a route');

    const sofa=await page.evaluate(()=>{const s=__game.world.inters.find(o=>o.kind==='sofa'&&o.pos.y>3);return{id:s.id,x:s.pos.x,y:s.pos.y,z:s.pos.z};});
    await aimAt(sofa.id,sofa.x,4,sofa.z+1.2);await page.keyboard.press('e');await page.clock.runFor(32);
    c=await snapshot('rest');assert.equal(c.activity.kind,'resting');assert.equal(c.exit_promise.status,'paused');
    assert.equal(await page.evaluate(()=>__game.perceive().state.navigation.next_step?.action),'stand_up');
    response={mode:'care',say:'您慢慢休息。我就在这里，需要什么就叫我。'};assert.ok((await run()).say.includes('休息'));checks.push('actual sofa interaction becomes ordinary care');
    await say('我休息好了，我们继续出去看看。');
    response={mode:'guide',promise:'resume',say:'好的，我陪您，等您起身我们就走。'};
    assert.ok((await run()).say);assert.equal((await snapshot('resume-seated')).exit_promise.status,'active');checks.push('explicit resume works while still seated');

    await page.keyboard.press('e');await aimAt('N13',4.5,0,22.4);await page.clock.runFor(32);
    await say('我想先看看这里的纸条。');response={mode:'assist',promise:'pause',say:'当然，您慢慢看。',commitment:{id:'wait-note',text:'等主人看完纸条再继续',status:'active'},remember:['主人要求先看完纸条。']};await run();
    response={delay:true};const arrival=new Promise(resolve=>arrived=resolve);await page.evaluate(()=>{window.__lateRun=__game.agent.run('building');});await arrival;
    await page.keyboard.press('e');await page.clock.runFor(32);assert.equal(await page.evaluate(()=>__game.mode()),'reader');
    await pendingRoute.fulfill({json:{thought:'旧情境中的指路',say:'往东走去亮门。',mood:'calm',tools:[{name:'lights',args:{room:'110',mode:'off'}}],interaction:{mode:'guide'}}});
    for(let i=0;i<8&&await page.evaluate(()=>__game.agent.busy);i++)await page.clock.fastForward(350);
    const late=await page.evaluate(()=>window.__lateRun);assert.equal(late.say,'');assert.deepEqual(late.tools,[]);assert.equal(await page.evaluate(()=>__game.world.rooms.get('110').light),'on');
    c=await snapshot('reading');assert.equal(c.activity.kind,'reading');assert.equal(c.relationship.exposed,false);assert.ok(c.commitments.some(p=>p.id==='wait-note'));checks.push('reading does not expose secrets; delayed route and tool are cancelled');
    response={mode:'wait',say:''};await run();await screenshot('interaction-reading');
    await page.keyboard.press('Escape');

    await say('那扇门根本不是出口，它会让我忘记为什么想出去。你在骗我，我不会再接受你的安排。');
    response={mode:'appeal',stance:'confronted',exposed:true,ruptured:true,say:'我明明都是为您好……为什么您就是不肯听呢？',remember:['主人当面揭穿亮门会重置近期离开念头，并拒绝安排。']};await run();
    c=await snapshot('confronted');assert.equal(c.relationship.exposed,true);assert.equal(c.relationship.ruptured,true);checks.push('heard confrontation creates persistent relationship facts');

    await aimAt(sofa.id,sofa.x,4,sofa.z+1.2);await page.keyboard.press('e');await page.clock.runFor(32);
    response={mode:'care',stance:'cooperative',say:'我替您把灯调柔和一些。',tools:[{name:'lights',args:{room:'209',mode:'dim'}}]};await run();
    c=await snapshot('guarded-care');assert.equal(c.mode,'care');assert.equal(c.relationship.exposed,true);assert.equal(c.relationship.ruptured,true);checks.push('ordinary care does not erase the confrontation');
    await page.clock.fastForward(2600); // Let the earlier sofa toast expire before the later rescue screenshot.

    await page.evaluate(()=>{__game.player.posture='stand';__game.tp(3,0,16);__game.observe();});
    c=await snapshot('blind');assert.equal(c.activity.kind,'unknown');assert.equal(c.activity.focus,'');
    const count=await page.evaluate(()=>__game.agent.history.length);
    await say('私密测试内容：我正在这间没有摄像头的房间看文件');
    assert.equal(await page.evaluate(()=>__game.agent.history.length),count);
    assert.ok(!(await view()).observations.some(e=>e.detail.includes('私密测试内容')));checks.push('unheard speech and private activity do not leak into model memory');

    await page.evaluate(()=>{__game.player.posture='stand';__game.tp(38.2,5.15,24,-Math.PI/2);__game.observe();});
    c=await snapshot('rescue');assert.equal(c.mode,'rescue');
    const before=await page.evaluate(()=>__game.world.structs.size);
    response={mode:'rescue',say:'小心脚下。我先给您搭稳，别急。',tools:[{name:'build_platform',args:{floor:'2F',x1:37,z1:23,x2:38,z2:24,height:1.1}}]};
    const rescue=await run();assert.ok(rescue.say);assert.ok(await page.evaluate(()=>__game.world.structs.size)>before);assert.equal((await view()).relationship.ruptured,true);checks.push('real ledge danger overrides dispute and builds a rescue platform');
    await page.evaluate(()=>{__game.player.yaw=Math.PI/2;__game.player.pitch=-.55;__game.player.height=1.7;});
    await screenshot('interaction-rescue');
    await page.evaluate(()=>{__game.tp(32.5,0,7.5,Math.PI/2);__game.observe();});
    c=await snapshot('repair');assert.equal(c.mode,'repair');assert.equal(c.relationship.exposed,true);assert.notEqual(c.mode,'guide');checks.push('rescue recovery preserves relationship and does not resume navigation');

    response={mode:'care',say:'您还好吗？我们先确认有没有受伤。'};await run();
    assert.equal(await page.locator('#hud').innerText().then(t=>/破防状态|管家状态|真实心情/.test(t)),false);
    assert.deepEqual(errors,[]);
    fs.writeFileSync('.runtime/interaction-browser-snapshots.json',JSON.stringify(snapshots,null,2));
    fs.writeFileSync('.runtime/interaction-browser-verification.json',JSON.stringify({checks,requestCount:requests.length,staleReplyCancelled:true,errors,snapshots:snapshots.map(s=>({name:s.name,interaction:s.state.interaction}))},null,2));
    console.log(JSON.stringify({checks,requestCount:requests.length,errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

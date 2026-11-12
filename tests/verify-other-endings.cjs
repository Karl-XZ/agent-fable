const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader']});
 const results=[];
 try{
  for(const [key,name] of [['fake','如常'],['stay','长住'],['jail','囚禁'],['loop','门外还是门'],['swap','易位']]){
   const page=await browser.newPage({viewport:{width:1000,height:700}}), errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
   await page.route('**/api/agent',r=>r.fulfill({json:{say:'',tools:[]}}));
   await page.route('**/api/fable',r=>r.fulfill({json:{title:'仍在照顾',moral:'她记得主人，也记得自己的责任。'}}));
   await page.clock.install();
   await page.goto(process.env.FABLE_URL||'http://127.0.0.1:7862/',{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>window.__game,null,{timeout:60000});
   await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;});
   await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+3000));
   await page.evaluate(key=>{
    __game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;
    __game.agent.log.push({t:0,thought:'先照顾眼前的需要。',say:'我在这里。',tools:[],source:'rule',channel:'building',ms:0,trigger:['fixture:settlement-regression']});
    if(key==='fake')__game.tp(38.5,0,24.6);else __game.endGame(key);
   },key);
   await page.clock.runFor(32);
   if(key==='fake'){
    assert.equal(await page.locator('#homeFilm').getAttribute('data-kind'),'memory');
    assert.equal(await page.locator('#filmWho').textContent(),'静');
    await page.clock.fastForward(60000);
   }else await page.clock.fastForward(3000);
   assert.equal(await page.locator('#ending').isVisible(),true,key+' settlement');
   assert.equal(await page.locator('#endName').textContent(),name);
   assert.equal(await page.locator('#endStats>div').count(),6);
   assert.ok(await page.locator('#endMaps canvas').count());
   assert.match(await page.locator('#endLog').textContent(),/先照顾眼前的需要/);
   assert.equal(await page.locator('#btnLoop').isVisible(),key==='fake');
   assert.equal(await page.locator('#btnAgain').isVisible(),key!=='fake');
   await page.locator('#ending').evaluate(el=>el.getAnimations().forEach(a=>a.finish()));
   const cdp=await page.context().newCDPSession(page);const pending=cdp.send('Page.captureScreenshot',{format:'png'});await page.clock.runFor(32);
   fs.writeFileSync('.runtime/ending-'+key+'-contextual.png',Buffer.from((await pending).data,'base64'));
   assert.deepEqual(errors,[]);
   results.push({key,name,settlement:true,stats:6,maps:true,logPreserved:true,entry:key==='fake'?'actual-memory-door':'direct-ending-hook',filmAudioEnabled:false,errors});
   console.log(key+': ending, stats, route, decision log and correct replay button passed');
   await page.close();
  }
  fs.writeFileSync('.runtime/other-endings-contextual-verification.json',JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

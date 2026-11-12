const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.FABLE_PLAYWRIGHT);
const CARD='agent-fable.jing-card.v1',UNLOCK='agent-fable.jing-card-unlocked.v1';
(async()=>{
 const base=process.env.FABLE_URL||'http://127.0.0.1:7865/';
 for(let attempt=0;attempt<40;attempt++){try{const health=await fetch(new URL('/api/health',base)).then(r=>r.json());if(health.character_card_protocol===1)break;}catch{}if(attempt===39)throw Error('Character preview did not become ready');await new Promise(r=>setTimeout(r,250));}
 const browser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--use-angle=swiftshader']});
 const report={checks:[],errors:[]};
 try{
  const context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage(),posts=[];
  await context.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))posts.push({url:r.url(),body:r.postDataJSON()});});
  await page.route('**/api/agent',r=>r.fulfill({json:{say:'',thought:'先听主人说话。',tools:[]}}));
  await page.route('**/api/fable',r=>r.fulfill({json:{title:'门外的日常',moral:'照料也有自己的样子。'}}));
  async function load(){await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game,null,{timeout:60000});await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.agent.enabled=false;});}
  async function start(){await page.evaluate(()=>{__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;});}
  await load();await page.locator('#btnSettings').click();assert.equal(await page.locator('#btnCharacter').isDisabled(),true);
  await page.screenshot({path:'.runtime/character-locked.png'});report.checks.push('editor locked before the first escape');
  await load();await start();await page.evaluate(()=>__game.endGame('stay'));await page.waitForFunction(()=>__game.mode()==='ending');assert.equal(await page.evaluate(key=>localStorage.getItem(key),UNLOCK),null);
  report.checks.push('another ending does not unlock character editing');
  await load();await start();await page.evaluate(()=>__game.endGame('out'));
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),UNLOCK),null,'transition does not unlock before settlement');
  await page.waitForFunction(()=>__game.mode()==='ending');assert.equal(await page.evaluate(key=>localStorage.getItem(key),UNLOCK),'1');
  assert.equal(await page.locator('#characterUnlockNotice').isVisible(),true);await page.screenshot({path:'.runtime/character-unlocked-settlement.png'});
  report.checks.push('escape unlocks at settlement only, with a settlement notice');
  await load();await page.locator('#btnSettings').click();assert.equal(await page.locator('#btnCharacter').isEnabled(),true);await page.locator('#btnCharacter').click();
  assert.equal(await page.locator('#characterEditor').isVisible(),true);
  assert.equal(await page.locator('#pause').isVisible(),false,'parent settings do not overlap the editor');
  await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#characterForm button[type=submit]').evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('#character-personality').evaluate(el=>document.activeElement===el),true);
  await page.locator('#characterEditor').evaluate(el=>el.getAnimations({subtree:true}).forEach(a=>a.finish()));
  await page.screenshot({path:'.runtime/character-editor.png'});
  const before=await page.evaluate(()=>__game.player.pos.toArray());const count=posts.length;
  await page.locator('#character-personality').focus();await page.keyboard.type('wasd');assert.deepEqual(await page.evaluate(()=>__game.player.pos.toArray()),before);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#characterEditor').isVisible(),false);assert.equal(await page.evaluate(()=>__game.mode()),'pause');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),CARD),null);
  await page.locator('#btnCharacter').click();const marker='LOCAL-CARD-PRIVATE-8731：用简短、有一点幽默的句子说话。';
  await page.locator('#character-speech_style').fill(marker);await page.locator('#characterForm button[type=submit]').click();
  assert.equal(posts.length,count,'editing and saving do not send API requests');
  assert.equal(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),CARD)).fields.speech_style,marker);
  report.checks.push('typing is isolated; Escape cancels drafts; saving uses only localStorage');
  await page.evaluate(()=>__game.agent.run('building'));
  let sent=posts.filter(p=>p.url.endsWith('/api/agent')).at(-1).body;
  assert.equal(sent.character_card.fields.speech_style,marker);assert.ok(!JSON.stringify(sent.state).includes(marker));
  assert.equal(sent.private_character_session,true);
  report.checks.push('personal fields are sent only with subsequent inference, outside sensed state');
  await load();await page.locator('#btnSettings').click();await page.locator('#btnCharacter').click();assert.equal(await page.locator('#character-speech_style').inputValue(),marker);
  await page.locator('#characterReset').click();await page.locator('#characterCancel').click();await page.locator('#btnCharacter').click();assert.equal(await page.locator('#character-speech_style').inputValue(),marker);
  await page.locator('#characterReset').click();await page.locator('#characterForm button[type=submit]').click();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),CARD),null);assert.equal(await page.evaluate(key=>localStorage.getItem(key),UNLOCK),'1');
  report.checks.push('refresh retains the card; cancelled reset preserves it; saved reset retains unlock');
  const other=await browser.newContext(),otherPage=await other.newPage();await otherPage.goto(base);await otherPage.waitForFunction(()=>window.__game,null,{timeout:60000});
  assert.equal(await otherPage.evaluate(key=>localStorage.getItem(key),UNLOCK),null);assert.equal(await otherPage.locator('#btnCharacter').isDisabled(),true);await other.close();
  report.checks.push('another isolated browser profile has neither unlock nor overrides');
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify(report));
 }catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('.runtime/character-card-browser-verification.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

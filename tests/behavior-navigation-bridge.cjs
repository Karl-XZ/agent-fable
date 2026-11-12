const http = require('node:http');
const { chromium } = require(process.env.FABLE_PLAYWRIGHT);
let activeBrowser;
(async()=>{
  for(let attempt=0;attempt<40;attempt++){
    try{if((await fetch('http://127.0.0.1:7862/api/health')).ok)break;}catch{}
    if(attempt===39)throw Error('Test backend did not become ready');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  const browser=activeBrowser=await chromium.launch({executablePath:process.env.FABLE_CHROMIUM,headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:800,height:500}});
  await page.addInitScript(()=>{window.__noPause=true;HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.resolve();});
  await page.route('**/api/agent',r=>r.fulfill({json:{say:'',tools:[]}}));
  await page.goto('http://127.0.0.1:7862/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__game,null,{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#segQ [data-q="low"]').click();document.querySelector('#tts').checked=false;document.querySelector('#tts').dispatchEvent(new Event('change'));__game.world.scene.visible=false;__game.start();document.querySelector('#filmSkip').click();__game.agent.enabled=false;__game.player.noPhysics=true;});
  let queue=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET'&&req.url==='/health'){res.end('{"ready":true,"headless":true}');return;}
    if(req.method!=='POST'||req.url!=='/query'){res.writeHead(404);res.end('{}');return;}
    let data='';
    try{
      for await(const chunk of req){data+=chunk;if(data.length>500000)throw Error('Request too large');}
      const input=JSON.parse(data);
      const task=queue.then(()=>page.evaluate(({state,target})=>{
        const g=__game,p=state.player;
        if(p?.visible===false){g.G.visible=false;return g.exec('find_path',target);}
        if(!Number.isFinite(p?.x)||!Number.isFinite(p?.z))throw Error('Visible engine position required');
        g.G.visible=true;
        const y=({B1:-4,'1F':0,'2F':4,RF:8}[p.floor]??0)+(p.height_above_floor??0);
        g.tp(p.x,y,p.z,-(p.heading_degrees??0)*Math.PI/180);g.player.posture=p.posture||'stand';
        for(const room of g.world.rooms.values()){room.camCovered=false;if(room.light==='off')room.light='on';}
        for(const id of state.cameras_covered||[])if(g.world.rooms.has(id))g.world.rooms.get(id).camCovered=true;
        for(const door of g.world.doors.values())door.locked=(state.doors_locked||[]).includes(door.id);
        return g.exec('find_path',target);
      },input));
      queue=task.catch(()=>{});
      res.end(JSON.stringify(await task));
    }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
  });
  server.listen(7962,'127.0.0.1',()=>console.log('Headless real-engine navigation bridge ready on http://127.0.0.1:7962'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await browser.close();process.exit(0);}));
})().catch(async error=>{console.error(error);await activeBrowser?.close();process.exitCode=1;});

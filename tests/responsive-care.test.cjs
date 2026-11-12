const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Agent}=require('../.runtime/agent-behavior-test.cjs');
const {InteractionMemory}=require('../.runtime/interaction-behavior-test.cjs');
const state={player:{visible:true,danger:[]}};
const answer=(mode,evidence,say='我听见了，先别勉强自己。',tools=[])=>({say,tools,interaction:{mode,evidence,confidence:.95}});

test('a heard general answer survives walking and entering another room',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','能介绍这座房子的娱乐项目吗');m.context(state);const turn=m.captureTurn();
 m.recordEvent('enter_room','走进展厅');m.observeActivity('walking','',true);
 assert.ok(m.reconcile(answer('chat',[e.id]),turn).say);
});

test('a newer question still invalidates an earlier general answer',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','这里有什么');m.context(state);const turn=m.captureTurn();
 m.recordEvent('speech','先别说了');assert.equal(m.reconcile(answer('chat',[e.id]),turn).say,'');
});

test('a second injury supersedes an acknowledgement for the first one',()=>{
 const m=new InteractionMemory(()=>0);m.recordEvent('injury','第一次摔倒');m.context(state);const turn=m.captureTurn();
 m.recordEvent('injury','再次跌落');assert.equal(m.reconcile(answer('care',[]),turn).say,'');assert.equal(m.context(state).care_needed,true);
});

test('navigation still expires when a player changes rooms or starts reading',()=>{
 const m=new InteractionMemory(()=>0);m.context(state);const turn=m.captureTurn();
 m.observeActivity('reading','纸条',true);assert.equal(m.reconcile(answer('guide',[]),turn).say,'');
});

test('a heard injury report receives care even after the physical danger flag clears',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','我靠我腿好像摔断了');const c=m.context(state);
 const out=m.reconcile(answer('rescue',[e.id],undefined,[{name:'build_platform',args:{height:2}},{name:'lights',args:{room:'101',mode:'on'}}]),c.revision);
 assert.ok(out.say);assert.equal(out.interaction.mode,'care');assert.deepEqual(out.tools,[{name:'lights',args:{room:'101',mode:'on'}}]);
});

test('a real fall remains a pending care event after a delayed model response',()=>{
 let t=0;const m=new InteractionMemory(()=>t);m.recordEvent('injury','住户从5.3米高处摔下来，受伤了');m.context(state);const turn=m.captureTurn();
 t=15;m.recordEvent('enter_room','走入走廊');assert.equal(m.context(state).care_needed,true);
 const out=m.reconcile(answer('rescue',[],undefined,[{name:'build_platform',args:{height:2}}]),turn);
 assert.ok(out.say);assert.deepEqual(out.tools,[]);m.recordDelivery(out);assert.equal(m.context(state).care_needed,false);
});

test('a fall during quiet rest gets one care acknowledgement and then returns to waiting',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','我休息一下别说了');let c=m.context(state);
 m.reconcile({...answer('wait',[e.id]),interaction:{mode:'wait',evidence:[e.id],confidence:.95,wait_request:'begin'}},c.revision);
 m.recordEvent('injury','住户跌倒受伤了');c=m.context(state);const out=m.reconcile(answer('care',[]),c.revision);
 assert.ok(out.say);m.recordDelivery(out);assert.equal(m.context(state).care_needed,false);
 assert.equal(m.reconcile(answer('care',[]),m.context(state).revision).say,'');assert.equal(m.context(state).wait_request.active,true);
});

test('new heard speech starts inference while an earlier voice is still playing',()=>{
 let calls=0;const a=new Agent(()=>({state,ascii:''}),async()=>[],()=>20,()=>({say:'',tools:[]}));
 a.canSpeak=()=>false;a.run=async()=>{calls++;};a.lastCall=19.9;a.push('speech','这里有哪些娱乐项目',true);a.tick();assert.equal(calls,1);
});

test('new speech cancels ambient inference without invoking a fallback',async()=>{
 let fallback=0,applied=0;
 global.fetch=(_url,o)=>new Promise((_resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('superseded'))));
 const a=new Agent(()=>({state,ascii:''}),async()=>{applied++;return[];},()=>0,()=>{fallback++;return{say:'网络断了',tools:[]};});
 a.push('enter_room','进入展厅');const pending=a.run('building');a.push('speech','我腿好像摔断了',true);
 let timer;try{await Promise.race([pending,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('obsolete inference not cancelled')),500))]);}finally{clearTimeout(timer);}
 assert.equal(a.busy,false);assert.equal(fallback,0);assert.equal(applied,0);assert.equal(a.events.at(-1).type,'speech');
});

test('an idle heartbeat does not keep querying after an observation is reviewed',async()=>{
 let calls=0,t=0;global.fetch=async()=>Response.json({say:'',tools:[]});
 const a=new Agent(()=>({state,ascii:''}),async()=>[],()=>t,()=>({say:'',tools:[]}));await a.run('building');
 a.run=async()=>{calls++;};t=100;a.tick();assert.equal(calls,0);
});

test('an old route query is not supplied as the goal of a new conversation',async()=>{
 let body;global.fetch=async(_url,o)=>{body=JSON.parse(o.body);return Response.json(answer('chat',[]));};
 const a=new Agent(()=>({state,ascii:''}),async()=>[],()=>0,()=>({say:'',tools:[]}));
 a.results=[{ok:true,label:'find_path',msg:'去旧的露台门',navigation:{goal:'208'}},{ok:true,label:'lights',msg:'灯已调暗'}];
 a.push('speech','介绍一下房子');await a.run('building');assert.deepEqual(body.results.map(r=>r.label),['lights']);
});

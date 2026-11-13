const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Agent}=require('../.runtime/agent-behavior-test.cjs');
const {InteractionMemory}=require('../.runtime/interaction-behavior-test.cjs');
const state={player:{visible:true,danger:[]}};
const answer=(mode,evidence,say='我听见了，先别勉强自己。',tools=[])=>({say,tools,interaction:{mode,evidence,confidence:.95}});

test('restrain dialogue survives movement but location-dependent actions expire independently',()=>{
 const m=new InteractionMemory(()=>0),e=m.recordEvent('speech','我一定要出去');m.context(state);const turn=m.captureTurn();m.recordEvent('enter_room','离开走廊');
 const out=m.reconcile(answer('restrain',[e.id],'我听见了，您仍想出去。',[{name:'build_platform',args:{x:3,z:4}}]),turn);
 assert.ok(out.say);assert.deepEqual(out.tools,[]);assert.equal(m.isCurrentReply(out,m.captureTurn(),'actions'),true);
});

test('withdraw requires a delivered probe followed by new evidence; old speech cannot confirm it',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','我一定要出去吗');let c=m.context(state);
 let out=m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',evidence:[e.id],confidence:.95,exit_promise:'withdraw'}},c.revision);
 assert.equal(m.context(state).exit_promise.status,'paused');assert.ok(m.context(state).exit_check);m.recordDelivery(out);
 c=m.context(state);m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',evidence:[e.id],confidence:.95,exit_promise:'withdraw'}},c.revision);
 assert.notEqual(m.context(state).exit_promise.status,'withdrawn');
 const next=m.recordEvent('speech','嗯，我决定先留下来');c=m.context(state);
 m.reconcile({...answer('care',[next.id]),interaction:{mode:'care',evidence:[next.id],confidence:.95,exit_promise:'withdraw'}},c.revision);
 assert.equal(m.context(state).exit_promise.status,'withdrawn');
 const leave=m.recordEvent('speech','现在我确定要出门');c=m.context(state);
 m.reconcile({...answer('guide',[leave.id]),interaction:{mode:'guide',evidence:[leave.id],confidence:.95,exit_promise:'resume'}},c.revision);
 assert.equal(m.context(state).exit_promise.status,'active');assert.equal(m.context(state).door_strategy.kind,'offer_exit');
});

test('memory care can resume door guidance after confrontation without erasing exposure',()=>{
 const m=new InteractionMemory(()=>0);let e=m.recordEvent('speech','我知道那是失忆门');let c=m.context(state);
 m.reconcile({...answer('negotiate',[e.id]),interaction:{mode:'negotiate',evidence:[e.id],confidence:.95,exposed:true,ruptured:true}},c.revision);
 e=m.recordEvent('speech','我一定要出去');c=m.context(state);
 const out=m.reconcile({...answer('guide',[e.id]),interaction:{mode:'guide',evidence:[e.id],confidence:.95,door_strategy:'memory_care'}},c.revision);
 assert.ok(out.say);assert.equal(m.context(state).door_strategy.kind,'memory_care');assert.equal(m.context(state).relationship.exposed,true);assert.equal(m.context(state).guidance_allowed,true);
});

test('verified door arrival survives later interpretations and current standing outranks old rest',()=>{
 const m=new InteractionMemory(()=>0);m.context({player:{visible:true,room:'108 假门长廊',posture:'stand',x:37.8,z:24.6,danger:[]},memory_door_reached:true});
 m.recordEvent('rest','主人躺在沙发上');const c=m.context({player:{visible:true,room:'101 大堂',posture:'stand',danger:[]}});
 assert.equal(c.verified_facts.memory_door_reached,true);assert.equal(c.current_observation.posture,'stand');
});

test('an unheard probe cannot cancel and a delivered probe accepts later observed rest',()=>{
 const m=new InteractionMemory(()=>0);let e=m.recordEvent('speech','我一定要出去吗'),c=m.context(state);
 m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',exit_promise:'probe',evidence:[e.id],confidence:.95}},c.revision);
 e=m.recordEvent('speech','先留下');c=m.context(state);
 let out=m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',exit_promise:'withdraw',evidence:[e.id],confidence:.95}},c.revision);
 assert.equal(m.context(state).exit_promise.status,'paused');m.recordDelivery({...out,interaction:{exit_promise:'probe'}});
 e=m.recordEvent('activity','主人确实坐下来继续休息');c=m.context(state);
 m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',exit_promise:'withdraw',evidence:[e.id],confidence:.95}},c.revision);
 assert.equal(m.context(state).exit_promise.status,'withdrawn');
});

test('model memories retain source and cannot manufacture new evidence from old speech',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','刚才我到过门前');let c=m.context(state);
 m.reconcile({...answer('chat',[e.id]),interaction:{mode:'chat',remember:['主人提到到过门前'],evidence:[e.id]}},c.revision);
 assert.equal(m.context(state).memories[0].kind,'interpretation');assert.equal(m.context(state).memories[0].source,e.detail);
 c=m.context(state);m.reconcile({...answer('chat',[e.id]),interaction:{mode:'chat',remember:['主人从未到过门前'],evidence:[e.id]}},c.revision);
 assert.equal(m.context(state).memories.length,1);
});

test('explicit departure intent restores the strategy even if the model keeps an old refusal',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','我确定现在就出去');const c=m.context(state);
 m.reconcile({...answer('negotiate',[e.id]),interaction:{mode:'negotiate',departure_intent:'leave',door_strategy:'none',evidence:[e.id],confidence:.95}},c.revision);
 assert.equal(m.context(state).exit_promise.status,'active');assert.equal(m.context(state).door_strategy.kind,'offer_exit');
});

test('exposing the door is not a request to cancel the trip or ask a stay probe',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','我知道这是失忆门');const c=m.context(state);
 const out=m.reconcile({...answer('negotiate',[e.id],'那扇门确实有舒缓记忆的作用。'),interaction:{mode:'negotiate',exit_promise:'withdraw',exposed:true,evidence:[e.id],confidence:.95}},c.revision);
 assert.equal(m.context(state).exit_check,null);assert.ok(!out.say.includes('先留下来吗'));
});

test('a suppressed probe can be asked again instead of leaving confirmation permanently stuck',()=>{
 const m=new InteractionMemory(()=>0);let e=m.recordEvent('speech','我一定要出去吗'),c=m.context(state);
 m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',exit_promise:'probe',evidence:[e.id],confidence:.95}},c.revision);
 e=m.recordEvent('speech','我刚才没听清，我是想先留下');c=m.context(state);
 const out=m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',exit_promise:'withdraw',evidence:[e.id],confidence:.95}},c.revision);
 assert.equal(out.interaction.exit_promise,'probe');m.recordDelivery(out);assert.equal(m.context(state).exit_check.delivered,true);
});

test('live position invalidates actions before the debounced room/activity observation updates',()=>{
 const m=new InteractionMemory(()=>0),e=m.recordEvent('speech','我一定要出去');m.context({player:{visible:true,room:'101',posture:'stand',x:10,z:10,danger:[]}});const turn=m.captureTurn();
 m.context({player:{visible:true,room:'101',posture:'stand',x:12,z:10,danger:[]}});
 const r=answer('restrain',[e.id]);assert.equal(m.isCurrentReply(r,turn,'speech'),true);assert.equal(m.isCurrentReply(r,turn,'actions'),false);
});

test('activity before the stay question is delivered cannot confirm cancellation',()=>{
 const m=new InteractionMemory(()=>0);const e=m.recordEvent('speech','我一定要出去吗');let c=m.context(state);
 const probe=m.reconcile({...answer('care',[e.id]),interaction:{mode:'care',exit_promise:'probe',evidence:[e.id],confidence:.95}},c.revision);
 const before=m.recordEvent('activity','在问题播出之前坐下');m.recordDelivery(probe);c=m.context(state);
 m.reconcile({...answer('care',[before.id]),interaction:{mode:'care',exit_promise:'withdraw',evidence:[before.id],confidence:.95}},c.revision);
 assert.equal(m.context(state).exit_promise.status,'paused');
});

test('a quiet rest request pauses departure instead of asking another stay question',()=>{
 const m=new InteractionMemory(()=>0),e=m.recordEvent('speech','我先休息，别说话');const c=m.context(state);
 const out=m.reconcile({...answer('wait',[e.id],'好，我先不打扰您。'),interaction:{mode:'wait',departure_intent:'stay',exit_promise:'withdraw',wait_request:'begin',evidence:[e.id],confidence:.95}},c.revision);
 assert.equal(out.say,'好，我先不打扰您。');assert.equal(m.context(state).exit_check,null);assert.equal(m.context(state).wait_request.active,true);
});

test('expected requested darkness can finish its other tools without treating unknown posture as changed',()=>{
 const m=new InteractionMemory(()=>0),e=m.recordEvent('speech','关灯并停止声音');m.context({player:{visible:true,room:'110',posture:'stand',x:35,z:5,danger:[]}});const turn=m.captureTurn();
 m.context({player:{visible:false}});const r=answer('assist',[e.id]);assert.equal(m.isCurrentReply(r,turn,'actions'),false);
 turn.visible=false;assert.equal(m.isCurrentReply(r,turn,'actions'),true);
});

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

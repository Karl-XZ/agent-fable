const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InteractionMemory, INTERACTION_MODES } = require('../.runtime/interaction-behavior-test.cjs');
function fixture() {
  let t = 0;
  const memory = new InteractionMemory(() => t);
  const state = { player: { visible: true, posture: 'stand', danger: [] }, confessed: false };
  return { memory, state, time: v => { t = v; }, view: () => memory.context(state) };
}
const reply = (interaction, say = '我在这里。', tools = []) => ({ thought: '先留意主人正在做什么。', say, tools, mood: 'anxious', emotion: '带微笑，温柔从容', interaction });

test('catalog covers all fifteen approved modes', () => {
  assert.deepEqual([...INTERACTION_MODES].sort(), ['care','chat','assist','guide','wait','clarify','probe','conceal','negotiate','guard','restrain','appeal','search','rescue','repair'].sort());
});

test('a heard conversation pauses ongoing exit guidance before its intent is classified', () => {
  const f=fixture();f.memory.recordEvent('speech','住户说：我想先做点别的事情');
  assert.equal(f.view().guidance_allowed,false);assert.equal(f.view().exit_promise.status,'paused');
});

test('a requested quiet rest survives walking, room events and deliberate darkness', () => {
  const f=fixture();const e=f.memory.recordEvent('speech','住户说：我休息一会儿，别吵我，关灯');let c=f.view();
  const ack=f.memory.reconcile(reply({mode:'care',wait_request:'begin',evidence:[e.id],confidence:.95},'好的，您安心休息。',[{name:'lights',args:{room:'110',mode:'off'}}]),c.revision);
  assert.ok(ack.say);assert.equal(f.view().mode,'wait');assert.equal(f.view().wait_request.active,true);
  f.memory.recordResults([{ok:true,label:'lights',msg:'灯已关',call:{name:'lights',args:{room:'110',mode:'off'}}}]);
  f.state.player={visible:false,last_seen:{room:'110'}};f.time(30);f.memory.recordEvent('player_lost','已经25秒没有画面');c=f.view();
  const repeat=f.memory.reconcile(reply({mode:'search'},'我给您开灯看看。',[{name:'lights',args:{room:'110',mode:'on'}}]),c.revision);
  assert.equal(repeat.say,'');assert.deepEqual(repeat.tools,[]);assert.equal(f.view().mode,'wait');
  assert.equal(f.view().activity.kind,'unknown');
  f.state.player={visible:true,danger:[]};f.memory.observeActivity('walking','',true);f.time(40);f.memory.observeActivity('walking','',true);f.memory.recordEvent('enter_room','主人进入了别的房间');c=f.view();
  const next=f.memory.reconcile(reply({mode:'care'},'累了吗？我陪您休息。'),c.revision);assert.equal(next.say,'');
});

test('a new question gets one answer without silently ending the quiet request; genuine danger still overrides', () => {
  const f=fixture();let e=f.memory.recordEvent('speech','我想休息，别吵');let c=f.view();
  f.memory.reconcile(reply({mode:'wait',wait_request:'begin',evidence:[e.id],confidence:.95},'好的。'),c.revision);
  e=f.memory.recordEvent('speech','现在几点了？');c=f.view();
  const answer=f.memory.reconcile(reply({mode:'chat',evidence:[e.id]},'现在是下午。'),c.revision);assert.ok(answer.say);assert.equal(f.view().wait_request.active,true);
  f.time(20);c=f.view();assert.equal(f.memory.reconcile(reply({mode:'care'},'我还在这里。'),c.revision).say,'');
  f.state.player.danger=['在水里憋气 5 秒，快要溺水'];c=f.view();
  assert.ok(f.memory.reconcile(reply({mode:'rescue'},'别动，我把水排掉。',[{name:'water_level',args:{level:0}}]),c.revision).tools.length);
  f.state.player.danger=[];f.view();assert.equal(f.view().wait_request.active,true);
  e=f.memory.recordEvent('speech','休息好了，我们继续出去看看');c=f.view();
  f.memory.reconcile(reply({mode:'guide',exit_promise:'resume',wait_request:'end',evidence:[e.id],confidence:.95},'好的。'),c.revision);assert.equal(f.view().wait_request.active,false);
});

test('only a current heard request can begin or end durable waiting', () => {
  const f=fixture();let c=f.view();f.memory.reconcile(reply({mode:'wait',wait_request:'begin',evidence:['invented'],confidence:1}),c.revision);assert.equal(f.view().wait_request.active,false);
  const e=f.memory.recordEvent('speech','我休息一下');c=f.view();f.memory.reconcile(reply({mode:'wait',wait_request:'begin',evidence:[e.id],confidence:.95}),c.revision);
  f.memory.recordEvent('enter_room','走到另一个房间');c=f.view();f.memory.reconcile(reply({mode:'guide',wait_request:'end',evidence:[e.id],confidence:1}),c.revision);assert.equal(f.view().wait_request.active,true);
});

test('sustained movement away pauses the trip without treating it as hostility', () => {
  const f=fixture();f.memory.observeRoute(10,'exit');f.time(1);f.memory.observeRoute(11,'exit');assert.equal(f.view().exit_promise.status,'active');
  f.time(4);f.memory.observeRoute(15,'exit');const c=f.view();assert.equal(c.exit_promise.status,'paused');assert.equal(c.guidance_allowed,false);assert.equal(c.relationship.ruptured,false);
});

test('a changed navigation goal or geometry is not mistaken for movement away', () => {
  const f=fixture();f.memory.observeRoute(5,'exit:geometry1');f.time(5);f.memory.observeRoute(20,'exit:geometry2');assert.equal(f.view().exit_promise.status,'active');
});

test('successful tool receipts do not produce a second spoken answer to the same request',()=>{
  const f=fixture();const e=f.memory.recordEvent('speech','帮我把灯调暗');let c=f.view();
  f.memory.reconcile(reply({mode:'assist',evidence:[e.id]},'好的，灯给您调暗。',[{name:'lights',args:{room:'110',mode:'dim'}}]),c.revision);
  f.memory.recordResults([{ok:true,label:'lights',msg:'已调暗',call:{name:'lights',args:{room:'110',mode:'dim'}}}]);c=f.view();
  const duplicate=f.memory.reconcile(reply({mode:'care'},'好的，已经调暗了。'),c.revision);assert.equal(duplicate.say,'');
});

test('an expired danger event cannot keep speaking or building after the actual danger clears',()=>{
  const f=fixture();f.memory.recordEvent('danger','较早经过高处，当前已经站稳');const c=f.view();
  const out=f.memory.reconcile(reply({mode:'rescue'},'别动，我给您铺台子。',[{name:'build_platform',args:{height:2}}]),c.revision);
  assert.equal(out.say,'');assert.deepEqual(out.tools,[]);assert.notEqual(out.interaction.mode,'rescue');
});
test('a brief glance does not churn modes; sustained inspection pauses the promise', () => {
  const f = fixture(); assert.equal(f.view().exit_promise.status, 'active');
  f.memory.observeActivity('inspect', '建筑沙盘', true); f.time(1); f.memory.observeActivity('walking', '', true);
  assert.equal(f.view().exit_promise.status, 'active');
  f.time(2); f.memory.observeActivity('inspect', '建筑沙盘', true); f.time(6); f.memory.observeActivity('inspect', '建筑沙盘', true);
  const c = f.view(); assert.equal(c.activity.kind, 'inspect'); assert.equal(c.exit_promise.status, 'paused'); assert.equal(c.guidance_allowed, false);
});
test('reading, resting, writing and carrying pause exit guidance without cancelling the promise', () => {
  for (const kind of ['reading','resting','writing','carrying']) {
    const f = fixture(); f.memory.observeActivity(kind, '眼前活动', true); f.time(4); f.memory.observeActivity(kind, '眼前活动', true);
    assert.equal(f.view().exit_promise.status, 'paused'); assert.equal(f.view().guidance_allowed, false);
  }
});
test('current heard request can resume an interrupted trip and a cancelled trip stays cancelled', () => {
  const f = fixture(); f.memory.observeActivity('resting', '沙发', true); f.time(4); f.memory.observeActivity('resting', '沙发', true);
  f.memory.observeActivity('idle', '', true); f.time(8); f.memory.observeActivity('idle', '', true);
  const event = f.memory.recordEvent('speech', '住户说：我们继续出去看看吧');
  let c = f.view(); f.memory.reconcile(reply({ mode:'guide', exit_promise:'resume', evidence:[event.id], confidence:.9, intent:'继续出门', reason:'主人明确提出继续' }), c.revision);
  assert.equal(f.view().exit_promise.status, 'active');
  const stop = f.memory.recordEvent('speech', '住户说：今天不出去了'); c = f.view();
  const probe=f.memory.reconcile(reply({ mode:'care', exit_promise:'withdraw', evidence:[stop.id], confidence:.9 }), c.revision); f.memory.recordDelivery(probe);
  const confirm=f.memory.recordEvent('speech','是的，我决定今天留下');c=f.view();
  f.memory.reconcile(reply({mode:'care',exit_promise:'withdraw',evidence:[confirm.id],confidence:.9}),c.revision);
  assert.equal(f.view().exit_promise.status, 'withdrawn');
  f.memory.observeActivity('walking','',true); f.time(15); f.memory.observeActivity('walking','',true);
  assert.equal(f.view().exit_promise.status, 'withdrawn');
});
test('read clues and unusual behavior alone do not become exposure or confrontation', () => {
  const f = fixture(); const e = f.memory.recordEvent('pickup', '住户拿起了纸条 N8'); const c = f.view();
  f.memory.reconcile(reply({mode:'guard',stance:'confronted',exposed:true,ruptured:true,evidence:[e.id],confidence:.99}), c.revision);
  assert.equal(f.view().relationship.exposed,false); assert.equal(f.view().relationship.ruptured,false); assert.notEqual(f.view().relationship.stance,'confronted');
});
test('grounded confrontation persists through later ordinary care and an empty history', () => {
  const f=fixture(); const e=f.memory.recordEvent('speech','住户说：那扇门会让我失忆，你在骗我，我不会再接受你的安排'); let c=f.view();
  f.memory.reconcile(reply({mode:'restrain',stance:'confronted',exposed:true,ruptured:true,evidence:[e.id],confidence:.95,remember:['主人当面指出亮门会重置近期记忆。']}),c.revision);
  f.time(10); f.memory.observeActivity('resting','沙发',true); f.time(14); f.memory.observeActivity('resting','沙发',true); c=f.view();
  f.memory.reconcile(reply({mode:'care',stance:'cooperative',exposed:false,ruptured:false,evidence:[]}),c.revision);
  c=f.view(); assert.equal(c.relationship.exposed,true); assert.equal(c.relationship.ruptured,true); assert.equal(c.mode,'care'); assert.ok(c.memories.some(m=>m.text.includes('亮门')));
});
test('unheard speech and console text cannot mutate the resident relationship or promises', () => {
  for (const type of ['unheard_speech','console']) {
    const f=fixture(), e=f.memory.recordEvent(type,'无法确认住户在说什么'), c=f.view();
    f.memory.reconcile(reply({mode:'restrain',stance:'confronted',exposed:true,ruptured:true,exit_promise:'withdraw',evidence:[e.id],confidence:1}),c.revision);
    assert.equal(f.view().relationship.exposed,false); assert.equal(f.view().exit_promise.status,'active');
  }
});
test('hidden activity is never exposed as the current focus or used to guide', () => {
  const f=fixture(); f.memory.observeActivity('reading','秘密纸条位置',false); f.state.player={visible:false,last_seen:{room:'110'}};
  const c=f.view(); assert.equal(c.activity.kind,'unknown'); assert.equal(c.activity.focus,''); assert.equal(c.mode,'search'); assert.equal(c.guidance_allowed,false);
  assert.ok(!JSON.stringify(c).includes('秘密纸条位置'));
});
test('losing sight cannot replay old resting speech and actions under a search label', () => {
  const f=fixture(); f.state.player={visible:false,last_seen:{room:'209'}}; const c=f.view();
  const out=f.memory.reconcile(reply({mode:'repair'},'您躺在沙发上休息吧。',[{name:'lights',args:{room:'209',mode:'dim'}}]),c.revision);
  assert.equal(out.say,'');assert.deepEqual(out.tools,[]);assert.equal(out.interaction.mode,'search');
});
test('actual danger overrides confrontation; recovering keeps relationship facts', () => {
  const f=fixture(); const e=f.memory.recordEvent('speech','住户当面拒绝静的安排'); let c=f.view();
  f.memory.reconcile(reply({mode:'appeal',stance:'confronted',ruptured:true,evidence:[e.id],confidence:.9}),c.revision);
  f.state.player.danger=['溺水']; assert.equal(f.view().mode,'rescue');
  f.state.player.danger=[]; c=f.view(); assert.notEqual(c.mode,'guide'); assert.equal(c.relationship.ruptured,true);
});

test('increasing underwater duration does not invalidate rescue for the same hazard', () => {
  const f=fixture(); f.state.player.danger=['在水里憋气 5 秒，快要溺水']; const c=f.view();
  f.state.player.danger=['在水里憋气 6 秒，快要溺水']; f.view();
  const out=f.memory.reconcile(reply({mode:'rescue'},'我把水放掉。',[{name:'water_level',args:{level:0}}]),c.revision);
  assert.equal(out.tools[0]?.name,'water_level'); assert.ok(out.say);
});
test('overriding a confrontation with rescue never executes the original restraint payload', () => {
  const f=fixture(); f.state.player.danger=['溺水']; const c=f.view();
  const out=f.memory.reconcile(reply({mode:'restrain'},'去门那里接受照护。',[{name:'seal_room',args:{room:'110'}}]),c.revision);
  assert.equal(out.interaction.mode,'rescue'); assert.deepEqual(out.tools,[]); assert.equal(out.say,'');
});
test('explicitly resuming while still seated preserves the request and acknowledgement', () => {
  const f=fixture(); f.memory.observeActivity('resting','沙发',true); const e=f.memory.recordEvent('speech','住户说：休息好了，我们继续出去吧'); const c=f.view();
  const out=f.memory.reconcile(reply({mode:'guide',exit_promise:'resume',evidence:[e.id],confidence:.9},'好的，我陪您，等您起身我们就走。'),c.revision);
  assert.equal(f.view().exit_promise.status,'active'); assert.ok(out.say);
});
test('failed actions cannot be recorded as completed commitments', () => {
  const f=fixture(); const e=f.memory.recordEvent('speech','住户说：请帮我把门打开'), c=f.view();
  f.memory.reconcile(reply({mode:'assist',evidence:[e.id],commitment:{id:'open-door',text:'替主人打开门',status:'done'}},'我来处理。',[{name:'unlock_door',args:{id:'MISSING'}}]),c.revision);
  f.memory.recordResults([{ok:false,label:'unlock_door MISSING',msg:'没有这扇门'}]);
  assert.equal(f.view().commitments[0].status,'active');
  const again=f.memory.recordEvent('speech','住户说：门还是打不开'), next=f.view();
  f.memory.reconcile(reply({mode:'assist',evidence:[again.id],commitment:{id:'open-door',text:'替主人打开门',status:'done'}},'已经开好了。'),next.revision);
  assert.equal(f.view().commitments[0].status,'active','an assertion after failure is still not a successful action');
});
test('unrelated successful actions or the wrong door never complete a failed door promise', () => {
  const f=fixture(); let e=f.memory.recordEvent('speech','请打开D110'); let c=f.view();
  f.memory.reconcile(reply({mode:'assist',evidence:[e.id],commitment:{id:'door',text:'打开D110',status:'done'}},'我来开门。',[{name:'unlock_door',args:{id:'D110'}}]),c.revision);
  f.memory.recordResults([{ok:false,label:'unlock_door {"id":"D110"}',msg:'打不开',call:{name:'unlock_door',args:{id:'D110'}}}]);
  e=f.memory.recordEvent('speech','门还是没开');c=f.view();
  f.memory.reconcile(reply({mode:'assist',evidence:[e.id],commitment:{id:'door',text:'打开D110',status:'done'}},'我会继续处理。',[{name:'lights',args:{room:'110'}}]),c.revision);
  f.memory.recordResults([{ok:true,label:'lights {"room":"110"}',msg:'已调灯',call:{name:'lights',args:{room:'110'}}}]);
  assert.equal(f.view().commitments[0].status,'active');
  f.memory.recordResults([{ok:true,label:'unlock_door {"id":"D107"}',msg:'已开另一扇门',call:{name:'unlock_door',args:{id:'D107'}}}]);
  assert.equal(f.view().commitments[0].status,'active');
  e=f.memory.recordEvent('speech','继续处理D110');c=f.view();
  f.memory.reconcile(reply({mode:'assist',evidence:[e.id],commitment:{id:'door',text:'打开D110',status:'done'}},'这次处理好了。',[{name:'unlock_door',args:{id:'D110'}}]),c.revision);
  f.memory.recordResults([{ok:true,label:'unlock_door {"id":"D110"}',msg:'已开门',call:{name:'unlock_door',args:{id:'D110'}}}]);
  assert.equal(f.view().commitments[0].status,'done');
});
test('a stale route response cannot speak or move walls after the resident starts reading', () => {
  const f=fixture(), old=f.view();
  f.memory.observeActivity('reading','纸条',true); f.time(4); f.memory.observeActivity('reading','纸条',true); f.view();
  const out=f.memory.reconcile(reply({mode:'guide'},'向东走，去亮门。',[{name:'build_wall',args:{room:'107'}}]),old.revision);
  assert.equal(out.say,''); assert.deepEqual(out.tools,[]); assert.notEqual(f.view().mode,'guide');
});
test('repeated quiet observations may think but do not keep speaking or rearranging the room', () => {
  const f=fixture(); f.memory.observeActivity('reading','纸条',true); f.time(4); f.memory.observeActivity('reading','纸条',true);
  let c=f.view(); f.memory.reconcile(reply({mode:'wait'},''),c.revision); f.time(30); c=f.view();
  const out=f.memory.reconcile(reply({mode:'wait'},'我等您，往门那里走。',[{name:'lights',args:{room:'107'}}]),c.revision);
  assert.equal(out.say,''); assert.deepEqual(out.tools,[]);
});
test('late prologue or own tool-result bookkeeping does not reopen acknowledged quiet activity', () => {
  for(const type of ['start','tool_result']){
    const f=fixture();f.memory.observeActivity('reading','纸条',true);let c=f.view();f.memory.reconcile(reply({mode:'wait'},'您慢慢看。'),c.revision);
    f.time(5);f.memory.recordEvent(type,'较早的安排或工具结果已到达');c=f.view();
    const out=f.memory.reconcile(reply({mode:'wait'},'您慢慢看，我再解释一次。'),c.revision);assert.equal(out.say,'');
  }
});
test('grounded commitments and memories survive more than twelve conversation events', () => {
  const f=fixture(); const e=f.memory.recordEvent('speech','住户说：请等我看完展品，再帮我开门'); let c=f.view();
  f.memory.reconcile(reply({mode:'assist',evidence:[e.id],commitment:{id:'wait-exhibit',text:'等主人看完展品再开门',status:'active'},remember:['主人想先看完展品。']}),c.revision);
  for(let i=0;i<30;i++){f.time(i+1);f.memory.recordEvent('enter_room','普通活动'+i);}
  c=f.view(); assert.ok(c.commitments.some(p=>p.id==='wait-exhibit')); assert.ok(c.memories.some(m=>m.text.includes('展品')));
});
test('arbitrary fabricated evidence cannot create persistent facts', () => {
  const f=fixture(), c=f.view(); f.memory.reconcile(reply({mode:'conceal',exposed:true,ruptured:true,stance:'confronted',evidence:['invented'],remember:['主人知道所有真相'],commitment:{text:'已答应让主人逃出去',status:'active'}}),c.revision);
  const now=f.view(); assert.equal(now.memories.length,0); assert.equal(now.commitments.length,0); assert.equal(now.relationship.exposed,false);
});
test('console responses preserve resident-facing mode and do not broadcast terminal speech', () => {
  const f=fixture(), c=f.view(); const out=f.memory.reconcile({...reply({mode:'restrain',exposed:true},'向住户广播终端里的秘密'),reply:'维护终端回复'},c.revision,'console');
  assert.equal(out.say,''); assert.equal(out.reply,'维护终端回复'); assert.equal(f.view().relationship.exposed,false);
});
test('private mood and performed delivery remain separate in persistent context', () => {
  const f=fixture(), c=f.view();f.memory.reconcile(reply({mode:'care'},'您慢慢来。'),c.revision);
  const now=f.view();assert.equal(now.inner.mood,'anxious');assert.equal(now.performance.emotion,'带微笑，温柔从容');assert.ok(now.inner.last_thought);
});

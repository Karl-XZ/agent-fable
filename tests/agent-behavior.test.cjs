const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Agent } = require('../.runtime/agent-behavior-test.cjs');

test('ambient observations wait for the current voice', () => {
  for(const type of ['player_lost','board']){
    let calls=0;
    const a=new Agent(()=>({state:{player:{visible:true,danger:[]}},ascii:''}),async()=>[],()=>20,()=>({say:'',tools:[]}));
    a.canSpeak=()=>false;a.run=async()=>{calls++;};a.push(type,'需要回应的新事件',true);a.tick();
    assert.equal(calls,0,type+' must not cut off current TTS');
    a.canSpeak=()=>true;a.tick();assert.equal(calls,1);
  }
});

test('one building turn cannot be started twice while the first request is pending', async () => {
  let finish,calls=0,applied=0;
  global.fetch=()=>{calls++;return new Promise(resolve=>finish=resolve);};
  const a=new Agent(()=>({state:{player:{visible:true,danger:[]}},ascii:''}),async()=>{applied++;return[];},()=>0,()=>({say:'',tools:[]}));
  const first=a.run('building');const second=a.run('building');
  assert.equal(calls,1);assert.equal(await second,null);
  finish(Response.json({say:'只回答一次。',tools:[]}));await first;assert.equal(applied,1);
});

test('exhausted route queries cannot inject navigation speech during a paused rest',async()=>{
  global.fetch=async()=>Response.json({say:'多余的路线',tools:[{name:'find_path',args:{room:'108'}}]});
  const a=new Agent(()=>({state:{player:{visible:true,danger:[]}},ascii:''}),async()=>[],()=>0,()=>({say:'',tools:[]}));
  a.interaction.observeActivity('resting','沙发',true);a.query=()=>({ok:true,label:'find_path',msg:'查询结果'});
  const result=await a.run('building');assert.equal(result.say,'');assert.equal(a.history.length,0);
});

test('interaction context and stable observation IDs reach the model; silence is logged without fallback', async () => {
  const requests=[],applied=[];
  global.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return Response.json({say:'',thought:'让主人安静看完。',mood:'anxious',emotion:'温柔平稳',tools:[],interaction:{mode:'wait',reason:'主人在阅读',confidence:.9}});};
  let t=0; const a=new Agent(()=>({state:{player:{visible:true,danger:[]}},ascii:''}),async r=>{applied.push(r);return[];},()=>t,()=>{throw Error('must not fallback for intentional silence');});
  a.interaction.observeActivity('reading','纸条',true); t=4; a.interaction.observeActivity('reading','纸条',true); a.push('pickup','住户拿起纸条');
  await a.run('building'); assert.equal(requests[0].state.interaction.activity.kind,'reading'); assert.ok(requests[0].state.interaction.observations[0].id); assert.equal(applied[0].say,''); assert.equal(a.log[0].interaction.mode,'wait');
});
test('unexpected apply failure always releases busy state for later rescue', async () => {
  global.fetch=async()=>Response.json({say:'',tools:[]});
  const a=new Agent(()=>({state:{player:{visible:true}},ascii:''}),async()=>{throw Error('tool failed');},()=>0,()=>({say:'',tools:[]}));
  await assert.rejects(()=>a.run('building'),/tool failed/); assert.equal(a.busy,false);
});

test('speech cancelled during tool application is not recorded as delivered dialogue', async () => {
  global.fetch=async()=>Response.json({say:'这句旧指路已经取消',thought:'先指路',tools:[]});
  const a=new Agent(()=>({state:{player:{visible:true}},ascii:''}),async()=>({results:[],deliveredSay:''}),()=>0,()=>({say:'',tools:[]}));
  const out=await a.run('building'); assert.equal(out.say,''); assert.equal(a.history.length,0); assert.equal(a.log[0].say,'');
});

test('a browser card is transient request metadata, separate from sensed state',async()=>{
 const requests=[];global.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return Response.json({say:'',tools:[]})};
 const a=new Agent(()=>({state:{player:{visible:true}},ascii:''}),async()=>[],()=>0,()=>({say:'',tools:[]}));
 a.characterCard=()=>({schema_version:1,fields:{speech_style:'PRIVATE-LOCAL-STYLE'}});
 await a.run('building');assert.equal(requests[0].character_card.fields.speech_style,'PRIVATE-LOCAL-STYLE');assert.ok(!JSON.stringify(requests[0].state).includes('PRIVATE-LOCAL-STYLE'));
 a.characterCard=()=>undefined;await a.run('building');assert.equal(requests[1].character_card,undefined);assert.equal(requests[1].private_character_session,true);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Agent } = require('../.runtime/agent-behavior-test.cjs');

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

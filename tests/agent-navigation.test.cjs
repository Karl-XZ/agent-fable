const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Agent } = require('../.runtime/agent-navigation-test.cjs');
test('AI gets route query feedback before any voice or mutation is applied', async () => {
  const requests = [], spoken = [], queries = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json(requests.length === 1
      ? { say: '不应提前说出的猜测', mood: 'calm', tools: [{ name: 'find_path', args: { room: '108' } }, { name: 'build_wall', args: { room: '101' } }] }
      : { say: '先朝北走，到门前再向东。', mood: 'calm', tools: [] });
  };
  const agent = new Agent(() => ({ state: { player: { facing: '西' } }, ascii: '' }), async reply => { spoken.push(reply); return []; }, () => 0, () => { throw Error('unexpected fallback'); });
  agent.query = call => { queries.push(call); return { ok: true, label: 'find_path', msg: '找到路线', navigation: { status: 'ok', message: '找到路线', next_step: { action: 'walk', direction: '北', instruction: '先朝北走' } } }; };
  await agent.run('building');
  assert.equal(queries.length, 1); assert.equal(requests.length, 2); assert.equal(spoken.length, 1);
  assert.equal(spoken[0].say, '先朝北走，到门前再向东。'); assert.deepEqual(spoken[0].tools, []);
  assert.equal(requests[1].results[0].navigation.next_step.direction, '北');
  assert.equal(agent.history.filter(h => h.role === 'ai').length, 1);
});
test('routine observations wait for speech but urgent safety events can interrupt', () => {
  let ready = false, calls = 0;
  const agent = new Agent(() => ({}), async () => [], () => 10, () => ({}));
  agent.canSpeak = () => ready; agent.run = async () => { calls++; };
  agent.push('enter_room', '新房间'); agent.tick(); assert.equal(calls, 0);
  ready = true; agent.tick(); assert.equal(calls, 1);
  ready = false; agent.push('danger', '危险', true); agent.tick(); assert.equal(calls, 2);
});

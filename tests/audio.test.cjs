const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Audio } = require('../.runtime/audio-test.cjs');
const activeAudio = new Set();
afterEach(() => { for (const audio of activeAudio) audio.stopSpeech(); activeAudio.clear(); });

function setup(fetch) {
  global.fetch = fetch;
  const samples = [], sources = [];
  const audio = new Audio();
  activeAudio.add(audio);
  audio.ctx = {
    currentTime: 0, state: 'running',
    createBuffer: (_channels, size) => {
      const data = new Float32Array(size);
      return { duration: size / 24000, getChannelData: () => data };
    },
    createBufferSource: () => {
      const source = { connect() {}, disconnect() {}, start() { samples.push([...this.buffer.getChannelData(0)]); }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
  };
  audio.master = {};
  return { audio, samples, sources };
}

test('streams odd-sized PCM chunks and sends emotion separately from spoken text', async () => {
  let request;
  const { audio, samples } = setup(async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(Uint8Array.from([0, 64, 0]));
      c.enqueue(Uint8Array.from([192, 255, 127])); c.close();
    } }), { headers: { 'X-Audio-Sample-Rate': '24000' } });
  });
  await audio.say('请别走。', '温柔，但有些焦虑', 'anxious');
  assert.deepEqual(request, { text: '请别走。', emotion: '温柔，但有些焦虑', mood: 'anxious' });
  assert.deepEqual(samples.flat(), [0.5, -0.5, 32767 / 32768]);
});

test('speech remains busy through playback, with captions notified only once audio is ready', async () => {
  let ready;
  const { audio, sources } = setup(() => new Promise(resolve => { ready = resolve; }));
  const events = [];
  const request = audio.say('这一句要完整说完。', '', 'calm', { onStart: () => events.push('start'), onEnd: complete => events.push(complete ? 'end' : 'cancel') });
  assert.equal(audio.speechBusy, true); assert.deepEqual(events, []);
  ready(new Response(Uint8Array.from([0, 64, 0, 64]), { headers: { 'X-Audio-Sample-Rate': '24000' } }));
  await request;
  assert.equal(audio.speechBusy, true); assert.deepEqual(events, ['start']);
  sources[0].onended();
  assert.equal(audio.speechBusy, false); assert.deepEqual(events, ['start', 'end']);
});

test('playback telemetry distinguishes completion from replacement', async () => {
  const {audio,sources}=setup(async()=>new Response(Uint8Array.from([0,64]),{headers:{'X-Audio-Sample-Rate':'24000'}}));
  await audio.say('完整的一句');sources[0].onended();
  await audio.say('会被打断的一句');await audio.say('紧急提醒');
  const recent=audio.speechState.recent;assert.equal(recent[0].complete,true);assert.equal(recent[1].complete,false);assert.ok(recent[0].started_at<=recent[0].finished_at);assert.equal(audio.speechState.busy,true);
});

test('new utterance aborts the old fetch and stops already scheduled speech', async () => {
  const signals = [];
  const { audio, sources } = setup(async (_url, options) => {
    signals.push(options.signal);
    return new Response(Uint8Array.from([0, 64]), { headers: { 'X-Audio-Sample-Rate': '24000' } });
  });
  await audio.say('第一句。');
  await audio.say('第二句。', '冷静');
  assert.equal(signals[0].aborted, true);
  assert.equal(sources[0].stopped, true);
  assert.equal(sources.length, 2);
});

test('disabling speech aborts pending audio and does not request new audio', async () => {
  let count = 0, signal;
  const { audio, sources } = setup(async (_url, options) => {
    count++; signal = options.signal;
    return new Response(Uint8Array.from([0, 64]), { headers: { 'X-Audio-Sample-Rate': '24000' } });
  });
  await audio.say('第一句。');
  audio.speak = false;
  await audio.say('不应播放。');
  assert.equal(signal.aborted, true);
  assert.equal(sources[0].stopped, true);
  assert.equal(count, 1);
});

test('an aborted older response arriving late cannot speak over the latest line', async () => {
  let finishOld;
  const { audio, samples } = setup((_url, options) => {
    if (JSON.parse(options.body).text === '旧台词') return new Promise(resolve => { finishOld = resolve; });
    return Promise.resolve(new Response(Uint8Array.from([0, 64]), { headers: { 'X-Audio-Sample-Rate': '24000' } }));
  });
  const old = audio.say('旧台词');
  await audio.say('新台词');
  finishOld(new Response(Uint8Array.from([0, 192]), { headers: { 'X-Audio-Sample-Rate': '24000' } }));
  await old;
  assert.deepEqual(samples.flat(), [0.5]);
});

test('provider failures report a readable error without browser voice fallback', async () => {
  const { audio } = setup(async () => new Response('upstream private details', { status: 502 }));
  const errors = []; audio.onSpeechError = message => errors.push(message);
  await audio.say('请别走。');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /阿里云/);
  assert.ok(!errors[0].includes('private'));
});

test('recorded film speech decodes and is stopped by disabling narration', async () => {
  const { audio, sources } = setup(async () => new Response(Uint8Array.from([1, 2])));
  audio.ctx.decodeAudioData = async () => ({ duration: 2, getChannelData: () => new Float32Array([0.5]) });
  await audio.playClip('/cinematics/clip.wav');
  assert.equal(sources.length, 1);
  audio.speak = false;
  assert.equal(sources[0].stopped, true);
});

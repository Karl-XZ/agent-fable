const { test } = require('node:test');
const assert = require('node:assert/strict');
const { homeFilmFrame, homeFilmDuration, nextHomeFilmTime, placePlayableHome, dailyLifeFrame, DAILY_LIFE_SECONDS } = require('../.runtime/homefilm-test.cjs');
const { compassHeading } = require('../.runtime/compass-test.cjs');
const THREE = require('../web/node_modules/three');

test('opening finishes inside the playable home facing the connecting door', () => {
  const home = placePlayableHome(new THREE.Group());
  const frame = homeFilmFrame('intro', homeFilmDuration('intro'));
  const eye = home.localToWorld(new THREE.Vector3(...frame.position));
  assert.ok(eye.distanceTo(new THREE.Vector3(32.5, 1.58, 7.5)) < 0.00001);
  const forward = home.localToWorld(new THREE.Vector3(...frame.target)).sub(eye).normalize();
  assert.ok(forward.x < -.999);
});

test('menu depicts a repeating first-person daily routine across actual rooms', () => {
  assert.equal(typeof dailyLifeFrame, 'function');
  assert.ok(DAILY_LIFE_SECONDS >= 40);
  const activities = new Set();
  for (let t = 0; t < DAILY_LIFE_SECONDS; t += .25) {
    const frame = dailyLifeFrame(t);
    activities.add(frame.activity);
    assert.ok(frame.position.every(Number.isFinite));
    assert.ok(frame.position[1] >= .8 && frame.position[1] <= 1.7);
    assert.ok(frame.fade >= 0 && frame.fade <= 1);
    assert.equal(frame.text, '');
  }
  for (const activity of ['breakfast', 'walk', 'atrium', 'gallery', 'rest', 'sleep']) assert.ok(activities.has(activity));
  assert.deepEqual(dailyLifeFrame(DAILY_LIFE_SECONDS + 3), dailyLifeFrame(3));
});

test('compass follows the same north/east axes as the level, including wraparound', () => {
  for (const [yaw, degrees, label] of [[0, 0, '北'], [-Math.PI / 2, 90, '东'], [Math.PI, 180, '南'], [Math.PI / 2, 270, '西'], [-Math.PI * 2, 0, '北'], [-Math.PI * 2.25, 45, '东北']]) {
    assert.ok(Math.abs(compassHeading(yaw).degrees - degrees) < 1e-8);
    assert.equal(compassHeading(yaw).label, label);
  }
});

test('opening progresses from daily routine to disagreement and a guided departure', () => {
  let t = 0;
  const text = [], speakers = [];
  while (t < homeFilmDuration('intro')) {
    const frame = homeFilmFrame('intro', t);
    text.push(frame.beat.text); speakers.push(frame.beat.who);
    assert.equal(frame.done, false);
    t += frame.beat.seconds * 1000;
  }
  const script = text.join('\n');
  assert.match(script, /早餐|吃饭/);
  assert.match(script, /睡|夜晚/);
  assert.match(script, /出去看看/);
  assert.match(script, /指引.*路/);
  assert.ok(speakers.includes('你') && speakers.includes('静'));
  assert.equal(homeFilmFrame('intro', t + 1).done, true);
});

test('the opening narration stays caption-only while Jing keeps her voice', () => {
  const first = homeFilmFrame('intro', 0);
  const second = homeFilmFrame('intro', first.beat.seconds * 1000);
  for (const frame of [first, second]) {
    assert.equal(frame.speaker, '旁白');
    assert.ok(frame.text);
    assert.equal(frame.audio, '');
  }
  let t = 0, jingVoices = 0;
  while (t < homeFilmDuration('intro')) {
    const frame = homeFilmFrame('intro', t);
    if (frame.speaker === '静') { assert.ok(frame.audio); jingVoices++; }
    else assert.equal(frame.audio, '');
    t += frame.beat.seconds * 1000;
  }
  assert.equal(jingVoices, 4);
});

test('memory film enters a home, forgets the intention, then returns to comfort', () => {
  let t = 0; const text = [];
  while (t < homeFilmDuration('memory')) { const frame = homeFilmFrame('memory', t); text.push(frame.beat.text); t += frame.beat.seconds * 1000; }
  assert.match(text.join('\n'), /刚才.*做什么/);
  assert.match(text.at(-1), /幸福/);
  assert.equal(homeFilmFrame('memory', 0).doorOpen, 1);
  assert.equal(homeFilmFrame('memory', t).doorOpen, 0);
});

test('negative and late times clamp to stable film frames', () => {
  assert.deepEqual(homeFilmFrame('intro', -100), homeFilmFrame('intro', 0));
  const end = homeFilmDuration('memory');
  assert.deepEqual(homeFilmFrame('memory', end + 999), homeFilmFrame('memory', end));
});

test('memory ending retains narration and dialogue because Jing still controls the home', () => {
  let t = 0;
  while (t < homeFilmDuration('memory')) {
    const frame = homeFilmFrame('memory', t);
    assert.equal(frame.text, frame.beat.text); assert.equal(frame.speaker, frame.beat.who); assert.equal(frame.audio, frame.beat.audio);
    t += frame.beat.seconds * 1000;
  }
  assert.ok(homeFilmFrame('intro', 0).text);
});

test('every voiced memory line belongs to Jing with gentle performed delivery', () => {
  let time = 0, voiced = 0;
  while (time < homeFilmDuration('memory')) {
    const frame = homeFilmFrame('memory', time);
    if (frame.audio) {
      voiced++;
      assert.equal(frame.speaker, '静');
      assert.match(frame.beat.emotion, /温柔/);
    }
    time += frame.beat.seconds * 1000;
  }
  assert.equal(voiced, 7);
});

test('posing a meal leaves the cup stationary on the table', () => {
  const { poseCareHome } = require('../.runtime/homefilm-test.cjs');
  const home = new THREE.Group();
  const window = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); window.name = 'soft-window'; home.add(window);
  const cup = new THREE.Group(); cup.name = 'warm-tea'; cup.position.set(2.15, .94, -1.25); home.add(cup);
  for (const progress of [0, .25, .5, .75, 1]) {
    poseCareHome(home, { ...homeFilmFrame('memory', 0), mealProgress: progress });
    assert.deepEqual(cup.position.toArray(), [2.15, .94, -1.25]);
  }
});

test('memory ending shows hesitation, a meal, then falling asleep', () => {
  let t = 0; const frames = [];
  while (t < homeFilmDuration('memory')) { const f = homeFilmFrame('memory', t + 500); frames.push(f); t += f.beat.seconds * 1000; }
  assert.ok(frames.some(f => f.hesitation > 0));
  assert.ok(frames.some(f => f.mealProgress > 0));
  const end = homeFilmFrame('memory', homeFilmDuration('memory'));
  assert.equal(end.closingEyes, 1);
});

test('short opening advances exactly one line per click through the last line', () => {
  assert.ok(homeFilmDuration('intro') <= 35000);
  let t = 100, clicks = 0;
  while (!homeFilmFrame('intro', t).done) {
    const before = homeFilmFrame('intro', t);
    const next = nextHomeFilmTime('intro', t);
    const after = homeFilmFrame('intro', next);
    assert.ok(next > t);
    if (!after.done) assert.equal(after.index, before.index + 1);
    t = next; clicks++;
    assert.ok(clicks < 20);
  }
  assert.equal(nextHomeFilmTime('intro', t + 100), homeFilmDuration('intro'));
});

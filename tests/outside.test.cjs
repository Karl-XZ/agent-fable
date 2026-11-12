const { test } = require('node:test');
const assert = require('node:assert/strict');

test('normal stairs and the elevator cabin are safe transit support, unlike a ledge or cabin roof',()=>{
  const {safeTransitSupport}=require('../.runtime/player-test.cjs');
  assert.equal(safeTransitSupport({tag:'cab'}),true);
  assert.equal(safeTransitSupport({tag:'struct',ref:{kind:'stairs',rise:1}}),true);
  assert.equal(safeTransitSupport({tag:'cabroof'}),false);
  assert.equal(safeTransitSupport({tag:'struct',ref:{kind:'platform',rise:1}}),false);
  assert.equal(safeTransitSupport(null),false);
});
const { outsideShot, escapeLanding, landingFrame } = require('../.runtime/outside-test.cjs');
const { ENDINGS } = require('../.runtime/ending-test.cjs');
const { Player } = require('../.runtime/player-test.cjs');
const THREE = require('../web/node_modules/three');
const { buildSandboxModel, refreshSandboxModel } = require('../.runtime/sandbox-test.cjs');

test('sandbox has geometry at startup and recomputes bounds after structural edits', () => {
  const size = 40 * 28 * 18, cells = new Uint8Array(size);
  const grid = { orig: cells.slice(), idx: (x, y, z) => (y * 28 + z) * 40 + x, get(x, y, z) { return cells[this.idx(x, y, z)]; } };
  cells[grid.idx(0, 5, 0)] = 1;
  const { blocks, group } = buildSandboxModel(grid);
  assert.ok(blocks.count > 0); const first = blocks.boundingSphere.center.toArray();
  for (const plate of group.children.filter(o => o.name === 'sandbox-floor')) assert.equal(plate.material.transparent, false);
  cells[grid.idx(39, 13, 27)] = 1;
  refreshSandboxModel(grid, blocks);
  assert.equal(blocks.count, 2);
  assert.notDeepEqual(blocks.boundingSphere.center.toArray(), first);
  assert.ok(blocks.boundingSphere.radius > 1);
  assert.ok(blocks.boundingBox.max.y > .6);
});

test('freefall retains steering and look while gravity is independent of frame rate and old colliders', () => {
  global.addEventListener = () => {};
  for (const fps of [30, 60, 120]) {
    const player = new Player({ colliders() { throw Error('escape must not collide with the old building'); } }, new THREE.PerspectiveCamera());
    player.pos.set(41, 8, 20); player.yaw = -Math.PI / 2; player.pitch = -.7; player.keys.add('KeyW');
    for (let frame = 0; frame < fps * 3; frame++) player.updateFreeFall(1 / fps);
    assert.ok(Math.abs(player.pos.y - (8 - 17 * 9 / 2)) < 1e-8);
    assert.ok(Math.abs(player.vel.y + 51) < 1e-8);
    assert.ok(player.pos.x > 48);
    assert.equal(player.yaw, -Math.PI / 2); assert.equal(player.pitch, -.7);
  }
});

test('escape falls to street level before the distant figure appears', () => {
  const falling = outsideShot(0), landed = outsideShot(2.2), standing = outsideShot(5), reveal = outsideShot(13);
  assert.ok(falling.position[1] > 5);
  assert.ok(landed.position[1] < 0.6);
  assert.ok(standing.position[1] > 1.4 && standing.position[1] < 1.8);
  assert.equal(standing.figureVisible, false);
  assert.equal(reveal.figureVisible, true);
  assert.equal(reveal.caption, 3);
  assert.ok(reveal.target[2] < -60);
});

test('camera and reveal stay stable after the cinematic ends', () => {
  assert.deepEqual(outsideShot(100), outsideShot(19));
  assert.deepEqual(outsideShot(-1), outsideShot(0));
});

test('true ending describes the city and preserves the unknown figure', () => {
  assert.match(ENDINGS.out.line, /废弃都市/);
  assert.match(ENDINGS.out.line, /远处.*人影/);
  assert.doesNotMatch(ENDINGS.out.line, /桌上|模型|实验|虚拟/);
});

test('city is placed beneath the live fall and takeover preserves position and velocity', () => {
  const start = [42, -79, 17], velocity = [2, -51, -1];
  const landing = escapeLanding(start, velocity, 1.1);
  assert.deepEqual(landingFrame(landing, 0).position, start);
  const epsilon = 0.00001, next = landingFrame(landing, epsilon).position;
  next.forEach((p, i) => assert.ok(Math.abs((p - start[i]) / epsilon - velocity[i]) < 0.001));
  assert.ok(landing.origin[1] < start[1] - 50);
  assert.ok(Math.hypot(landing.origin[0] - start[0], landing.origin[2] - start[2]) < 4);
});

test('ballistic landing joins the first ending frame without a camera jump', () => {
  for (const yaw of [0, Math.PI / 2, -1.7]) {
    const landing = escapeLanding([20, -80, 20], [1, -52, 2], yaw);
    const before = landingFrame(landing, landing.seconds - 0.000001);
    const at = landingFrame(landing, landing.seconds);
    const after = landingFrame(landing, landing.seconds + 0.000001);
    assert.ok(Math.hypot(...at.position.map((v, i) => v - before.position[i])) < 0.001);
    assert.ok(Math.hypot(...at.position.map((v, i) => v - after.position[i])) < 0.001);
    assert.equal(at.turn, 0);
    assert.equal(at.figureVisible, false);
    assert.equal(landingFrame(landing, landing.seconds + 12).figureVisible, true);
  }
});

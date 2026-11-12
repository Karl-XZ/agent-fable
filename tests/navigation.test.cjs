const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findPath } = require('../.runtime/navigation-test.cjs');
function scene(extra = [], doors = []) {
  const boxes = [{ min: [0, -1, 0], max: [12, 0, 12], tag: 'vox' }, ...extra];
  return { boxes, doors: new Map(doors.map(d => [d.id, d])), colliders(_query, out) { out.length = 0; out.push(...boxes); return out; }, doorAABB(d) { return { min: [d.center.x - .1, d.floorY, d.center.z - .5], max: [d.center.x + .1, d.floorY + 2, d.center.z + .5] }; }, elevator: { stopped: true, stalled: false, moving: false, map: {} }, inWater: () => false, water: { level: -4 } };
}
test('route goes around a wall and gives a verified turn instead of the destination bearing', () => {
  const world = scene([{ min: [2.5, 0, 3], max: [3.5, 3, 12], tag: 'vox' }]);
  const result = findPath(world, { x: 2, y: 0, z: 8 }, Math.PI / 2, { floor: '1F', x: 8, z: 8 });
  assert.equal(result.status, 'ok');
  assert.ok(result.waypoints.some(p => p.z < 3));
  assert.equal(result.next_step.direction, '北');
  assert.equal(result.next_step.relative, '右侧');
});
test('closed and locked doors produce prerequisites without opening anything', () => {
  const door = { id: 'TEST', center: { x: 5, y: 0, z: 5.5 }, floorY: 0, def: { floor: '1F' }, locked: false, open: false, t: 0 };
  const world = scene([{ min: [4.9, 0, 0], max: [5.1, 3, 5], tag: 'vox' }, { min: [4.9, 0, 6], max: [5.1, 3, 12], tag: 'vox' }, { min: [4.9, 0, 5], max: [5.1, 2, 6], tag: 'door', ref: door }], [door]);
  const target = { floor: '1F', x: 8, z: 5.5 };
  const unlocked = findPath(world, { x: 2, y: 0, z: 5.5 }, 0, target);
  assert.equal(unlocked.status, 'requires_action');
  assert.ok(unlocked.steps.some(s => s.action === 'open_door' && s.door === 'TEST'));
  assert.equal(door.open, false);
  door.locked = true;
  assert.equal(findPath(world, { x: 2, y: 0, z: 5.5 }, 0, target).status, 'unreachable');
  assert.ok(findPath(world, { x: 2, y: 0, z: 5.5 }, 0, { ...target, allow_locked: true }).steps.some(s => s.action === 'unlock_door'));
  door.open = true; door.t = 1; door.locked = true;
  assert.equal(findPath(world, { x: 2, y: 0, z: 5.5 }, 0, target).status, 'unreachable');
  door.locked = false; door.rewire = 'OTHER_DOOR';
  assert.equal(findPath(world, { x: 2, y: 0, z: 5.5 }, 0, target).status, 'unreachable');
});
test('changed walls are read on every query and unsupported drops are rejected', () => {
  const world = scene(); const target = { floor: '1F', x: 8, z: 8 };
  assert.equal(findPath(world, { x: 2, y: 0, z: 8 }, 0, target).status, 'ok');
  world.boxes.push({ min: [4, 0, 0], max: [5, 3, 12], tag: 'box' });
  assert.equal(findPath(world, { x: 2, y: 0, z: 8 }, 0, target).status, 'unreachable');
  world.boxes.splice(0, 1);
  assert.equal(findPath(world, { x: 2, y: 0, z: 8 }, 0, target).status, 'off_mesh');
});
test('stairs are traversable but a high ledge is not treated as a walking step', () => {
  const steps = Array.from({ length: 14 }, (_, i) => ({ min: [3 + i * .5, 0, 4], max: [3 + (i+1) * .5, (i+1) * 4/14, 7], tag: 'struct' }));
  const world = scene([...steps, { min: [10, 3, 4], max: [12, 4, 7], tag: 'vox' }]);
  const result = findPath(world, { x: 2, y: 0, z: 5.5 }, 0, { floor: '2F', x: 11, z: 5.5 });
  assert.equal(result.status, 'ok'); assert.ok(result.steps.some(s => s.action === 'stairs'));
  const ledge = scene([{ min: [5, 0, 4], max: [12, 4, 7], tag: 'vox' }]);
  assert.equal(findPath(ledge, { x: 2, y: 0, z: 5.5 }, 0, { floor: '2F', x: 11, z: 5.5 }).status, 'unreachable');
});
test('blindness and invalid destinations never leak the player position', () => {
  const result = findPath(scene(), { x: 2, y: 0, z: 8 }, 0, { floor: '1F', x: 8, z: 8 }, false);
  assert.equal(result.status, 'player_unknown'); assert.equal(result.from, undefined); assert.equal(result.waypoints, undefined);
  assert.equal(findPath(scene(), { x: 2, y: 0, z: 8 }, 0, { floor: '1F', x: NaN, z: 8 }).status, 'invalid_target');
});

test('elevators return an explicit action with the real mapped button and respect outages', () => {
  const world = scene([{ min: [0, 7, 0], max: [12, 8, 12], tag: 'vox' }]);
  world.elevator.stopped = false;
  world.elevator.map = { '1F': '1F', '2F': 'RF', RF: '2F' };
  // The real landing column is outside this small fixture, so extend supported landings.
  world.boxes.push({ min: [9, -1, 14], max: [12, 0, 18], tag: 'vox' }, { min: [9, 7, 14], max: [12, 8, 18], tag: 'vox' });
  const start = { x: 10.5, y: 0, z: 16.5 }, target = { floor: 'RF', x: 10.5, z: 16.5 };
  const route = findPath(world, start, 0, target);
  assert.equal(route.status, 'requires_action');
  assert.equal(route.next_step.action, 'elevator'); assert.equal(route.next_step.button, '2F');
  world.elevator.stalled = true;
  assert.equal(findPath(world, start, 0, target).status, 'unreachable');
});

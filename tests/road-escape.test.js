import test from 'node:test';
import assert from 'node:assert/strict';
import {assets} from './platform.js';
import {Game} from '../engine/game.js';
import {GameState} from '../engine/state.js';
import {angDiff, yawTo} from '../engine/actors.js';
const A = await assets();
async function road() {
  const g = new Game(A, {headless: true});
  g.state = new GameState({room: 'road_main', location: 'road', at: [-3.4, -3]});
  await g.enterRoom('road_main', -3.4, -3, 0);
  g.script.running = []; g.ui.msg = null; g.ui.messageQueue = [];
  g.cinematic = false; g.mode = 'play';
  return g;
}
function settle(g, inspect = () => {}) {
  for (let i = 0; i < 2400; i++) {
    g.update(g.ui.msg ? {confirmPressed: true} : {});
    inspect();
    if (!g.script.running.length && !g.ui.modal()) return;
  }
  assert.fail('Road sequence did not finish');
}
test('actor replacement retires every old instance and clears references and saved state', async () => {
  const g = await road();
  const old = g.spawnEnemy({id: 'replacement', type: 'katie_road', at: [1.3, -3.3]});
  old.script({move_to: [5, -3.3], speed: 2});
  g.player.target = old; g.player.invulnT = 0; old.state = 'grab';
  assert.ok(g.player.grabbedBy(old));
  g.stashEnemies();
  const replacement = g.spawnEnemy({id: old.id, type: 'katie_road', at: [1.3, -3.3], pose: 'feed'});
  assert.equal(g.enemies.filter(e => e.id === old.id).length, 1);
  assert.equal(g.enemies.find(e => e.id === old.id), replacement);
  assert.equal(old.state, 'gone'); assert.equal(old.scripted, null); assert.equal(old.arrived, true);
  assert.equal(g.player.target, null); assert.equal(g.player.grab, null); assert.equal(g.player.mode, 'move');
  assert.equal(g.state.enemies[old.id], undefined);
  const at = [old.x, old.y]; old.update(); assert.deepEqual([old.x, old.y], at);
  g.enemies.push(old); // Also clean up duplicate IDs left by an older script.
  g.removeEnemy(old.id);
  assert.equal(g.enemies.some(e => e.id === old.id), false);
  g.stashEnemies(); g.spawnRoomEnemies();
  assert.equal(g.enemies.some(e => e.id === old.id), false);
});
test('Katie wakes from feeding, escapes around the wagon after normal pistol shots, and stays gone', async () => {
  const g = await road();
  g.script.start(g.location.sequences.find_her); settle(g);
  const copies = g.enemies.filter(e => e.id === 'katie');
  assert.equal(copies.length, 1, 'only the feeding Katie should remain');
  const katie = copies[0]; assert.ok(katie.staticPose);
  g.script.start(g.location.sequences.katie_turns); settle(g);
  assert.equal(katie.staticPose, null); assert.equal(katie.poseName, undefined);
  g.state.add('pistol', 1, A.content.items, 8); g.state.equipped = 'pistol'; g.state.mag.pistol = 13;
  for (let i = 0; i < 300 && !g.cinematic; i++) {
    const d = angDiff(yawTo(g.player.x, g.player.y, katie.x, katie.y), g.player.yaw);
    g.update(Math.abs(d) > 18 ? (d > 0 ? {left: true} : {right: true}) : {aim: true, firePressed: true});
  }
  assert.ok(g.cinematic, 'normal shots must trigger the escape');
  let frames = 0, eastOfCar = false, intoWoods = false;
  settle(g, () => {
    if (katie.state === 'gone') return;
    frames++;
    assert.equal(g.blocksActor(katie, katie.x, katie.y), false, `inside vehicle at ${katie.x},${katie.y}`);
    assert.ok(g.room.canStand(katie.x, katie.y, katie.r), `inside scenery at ${katie.x},${katie.y}`);
    assert.equal(katie.staticPose, null, 'feeding pose must not slide along the escape');
    if (katie.x > 4.9 && katie.y < -.4) eastOfCar = true;
    if (katie.y > 10) intoWoods = true;
  });
  assert.ok(frames > 60 && eastOfCar && intoWoods, 'escape must visibly traverse the road and woods');
  assert.ok(g.state.flags.katie_fled); assert.equal(g.cinematic, false);
  assert.equal(g.enemies.some(e => e.id === 'katie'), false);
  g.stashEnemies(); g.spawnRoomEnemies();
  assert.equal(g.enemies.some(e => e.id === 'katie'), false, 'leaving/reloading must not restore a duplicate');
});

test('moving a reused actor ID offscreen retires its local instance', async () => {
  const g = await road();
  const old = g.spawnEnemy({id: 'replacement', type: 'katie_road', at: [1.3, -3.3]});
  g.spawnEnemy({id: old.id, type: 'katie_road', room: 'farm_outside', at: [0, 0], hp: 28});
  assert.equal(old.state, 'gone');
  assert.equal(g.enemies.some(e => e.id === old.id), false);
  g.stashEnemies();
  assert.equal(g.state.enemies[old.id].room, 'farm_outside');
  assert.equal(g.state.enemies[old.id].hp, 28);
});

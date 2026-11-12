const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.FABLE_PLAYWRIGHT);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FABLE_CHROMIUM, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__noPause = true;
      window.__nativePointerLock = HTMLCanvasElement.prototype.requestPointerLock;
      HTMLCanvasElement.prototype.requestPointerLock = () => Promise.resolve();
    });
    await page.route('**/api/agent', r => r.fulfill({ json: { say: '', thought: '', tools: [], mood: 'calm' } }));
    await page.clock.install();
    await page.goto(process.env.FABLE_URL || 'http://127.0.0.1:7863/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
    await page.evaluate(() => {
      document.querySelector('#segQ [data-q="low"]').click();
      document.querySelector('#tts').checked = false;
      document.querySelector('#tts').dispatchEvent(new Event('change'));
      __game.world.scene.visible = false;
      __game.start();
      document.querySelector('#filmSkip').click();
      __game.agent.enabled = false;
    });
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 500));
    const state = () => page.evaluate(() => ({ mode: __game.mode(), pos: __game.player.pos.toArray(), keys: [...__game.player.keys], jump: __game.player.jumpBuf, history: __game.agent.history.filter(h => h.role === 'player').length }));
    await page.keyboard.press('Enter');
    await page.clock.runFor(32);
    const before = await state();
    const doorOpen = await page.evaluate(() => __game.world.doors.get('D110').open);
    await page.keyboard.down('w');
    await page.clock.runFor(400);
    await page.keyboard.up('w');
    const after = await state();
    assert.ok(Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]) < .001, 'typing W must not move the player');
    for (const key of ['a', 's', 'd', 'Space', 'Shift', 'c', 'e', 'g', 'h', 'Backquote']) {
      await page.keyboard.down(key); await page.clock.runFor(100); await page.keyboard.up(key);
    }
    assert.equal((await state()).keys.length, 0);
    assert.equal((await state()).jump, 0);
    assert.equal(await page.locator('#dbg').isVisible(), false);
    assert.equal(await page.locator('#controlsDetails').isVisible(), false);
    assert.equal(await page.evaluate(() => __game.world.doors.get('D110').open), doorOpen);
    await page.locator('#chatInput').fill('我想出去看看');
    const cdp = await page.context().newCDPSession(page);
    async function screenshot(name) {
      await page.evaluate(() => __game.world.scene.visible = true);
      await page.clock.runFor(32);
      const pending = cdp.send('Page.captureScreenshot', { format: 'png' });
      await page.clock.runFor(32);
      fs.writeFileSync(path.join(__dirname, '../.runtime', name + '.png'), Buffer.from((await pending).data, 'base64'));
      await page.evaluate(() => __game.world.scene.visible = false);
    }
    assert.equal(await page.locator('#speechHint').isVisible(), true);
    await screenshot('speech-input');
    await page.keyboard.press('Escape');
    assert.equal((await state()).mode, 'play');
    assert.equal((await state()).history, before.history, 'Esc must discard unsent text');
    assert.equal(await page.locator('#chat').isVisible(), false);
    assert.equal(await page.locator('#speechHint').isVisible(), false);
    assert.equal(await page.locator('#pause').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), '');
    await page.keyboard.down('w'); await page.clock.runFor(150);
    await page.keyboard.press('Enter'); await page.clock.runFor(32);
    const held = await state();
    await page.keyboard.up('w'); await page.clock.runFor(400);
    assert.ok(Math.hypot(...(await state()).pos.map((v, i) => v - held.pos[i])) < .001, 'opening chat must stop held movement and residual momentum');
    await page.locator('#chatInput').fill('静，你在吗？');
    await page.locator('#chatInput').dispatchEvent('keydown', { code: 'Enter', key: 'Enter', isComposing: true, bubbles: true });
    assert.equal((await state()).mode, 'chat', 'IME confirmation must not send');
    await page.keyboard.press('Enter');
    assert.equal((await state()).mode, 'play');
    assert.equal((await state()).history, before.history + 1, 'Enter must send exactly once');
    await page.keyboard.press('h');
    assert.equal(await page.locator('#controlsDetails').isVisible(), true);
    for (const [yaw, label] of [[0, '北 000°'], [-Math.PI / 2, '东 090°'], [-Math.PI, '南 180°'], [Math.PI / 2, '西 270°'], [.001, '北 000°'], [-.001, '北 000°']]) {
      await page.evaluate(yaw => __game.look(yaw), yaw); await page.clock.runFor(32);
      assert.equal(await page.locator('#compassHeading').textContent(), label);
    }
    await page.evaluate(() => __game.look(Math.PI / 2, -.05));
    await page.clock.fastForward(7000);
    await screenshot('controls-compass');
    await page.keyboard.press('h');
    await screenshot('gameplay-hud');
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.requestPointerLock = window.__nativePointerLock;
      window.__noPause = false;
    });
    await page.locator('#gl').click({ force: true }); await page.clock.runFor(32);
    assert.equal(await page.evaluate(() => document.pointerLockElement?.id), 'gl', 'native pointer lock should engage');
    await page.keyboard.press('Enter'); await page.clock.runFor(32);
    assert.equal((await state()).mode, 'chat');
    assert.equal(await page.evaluate(() => document.pointerLockElement), null, 'chat releases native pointer lock without pausing');
    await page.keyboard.press('Escape'); await page.clock.runFor(32);
    assert.equal((await state()).mode, 'play');
    assert.equal(await page.evaluate(() => document.pointerLockElement?.id), 'gl', 'cancelling chat should restore native pointer lock');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(__dirname, '../.runtime/input-verification.json'), JSON.stringify({ typingDoesNotMove: true, hotkeysBlocked: true, heldMovementCleared: true, escapeCancels: true, enterSendsOnce: true, imeConfirmationSafe: true, cardinalHeadings: true, nativePointerLockRestored: true, errors }, null, 2));
    console.log('Input isolation, cancellation, controls and compass checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

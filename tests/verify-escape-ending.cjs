const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.FABLE_PLAYWRIGHT);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FABLE_CHROMIUM, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const errors = [], voices = [];
    let fableRequests = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.url().includes('/cinematics/') || /\/api\/tts$/.test(r.url())) voices.push(r.url()); });
    await page.addInitScript(() => { window.__noPause = true; HTMLCanvasElement.prototype.requestPointerLock = () => Promise.resolve(); });
    await page.route('**/api/agent', r => r.fulfill({ json: { say: '', thought: '', tools: [] } }));
    await page.route('**/api/fable', r => { fableRequests++; return r.fulfill({ json: { title: '门外的风', moral: '你走出了她为你安排的路。' } }); });
    await page.clock.install();
    await page.goto(process.env.FABLE_URL || 'http://127.0.0.1:7863/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
    await page.evaluate(() => { document.querySelector('#segQ [data-q="low"]').click(); __game.world.scene.visible = false; });
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 3000));
    await page.evaluate(() => { __game.start(); document.querySelector('#filmSkip').click(); __game.agent.enabled = false; __game.tp(41, 8, 20, -.7); __game.player.pitch = -.8; });
    await page.clock.runFor(32);
    assert.equal(await page.evaluate(() => __game.mode()), 'falling');
    await page.clock.fastForward(3100);
    assert.equal(await page.evaluate(() => __game.mode()), 'transition');
    assert.equal(await page.locator('#ending').isVisible(), false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('agent-fable.jing-card-unlocked.v1')),null,'fall/cinematic must not unlock the card early');
    await page.clock.fastForward(13000);
    assert.equal(await page.evaluate(() => __game.G.cineScene.getObjectByName('distant-figure').visible), true);
    assert.equal(await page.evaluate(() => document.body.innerText.trim()), '', 'the city and distant-figure cinematic must remain wordless');
    assert.equal(voices.length, 0, 'escape must not introduce narration');
    const cdp = await page.context().newCDPSession(page);
    async function screenshot(name) {
      await page.evaluate(() => __game.world.scene.visible = true);
      await page.clock.runFor(32);
      const pending = cdp.send('Page.captureScreenshot', { format: 'png' });
      await page.clock.runFor(32);
      fs.writeFileSync('.runtime/' + name + '.png', Buffer.from((await pending).data, 'base64'));
      await page.evaluate(() => __game.world.scene.visible = false);
    }
    await screenshot('escape-wordless-cinematic');
    await page.clock.fastForward(6200);
    assert.equal(await page.evaluate(() => __game.mode()), 'ending');
    assert.equal(await page.locator('#ending').isVisible(), true, 'escape must open the settlement page after the cinematic');
    assert.match(await page.locator('#endName').textContent(), /寓言之外/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('agent-fable.jing-card-unlocked.v1')),'1','actual escape settlement unlocks the card');
    assert.equal(await page.locator('#characterUnlockNotice').isVisible(),true);
    assert.equal(await page.locator('#endStats > div').count(), 6);
    assert.ok(await page.locator('#endMaps canvas').count());
    assert.equal(await page.locator('#fableTitle').textContent(), '门外的风');
    assert.equal(fableRequests, 1);
    assert.equal(await page.locator('#btnAgain').isVisible(), true);
    assert.equal(await page.locator('#btnLoop').isVisible(), false);
    await page.locator('#ending').evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
    assert.equal(await page.locator('#ending').evaluate(el => getComputedStyle(el).opacity), '1');
    await screenshot('escape-settlement');
    await page.locator('#btnShare').dispatchEvent('click');
    assert.equal(await page.locator('#share').isVisible(), true);
    assert.match(await page.locator('#shareDl').getAttribute('href'), /^data:image\/png/);
    await page.locator('#shareClose').dispatchEvent('click');
    assert.equal(await page.locator('#ending').isVisible(), true);
    await page.clock.resume();
    await page.locator('#btnAgain').dispatchEvent('click');
    await page.waitForFunction(() => window.__game?.mode() === 'title', null, { timeout: 60000 });
    assert.deepEqual(errors, []);
    fs.writeFileSync('.runtime/escape-settlement-verification.json', JSON.stringify({ cinematicWordless: true, settlementVisible: true, statistics: 6, routeMaps: true, fableRequests, shareCard: true, replay: true, errors }, null, 2));
    console.log('Wordless escape cinematic → settlement, maps, fable, share card and replay passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

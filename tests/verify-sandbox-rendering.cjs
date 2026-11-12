const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.FABLE_PLAYWRIGHT);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FABLE_CHROMIUM, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.__noPause = true; HTMLCanvasElement.prototype.requestPointerLock = () => Promise.resolve(); });
    await page.route('**/api/agent', r => r.fulfill({ json: { say: '', tools: [] } }));
    await page.clock.install();
    await page.goto('http://127.0.0.1:7863/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
    await page.evaluate(() => {
      __game.world.scene.visible = false;
      document.querySelector('#tts').checked = false; document.querySelector('#tts').dispatchEvent(new Event('change'));
      __game.start(); document.querySelector('#filmSkip').click(); __game.agent.enabled = false;
    });
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 3000));
    await page.keyboard.press('Escape');
    const geometry = await page.evaluate(() => {
      const scene = __game.world.scene;
      const plinth = scene.children.find(o => o.geometry?.parameters?.width === 4.4 && o.position.x === 7);
      const cover = scene.children.find(o => o.geometry?.parameters?.width === 4.3 && o.position.x === 7);
      const top = plinth.position.y + plinth.geometry.parameters.height / 2;
      const positions = cover.geometry.getAttribute('position'), indices = cover.geometry.getIndex();
      let coincidentTriangles = 0;
      for (let i = 0; i < indices.count; i += 3) {
        if ([0, 1, 2].every(j => Math.abs(positions.getY(indices.getX(i + j)) + cover.position.y - top) < 1e-6)) coincidentTriangles++;
      }
      return { plinthTop: top, coverBottom: cover.position.y - cover.geometry.parameters.height / 2, coverTriangles: indices.count / 3, coincidentTriangles, coverDepthWrite: cover.material.depthWrite };
    });
    console.log(JSON.stringify(geometry));
    assert.equal(geometry.coincidentTriangles, 0, 'glass cover must not have a bottom face competing with the plinth top in the depth buffer');
    assert.equal(geometry.coverTriangles, 10, 'glass cover retains its lid and four walls');
    await page.evaluate(() => {
      __game.world.scene.visible = true;
      __game.world.scene.onBeforeRender = () => { __game.post.final.uniforms.uTime.value = 0; };
      const cover = __game.world.scene.getObjectByName('sandbox-cover');
      window.__openCover = cover.geometry;
      window.__closedCover = new cover.geometry.constructor(4.3, .9, 3.1);
    });
    for (const quality of ['high', 'mid', 'low']) {
      await page.evaluate(q => __game.post.setQuality(q), quality);
      for (let frame = 0; frame < 12; frame++) {
        await page.evaluate(frame => {
          const camera = __game.player.camera;
          camera.position.set(5.2 + frame * .008, 1.58, 25.6);
          camera.lookAt(7, 1.2, 23.6);
          __game.world.update(.016, camera, () => 1);
        }, frame);
        if (quality === 'high') {
          await page.evaluate(() => { __game.world.scene.getObjectByName('sandbox-cover').geometry = window.__closedCover; });
          await page.clock.runFor(16);
          const before = await page.evaluate(() => document.querySelector('#gl').toDataURL('image/png').split(',')[1]);
          fs.writeFileSync(`.runtime/sandbox-overlap-before-${String(frame).padStart(2, '0')}.png`, Buffer.from(before, 'base64'));
          await page.evaluate(() => { __game.world.scene.getObjectByName('sandbox-cover').geometry = window.__openCover; });
        }
        await page.clock.runFor(16);
        const data = await page.evaluate(() => document.querySelector('#gl').toDataURL('image/png').split(',')[1]);
        fs.writeFileSync(`.runtime/sandbox-stable-${quality}-${String(frame).padStart(2, '0')}.png`, Buffer.from(data, 'base64'));
      }
      console.log(quality + ': 12 consecutive moving-camera frames captured');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync('.runtime/sandbox-rendering-verification.json', JSON.stringify({ geometry, qualities: ['high', 'mid', 'low'], framesPerQuality: 12, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

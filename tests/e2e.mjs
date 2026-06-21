import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = Number(process.env.E2E_PORT || 5220);
const url = `http://127.0.0.1:${port}`;
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const server = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: projectRoot,
  env: { ...process.env, VITE_LLM_ENABLED: process.env.E2E_LLM_ENABLED || 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

let logs = '';
server.stdout.on('data', chunk => { logs += chunk.toString('utf8'); });
server.stderr.on('data', chunk => { logs += chunk.toString('utf8'); });

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const cleanup = () => {
  if (process.platform === 'win32' && server.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
  else server.kill();
};

const waitForServer = async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Vite server did not start.\n${logs}`);
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__agentFableTest), null, { timeout: 20_000 });
  await page.evaluate(() => window.__agentFableTest.start());
  await page.waitForFunction(() => window.__agentFableTest.getState().gameStarted === true);
  await page.getByTestId('compass').waitFor({ state: 'visible' });
  await page.keyboard.press('KeyF');
  let state = await page.evaluate(() => window.__agentFableTest.getState());
  assert(state.phoneOpen === false, 'F should not open SMS input or release mouse when there is no interaction target');

  await page.evaluate(() => window.__agentFableTest.setPlayerPos([0, -3, 0]));
  await page.getByTestId('true-ending').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__agentFableTest), null, { timeout: 20_000 });
  await page.evaluate(() => window.__agentFableTest.start());
  await page.waitForFunction(() => window.__agentFableTest.getState().gameStarted === true);
  await page.getByTestId('compass').waitFor({ state: 'visible' });

  await page.evaluate(() => window.__agentFableTest.setPlayerPos([18, 1, 0]));
  await page.getByTestId('true-ending').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__agentFableTest), null, { timeout: 20_000 });
  await page.evaluate(() => window.__agentFableTest.start());
  await page.waitForFunction(() => window.__agentFableTest.getState().gameStarted === true);
  await page.getByTestId('compass').waitFor({ state: 'visible' });

  await page.evaluate(() => window.__agentFableTest.openBoundaryGap());
  state = await page.evaluate(() => window.__agentFableTest.getState());
  assert(state.boundaryGapOpen === false, 'Boundary gap should not open before all consoles are destroyed');

  let navigation = await page.evaluate(() => window.__agentFableTest.getNavigation());
  assert(navigation.fakeExit.reachable === true, 'Fake exit route should be reachable at game start');
  assert(Number.isFinite(navigation.fakeExit.distance) && navigation.fakeExit.distance > 0, 'Fake exit route distance should be positive');
  assert(navigation.fakeExit.nextStep !== null, 'Fake exit route should provide a next step');
  assert(navigation.trueBoundaryGap.sealed === true, 'True boundary gap should start sealed');
  assert(navigation.trueBoundaryGap.reachable === false, 'Sealed true boundary gap should not be reachable');
  const detourRoute = await page.evaluate(() => {
    for (let x = -15; x <= 15; x += 1) {
      for (let z = -15; z <= 15; z += 1) {
        window.__agentFableTest.setPlayerPos([x, 1, z]);
        const route = window.__agentFableTest.getNavigation().fakeExit;
        if (route.reachable && route.distance > route.manhattanDistance && route.routeDirections.length > 0) {
          window.__agentFableTest.setPlayerPos([0, 1, 0]);
          return { x, z, route };
        }
      }
    }
    window.__agentFableTest.setPlayerPos([0, 1, 0]);
    return null;
  });
  assert(detourRoute !== null, 'Pathfinding should find a maze route longer than straight-line distance');

  await page.evaluate(() => window.__agentFableTest.openPhone());
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="sms-input"]');
    return input && !input.disabled;
  });
  const smsInput = page.getByTestId('sms-input');
  await smsInput.click();
  await smsInput.fill('true exit');
  await smsInput.press('Enter');
  await page.waitForFunction(() => window.__agentFableTest.getState().lastMessage === 'true exit');
  state = await page.evaluate(() => window.__agentFableTest.getState());
  assert(state.lastMessage === 'true exit', 'SMS did not submit from focused terminal');
  assert(state.phoneOpen === false, 'Phone input should close after SMS submit');
  await page.waitForFunction(() => window.__agentFableTest.getState().rawAiLogs > 0);
  state = await page.evaluate(() => window.__agentFableTest.getState());
  assert(state.rawAiLogs > 0, 'SMS submit did not trigger AI output');

  const destroyed = await page.evaluate(() => window.__agentFableTest.destroyAllConsoles());
  assert(destroyed === 5, `Expected 5 consoles, got ${destroyed}`);
  state = await page.evaluate(() => window.__agentFableTest.getState());
  assert(state.boundaryGapOpen === true, 'Boundary gap did not open');
  navigation = await page.evaluate(() => window.__agentFableTest.getNavigation());
  assert(navigation.trueBoundaryGap.sealed === false, 'True boundary gap should be unsealed after all consoles are destroyed');
  assert(navigation.trueBoundaryGap.reachable === true, 'Unsealed true boundary gap route should be reachable');
  assert(Number.isFinite(navigation.trueBoundaryGap.distance) && navigation.trueBoundaryGap.distance > 0, 'True boundary gap route distance should be positive');

  await page.evaluate(() => window.__agentFableTest.escapeWorld());
  await page.getByTestId('true-ending').waitFor({ state: 'visible' });
  console.log('E2E passed');
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  if (logs.trim()) console.error(`\n--- logs ---\n${logs}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  cleanup();
}

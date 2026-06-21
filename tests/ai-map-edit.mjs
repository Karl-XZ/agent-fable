import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

if (!process.env.QWEN_API_KEY) throw new Error('QWEN_API_KEY is required');

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const vitePort = Number(process.env.E2E_PORT || 5221);
const proxyPort = Number(process.env.QWEN_PROXY_PORT || 8793);
const viteUrl = `http://127.0.0.1:${vitePort}`;

const proxy = spawn(process.execPath, ['server/qwen-proxy.mjs'], {
  cwd: projectRoot,
  env: { ...process.env, QWEN_PROXY_PORT: String(proxyPort) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    VITE_LLM_ENABLED: 'true',
    VITE_AI_ENDPOINT: `http://127.0.0.1:${proxyPort}/api/ai/director`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

let logs = '';
for (const proc of [proxy, vite]) {
  proc.stdout.on('data', chunk => { logs += chunk.toString('utf8'); });
  proc.stderr.on('data', chunk => { logs += chunk.toString('utf8'); });
}

const cleanup = () => {
  for (const proc of [vite, proxy]) {
    if (process.platform === 'win32' && proc.pid) spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' });
    else proc.kill();
  }
};

const waitFor = async (url) => {
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Service did not start: ${url}\n${logs}`);
};

let browser;
try {
  await waitFor(`http://127.0.0.1:${proxyPort}/health`);
  await waitFor(viteUrl);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(viteUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__agentFableTest), null, { timeout: 20_000 });
  await page.evaluate(() => window.__agentFableTest.start());

  const before = await page.evaluate(() => window.__agentFableTest.getBlock?.(4, 1, 4) || null);
  await page.evaluate(() => window.__agentFableTest.sendSms('AI_MAP_EDIT_TEST spawn one wall'));
  await page.waitForFunction(() => {
    const block = window.__agentFableTest.getBlock?.(4, 1, 4);
    const state = window.__agentFableTest.getState();
    return block?.type === 'wall' || state.lastError;
  }, null, { timeout: 90_000 });

  const after = await page.evaluate(() => window.__agentFableTest.getBlock?.(4, 1, 4) || null);
  const state = await page.evaluate(() => window.__agentFableTest.getState());

  if (after?.type !== 'wall') {
    throw new Error(`AI map edit did not create wall. before=${JSON.stringify(before)} after=${JSON.stringify(after)} state=${JSON.stringify(state)}`);
  }
  if (state.rawAiLogs < 1 || state.lastError) {
    throw new Error(`AI map edit logged error. state=${JSON.stringify(state)}`);
  }
  console.log(`AI map edit passed: block(4,1,4)=${JSON.stringify(after)}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  if (logs.trim()) console.error(`\n--- logs ---\n${logs}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  cleanup();
}

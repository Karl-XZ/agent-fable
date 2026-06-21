import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.QWEN_PROXY_PORT || 8787);
const url = `http://127.0.0.1:${port}`;
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

if (!process.env.QWEN_API_KEY) throw new Error('QWEN_API_KEY is required for the real LLM smoke test');

const server = spawn(process.execPath, ['server/qwen-proxy.mjs'], {
  cwd: projectRoot,
  env: { ...process.env, QWEN_PROXY_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
server.stdout.on('data', chunk => { logs += chunk.toString('utf8'); });
server.stderr.on('data', chunk => { logs += chunk.toString('utf8'); });

const cleanup = () => {
  if (process.platform === 'win32' && server.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
  else server.kill();
};

const waitForProxy = async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Qwen proxy did not start.\n${logs}`);
};

try {
  await waitForProxy();
  const response = await fetch(`${url}/api/ai/smoke`, { method: 'POST' });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) throw new Error(`Qwen smoke failed: ${JSON.stringify(payload)}`);
  if (!payload.output?.subtitle || !payload.output?.action?.type) throw new Error(`Bad Qwen output: ${JSON.stringify(payload)}`);
  console.log(`Qwen smoke passed: ${payload.output.subtitle}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  if (logs.trim()) console.error(`\n--- logs ---\n${logs}`);
  process.exitCode = 1;
} finally {
  cleanup();
}

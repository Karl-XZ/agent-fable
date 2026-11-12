const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('node:module').createRequire(require.resolve('../web/node_modules/vite/package.json'))('esbuild');
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../web/src/navigation.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '../.runtime/navigation-test.cjs') });
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../web/src/agent.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '../.runtime/agent-navigation-test.cjs') });
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, 'navigation.test.cjs'), path.join(__dirname, 'agent-navigation.test.cjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

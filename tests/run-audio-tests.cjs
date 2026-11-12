const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('node:module').createRequire(require.resolve('../web/node_modules/vite/package.json'))('esbuild');
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../web/src/audio.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '../.runtime/audio-test.cjs') });
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, 'audio.test.cjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

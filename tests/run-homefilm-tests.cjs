const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('node:module').createRequire(require.resolve('../web/node_modules/vite/package.json'))('esbuild');
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../web/src/homefilm.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '../.runtime/homefilm-test.cjs') });
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../web/src/compass.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, '../.runtime/compass-test.cjs') });
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, 'homefilm.test.cjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

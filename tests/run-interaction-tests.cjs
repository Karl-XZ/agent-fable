const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('node:module').createRequire(require.resolve('../web/node_modules/vite/package.json'))('esbuild');
for (const source of ['interaction', 'agent']) esbuild.buildSync({ entryPoints: [path.join(__dirname, `../web/src/${source}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, `../.runtime/${source}-behavior-test.cjs`) });
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, 'interaction.test.cjs'), path.join(__dirname, 'agent-behavior.test.cjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

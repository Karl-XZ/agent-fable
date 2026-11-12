const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('node:module').createRequire(require.resolve('../web/node_modules/vite/package.json'))('esbuild');
for (const [source, output] of [['outside', 'outside'], ['ending', 'ending'], ['player', 'player'], ['sandbox', 'sandbox']]) {
  esbuild.buildSync({ entryPoints: [path.join(__dirname, `../web/src/${source}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, `../.runtime/${output}-test.cjs`) });
}
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, 'outside.test.cjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

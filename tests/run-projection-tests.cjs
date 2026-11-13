const path=require('node:path'),{spawnSync}=require('node:child_process');
const esbuild=require('node:module').createRequire(require.resolve('../web/node_modules/vite/package.json'))('esbuild');
esbuild.buildSync({entryPoints:[path.join(__dirname,'../web/src/projection-geometry.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(__dirname,'../.runtime/projection-test.cjs')});
process.exitCode=spawnSync(process.execPath,['--test',path.join(__dirname,'projection.test.cjs')],{stdio:'inherit'}).status??1;

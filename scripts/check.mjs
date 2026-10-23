import { spawnSync } from 'node:child_process';
for (const file of ['src/document.mjs', 'src/cli.mjs', 'scripts/demo.mjs', 'scripts/check.mjs', 'test/document.test.mjs']) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Syntax checks passed (5 JavaScript files).');

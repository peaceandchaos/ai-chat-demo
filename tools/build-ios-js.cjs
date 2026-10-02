const { spawnSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { checkAppConfig } = require('./check-app-config.cjs');

const root = resolve(__dirname, '..');
const problems = checkAppConfig(root);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
const output = join(root, '.quality-results/ios');
mkdirSync(output, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules/react-native/cli.js'),
    'bundle',
    '--platform',
    'ios',
    '--dev',
    'false',
    '--entry-file',
    'index.js',
    '--bundle-output',
    join(output, 'main.jsbundle'),
    '--assets-dest',
    output,
    '--max-workers',
    '2',
  ],
  { cwd: join(root, 'packages/app'), stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

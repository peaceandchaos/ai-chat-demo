const { spawnSync } = require('node:child_process');
const {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const repository = resolve(__dirname, '../..');
const example = readFileSync(
  join(repository, 'packages/app/src/config.example.ts'),
  'utf8',
);
const key = `sk-proj-${'c'.repeat(40)}`;

// Runs tools/build-ios-js.cjs in a scratch copy of the repository layout, with
// the given config.ts. Nothing else is installed there, so a build that gets
// past the config check fails on the missing React Native CLI instead.
function build(config) {
  const root = mkdtempSync(join(tmpdir(), 'app-config-'));
  try {
    mkdirSync(join(root, 'tools'));
    mkdirSync(join(root, 'packages/app/src'), { recursive: true });
    for (const file of ['build-ios-js.cjs', 'check-app-config.cjs'])
      try {
        copyFileSync(
          join(repository, 'tools', file),
          join(root, 'tools', file),
        );
      } catch {
        // The check does not exist before the fix.
      }
    writeFileSync(join(root, 'packages/app/src/config.example.ts'), example);
    writeFileSync(join(root, 'packages/app/src/config.ts'), config);
    return spawnSync(process.execPath, [join(root, 'tools/build-ios-js.cjs')], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the iOS bundle build stops before bundling when config.ts exports a name the example does not', () => {
  const stale = `${example}\nexport const OPENAI_API_KEY = '${key}';\n`;
  const result = build(stale);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `packages/app/src/config.ts:${example.split('\n').length + 1} exports OPENAI_API_KEY`,
  );
  expect(result.stderr).not.toContain('react-native/cli.js');
  expect(result.stderr + result.stdout).not.toContain(key);
});

test.each([
  ['an unexported value', `const key = '${key}';\n`, ':1 '],
  ['an import', "import { key } from './secrets';\n", ':1 '],
  ['a computed value', 'export const PROXY_BASE_URL = `${key}`;\n', ':1 '],
])('the iOS bundle build rejects config.ts with %s', (_, extra, line) => {
  const result = build(extra);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`packages/app/src/config.ts${line}`);
  expect(result.stderr + result.stdout).not.toContain(key);
});

test('a config.ts copied from the example passes the check and reaches the bundler', () => {
  const result = build(
    example.replace('https://chat.example.com', 'https://chat.test'),
  );
  expect(result.stderr).not.toContain('packages/app/src/config.ts');
  expect(result.stderr).toContain('react-native/cli.js');
});

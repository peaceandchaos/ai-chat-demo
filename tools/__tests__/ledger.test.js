const { spawnSync } = require('node:child_process');
const {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { git } = require('../verification/snapshot.cjs');

const cli = resolve(__dirname, '../skills/cli.cjs');
const ledgerPath = 'tools/skills/ledger.json';
let repository;

function write(path, text) {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), text);
}

function lesson(id, enforcement, extra = {}) {
  return {
    id,
    lesson: `Lesson ${id}.`,
    seen: ['a run'],
    enforcement,
    ...extra,
  };
}

function ledger(lessons) {
  write(ledgerPath, JSON.stringify({ lessons }));
  return spawnSync(process.execPath, [cli, 'ledger'], {
    cwd: repository,
    encoding: 'utf8',
  });
}

beforeAll(() => {
  repository = realpathSync(mkdtempSync(join(tmpdir(), 'ledger-fixture-')));
  git(repository, ['init', '--quiet']);
  write(
    'tools/verification/checks.cjs',
    "module.exports = { checks: { lint: ['run', 'lint'] }, rangeChecks: { 'commit-types': ['run', 'typecheck:range', '--'] } };\n",
  );
  write(
    '.oxlintrc.json',
    JSON.stringify({
      rules: {
        'project/rule': ['error', { allow: [] }],
        'project/off': 'off',
      },
    }),
  );
  write(
    'tests/sizes.test.ts',
    "test('a named case', () => {});\ntest('a type case', () => {});\n",
  );
  write('docs/decision.md', '# Keep this as guidance\n');
  git(repository, ['add', '--all']);
  write('docs/draft.md', '# Not tracked\n');
});

afterAll(() => rmSync(repository, { recursive: true, force: true }));

const sizes = name => ({ file: 'tests/sizes.test.ts', name });

test('passes when every enforcement exists and repeated guidance links a decision', () => {
  const result = ledger([
    lesson('once', { kind: 'guidance' }),
    lesson(
      'decided',
      { kind: 'guidance' },
      { seen: ['a run', 'another run'], link: 'docs/decision.md' },
    ),
    lesson(
      'tracked',
      { kind: 'guidance' },
      { seen: ['a', 'b', 'c'], link: 'https://example.invalid/issues/1' },
    ),
    lesson('checked', { kind: 'check', check: 'lint' }),
    lesson('ranged', { kind: 'check', check: 'commit-types' }),
    lesson('linted', { kind: 'lint', rule: 'project/rule' }),
    lesson('tested', { kind: 'test', ...sizes('a named case') }),
    lesson('typed', { kind: 'type', ...sizes('a type case') }),
  ]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `${ledgerPath} has no guidance-only lesson that needs promotion.\n`,
  );
});

test('fails on repeated unlinked guidance, stale enforcement, bad links, and duplicate ids', () => {
  const result = ledger([
    lesson(
      'repeated',
      { kind: 'guidance' },
      { seen: ['a run', 'another run'] },
    ),
    lesson('gone-check', { kind: 'check', check: 'retired' }),
    lesson('gone-rule', { kind: 'lint', rule: 'project/retired' }),
    lesson('off-rule', { kind: 'lint', rule: 'project/off' }),
    lesson('gone-test', { kind: 'test', ...sizes('a renamed case') }),
    lesson('gone-file', {
      kind: 'type',
      file: 'tests/gone.test.ts',
      name: 'x',
    }),
    lesson('draft', { kind: 'guidance' }, { link: 'docs/draft.md' }),
    lesson('repeated', { kind: 'check', check: 'lint' }),
  ]);
  expect(result.stdout).toBe('');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    [
      `${ledgerPath} fails:`,
      'repeated is guidance only and was seen 2 times. Enforce it with a type, test, lint rule, or check, or link the issue or decision that keeps it as guidance.',
      'gone-check names check retired, which tools/verification/checks.cjs does not run.',
      'gone-rule names lint rule project/retired, which .oxlintrc.json does not enable.',
      'off-rule names lint rule project/off, which .oxlintrc.json does not enable.',
      "gone-test names test 'a renamed case', which tests/sizes.test.ts does not contain.",
      "gone-file names test 'x', which tests/gone.test.ts does not contain.",
      'draft links docs/draft.md, which is neither an https URL nor a tracked file.',
      'repeated appears twice.',
      '',
    ].join('\n'),
  );
});

test('rejects a lesson without a sighting or with an unknown enforcement', () => {
  const unseen = ledger([lesson('unseen', { kind: 'guidance' }, { seen: [] })]);
  expect(unseen.status).toBe(1);
  expect(unseen.stderr).toContain('"seen"');
  const unknown = ledger([lesson('vague', { kind: 'review' })]);
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain('"kind"');
});

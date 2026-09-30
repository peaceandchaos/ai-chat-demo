const { spawnSync } = require('node:child_process');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
  readdirSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const {
  git,
  withSnapshot,
  fingerprint,
} = require('../verification/snapshot.cjs');
const { evaluate } = require('../audit-check.cjs');
const checks = require('../verification/checks.cjs');
const { assertComplete } = require('../test-verified.cjs');

jest.setTimeout(30_000);

test('a real Jest run with a skipped case cannot become an accepted pass', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'skip-fixture-'));
  try {
    writeFileSync(
      join(fixture, 'skipped.test.js'),
      "test.skip('unfinished', () => {});\n",
    );
    const report = join(fixture, 'result.json');
    const result = spawnSync(
      process.execPath,
      [
        resolve('node_modules/jest/bin/jest.js'),
        '--config',
        JSON.stringify({ rootDir: fixture }),
        '--runInBand',
        '--json',
        '--outputFile',
        report,
      ],
      { cwd: fixture, encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status).toBe(0);
    const data = JSON.parse(readFileSync(report, 'utf8'));
    expect(data.numPendingTests).toBe(1);
    expect(() => assertComplete(data, 'fixture')).toThrow('skipped');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('committed and staged checks reject a broken tree despite an unstaged fix and local dependencies', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'verify-fixture-'));
  try {
    git(fixture, ['init', '--quiet']);
    git(fixture, ['config', 'core.hooksPath', '/dev/null']);
    git(fixture, ['config', 'user.name', 'Verification fixture']);
    git(fixture, ['config', 'user.email', 'fixture@example.invalid']);
    mkdirSync(join(fixture, 'tools/verification'), { recursive: true });
    mkdirSync(join(fixture, 'packages/app/src'), { recursive: true });
    for (const name of [
      'verify.cjs',
      'verification/snapshot.cjs',
      'verification/checks.cjs',
    ]) {
      copyFileSync(
        resolve(__dirname, '..', name),
        join(fixture, 'tools', name),
      );
    }
    const scripts = {};
    for (const args of Object.values(checks))
      scripts[args[1]] = 'node check.cjs';
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }),
    );
    writeFileSync(
      join(fixture, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name: 'fixture', version: '1.0.0' } },
      }),
    );
    writeFileSync(join(fixture, '.node-version'), process.versions.node);
    writeFileSync(
      join(fixture, '.gitignore'),
      'node_modules/\n.quality-results/\npackages/app/src/config.ts\n',
    );
    writeFileSync(
      join(fixture, 'packages/app/src/config.example.ts'),
      'export {};\n',
    );
    writeFileSync(join(fixture, 'check.cjs'), 'process.exit(1);\n');
    git(fixture, ['add', '.']);
    git(fixture, ['commit', '--quiet', '-m', 'Broken fixture']);
    const commit = git(fixture, ['rev-parse', 'HEAD']);
    writeFileSync(join(fixture, 'check.cjs'), 'process.exit(0);\n');
    // An unstaged change to the gate itself must not judge this commit.
    writeFileSync(
      join(fixture, 'tools/verification/checks.cjs'),
      'module.exports = {};\n',
    );
    mkdirSync(join(fixture, 'node_modules'));
    writeFileSync(
      join(fixture, 'node_modules/local-fix'),
      'Must not enter the snapshot.',
    );
    const result = spawnSync(
      process.execPath,
      [resolve(__dirname, '../verify.cjs'), 'commit', commit],
      { cwd: fixture, encoding: 'utf8', timeout: 20_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('lint: FAIL');
    expect(result.stdout).toContain(`commit ${commit}`);
    expect(result.stdout).toContain('server-build: FAIL');
    expect(result.stderr).not.toContain('npm ERR');
    withSnapshot(fixture, 'staged', 'HEAD', checkout => {
      expect(existsSync(join(checkout, 'node_modules'))).toBe(false);
      expect(
        spawnSync(process.execPath, ['check.cjs'], { cwd: checkout }).status,
      ).toBe(1);
      const before = fingerprint(checkout);
      writeFileSync(
        join(checkout, 'unexpected.ts'),
        'export const changed = true;',
      );
      expect(fingerprint(checkout)).not.toBe(before);
    });
    expect(readFileSync(join(fixture, 'check.cjs'), 'utf8')).toBe(
      'process.exit(0);\n',
    );
    expect(readdirSync(join(fixture, 'node_modules'))).toContain('local-fix');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('dependency policy blocks high findings, missing reviews, expired reviews, and unavailable audits', () => {
  const url = 'https://github.com/advisories/fixture';
  const advisory = { url, range: '<2', severity: 'moderate' };
  const finding = { severity: 'moderate', via: [advisory] };
  const audit = {
    auditReportVersion: 2,
    vulnerabilities: { fixture: finding },
    metadata: { dependencies: { total: 1 } },
  };
  const review = {
    [url]: {
      range: '<2',
      decision: 'track',
      reviewBy: '2026-10-01',
      reason: 'No affected caller in the reviewed path.',
    },
  };
  expect(evaluate(audit, review, '2026-09-29')).toEqual([]);
  expect(evaluate(audit, {}, '2026-09-29')).toHaveLength(1);
  expect(evaluate(audit, review, '2026-10-02')).toHaveLength(1);
  finding.severity = 'high';
  expect(evaluate(audit, review, '2026-09-29')).toContain('fixture: high');
  expect(() => evaluate({ error: 'offline' }, review, '2026-09-29')).toThrow(
    'Audit response',
  );
});

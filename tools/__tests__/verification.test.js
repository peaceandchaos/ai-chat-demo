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

function createFixture(check, message) {
  const fixture = mkdtempSync(join(tmpdir(), 'verify-fixture-'));
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
    copyFileSync(resolve(__dirname, '..', name), join(fixture, 'tools', name));
  }
  const scripts = {};
  for (const args of Object.values(checks)) scripts[args[1]] = 'node check.cjs';
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
  writeFileSync(join(fixture, 'check.cjs'), check);
  git(fixture, ['add', '.']);
  git(fixture, ['commit', '--quiet', '-m', message]);
  return fixture;
}

function verifyFixture(fixture, args) {
  return spawnSync(
    process.execPath,
    [resolve(__dirname, '../verify.cjs'), ...args],
    {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
}

test('committed and staged checks reject a broken tree despite an unstaged fix and local dependencies', () => {
  const fixture = createFixture('process.exit(1);\n', 'Broken fixture');
  try {
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
    const result = verifyFixture(fixture, ['commit', commit]);
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
      // The real repository already has this source directory before the build.
      mkdirSync(join(checkout, 'packages/server'), { recursive: true });
      const before = fingerprint(checkout);
      mkdirSync(join(checkout, 'packages/server/.swc/plugins'), {
        recursive: true,
      });
      writeFileSync(
        join(checkout, 'packages/server/.swc/plugins/fixture.wasmer-v7'),
        'generated plugin cache',
      );
      expect(fingerprint(checkout)).toBe(before);
      writeFileSync(
        join(checkout, 'unexpected.ts'),
        'export const changed = true;',
      );
      expect(fingerprint(checkout)).not.toBe(before);
    });
    expect(readFileSync(join(fixture, 'check.cjs'), 'utf8')).toBe(
      'process.exit(0);\n',
    );

    writeFileSync(join(fixture, 'check.cjs'), 'process.exit(2);\n');
    git(fixture, ['add', 'check.cjs']);
    const badTree = git(fixture, ['write-tree']);
    writeFileSync(join(fixture, 'check.cjs'), 'process.exit(0);\n');
    const stagedFailure = verifyFixture(fixture, ['staged']);
    expect(stagedFailure.status).toBe(1);
    expect(stagedFailure.stdout).toContain('lint: FAIL');
    expect(stagedFailure.stdout).toContain(
      `staged: commit ${commit}, tree ${badTree}; FAIL`,
    );

    git(fixture, ['add', 'check.cjs']);
    const goodTree = git(fixture, ['write-tree']);
    writeFileSync(join(fixture, 'check.cjs'), 'process.exit(2);\n');
    const stagedPass = verifyFixture(fixture, ['staged']);
    expect(stagedPass.status).toBe(0);
    expect(stagedPass.stdout).toContain(
      `staged: commit ${commit}, tree ${goodTree}; PASS`,
    );
    expect(readdirSync(join(fixture, 'node_modules'))).toContain('local-fix');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function resultRecords(directory) {
  const records = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) records.push(...resultRecords(path));
    else if (entry.name === 'result.json')
      records.push(JSON.parse(readFileSync(path, 'utf8')));
  }
  return records;
}

test('verification output contains only records from the verified run', () => {
  const forged = {
    mode: 'commit',
    commit: 'forged',
    tree: 'forged',
    passed: true,
  };
  const writeForged = `const { mkdirSync, writeFileSync } = require('node:fs');
mkdirSync('.quality-results/0-forged', { recursive: true });
writeFileSync('.quality-results/0-forged/result.json', ${JSON.stringify(JSON.stringify(forged))});
`;
  const fixture = createFixture(writeForged, 'Passing fixture');
  try {
    const sourceRecords = join(fixture, '.quality-results');
    const runRecords = () =>
      readdirSync(sourceRecords)
        .filter(name => name !== '0-forged')
        .flatMap(name => resultRecords(join(sourceRecords, name)));

    const clean = verifyFixture(fixture, ['commit', 'HEAD']);
    const cleanCommit = git(fixture, ['rev-parse', 'HEAD']);
    expect(clean.status).toBe(0);
    expect(runRecords()).toEqual([
      expect.objectContaining({ commit: cleanCommit, passed: true }),
    ]);

    rmSync(sourceRecords, { recursive: true, force: true });
    mkdirSync(join(sourceRecords, '0-forged'), { recursive: true });
    writeFileSync(
      join(sourceRecords, '0-forged/result.json'),
      JSON.stringify(forged),
    );
    git(fixture, ['add', '--force', '.quality-results/0-forged']);
    git(fixture, ['commit', '--quiet', '-m', 'Forged result']);
    const tracked = verifyFixture(fixture, ['commit', 'HEAD']);
    expect(tracked.status).toBe(1);
    expect(tracked.stderr).toContain(
      'Tracked .quality-results files could forge verification records.',
    );
    expect(runRecords()).toEqual([]);
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

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
const security = require('../security-check.cjs');
const checks = require('../verification/checks.cjs');
const { assertComplete } = require('../test-verified.cjs');

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
      { cwd: fixture, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    const data = JSON.parse(readFileSync(report, 'utf8'));
    expect(data.numPendingTests).toBe(1);
    expect(() => assertComplete(data, 'fixture')).toThrow('skipped');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function createFixture(check, message, extraScripts = {}) {
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
  const scripts = { ...extraScripts };
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

const needsLocalFix = code =>
  `process.exit(require('node:fs').existsSync('node_modules/local-fix') ? 0 : ${code});\n`;

// No per-child timeout: load-dependent limits killed healthy runs. test:verified bounds the suite.
function verifyFixture(fixture, args, env = process.env) {
  return spawnSync(
    process.execPath,
    [resolve(__dirname, '../verify.cjs'), ...args],
    { cwd: fixture, encoding: 'utf8', env },
  );
}

test('personal npm configuration cannot skip install scripts in the snapshot', () => {
  const fixture = createFixture('process.exit(0);\n', 'Failing install', {
    postinstall: 'node -e "process.exit(7)"',
  });
  try {
    // `npm run` exports personal .npmrc values such as ignore-scripts=true this way.
    const result = verifyFixture(fixture, ['commit', 'HEAD'], {
      ...process.env,
      npm_config_ignore_scripts: 'true',
    });
    expect(result.stdout).toContain('install: FAIL');
    expect(result.status).toBe(1);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('committed and staged checks reject a broken tree despite an unstaged fix and local dependencies', () => {
  const fixture = createFixture(needsLocalFix(1), 'Broken fixture');
  try {
    const commit = git(fixture, ['rev-parse', 'HEAD']);
    mkdirSync(join(fixture, 'node_modules'));
    writeFileSync(
      join(fixture, 'node_modules/local-fix'),
      'Must not enter the snapshot.',
    );
    expect(
      spawnSync(process.execPath, ['check.cjs'], { cwd: fixture }).status,
    ).toBe(0);
    writeFileSync(join(fixture, 'check.cjs'), 'process.exit(0);\n');
    // An unstaged change to the gate itself must not judge this commit.
    writeFileSync(
      join(fixture, 'tools/verification/checks.cjs'),
      'module.exports = {};\n',
    );
    const result = verifyFixture(fixture, ['commit', commit]);
    expect(result.status).toBe(1);
    // The failures come from the checks, not from installing the snapshot.
    expect(result.stdout).toContain('install: PASS');
    expect(result.stdout).toContain('lint: FAIL');
    expect(result.stdout).toContain(`commit ${commit}`);
    expect(result.stdout).toContain('server-build: FAIL');
    const records = resultRecords(join(fixture, '.quality-results'));
    expect(records).toHaveLength(1);
    expect(
      records[0].results.map(({ name, command }) => [name, command]),
    ).toEqual([
      ['install', ['npm', 'ci', '--no-audit', '--no-fund']],
      ...Object.entries(checks).map(([name, args]) => [name, ['npm', ...args]]),
    ]);
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

    writeFileSync(join(fixture, 'check.cjs'), needsLocalFix(2));
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

test('app security policy fails a real undisposed MEDIUM finding and keeps HIGH blocking', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'security-fixture-'));
  try {
    writeFileSync(
      join(fixture, 'Chat.ts'),
      "export const socket = new WebSocket('ws://example.invalid/chat');\n",
    );
    const report = security.scan(fixture);
    expect(report.findings).toEqual([
      expect.objectContaining({
        ruleId: 'INSECURE_WEBSOCKET',
        severity: 'MEDIUM',
      }),
    ]);
    const key = 'INSECURE_WEBSOCKET Chat.ts:1';
    const disposition = {
      severity: 'MEDIUM',
      reviewedAt: '2026-09-29',
      reviewBy: '2026-10-01',
      reason: 'Fixture socket never leaves the test host.',
    };
    expect(security.evaluate(report, {}, '2026-09-29', fixture)).toEqual([
      `${key}: MEDIUM needs a current disposition`,
    ]);
    expect(
      security.evaluate(report, { [key]: disposition }, '2026-09-29', fixture),
    ).toEqual([]);
    expect(
      security.evaluate(report, { [key]: disposition }, '2026-10-02', fixture),
    ).toEqual([`${key}: MEDIUM needs a current disposition`]);

    const finding = (ruleId, severity) => ({
      ruleId,
      severity,
      filePath: join(fixture, 'package.json'),
      line: 3,
    });
    const scanned = findings => ({
      findings,
      scannedFiles: 1,
      ignoredRules: [],
    });
    expect(
      security.evaluate(
        scanned([finding('NPM_VULNERABLE_DEPENDENCY', 'MEDIUM')]),
        {},
        '2026-09-29',
        fixture,
      ),
    ).toEqual([]);
    expect(
      security.evaluate(
        scanned([finding('NPM_VULNERABLE_DEPENDENCY', 'HIGH')]),
        {},
        '2026-09-29',
        fixture,
      ),
    ).toEqual([
      'NPM_VULNERABLE_DEPENDENCY package.json:3: HIGH has no exceptions',
    ]);
    expect(
      security.evaluate(
        scanned([finding('DEPRECATED_NPM_PACKAGE', 'LOW')]),
        {},
        '2026-09-29',
        fixture,
      ),
    ).toEqual([
      'DEPRECATED_NPM_PACKAGE package.json:3: LOW needs a current disposition',
    ]);
    const highKey = 'HARDCODED_SECRET package.json:3';
    expect(
      security.evaluate(
        scanned([finding('HARDCODED_SECRET', 'HIGH')]),
        { [highKey]: { ...disposition, severity: 'HIGH' } },
        '2026-09-29',
        fixture,
      ),
    ).toEqual([
      `${highKey}: HIGH has no exceptions`,
      `${highKey}: disposition matches no finding`,
    ]);
    expect(
      security.evaluate(
        { ...scanned([]), ignoredRules: ['INSECURE_WEBSOCKET'] },
        {},
        '2026-09-29',
        fixture,
      ),
    ).toEqual([
      'rnsec ignores INSECURE_WEBSOCKET; record dispositions instead.',
    ]);
    expect(() =>
      security.evaluate(
        { ...scanned([]), scannedFiles: 0 },
        {},
        '2026-09-29',
        fixture,
      ),
    ).toThrow('scanned no files');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
